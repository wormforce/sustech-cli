import { constants as cryptoConstants } from "node:crypto";
import { EventEmitter } from "node:events";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import {
  buildPrimoSearchUrl,
  createPrimoPublicAdapter,
  extractPrimoContext,
  extractPrimoDocId,
  formatPrimoRecordRef,
  getLibraryCatalogDetail,
  LIBRARY_CATALOG_STATUS,
  normalisePrimoSearchResult,
  parsePrimoRecordRef,
  searchLibraryCatalog,
} from "../services/library.js";
import { getNcesCourseDetail, pickBestNcesSection, searchNces, tisToNcesTerm } from "../services/nces.js";
import { resolveOpenAccess, searchCrossref } from "../services/papers.js";
import { ServiceError } from "../services/base.js";
import type { ServiceAdapter } from "../services/base.js";

test("service errors redact authentication tokens from diagnostic URLs", () => {
  const error = new ServiceError("failed", {
    url: "https://ws.sustech.edu.cn/api?userToken=ABC123&query=program",
  });
  const url = new URL(String(error.details?.url));
  assert.equal(url.searchParams.get("userToken"), "[REDACTED]");
  assert.equal(url.searchParams.get("query"), "program");
});

test("library Primo URL builder preserves modern facet-based search parameters", () => {
  const url = buildPrimoSearchUrl({
    query: "aspirin",
    scope: "catalog",
    materialTypes: ["Article", "Book"],
    languages: ["eng"],
    peerReviewed: true,
    fullTextOnline: true,
    dateFrom: "2020",
    limit: 20,
    offset: 40,
    sortBy: "date",
  });
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get("query"), "any,contains,aspirin");
  assert.equal(parsed.searchParams.get("bulkSize"), "20");
  assert.equal(parsed.searchParams.get("offset"), "40");
  assert.equal(parsed.searchParams.get("sortby"), "date_desc");
  assert.deepEqual(parsed.searchParams.getAll("facet"), [
    "rtype,include,Article,Book",
    "language,include,eng",
    "tlevel,include,peer_reviewed",
    "pcavailability,include,true",
    "date,include,[2020 TO *]",
  ]);
  assert.equal(extractPrimoDocId("https://sustc-primo.hosted.exlibrisgroup.com.cn/primo-explore/fulldisplay?docid=cdi_proquest_miscellaneous_1901310093"), "cdi_proquest_miscellaneous_1901310093");
  assert.equal(LIBRARY_CATALOG_STATUS.availability, "implemented");
});

test("library Primo public helpers preserve context-safe record references", () => {
  const apiUrl = "https://sustc.primo.exlibrisgroup.com.cn/primaws/rest/pub/pnxs/PC/cdi_proquest_miscellaneous_1901310093?vid=86SUSTC_INST%3A86SUSTC&lang=en&inst=86SUSTC";
  const uiUrl = "https://sustc.primo.exlibrisgroup.com.cn/discovery/fulldisplay?context=L&docid=alma991234567890106575&vid=86SUSTC_INST%3A86SUSTC";
  assert.equal(extractPrimoContext(apiUrl), "PC");
  assert.equal(extractPrimoDocId(apiUrl), "cdi_proquest_miscellaneous_1901310093");
  assert.equal(extractPrimoContext(uiUrl), "L");
  assert.equal(extractPrimoDocId(uiUrl), "alma991234567890106575");
  assert.deepEqual(parsePrimoRecordRef("PC:cdi_proquest_miscellaneous_1901310093"), {
    context: "PC",
    docId: "cdi_proquest_miscellaneous_1901310093",
  });
  assert.deepEqual(parsePrimoRecordRef("PC/cdi_proquest_miscellaneous_1901310093"), {
    context: "PC",
    docId: "cdi_proquest_miscellaneous_1901310093",
  });
  assert.deepEqual(parsePrimoRecordRef(apiUrl), {
    context: "PC",
    docId: "cdi_proquest_miscellaneous_1901310093",
  });
  assert.equal(formatPrimoRecordRef({ context: "PC", docId: "cdi_proquest_miscellaneous_1901310093" }), "PC:cdi_proquest_miscellaneous_1901310093");
});

test("Primo metadata removes PNX subfield controls without splitting letters around a middle dot", () => {
  const result = normalisePrimoSearchResult({
    context: "L",
    pnx: {
      control: { recordid: ["alma-middle-dot"] },
      display: {
        title: ["Example"],
        subject: ["Machine learning$$QPeriodicals", "Intel·ligència artificial"],
      },
    },
  }, 1);
  assert.equal(result.snippet, "Machine learning · Periodicals; Intel·ligència artificial");
  assert.doesNotMatch(result.snippet, /\$\$Q/);
});

test("library Primo public search normalizes real JSON records and preserves context", async () => {
  let requestedUrl = "";
  let requestedHeaders: RequestInit["headers"] | undefined;
  const adapter = routeAdapter((url, init) => {
    requestedUrl = url;
    requestedHeaders = init?.headers;
    return jsonResponse({
      info: {
        total: 1,
        totalResultsLocal: 0,
        totalResultsPC: 1,
        first: 1,
        last: 1,
      },
      docs: [{
        context: "PC",
        "@id": "https://cn01.alma.exlibrisgroup.com/view/delivery/86SUSTC_INST/86SUSTC?docid=cdi_proquest_miscellaneous_1901310093",
        delivery: {
          availability: ["false"],
          deliveryCategory: ["Remote Search Resource"],
        },
        pnx: {
          control: {
            recordid: ["cdi_proquest_miscellaneous_1901310093"],
            sourceid: ["proquest"],
          },
          display: {
            title: ["Example Research Article"],
            type: ["Article"],
            subject: ["Chemistry; Medicine"],
            lds50: ["peer_reviewed"],
          },
          search: {
            title: ["Example Research Article"],
            rsrctype: ["article"],
            subject: ["Chemistry"],
            general: ["Abstract extracted from fixture."],
          },
          facets: {
            tlevel: ["peer_reviewed"],
          },
          delivery: {
            fulltext: ["false"],
            delcategory: ["Remote Search Resource"],
          },
        },
      }],
    });
  });

  const result = await searchLibraryCatalog(adapter, {
    query: "aspirin",
    limit: 5,
    offset: 10,
    sortBy: "relevance",
    lang: "en",
    scope: "default",
  });

  const parsed = new URL(requestedUrl);
  assert.equal(parsed.origin, "https://sustc.primo.exlibrisgroup.com.cn");
  assert.equal(parsed.pathname, "/primaws/rest/pub/pnxs");
  assert.equal(parsed.searchParams.get("vid"), "86SUSTC_INST:86SUSTC");
  assert.equal(parsed.searchParams.get("inst"), "86SUSTC");
  assert.equal(parsed.searchParams.get("tab"), "Everything");
  assert.equal(parsed.searchParams.get("scope"), "MyInst_and_CI");
  assert.equal(parsed.searchParams.get("q"), "any,contains,aspirin");
  assert.equal(parsed.searchParams.get("lang"), "en");
  assert.equal(parsed.searchParams.get("sort"), "rank");
  assert.equal(parsed.searchParams.get("limit"), "5");
  assert.equal(parsed.searchParams.get("offset"), "10");
  assert.equal(parsed.searchParams.get("rtaLinks"), "true");
  const headers = new Headers(requestedHeaders);
  assert.match(headers.get("referer") ?? "", /^https:\/\/sustc\.primo\.exlibrisgroup\.com\.cn\/discovery\/search\?/);

  assert.equal(result.query, "any,contains,aspirin");
  assert.equal(result.total, 1);
  assert.equal(result.totalLocal, 0);
  assert.equal(result.totalRemote, 1);
  assert.equal(result.first, 1);
  assert.equal(result.last, 1);
  assert.deepEqual(result.items, [{
    rank: 11,
    title: "Example Research Article",
    format: "Article",
    detailUrl: "https://sustc.primo.exlibrisgroup.com.cn/discovery/fulldisplay?docid=cdi_proquest_miscellaneous_1901310093&context=PC&vid=86SUSTC_INST%3A86SUSTC&lang=en&tab=Everything&search_scope=MyInst_and_CI",
    docId: "cdi_proquest_miscellaneous_1901310093",
    context: "PC",
    reference: "PC:cdi_proquest_miscellaneous_1901310093",
    fullText: false,
    peerReviewed: true,
    snippet: "Chemistry; Medicine",
  }]);
});

test("library Primo public search returns empty pages for real zero-result payloads", async () => {
  const adapter = routeAdapter(() => jsonResponse({
    info: {
      total: 0,
      totalResultsLocal: 0,
      totalResultsPC: 0,
      first: 0,
      last: 0,
    },
    docs: [],
  }));

  const result = await searchLibraryCatalog(adapter, { query: "nohit" });
  assert.equal(result.total, 0);
  assert.equal(result.first, 0);
  assert.equal(result.last, 0);
  assert.deepEqual(result.items, []);
});

test("library Primo public search fails closed on malformed payloads", async () => {
  const adapter = routeAdapter(() => jsonResponse({ docs: [] }));
  await assert.rejects(
    searchLibraryCatalog(adapter, { query: "aspirin" }),
    (error: unknown) => error instanceof ServiceError
      && error.message.includes("missing the `info` object"),
  );
});

test("library Primo public detail normalizes real JSON records and rejects mismatches", async () => {
  const recordRef = "PC:cdi_proquest_miscellaneous_1901310093";
  let requestedUrl = "";
  let requestedHeaders: RequestInit["headers"] | undefined;
  const adapter = routeAdapter((url, init) => {
    requestedUrl = url;
    requestedHeaders = init?.headers;
    if (url.includes("/primaws/rest/pub/pnxs/PC/cdi_proquest_miscellaneous_1901310093")) {
      return jsonResponse({
        context: "PC",
        delivery: {
          availability: ["fulltext"],
          deliveryCategory: ["Online Resource"],
          link: ["$$Uhttps://resolver.example/full.pdf$$DFull Text"],
          almaOpenurl: "https://example.edu/openurl",
        },
        pnx: {
          control: {
            recordid: ["cdi_proquest_miscellaneous_1901310093"],
            sourceid: ["proquest"],
          },
          display: {
            title: ["Example Research Article"],
            type: ["Article"],
            creator: ["Ada Lovelace; Grace Hopper"],
            publisher: ["Example Press"],
            ispartof: ["Journal of Examples"],
            language: ["English"],
            subject: ["Programming; Compilers"],
            identifier: ["PMID: 123456"],
            description: ["Concrete abstract"],
            lds50: ["peer_reviewed"],
          },
          search: {
            title: ["Example Research Article"],
            creator: ["Ada Lovelace"],
            creationdate: ["2026"],
            language: ["eng"],
            subject: ["Programming"],
          },
          facets: {
            tlevel: ["peer_reviewed"],
          },
          addata: {
            doi: ["10.1000/example"],
            isbn: ["9780000000000"],
            issn: ["1234-5678"],
            date: ["2026"],
          },
          delivery: {
            fulltext: ["true"],
            delcategory: ["Online Resource"],
          },
          links: {
            backlink: ["$$Uhttps://doi.org/10.1000/example$$DPublisher"],
            linktorsrc: ["https://example.edu/source"],
            linktorsrcadditional: ["$$Uhttps://example.edu/extra$$DExtra"],
          },
        },
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  const detail = await getLibraryCatalogDetail(adapter, recordRef, { lang: "en" });
  const parsed = new URL(requestedUrl);
  assert.equal(parsed.origin, "https://sustc.primo.exlibrisgroup.com.cn");
  assert.equal(parsed.pathname, "/primaws/rest/pub/pnxs/PC/cdi_proquest_miscellaneous_1901310093");
  assert.equal(parsed.searchParams.get("vid"), "86SUSTC_INST:86SUSTC");
  assert.equal(parsed.searchParams.get("inst"), "86SUSTC");
  assert.equal(parsed.searchParams.get("lang"), "en");
  const headers = new Headers(requestedHeaders);
  assert.match(headers.get("referer") ?? "", /^https:\/\/sustc\.primo\.exlibrisgroup\.com\.cn\/discovery\/fulldisplay\?/);

  assert.deepEqual(detail, {
    context: "PC",
    docId: "cdi_proquest_miscellaneous_1901310093",
    reference: "PC:cdi_proquest_miscellaneous_1901310093",
    detailUrl: "https://sustc.primo.exlibrisgroup.com.cn/discovery/fulldisplay?docid=cdi_proquest_miscellaneous_1901310093&context=PC&vid=86SUSTC_INST%3A86SUSTC&lang=en&tab=Everything&search_scope=MyInst_and_CI",
    title: "Example Research Article",
    format: "Article",
    creators: ["Ada Lovelace", "Grace Hopper"],
    publisher: "Example Press",
    isPartOf: "Journal of Examples",
    date: "2026",
    language: "English",
    subjects: ["Programming", "Compilers"],
    identifiers: ["PMID: 123456", "DOI: 10.1000/example", "ISBN: 9780000000000", "ISSN: 1234-5678"],
    description: "Concrete abstract",
    availability: ["fulltext", "Online Resource"],
    fullText: true,
    peerReviewed: true,
    links: [
      "https://resolver.example/full.pdf",
      "https://doi.org/10.1000/example",
      "https://example.edu/source",
      "https://example.edu/extra",
      "https://example.edu/openurl",
    ],
    sourceId: "proquest",
  });

  const mismatchAdapter = routeAdapter(() => jsonResponse({
    context: "L",
    pnx: {
      control: {
        recordid: ["alma991234567890106575"],
      },
      display: {
        title: ["Wrong Record"],
      },
    },
  }));
  await assert.rejects(
    getLibraryCatalogDetail(mismatchAdapter, recordRef),
    (error: unknown) => error instanceof ServiceError
      && error.message.includes("mismatched the requested record"),
  );
});

test("Primo public adapter uses fixed-host GET requests with legacy-connect TLS only for the allowlisted API", async () => {
  let observed:
    | {
      url: string;
      method: string;
      headers: Record<string, string>;
      rejectUnauthorized: boolean;
      secureOptions: number;
      timeoutMs?: number;
    }
    | undefined;
  const adapter = createPrimoPublicAdapter({
    timeoutMs: 1234,
    requestImpl(url, options, onResponse) {
      observed = {
        url: url.toString(),
        method: options.method,
        headers: options.headers,
        rejectUnauthorized: options.rejectUnauthorized,
        secureOptions: options.secureOptions,
      };
      const response = Readable.from([JSON.stringify({ ok: true })]);
      Object.assign(response, {
        statusCode: 200,
        headers: {
          "content-type": "application/json",
          "x-primo-fixture": "1",
          "set-cookie": ["JSESSIONID=anonymous"],
        },
      });
      const request = new FakeClientRequest(() => {
        onResponse(response as never);
      });
      return request as never;
    },
  });

  const response = await adapter.fetch(
    "https://sustc.primo.exlibrisgroup.com.cn/primaws/rest/pub/pnxs?vid=86SUSTC_INST%3A86SUSTC&inst=86SUSTC&tab=Everything&scope=MyInst_and_CI&q=any,contains,aspirin&lang=en&sort=rank&limit=1&offset=0",
    {
      headers: {
        accept: "application/json",
        referer: "https://sustc.primo.exlibrisgroup.com.cn/discovery/search?vid=86SUSTC_INST%3A86SUSTC",
      },
    },
  );

  assert.deepEqual(observed, {
    url: "https://sustc.primo.exlibrisgroup.com.cn/primaws/rest/pub/pnxs?vid=86SUSTC_INST%3A86SUSTC&inst=86SUSTC&tab=Everything&scope=MyInst_and_CI&q=any,contains,aspirin&lang=en&sort=rank&limit=1&offset=0",
    method: "GET",
    headers: {
      accept: "application/json",
      "user-agent": "sustech-cli",
      referer: "https://sustc.primo.exlibrisgroup.com.cn/discovery/search?vid=86SUSTC_INST%3A86SUSTC",
    },
    rejectUnauthorized: true,
    secureOptions: cryptoConstants.SSL_OP_LEGACY_SERVER_CONNECT,
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.equal(response.headers.get("x-primo-fixture"), "1");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(await response.text(), "{\"ok\":true}");
});

test("Primo public adapter fails closed on origin, path, method, body, referer, and pre-aborted signals", async () => {
  const adapter = createPrimoPublicAdapter();
  assert.throws(
    () => adapter.fetch("https://example.com/primaws/rest/pub/pnxs"),
    (error: unknown) => error instanceof ServiceError
      && error.message.includes("fixed SUSTech Primo public origin"),
  );
  assert.throws(
    () => adapter.fetch("https://sustc.primo.exlibrisgroup.com.cn/discovery/search"),
    (error: unknown) => error instanceof ServiceError
      && error.message.includes("public Primo REST path"),
  );
  assert.throws(
    () => adapter.fetch("https://sustc.primo.exlibrisgroup.com.cn/primaws/rest/pub/pnxs", { method: "POST" }),
    (error: unknown) => error instanceof ServiceError
      && error.message.includes("only permits GET"),
  );
  assert.throws(
    () => adapter.fetch("https://sustc.primo.exlibrisgroup.com.cn/primaws/rest/pub/pnxs", { body: "x" }),
    (error: unknown) => error instanceof ServiceError
      && error.message.includes("rejects request bodies"),
  );
  assert.throws(
    () => adapter.fetch("https://sustc.primo.exlibrisgroup.com.cn/primaws/rest/pub/pnxs", {
      headers: {
        referer: "https://example.com/discovery/search",
      },
    }),
    (error: unknown) => error instanceof ServiceError
      && error.message.includes("same-origin Discovery referers"),
  );
  let called = false;
  const controller = new AbortController();
  controller.abort(new Error("stop"));
  const abortedAdapter = createPrimoPublicAdapter({
    requestImpl() {
      called = true;
      throw new Error("should not be reached");
    },
  });
  assert.throws(
    () => abortedAdapter.fetch("https://sustc.primo.exlibrisgroup.com.cn/primaws/rest/pub/pnxs", {
      signal: controller.signal,
    }),
    (error: unknown) => error instanceof Error && error.message.includes("stop"),
  );
  assert.equal(called, false);
});

test("papers search normalizes CrossRef results and hydrates Unpaywall open-access links", async () => {
  let crossrefUrl = "";
  const adapter = routeAdapter((url) => {
    if (url.startsWith("https://api.crossref.org/works?")) {
      crossrefUrl = url;
      return jsonResponse({
        message: {
          items: [
            {
              DOI: "10.1000/example",
              title: ["Example Research Article"],
              author: [{ given: "Ada", family: "Lovelace" }],
              "container-title": ["Journal of Examples"],
              type: "journal-article",
              "is-referenced-by-count": 12,
              "published-online": { "date-parts": [[2024, 3, 8]] },
            },
            {
              DOI: "10.1000/book",
              title: ["Should Be Skipped"],
              type: "book",
            },
          ],
        },
      });
    }
    if (url.startsWith("https://api.unpaywall.org/v2/10.1000%2Fexample")) {
      return jsonResponse({ is_oa: true, best_oa_location: { url_for_pdf: "https://example.org/paper.pdf" } });
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  const papers = await searchCrossref("example query", { maxResults: 1, adapter });
  const parsed = new URL(crossrefUrl);
  assert.equal(parsed.searchParams.get("query.bibliographic"), "example query");
  assert.equal(parsed.searchParams.get("rows"), "50");
  assert.equal(parsed.searchParams.get("sort"), "relevance");
  assert.deepEqual(papers, [{
    title: "Example Research Article",
    doi: "10.1000/example",
    authors: ["Ada Lovelace"],
    journal: "Journal of Examples",
    year: 2024,
    citations: 12,
    queryUsed: "example query",
    oa: true,
    pdfUrl: "https://example.org/paper.pdf",
  }]);

  const oa = await resolveOpenAccess("10.1000/example", { adapter });
  assert.deepEqual(oa, {
    doi: "10.1000/example",
    openAccess: true,
    pdfUrl: "https://example.org/paper.pdf",
  });
});

test("NCES search and detail normalize public course and review JSON", async () => {
  const adapter = routeAdapter((url) => {
    if (url === "https://ncesnext.com/api/v1/search?q=cs101") {
      return jsonResponse({
        courses: {
          total: 1,
          items: [{
            id: 212,
            name: "计算机导论B",
            course_code: "CS101B",
            teacher_names: "程京德",
            term_ids: ["20222", "20212"],
            rate_average: 8.9,
            review_count: 34,
            difficulty_score: 80,
            homework_score: 70,
            grading_score: 65,
            gain_score: 90,
          }],
        },
        reviews: {
          items: [{
            id: 1,
            author: "Alice",
            term: "20222",
            rate: 9,
            upvote_count: 5,
            content: "<p>Great course</p>",
            difficulty_display: "简单",
          }],
        },
      });
    }
    if (url === "https://ncesnext.com/api/v1/course/212") {
      return jsonResponse({
        id: 212,
        name: "计算机导论B",
        course_code: "CS101B",
        teacher_names: "程京德",
        dept: "计算机科学与工程系",
        review_term_list: ["20222", "20212"],
        rate: {
          rate_average: 8.9,
          review_count: 34,
          difficulty_score: 80,
          homework_score: 70,
          grading_score: 65,
          gain_score: 90,
        },
      });
    }
    if (url === "https://ncesnext.com/api/v1/course/212/reviews") {
      return jsonResponse({
        items: [{
          id: 1,
          author: "Alice",
          term: "20222",
          rate: 9,
          upvote_count: 5,
          content: "<p>Great course</p>",
          difficulty_display: "简单",
        }],
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  const search = await searchNces("cs101", { adapter });
  assert.equal(search.total, 1);
  assert.equal(search.items[0]?.code, "CS101B");
  assert.equal(search.items[0]?.difficulty.label, "Easy");
  assert.equal(search.sampleReviews[0]?.content, "Great course");

  const detail = await getNcesCourseDetail(212, { adapter });
  assert.ok(detail);
  assert.equal(detail?.department, "计算机科学与工程系");
  assert.equal(detail?.reviews[0]?.term, "2022春");
  assert.equal(tisToNcesTerm("2025-2026", "2"), "20262");

  const picked = pickBestNcesSection(search.items, ["程京德"], "20222");
  assert.equal(picked?.ncesId, 212);
});

function routeAdapter(route: (url: string, init?: RequestInit) => Response | Promise<Response>): ServiceAdapter {
  return {
    name: "fixture",
    fetch(input: string, init?: RequestInit): Promise<Response> {
      return Promise.resolve(route(String(input), init));
    },
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

class FakeClientRequest extends EventEmitter {
  public timeoutMs?: number;
  private timeoutCallback?: () => void;

  public constructor(private readonly onEnd: () => void) {
    super();
  }

  public setTimeout(timeoutMs: number, callback?: () => void): this {
    this.timeoutMs = timeoutMs;
    this.timeoutCallback = callback;
    return this;
  }

  public end(): void {
    this.onEnd();
  }

  public destroy(error?: Error): this {
    if (error) queueMicrotask(() => this.emit("error", error));
    return this;
  }
}
