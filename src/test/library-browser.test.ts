import assert from "node:assert/strict";
import test from "node:test";
import {
  getPrimoCatalogDetail,
  formatBrowserPrimoCatalogDetail,
  formatBrowserPrimoCatalogSearch,
  parsePrimoDetailText,
  PRIMO_BROWSER_AUTH_POLICY,
  redactBrowserDiagnostic,
  searchPrimoCatalog,
} from "../services/library-browser.js";
import type {
  PrimoBrowserDetailPage,
  PrimoBrowserOptions,
  PrimoBrowserRuntime,
  PrimoBrowserSearchRow,
} from "../services/library-browser.js";

test("browser-backed Primo search returns normalized, ranked catalog records", async () => {
  const runtime = new FakePrimoRuntime({
    searchRows: [
      {
        title: "  Example   Book ",
        format: "图书",
        detailUrl: "https://example.edu/fulldisplay?docid=alma-1&context=L",
        fullText: true,
        peerReviewed: false,
        snippet: "A useful example.",
      },
      {
        title: "Example Article",
        format: "文章",
        detailUrl: "https://example.edu/fulldisplay?docid=cdi-2&context=PC",
        fullText: false,
        peerReviewed: true,
        snippet: "Second result.",
      },
    ],
  });

  const result = await searchPrimoCatalog({ query: "example", limit: 1 }, { interactive: true }, runtime);
  assert.equal(runtime.lastSearchLimit, 1);
  assert.equal(runtime.lastOptions?.interactive, true);
  assert.equal(result.totalReturned, 1);
  assert.equal(result.results[0]?.rank, 1);
  assert.equal(result.results[0]?.title, "Example Book");
  assert.equal(result.results[0]?.docId, "alma-1");
  assert.deepEqual(result.authentication, PRIMO_BROWSER_AUTH_POLICY);
  assert.match(formatBrowserPrimoCatalogSearch(result), /Library catalog browser search · 1 rendered/);
  assert.match(formatBrowserPrimoCatalogSearch(result), /alma-1/);
});

test("Primo detail parser preserves labelled metadata without inventing missing fields", async () => {
  const text = [
    "详细信息",
    "图书",
    "题名",
    "Programming Examples",
    "作者",
    "Ada Lovelace; Grace Hopper",
    "出版者: Example Press",
    "年份",
    "2026",
    "语种",
    "英语",
    "主题",
    "Programming; Compilers",
    "摘要",
    "A concrete abstract.",
    "ISBN",
    "9780000000000",
    "全文可用性",
    "Online access",
  ].join("\n");
  const parsed = parsePrimoDetailText(text);
  assert.deepEqual(parsed, {
    title: "Programming Examples",
    format: "图书",
    authors: ["Ada Lovelace", "Grace Hopper"],
    publisher: "Example Press",
    year: "2026",
    language: "英语",
    subjects: ["Programming", "Compilers"],
    abstract: "A concrete abstract.",
    isbn: "9780000000000",
    fullTextAvailability: "Online access",
  });

  const runtime = new FakePrimoRuntime({
    detailPage: {
      text,
      onlineUrl: "https://doi.org/10.1000/example",
      resolvedUrl: "https://example.edu/detail/alma-1",
    },
  });
  const detail = await getPrimoCatalogDetail("L:alma-1", {}, runtime);
  assert.equal(detail.context, "L");
  assert.equal(detail.docId, "alma-1");
  assert.equal(detail.reference, "L:alma-1");
  assert.equal(detail.onlineUrl, "https://doi.org/10.1000/example");
  assert.equal(detail.detailUrl, "https://example.edu/detail/alma-1");
  assert.equal(detail.title, "Programming Examples");
  assert.match(formatBrowserPrimoCatalogDetail(detail), /L:alma-1 · Programming Examples/);

  await getPrimoCatalogDetail("PC:cdi-remote-1", {}, runtime);
  const requested = new URL(runtime.lastDetailUrl ?? "");
  assert.equal(requested.searchParams.get("docid"), "cdi-remote-1");
  assert.equal(requested.searchParams.get("context"), "PC");
});

test("Primo browser auth policy is manual-only and ephemeral", () => {
  assert.deepEqual(PRIMO_BROWSER_AUTH_POLICY, {
    mode: "human-only",
    credentialsAcceptedByCli: false,
    challengeAutomation: false,
    cookiesPersisted: false,
    retryPolicy: "DO_NOT_RETRY_AUTOMATICALLY",
  });
});

test("Primo browser diagnostics redact secrets embedded in URLs and plain text", () => {
  const diagnostic = redactBrowserDiagnostic(new Error(
    "page.goto: Timeout at https://cas.sustech.edu.cn/cas/login?ticket=ST-secret&service=https%3A%2F%2Flib.example password=hunter2 bearer abc.def",
  ));
  assert.doesNotMatch(diagnostic, /ST-secret|hunter2|abc\.def/);
  assert.match(diagnostic, /ticket=\[REDACTED\]/);
  assert.match(diagnostic, /password=\[REDACTED\]/);
  assert.match(diagnostic, /bearer \[REDACTED\]/i);
});

class FakePrimoRuntime implements PrimoBrowserRuntime {
  public lastSearchLimit?: number;
  public lastOptions?: PrimoBrowserOptions;
  public lastDetailUrl?: string;

  public constructor(private readonly fixtures: {
    searchRows?: PrimoBrowserSearchRow[];
    detailPage?: PrimoBrowserDetailPage;
  }) {}

  public async search(_url: string, limit: number, options?: PrimoBrowserOptions): Promise<PrimoBrowserSearchRow[]> {
    this.lastSearchLimit = limit;
    this.lastOptions = options;
    return this.fixtures.searchRows ?? [];
  }

  public async detail(url: string, _options?: PrimoBrowserOptions): Promise<PrimoBrowserDetailPage> {
    this.lastDetailUrl = url;
    return this.fixtures.detailPage ?? { text: "", onlineUrl: "", resolvedUrl: "" };
  }
}
