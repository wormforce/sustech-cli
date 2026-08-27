import assert from "node:assert/strict";
import test from "node:test";
import type { TisSession } from "../tis/auth.js";
import { TisClient } from "../tis/client.js";
import { normaliseTisDegreeProgress } from "../tis/degree-progress.js";

const STATUSES = {
  graduationRequirements: { state: "available" as const, count: 1 },
  requirementSummary: { state: "available" as const, count: 1 },
  creditCategories: { state: "available" as const, count: 2 },
  moduleRequirements: { state: "available" as const, count: 2 },
  courses: { state: "available" as const, count: 1 },
};

test("degree progress preserves official overlapping constraints without exposing student IDs", () => {
  const progress = normaliseTisDegreeProgress({
    context: {
      xh: "12310802",
      xjid: "internal-student-row",
      nj: "2023",
      fah: "2023-CS-1",
      pylx: "1",
      zymc: "计算机科学与技术",
    },
    graduationRequirements: [{ YQXDXF: "162", XF: "133", MS: "56", ZYFXMC: "无" }],
    requirementSummary: {
      ywcxf: "132",
      wwcxf: "30",
      ywcms: "48",
      wwcms: "8",
      yqmsxf: { YQXF: "162", YQMS: "56" },
    },
    creditCategories: {
      total: 2,
      list: [
        { XFLBMC: "人文类,社科类", YQWCXF: "6", YWXF: "6", WWXF: "0", YQXS: "96" },
        { XFLBMC: "通识选修课—艺术类", YQWCXF: "2", YWXF: "0", WWXF: "2", BZ: "任选一门" },
      ],
    },
    moduleRequirements: [
      { kzmc: "专业基础课程", sftg: false, wc_xf: "10", wc_ms: "2" },
      { kzmc: "思想政治教育模块", sftg: true, wc_xf: "0", wc_ms: "0" },
    ],
    courses: [{ KCDM: "CS201", KCMC: "数据结构", XF: "4", SFBX: "是" }],
    detailsIncluded: true,
    reportedAt: new Date("2026-08-27T00:00:00.000Z"),
    sourceStatuses: STATUSES,
  });

  assert.deepEqual(progress.summary, {
    requiredCredits: 162,
    completedCredits: 133,
    remainingCredits: 29,
    requiredCourses: 56,
    completedCourses: 48,
    remainingCourses: 8,
    majorTrack: "无",
  });
  assert.equal(progress.creditCategories[1]?.remainingCredits, 2);
  assert.deepEqual(progress.moduleGaps.map((entry) => entry.name), ["专业基础课程"]);
  assert.equal(progress.courses?.[0]?.required, true);
  assert.equal(progress.detailsRequested, true);
  assert.equal(progress.detailsIncluded, true);
  assert.equal(progress.context.cohort, "2023");
  assert.equal(progress.context.planCode, "2023-CS-1");
  assert.doesNotMatch(JSON.stringify(progress), /12310802|internal-student-row/);
  assert.ok(progress.warnings.some((warning) => warning.code === "SOURCE_DISAGREEMENT"));
  assert.ok(progress.warnings.some((warning) => warning.code === "OVERLAPPING_CATEGORIES"));
});

test("TIS client warms the progress page, reuses server context, and keeps optional source failures", async () => {
  const calls: Array<{ method: string; path: string; body?: Record<string, unknown> }> = [];
  const session = {
    async getText(path: string): Promise<string> {
      calls.push({ method: "GET_TEXT", path });
      return "progress page";
    },
    async getJson(path: string): Promise<unknown> {
      calls.push({ method: "GET_JSON", path });
      return { pylx: "1" };
    },
    async postJson(path: string, body: Record<string, unknown>): Promise<unknown> {
      calls.push({ method: "POST_JSON", path, body });
      if (path.endsWith("/getXss")) {
        return { code: 200, content: [{ xh: "12310802", xjid: "xj1", fah: "fa1", nj: "2023", pylx: "1" }] };
      }
      assert.equal(body.fah, "fa1");
      assert.equal(body.xjid, "xj1");
      if (path.endsWith("/querybyyq")) return [{ XF: 133, YQXDXF: 162, MS: 56 }];
      if (path.endsWith("/queryBxkqk")) return { ywcxf: 133, wwcxf: 29, ywcms: 48, wwcms: 8 };
      if (path.endsWith("/queryXflbyq")) {
        return { content: { total: 1, list: [{ XFLBMC: "专业核心课程", YQWCXF: 30, YWXF: 24, WWXF: 6 }] }, code: 200 };
      }
      if (path.endsWith("/queryMkyq")) throw new Error("module source unavailable");
      throw new Error(`Unexpected path ${path}`);
    },
  } as unknown as TisSession;

  const progress = await new TisClient(session).degreeProgress();
  assert.equal(progress.summary.remainingCredits, 29);
  assert.equal(progress.creditCategories[0]?.name, "专业核心课程");
  assert.equal(progress.sourceStatuses.moduleRequirements.state, "error");
  assert.equal(progress.sourceStatuses.courses.state, "not_requested");
  assert.equal(progress.detailsRequested, false);
  assert.equal(progress.detailsIncluded, false);
  assert.ok(calls.some((call) => call.method === "GET_TEXT" && call.path === "/cjgl/grcjcx/cjxqList"));
  assert.ok(!calls.some((call) => call.path.endsWith("/queryFaKzkc")));
});

test("TIS degree-progress detail reads paginate to the declared total", async () => {
  let coursePages = 0;
  const session = {
    async getText(): Promise<string> { return "progress page"; },
    async getJson(): Promise<unknown> { return { pylx: "1" }; },
    async postJson(path: string): Promise<unknown> {
      if (path.endsWith("/getXss")) return [{ fah: "fa1", xjid: "xj1", pylx: "1" }];
      if (path.endsWith("/querybyyq")) return [{ XF: 1, YQXDXF: 2 }];
      if (path.endsWith("/queryBxkqk")) return { ywcxf: 1, wwcxf: 1 };
      if (path.endsWith("/queryXflbyq")) return { total: 0, list: [] };
      if (path.endsWith("/queryMkyq")) return [];
      if (path.endsWith("/queryFaKzkc")) {
        coursePages += 1;
        const count = coursePages === 1 ? 500 : 1;
        return {
          total: 501,
          list: Array.from({ length: count }, (_, index) => ({
            KCDM: `CS${coursePages}-${index}`,
            KCMC: "Fixture",
          })),
        };
      }
      throw new Error(`Unexpected path ${path}`);
    },
  } as unknown as TisSession;

  const progress = await new TisClient(session).degreeProgress({ details: true });
  assert.equal(progress.courseCount, 501);
  assert.equal(coursePages, 2);
  assert.equal(progress.sourceStatuses.courses.count, 501);
  assert.equal(progress.detailsRequested, true);
  assert.equal(progress.detailsIncluded, true);
});

test("TIS degree progress distinguishes a failed requested detail source from a successful empty table", async () => {
  const session = {
    async getText(): Promise<string> { return "progress page"; },
    async getJson(): Promise<unknown> { return { pylx: "1" }; },
    async postJson(path: string): Promise<unknown> {
      if (path.endsWith("/getXss")) return [{ fah: "fa1", xjid: "xj1", pylx: "1" }];
      if (path.endsWith("/querybyyq")) return [{ XF: 80, YQXDXF: 100 }];
      if (path.endsWith("/queryBxkqk")) return { ywcxf: 80, wwcxf: 20 };
      if (path.endsWith("/queryXflbyq")) return { total: 0, list: [] };
      if (path.endsWith("/queryMkyq")) return [];
      if (path.endsWith("/queryFaKzkc")) throw new Error("course detail unavailable");
      throw new Error(`Unexpected path ${path}`);
    },
  } as unknown as TisSession;

  const progress = await new TisClient(session).degreeProgress({ details: true });
  assert.equal(progress.detailsRequested, true);
  assert.equal(progress.detailsIncluded, false);
  assert.equal(progress.courses, undefined);
  assert.equal(progress.courseCount, undefined);
  assert.equal(progress.sourceStatuses.courses.state, "error");
});

test("TIS degree progress fails closed when all downstream sources contain no usable plan data", async () => {
  const session = {
    async getText(): Promise<string> { return "progress page"; },
    async getJson(): Promise<unknown> { return { pylx: "1" }; },
    async postJson(path: string): Promise<unknown> {
      if (path.endsWith("/getXss")) return [{ fah: "fa1", xjid: "xj1", pylx: "1" }];
      if (path.endsWith("/queryXflbyq")) return { total: 0, list: [] };
      return [];
    },
  } as unknown as TisSession;

  await assert.rejects(
    new TisClient(session).degreeProgress(),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, "TIS_DEGREE_PROGRESS_NO_DATA");
      return true;
    },
  );
});
