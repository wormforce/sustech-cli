import { CliError } from "../core/errors.js";
import { USER_AGENT } from "../core/version.js";
import {
  collapseWhitespace,
  createFetchAdapter,
  sampleText,
  ServiceError,
  type ServiceAdapter,
} from "../services/base.js";
import type { OnlineAdvisory, OnlineProvenance } from "./types.js";

export const ONLINE_SITE_ORIGIN = "https://sustech.online";
export const ONLINE_REPO_OWNER = "SUSTech-CRA";
export const ONLINE_REPO_NAME = "sustech-online-ng";
export const ONLINE_REPO_BRANCH = "master";
export const ONLINE_RAW_ORIGIN = "https://raw.githubusercontent.com";
export const ONLINE_TALKS_INDEX_REPO_PATH = "docs/study/talks/README.md";
export const ONLINE_TALKS_DIRECTORY_REPO_PATH = "docs/study/talks";
export const ONLINE_CONTACT_REPO_PATH = "docs/contact/README.md";
export const ONLINE_TALKS_INDEX_SITE_PATH = "/study/talks/";
export const ONLINE_CONTACT_SITE_PATH = "/contact/";
export const ONLINE_DEFAULT_TIMEOUT_MS = 15_000;
export const ONLINE_DEFAULT_STALE_AFTER_DAYS = 365;
export const ONLINE_MAX_DOCUMENT_BYTES = 1_000_000;

export interface OnlineFetchOptions {
  adapter?: ServiceAdapter;
  fetchedAt?: string;
  staleAfterDays?: number;
  timeoutMs?: number;
}

export interface OnlineMarkdownDocument {
  markdown: string;
  pageUpdatedAt?: string;
  pageMetadataAvailable: boolean;
  fetchedAt: string;
}

interface SearchField {
  value?: string;
  weight: number;
}

export function createOnlineAdapter(fetchImpl: typeof fetch = globalThis.fetch): ServiceAdapter {
  return createFetchAdapter(fetchImpl, "sustech-online");
}

export async function fetchOnlineMarkdownDocument(
  repoPath: string,
  sitePath: string,
  options: OnlineFetchOptions = {},
): Promise<OnlineMarkdownDocument> {
  assertAllowedOnlineRepoPath(repoPath);
  assertAllowedOnlineSitePath(sitePath);
  const adapter = options.adapter ?? createOnlineAdapter();
  const [markdownResult, pageResult] = await Promise.allSettled([
    fetchAllowlistedText(adapter, onlineRawUrl(repoPath), { timeoutMs: options.timeoutMs, kind: "raw" }),
    fetchAllowlistedText(adapter, onlineSiteUrl(sitePath), { timeoutMs: options.timeoutMs, kind: "site" }),
  ]);
  if (markdownResult.status === "rejected") throw markdownResult.reason;
  const pageHtml = pageResult.status === "fulfilled" ? pageResult.value : undefined;
  return {
    markdown: stripBom(markdownResult.value),
    ...(pageHtml ? { pageUpdatedAt: extractLastUpdatedFromHtml(pageHtml) } : {}),
    pageMetadataAvailable: pageResult.status === "fulfilled",
    fetchedAt: options.fetchedAt ?? new Date().toISOString(),
  };
}

export function buildOnlineProvenance(
  sourceUrl: string,
  sourceRepoPath: string,
  fetchedAt: string,
  sourceUpdatedAt?: string,
  staleAfterDays = ONLINE_DEFAULT_STALE_AFTER_DAYS,
  options: { aiProcessed?: boolean; sourceMetadataAvailable?: boolean } = {},
): OnlineProvenance {
  const advisories: OnlineAdvisory[] = ["COMMUNITY_MAINTAINED"];
  if (options.aiProcessed) advisories.push("AI_PROCESSED_SOURCE");
  if (options.sourceMetadataAvailable === false || !sourceUpdatedAt) advisories.push("SOURCE_UPDATE_UNKNOWN");
  if (isStaleSource(sourceUpdatedAt, fetchedAt, staleAfterDays)) advisories.push("STALE_SOURCE");
  return {
    authority: "community",
    sourceUrl,
    sourceRepoPath,
    ...(sourceUpdatedAt ? { sourceUpdatedAt } : {}),
    fetchedAt,
    license: "CC-BY-SA-4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    advisories,
  };
}

export function onlineRawUrl(repoPath: string): string {
  assertAllowedOnlineRepoPath(repoPath);
  const segments = repoPath.split("/").map((segment) => encodeURIComponent(segment));
  return `${ONLINE_RAW_ORIGIN}/${ONLINE_REPO_OWNER}/${ONLINE_REPO_NAME}/${ONLINE_REPO_BRANCH}/${segments.join("/")}`;
}

export function onlineSiteUrl(sitePath: string): string {
  assertAllowedOnlineSitePath(sitePath);
  return new URL(sitePath, ONLINE_SITE_ORIGIN).toString();
}

export function talkRepoPathFromSlug(slug: string): string {
  return `${ONLINE_TALKS_DIRECTORY_REPO_PATH}/${normaliseTalkSlug(slug)}.md`;
}

export function talkSitePathFromSlug(slug: string): string {
  return `${ONLINE_TALKS_INDEX_SITE_PATH}${encodeURIComponent(normaliseTalkSlug(slug))}.html`;
}

export function normaliseTalkSlug(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new CliError("A talks slug is required.", "USAGE", 2);
  let slug = trimmed;
  try {
    const url = new URL(trimmed);
    slug = decodeURIComponent(url.pathname.split("/").pop() ?? "");
  } catch {
    try {
      slug = decodeURIComponent(trimmed.split("/").pop() ?? trimmed);
    } catch {
      throw new CliError("Talk slugs contain invalid percent encoding.", "ONLINE_SOURCE_NOT_ALLOWED", 2, {
        slug: trimmed,
      });
    }
  }
  slug = slug.replace(/\.(?:md|html)$/iu, "");
  if (!slug || /[/\\?#\p{Control}]/u.test(slug)) {
    throw new CliError("Talk slugs must resolve to exactly one file name.", "ONLINE_SOURCE_NOT_ALLOWED", 2, {
      slug: trimmed,
    });
  }
  if (slug === "." || slug === ".." || slug.includes("\0")) {
    throw new CliError("Talk slugs contain unsupported path characters.", "ONLINE_SOURCE_NOT_ALLOWED", 2, {
      slug: trimmed,
    });
  }
  return slug;
}

export function parseTalkLabel(label: string): {
  title: string;
  series?: string;
  speakerLine?: string;
  speakerName?: string;
  speakerAffiliation?: string;
} {
  const cleanLabel = collapseWhitespace(stripMarkdown(label));
  const separatorIndex = findTalkSeparator(cleanLabel);
  if (separatorIndex < 0) return { title: cleanLabel };
  const left = cleanLabel.slice(0, separatorIndex).trim();
  const right = cleanLabel.slice(separatorIndex + 1).trim();
  const lastQuote = left.lastIndexOf("》");
  const series = left.startsWith("《") && lastQuote >= 0 ? left.slice(0, lastQuote + 1).trim() : undefined;
  const speakerLine = (series ? left.slice(lastQuote + 1) : left).trim() || undefined;
  const { name, affiliation } = splitSpeakerLine(speakerLine);
  return {
    title: right || cleanLabel,
    ...(series ? { series } : {}),
    ...(speakerLine ? { speakerLine } : {}),
    ...(name ? { speakerName: name } : {}),
    ...(affiliation ? { speakerAffiliation: affiliation } : {}),
  };
}

export function splitSpeakerLine(value?: string): { name?: string; affiliation?: string } {
  if (!value) return {};
  const line = collapseWhitespace(stripMarkdown(value));
  const divider = line.indexOf(" @ ");
  if (divider < 0) return { name: line };
  const name = line.slice(0, divider).trim();
  const affiliation = line.slice(divider + 3).trim();
  return {
    ...(name ? { name } : {}),
    ...(affiliation ? { affiliation } : {}),
  };
}

export function normaliseSearchText(value: string): string {
  return collapseWhitespace(stripMarkdown(value)).toLocaleLowerCase("en-US");
}

export function scoreSearchMatch(query: string, fields: readonly SearchField[]): number {
  const needle = normaliseSearchText(query);
  if (!needle) return 0;
  const terms = needle.split(" ").filter(Boolean);
  const combined = fields
    .map((field) => normaliseSearchText(field.value ?? ""))
    .filter(Boolean)
    .join(" ");
  if (!combined) return 0;
  if (!combined.includes(needle) && terms.some((term) => !combined.includes(term))) return 0;
  let score = combined.includes(needle) ? 2_000 - Math.min(combined.indexOf(needle), 999) : 0;
  for (const field of fields) {
    const haystack = normaliseSearchText(field.value ?? "");
    if (!haystack) continue;
    if (haystack.includes(needle)) score += field.weight * (1_000 - Math.min(haystack.indexOf(needle), 999));
    for (const term of terms) {
      const index = haystack.indexOf(term);
      if (index >= 0) score += field.weight * (150 - Math.min(index, 149));
    }
  }
  return score;
}

export function stripMarkdown(value: string): string {
  return collapseWhitespace(
    value
      .replace(/!\[[^\x5d]*\x5d\(([^)]+)\)/gu, " $1 ")
      .replace(/\[([^\x5d]+)\x5d\(([^)]+)\)/gu, "$1")
      .replace(/`([^`]+)`/gu, "$1")
      .replace(/[*_~>#]/gu, " ")
      .replace(/<Badge[^>]*\/>/gu, " ")
      .replace(/:::.+$/gmu, " ")
      .replace(/^\s*[-*+]\s+/gmu, " ")
      .replace(/\|/gu, " ")
      .replace(/<\/?[^>]+>/gu, " "),
  );
}

export function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values.map((entry) => collapseWhitespace(entry)).filter(Boolean)) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

export function extractEmails(value: string): string[] {
  return uniqueStrings(value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu) ?? []);
}

export function extractPhones(value: string): string[] {
  return uniqueStrings(value.match(/(?:\d{3}-\d{3,4}-\d{4}(?:-\d)?|\d{8,11})/gu) ?? []);
}

export function extractMarkdownLink(value: string): { text: string; url: string } | undefined {
  const match = /\[([^\]]+)\]\(([^)]+)\)/u.exec(value);
  return match ? { text: collapseWhitespace(match[1]), url: match[2].trim() } : undefined;
}

export function makeOnlineId(prefix: string, value: string): string {
  return `${prefix}:${collapseWhitespace(value)
    .toLocaleLowerCase("en-US")
    .replace(/\s+/gu, "-")
    .replace(/[^\p{Letter}\p{Number}-]/gu, "")}`;
}

export function formatOnlineAdvisories(advisories: readonly OnlineAdvisory[]): string {
  return advisories.join(", ");
}

function assertAllowedOnlineRepoPath(repoPath: string): void {
  if (repoPath === ONLINE_TALKS_INDEX_REPO_PATH || repoPath === ONLINE_CONTACT_REPO_PATH) return;
  if (repoPath.startsWith(`${ONLINE_TALKS_DIRECTORY_REPO_PATH}/`) && repoPath.endsWith(".md")) {
    const relative = repoPath.slice(`${ONLINE_TALKS_DIRECTORY_REPO_PATH}/`.length);
    if (relative && !relative.includes("/")) return;
  }
  throw new CliError("The requested SUSTech Online source is outside the allowlist.", "ONLINE_SOURCE_NOT_ALLOWED", 2, {
    sourceRepoPath: repoPath,
  });
}

function assertAllowedOnlineSitePath(sitePath: string): void {
  if (sitePath === ONLINE_TALKS_INDEX_SITE_PATH || sitePath === ONLINE_CONTACT_SITE_PATH) return;
  if (sitePath.startsWith(ONLINE_TALKS_INDEX_SITE_PATH) && sitePath.endsWith(".html")) {
    const relative = sitePath.slice(ONLINE_TALKS_INDEX_SITE_PATH.length);
    if (relative && !relative.includes("/")) return;
  }
  throw new CliError("The requested SUSTech Online page is outside the allowlist.", "ONLINE_SOURCE_NOT_ALLOWED", 2, {
    sourceUrl: sitePath,
  });
}

function extractLastUpdatedFromHtml(html: string): string | undefined {
  const match = /<time[^>]+datetime="([^"]+)"/iu.exec(html);
  const value = match?.[1]?.trim();
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

function isStaleSource(sourceUpdatedAt: string | undefined, fetchedAt: string, staleAfterDays: number): boolean {
  if (!sourceUpdatedAt) return false;
  const updatedAtMs = Date.parse(sourceUpdatedAt);
  const fetchedAtMs = Date.parse(fetchedAt);
  if (!Number.isFinite(updatedAtMs) || !Number.isFinite(fetchedAtMs)) return false;
  return fetchedAtMs - updatedAtMs >= staleAfterDays * 24 * 60 * 60 * 1000;
}

function findTalkSeparator(value: string): number {
  const chinese = value.indexOf("：");
  if (chinese >= 0) return chinese;
  const ascii = value.indexOf(":");
  return ascii;
}

function stripBom(value: string): string {
  return value.replace(/^\uFEFF/u, "");
}

async function fetchAllowlistedText(
  adapter: ServiceAdapter,
  url: string,
  options: { timeoutMs?: number; kind: "raw" | "site" },
): Promise<string> {
  let response: Response;
  try {
    response = await adapter.fetch(url, {
      headers: {
        accept: options.kind === "raw" ? "text/markdown, text/plain;q=0.9, */*;q=0.1" : "text/html, */*;q=0.1",
        "user-agent": USER_AGENT,
      },
      redirect: "error",
      signal: AbortSignal.timeout(options.timeoutMs ?? ONLINE_DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    throw new ServiceError("Could not reach the SUSTech Online source.", {
      url,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  validateFetchedUrl(response.url || url, url, options.kind);
  const advertisedLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(advertisedLength) && advertisedLength > ONLINE_MAX_DOCUMENT_BYTES) {
    throw new ServiceError("SUSTech Online returned an oversized document.", {
      url,
      status: response.status,
    });
  }
  const bytes = await readBoundedOnlineBody(response, url);
  const text = new TextDecoder().decode(bytes);
  if (!response.ok) {
    throw new ServiceError("SUSTech Online returned an HTTP error.", {
      url,
      status: response.status,
      bodySample: sampleText(text),
    });
  }
  return text;
}

async function readBoundedOnlineBody(response: Response, url: string): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > ONLINE_MAX_DOCUMENT_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new ServiceError("SUSTech Online returned an oversized document.", {
          url,
          status: response.status,
        });
      }
      chunks.push(chunk.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function validateFetchedUrl(value: string, expected: string, kind: "raw" | "site"): void {
  const url = new URL(value);
  const expectedUrl = new URL(expected);
  if (url.href !== expectedUrl.href) {
    throw new CliError("The fetched SUSTech Online source escaped its exact allowlist target.", "ONLINE_SOURCE_NOT_ALLOWED", 2, {
      sourceUrl: value,
    });
  }
  if (kind === "raw") {
    const expectedPrefix = `/${ONLINE_REPO_OWNER}/${ONLINE_REPO_NAME}/${ONLINE_REPO_BRANCH}/docs/`;
    if (url.origin !== ONLINE_RAW_ORIGIN || !url.pathname.startsWith(expectedPrefix)) {
      throw new CliError("The fetched SUSTech Online source escaped the raw allowlist.", "ONLINE_SOURCE_NOT_ALLOWED", 2, {
        sourceUrl: value,
      });
    }
    return;
  }
  if (url.origin !== ONLINE_SITE_ORIGIN) {
    throw new CliError("The fetched SUSTech Online page escaped the site allowlist.", "ONLINE_SOURCE_NOT_ALLOWED", 2, {
      sourceUrl: value,
    });
  }
  assertAllowedOnlineSitePath(url.pathname);
}
