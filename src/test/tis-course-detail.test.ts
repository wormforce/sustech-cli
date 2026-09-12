import assert from "node:assert/strict";
import test from "node:test";
import type { Semester } from "../core/semester.js";
import { CliError } from "../core/errors.js";
import type { TisSession } from "../tis/auth.js";
import { TisClient } from "../tis/client.js";
import { formatCourseDetail } from "../tis/course-detail-text.js";
import { readCourseDetail, validateCourseDetailOptions } from "../tis/course-detail.js";

const semester: Semester = { xn: "2026-2027", xq: "1", value: "2026-2027-1" };
const task = { kcid: "COURSE-LIBRARY-ID", id: "MUTATION-ID", kcdm: "DEMO101", kcmc: "课程示例", rwh: "2026-2027-1-DEMO101-001", xf: 3, dgjsmc: "Teacher", skyymc: "英文", kclbmc: "核心课", zrl: 10 };

function fixture(options: { tasks?: Record<string, unknown>[]; detailCode?: string; selection?: Record<string, unknown>[]; prerequisiteFailure?: boolean } = {}) {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const session = {
    async postForm(path: string, body: Record<string, unknown>) {
      calls.push({ path, body });
      if (path === "/Xsxktz/queryRwxxcxList") return { rwList: { total: (options.tasks ?? [task]).length, list: options.tasks ?? [task] } };
      if (path === "/kck/kcxxwh/xsckViewByxk") return { code: 200, content: {
        kcxxbgbEntity: { kcdm: options.detailCode ?? "DEMO101", xf: 3, sjzxs: 64, sjllxs: 32, sjsyxs: 32,
          skyymc: "中文", kclbmc: "选修课", sfyxxk: "1", xxkcms: "CS100 或 CS101", jxmb: "<p>Learn</p>",
          kcnr: "<p>Week 1</p><p>Week 2<script>DO_NOT_PRINT</script></p>", jcjqtzl: "Book",
          p_sql: "SECRET_SQL", xuesheng: "PRIVATE_STUDENT", xscj: "PRIVATE_GRADE" },
        kcdgbentity: { kczwjj: "<p>简介<br>第二行</p>", kczwdgwjm: "syllabus.pdf", kczwdg: "DO_NOT_EXPOSE_PATH" },
        kctdwhEntityList: [{ jsxm: "Teacher", sffzrmc: "负责人", zgh: "PRIVATE_STAFF" }],
      } };
      if (path === "/Xsxk/queryYxkc") return { yxkcList: options.selection ?? [{ ...task,
        yxzrs: "10", bksyxrs: "10", yjsyxrs: "0", nansyxrs: "0", nvsyxrs: "10", sxbj: "A",
        yxzrlrs: "8", bksrl: "8", dnyxrs: null, xkyq: "<p>Bring laptop</p>",
        xm: "PRIVATE_NAME", ip: "PRIVATE_IP", xscj: "PRIVATE_GRADE" }], xkgwcList: [],
        xsxkPage: { p_sql: "SECRET_SQL" } };
      if (path === "/Xsxk/queryXkdqXnxq") return { p_dqxn: semester.xn, p_dqxq: semester.xq };
      if (path === "/Xsxk/queryKxrw") return { jg: "1", kxrwList: { list: [{ ...task, yxzrs: "12", nansyxrs: "8", nvsyxrs: "4", ctkcxx: "<b>Time conflict</b>" }] },
        xsxkPage: { xkgzszOne: { xkfsdm: "bxxk", xkfsmc: "必修", lcmc: "补退选", ksrq: "2026-09-11 13:00", jsrq: "2026-09-24 17:30", yzsql: "SECRET_SQL" } } };
      throw new Error(`Unexpected read path: ${path}`);
    },
    async postJson(path: string, body: Record<string, unknown>) {
      calls.push({ path, body });
      if (options.prerequisiteFailure) throw new CliError("PRIVATE_ERROR_BODY", "TEST_SOURCE_DOWN");
      if (path === "/kck/xxxxkzkc/queryXxkc") return { total: 3, list: [{ kcdm: "CS100", kcmc: "编程", xf: 3, raw: "PRIVATE" }, { kcdm: "CS100", kcmc: "编程", xf: 3 }, { kcdm: "CS101", kcmc: "Python", xf: 3 }] };
      if (path === "/kck/xxxxkzkc/queryXxkcBySq") return { xxkcms: "<p>CS100 或 CS101</p>" };
      throw new Error(`Unexpected read path: ${path}`);
    },
  };
  return { session, calls };
}

const noSelection = async () => { throw new Error("Selection query was not requested"); };

test("course detail preserves zero counts, separate quotas and prerequisite alternatives without raw identity", async () => {
  const { session, calls } = fixture();
  const result = await readCourseDetail(session, semester, { code: "demo101" }, noSelection);
  assert.equal(result.course.code, "DEMO101");
  assert.equal(result.enrollment.counts.male, 0);
  assert.equal(result.enrollment.counts.graduate, 0);
  assert.equal(result.enrollment.counts.internal, undefined);
  assert.equal(result.enrollment.femalePercentage, 100);
  assert.equal(result.enrollment.undergraduatePercentage, 100);
  assert.equal(result.enrollment.quotaCounts.total, 8);
  assert.equal(result.enrollment.counts.total, 10);
  assert.equal(result.enrollment.status?.label, "候补");
  assert.deepEqual(result.prerequisites.courses.map(row => row.code), ["CS100", "CS101"]);
  assert.equal(result.prerequisites.description, "CS100 或 CS101");
  assert.equal(result.content.outline, "Week 1\nWeek 2");
  assert.equal(result.content.introduction, "简介\n第二行");
  assert.equal(result.catalog.hours.laboratory, 32);
  assert.equal(result.course.language, "英文");
  assert.equal(result.catalog.language, "中文");
  assert.equal(result.notices.filter(row => row.kind === "source-difference").length, 2);
  assert.equal(result.attachments[0].authentication, "tis");
  assert.equal(new URL(result.attachments[0].url).searchParams.get("kcid"), "COURSE-LIBRARY-ID");
  assert.equal(calls.find(call => call.path.endsWith("xsckViewByxk"))?.body.kcid, "COURSE-LIBRARY-ID");
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|SECRET_SQL|DO_NOT_/);
  const rendered = formatCourseDetail(result);
  assert.match(rendered, /male 0/);
  assert.match(rendered, /Week 1\nWeek 2/);
  assert.match(rendered, /Bring laptop/);
  assert.doesNotMatch(rendered, /<p>|PRIVATE_|SECRET_SQL/);
});

test("ambiguous teaching tasks require rwh before detail or personal queries", async () => {
  const second = { ...task, rwh: "2026-2027-1-DEMO101-002" };
  const { session, calls } = fixture({ tasks: [task, second] });
  await assert.rejects(readCourseDetail(session, semester, { code: "DEMO101" }, noSelection),
    (error: unknown) => error instanceof CliError && error.code === "TIS_COURSE_AMBIGUOUS");
  assert.equal(calls.length, 1);
  const result = await readCourseDetail(session, semester, { code: "DEMO101", rwh: second.rwh }, noSelection);
  assert.equal(result.course.rwh, second.rwh);
  assert.equal(result.enrollment.counts.total, undefined); // First section's population must not leak into the second.
  assert.equal(result.enrollment.source, "catalog");
});

test("course detail rejects mismatched course responses and validates identifiers before reading", async () => {
  const { session, calls } = fixture({ detailCode: "OTHER101" });
  await assert.rejects(readCourseDetail(session, semester, { code: "DEMO101" }, noSelection),
    (error: unknown) => error instanceof CliError && error.code === "TIS_COURSE_DETAIL_PROTOCOL_ERROR");
  assert.equal(calls.length, 2);
  assert.throws(() => validateCourseDetailOptions({ code: "../../profile" }), /exact course code/);
  assert.throws(() => validateCourseDetailOptions({ code: "DEMO101", rwh: "A\nB" }), /single identifiers/);
});

test("partial enrichment failures retain the course without exposing errors or claiming no prerequisites", async () => {
  const { session } = fixture({ prerequisiteFailure: true });
  const result = await readCourseDetail(session, semester, { code: "DEMO101" }, noSelection);
  assert.equal(result.sources.prerequisites.state, "unavailable");
  assert.equal(result.sources.prerequisiteDescription.state, "unavailable");
  assert.equal(result.prerequisites.description, "CS100 或 CS101");
  assert.match(formatCourseDetail(result), /TEST_SOURCE_DOWN/);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_ERROR_BODY/);
});

test("round enrichment reuses selection transport and exposes only matching task counts and notices", async () => {
  const { session, calls } = fixture();
  const result = await new TisClient(session as unknown as TisSession).courseDetail(semester, { code: "DEMO101", round: "bxxk" });
  assert.equal(result.enrollment.source, "available");
  assert.equal(result.enrollment.counts.total, 12);
  assert.equal(result.enrollment.femalePercentage, 33.3);
  assert.equal(result.enrollment.status?.label, "候补");
  assert.equal(result.selection?.period, "补退选");
  assert.ok(result.notices.some(row => row.kind === "time-conflict"));
  assert.ok(result.notices.some(row => row.kind === "quota-context"));
  const query = calls.find(call => call.path === "/Xsxk/queryKxrw")!;
  assert.equal(query.body.p_xkfsdm, "bxxk");
  assert.equal(query.body.p_gjz, "DEMO101");
  assert.equal(query.body.pageSize, "100");
  assert.doesNotMatch(JSON.stringify(result), /SECRET_SQL|PRIVATE_/);
});

test("unavailable selection rounds do not discard course-library details", async () => {
  const { session } = fixture();
  const result = await readCourseDetail(session, semester, { code: "DEMO101", round: "xxxk" }, async () => {
    throw new CliError("PRIVATE_RESPONSE", "SELECTION_UNAVAILABLE");
  });
  assert.equal(result.sources.availability.state, "unavailable");
  assert.equal(result.enrollment.source, "enrolled");
  assert.equal(result.selection, undefined);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_RESPONSE/);
});

test("inconsistent or unknown aggregate counts do not become invented percentages", async () => {
  const { session } = fixture({ selection: [{ ...task, yxzrs: "10", nansyxrs: "8", nvsyxrs: "5", bksyxrs: "", yjsyxrs: null, sxbj: "W" }] });
  const result = await readCourseDetail(session, semester, { code: "DEMO101" }, noSelection);
  assert.equal(result.enrollment.femalePercentage, undefined);
  assert.equal(result.enrollment.undergraduatePercentage, undefined);
  assert.equal(result.enrollment.counts.undergraduate, undefined);
  assert.deepEqual(result.enrollment.status, { code: "W", label: "未知" });
});
