import assert from "node:assert/strict";
import test from "node:test";
import { buildPrimoSearchUrl, extractPrimoDocId, LIBRARY_CATALOG_STATUS } from "../services/library.js";
import { getNcesCourseDetail, pickBestNcesSection, searchNces, tisToNcesTerm } from "../services/nces.js";
import { resolveOpenAccess, searchCrossref } from "../services/papers.js";
import type { ServiceAdapter } from "../services/base.js";

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
  assert.equal(LIBRARY_CATALOG_STATUS.availability, "unavailable");
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

  const papers = await searchCrossref("example query", { maxResults: 5, adapter });
  const parsed = new URL(crossrefUrl);
  assert.equal(parsed.searchParams.get("query.bibliographic"), "example query");
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
