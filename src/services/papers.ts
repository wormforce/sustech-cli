import {
  arrayValue,
  createFetchAdapter,
  fetchJson,
  recordValue,
  requestUrl,
  stringValue,
} from "./base.js";
import type { ServiceAdapter, ServiceStatus } from "./base.js";

export const CROSSREF_BASE = "https://api.crossref.org/works";
export const UNPAYWALL_BASE = "https://api.unpaywall.org/v2";
export const UNPAYWALL_EMAIL = "sustech-survival@users.noreply.github.com";

export const PAPERS_STATUS: ServiceStatus = {
  service: "papers",
  availability: "implemented",
  auth: "none",
  campusNetwork: false,
  browser: false,
  summary: "CrossRef plus Unpaywall provide public paper metadata and open-access resolution.",
  notes: [
    "This module intentionally stops at metadata and OA links; it does not download files.",
  ],
  endpoints: [
    "https://api.crossref.org/works",
    "https://api.unpaywall.org/v2/{doi}",
  ],
};

export interface PaperSummary {
  title: string;
  doi: string;
  authors: string[];
  journal: string;
  year?: number;
  citations: number;
  queryUsed: string;
  oa: boolean;
  pdfUrl?: string;
}

export interface OpenAccessResolution {
  doi: string;
  openAccess: boolean;
  pdfUrl?: string;
}

const WANTED_TYPES = new Set(["journal-article", "proceedings-article", "posted-content"]);
const SKIP_TYPES = new Set(["journal-review-article", "book", "book-chapter", "proceedings-review"]);

export async function searchCrossref(
  query: string,
  options: {
    maxResults?: number;
    minYear?: number;
    openAccessOnly?: boolean;
    adapter?: ServiceAdapter;
    resolveOpenAccess?: boolean;
  } = {},
): Promise<PaperSummary[]> {
  const adapter = options.adapter ?? createFetchAdapter();
  const maxResults = Math.max(1, Math.min(options.maxResults ?? 10, 100));
  const params: Record<string, string | number> = {
    "query.bibliographic": query,
    rows: Math.min(maxResults * 8, 100),
    select: "DOI,title,author,published-print,published-online,container-title,type,is-referenced-by-count",
    sort: "relevance",
  };
  if (options.minYear) {
    params.filter = `from-pub-date:${options.minYear}`;
  }
  const raw = await fetchJson<unknown>(adapter, requestUrl(CROSSREF_BASE, "", params));
  const items = arrayValue(recordValue(recordValue(raw).message).items)
    .map((item) => normaliseCrossrefWork(item, query))
    .filter((paper): paper is PaperSummary => paper !== null)
    .sort((left, right) => comparePaperRelevance(query, left, right));
  const papers: PaperSummary[] = [];
  for (const item of items) {
    if (options.minYear && item.year !== undefined && item.year < options.minYear) continue;
    if (options.resolveOpenAccess !== false && item.doi) {
      const resolution = await resolveOpenAccess(item.doi, { adapter });
      item.oa = resolution.openAccess;
      item.pdfUrl = resolution.pdfUrl;
    }
    if (options.openAccessOnly && !item.oa) continue;
    papers.push(item);
    if (papers.length >= maxResults) break;
  }
  return papers;
}

export async function resolveOpenAccess(
  doi: string,
  options: { adapter?: ServiceAdapter; email?: string } = {},
): Promise<OpenAccessResolution> {
  if (!doi || doi.startsWith("10.12688") || doi.toLowerCase().includes(".suppl") || /\.s00\d$/i.test(doi)) {
    return { doi, openAccess: false };
  }
  const adapter = options.adapter ?? createFetchAdapter();
  const url = `${UNPAYWALL_BASE}/${encodeURIComponent(doi)}?email=${encodeURIComponent(options.email ?? UNPAYWALL_EMAIL)}`;
  const raw = await fetchJson<unknown>(adapter, url);
  const record = recordValue(raw);
  const best = recordValue(record.best_oa_location);
  return {
    doi,
    openAccess: Boolean(record.is_oa),
    ...(best.url_for_pdf || best.url ? { pdfUrl: stringValue(best.url_for_pdf ?? best.url) } : {}),
  };
}

export function normaliseCrossrefWork(raw: unknown, queryUsed: string): PaperSummary | null {
  const record = recordValue(raw);
  const doi = stringValue(record.DOI);
  const type = stringValue(record.type);
  if (SKIP_TYPES.has(type)) return null;
  if (doi && (doi.toLowerCase().includes("/suppl") || doi.toLowerCase().includes("/supplementary") || /\.s00\d$/i.test(doi))) {
    return null;
  }
  if (type && !WANTED_TYPES.has(type)) return null;
  const year = extractCrossrefYear(record);
  return {
    title: stringValue(arrayValue(record.title)[0] ?? "Untitled"),
    doi,
    authors: parseCrossrefAuthors(arrayValue(record.author)),
    journal: stringValue(arrayValue(record["container-title"])[0]),
    ...(year !== undefined ? { year } : {}),
    citations: Number(record["is-referenced-by-count"] ?? 0),
    queryUsed,
    oa: false,
  };
}

export function parseCrossrefAuthors(raw: readonly unknown[]): string[] {
  return raw
    .map((item) => recordValue(item))
    .map((author) => {
      const family = stringValue(author.family ?? author.name);
      const given = stringValue(author.given);
      return given ? `${given} ${family}`.trim() : family;
    })
    .filter(Boolean);
}

function extractCrossrefYear(record: Record<string, unknown>): number | undefined {
  const publishedPrint = recordValue(record["published-print"]);
  const printYear = extractYearFromDateParts(publishedPrint);
  if (printYear !== undefined) return printYear;
  const publishedOnline = recordValue(record["published-online"]);
  return extractYearFromDateParts(publishedOnline);
}

function extractYearFromDateParts(record: Record<string, unknown>): number | undefined {
  const outer = arrayValue(record["date-parts"]);
  const inner = Array.isArray(outer[0]) ? outer[0] as unknown[] : [];
  const year = inner[0];
  return typeof year === "number" ? year : undefined;
}

function comparePaperRelevance(query: string, left: PaperSummary, right: PaperSummary): number {
  const queryText = normalizeSearchText(query);
  const terms = queryText.split(" ").filter((term) => term.length >= 2);
  const score = (paper: PaperSummary): number => {
    const titleText = normalizeSearchText(paper.title);
    const journalText = normalizeSearchText(paper.journal);
    const authorText = normalizeSearchText(paper.authors.join(" "));
    let total = 0;
    if (queryText && titleText.includes(queryText)) total += 100;
    for (const term of terms) {
      total += countOccurrences(titleText, term) * 12;
      total += countOccurrences(journalText, term) * 4;
      total += countOccurrences(authorText, term) * 3;
    }
    return total;
  };

  return (
    score(right)
    - score(left)
    || right.citations - left.citations
    || (right.year ?? 0) - (left.year ?? 0)
    || left.title.localeCompare(right.title)
  );
}

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function countOccurrences(haystack: string, needle: string): number {
  if (!haystack || !needle) return 0;
  let count = 0;
  let index = 0;
  while (true) {
    const next = haystack.indexOf(needle, index);
    if (next === -1) return count;
    count += 1;
    index = next + needle.length;
  }
}
