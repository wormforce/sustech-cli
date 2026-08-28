import assert from "node:assert/strict";
import test from "node:test";
import {
  getNcesCourseDetail,
  resolveNcesCourseLookup,
  resolveNcesCourseLookups,
  type NcesCourseLookup,
} from "../services/nces.js";
import { ServiceError } from "../services/base.js";
import type { ServiceAdapter } from "../services/base.js";

test("NCES lookup resolves a concrete section with explicit match confidence", async () => {
  const adapter = routeAdapter((url) => {
    if (url === "https://ncesnext.com/api/v1/search?q=CS109") {
      return jsonResponse({
        courses: {
          total: 3,
          items: [
            {
              id: 11,
              name: "程序设计基础",
              course_code: "CS109",
              teacher_names: "李四",
              term_ids: ["20222"],
              rate_average: 8.7,
              review_count: 18,
              difficulty_score: 70,
              homework_score: 62,
              grading_score: 68,
              gain_score: 83,
            },
            {
              id: 12,
              name: "程序设计基础",
              course_code: "CS109A",
              teacher_names: "王五",
              term_ids: ["20222"],
              rate_average: 9.3,
              review_count: 42,
              difficulty_score: 78,
              homework_score: 66,
              grading_score: 74,
              gain_score: 90,
            },
            {
              id: 13,
              name: "数字逻辑",
              course_code: "EE109",
              teacher_names: "李四",
              term_ids: ["20222"],
              rate_average: 8.1,
              review_count: 6,
              difficulty_score: 52,
              homework_score: 58,
              grading_score: 55,
              gain_score: 61,
            },
          ],
        },
        reviews: { items: [] },
      });
    }
    if (url === "https://ncesnext.com/api/v1/course/11") {
      return jsonResponse({
        id: 11,
        name: "程序设计基础",
        course_code: "CS109",
        teacher_names: "李四",
        dept: "计算机科学与工程系",
        review_term_list: ["20222"],
        rate: {
          rate_average: 8.7,
          review_count: 18,
          difficulty_score: 70,
          homework_score: 62,
          grading_score: 68,
          gain_score: 83,
        },
      });
    }
    if (url === "https://ncesnext.com/api/v1/course/11/reviews") {
      return jsonResponse({
        items: [{ id: 1, author: "Alice", term: "20222", rate: 9, upvote_count: 2, content: "<p>solid</p>" }],
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  const resolved = await resolveNcesCourseLookup(
    { code: "CS109", name: "程序设计基础", teachers: ["李四"] },
    { termId: "20222", includeDetail: true, adapter },
  );

  assert.equal(resolved.status, "matched");
  assert.equal(resolved.confidence, "high");
  assert.equal(resolved.searchTotal, 3);
  assert.equal(resolved.matchedCandidates.length, 2);
  assert.equal(resolved.picked?.ncesId, 11);
  assert.equal(resolved.signals.exactCode, true);
  assert.equal(resolved.signals.termMatched, true);
  assert.deepEqual(resolved.signals.teacherMatches, ["李四"]);
  assert.equal(resolved.detail?.department, "计算机科学与工程系");
  assert.equal(resolved.detail?.reviews[0]?.content, "solid");
});

test("NCES batch lookup isolates per-course failures and preserves error versus not_found", async () => {
  const adapter = routeAdapter((url) => {
    if (url === "https://ncesnext.com/api/v1/search?q=CS999") {
      return jsonResponse({
        courses: {
          total: 1,
          items: [{
            id: 99,
            name: "无关课程",
            course_code: "MA999",
            teacher_names: "教师",
            term_ids: ["20222"],
            rate_average: 7,
            review_count: 1,
            difficulty_score: 50,
            homework_score: 50,
            grading_score: 50,
            gain_score: 50,
          }],
        },
        reviews: { items: [] },
      });
    }
    if (url === "https://ncesnext.com/api/v1/search?q=BAD500") {
      throw new Error("token=secret-cookie");
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  const batch = await resolveNcesCourseLookups([
    { key: "missing", code: "CS999" },
    { key: "error", code: "BAD500" },
  ], { adapter });

  assert.equal(batch.partial, true);
  assert.deepEqual(batch.failures, [{ key: "error", message: "Could not reach the upstream service." }]);
  assert.equal(batch.items.missing?.status, "not_found");
  assert.equal(batch.items.error?.status, "error");
  assert.equal(batch.items.error?.errorMessage, "Could not reach the upstream service.");
  assert.doesNotMatch(JSON.stringify(batch), /secret-cookie/);
  assert.match(batch.items.error?.notes[0] || "", /isolated/i);
});

test("NCES lookup returns insufficient_query without making a request", async () => {
  let called = 0;
  const adapter = routeAdapter(() => {
    called += 1;
    throw new Error("should not run");
  });

  const resolved = await resolveNcesCourseLookup({} satisfies NcesCourseLookup, { adapter });
  assert.equal(called, 0);
  assert.equal(resolved.status, "insufficient_query");
  assert.equal(resolved.confidence, "none");
});

test("NCES lookup sorts equal-match candidates by numeric rating before stable IDs", async () => {
  const adapter = routeAdapter((url) => {
    if (url === "https://ncesnext.com/api/v1/search?q=CS555") {
      return jsonResponse({
        courses: {
          total: 2,
          items: [
            {
              id: 20,
              name: "高阶专题",
              course_code: "CS555",
              teacher_names: "教师",
              term_ids: ["20222"],
              rate_average: 9,
              review_count: 20,
              difficulty_score: 60,
              homework_score: 60,
              grading_score: 60,
              gain_score: 60,
            },
            {
              id: 21,
              name: "高阶专题",
              course_code: "CS555",
              teacher_names: "教师",
              term_ids: ["20222"],
              rate_average: 10,
              review_count: 20,
              difficulty_score: 60,
              homework_score: 60,
              grading_score: 60,
              gain_score: 60,
            },
          ],
        },
        reviews: { items: [] },
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  const resolved = await resolveNcesCourseLookup({ code: "CS555", teachers: ["教师"] }, { termId: "20222", adapter });
  assert.equal(resolved.picked?.ncesId, 21);
  assert.deepEqual(resolved.matchedCandidates.map((item) => item.ncesId), [21, 20]);
});

test("NCES detail turns non-404 HTTP failures into ServiceError", async () => {
  const adapter = routeAdapter((url) => {
    if (url === "https://ncesnext.com/api/v1/course/500") {
      return new Response("server exploded", { status: 500, headers: { "content-type": "text/plain" } });
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  await assert.rejects(
    () => getNcesCourseDetail(500, { adapter }),
    (error: unknown) => error instanceof ServiceError && error.details?.status === 500,
  );
});

test("NCES detail fails closed on invalid JSON instead of partially parsing", async () => {
  const adapter = routeAdapter((url) => {
    if (url === "https://ncesnext.com/api/v1/course/600") {
      return new Response("{bad json", { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  await assert.rejects(
    () => getNcesCourseDetail(600, { adapter }),
    (error: unknown) => error instanceof ServiceError && String(error.message).includes("invalid JSON"),
  );
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
