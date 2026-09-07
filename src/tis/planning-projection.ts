import type {
  DegreeMissingAttempt,
  DegreeMissingRequiredCourse,
  TisDegreeMissing,
} from "./degree-missing.js";
import type { DegreeProgressCourse, TisDegreeProgress } from "./degree-progress.js";
import type { PersonalScheduleEntry } from "./types.js";

export const PLANNING_PROJECTION_FIELDS = Object.freeze({
  degreeProgress: ["context", "summary", "creditCategories", "moduleRequirements", "moduleGaps", "sourceStatuses", "reportedAt"],
  degreeCourse: ["code", "name", "group", "college", "semester", "required", "credits", "hours", "courseNature", "category", "majorTrack"],
  enrollment: ["courseCode", "courseName", "rwh", "teachingTeam", "meetings"],
  availability: ["bundleId", "courseCode", "courseName", "credits", "components", "teachingTeam", "meetings", "operationTargets", "reportedAt"],
} as const);

export type GradeFreeDegreeAttempt = Omit<DegreeMissingAttempt, "letterGrade" | "numericScore">;
export type GradeFreeMissingCourse = Omit<DegreeMissingRequiredCourse, "latestAttempt" | "previousAttempt"> & {
  latestAttempt?: GradeFreeDegreeAttempt;
  previousAttempt?: GradeFreeDegreeAttempt;
};

export type PlanningDegreeMissing = Omit<TisDegreeMissing, "definiteMissingRequiredCourses" | "inProgressRequiredCourses"> & {
  definiteMissingRequiredCourses: GradeFreeMissingCourse[];
  inProgressRequiredCourses: GradeFreeMissingCourse[];
  projection: { mode: "planning-grade-free"; fieldAllowlist: typeof PLANNING_PROJECTION_FIELDS };
};

export interface PlanningEnrollment {
  courseCode: string;
  courseName: string;
  rwh: string;
  teachingTeam: string[];
  meetings: Array<{
    day?: number;
    periodStart?: number;
    periodEnd?: number;
    weeks: number[];
    room: string;
  }>;
}

export interface PlanningSelectionRound {
  code?: string;
  name?: string;
  bidLimit?: number;
}

export function projectSelectionRoundForPlanning(raw: Record<string, unknown>): PlanningSelectionRound {
  const code = text(raw.xkfsdm);
  const name = text(raw.lcmc ?? raw.xkfslxmc ?? raw.name);
  const bidLimit = numeric(raw.jffs);
  const projected = {
    ...(code ? { code } : {}),
    ...(name ? { name } : {}),
    ...(bidLimit !== undefined ? { bidLimit } : {}),
  };
  assertPlanningProjection(projected);
  return projected;
}

export function projectDegreeProgressForPlanning(
  progress: TisDegreeProgress,
  options: { includeGrades?: boolean } = {},
): TisDegreeProgress & { projection: { mode: "planning-grade-free" | "explicit-details"; fieldAllowlist: typeof PLANNING_PROJECTION_FIELDS } } {
  const courses = progress.courses?.map((course) => options.includeGrades ? { ...course } : gradeFreeCourse(course));
  const projected = {
    ...progress,
    ...(courses ? { courses } : {}),
    projection: {
      mode: options.includeGrades ? "explicit-details" as const : "planning-grade-free" as const,
      fieldAllowlist: PLANNING_PROJECTION_FIELDS,
    },
  };
  assertPlanningProjection(projected);
  return projected;
}

export function projectDegreeMissingForPlanning(report: TisDegreeMissing): PlanningDegreeMissing {
  const projected: PlanningDegreeMissing = {
    ...report,
    definiteMissingRequiredCourses: report.definiteMissingRequiredCourses.map(gradeFreeMissingCourse),
    inProgressRequiredCourses: report.inProgressRequiredCourses.map(gradeFreeMissingCourse),
    projection: { mode:"planning-grade-free", fieldAllowlist:PLANNING_PROJECTION_FIELDS },
  };
  assertPlanningProjection(projected);
  return projected;
}

export function projectEnrollmentForPlanning(entries: readonly PersonalScheduleEntry[]): PlanningEnrollment[] {
  const grouped = new Map<string, PlanningEnrollment>();
  for (const entry of entries) {
    const key = `${entry.courseCode}\u0000${entry.rwh}`;
    const current = grouped.get(key) ?? {
      courseCode: entry.courseCode,
      courseName: entry.courseName,
      rwh: entry.rwh,
      teachingTeam: [],
      meetings: [],
    };
    current.teachingTeam = unique([...current.teachingTeam, entry.teacher]);
    current.meetings.push({
      ...(entry.day !== undefined ? { day:entry.day } : {}),
      ...(entry.periodStart !== undefined ? { periodStart:entry.periodStart } : {}),
      ...(entry.periodEnd !== undefined ? { periodEnd:entry.periodEnd } : {}),
      weeks: [...entry.weeks],
      room: entry.room,
    });
    grouped.set(key, current);
  }
  const projected = [...grouped.values()].sort((left, right) => left.courseCode.localeCompare(right.courseCode) || left.rwh.localeCompare(right.rwh));
  assertPlanningProjection(projected);
  return projected;
}

export function assertPlanningProjection(value: unknown): void {
  visit(value, "$", new Set<object>());
}

function visit(value: unknown, path: string, seen: Set<object>): void {
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => visit(entry, `${path}[${index}]`, seen));
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (/^(?:password|passwd|authorization|cookie|cookies|token|accessToken|refreshToken|sid|studentId|studentNumber|raw)$/i.test(key)) {
      throw new Error(`Planning projection contains forbidden field ${path}.${key}.`);
    }
    visit(entry, `${path}.${key}`, seen);
  }
}

function gradeFreeCourse(course: DegreeProgressCourse): DegreeProgressCourse {
  const { letterGrade: _letterGrade, numericScore: _numericScore, ...projected } = course;
  return projected;
}

function gradeFreeMissingCourse(course: DegreeMissingRequiredCourse): GradeFreeMissingCourse {
  const { latestAttempt, previousAttempt, ...projected } = course;
  return {
    ...projected,
    ...(latestAttempt ? { latestAttempt:gradeFreeAttempt(latestAttempt) } : {}),
    ...(previousAttempt ? { previousAttempt:gradeFreeAttempt(previousAttempt) } : {}),
  };
}

function gradeFreeAttempt(attempt: DegreeMissingAttempt): GradeFreeDegreeAttempt {
  const { letterGrade: _letterGrade, numericScore: _numericScore, ...projected } = attempt;
  return projected;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function text(value: unknown): string | undefined {
  const result = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  return result || undefined;
}

function numeric(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const result = Number(value);
  return Number.isFinite(result) ? result : undefined;
}
