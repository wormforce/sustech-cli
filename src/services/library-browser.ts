import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import type { Browser, BrowserContext, LaunchOptions, Locator, Page } from "playwright-core";
import { CliError } from "../core/errors.js";
import { cleanText } from "./base.js";
import {
  buildPrimoDetailUrl,
  buildPrimoSearchUrl,
  formatPrimoRecordRef,
  normalisePrimoSearchResult,
  parsePrimoRecordRef,
} from "./library.js";
import type { PrimoRecordRef, PrimoSearchOptions, PrimoSearchResult } from "./library.js";

const RESULT_SELECTOR = ".list-item-primary-content.result-item-primary-content";
const EMPTY_RESULT_SELECTOR = "prm-no-search-result, prm-no-search-results, .no-results-message";
const DEFAULT_RENDER_TIMEOUT_MS = 30_000;
const DEFAULT_MANUAL_AUTH_TIMEOUT_MS = 5 * 60_000;

export const PRIMO_BROWSER_AUTH_POLICY = {
  mode: "human-only" as const,
  credentialsAcceptedByCli: false,
  challengeAutomation: false,
  cookiesPersisted: false,
  retryPolicy: "DO_NOT_RETRY_AUTOMATICALLY" as const,
};

export interface PrimoBrowserOptions {
  /** Show the browser so the user can complete CAS themselves when Primo redirects there. */
  interactive?: boolean;
  /** Override the local Chrome/Chromium executable without passing credentials to the CLI. */
  executablePath?: string;
  renderTimeoutMs?: number;
  manualAuthTimeoutMs?: number;
}

export interface PrimoBrowserSearchRow {
  title: string;
  format: string;
  detailUrl: string;
  fullText: boolean;
  peerReviewed: boolean;
  snippet: string;
}

export interface PrimoBrowserDetailPage {
  text: string;
  onlineUrl: string;
  resolvedUrl: string;
}

export interface PrimoBrowserRuntime {
  search(url: string, limit: number, options?: PrimoBrowserOptions): Promise<PrimoBrowserSearchRow[]>;
  detail(url: string, options?: PrimoBrowserOptions): Promise<PrimoBrowserDetailPage>;
}

export interface BrowserPrimoCatalogSearch {
  url: string;
  results: PrimoSearchResult[];
  totalReturned: number;
  authentication: typeof PRIMO_BROWSER_AUTH_POLICY;
}

export interface BrowserPrimoCatalogDetail {
  context: string;
  docId: string;
  reference: string;
  title: string;
  format: string;
  authors: string[];
  publisher: string;
  year: string;
  language: string;
  subjects: string[];
  abstract: string;
  isbn: string;
  fullTextAvailability: string;
  onlineUrl: string;
  detailUrl: string;
  authentication: typeof PRIMO_BROWSER_AUTH_POLICY;
}

export async function searchPrimoCatalog(
  options: PrimoSearchOptions,
  browserOptions: PrimoBrowserOptions = {},
  runtime: PrimoBrowserRuntime = new PlaywrightPrimoBrowserRuntime(),
): Promise<BrowserPrimoCatalogSearch> {
  const url = buildPrimoSearchUrl(options);
  const limit = boundedLimit(options.limit ?? 10);
  const rows = await runtime.search(url, limit, browserOptions);
  const results = rows.slice(0, limit).map((row, index) => normalisePrimoSearchResult(
    row,
    index + 1,
    { requireContext: true },
  ));
  return {
    url,
    results,
    totalReturned: results.length,
    authentication: PRIMO_BROWSER_AUTH_POLICY,
  };
}

export async function getPrimoCatalogDetail(
  input: PrimoRecordRef | string,
  browserOptions: PrimoBrowserOptions = {},
  runtime: PrimoBrowserRuntime = new PlaywrightPrimoBrowserRuntime(),
): Promise<BrowserPrimoCatalogDetail> {
  const ref = parsePrimoRecordRef(input);
  const requestedUrlValue = new URL(buildPrimoDetailUrl(ref.docId));
  requestedUrlValue.searchParams.set("context", ref.context);
  const requestedUrl = requestedUrlValue.toString();
  const rendered = await runtime.detail(requestedUrl, browserOptions);
  const parsed = parsePrimoDetailText(rendered.text);
  return {
    context: ref.context,
    docId: ref.docId,
    reference: formatPrimoRecordRef(ref),
    ...parsed,
    onlineUrl: rendered.onlineUrl,
    detailUrl: rendered.resolvedUrl || requestedUrl,
    authentication: PRIMO_BROWSER_AUTH_POLICY,
  };
}

export function formatBrowserPrimoCatalogSearch(result: BrowserPrimoCatalogSearch): string {
  if (result.results.length === 0) {
    return `Library catalog browser search\nNo matching rendered catalog records.\n${result.url}`;
  }
  return [
    `Library catalog browser search · ${result.results.length} rendered`,
    ...result.results.map((item) => {
      const tags = [
        item.format || "format unavailable",
        item.reference,
        ...(item.fullText ? ["full text"] : []),
        ...(item.peerReviewed ? ["peer reviewed"] : []),
      ];
      return [
        `${String(item.rank).padStart(2, " ")}. ${item.title}`,
        `  ${tags.join(" · ")}`,
        ...(item.snippet ? [`  ${item.snippet}`] : []),
      ].join("\n");
    }),
  ].join("\n");
}

export function formatBrowserPrimoCatalogDetail(detail: BrowserPrimoCatalogDetail): string {
  return [
    "Library catalog browser detail",
    `${detail.reference} · ${detail.title}`,
    ...(detail.format ? [`Format ${detail.format}`] : []),
    ...(detail.authors.length > 0 ? [`Authors ${detail.authors.join("; ")}`] : []),
    ...(detail.publisher ? [`Publisher ${detail.publisher}`] : []),
    ...(detail.year ? [`Year ${detail.year}`] : []),
    ...(detail.language ? [`Language ${detail.language}`] : []),
    ...(detail.subjects.length > 0 ? [`Subjects ${detail.subjects.join("; ")}`] : []),
    ...(detail.isbn ? [`ISBN ${detail.isbn}`] : []),
    ...(detail.fullTextAvailability ? [`Full text ${detail.fullTextAvailability}`] : []),
    ...(detail.onlineUrl ? [`Online ${detail.onlineUrl}`] : []),
    ...(detail.abstract ? [`Abstract ${detail.abstract}`] : []),
  ].join("\n");
}

export function parsePrimoDetailText(text: string): Omit<BrowserPrimoCatalogDetail, "context" | "docId" | "reference" | "onlineUrl" | "detailUrl" | "authentication"> {
  const lines = text
    .split(/\r?\n/)
    .map((line) => cleanText(line))
    .filter(Boolean);
  const fields = new Map<string, string>([
    ["title", readLabelledValue(lines, ["题名", "Title"])],
    ["format", readLabelledValue(lines, ["格式", "类型", "Format", "Type", "资源类型", "Resource type"])],
    ["authors", readLabelledValue(lines, ["作者", "Author", "Authors"])],
    ["publisher", readLabelledValue(lines, ["出版", "出版者", "出版项", "出版信息", "Publisher", "Publication"])],
    ["year", readLabelledValue(lines, ["出版日期", "年份", "Year", "Date"])],
    ["language", readLabelledValue(lines, ["语种", "语言", "Language"])],
    ["subjects", readLabelledValue(lines, ["主题", "学科", "Subject", "Subjects"])],
    ["abstract", readLabelledValue(lines, ["摘要", "Abstract", "Description"])],
    ["isbn", readLabelledValue(lines, ["ISBN"])],
    ["fullTextAvailability", readLabelledValue(lines, ["全文可用性", "全文可用", "Full text availability", "Full-text availability"])],
  ]);

  const knownFormat = ["图书", "文章", "期刊", "学位论文", "会议论文", "数据集", "音像"]
    .find((candidate) => lines.slice(0, 12).some((line) => line === candidate || line.includes(candidate)));
  const fallbackTitle = lines.find((line) => !isNoiseHeading(line) && !isKnownLabel(line)) ?? "";

  return {
    title: fields.get("title") || fallbackTitle,
    format: fields.get("format") || knownFormat || "",
    authors: splitList(fields.get("authors") ?? ""),
    publisher: fields.get("publisher") ?? "",
    year: fields.get("year") ?? "",
    language: fields.get("language") ?? "",
    subjects: splitList(fields.get("subjects") ?? ""),
    abstract: fields.get("abstract") ?? "",
    isbn: fields.get("isbn") ?? "",
    fullTextAvailability: fields.get("fullTextAvailability") ?? "",
  };
}

export class PlaywrightPrimoBrowserRuntime implements PrimoBrowserRuntime {
  public async search(url: string, limit: number, options: PrimoBrowserOptions = {}): Promise<PrimoBrowserSearchRow[]> {
    return this.withPage(options, async (page) => {
      await loadPrimoPage(page, url, `${RESULT_SELECTOR}, ${EMPTY_RESULT_SELECTOR}`, options);
      const items = page.locator(RESULT_SELECTOR);
      const count = Math.min(await items.count(), boundedLimit(limit));
      if (count > 0) {
        const titleReady = await waitForNonEmptyText(
          items.first().locator(".item-title a").first(),
          boundedTimeout(options.renderTimeoutMs, DEFAULT_RENDER_TIMEOUT_MS),
        );
        if (!titleReady) {
          throw browserRenderError("Primo result rows rendered without their record metadata.", page.url(), "title text missing");
        }
      }
      const rows: PrimoBrowserSearchRow[] = [];
      for (let index = 0; index < count; index += 1) {
        const item = items.nth(index);
        const titleLink = item.locator(".item-title a").first();
        const href = await optionalAttribute(titleLink, "href");
        const itemText = await optionalText(item);
        rows.push({
          title: await optionalText(titleLink),
          format: await optionalText(item.locator(".media-content-type").first()),
          detailUrl: absoluteUrl(href, page.url()),
          fullText: await item.locator("[class*=fulltext]").count() > 0
            || /(?:在线访问|全文|online access|full[ -]?text)/i.test(itemText),
          peerReviewed: await item.locator("prm-peer-reviewed").count() > 0
            || /(?:同行复核|同行评审|peer reviewed)/i.test(itemText),
          snippet: (await optionalText(item.locator(".result-item-text").first())).slice(0, 300),
        });
      }
      return rows;
    });
  }

  public async detail(url: string, options: PrimoBrowserOptions = {}): Promise<PrimoBrowserDetailPage> {
    return this.withPage(options, async (page) => {
      await loadPrimoPage(page, url, "prm-full-view", options);
      const fullView = page.locator("prm-full-view").first();
      const onlineLink = page.locator("a[href*='doi.org'], a.online, [class*=online-viewit] a, a[class*=online-viewit]").first();
      return {
        // Preserve the rendered line boundaries: the detail parser relies on
        // Primo's label/value rows, while `cleanText` would collapse the whole
        // full view into one misleading title-sized line.
        text: await fullView.innerText().catch(() => ""),
        onlineUrl: absoluteUrl(await optionalAttribute(onlineLink, "href"), page.url()),
        resolvedUrl: page.url(),
      };
    });
  }

  private async withPage<T>(options: PrimoBrowserOptions, operation: (page: Page) => Promise<T>): Promise<T> {
    const browser = await launchLocalChromium(options);
    let context: BrowserContext | undefined;
    try {
      // Keep normal certificate verification even for the human-only CAS
      // handoff. A manual login must not silently weaken the TLS boundary.
      context = await browser.newContext();
      const page = await context.newPage();
      return await operation(page);
    } finally {
      await context?.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    }
  }
}

async function launchLocalChromium(options: PrimoBrowserOptions): Promise<Browser> {
  const headless = !options.interactive;
  const explicitPath = options.executablePath?.trim() || process.env.SUSTECH_BROWSER_EXECUTABLE?.trim();
  const candidates: LaunchOptions[] = [];
  if (explicitPath) {
    candidates.push({ headless, executablePath: explicitPath });
  } else {
    const bundledPath = chromium.executablePath();
    if (bundledPath && existsSync(bundledPath)) candidates.push({ headless, executablePath: bundledPath });
    candidates.push({ headless, channel: "chrome" });
    candidates.push({ headless, channel: "msedge" });
  }

  let lastMessage = "No supported local Chromium browser was found.";
  for (const candidate of candidates) {
    try {
      return await chromium.launch(candidate);
    } catch (error) {
      lastMessage = redactBrowserDiagnostic(error);
    }
  }
  throw new CliError(
    "Library catalog rendering requires a local Chrome/Chromium browser.",
    "BROWSER_RUNTIME_UNAVAILABLE",
    1,
    {
      browser: "chromium",
      interactive: Boolean(options.interactive),
      cause: lastMessage,
      hint: "Install Google Chrome or set SUSTECH_BROWSER_EXECUTABLE to a compatible Chromium executable.",
    },
  );
}

async function loadPrimoPage(
  page: Page,
  url: string,
  readySelector: string,
  options: PrimoBrowserOptions,
): Promise<void> {
  const renderTimeoutMs = boundedTimeout(options.renderTimeoutMs, DEFAULT_RENDER_TIMEOUT_MS);
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: renderTimeoutMs });
  } catch (error) {
    throw browserRenderError("Primo navigation failed before the catalog page loaded.", page.url() || url, error);
  }

  if (isCasPage(page.url())) {
    if (!options.interactive) {
      throw new CliError(
        "Primo requires an interactive CAS login for this request.",
        "MANUAL_AUTH_REQUIRED",
        2,
        {
          interactiveOption: "--interactive",
          ...PRIMO_BROWSER_AUTH_POLICY,
        },
      );
    }
    const authTimeoutMs = boundedTimeout(options.manualAuthTimeoutMs, DEFAULT_MANUAL_AUTH_TIMEOUT_MS);
    try {
      await page.waitForURL((candidate) => !isCasPage(candidate.toString()), { timeout: authTimeoutMs });
    } catch (error) {
      throw new CliError(
        "Manual CAS login did not complete within the allowed time.",
        "MANUAL_AUTH_NOT_COMPLETED",
        2,
        {
          timeoutMs: authTimeoutMs,
          cause: redactBrowserDiagnostic(error),
          ...PRIMO_BROWSER_AUTH_POLICY,
        },
      );
    }
  }

  try {
    await page.waitForSelector(readySelector, { timeout: renderTimeoutMs });
  } catch (error) {
    if (isCasPage(page.url())) {
      throw new CliError(
        "Primo redirected to CAS after navigation; complete the login manually with --interactive.",
        "MANUAL_AUTH_REQUIRED",
        2,
        { interactiveOption: "--interactive", ...PRIMO_BROWSER_AUTH_POLICY },
      );
    }
    throw browserRenderError("Primo did not render the expected catalog content.", page.url(), error);
  }
}

function readLabelledValue(lines: readonly string[], aliases: readonly string[]): string {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    for (const alias of aliases) {
      if (sameLabel(line, alias)) {
        const following: string[] = [];
        for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
          const candidate = lines[cursor] ?? "";
          if (isKnownLabel(candidate) || isSectionHeading(candidate)) break;
          following.push(candidate);
          if (following.length >= 4) break;
        }
        return cleanText(following.join(" "));
      }
      const inline = inlineLabelValue(line, alias);
      if (inline) return inline;
    }
  }
  return "";
}

const ALL_LABELS = [
  "题名", "Title", "格式", "类型", "Format", "Type", "资源类型", "Resource type",
  "作者", "Author", "Authors", "出版", "出版者", "出版项", "出版信息", "Publisher", "Publication",
  "出版日期", "年份", "Year", "Date", "语种", "语言", "Language",
  "主题", "学科", "Subject", "Subjects", "摘要", "Abstract", "Description",
  "ISBN", "全文可用性", "全文可用", "Full text availability", "Full-text availability",
  "频率", "Frequency", "来源", "Source", "统一题名", "Uniform title", "链接", "Links",
  "版本", "Edition", "标识符", "Identifier", "馆藏", "Holdings", "说明", "Notes",
] as const;

function isKnownLabel(line: string): boolean {
  return ALL_LABELS.some((label) => sameLabel(line, label) || Boolean(inlineLabelValue(line, label)));
}

function sameLabel(line: string, label: string): boolean {
  return stripLabelPunctuation(line).toLocaleLowerCase() === stripLabelPunctuation(label).toLocaleLowerCase();
}

function inlineLabelValue(line: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^${escaped}\\s*[:：]\\s*(.+)$`, "i").exec(line);
  return cleanText(match?.[1] ?? "");
}

function stripLabelPunctuation(value: string): string {
  return value.replace(/[\s:：/]+$/g, "").trim();
}

function isNoiseHeading(line: string): boolean {
  return /^(?:顶部|详细信息|完整记录|Details?|Full record|发送到|发送至|获取资料|在线查看|内部检索|可用性)$/i.test(line.trim());
}

function isSectionHeading(line: string): boolean {
  return /^(?:顶部|详细信息|完整记录|Details?|Full record|发送到|发送至|获取资料|在线查看|内部检索|链接|Links?)$/i.test(line.trim());
}

function splitList(value: string): string[] {
  if (!value) return [];
  return value.split(/\s*(?:;|；|\||\n)\s*/).map((item) => cleanText(item)).filter(Boolean);
}

function boundedLimit(value: number): number {
  if (!Number.isFinite(value) || value < 1) return 10;
  return Math.min(Math.floor(value), 100);
}

function boundedTimeout(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 1_000) return fallback;
  return Math.min(Math.floor(value), 10 * 60_000);
}

async function optionalText(locator: Locator): Promise<string> {
  if (await locator.count() === 0) return "";
  return cleanText(await locator.innerText().catch(() => ""));
}

async function optionalAttribute(locator: Locator, name: string): Promise<string> {
  if (await locator.count() === 0) return "";
  return (await locator.getAttribute(name).catch(() => null)) ?? "";
}

async function waitForNonEmptyText(locator: Locator, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await optionalText(locator)).length > 0) return true;
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

function absoluteUrl(value: string, base: string): string {
  if (!value) return "";
  try {
    return new URL(value, base).toString();
  } catch {
    return "";
  }
}

function isCasPage(value: string): boolean {
  try {
    const url = new URL(value);
    return url.hostname.toLowerCase() === "cas.sustech.edu.cn" || /\/(?:cas|authserver)\//i.test(url.pathname);
  } catch {
    return false;
  }
}

function browserRenderError(message: string, url: string, error: unknown): CliError {
  return new CliError(message, "BROWSER_RENDER_FAILED", 1, {
    url: safeBrowserUrl(url),
    cause: redactBrowserDiagnostic(error),
    retryPolicy: "DO_NOT_RETRY_AUTOMATICALLY",
  });
}

function safeBrowserUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/(?:auth|password|secret|session|ticket|token)/i.test(key)) url.searchParams.set(key, "[REDACTED]");
    }
    return url.toString();
  } catch {
    return value.split("?", 1)[0] ?? "";
  }
}

function firstLine(value: string): string {
  return value.split(/\r?\n/, 1)[0]?.slice(0, 300) ?? "";
}

export function redactBrowserDiagnostic(error: unknown): string {
  const message = firstLine(error instanceof Error ? error.message : String(error));
  return message
    .replace(/https?:\/\/[^\s"'<>]+/gi, (value) => safeBrowserUrl(value))
    .replace(/\b(password|authorization|cookie|secret|session|sid|ticket|token)\s*[:=]\s*[^\s,;&]+/gi, "$1=[REDACTED]")
    .replace(/\b(bearer\s+)[a-z0-9._~-]+\b/gi, "$1[REDACTED]");
}
