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
    if (url === "https://ncesnext.com/api/v1/search?q=CS109&type=course&per_page=50") {
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
    if (url === "https://ncesnext.com/api/v1/course/11/reviews?term=20222") {
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

test("NCES lookup base-code matching keeps longer same-prefix suffixes but rejects shorter or confusable codes", async () => {
  const adapter = routeAdapter((url) => {
    if (url === "https://ncesnext.com/api/v1/search?q=CS203B&type=course&per_page=50") {
      return jsonResponse({
        courses: {
          total: 4,
          items: [
            {
              id: 8121,
              name: "数据结构与算法分析B",
              course_code: "CS203B",
              teacher_names: "杨鹏",
              term_ids: ["20242"],
              rate_average: 6.7,
              review_count: 7,
              difficulty_score: 64.29,
              homework_score: 78.57,
              grading_score: 57.14,
              gain_score: 50,
            },
            {
              id: 9001,
              name: "数据结构与算法分析B Honors",
              course_code: "CS203BH",
              teacher_names: "杨鹏",
              term_ids: ["20242"],
              rate_average: 6.5,
              review_count: 2,
              difficulty_score: 60,
              homework_score: 70,
              grading_score: 55,
              gain_score: 52,
            },
            {
              id: 1157,
              name: "数据结构与算法分析",
              course_code: "CS203",
              teacher_names: "唐博",
              term_ids: ["20261"],
              rate_average: 7.8,
              review_count: 21,
              difficulty_score: 21.43,
              homework_score: 16.67,
              grading_score: 52.38,
              gain_score: 88.1,
            },
            {
              id: 2132,
              name: "人工智能B",
              course_code: "CS303B",
              teacher_names: "张建国",
              term_ids: ["20231"],
              rate_average: 7,
              review_count: 2,
              difficulty_score: 50,
              homework_score: 50,
              grading_score: 75,
              gain_score: 75,
            },
          ],
        },
        teachers: { total: 0, pages: 0, items: [] },
        reviews: { total: 0, pages: 0, items: [] },
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  const resolved = await resolveNcesCourseLookup(
    { code: "CS203B", teachers: ["杨鹏"] },
    { adapter },
  );

  assert.equal(resolved.status, "matched");
  assert.equal(resolved.picked?.ncesId, 8121);
  assert.deepEqual(resolved.matchedCandidates.map((item) => item.ncesId), [8121, 9001]);
  assert.equal(resolved.matchedCandidates.every((item) => item.code.startsWith("CS203B")), true);
});

test("NCES batch lookup isolates per-course failures and preserves error versus not_found", async () => {
  const adapter = routeAdapter((url) => {
    if (url === "https://ncesnext.com/api/v1/search?q=CS999&type=course&per_page=50") {
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
    if (url === "https://ncesnext.com/api/v1/search?q=BAD500&type=course&per_page=50") {
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

test("NCES batch lookup reuses identical logical lookups across distinct section keys", async () => {
  const calls = {
    byCode: 0,
    exactDetail: 0,
    exactReviews: 0,
    search: 0,
    pickedDetail: 0,
    pickedReviews: 0,
  };
  const adapter = routeAdapter((url) => {
    if (url === "https://ncesnext.com/api/v1/course/by-code/CS109?term=20261") {
      calls.byCode += 1;
      return jsonResponse({ course_id: 7103 });
    }
    if (url === "https://ncesnext.com/api/v1/course/7103") {
      calls.exactDetail += 1;
      return jsonResponse({
        id: 7103,
        name: "计算机程序设计基础",
        course_code: "CS109",
        teacher_names: "陶伊达",
        dept: "计算机科学与工程系",
        term_ids: ["20261"],
        review_term_list: [],
        rate: {
          rate_average: 8.9,
          review_count: 10,
          difficulty_score: 60,
          homework_score: 55,
          grading_score: 85,
          gain_score: 80,
        },
      });
    }
    if (url === "https://ncesnext.com/api/v1/course/7103/reviews?term=20261") {
      calls.exactReviews += 1;
      return jsonResponse({ items: [], total: 0, pages: 0, per_page: 20 });
    }
    if (url === "https://ncesnext.com/api/v1/search?q=CS109&type=course&per_page=50") {
      calls.search += 1;
      return jsonResponse({
        courses: {
          total: 2,
          pages: 1,
          items: [
            {
              id: 7103,
              name: "计算机程序设计基础",
              course_code: "CS109",
              teacher_names: "陶伊达",
              term_ids: ["20261"],
              rate_average: 8.9,
              review_count: 10,
              difficulty_score: 60,
              homework_score: 55,
              grading_score: 85,
              gain_score: 80,
            },
            {
              id: 9851,
              name: "计算机程序设计基础",
              course_code: "CS109",
              teacher_names: "赵耀",
              term_ids: ["20261"],
              rate_average: 0,
              review_count: 0,
              difficulty_score: 0,
              homework_score: 0,
              grading_score: 0,
              gain_score: 0,
            },
          ],
        },
        teachers: { total: 0, pages: 0, items: [] },
        reviews: { total: 0, pages: 0, items: [] },
      });
    }
    if (url === "https://ncesnext.com/api/v1/course/9851") {
      calls.pickedDetail += 1;
      return jsonResponse({
        id: 9851,
        name: "计算机程序设计基础",
        course_code: "CS109",
        teacher_names: "赵耀",
        dept: "计算机科学与工程系",
        term_ids: ["20261"],
        review_term_list: [],
        rate: {
          rate_average: 0,
          review_count: 0,
          difficulty_score: 0,
          homework_score: 0,
          grading_score: 0,
          gain_score: 0,
        },
      });
    }
    if (url === "https://ncesnext.com/api/v1/course/9851/reviews?term=20261") {
      calls.pickedReviews += 1;
      return jsonResponse({ items: [], total: 0, pages: 0, per_page: 20 });
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  const batch = await resolveNcesCourseLookups([
    { key: "001B", code: "CS109", name: "计算机程序设计基础", teachers: ["赵耀"] },
    { key: "001C", code: "CS109", name: "计算机程序设计基础", teachers: ["赵耀"] },
  ], { termId: "20261", includeDetail: true, adapter });

  assert.equal(batch.partial, false);
  assert.equal(batch.items["001B"]?.picked?.ncesId, 9851);
  assert.equal(batch.items["001C"]?.picked?.ncesId, 9851);
  assert.equal(batch.items["001B"]?.detail?.ncesId, 9851);
  assert.equal(batch.items["001C"]?.detail?.ncesId, 9851);
  assert.deepEqual(calls, {
    byCode: 1,
    exactDetail: 1,
    exactReviews: 1,
    search: 1,
    pickedDetail: 1,
    pickedReviews: 1,
  });
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
    if (url === "https://ncesnext.com/api/v1/search?q=CS555&type=course&per_page=50") {
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

test("NCES lookup prefers a teacher-matched search candidate over mismatched exact by-code fallback", async () => {
  const adapter = routeAdapter((url) => {
    if (url === "https://ncesnext.com/api/v1/course/by-code/CS109?term=20261") {
      return jsonResponse({ course_id: 7103 });
    }
    if (url === "https://ncesnext.com/api/v1/course/7103") {
      return jsonResponse({
        id: 7103,
        name: "计算机程序设计基础",
        course_code: "CS109",
        teacher_names: "陶伊达",
        dept: "计算机科学与工程系",
        term_ids: ["20261"],
        review_term_list: ["20251", "20241", "20231"],
        rate: {
          rate_average: 8.9,
          review_count: 10,
          difficulty_score: 60,
          homework_score: 55,
          grading_score: 85,
          gain_score: 80,
        },
      });
    }
    if (url === "https://ncesnext.com/api/v1/course/7103/reviews?term=20261") {
      return jsonResponse({ items: [], total: 0, pages: 0, per_page: 20 });
    }
    if (url === "https://ncesnext.com/api/v1/search?q=CS109&type=course&per_page=50") {
      return jsonResponse({
        courses: {
          total: 3,
          pages: 1,
          items: [
            {
              id: 7101,
              name: "计算机程序设计基础",
              course_code: "CS109",
              teacher_names: "马昱欣",
              term_ids: ["20261"],
              rate_average: 9.28571,
              review_count: 14,
              difficulty_score: 64.29,
              homework_score: 67.86,
              grading_score: 89.29,
              gain_score: 71.43,
            },
            {
              id: 7103,
              name: "计算机程序设计基础",
              course_code: "CS109",
              teacher_names: "陶伊达",
              term_ids: ["20261"],
              rate_average: 8.9,
              review_count: 10,
              difficulty_score: 60,
              homework_score: 55,
              grading_score: 85,
              gain_score: 80,
            },
            {
              id: 9851,
              name: "计算机程序设计基础",
              course_code: "CS109",
              teacher_names: "赵耀",
              term_ids: ["20261"],
              rate_average: 0,
              review_count: 0,
              difficulty_score: 0,
              homework_score: 0,
              grading_score: 0,
              gain_score: 0,
            },
          ],
        },
        teachers: { total: 0, pages: 0, items: [] },
        reviews: { total: 0, pages: 0, items: [] },
      });
    }
    if (url === "https://ncesnext.com/api/v1/course/9851") {
      return jsonResponse({
        id: 9851,
        name: "计算机程序设计基础",
        course_code: "CS109",
        teacher_names: "赵耀",
        dept: "计算机科学与工程系",
        term_ids: ["20261"],
        review_term_list: [],
        rate: {
          rate_average: 0,
          review_count: 0,
          difficulty_score: 0,
          homework_score: 0,
          grading_score: 0,
          gain_score: 0,
        },
      });
    }
    if (url === "https://ncesnext.com/api/v1/course/9851/reviews?term=20261") {
      return jsonResponse({ items: [], total: 0, pages: 0, per_page: 20 });
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  const resolved = await resolveNcesCourseLookup(
    { code: "CS109", name: "计算机程序设计基础", teachers: ["赵耀"] },
    { termId: "20261", includeDetail: true, adapter },
  );

  assert.equal(resolved.status, "matched");
  assert.equal(resolved.confidence, "high");
  assert.equal(resolved.picked?.ncesId, 9851);
  assert.deepEqual(resolved.matchedCandidates.map((item) => item.ncesId), [9851, 7101, 7103]);
  assert.deepEqual(resolved.signals.teacherMatches, ["赵耀"]);
  assert.equal(resolved.signals.termMatched, true);
  assert.equal(resolved.detail?.ncesId, 9851);
  assert.match(resolved.notes[0] ?? "", /teacher-aware ranking selected a different section/i);
});

test("NCES lookup prefers exact by-code term resolution over search-only semester mismatches", async () => {
  const adapter = routeAdapter((url) => {
    if (url === "https://ncesnext.com/api/v1/course/by-code/CS109?term=20222") {
      return jsonResponse({ course_id: 7415 });
    }
    if (url === "https://ncesnext.com/api/v1/course/7415") {
      return jsonResponse({
        id: 7415,
        name: "计算机程序设计基础",
        course_code: "CS109",
        teacher_names: "杨鹏",
        dept: "计算机科学与工程系",
        term_ids: ["20222"],
        review_term_list: ["20222"],
        rate: {
          rate_average: 8.8,
          review_count: 6,
          difficulty_score: 60,
          homework_score: 55,
          grading_score: 72,
          gain_score: 85,
        },
      });
    }
    if (url === "https://ncesnext.com/api/v1/course/7415/reviews?term=20222") {
      return jsonResponse({ items: [], total: 0, pages: 0, per_page: 20 });
    }
    if (url === "https://ncesnext.com/api/v1/search?q=CS109&type=course&per_page=50") {
      return jsonResponse({
        courses: {
          total: 1,
          pages: 1,
          items: [{
            id: 7104,
            name: "计算机程序设计基础",
            course_code: "CS109",
            teacher_names: "朱悦铭",
            term_ids: ["20252"],
            rate_average: 9.6,
            review_count: 18,
            difficulty_score: 50,
            homework_score: 55,
            grading_score: 83,
            gain_score: 94,
          }],
        },
        teachers: { total: 0, pages: 0, items: [] },
        reviews: { total: 0, pages: 0, items: [] },
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  const resolved = await resolveNcesCourseLookup(
    { code: "CS109", name: "计算机程序设计基础", teachers: ["杨鹏"] },
    { termId: "20222", includeDetail: true, adapter },
  );

  assert.equal(resolved.status, "matched");
  assert.equal(resolved.confidence, "high");
  assert.equal(resolved.searchTotal, 1);
  assert.equal(resolved.picked?.ncesId, 7415);
  assert.equal(resolved.signals.termMatched, true);
  assert.deepEqual(resolved.signals.teacherMatches, ["杨鹏"]);
  assert.equal(resolved.detail?.ncesId, 7415);
  assert.equal(resolved.matchedCandidates[0]?.ncesId, 7415);
  assert.match(resolved.notes[0] ?? "", /exact code lookup matched the requested semester directly/i);
});

test("NCES lookup can still resolve from exact by-code when search is unavailable", async () => {
  const adapter = routeAdapter((url) => {
    if (url === "https://ncesnext.com/api/v1/course/by-code/CS109?term=20222") {
      return jsonResponse({ course_id: 7415 });
    }
    if (url === "https://ncesnext.com/api/v1/course/7415") {
      return jsonResponse({
        id: 7415,
        name: "计算机程序设计基础",
        course_code: "CS109",
        teacher_names: "杨鹏",
        dept: "计算机科学与工程系",
        term_ids: ["20222"],
        review_term_list: ["20222"],
        rate: {
          rate_average: 8.8,
          review_count: 6,
          difficulty_score: 60,
          homework_score: 55,
          grading_score: 72,
          gain_score: 85,
        },
      });
    }
    if (url === "https://ncesnext.com/api/v1/course/7415/reviews?term=20222") {
      return jsonResponse({ items: [], total: 0, pages: 0, per_page: 20 });
    }
    if (url === "https://ncesnext.com/api/v1/search?q=CS109&type=course&per_page=50") {
      throw new Error("temporary upstream failure");
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  const resolved = await resolveNcesCourseLookup(
    { code: "CS109", name: "计算机程序设计基础", teachers: ["杨鹏"] },
    { termId: "20222", includeDetail: true, adapter },
  );

  assert.equal(resolved.status, "matched");
  assert.equal(resolved.confidence, "high");
  assert.equal(resolved.searchTotal, 0);
  assert.equal(resolved.items.length, 0);
  assert.deepEqual(resolved.matchedCandidates.map((item) => item.ncesId), [7415]);
  assert.equal(resolved.detail?.ncesId, 7415);
  assert.match(resolved.notes[0] ?? "", /after search was unavailable/i);
});

test("NCES exact by-code fallback avoids review pagination when detail is not requested", async () => {
  const adapter = routeAdapter((url) => {
    if (url === "https://ncesnext.com/api/v1/course/by-code/CS109?term=20222") {
      return jsonResponse({ course_id: 7415 });
    }
    if (url === "https://ncesnext.com/api/v1/course/7415") {
      return jsonResponse({
        id: 7415,
        name: "计算机程序设计基础",
        course_code: "CS109",
        teacher_names: "杨鹏",
        dept: "计算机科学与工程系",
        term_ids: ["20222"],
        review_term_list: ["20222"],
        rate: {
          rate_average: 8.8,
          review_count: 6,
          difficulty_score: 60,
          homework_score: 55,
          grading_score: 72,
          gain_score: 85,
        },
      });
    }
    if (url === "https://ncesnext.com/api/v1/search?q=CS109&type=course&per_page=50") {
      return jsonResponse({
        courses: { total: 0, pages: 0, items: [] },
        teachers: { total: 0, pages: 0, items: [] },
        reviews: { total: 0, pages: 0, items: [] },
      });
    }
    if (url.includes("/reviews")) {
      throw new Error(`Review pagination should not happen without includeDetail: ${url}`);
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  const resolved = await resolveNcesCourseLookup(
    { code: "CS109", name: "计算机程序设计基础", teachers: ["杨鹏"] },
    { termId: "20222", adapter },
  );

  assert.equal(resolved.status, "matched");
  assert.equal(resolved.picked?.ncesId, 7415);
  assert.equal(resolved.detail, undefined);
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
