import type { Semester } from "./semester.js";
import type { TimetableResult } from "../tis/planner.js";
import type { DegreeAuditResult } from "../tis/degree-audit.js";
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
