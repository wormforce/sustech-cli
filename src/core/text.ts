import type { Semester } from "./semester.js";
import type { StudentProfileReport } from "../profile/report.js";
import type { TimetableResult } from "../tis/planner.js";
import type { DegreeAuditResult } from "../tis/degree-audit.js";
import type { TisDegreeMissing } from "../tis/degree-missing.js";
import type { TisDegreeProgress } from "../tis/degree-progress.js";
import type { TisPlanView } from "../tis/plan.js";
import type { Course, ExamRecord, GpaSummary, GradeRecord, PersonalScheduleEntry } from "../tis/types.js";

interface Column<T> {
  heading: string;
  width: number;
  value: (row: T) => string;
}

export function formatVersion(version: string, runtime: string): string {
  return `sustech-cli ${version} (${runtime})`;
}

export function formatAuthCheck(source: string, stored: boolean): string {
  return `authenticated\nCredentials: ${source} (${stored ? "stored in the system credential store" : "not stored by sustech-cli"})`;
}

export function formatCourseSearch(input: {
  title: string;
  semester: Semester;
  courses: Course[];
  total: number;
  source?: string;
}): string {
  const columns: Column<Course>[] = [
    { heading: "CODE", width: 12, value: (course) => course.code },
    { heading: "COURSE", width: 28, value: (course) => course.name || course.sectionName },
    { heading: "TEACHER", width: 18, value: (course) => course.teachers.join(", ") || "-" },
    { heading: "TIME", width: 34, value: formatSchedule },
    { heading: "SEATS", width: 10, value: formatSeats },
  ];
  const heading = `${input.title} · ${input.semester.value}${input.source ? ` · ${input.source}` : ""}`;
  const summary = `${input.total} match(es); showing ${input.courses.length}.`;
  if (input.courses.length === 0) return `${heading}\n\nNo courses found.\n\n${summary}`;
  return `${heading}\n\n${formatTable(columns, input.courses)}\n\n${summary}`;
}

export function formatAvailableCourses(input: {
  semester: Semester;
  courses: Course[];
  total: number;
  round: string;
}): string {
  const blocks = input.courses.map((course, index) => {
    const id = course.id || "(not returned by TIS)";
    return [
      `${index + 1}. ${course.code} — ${course.name || course.sectionName}`,
      `   Section: ${course.classGroup || "-"} · Teacher: ${course.teachers.join(", ") || "-"}`,
      `   Time: ${formatSchedule(course)}`,
      `   RWH: ${course.rwh}`,
      `   TIS ID: ${id}`,
    ].join("\n");
  });
  const header = `Available courses · ${input.semester.value} · round ${input.round}`;
  const body = blocks.length > 0 ? blocks.join("\n\n") : "No selectable courses found.";
  return `${header}\n\n${body}\n\n${input.total} match(es); showing ${input.courses.length}.`;
}

export function formatEnrolledCourses(semester: Semester, courses: PersonalScheduleEntry[]): string {
  const header = `Enrolled courses · ${semester.value}`;
  if (courses.length === 0) return `${header}\n\nNo enrolled courses returned by TIS.`;
  const blocks = courses.map((course, index) => {
    const name = course.courseName || course.description || course.descriptionEn || "Unnamed course";
    const details = [
      course.teacher && `Teacher: ${course.teacher}`,
      course.description && `Time: ${course.description}`,
      course.room && `Room: ${course.room}`,
    ].filter(Boolean).join(" · ");
    return `${index + 1}. ${course.courseCode ? `${course.courseCode} — ` : ""}${name}${details ? `\n   ${details}` : ""}`;
  });
  return `${header}\n\n${blocks.join("\n\n")}\n\n${courses.length} course record(s).`;
}

export function formatScheduleEntries(
  semester: Semester,
  entries: PersonalScheduleEntry[],
  week?: number,
): string {
  const title = `Personal schedule · ${semester.value}${week === undefined ? " · full semester" : ` · week ${week}`}`;
  if (entries.length === 0) return `${title}\n\nNo schedule entries returned by TIS.`;
  const lines = entries.map((entry, index) => {
    const label = entry.courseName || entry.description || entry.descriptionEn || entry.rwh || "Unnamed entry";
    const details = [
      entry.key,
      entry.periodStart !== undefined ? `period ${entry.periodStart}-${entry.periodEnd ?? entry.periodStart}` : "",
      entry.teacher,
      entry.room,
    ].filter(Boolean).join(" · ");
    return `${index + 1}. ${entry.courseCode ? `${entry.courseCode} — ` : ""}${label}${details ? `\n   ${details}` : ""}`;
  });
  return `${title}\n\n${lines.join("\n\n")}\n\n${entries.length} schedule entry/entries.`;
}

export function formatGrades(grades: GradeRecord[], summary: GpaSummary): string {
  const columns: Column<GradeRecord>[] = [
    { heading: "SEMESTER", width: 14, value: (grade) => grade.semester || "-" },
    { heading: "CODE", width: 12, value: (grade) => grade.code || "-" },
    { heading: "COURSE", width: 30, value: (grade) => grade.name || grade.nameEn || "-" },
    { heading: "GRADE", width: 7, value: (grade) => grade.letterGrade || "-" },
    { heading: "SCORE", width: 7, value: (grade) => grade.numericScore?.toString() ?? "-" },
    { heading: "CREDITS", width: 8, value: (grade) => grade.credits.toString() },
  ];
  if (grades.length === 0) return "Grades\n\nNo grade records returned by TIS.";
  return [
    "Grades",
    "",
    formatTable(columns, grades),
    "",
    `GPA ${summary.gpa.toFixed(3)} · ${summary.credits} counted credits · ${summary.courseCount} counted course(s)`,
  ].join("\n");
}

export function formatExams(exams: ExamRecord[]): string {
  if (exams.length === 0) return "Exam schedule\n\nNo exams returned by TIS.";
  const blocks = exams.map((exam, index) => {
    const location = [exam.campus, exam.building, exam.room].filter(Boolean).join(" ") || "TBA";
    const period = exam.periodStart === undefined
      ? ""
      : ` · period ${exam.periodStart}-${exam.periodEnd ?? exam.periodStart}`;
    return [
      `${index + 1}. ${exam.code ? `${exam.code} — ` : ""}${exam.name || "Unnamed exam"}`,
      `   ${exam.date || "TBA"} ${exam.weekday} · ${exam.time || "TBA"}${period}`,
      `   ${location}${exam.type ? ` · ${exam.type}` : ""}`,
    ].join("\n");
  });
  return `Exam schedule\n\n${blocks.join("\n\n")}\n\n${exams.length} exam(s).`;
}

export function formatTimetables(result: TimetableResult): string {
  const candidateSummary = result.requestedCodes
    .map((code) => {
      const excluded = result.excludedUnscheduledByCode[code] ?? 0;
      return `${code}=${result.candidatesByCode[code] ?? 0}${excluded > 0 ? ` (+${excluded} time-TBA excluded)` : ""}`;
    })
    .join(", ");
  if (result.missingCodes.length > 0) {
    return [
      "Timetable solver",
      "",
      `No solution search was run because these codes have no eligible sections: ${result.missingCodes.join(", ")}`,
      `Candidates: ${candidateSummary}`,
    ].join("\n");
  }
  if (result.solutions.length === 0) {
    return `Timetable solver\n\nNo conflict-free timetable found.\nCandidates: ${candidateSummary}`;
  }
  const solutions = result.solutions.map((solution) => {
    const sections = solution.sections.map((course) => {
      const schedule = course.schedule.map((slot) =>
        `${slot.dayName} ${slot.periodStart}-${slot.periodEnd} ${slot.room}`,
      ).join("; ") || "time TBA";
      return `  - ${course.code}/${course.classGroup || "?"} · ${course.teachers.join(", ") || "teacher TBA"} · ${schedule} · RWH ${course.rwh}`;
    });
    const score = [
      `score ${solution.score.total}`,
      `avg/week early ${solution.score.metrics.earlySessions}`,
      `gaps ${solution.score.metrics.gapSegments}/${solution.score.metrics.gapPeriods}`,
      `weekdays ${solution.score.metrics.distinctWeekdays}`,
      `switches ${solution.score.metrics.campusSwitches}`,
    ].join(" · ");
    return [`Solution ${solution.index} · ${solution.totalCredits} credits · ${score}`, ...sections].join("\n");
  });
  return [
    "Timetable solver",
    `Candidates: ${candidateSummary}`,
    result.searchTruncated
      ? `Ranking scope: partial top-${result.solutions.length}; evaluated ${result.evaluatedCount} complete timetable(s) before the search cap ${result.searchLimit}.`
      : `Ranking scope: complete; evaluated ${result.evaluatedCount} complete timetable(s).`,
    `Score unit: ${result.solutions[0]?.score.metricUnit ?? "average-per-active-week"}${result.solutions[0] ? ` across ${result.solutions[0].score.activeWeeks} active teaching week(s) for solution 1` : ""}.`,
    result.blocked.length > 0
      ? `Blocked: ${result.blocked.map((entry) => `${entry.dayName} ${entry.periodStart}-${entry.periodEnd}`).join(", ")}`
      : "",
    "",
    solutions.join("\n\n"),
    "",
    `${result.solutions.length} solution(s) shown${result.truncated ? " (ranking window truncated)" : ""}.`,
  ].filter((line, index) => line !== "" || index > 1).join("\n");
}

export function formatTisPlan(view: TisPlanView, title = "TIS plan"): string {
  const blocked = view.plan.blocked.length > 0
    ? view.plan.blocked.map((entry) => `${entry.dayName} ${entry.periodStart}-${entry.periodEnd}`).join(", ")
    : "(none)";
  return [
    `${title}`,
    `Path: ${view.path}`,
    `Schema: ${view.plan.schemaVersion} · ${view.plan.kind}`,
    `Semester: ${view.plan.semester ?? "(not pinned)"}`,
    `Codes: ${view.plan.requestedCodes.join(", ") || "(none)"}`,
    `Blocked: ${blocked}`,
    `Preferences: early<=P${view.plan.preferences.earlyPeriodThreshold}; weights ${formatWeights(view.plan.preferences.weights)}`,
  ].join("\n");
}

export function formatDegreeAudit(result: DegreeAuditResult, requirementsPath: string): string {
  const lines = [
    `Degree audit${result.requirements.title ? ` · ${result.requirements.title}` : ""}`,
    `Requirements: ${requirementsPath}`,
    "",
    `Satisfied ${result.summary.satisfiedRequirements}/${result.summary.totalRequirements}`,
  ];
  if (result.satisfied.length > 0) {
    lines.push(...result.satisfied.map((entry) =>
      `  ✓ ${entry.id} · ${entry.title} · ${entry.matchedCredits}/${entry.requiredCredits || entry.matchedCredits} credits · ${entry.matchedCourses}/${entry.requiredCourses || entry.matchedCourses} courses`,
    ));
  } else {
    lines.push("  (none)");
  }
  lines.push("", `Remaining ${result.summary.remainingRequirements}`);
  if (result.remaining.length > 0) {
    lines.push(...result.remaining.map((entry) =>
      `  - ${entry.id} · ${entry.title} · need ${entry.remainingCredits} credits, ${entry.remainingCourses} courses${entry.ambiguousMatches.length > 0 ? ` · ${entry.ambiguousMatches.length} ambiguous match(es)` : ""}`,
    ));
  } else {
    lines.push("  (none)");
  }
  lines.push("", `Ambiguous grades ${result.summary.ambiguousGrades}`);
  if (result.ambiguous.length > 0) {
    lines.push(...result.ambiguous.map((entry) =>
      `  ? ${entry.grade.code} ${entry.grade.name || entry.grade.nameEn} · ${entry.requirementIds.join(", ")}`,
    ));
  } else {
    lines.push("  (none)");
  }
  lines.push("", `Unresolved grades ${result.summary.unresolvedGrades}`);
  if (result.unresolved.length > 0) {
    lines.push(...result.unresolved.map((entry) =>
      `  ! ${entry.grade.code} ${entry.grade.name || entry.grade.nameEn} · ${entry.detail}${entry.requirementIds.length > 0 ? ` · matches ${entry.requirementIds.join(", ")}` : ""}`,
    ));
  } else {
    lines.push("  (none)");
  }
  lines.push("", `Excluded failed/non-completed grades ${result.summary.excludedGrades}`);
  if (result.excluded.length > 0) {
    lines.push(...result.excluded.map((entry) =>
      `  x ${entry.grade.code} ${entry.grade.name || entry.grade.nameEn} · ${entry.detail}${entry.requirementIds.length > 0 ? ` · matches ${entry.requirementIds.join(", ")}` : ""}`,
    ));
  } else {
    lines.push("  (none)");
  }
  lines.push("", `Duplicate course codes ${result.summary.duplicateCourseCodes}`);
  if (result.duplicateCourses.length > 0) {
    lines.push(...result.duplicateCourses.map((entry) =>
      `  = ${entry.code} · kept ${entry.counted?.semester ?? "none"}${entry.excludedPassedRetakes.length > 0 ? ` · excluded ${entry.excludedPassedRetakes.length} passed retake(s)` : ""}${entry.unresolvedAttempts.length > 0 ? ` · ${entry.unresolvedAttempts.length} unresolved` : ""}${entry.failedOrNonCompletedAttempts.length > 0 ? ` · ${entry.failedOrNonCompletedAttempts.length} failed/non-completed` : ""}`,
    ));
  } else {
    lines.push("  (none)");
  }
  lines.push("", `Unmatched grades ${result.summary.unmatchedGrades}`);
  if (result.unmatched.length > 0) {
    lines.push(...result.unmatched.map((grade) => `  · ${grade.code} ${grade.name || grade.nameEn}`));
  } else {
    lines.push("  (none)");
  }
  return lines.join("\n");
}

export function formatDegreeProgress(progress: TisDegreeProgress): string {
  const context = [
    progress.context.cohort ? `cohort ${progress.context.cohort}` : "",
    progress.context.major,
    progress.summary.majorTrack && progress.summary.majorTrack !== "无"
      ? `track ${progress.summary.majorTrack}`
      : "",
  ].filter(Boolean).join(" · ");
  const lines = [
    `TIS degree progress${context ? ` · ${context}` : ""}`,
    "TIS-reported snapshot; not a final graduation decision.",
    "",
    formatProgressCredits(progress),
    formatProgressCourses(progress),
  ];

  lines.push("", `Credit categories (${progress.creditCategories.length})`);
  if (progress.creditCategories.length === 0) {
    lines.push("  (none returned)");
  } else {
    lines.push(...progress.creditCategories.map((entry) => {
      const credits = progressRatio(entry.completedCredits, entry.requiredCredits, entry.remainingCredits, "credits");
      const hours = progressRatio(entry.completedHours, entry.requiredHours, entry.remainingHours, "hours");
      const details = [credits, hours, entry.note].filter(Boolean).join(" · ");
      return `  - ${entry.name}${details ? ` · ${details}` : ""}`;
    }));
  }

  lines.push("", `Module gaps (${progress.moduleGaps.length})`);
  if (progress.moduleGaps.length === 0) {
    lines.push("  (none reported)");
  } else {
    lines.push(...progress.moduleGaps.map((entry) => {
      const gaps = [
        entry.remainingCredits !== undefined ? `${entry.remainingCredits} credits` : "",
        entry.remainingCourses !== undefined ? `${entry.remainingCourses} courses` : "",
      ].filter(Boolean).join(", ");
      return `  - ${entry.name}${gaps ? ` · remaining ${gaps}` : " · not marked passed"}`;
    }));
  }

  if (progress.detailsIncluded) {
    lines.push("", `Course details: ${progress.courseCount ?? 0} row(s) included in structured output.`);
  } else if (progress.detailsRequested) {
    lines.push("", "Course details were requested but the TIS course-detail source was unavailable; inspect sourceStatuses.courses.");
  } else {
    lines.push("", "Course details omitted; re-run with --details when course-by-course data is needed.");
  }
  if (progress.warnings.length > 0) {
    lines.push("", "Notes", ...progress.warnings.map((warning) => `  - ${warning.message}`));
  }
  return lines.join("\n");
}

export function formatDegreeMissing(report: TisDegreeMissing): string {
  const context = [
    report.context.cohort ? `cohort ${report.context.cohort}` : "",
    report.context.major,
    report.officialSummary.majorTrack && report.officialSummary.majorTrack !== "无"
      ? `track ${report.officialSummary.majorTrack}`
      : "",
  ].filter(Boolean).join(" · ");
  const enrolled = report.enrolledSemester
    ? `${report.enrolledSemester.value} via ${report.enrolledSemester.source}`
    : "not checked";
  const lines = [
    `TIS degree missing${context ? ` · ${context}` : ""}`,
    "Derived from TIS-reported degree progress, grade history, and enrolled-course matching; not a final graduation decision.",
    `Important: ${report.advisory.message} ${report.advisory.contact}`,
    `TIS-reported credits: ${progressRatio(report.officialSummary.completedCredits, report.officialSummary.requiredCredits, report.officialSummary.remainingCredits, "credits")}`,
    `TIS-reported courses: ${progressRatio(report.officialSummary.completedCourses, report.officialSummary.requiredCourses, report.officialSummary.remainingCourses, "courses")}`,
    `Sources: details ${report.sourceStatuses.progressDetails.state} · grades ${report.sourceStatuses.grades.state} · enrolled ${report.sourceStatuses.enrolled.state} (${enrolled})`,
  ];

  lines.push("", `Definite missing required courses (${report.definiteMissingRequiredCourses.length})`);
  if (report.definiteMissingRequiredCourses.length === 0) {
    lines.push("  (none identified from the available sources; inspect Manual review below)");
  } else {
    lines.push(...report.definiteMissingRequiredCourses.map((entry) => {
      const extras = [
        entry.credits !== undefined ? `${entry.credits} credits` : "",
        entry.reason,
        entry.latestAttempt ? formatAttempt(entry.latestAttempt) : "",
      ].filter(Boolean).join(" · ");
      return `  - ${formatCourseIdentity(entry.code, entry.name)}${extras ? ` · ${extras}` : ""}`;
    }));
  }

  lines.push("", `Required courses currently in progress (${report.inProgressRequiredCourses.length})`);
  if (report.inProgressRequiredCourses.length === 0) {
    lines.push("  (none detected from the inspected enrollment source)");
  } else {
    lines.push(...report.inProgressRequiredCourses.map((entry) => {
      const extras = [
        entry.credits !== undefined ? `${entry.credits} credits` : "",
        entry.reason,
        entry.previousAttempt ? `previous ${formatAttempt(entry.previousAttempt)}` : "",
      ].filter(Boolean).join(" · ");
      return `  - ${formatCourseIdentity(entry.code, entry.name)}${extras ? ` · ${extras}` : ""}`;
    }));
  }

  lines.push("", `Remaining category or module gaps (${report.choiceGaps.length})`);
  if (report.choiceGaps.length === 0) {
    lines.push("  (none reported)");
  } else {
    lines.push(...report.choiceGaps.map((entry) => {
      const body = entry.scope === "credit-category"
        ? progressRatio(entry.completedCredits, entry.requiredCredits, entry.remainingCredits, "credits")
        : [
            entry.remainingCredits !== undefined ? `${entry.remainingCredits} credits` : "",
            entry.remainingCourses !== undefined ? `${entry.remainingCourses} courses` : "",
            entry.remainingHours !== undefined ? `${entry.remainingHours} hours` : "",
          ].filter(Boolean).join(", ");
      return `  - [${entry.scope}] ${entry.name}${body ? ` · ${body}` : ""}${entry.note ? ` · ${entry.note}` : ""}`;
    }));
  }

  lines.push("", `Manual review (${report.manualReview.length})`);
  if (report.manualReview.length === 0) {
    lines.push("  (none)");
  } else {
    lines.push(...report.manualReview.map((entry) => `  - ${entry.message}`));
  }

  if (report.warnings.length > 0) {
    lines.push("", "Notes", ...report.warnings.map((warning) => `  - ${warning.message}`));
  }
  return lines.join("\n");
}

function formatProgressCredits(progress: TisDegreeProgress): string {
  const { completedCredits, requiredCredits, remainingCredits } = progress.summary;
  if (completedCredits === undefined && requiredCredits === undefined && remainingCredits === undefined) {
    return "Credits: not returned";
  }
  return `Credits: ${progressRatio(completedCredits, requiredCredits, remainingCredits, "credits")}`;
}

function formatProgressCourses(progress: TisDegreeProgress): string {
  const { completedCourses, requiredCourses, remainingCourses } = progress.summary;
  if (completedCourses === undefined && requiredCourses === undefined && remainingCourses === undefined) {
    return "Courses: not returned";
  }
  return `Courses: ${progressRatio(completedCourses, requiredCourses, remainingCourses, "courses")}`;
}

function progressRatio(
  completed: number | undefined,
  required: number | undefined,
  remaining: number | undefined,
  unit: string,
): string {
  const ratio = completed !== undefined && required !== undefined
    ? `${completed}/${required} ${unit}`
    : completed !== undefined
      ? `${completed} completed ${unit}`
      : required !== undefined
        ? `${required} required ${unit}`
        : "";
  const gap = remaining !== undefined ? `${remaining} remaining` : "";
  return [ratio, gap].filter(Boolean).join(" · ") || "not returned";
}

function formatCourseIdentity(code: string | undefined, name: string | undefined): string {
  if (code && name) return `${code} ${name}`;
  return code || name || "Unnamed course";
}

function formatAttempt(attempt: { semester?: string; letterGrade?: string; numericScore?: number }): string {
  const score = attempt.numericScore !== undefined ? String(attempt.numericScore) : "";
  const grade = attempt.letterGrade || "";
  const status = [grade, score].filter(Boolean).join("/");
  return [attempt.semester, status].filter(Boolean).join(" ");
}

export function formatStudentProfile(
  report: StudentProfileReport,
  options: { path?: string } = {},
): string {
  const lines = [
    `Student profile${options.path ? " export" : ""}`,
    `Schema: ${report.schemaVersion} · ${report.kind}`,
    `Generated: ${report.generatedAt}`,
    `Semester: ${report.semester}`,
  ];

  if (options.path) {
    lines.push(`Path: ${options.path}`, "Format: versioned JSON");
  }

  lines.push("", "Identity");
  if (report.identity) {
    lines.push(
      `  Name: ${report.identity.name ?? "(not available)"}`,
      `  Student ID: ${report.identity.studentIdMasked ?? "(not available)"}`,
      `  Department: ${report.identity.department ?? "(not available)"}`,
      `  Student type: ${report.identity.studentType ?? "(not available)"}`,
    );
  } else {
    lines.push("  (not available)");
  }

  lines.push("", "Academic summary");
  if (report.academics.currentCourses) {
    lines.push(
      `  Current semester courses: ${report.academics.currentCourses.courseCount} distinct course(s) from ${report.academics.currentCourses.sourceRows} TIS row(s)`,
      `  Omitted course rows without stable identity: ${report.academics.currentCourses.omittedRows}`,
    );
  } else {
    lines.push("  Current semester courses: (not available)");
  }
  if (report.academics.nextExam) {
    const exam = report.academics.nextExam;
    const location = [exam.campus, exam.building, exam.room].filter(Boolean).join(" / ") || "TBA";
    lines.push(`  Next exam: ${exam.code || "(no code)"} ${exam.name} · ${exam.date} ${exam.time || "TBA"} · ${location}`);
  } else {
    lines.push("  Next exam: (not available)");
  }
  if (report.academics.nextBlackboardDeadline) {
    const deadline = report.academics.nextBlackboardDeadline;
    lines.push(
      `  Next Blackboard deadline: ${deadline.courseCode} · ${deadline.title} · due ${deadline.dueAt} (${deadline.daysLeft} day(s) left)`,
    );
  } else {
    lines.push("  Next Blackboard deadline: (not available)");
  }

  lines.push("", "Sources");
  for (const [name, source] of Object.entries(report.sources)) {
    lines.push(`  ${name}: ${source.status}`);
    for (const failure of source.failures) {
      lines.push(`    - ${failure.code}: ${failure.message}`);
    }
  }
  lines.push(
    "",
    `Summary: ok ${report.summary.okSources} · partial ${report.summary.partialSources} · missing ${report.summary.missingSources} · error ${report.summary.errorSources}`,
  );
  return lines.join("\n");
}

export function formatEnrollPreview(target: {
  semester: Semester;
  courseId: string;
  rwh: string;
  bid: number;
  round: string;
}, command: string): string {
  return [
    "Enrollment preview — no network request or mutation was performed.",
    "",
    `Semester: ${target.semester.value}`,
    `RWH: ${target.rwh}`,
    `TIS ID: ${target.courseId}`,
    `Round: ${target.round}`,
    `Bid: ${target.bid}`,
    "",
    "After reviewing the exact target, run:",
    command,
  ].join("\n");
}

export function formatEnrollSuccess(
  rwh: string,
  message: string,
  verification: { status: "confirmed" | "not_observed" | "unavailable"; message: string },
): string {
  return [
    "Enrollment request accepted by TIS.",
    `RWH: ${rwh}`,
    `TIS: ${message || "success"}`,
    `Verification: ${verification.status} — ${verification.message}`,
    verification.status === "confirmed" ? "" : "Do not retry automatically; inspect TIS before another write.",
  ].filter(Boolean).join("\n");
}

function formatTable<T>(columns: Column<T>[], rows: T[]): string {
  const separator = columns.map((column) => "-".repeat(column.width)).join("  ");
  const header = columns.map((column) => padCell(column.heading, column.width)).join("  ");
  const body = rows.map((row) => columns.map((column) => padCell(column.value(row), column.width)).join("  "));
  return [header, separator, ...body].join("\n");
}

function formatSchedule(course: Course): string {
  if (course.schedule.length === 0) return "-";
  const visible = course.schedule.slice(0, 2).map((slot) =>
    `${slot.dayName} ${slot.periodStart}-${slot.periodEnd} ${slot.room}`,
  );
  if (course.schedule.length > 2) visible.push(`+${course.schedule.length - 2} more`);
  return visible.join("; ");
}

function formatSeats(course: Course): string {
  if (course.enrolled !== undefined && course.capacity !== undefined) return `${course.enrolled}/${course.capacity}`;
  if (course.capacity !== undefined) return String(course.capacity);
  return "-";
}

function formatWeights(weights: {
  earlySession: number;
  gapSegment: number;
  gapPeriod: number;
  distinctWeekday: number;
  campusSwitch: number;
}): string {
  return [
    `early=${weights.earlySession}`,
    `gapSegment=${weights.gapSegment}`,
    `gapPeriod=${weights.gapPeriod}`,
    `weekday=${weights.distinctWeekday}`,
    `switch=${weights.campusSwitch}`,
  ].join(", ");
}

function padCell(value: string, width: number): string {
  const truncated = truncateDisplay(value.replaceAll(/\s+/g, " ").trim(), width);
  return `${truncated}${" ".repeat(Math.max(0, width - displayWidth(truncated)))}`;
}

function truncateDisplay(value: string, width: number): string {
  if (displayWidth(value) <= width) return value;
  let output = "";
  for (const character of value) {
    if (displayWidth(`${output}${character}…`) > width) break;
    output += character;
  }
  return `${output}…`;
}

function displayWidth(value: string): number {
  return [...value].reduce((width, character) => width + (/[^\u0000-\u00ff]/.test(character) ? 2 : 1), 0);
}
