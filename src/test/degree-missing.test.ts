import assert from "node:assert/strict";
import test from "node:test";
import { formatDegreeMissing } from "../core/text.js";
import { deriveTisDegreeMissing, evaluateTisDegreeMissing, type TisDegreeMissing } from "../tis/degree-missing.js";
import type { TisClient } from "../tis/client.js";
import type { TisDegreeProgress } from "../tis/degree-progress.js";
import type { GradeRecord, PersonalScheduleEntry } from "../tis/types.js";

const SOURCE_STATUSES = {
  graduationRequirements: { state: "available" as const, count: 1 },
  requirementSummary: { state: "available" as const, count: 1 },
  creditCategories: { state: "available" as const, count: 2 },
  moduleRequirements: { state: "available" as const, count: 1 },
  courses: { state: "available" as const, count: 0 },
};

test("degree missing separates definite required gaps, in-progress required courses, and manual review items", () => {
  const progress = makeProgress({
    creditCategories: [
      { name: "通识选修课—艺术类", requiredCredits: 2, completedCredits: 0, remainingCredits: 2, note: "任选一门" },
      { name: "通识选修课—外语类", requiredCredits: 2, completedCredits: 0, remainingCredits: 2, note: "英语分级条件仍需确认" },
    ],
    moduleRequirements: [
      { name: "专业选修课程", passed: false, remainingCredits: 6 },
    ],
    moduleGaps: [
      { name: "专业选修课程", passed: false, remainingCredits: 6 },
    ],
    warnings: [{
      code: "OVERLAPPING_CATEGORIES",
      message: "TIS credit categories can contain overlapping or combined constraints; do not sum category rows as independent totals.",
    }],
    courses: [
      { code: "CS101", name: "数据结构", required: true, credits: 4, category: "专业核心课程" },
      { code: "CS102", name: "算法设计与分析", required: true, credits: 4, category: "专业核心课程" },
      { code: "CS103", name: "操作系统", required: true, credits: 4, category: "专业核心课程" },
      { code: "CS104", name: "编译原理", required: true, credits: 3, category: "专业核心课程" },
      { code: "CS105", name: "计算机网络", required: true, credits: 3, category: "专业核心课程" },
      { code: "HUM200", name: "艺术导论", required: false, credits: 2, category: "通识选修课—艺术类" },
    ],
    sourceStatuses: {
      ...SOURCE_STATUSES,
      courses: { state: "available" as const, count: 6 },
    },
  });
  const grades: GradeRecord[] = [
    grade({ code: "CS101", name: "数据结构", letterGrade: "F", numericScore: 55 }),
    grade({ code: "CS101", name: "数据结构", letterGrade: "B", numericScore: 83 }),
    grade({ code: "CS102", name: "算法设计与分析", letterGrade: "F", numericScore: 59 }),
    grade({ code: "CS104", name: "编译原理", letterGrade: "TBD" }),
  ];
  const enrolled: PersonalScheduleEntry[] = [
    enrolledCourse({ courseCode: "CS103", courseName: "操作系统" }),
  ];

  const result = evaluateTisDegreeMissing({
    progress,
    grades,
    enrolled,
    enrolledSemester: "2026-2027-1",
  });

  assert.deepEqual(result.definiteMissingRequiredCourses.map((entry) => entry.code), ["CS102", "CS105"]);
  assert.deepEqual(result.inProgressRequiredCourses.map((entry) => entry.code), ["CS103"]);
  assert.equal(result.inProgressRequiredCourses[0]?.matchedEnrollmentBy, "code");
  assert.match(result.inProgressRequiredCourses[0]?.reason || "", /2026-2027-1/);
  assert.deepEqual(result.choiceGaps.map((entry) => `${entry.scope}:${entry.name}`), [
    "credit-category:通识选修课—艺术类",
    "credit-category:通识选修课—外语类",
    "module:专业选修课程",
  ]);
  assert.ok(!result.definiteMissingRequiredCourses.some((entry) => entry.code === "CS101"));
  assert.ok(result.manualReview.some((entry) => entry.code === "REQUIRED_COURSE_STATUS_UNCLEAR" && entry.course?.code === "CS104"));
  assert.equal(result.manualReview.filter((entry) => entry.code === "CATEGORY_RULE_NOTE").length, 2);
  assert.ok(result.manualReview.some((entry) => entry.code === "OVERLAPPING_CATEGORY"));
  assert.equal(result.sourceStatuses.progressDetails.state, "available");
  assert.equal(result.sourceStatuses.grades.state, "available");
  assert.equal(result.sourceStatuses.grades.count, 4);
  assert.equal(result.sourceStatuses.enrolled.state, "available");
  assert.equal(result.sourceStatuses.enrolled.count, 1);
  assert.deepEqual(result.counts, {
    definiteMissingRequiredCourses: 2,
    inProgressRequiredCourses: 1,
    choiceGaps: 3,
    manualReview: 4,
  });
  assert.deepEqual(result.advisory, {
    primaryReference: "applicable-official-cultivation-plan",
    message: "TIS 数据可能不完整或不一致，请以本人适用的正式培养方案为准。",
    contact: "如本报告与培养方案不一致或仍有疑问，请联系系秘书或教学工作部确认。",
  });
  const rendered = formatDegreeMissing(result);
  assert.match(rendered, /请以本人适用的正式培养方案为准/);
  assert.match(rendered, /系秘书或教学工作部/);
  assert.match(rendered, /TIS-reported credits/);
  assert.doesNotMatch(rendered, /Official credits/);
});

test("degree missing degrades to manual review when course details or secondary sources are unavailable", () => {
  const progress = makeProgress({
    detailsIncluded: false,
    courses: undefined,
    courseCount: undefined,
    creditCategories: [{ name: "通识选修课—艺术类", remainingCredits: 2 }],
    moduleRequirements: [{ name: "专业核心课程", passed: false, remainingCredits: 4 }],
    moduleGaps: [{ name: "专业核心课程", passed: false, remainingCredits: 4 }],
    sourceStatuses: {
      ...SOURCE_STATUSES,
      courses: { state: "error" as const, message: "course detail unavailable" },
    },
  });

  const result = evaluateTisDegreeMissing({
    progress,
    grades: undefined,
    enrolled: undefined,
  });

  assert.equal(result.definiteMissingRequiredCourses.length, 0);
  assert.equal(result.inProgressRequiredCourses.length, 0);
  assert.equal(result.choiceGaps.length, 2);
  assert.deepEqual(result.manualReview.map((entry) => entry.code), [
    "PROGRESS_DETAILS_UNAVAILABLE",
    "GRADES_UNAVAILABLE",
    "ENROLLED_UNAVAILABLE",
  ]);
  assert.equal(result.sourceStatuses.grades.state, "error");
  assert.equal(result.sourceStatuses.enrolled.state, "error");
});

test("degree missing falls back to course name when a required course has no reliable code", () => {
  const progress = makeProgress({
    courses: [{ name: "创新创业实践", required: true, credits: 2, category: "基础素质培养模块-综合素质类" }],
    sourceStatuses: {
      ...SOURCE_STATUSES,
      courses: { state: "available" as const, count: 1 },
    },
  });

  const result = evaluateTisDegreeMissing({
    progress,
    grades: [],
    enrolled: [enrolledCourse({ courseCode: "", courseName: "创新创业实践" })],
    enrolledSemester: "2026-2027-1",
  });

  assert.equal(result.definiteMissingRequiredCourses.length, 0);
  assert.equal(result.inProgressRequiredCourses.length, 1);
  assert.equal(result.inProgressRequiredCourses[0]?.name, "创新创业实践");
  assert.equal(result.inProgressRequiredCourses[0]?.matchedEnrollmentBy, "name");
});

test("degree missing leaves same-name required courses unresolved when matching rows lack a reliable course code", () => {
  const progress = makeProgress({
    courses: [
      { code: "CS401A", name: "专题研究", required: true, credits: 2 },
      { code: "CS401B", name: "专题研究", required: true, credits: 2 },
    ],
    sourceStatuses: {
      ...SOURCE_STATUSES,
      courses: { state: "available" as const, count: 2 },
    },
  });

  const result = evaluateTisDegreeMissing({
    progress,
    grades: [grade({ code: "", name: "专题研究", letterGrade: "A" })],
    enrolled: [enrolledCourse({ courseCode: "", courseName: "专题研究" })],
    enrolledSemester: "2026-2027-1",
  });

  assert.equal(result.definiteMissingRequiredCourses.length, 0);
  assert.equal(result.inProgressRequiredCourses.length, 0);
  assert.deepEqual(
    result.manualReview
      .filter((entry) => entry.code === "REQUIRED_COURSE_STATUS_UNCLEAR")
      .map((entry) => entry.course?.code)
      .sort(),
    ["CS401A", "CS401B"],
  );
});

test("degree missing can still identify an explicitly failed required course when grades are unavailable", () => {
  const progress = makeProgress({
    courses: [{ code: "CS210", name: "离散数学", required: true, letterGrade: "F", credits: 4 }],
    sourceStatuses: {
      ...SOURCE_STATUSES,
      courses: { state: "available" as const, count: 1 },
    },
  });

  const result = evaluateTisDegreeMissing({
    progress,
    grades: undefined,
    enrolled: [],
  });

  assert.deepEqual(result.definiteMissingRequiredCourses.map((entry) => entry.code), ["CS210"]);
  assert.ok(result.manualReview.some((entry) => entry.code === "GRADES_UNAVAILABLE"));
  assert.ok(!result.manualReview.some((entry) => entry.code === "REQUIRED_COURSE_STATUS_UNCLEAR" && entry.course?.code === "CS210"));
});

test("degree missing orchestration uses the TIS current term for in-progress classification", async () => {
  let enrolledSemester = "";
  const client = {
    async degreeProgress(): Promise<TisDegreeProgress> {
      return makeProgress({
        courses: [{ code: "CS301", name: "计算机网络", required: true, credits: 3 }],
        sourceStatuses: {
          ...SOURCE_STATUSES,
          courses: { state: "available" as const, count: 1 },
        },
      });
    },
    async grades(): Promise<GradeRecord[]> { return []; },
    async currentTerm(): Promise<Record<string, unknown>> {
      return { p_dqxn: "2026-2027", p_dqxq: "1" };
    },
    async enrolled(semester: { value: string }): Promise<PersonalScheduleEntry[]> {
      enrolledSemester = semester.value;
      return [enrolledCourse({ courseCode: "CS301", courseName: "计算机网络" })];
    },
  } as unknown as TisClient;

  const result = await deriveTisDegreeMissing(client, { generatedAt: "2026-08-27T00:00:00Z" });
  assert.equal(enrolledSemester, "2026-2027-1");
  assert.deepEqual(result.enrolledSemester, { value: "2026-2027-1", source: "tis-current-term" });
  assert.deepEqual(result.inProgressRequiredCourses.map((entry) => entry.code), ["CS301"]);
});

test("degree missing orchestration redacts partial-source errors and records date fallback", async () => {
  const client = {
    async degreeProgress(): Promise<TisDegreeProgress> {
      return makeProgress({
        courses: [{ code: "CS302", name: "操作系统", required: true, credits: 4 }],
        sourceStatuses: {
          ...SOURCE_STATUSES,
          courses: { state: "available" as const, count: 1 },
        },
      });
    },
    async grades(): Promise<GradeRecord[]> { throw new Error("password=grade-secret"); },
    async currentTerm(): Promise<Record<string, unknown>> { throw new Error("token=term-secret"); },
    async enrolled(): Promise<PersonalScheduleEntry[]> { throw new Error("cookie=enrolled-secret"); },
  } as unknown as TisClient;

  const result = await deriveTisDegreeMissing(client, {
    generatedAt: "2026-08-27T00:00:00Z",
    today: new Date("2026-08-27T00:00:00Z"),
  });
  assert.deepEqual(result.enrolledSemester, { value: "2025-2026-3", source: "date-fallback" });
  assert.equal(result.definiteMissingRequiredCourses.length, 0);
  assert.ok(result.manualReview.some((entry) => entry.code === "GRADES_UNAVAILABLE"));
  assert.ok(result.manualReview.some((entry) => entry.code === "ENROLLED_UNAVAILABLE"));
  assert.ok(result.manualReview.some((entry) => entry.code === "ENROLLMENT_SEMESTER_FALLBACK"));
  assert.doesNotMatch(JSON.stringify(result), /grade-secret|term-secret|enrolled-secret/);
  assert.match(JSON.stringify(result), /password=\[redacted\]|cookie=\[redacted\]/);
});

function makeProgress(overrides: Partial<TisDegreeProgress> = {}): TisDegreeProgress {
  const base: TisDegreeProgress = {
    schemaVersion: "1",
    kind: "tis-degree-progress",
    reportedAt: "2026-08-27T00:00:00.000Z",
    context: { cohort: "2023", major: "计算机科学与技术", planCode: "2023-CS-1" },
    summary: {
      requiredCredits: 162,
      completedCredits: 133,
      remainingCredits: 29,
      requiredCourses: 56,
      completedCourses: 48,
      remainingCourses: 8,
    },
    creditCategories: [],
    moduleRequirements: [],
    moduleGaps: [],
    dataAvailable: true,
    detailsRequested: true,
    detailsIncluded: true,
    courses: [],
    courseCount: 0,
    sourceStatuses: SOURCE_STATUSES,
    warnings: [],
  };
  const value = { ...base, ...overrides };
  if (value.courses) value.courseCount = value.courses.length;
  return value;
}

function grade(
  input: Partial<GradeRecord> & Pick<GradeRecord, "code" | "name" | "letterGrade">,
): GradeRecord {
  return {
    code: input.code,
    name: input.name,
    nameEn: input.nameEn ?? input.name,
    semester: input.semester ?? "2025-2026-2",
    credits: input.credits ?? 4,
    letterGrade: input.letterGrade,
    ...(input.numericScore !== undefined ? { numericScore: input.numericScore } : {}),
    nature: input.nature ?? "必修",
    department: input.department ?? "计算机科学与工程系",
    ...(input.gpaPoints !== undefined ? { gpaPoints: input.gpaPoints } : {}),
  };
}

function enrolledCourse(
  input: Partial<PersonalScheduleEntry> & Pick<PersonalScheduleEntry, "courseCode" | "courseName">,
): PersonalScheduleEntry {
  return {
    rwh: input.rwh ?? "2026-2027-1-CS103-001",
    key: input.key ?? "fixture",
    courseCode: input.courseCode,
    courseName: input.courseName,
    teacher: input.teacher ?? "教师",
    room: input.room ?? "教室",
    description: input.description ?? "周一第1-2节",
    descriptionEn: input.descriptionEn ?? "Mon 1-2",
    weeks: input.weeks ?? [1, 2, 3],
    ...(input.day !== undefined ? { day: input.day } : {}),
    ...(input.periodStart !== undefined ? { periodStart: input.periodStart } : {}),
    ...(input.periodEnd !== undefined ? { periodEnd: input.periodEnd } : {}),
  };
}

function _assertResultShape(_result: TisDegreeMissing): void {
  // Compile-time guard for the exported result type.
}
