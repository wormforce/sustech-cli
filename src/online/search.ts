import { CliError } from "../core/errors.js";
import { searchOnlineContacts, contactSearchSnippet } from "./contact.js";
import {
  searchOnlineManualWithStatus,
  type OnlineManualSourceKey,
  type OnlineManualSourceStatus,
} from "./manual.js";
import { formatOnlineAdvisories, ONLINE_SITE_ORIGIN, scoreSearchMatch } from "./shared.js";
import { searchOnlineTalks, talkSearchSnippet } from "./talks.js";
import type { OnlineFetchOptions } from "./shared.js";
import type { OnlineSearchHit } from "./types.js";

export interface OnlineSearchOptions extends OnlineFetchOptions {
  limit?: number;
  section?: "talks" | "contact" | "manual";
  source?: OnlineManualSourceKey | readonly OnlineManualSourceKey[];
  since?: string;
  until?: string;
}

export interface OnlineSearchReport {
  hits: OnlineSearchHit[];
  partial: boolean;
  manualSourceStatuses: OnlineManualSourceStatus[];
  manualMatchedTotal?: number;
}

export async function searchOnline(query: string, options: OnlineSearchOptions = {}): Promise<OnlineSearchHit[]> {
  return (await searchOnlineWithStatus(query, options)).hits;
}

export async function searchOnlineWithStatus(
  query: string,
  options: OnlineSearchOptions = {},
): Promise<OnlineSearchReport> {
  const withoutLimit = { ...options, limit: undefined };
  const [talks, contacts, manualReport] = await Promise.all([
    options.section === "contact" || options.section === "manual" ? Promise.resolve([]) : searchOnlineTalks(query, withoutLimit),
    options.section === "talks" || options.section === "manual" ? Promise.resolve([]) : searchOnlineContacts(query, withoutLimit),
    options.section === "manual"
      ? searchOnlineManualWithStatus(query, {
        ...withoutLimit,
        ...(options.source === undefined ? {} : { source: options.source }),
      })
      : Promise.resolve({ records: [], matchedTotal: 0, sourceStatuses: [], partial: false }),
  ]);
  const candidates: Array<{ hit: OnlineSearchHit; extraSearchText?: string }> = [
    ...talks.map((talk) => ({
      hit: {
        kind: "talk" as const,
        id: talk.id,
        title: talk.title,
        subtitle: [talk.date, talk.timeText, talk.speakerLine].filter(Boolean).join(" · "),
        snippet: talkSearchSnippet(talk),
        url: talk.detailUrl,
        provenance: talk.provenance,
      },
    })),
    ...contacts.map((contact) => ({
      hit: {
        kind: "contact" as const,
        id: contact.id,
        title: contact.name,
        subtitle: contact.category,
        snippet: contactSearchSnippet(contact),
        url: contact.websiteUrl,
        provenance: contact.provenance,
      },
    })),
    ...manualReport.records.map((record) => ({
      hit: {
        kind: "manual" as const,
        id: record.id,
        title: record.title,
        subtitle: `${record.sourceTitle} · ${record.sectionPath}`,
        snippet: record.summary,
        url: preferredManualResultUrl(record),
        provenance: record.provenance,
      },
      extraSearchText: `${record.content} ${record.links.map((link) => link.text).join(" ")}`,
    })),
  ];
  const ranked = candidates
    .map(({ hit, extraSearchText }) => ({
      hit,
      score: scoreSearchMatch(query, [
        { value: hit.title, weight: 10 },
        { value: hit.subtitle, weight: 7 },
        { value: hit.snippet, weight: 3 },
        { value: extraSearchText, weight: 2 },
      ]),
    }))
    .sort((left, right) => right.score - left.score || left.hit.title.localeCompare(right.hit.title, "zh-Hans-CN"))
    .map((entry) => entry.hit);
  const hits = options.limit === undefined ? ranked : ranked.slice(0, validatedOnlineLimit(options.limit));
  return {
    hits,
    partial: manualReport.partial,
    manualSourceStatuses: manualReport.sourceStatuses,
    ...(options.section === "manual" ? { manualMatchedTotal: manualReport.matchedTotal } : {}),
  };
}

function preferredManualResultUrl(record: {
  pageUrl: string;
  links: readonly { url: string }[];
}): string {
  for (const link of record.links) {
    try {
      const url = new URL(link.url);
      if (url.origin === ONLINE_SITE_ORIGIN) return url.toString();
    } catch {
      continue;
    }
  }
  return record.pageUrl;
}

function validatedOnlineLimit(limit: number): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
    throw new CliError("Online search limits must be integers from 1 to 200.", "USAGE", 2);
  }
  return limit;
}

export function formatOnlineSearchHits(
  hits: readonly OnlineSearchHit[],
  query: string,
  options: { partial?: boolean; manualSourceStatuses?: readonly OnlineManualSourceStatus[] } = {},
): string {
  const incomplete = options.manualSourceStatuses?.filter((status) => status.status !== "ok") ?? [];
  const statusLine = options.partial
    ? `\n\nPartial result: ${incomplete.length} manual source(s) were unavailable or no longer matched the allowlist.`
    : "";
  if (hits.length === 0) {
    return `SUSTech Online search · ${query}\n\nNo matching public community-maintained records.${statusLine}`;
  }
  const blocks = hits.map((hit, index) => [
    `${index + 1}. [${hit.kind}] ${hit.title}`,
    hit.subtitle ? `   ${hit.subtitle}` : "",
    `   ${hit.snippet}`,
    `   Source: ${hit.provenance.sourceRepoPath} · ${hit.provenance.license}`,
    `   Advisories: ${formatOnlineAdvisories(hit.provenance.advisories)}`,
  ].filter(Boolean).join("\n"));
  return `SUSTech Online search · ${query}\n\n${blocks.join("\n\n")}\n\n${hits.length} hit(s).${statusLine}`;
}
