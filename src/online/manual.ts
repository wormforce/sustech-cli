import { CliError } from "../core/errors.js";
import { USER_AGENT } from "../core/version.js";
import { collapseWhitespace, createFetchAdapter, sampleText, ServiceError, type ServiceAdapter } from "../services/base.js";
import {
  buildOnlineProvenance,
  makeOnlineId,
  ONLINE_DEFAULT_STALE_AFTER_DAYS,
  ONLINE_DEFAULT_TIMEOUT_MS,
  ONLINE_MAX_DOCUMENT_BYTES,
  ONLINE_RAW_ORIGIN,
  ONLINE_REPO_BRANCH,
  ONLINE_REPO_NAME,
  ONLINE_REPO_OWNER,
  ONLINE_SITE_ORIGIN,
  scoreSearchMatch,
  type OnlineFetchOptions,
} from "./shared.js";
import type { OnlineProvenance } from "./types.js";

export type OnlineManualSourceKey = "calendar" | "facility" | "life" | "service" | "study" | "transport";
export type OnlineManualSourceState = "error" | "invalid" | "ok";

export interface OnlineManualLink {
  text: string;
  url: string;
}

export interface OnlineManualRecord {
  kind: "manual";
  id: string;
  sourceKey: OnlineManualSourceKey;
  sourceTitle: string;
  title: string;
  headingPath: string[];
  sectionPath: string;
  sectionLevel: number;
  pageUrl: string;
  pageRepoPath: string;
  summary: string;
  content: string;
  links: OnlineManualLink[];
  provenance: OnlineProvenance;
}

export interface OnlineManualSourceStatus {
  sourceKey: OnlineManualSourceKey;
  sourceTitle: string;
  sourceRepoPath: string;
  sourceUrl: string;
  status: OnlineManualSourceState;
  fetchedAt: string;
  sourceUpdatedAt?: string;
  pageMetadataAvailable: boolean;
  recordCount: number;
  message?: string;
}

export interface OnlineManualCorpus {
  records: OnlineManualRecord[];
  sourceStatuses: OnlineManualSourceStatus[];
}

export interface OnlineManualSearchReport {
  records: OnlineManualRecord[];
  matchedTotal: number;
  sourceStatuses: OnlineManualSourceStatus[];
  partial: boolean;
}

export interface OnlineManualListReport {
  records: OnlineManualRecord[];
  matchedTotal: number;
  sourceStatuses: OnlineManualSourceStatus[];
  partial: boolean;
}

export interface OnlineManualGetReport {
  record: OnlineManualRecord;
  sourceStatuses: OnlineManualSourceStatus[];
  partial: boolean;
}

export interface OnlineManualQueryOptions extends OnlineFetchOptions {
  limit?: number;
  source?: OnlineManualSourceKey | readonly OnlineManualSourceKey[];
}

interface ManualSourceDefinition {
  key: OnlineManualSourceKey;
  title: string;
  repoPath: string;
  sitePath: string;
  include(section: ParsedManualSection): boolean;
}

interface ParsedManualSection {
  level: number;
  title: string;
  path: string[];
  bodyMarkdown: string;
}

interface OnlineManualMarkdownDocument {
  markdown: string;
  pageUpdatedAt?: string;
  pageMetadataAvailable: boolean;
  fetchedAt: string;
}

interface LoadedSource {
  definition: ManualSourceDefinition;
  document?: OnlineManualMarkdownDocument;
  error?: Error;
}

const ONLINE_MANUAL_SOURCES: readonly ManualSourceDefinition[] = [
  {
    key: "service",
    title: "服务与技巧",
    repoPath: "docs/service/README.md",
    sitePath: "/service/",
    include(section): boolean {
      return matchesSectionTitle(section.title, [
        "学号",
        "校园卡&学生证",
        "校园网络",
        "Ehall",
        "计算机研究协会（CRA）",
        "牛娃小镇",
        "Sakai",
        "联创打印系统",
        "BlackBoard",
        "电子邮件服务",
        "企业微信",
        "📦邮件与快递收发",
        "学校已购买的软件与服务",
        "教育邮箱福利",
        "讨论间",
        "电子数据库",
        "图书馆荐购",
        "教工/学生邮箱的报刊减免",
        "文档模版",
      ]);
    },
  },
  {
    key: "study",
    title: "学在南科",
    repoPath: "docs/study/README.md",
    sitePath: "/study/",
    include(section): boolean {
      return matchesSectionTitle(section.title, [
        "讲座信息",
        "学号（SID）",
        "课程详述",
        "📖学习建议与攻略",
        "毕业生质量报告",
        "GPA换算表（本科）",
        "GPA换算表（研究生）",
        "学生手册",
        "培养方案（本科）",
        "📗教材与图书借还",
      ]);
    },
  },
  {
    key: "transport",
    title: "交通",
    repoPath: "docs/transport/README.md",
    sitePath: "/transport/",
    include(section): boolean {
      return matchesSectionTitle(section.title, [
        "🚌校园巴士",
        "来往南方科技大学的交通",
        "市内交通",
        "🗺抵达南方科技大学",
        "来往附近城市的交通",
      ]);
    },
  },
  {
    key: "life",
    title: "生活在南科",
    repoPath: "docs/life/README.md",
    sitePath: "/life/",
    include(section): boolean {
      return matchesSectionTitle(section.title, [
        "住宿",
        "校内介绍",
        "超市",
        "理发店",
        "🏊‍♀️运动设施",
        "Tips",
      ]);
    },
  },
  {
    key: "facility",
    title: "建筑与设施",
    repoPath: "docs/facility/README.md",
    sitePath: "/facility/",
    include(section): boolean {
      return matchesSectionTitle(section.title, [
        "校园街景",
        "校园地图与主要建筑",
        "琳恩图书馆",
        "行政楼",
        "第一教学楼",
        "第三教学楼",
        "湖畔宿舍群",
        "游泳馆",
        "二期宿舍",
        "工学院",
      ]);
    },
  },
  {
    key: "calendar",
    title: "校历",
    repoPath: "docs/calendar/README.md",
    sitePath: "/calendar/",
    include(section): boolean {
      return section.level === 2;
    },
  },
];

const ONLINE_MANUAL_SOURCE_MAP = new Map(ONLINE_MANUAL_SOURCES.map((source) => [source.key, source]));
const ONLINE_MANUAL_REPO_PATHS = new Set(ONLINE_MANUAL_SOURCES.map((source) => source.repoPath));
const ONLINE_MANUAL_SITE_PATHS = new Set(ONLINE_MANUAL_SOURCES.map((source) => source.sitePath));
const ONLINE_MANUAL_LINK_LIMIT = 8;

export const ONLINE_MANUAL_ENDPOINTS = ONLINE_MANUAL_SOURCES.flatMap((source) => [
  onlineManualRawUrl(source.repoPath),
  onlineManualSiteUrl(source.sitePath),
]);

export function createOnlineManualAdapter(fetchImpl: typeof fetch = globalThis.fetch): ServiceAdapter {
  return createFetchAdapter(fetchImpl, "sustech-online-manual");
}

export function onlineManualRawUrl(repoPath: string): string {
  assertAllowedManualRepoPath(repoPath);
  const segments = repoPath.split("/").map((segment) => encodeURIComponent(segment));
  return `${ONLINE_RAW_ORIGIN}/${ONLINE_REPO_OWNER}/${ONLINE_REPO_NAME}/${ONLINE_REPO_BRANCH}/${segments.join("/")}`;
}

export function onlineManualSiteUrl(sitePath: string): string {
  assertAllowedManualSitePath(sitePath);
  return new URL(sitePath, ONLINE_SITE_ORIGIN).toString();
}

export async function loadOnlineManualCorpus(options: OnlineManualQueryOptions = {}): Promise<OnlineManualCorpus> {
  const sources = resolveManualSources(options.source);
  const loaded = await Promise.all(
    sources.map(async (definition): Promise<LoadedSource> => {
      try {
        const document = await fetchOnlineManualMarkdownDocument(definition, options);
        return { definition, document };
      } catch (error) {
        return { definition, error: error instanceof Error ? error : new Error(String(error)) };
      }
    }),
  );
  const records: OnlineManualRecord[] = [];
  const sourceStatuses: OnlineManualSourceStatus[] = [];
  for (const source of loaded) {
    const fetchedAt = source.document?.fetchedAt ?? options.fetchedAt ?? new Date().toISOString();
    if (source.error) {
      sourceStatuses.push({
        sourceKey: source.definition.key,
        sourceTitle: source.definition.title,
        sourceRepoPath: source.definition.repoPath,
        sourceUrl: onlineManualSiteUrl(source.definition.sitePath),
        status: "error",
        fetchedAt,
        pageMetadataAvailable: false,
        recordCount: 0,
        message: source.error.message,
      });
      continue;
    }
    try {
      const parsed = parseOnlineManualSource(source.definition, source.document!, {
        staleAfterDays: options.staleAfterDays,
      });
      records.push(...parsed.records);
      sourceStatuses.push(parsed.status);
    } catch (error) {
      sourceStatuses.push({
        sourceKey: source.definition.key,
        sourceTitle: source.definition.title,
        sourceRepoPath: source.definition.repoPath,
        sourceUrl: onlineManualSiteUrl(source.definition.sitePath),
        status: "error",
        fetchedAt,
        pageMetadataAvailable: source.document?.pageMetadataAvailable ?? false,
        recordCount: 0,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return {
    records: records.sort(compareManualRecords),
    sourceStatuses,
  };
}

export async function listOnlineManualRecords(options: OnlineManualQueryOptions = {}): Promise<OnlineManualRecord[]> {
  return (await listOnlineManualRecordsWithStatus(options)).records;
}

export async function listOnlineManualRecordsWithStatus(
  options: OnlineManualQueryOptions = {},
): Promise<OnlineManualListReport> {
  const corpus = await loadOnlineManualCorpus({ ...options, limit: undefined });
  ensureManualCorpusUsable(corpus);
  return {
    records: applyManualLimit(corpus.records, options.limit),
    matchedTotal: corpus.records.length,
    sourceStatuses: corpus.sourceStatuses,
    partial: corpus.sourceStatuses.some((status) => status.status !== "ok"),
  };
}

export async function searchOnlineManual(query: string, options: OnlineManualQueryOptions = {}): Promise<OnlineManualRecord[]> {
  return (await searchOnlineManualWithStatus(query, options)).records;
}

export async function searchOnlineManualWithStatus(
  query: string,
  options: OnlineManualQueryOptions = {},
): Promise<OnlineManualSearchReport> {
  const needle = query.trim();
  if (!needle) throw new CliError("A search query is required.", "USAGE", 2);
  const corpus = await loadOnlineManualCorpus({ ...options, limit: undefined });
  ensureManualCorpusUsable(corpus);
  const ranked = corpus.records
    .map((record) => ({
      record,
      score: scoreSearchMatch(needle, [
        { value: record.id, weight: 8 },
        { value: record.title, weight: 10 },
        { value: record.sectionPath, weight: 7 },
        { value: record.summary, weight: 5 },
        { value: record.content, weight: 2 },
        { value: record.links.map((link) => link.text).join(" "), weight: 3 },
      ]),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || compareManualRecords(left.record, right.record))
    .map((entry) => entry.record);
  return {
    records: applyManualLimit(ranked, options.limit),
    matchedTotal: ranked.length,
    sourceStatuses: corpus.sourceStatuses,
    partial: corpus.sourceStatuses.some((status) => status.status !== "ok"),
  };
}

export async function getOnlineManualRecord(identifier: string, options: OnlineManualQueryOptions = {}): Promise<OnlineManualRecord> {
  return (await getOnlineManualRecordWithStatus(identifier, options)).record;
}

export async function getOnlineManualRecordWithStatus(
  identifier: string,
  options: OnlineManualQueryOptions = {},
): Promise<OnlineManualGetReport> {
  const needle = identifier.trim();
  if (!needle) throw new CliError("A manual record id or exact title is required.", "USAGE", 2);
  const corpus = await loadOnlineManualCorpus({ ...options, limit: undefined });
  ensureManualCorpusUsable(corpus);
  const exactId = corpus.records.find((record) => record.id === needle);
  if (exactId) {
    return {
      record: exactId,
      sourceStatuses: corpus.sourceStatuses,
      partial: corpus.sourceStatuses.some((status) => status.status !== "ok"),
    };
  }
  const exactSectionPath = corpus.records.find((record) => record.sectionPath === needle);
  if (exactSectionPath) {
    return {
      record: exactSectionPath,
      sourceStatuses: corpus.sourceStatuses,
      partial: corpus.sourceStatuses.some((status) => status.status !== "ok"),
    };
  }
  const titleMatches = corpus.records.filter((record) => record.title === needle);
  if (titleMatches.length === 1) {
    return {
      record: titleMatches[0]!,
      sourceStatuses: corpus.sourceStatuses,
      partial: corpus.sourceStatuses.some((status) => status.status !== "ok"),
    };
  }
  if (titleMatches.length > 1) {
    throw new CliError(
      "Multiple public SUSTech Online manual records matched that exact title; use the deterministic id or full section path instead.",
      "ONLINE_MANUAL_LOOKUP_AMBIGUOUS",
      1,
      {
        query: needle,
        matches: titleMatches.map((record) => ({
          id: record.id,
          sourceKey: record.sourceKey,
          sectionPath: record.sectionPath,
        })),
      },
    );
  }
  const incomplete = corpus.sourceStatuses.filter((status) => status.status !== "ok");
  if (incomplete.length > 0) {
    throw new CliError(
      "The SUSTech Online manual lookup was incomplete; one or more allowlisted sources could not be verified.",
      "ONLINE_MANUAL_LOOKUP_INCOMPLETE",
      1,
      { query: needle, sources: incomplete.map((status) => ({ sourceKey: status.sourceKey, status: status.status })) },
    );
  }
  throw new CliError("No public SUSTech Online manual record matched that exact id or title.", "ONLINE_MANUAL_NOT_FOUND", 1, {
    query: needle,
  });
}

function ensureManualCorpusUsable(corpus: OnlineManualCorpus): void {
  if (corpus.sourceStatuses.some((status) => status.status === "ok")) return;
  throw new CliError("No allowlisted SUSTech Online manual source could be read and parsed safely.", "ONLINE_MANUAL_UNAVAILABLE", 1, {
    sources: corpus.sourceStatuses.map((status) => ({ sourceKey: status.sourceKey, status: status.status })),
  });
}

export function parseOnlineManualSource(
  definition: Pick<ManualSourceDefinition, "include" | "key" | "repoPath" | "sitePath" | "title">,
  document: OnlineManualMarkdownDocument,
  options: { staleAfterDays?: number } = {},
): { records: OnlineManualRecord[]; status: OnlineManualSourceStatus } {
  const sections = parseManualSections(document.markdown);
  const provenance = buildOnlineProvenance(
    onlineManualSiteUrl(definition.sitePath),
    definition.repoPath,
    document.fetchedAt,
    document.pageUpdatedAt,
    options.staleAfterDays ?? ONLINE_DEFAULT_STALE_AFTER_DAYS,
    { aiProcessed: false, sourceMetadataAvailable: document.pageMetadataAvailable },
  );
  const records = sections
    .filter((section) => definition.include(section))
    .map((section) => sectionToManualRecord(definition, section, provenance))
    .filter((record): record is OnlineManualRecord => record !== undefined)
    .sort(compareManualRecords);
  const status: OnlineManualSourceStatus = {
    sourceKey: definition.key,
    sourceTitle: definition.title,
    sourceRepoPath: definition.repoPath,
    sourceUrl: onlineManualSiteUrl(definition.sitePath),
    status: records.length > 0 ? "ok" : "invalid",
    fetchedAt: document.fetchedAt,
    ...(document.pageUpdatedAt ? { sourceUpdatedAt: document.pageUpdatedAt } : {}),
    pageMetadataAvailable: document.pageMetadataAvailable,
    recordCount: records.length,
    ...(records.length === 0 ? { message: "No allowlisted manual sections were parsed from this source." } : {}),
  };
  return { records, status };
}

async function fetchOnlineManualMarkdownDocument(
  definition: Pick<ManualSourceDefinition, "repoPath" | "sitePath">,
  options: OnlineFetchOptions = {},
): Promise<OnlineManualMarkdownDocument> {
  assertAllowedManualRepoPath(definition.repoPath);
  assertAllowedManualSitePath(definition.sitePath);
  const adapter = options.adapter ?? createOnlineManualAdapter();
  const [markdownResult, pageResult] = await Promise.allSettled([
    fetchAllowlistedManualText(adapter, onlineManualRawUrl(definition.repoPath), { timeoutMs: options.timeoutMs, kind: "raw" }),
    fetchAllowlistedManualText(adapter, onlineManualSiteUrl(definition.sitePath), { timeoutMs: options.timeoutMs, kind: "site" }),
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

function parseManualSections(markdown: string): ParsedManualSection[] {
  const lines = stripBom(markdown).replace(/\r\n?/gu, "\n").split("\n");
  const headings: Array<{ index: number; level: number; title: string; path: string[] }> = [];
  const stack: Array<{ level: number; title: string }> = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(#{2,4})\s+(.+)$/u.exec(lines[index] ?? "");
    if (!match) continue;
    const level = match[1].length;
    const title = cleanHeadingTitle(match[2]);
    if (!title) continue;
    while (stack.length > 0 && stack[stack.length - 1]!.level >= level) stack.pop();
    stack.push({ level, title });
    headings.push({ index, level, title, path: stack.map((entry) => entry.title) });
  }
  const sections: ParsedManualSection[] = [];
  for (let index = 0; index < headings.length; index += 1) {
    const current = headings[index]!;
    let end = lines.length;
    for (let nextIndex = index + 1; nextIndex < headings.length; nextIndex += 1) {
      if (headings[nextIndex]!.level <= current.level) {
        end = headings[nextIndex]!.index;
        break;
      }
    }
    const bodyMarkdown = lines.slice(current.index + 1, end).join("\n").trim();
    sections.push({
      level: current.level,
      title: current.title,
      path: current.path,
      bodyMarkdown,
    });
  }
  return sections;
}

function sectionToManualRecord(
  definition: Pick<ManualSourceDefinition, "key" | "repoPath" | "sitePath" | "title">,
  section: ParsedManualSection,
  provenance: OnlineProvenance,
): OnlineManualRecord | undefined {
  const content = sanitizeManualText(section.bodyMarkdown);
  const links = extractSafeManualLinks(section.bodyMarkdown, onlineManualSiteUrl(definition.sitePath));
  if (!content || (content.length < 12 && links.length === 0)) return undefined;
  return {
    kind: "manual",
    id: makeOnlineId(`manual-${definition.key}`, section.path.join(" / ")),
    sourceKey: definition.key,
    sourceTitle: definition.title,
    title: section.title,
    headingPath: [...section.path],
    sectionPath: section.path.join(" / "),
    sectionLevel: section.level,
    pageUrl: onlineManualSiteUrl(definition.sitePath),
    pageRepoPath: definition.repoPath,
    summary: sampleText(content, 220),
    content,
    links,
    provenance,
  };
}

function sanitizeManualText(value: string): string {
  const withoutFences = value
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/<iframe[\s\S]*?<\/iframe>/giu, " ")
    .replace(/<AdSenseDisplayAD\s*\/>/giu, " ")
    .replace(/!\[[^\]]*\]\(([^)]+)\)/gu, " ")
    .replace(/<a\b[^>]*>/giu, " ")
    .replace(/<\/a>/giu, " ")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/gu, "$1")
    .replace(/<Badge[^>]*\/>/gu, " ")
    .replace(/:::\s*(?:tip|warning|details)[^\n]*\n/giu, " ")
    .replace(/^:::\s*$/gmu, " ")
    .replace(/^\s*[-+*]\s+/gmu, " ")
    .replace(/^\s*\d+\.\s+/gmu, " ")
    .replace(/^\s*>\s*/gmu, " ")
    .replace(/^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*$/gmu, " ")
    .replace(/\|/gu, " ")
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/[*_~#]/gu, " ")
    .replace(/<\/?[^>]+>/gu, " ");
  return collapseWhitespace(withoutFences);
}

function extractSafeManualLinks(markdown: string, pageUrl: string): OnlineManualLink[] {
  const links: OnlineManualLink[] = [];
  const seen = new Set<string>();
  const markdownMatches = markdown.matchAll(/\[([^\]]+)\]\(([^)]+)\)/gu);
  for (const match of markdownMatches) {
    if (typeof match.index === "number" && match.index > 0 && markdown[match.index - 1] === "!") continue;
    const text = collapseWhitespace(match[1] ?? "");
    const url = normalizeSafeManualUrl(match[2] ?? "", pageUrl);
    if (!text || !url || seen.has(url)) continue;
    seen.add(url);
    links.push({ text, url });
    if (links.length >= ONLINE_MANUAL_LINK_LIMIT) return links;
  }
  const htmlMatches = markdown.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/giu);
  for (const match of htmlMatches) {
    const text = collapseWhitespace(sanitizeManualText(match[2] ?? ""));
    const url = normalizeSafeManualUrl(match[1] ?? "", pageUrl);
    if (!text || !url || seen.has(url)) continue;
    seen.add(url);
    links.push({ text, url });
    if (links.length >= ONLINE_MANUAL_LINK_LIMIT) return links;
  }
  return links;
}

function normalizeSafeManualUrl(value: string, pageUrl: string): string | undefined {
  const candidate = value.trim();
  if (!candidate || candidate.startsWith("#")) return undefined;
  try {
    const url = new URL(candidate, pageUrl);
    if (!/^https?:$/u.test(url.protocol)) return undefined;
    return isAllowedManualLinkHostname(url.hostname) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function isAllowedManualLinkHostname(hostname: string): boolean {
  const normalized = hostname.toLocaleLowerCase("en-US");
  return normalized === "sustech.online"
    || normalized === "sustech.edu.cn"
    || normalized.endsWith(".sustech.edu.cn");
}

function resolveManualSources(source: OnlineManualQueryOptions["source"]): ManualSourceDefinition[] {
  if (source === undefined) return [...ONLINE_MANUAL_SOURCES];
  const keys = Array.isArray(source) ? source : [source];
  const resolved = keys.map((key) => ONLINE_MANUAL_SOURCE_MAP.get(key));
  if (resolved.some((entry) => entry === undefined)) {
    throw new CliError("Manual source filters must use an allowlisted source key.", "USAGE", 2, {
      source,
    });
  }
  return resolved as ManualSourceDefinition[];
}

function applyManualLimit(records: readonly OnlineManualRecord[], limit: number | undefined): OnlineManualRecord[] {
  if (limit === undefined) return [...records];
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
    throw new CliError("Manual result limits must be integers from 1 to 200.", "USAGE", 2);
  }
  return records.slice(0, limit);
}

function compareManualRecords(left: OnlineManualRecord, right: OnlineManualRecord): number {
  return (
    left.sourceKey.localeCompare(right.sourceKey, "en-US") ||
    left.sectionPath.localeCompare(right.sectionPath, "zh-Hans-CN") ||
    left.id.localeCompare(right.id, "en-US")
  );
}

function cleanHeadingTitle(value: string): string {
  return collapseWhitespace(
    value
      .replace(/<Badge[^>]*\/>/gu, " ")
      .replace(/`([^`]+)`/gu, "$1")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/gu, "$1")
      .replace(/[*_~#]/gu, " ")
      .replace(/<\/?[^>]+>/gu, " "),
  ).replace(/^[^\p{L}\p{N}]+/u, "");
}

function matchesSectionTitle(title: string, allowlistedTitles: readonly string[]): boolean {
  const normalizedTitle = normalizeManualHeadingForMatch(title);
  return allowlistedTitles.some((candidate) => normalizedTitle === normalizeManualHeadingForMatch(candidate));
}

function normalizeManualHeadingForMatch(value: string): string {
  return collapseWhitespace(value)
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .toLocaleLowerCase("zh-Hans-CN");
}

function assertAllowedManualRepoPath(repoPath: string): void {
  if (ONLINE_MANUAL_REPO_PATHS.has(repoPath)) return;
  throw new CliError("The requested SUSTech Online manual source is outside the allowlist.", "ONLINE_SOURCE_NOT_ALLOWED", 2, {
    sourceRepoPath: repoPath,
  });
}

function assertAllowedManualSitePath(sitePath: string): void {
  if (ONLINE_MANUAL_SITE_PATHS.has(sitePath)) return;
  throw new CliError("The requested SUSTech Online manual page is outside the allowlist.", "ONLINE_SOURCE_NOT_ALLOWED", 2, {
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

function stripBom(value: string): string {
  return value.replace(/^\uFEFF/u, "");
}

async function fetchAllowlistedManualText(
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
    throw new ServiceError("Could not reach the SUSTech Online manual source.", {
      url,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  validateFetchedManualUrl(response.url || url, url, options.kind);
  const advertisedLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(advertisedLength) && advertisedLength > ONLINE_MAX_DOCUMENT_BYTES) {
    throw new ServiceError("SUSTech Online manual returned an oversized document.", {
      url,
      status: response.status,
    });
  }
  const bytes = await readBoundedManualBody(response, url);
  const text = new TextDecoder().decode(bytes);
  if (!response.ok) {
    throw new ServiceError("SUSTech Online manual returned an HTTP error.", {
      url,
      status: response.status,
      bodySample: sampleText(text),
    });
  }
  return text;
}

async function readBoundedManualBody(response: Response, url: string): Promise<Uint8Array> {
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
        throw new ServiceError("SUSTech Online manual returned an oversized document.", {
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

function validateFetchedManualUrl(value: string, expected: string, kind: "raw" | "site"): void {
  const url = new URL(value);
  const expectedUrl = new URL(expected);
  if (url.href !== expectedUrl.href) {
    throw new CliError(
      "The fetched SUSTech Online manual source escaped its exact allowlist target.",
      "ONLINE_SOURCE_NOT_ALLOWED",
      2,
      { sourceUrl: value },
    );
  }
  if (kind === "raw") {
    const expectedPrefix = `/${ONLINE_REPO_OWNER}/${ONLINE_REPO_NAME}/${ONLINE_REPO_BRANCH}/docs/`;
    if (url.origin !== ONLINE_RAW_ORIGIN || !url.pathname.startsWith(expectedPrefix)) {
      throw new CliError("The fetched SUSTech Online manual source escaped the raw allowlist.", "ONLINE_SOURCE_NOT_ALLOWED", 2, {
        sourceUrl: value,
      });
    }
    assertAllowedManualRepoPath(decodeOnlinePath(url.pathname.slice(expectedPrefix.length - "docs/".length)));
    return;
  }
  if (url.origin !== ONLINE_SITE_ORIGIN) {
    throw new CliError("The fetched SUSTech Online manual page escaped the site allowlist.", "ONLINE_SOURCE_NOT_ALLOWED", 2, {
      sourceUrl: value,
    });
  }
  assertAllowedManualSitePath(url.pathname);
}

function decodeOnlinePath(pathname: string): string {
  return pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment))
    .join("/");
}
