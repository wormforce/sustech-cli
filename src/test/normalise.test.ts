import assert from "node:assert/strict";
import test from "node:test";
import { currentSemester, parseSemester } from "../core/semester.js";
import { buildWritePayload } from "../tis/client.js";
import { normaliseCourse, parseScheduleLine } from "../tis/normalise.js";

test("currentSemester follows the SUSTech fall, spring, summer term convention", () => {
  assert.deepEqual(currentSemester(new Date("2026-10-01")), {
    xn: "2026-2027",
    xq: "1",
    value: "2026-2027-1",
  });
  assert.deepEqual(currentSemester(new Date("2026-03-01")), {
    xn: "2025-2026",
    xq: "2",
    value: "2025-2026-2",
  });
  assert.deepEqual(currentSemester(new Date("2026-08-01")), {
    xn: "2025-2026",
    xq: "3",
    value: "2025-2026-3",
  });
});

test("normaliseCourse emits Agent-ready schedule data without leaking kcxx HTML", () => {
  const course = normaliseCourse({
    kcdm: "MSE306",
    kcmc: "材料科学",
    rwmc: "材料科学 001",
    rwh: "2025-2026-3-MSE306-001",
    kxh: "001",
    dgjsmc: "张三、李四",
    xf: "3",
    zxs: "48",
    zrl: "60",
    pylx: "1",
    kcxx: '<span class="ivu-tag-text"><p>1-15周,星期一第3-4节 一教324</p></span>',
  });
  assert.equal(course.code, "MSE306");
  assert.deepEqual(course.teachers, ["张三", "李四"]);
  assert.deepEqual(course.schedule, [
    { weeks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], day: 1, dayName: "周一", periodStart: 3, periodEnd: 4, room: "一教324" },
  ]);
});

test("schedule parser respects odd/even week constraints", () => {
  assert.deepEqual(parseScheduleLine("1-8单周,星期三第7-8节 慧园2栋509")?.weeks, [1, 3, 5, 7]);
  assert.deepEqual(parseScheduleLine("1-8双周,星期三第7-8节 慧园2栋509")?.weeks, [2, 4, 6, 8]);
});

test("enrollment payload retains the HAR-derived TIS write fields", () => {
  const payload = buildWritePayload(
    {
      semester: parseSemester("2025-2026-3"),
      courseId: "0123456789abcdef0123456789abcdef",
      round: "yixuan",
      bid: 2,
      cultivation: "1",
    },
    { p_dqxn: "2025-2026", p_dqxq: "3", p_dqxnxq: "2025-20263", cxsfmt: "0" },
  );
  assert.equal(payload.p_id, "0123456789abcdef0123456789abcdef");
  assert.equal(payload.p_xktjz, "gwctjzyx");
  assert.equal(payload.p_xkxs, 2);
  assert.equal(payload.p_dqxnxq, "2025-20263");
});
