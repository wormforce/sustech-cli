import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCourseDecisionNcesLookupRequests,
  courseDecisionKey,
  explainCourseDecision,
  recommendCourseSections,
  selectCourseDecisionCandidates,
} from "../tis/course-decision.js";
import { createPlanDocument } from "../tis/plan.js";
import { parseBlockedTime } from "../tis/planner.js";
import type { TisDegreeMissing } from "../tis/degree-missing.js";
import type { TisDegreeProgress } from "../tis/degree-progress.js";
import type { Course, ScheduleSlot } from "../tis/types.js";
import type { NcesResolvedCourse } from "../services/nces.js";

const SOURCE_STATUSES = {
  graduationRequirements: { state: "available" as const, count: 1 },
  requirementSummary: { state: "available" as const, count: 1 },
  creditCategories: { state: "available" as const, count: 0 },
  moduleRequirements: { state: "available" as const, count: 0 },
  courses: { state: "available" as const, count: 0 },
};

test("course decision combines plan, definite missing, seat capacity, and NCES into a strong recommendation", () => {
  const cs102 = fixtureCourse({
    code: "CS102",
    name: "算法设计与分析",
    classGroup: "01",
    rwh: "2026-CS102-01",
    capacity: 60,
    enrolled: 42,
    schedule: [fixtureSlot({ day: 2, periodStart: 3, periodEnd: 4 })],
  });
  const hum200 = fixtureCourse({
    code: "HUM200",
    name: "艺术导论",
    classGroup: "01",
    rwh: "2026-HUM200-01",
    schedule: [fixtureSlot({ day: 4, periodStart: 1, periodEnd: 2 })],
  });

  const decision = explainCourseDecision({
    course: cs102,
    selectableCourses: [cs102, hum200],
    plan: createPlanDocument({
      semester: { xn: "2026-2027", xq: "1", value: "2026-2027-1" },
      requestedCodes: ["CS102", "HUM200"],
    }),
    degreeMissing: fixtureDegreeMissing({
      definiteMissingRequiredCourses: [{
        code: "CS102",
        name: "算法设计与分析",
        groups: ["专业核心课程"],
        categories: ["专业核心课程"],
        credits: 4,
        reason: "The required course has no passing attempt and is not present in current enrollment.",
      }],
    }),
    nces: fixtureNces({
      picked: {
        ncesId: 212,
        code: "CS102",
        name: "算法设计与分析",
        teacher: "李四",
        semester: "2022春",
        semesters: ["2022春"],
        rating: 9.1,
        reviewCount: 36,
        difficulty: { label: "Easy", pct: 78 },
        workload: { label: "Average", pct: 61 },
        grading: { label: "Excellent", pct: 82 },
        takeaways: { label: "High", pct: 91 },
        directUrl: "https://ncesnext.com/course/212/",
      },
      confidence: "high",
      status: "matched",
      signals: {
        exactCode: true,
        baseCode: true,
        name: true,
        teacherMatches: ["李四"],
        termMatched: true,
      },
    }),
  });

  assert.equal(decision.verdict, "strong_recommend");
  assert.equal(decision.plan.requested, true);
  assert.equal(decision.plan.compatibleWithPlan, true);
  assert.equal(decision.degree.state, "required-gap");
  assert.deepEqual(decision.degree.manualReview, []);
  assert.equal(decision.capacity.remainingSeats, 18);
  assert.equal(decision.nces.status, "matched");
  assert.ok(decision.score.plan > 0);
  assert.ok(decision.score.degree > 0);
  assert.ok(decision.score.capacity > 0);
  assert.ok(decision.score.nces > 0);
  assert.ok(decision.score.total >= 34);
  assert.ok(decision.reasons.some((reason) => reason.message.includes("definite missing required course")));
});

test("course decision avoids blocked or already-completed sections even when NCES is positive", () => {
  const cs105 = fixtureCourse({
    code: "CS105",
    name: "计算机网络",
    classGroup: "01",
    rwh: "2026-CS105-01",
    capacity: 50,
    enrolled: 50,
    schedule: [fixtureSlot({ day: 1, periodStart: 1, periodEnd: 2 })],
  });

  const decision = explainCourseDecision({
    course: cs105,
    selectableCourses: [cs105],
    plan: createPlanDocument({
      requestedCodes: ["CS105"],
      blocked: [parseBlockedTime("MON:1-2")],
    }),
    degreeProgress: fixtureProgress({
      courses: [{ code: "CS105", name: "计算机网络", required: true, letterGrade: "A", credits: 3 }],
      courseCount: 1,
    }),
    nces: fixtureNces({
      picked: {
        ncesId: 300,
        code: "CS105",
        name: "计算机网络",
        teacher: "张老师",
        semester: "2022春",
        semesters: ["2022春"],
        rating: 9.4,
        reviewCount: 21,
        difficulty: { label: "Easy", pct: 73 },
        workload: { label: "Average", pct: 55 },
        grading: { label: "Excellent", pct: 80 },
        takeaways: { label: "High", pct: 88 },
        directUrl: "https://ncesnext.com/course/300/",
      },
      confidence: "high",
    }),
  });

  assert.equal(decision.verdict, "avoid");
  assert.equal(decision.plan.blockedConflict, true);
  assert.equal(decision.degree.state, "already-completed");
  assert.deepEqual(decision.degree.manualReview, []);
  assert.equal(decision.capacity.remainingSeats, 0);
  assert.ok(decision.score.schedule < 0);
  assert.ok(decision.score.degree < 0);
  assert.ok(decision.score.capacity < 0);
});

test("course recommendation reports partial source status and isolates per-course NCES errors", () => {
  const cs201 = fixtureCourse({
    code: "CS201",
    name: "数据结构",
    classGroup: "01",
    rwh: "2026-CS201-01",
    capacity: 80,
    enrolled: 60,
    category: "专业核心课程",
    schedule: [fixtureSlot({ day: 2, periodStart: 1, periodEnd: 2 })],
  });
  const art201 = fixtureCourse({
    code: "ART201",
    name: "艺术与审美",
    classGroup: "01",
    rwh: "2026-ART201-01",
    capacity: 40,
    enrolled: 10,
    category: "通识选修课—艺术类",
    schedule: [fixtureSlot({ day: 5, periodStart: 5, periodEnd: 6 })],
  });
  const free100 = fixtureCourse({
    code: "FREE100",
    name: "自由选读",
    classGroup: "01",
    rwh: "2026-FREE100-01",
    capacity: 30,
    enrolled: 29,
    schedule: [fixtureSlot({ day: 3, periodStart: 7, periodEnd: 8 })],
  });

  const report = recommendCourseSections({
    selectableCourses: [cs201, art201, free100],
    plan: createPlanDocument({
      requestedCodes: ["CS201", "MA203"],
    }),
    degreeMissing: fixtureDegreeMissing({
      definiteMissingRequiredCourses: [{
        code: "CS201",
        name: "数据结构",
        groups: ["专业核心课程"],
        categories: ["专业核心课程"],
        credits: 4,
        reason: "The required course has no passing attempt and is not present in current enrollment.",
      }],
      choiceGaps: [{
        scope: "credit-category",
        name: "通识选修课—艺术类",
        remainingCredits: 2,
      }],
    }),
    ncesByKey: {
      [courseDecisionKey(cs201)]: fixtureNces({
        picked: {
          ncesId: 401,
          code: "CS201",
          name: "数据结构",
          teacher: "李四",
          semester: "2022春",
          semesters: ["2022春"],
          rating: 8.8,
          reviewCount: 24,
          difficulty: { label: "Easy", pct: 75 },
          workload: { label: "Average", pct: 58 },
          grading: { label: "Excellent", pct: 77 },
          takeaways: { label: "High", pct: 84 },
          directUrl: "https://ncesnext.com/course/401/",
        },
        confidence: "high",
      }),
      [courseDecisionKey(art201)]: {
        ...fixtureNces(),
        status: "error",
        errorMessage: "token=[redacted]",
      },
    },
  });

  assert.equal(report.items[0]?.course.code, "CS201");
  assert.equal(report.items[1]?.course.code, "ART201");
  assert.equal(report.partial, true);
  assert.equal(report.sourceStatuses.selectable.state, "available");
  assert.equal(report.sourceStatuses.degree.state, "available");
  assert.equal(report.sourceStatuses.nces.state, "partial");
  assert.match(report.advisory.officialReference, /TIS selectable data/i);
  assert.deepEqual(report.items[0]?.plan.uncheckedRequestedCodes, ["MA203"]);
  assert.equal(report.items[1]?.nces.status, "error");
  assert.match(report.items[1]?.warnings.join("\n") || "", /token=\[redacted\]/);
});

test("course recommendation tie-break stays deterministic when scores are equal", () => {
  const alpha = fixtureCourse({
    code: "AA100",
    name: "Alpha",
    classGroup: "01",
    rwh: "aa",
    schedule: [fixtureSlot({ day: 2, periodStart: 3, periodEnd: 4 })],
  });
  const beta = fixtureCourse({
    code: "BB100",
    name: "Beta",
    classGroup: "01",
    rwh: "bb",
    schedule: [fixtureSlot({ day: 2, periodStart: 3, periodEnd: 4 })],
  });

  const report = recommendCourseSections({
    selectableCourses: [beta, alpha],
  });

  assert.deepEqual(report.items.map((item) => item.course.code), ["AA100", "BB100"]);
  assert.equal(report.sourceStatuses.selectable.state, "available");
  assert.equal(report.sourceStatuses.degree.state, "unavailable");
  assert.equal(report.sourceStatuses.nces.state, "unavailable");
});

test("course decision keeps degree reasoning partial when progress details are unavailable", () => {
  const course = fixtureCourse({
    code: "HUM300",
    name: "戏剧鉴赏",
    classGroup: "01",
    rwh: "hum300",
    category: "通识选修课—艺术类",
    schedule: [fixtureSlot({ day: 4, periodStart: 9, periodEnd: 10 })],
  });

  const decision = explainCourseDecision({
    course,
    selectableCourses: [course],
    degreeProgress: fixtureProgress({
      detailsIncluded: false,
      courses: undefined,
      courseCount: undefined,
      creditCategories: [{ name: "通识选修课—艺术类", remainingCredits: 2 }],
      sourceStatuses: {
        ...SOURCE_STATUSES,
        courses: { state: "error" as const, message: "detail unavailable" },
      },
    }),
  });

  assert.equal(decision.degree.state, "choice-gap");
  assert.equal(decision.degree.matchedRequiredCourse, undefined);
  assert.deepEqual(decision.degree.manualReview, []);
  assert.equal(decision.partial, true);
  assert.ok(decision.warnings.some((warning) => warning.includes("course details were unavailable")));
});

test("course recommendation leaves same-name degree gaps as manual review instead of claiming relevance", () => {
  const course = fixtureCourse({
    code: "GEN301",
    name: "专题研讨",
    classGroup: "01",
    rwh: "gen301",
    category: "自由选修",
    nature: "任选",
    schedule: [fixtureSlot({ day: 3, periodStart: 3, periodEnd: 4 })],
  });

  const report = recommendCourseSections({
    selectableCourses: [course],
    degreeMissing: fixtureDegreeMissing({
      definiteMissingRequiredCourses: [{
        name: "专题研讨",
        groups: ["培养方案人工核对"],
        categories: ["培养方案人工核对"],
        reason: "Same-name requirement row has no reliable code in the current TIS payload.",
      }],
    }),
  });

  assert.equal(report.items[0]?.degree.state, "unknown");
  assert.equal(report.items[0]?.degree.matchedRequiredCourse, undefined);
  assert.ok((report.items[0]?.degree.manualReview.length ?? 0) > 0);
  assert.equal(report.sourceStatuses.degree.state, "partial");
  assert.match(report.sourceStatuses.degree.message || "", /manual degree review/i);
});

test("course recommendation keeps explicit degree-missing manual-review hits as unknown even when choice gaps match", () => {
  const byCode = fixtureCourse({
    code: "CS330",
    name: "机器学习",
    classGroup: "01",
    rwh: "cs330",
    category: "专业选修课程",
    nature: "选修",
    schedule: [fixtureSlot({ day: 2, periodStart: 7, periodEnd: 8 })],
  });
  const byName = fixtureCourse({
    code: "GEN401",
    name: "专题研讨",
    classGroup: "02",
    rwh: "gen401",
    category: "自由选修",
    nature: "任选",
    schedule: [fixtureSlot({ day: 4, periodStart: 3, periodEnd: 4 })],
  });

  const report = recommendCourseSections({
    selectableCourses: [byCode, byName],
    degreeMissing: fixtureDegreeMissing({
      choiceGaps: [
        { scope: "module", name: "专业选修课程", remainingCredits: 3 },
        { scope: "credit-category", name: "自由选修", remainingCredits: 2 },
      ],
      manualReview: [
        {
          code: "REQUIRED_COURSE_STATUS_UNCLEAR",
          message: "CS330 requires manual confirmation because the latest TIS result is ambiguous.",
          course: { code: "CS330", name: "机器学习" },
        },
        {
          code: "REQUIRED_COURSE_IDENTITY_UNCLEAR",
          message: "专题研讨 appears in TIS without a reliable course code and must be matched manually.",
          course: { name: "专题研讨" },
        },
      ],
    }),
  });

  assert.deepEqual(report.items.map((item) => item.degree.state), ["unknown", "unknown"]);
  assert.ok(report.items.every((item) => item.degree.manualReview.length > 0));
  assert.equal(report.items[0]?.degree.matchedRequiredCourse, undefined);
  assert.equal(report.items[1]?.degree.matchedRequiredCourse, undefined);
  assert.equal(report.sourceStatuses.degree.state, "partial");
});

test("course recommendation reports NCES empty when no reliable matches exist and partial when matches are ambiguous", () => {
  const alpha = fixtureCourse({
    code: "CS410",
    name: "编程语言",
    classGroup: "01",
    rwh: "cs410",
    schedule: [fixtureSlot({ day: 2, periodStart: 1, periodEnd: 2 })],
  });
  const beta = fixtureCourse({
    code: "CS411",
    name: "编译技术",
    classGroup: "01",
    rwh: "cs411",
    schedule: [fixtureSlot({ day: 3, periodStart: 1, periodEnd: 2 })],
  });

  const emptyReport = recommendCourseSections({
    selectableCourses: [alpha, beta],
    ncesByKey: {
      [courseDecisionKey(alpha)]: { ...fixtureNces(), status: "not_found" },
      [courseDecisionKey(beta)]: { ...fixtureNces(), status: "insufficient_query" },
    },
  });
  assert.equal(emptyReport.sourceStatuses.nces.state, "empty");
  assert.match(emptyReport.sourceStatuses.nces.message || "", /no candidate had a reliable nces match/i);

  const partialReport = recommendCourseSections({
    selectableCourses: [alpha, beta],
    ncesByKey: {
      [courseDecisionKey(alpha)]: {
        ...fixtureNces({
          picked: {
            ncesId: 999,
            code: "CS410",
            name: "编程语言",
            teacher: "教师",
            semester: "2022春",
            semesters: ["2022春"],
            rating: 8.1,
            reviewCount: 4,
            difficulty: { label: "Average", pct: 50 },
            workload: { label: "Average", pct: 50 },
            grading: { label: "Average", pct: 50 },
            takeaways: { label: "High", pct: 80 },
            directUrl: "https://ncesnext.com/course/999/",
          },
        }),
        status: "ambiguous",
        confidence: "low",
      },
      [courseDecisionKey(beta)]: fixtureNces({
        picked: {
          ncesId: 1000,
          code: "CS411",
          name: "编译技术",
          teacher: "教师",
          semester: "2022春",
          semesters: ["2022春"],
          rating: 8.5,
          reviewCount: 8,
          difficulty: { label: "Average", pct: 55 },
          workload: { label: "Average", pct: 55 },
          grading: { label: "Average", pct: 55 },
          takeaways: { label: "High", pct: 82 },
          directUrl: "https://ncesnext.com/course/1000/",
        },
        confidence: "high",
      }),
    },
  });
  assert.equal(partialReport.sourceStatuses.nces.state, "partial");
  assert.match(partialReport.sourceStatuses.nces.message || "", /ambiguous/i);
});

test("course decision selectors match normalized course codes or exact rwh and report misses stably", () => {
  const cs101a = fixtureCourse({
    code: "CS 101",
    name: "程序设计",
    classGroup: "01",
    rwh: "2026-CS101-01",
    schedule: [fixtureSlot({ day: 1, periodStart: 1, periodEnd: 2 })],
  });
  const cs101b = fixtureCourse({
    code: "CS101",
    name: "程序设计",
    classGroup: "02",
    rwh: "2026-CS101-02",
    schedule: [fixtureSlot({ day: 1, periodStart: 3, periodEnd: 4 })],
  });
  const ma102 = fixtureCourse({
    code: "MA102",
    name: "高等数学",
    classGroup: "01",
    rwh: "2026-MA102-01",
    schedule: [fixtureSlot({ day: 2, periodStart: 1, periodEnd: 2 })],
  });
  const byNameOnly = fixtureCourse({
    code: "EE103",
    name: "程序设计",
    classGroup: "01",
    rwh: "2026-EE103-01",
    schedule: [fixtureSlot({ day: 3, periodStart: 1, periodEnd: 2 })],
  });

  const selected = selectCourseDecisionCandidates(
    [ma102, cs101b, byNameOnly, cs101a],
    ["CS-101", "2026-MA102-01", "程序设计", "CS101", "MISSING100"],
  );

  assert.deepEqual(selected.matched.map((course) => course.rwh), [
    "2026-CS101-02",
    "2026-CS101-01",
    "2026-MA102-01",
  ]);
  assert.deepEqual(selected.missingSelectors, ["程序设计", "MISSING100"]);
});

test("course decision selectors return all selectable sections when no selectors are given", () => {
  const alpha = fixtureCourse({
    code: "CS201",
    name: "数据结构",
    classGroup: "01",
    rwh: "cs201-01",
    schedule: [fixtureSlot({ day: 1, periodStart: 5, periodEnd: 6 })],
  });
  const beta = fixtureCourse({
    code: "CS202",
    name: "离散数学",
    classGroup: "01",
    rwh: "cs202-01",
    schedule: [fixtureSlot({ day: 2, periodStart: 5, periodEnd: 6 })],
  });

  const selected = selectCourseDecisionCandidates([alpha, beta], []);

  assert.deepEqual(selected.matched.map((course) => course.rwh), ["cs201-01", "cs202-01"]);
  assert.deepEqual(selected.missingSelectors, []);
});

test("course decision NCES lookup requests use courseDecisionKey and dedupe repeated sections", () => {
  const alpha = fixtureCourse({
    code: "CS330",
    name: "机器学习",
    classGroup: "01",
    rwh: "2026-CS330-01",
    teachers: ["李四", "王五"],
    schedule: [fixtureSlot({ day: 2, periodStart: 7, periodEnd: 8 })],
  });
  const duplicateAlpha = fixtureCourse({
    ...alpha,
    teachers: ["李四", "王五", "赵六"],
  });
  const beta = fixtureCourse({
    code: "HUM200",
    name: "艺术导论",
    classGroup: "03",
    rwh: "2026-HUM200-03",
    teachers: ["教师甲"],
    schedule: [fixtureSlot({ day: 4, periodStart: 3, periodEnd: 4 })],
  });

  const lookups = buildCourseDecisionNcesLookupRequests([alpha, duplicateAlpha, beta]);

  assert.deepEqual(lookups, [
    {
      key: courseDecisionKey(alpha),
      code: "CS330",
      name: "机器学习",
      teachers: ["李四", "王五"],
    },
    {
      key: courseDecisionKey(beta),
      code: "HUM200",
      name: "艺术导论",
      teachers: ["教师甲"],
    },
  ]);
});

function fixtureCourse(overrides: Partial<Course> & Pick<Course, "code" | "name" | "classGroup" | "rwh" | "schedule">): Course {
  return {
    code: overrides.code,
    name: overrides.name,
    sectionName: overrides.sectionName ?? `${overrides.name} ${overrides.classGroup}`,
    classGroup: overrides.classGroup,
    rwh: overrides.rwh,
    id: overrides.id,
    college: overrides.college ?? "计算机科学与工程系",
    category: overrides.category ?? "专业核心课程",
    nature: overrides.nature ?? "必修",
    campus: overrides.campus ?? "南科大",
    credits: overrides.credits ?? 3,
    totalHours: overrides.totalHours ?? 48,
    capacity: overrides.capacity,
    enrolled: overrides.enrolled,
    cultivation: overrides.cultivation ?? "本科",
    taskType: overrides.taskType ?? "理论课",
    language: overrides.language ?? "中文",
    teachers: overrides.teachers ?? ["教师"],
    schedule: overrides.schedule,
  };
}

function fixtureSlot(overrides: Partial<ScheduleSlot> & Pick<ScheduleSlot, "day" | "periodStart" | "periodEnd">): ScheduleSlot {
  return {
    weeks: overrides.weeks ?? [1, 2, 3, 4],
    day: overrides.day,
    dayName: overrides.dayName ?? ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"][overrides.day] ?? "周",
    periodStart: overrides.periodStart,
    periodEnd: overrides.periodEnd,
    room: overrides.room ?? "教室",
  };
}

function fixtureDegreeMissing(overrides: Partial<TisDegreeMissing> = {}): TisDegreeMissing {
  return {
    schemaVersion: "1",
    kind: "tis-degree-missing",
    generatedAt: "2026-08-28T00:00:00.000Z",
    reportedAt: "2026-08-28T00:00:00.000Z",
    context: { cohort: "2023", major: "计算机科学与技术", planCode: "2023-CS-1" },
    officialSummary: { requiredCredits: 162, completedCredits: 120, remainingCredits: 42, requiredCourses: 56, completedCourses: 40, remainingCourses: 16 },
    summary: { remainingCredits: 42, remainingCourses: 16 },
    advisory: {
      primaryReference: "applicable-official-cultivation-plan",
      message: "TIS 数据可能不完整或不一致，请以本人适用的正式培养方案为准。",
      contact: "如本报告与培养方案不一致或仍有疑问，请联系系秘书或教学工作部确认。",
    },
    definiteMissingRequiredCourses: [],
    inProgressRequiredCourses: [],
    choiceGaps: [],
    manualReview: [],
    counts: {
      definiteMissingRequiredCourses: overrides.definiteMissingRequiredCourses?.length ?? 0,
      inProgressRequiredCourses: overrides.inProgressRequiredCourses?.length ?? 0,
      choiceGaps: overrides.choiceGaps?.length ?? 0,
      manualReview: overrides.manualReview?.length ?? 0,
    },
    sourceStatuses: {
      progressDetails: { state: "available", count: 0 },
      progress: SOURCE_STATUSES,
      grades: { state: "available", count: 0 },
      enrolled: { state: "available", count: 0 },
    },
    warnings: [],
    ...overrides,
  };
}

function fixtureProgress(overrides: Partial<TisDegreeProgress> = {}): TisDegreeProgress {
  return {
    schemaVersion: "1",
    kind: "tis-degree-progress",
    reportedAt: "2026-08-28T00:00:00.000Z",
    context: { cohort: "2023", major: "计算机科学与技术", planCode: "2023-CS-1" },
    summary: { requiredCredits: 162, completedCredits: 120, remainingCredits: 42, requiredCourses: 56, completedCourses: 40, remainingCourses: 16 },
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
    ...overrides,
  };
}

function fixtureNces(overrides: Partial<NcesResolvedCourse> = {}): NcesResolvedCourse {
  const picked = overrides.picked;
  return {
    query: overrides.query ?? "fixture",
    queryKind: overrides.queryKind ?? "code",
    termId: overrides.termId,
    searchTotal: overrides.searchTotal ?? (picked ? 1 : 0),
    items: overrides.items ?? (picked ? [picked] : []),
    matchedCandidates: overrides.matchedCandidates ?? (picked ? [picked] : []),
    picked,
    detail: overrides.detail,
    status: overrides.status ?? (picked ? "matched" : "not_found"),
    confidence: overrides.confidence ?? (picked ? "medium" : "none"),
    signals: overrides.signals ?? {
      exactCode: Boolean(picked),
      baseCode: Boolean(picked),
      name: Boolean(picked),
      teacherMatches: picked ? [picked.teacher] : [],
      termMatched: Boolean(picked),
    },
    notes: overrides.notes ?? [],
    errorMessage: overrides.errorMessage,
  };
}
