import { createHash, randomUUID } from "node:crypto";
import { constants as fileSystemConstants } from "node:fs";
import { copyFile, link, lstat, open, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join, resolve as resolvePath } from "node:path";
import { isIP } from "node:net";
import { CliError } from "../core/errors.js";
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
    "OA PDFs can be downloaded only to an explicit local destination; existing files and symbolic-link targets are refused unless a regular file is explicitly overwritten.",
    "Authenticated publisher, CNKI, Web of Science, and RSC browser automation remains out of scope.",
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

export interface OpenAccessPdfDownload {
  doi: string;
  destination: string;
  sourceHost: string;
  size: number;
  sha256: string;
  contentType: string;
  overwritten: boolean;
}

const DEFAULT_MAX_PDF_BYTES = 200 * 1024 * 1024;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 60_000;

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
    rows: Math.min(Math.max(maxResults * 8, 50), 100),
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

export async function downloadOpenAccessPdf(
  doi: string,
  destination: string,
  options: {
    adapter?: ServiceAdapter;
    fetchImpl?: typeof fetch;
    overwrite?: boolean;
    maxBytes?: number;
    timeoutMs?: number;
  } = {},
): Promise<OpenAccessPdfDownload> {
  const output = await inspectPaperDestination(destination, options.overwrite === true);
  const resolution = await resolveOpenAccess(doi, { adapter: options.adapter });
  if (!resolution.openAccess || !resolution.pdfUrl) {
    throw new CliError("Unpaywall did not expose an open-access PDF for this DOI.", "PAPER_OA_PDF_UNAVAILABLE", 1, { doi });
  }
  const initialUrl = safePublicPdfUrl(resolution.pdfUrl);
  const response = await fetchPaperPdf(initialUrl, options.fetchImpl ?? globalThis.fetch, options.timeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS);
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_PDF_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new CliError("The OA PDF byte limit must be a positive safe integer.", "PAPER_DOWNLOAD_LIMIT_INVALID", 2);
  }
  const tempPath = join(dirname(output.destination), `.${basename(output.destination)}.sustech-${randomUUID()}.tmp`);
  try {
    const streamed = await streamPaperPdf(response, tempPath, maxBytes);
    await finishPaperDownload(tempPath, output.destination, options.overwrite === true);
    return {
      doi,
      destination: output.destination,
      sourceHost: safePublicPdfUrl(response.url || initialUrl.toString()).hostname,
      size: streamed.size,
      sha256: streamed.sha256,
      contentType: streamed.contentType,
      overwritten: output.existed,
    };
  } finally {
    await rm(tempPath, { force: true }).catch(() => undefined);
  }
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

async function fetchPaperPdf(initialUrl: URL, fetchImpl: typeof fetch, timeoutMs: number): Promise<Response> {
  let current = initialUrl;
  const signal = AbortSignal.timeout(timeoutMs);
  for (let redirects = 0; redirects <= 8; redirects += 1) {
    let response: Response;
    try {
      response = await fetchImpl(current, {
        method: "GET",
        headers: { accept: "application/pdf,application/octet-stream;q=0.8" },
        redirect: "manual",
        signal,
      });
    } catch (error) {
      throw new CliError(signal.aborted ? "The OA PDF download timed out." : "The OA PDF host could not be reached.", signal.aborted ? "NETWORK_TIMEOUT" : "NETWORK_ERROR", 1, {
        host: current.hostname,
        cause: error instanceof Error ? error.message : String(error),
      });
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new CliError("The OA PDF host returned a redirect without a destination.", "PAPER_DOWNLOAD_REDIRECT_INVALID", 1, { host: current.hostname });
      current = safePublicPdfUrl(new URL(location, current).toString());
      continue;
    }
    if (!response.ok) {
      throw new CliError("The OA PDF host returned an HTTP error.", "PAPER_DOWNLOAD_HTTP_ERROR", 1, { host: current.hostname, status: response.status });
    }
    return response;
  }
  throw new CliError("The OA PDF download redirected too many times.", "PAPER_DOWNLOAD_REDIRECT_LIMIT", 1, { host: initialUrl.hostname });
}

function safePublicPdfUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CliError("Unpaywall returned an invalid PDF URL.", "PAPER_DOWNLOAD_URL_INVALID", 1);
  }
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname || url.port) {
    throw new CliError("OA PDF downloads require a standard credential-free HTTPS URL.", "PAPER_DOWNLOAD_URL_UNSAFE", 1, { host: url.hostname });
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || privateIpLiteral(host)) {
    throw new CliError("The OA PDF URL points to a non-public host.", "PAPER_DOWNLOAD_URL_UNSAFE", 1, { host });
  }
  return url;
}

function privateIpLiteral(host: string): boolean {
  const literal = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (isIP(literal) === 4) {
    const [a, b] = literal.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  if (isIP(literal) === 6) {
    const normalized = literal.toLowerCase();
    return normalized === "::1"
      || normalized === "::"
      || normalized.startsWith("fc")
      || normalized.startsWith("fd")
      || /^fe[89ab]/.test(normalized)
      || normalized.startsWith("::ffff:127.")
      || normalized.startsWith("::ffff:10.")
      || normalized.startsWith("::ffff:192.168.");
  }
  return false;
}

async function inspectPaperDestination(destination: string, overwrite: boolean): Promise<{ destination: string; existed: boolean }> {
  const absolute = resolvePath(destination);
  const parent = dirname(absolute);
  let parentInfo;
  try {
    parentInfo = await stat(parent);
  } catch (error) {
    throw paperFileError("The OA PDF destination directory could not be accessed.", parent, error);
  }
  if (!parentInfo.isDirectory()) throw new CliError("The OA PDF destination parent must be a directory.", "PAPER_DOWNLOAD_DESTINATION_INVALID", 2, { destination: absolute });

  let existing;
  try {
    existing = await lstat(absolute);
  } catch (error) {
    if (nodeErrorCode(error) !== "ENOENT") throw paperFileError("The OA PDF destination could not be inspected.", absolute, error);
  }
  if (existing && !overwrite) throw new CliError("The OA PDF destination already exists; pass --overwrite to replace it.", "PAPER_DOWNLOAD_DESTINATION_EXISTS", 2, { destination: absolute });
  if (existing?.isSymbolicLink() || (existing && !existing.isFile())) throw new CliError("The OA PDF destination must be a regular file and must not be a symbolic link.", "PAPER_DOWNLOAD_DESTINATION_INVALID", 2, { destination: absolute });
  return { destination: absolute, existed: existing !== undefined };
}

async function streamPaperPdf(response: Response, tempPath: string, maxBytes: number): Promise<{ size: number; sha256: string; contentType: string }> {
  if (!response.body) throw new CliError("The OA PDF response did not include a body.", "PAPER_DOWNLOAD_EMPTY", 1);
  const rawLength = response.headers.get("content-length") ?? "";
  const expectedLength = /^\d+$/.test(rawLength) ? Number(rawLength) : undefined;
  if (expectedLength !== undefined && expectedLength > maxBytes) throw new CliError("The OA PDF exceeds the configured download limit.", "PAPER_DOWNLOAD_TOO_LARGE", 1, { expectedSize: expectedLength, maxBytes });
  const reader = response.body.getReader();
  const hash = createHash("sha256");
  const signature: number[] = [];
  let size = 0;
  let handle;
  try {
    handle = await open(tempPath, "wx", 0o600);
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) throw new CliError("The OA PDF exceeds the configured download limit.", "PAPER_DOWNLOAD_TOO_LARGE", 1, { actualSize: size, maxBytes });
      for (const byte of chunk.value) {
        if (signature.length >= 1024) break;
        signature.push(byte);
      }
      hash.update(chunk.value);
      let offset = 0;
      while (offset < chunk.value.byteLength) {
        const result = await handle.write(chunk.value, offset, chunk.value.byteLength - offset, null);
        if (result.bytesWritten <= 0) throw new Error("zero-byte file write");
        offset += result.bytesWritten;
      }
    }
    await handle.sync();
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof CliError) throw error;
    throw paperFileError("The OA PDF could not be written safely.", tempPath, error);
  } finally {
    await handle?.close().catch(() => undefined);
  }
  if (!String.fromCharCode(...signature).includes("%PDF-")) throw new CliError("The OA response was not a PDF file.", "PAPER_DOWNLOAD_NOT_PDF", 1, { contentType: response.headers.get("content-type") ?? "" });
  if (expectedLength !== undefined && !response.headers.get("content-encoding") && size !== expectedLength) throw new CliError("The OA PDF size did not match the server response.", "PAPER_DOWNLOAD_SIZE_MISMATCH", 1, { expectedSize: expectedLength, actualSize: size });
  return { size, sha256: hash.digest("hex"), contentType: (response.headers.get("content-type") ?? "application/pdf").split(";", 1)[0]!.trim() };
}

async function finishPaperDownload(tempPath: string, destination: string, overwrite: boolean): Promise<void> {
  if (overwrite) {
    try {
      await rename(tempPath, destination);
      return;
    } catch (error) {
      throw paperFileError("The OA PDF could not be moved into place.", destination, error);
    }
  }
  try {
    await link(tempPath, destination);
    return;
  } catch (error) {
    if (nodeErrorCode(error) === "EEXIST") throw paperDestinationAppeared(destination);
  }
  try {
    await copyFile(tempPath, destination, fileSystemConstants.COPYFILE_EXCL);
  } catch (error) {
    if (nodeErrorCode(error) === "EEXIST") throw paperDestinationAppeared(destination);
    throw paperFileError("The OA PDF could not be placed safely.", destination, error);
  }
}

function paperDestinationAppeared(destination: string): CliError {
  return new CliError("The OA PDF destination appeared while downloading; no file was overwritten.", "PAPER_DOWNLOAD_DESTINATION_EXISTS", 2, { destination });
}

function paperFileError(message: string, path: string, error: unknown): CliError {
  return new CliError(message, "PAPER_DOWNLOAD_FILE_ERROR", 2, { path, cause: error instanceof Error ? error.message : String(error) });
}

function nodeErrorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
}
