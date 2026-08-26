import assert from "node:assert/strict";
import test from "node:test";
import {
  EvaluationStatusClient,
  parseEvaluationQuestionBlocks,
  summariseEvaluationStatuses,
} from "../tis/remaining-evaluation.js";

test("evaluation status service normalises categories, statuses, and compact semester codes", async () => {
  const calls: Array<{ path: string; params: Record<string, string> }> = [];
  const requester = {
    async getJson(path: string, params: Record<string, string>): Promise<unknown> {
      calls.push({ path, params });
      if (path.endsWith("listObtainPersonnelEvaluationTasks")) {
        return {
          result: {
            list: [
              { rwid: "task-1", firstwjid: "wj-1", rwmc: "学生评价（理论类）" },
            ],
          },
        };
      }
      return {
        code: "200",
        result: {
          list: [
            { kcdm: "CS101", kcmc: "程序设计", lsjgzt: "0", wjid: "wj-1", jgwid: "rel-1", rwh: "R1", sxz: "uuid-1" },
            { kcdm: "MA102", kcmc: "高等数学", lsjgzt: "3", wjid: "wj-2", jgwid: "rel-2", rwh: "R2" },
            { kcdm: "PH103", kcmc: "大学物理", lsjgzt: "5", wjid: "wj-3", jgwid: "rel-3", rwh: "R3" },
          ],
        },
      };
    },
  };

  const client = new EvaluationStatusClient(requester, "12210000");
  const courses = await client.listCourses("2025-2026-2", "all");
  assert.equal(courses.length, 3);
  assert.equal(courses[0].taskType, "理论类");
  assert.equal(courses[2].submitted, true);
  assert.deepEqual(summariseEvaluationStatuses(courses), {
    total: 3,
    pending: 1,
    draft: 1,
    submitted: 1,
  });
  assert.equal(calls[1]?.params.xnxq, "2025-20262");
});

test("evaluation status service follows category and course pagination", async () => {
  const calls: string[] = [];
  const requester = {
    async getJson(path: string, params: Record<string, string>): Promise<unknown> {
      calls.push(`${path}:${params.rwid ?? "categories"}:${params.pageNum}`);
      if (path.endsWith("listObtainPersonnelEvaluationTasks")) {
        return params.pageNum === "1"
          ? { result: { list: [{ rwid: "task-1", firstwjid: "wj-1", rwmc: "理论" }], pages: 2, total: 2 } }
          : { result: { list: [{ rwid: "task-2", firstwjid: "wj-2", rwmc: "实验" }], pages: 2, total: 2 } };
      }
      if (params.rwid === "task-1") {
        return params.pageNum === "1"
          ? { code: "200", result: { list: [{ kcdm: "CS101", kcmc: "A", lsjgzt: "0" }], pages: 2, total: 2 } }
          : { code: "200", result: { list: [{ kcdm: "CS102", kcmc: "B", lsjgzt: "2" }], pages: 2, total: 2 } };
      }
      return { code: "200", result: { list: [{ kcdm: "CS103", kcmc: "C", lsjgzt: "3" }], pages: 1, total: 1 } };
    },
  };

  const rows = await new EvaluationStatusClient(requester, "12210000").listCourses("2025-2026-2");
  assert.deepEqual(rows.map((row) => row.courseCode), ["CS101", "CS102", "CS103"]);
  assert.ok(calls.some((call) => call.endsWith("task-1:2")));
  assert.ok(calls.some((call) => call.endsWith("categories:2")));
});

test("evaluation snapshot parser extracts question blocks without a browser runtime", () => {
  const blocks = parseEvaluationQuestionBlocks({
    wjlist: [
      {
        pjxtWjWjbReturnEntity: {
          wjzblist: [
            {
              zmc: "课程评价",
              zxssx: "1",
              tklist: [
                { tmid: "q1", tgmc: "请打分", tmlx: "1", tmfz: "10", jsonContent: "[\"1\",\"2\",\"3\",\"4\",\"5\"]" },
                { tmid: "q2", tgmc: "请留言", tmlx: "text", jsonContent: "[]" },
              ],
            },
          ],
        },
      },
    ],
  });

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.questions[0]?.kind, "rating");
  assert.equal(blocks[0]?.questions[1]?.kind, "text");
  assert.deepEqual(blocks[0]?.questions[0]?.options, ["1", "2", "3", "4", "5"]);
});
