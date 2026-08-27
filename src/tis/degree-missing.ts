import { classifyGradeCompletion, type DegreeGradeCompletion } from "./degree-audit.js";
import { currentSemester, semesterFromCurrentTerm, type Semester } from "../core/semester.js";
import type { TisClient } from "./client.js";
import type {
  DegreeProgressContext,
  DegreeProgressCourse,
  DegreeProgressSummary,
  TisDegreeProgress,
} from "./degree-progress.js";
import type { GradeRecord, PersonalScheduleEntry } from "./types.js";

export type DegreeMissingSemesterSource = "explicit" | "tis-current-term" | "date-fallback";
export type DegreeMissingSourceState = "available" | "error" | "fallback";

export interface DegreeMissingSourceStatus {
  state: DegreeMissingSourceState;
  count?: number;
  semester?: string;
  source?: DegreeMissingSemesterSource;
  message?: string;
}

export interface DegreeMissingAttempt {
  semester?: string;
  letterGrade?: string;
  numericScore?: number;
  completion: DegreeGradeCompletion;
}

export interface DegreeMissingRequiredCourse {
  code?: string;
  name: string;
  groups: string[];
  categories: string[];
  credits?: number;
  hours?: number;
  courseNature?: string;
  majorTrack?: string;
  reason: string;
  latestAttempt?: DegreeMissingAttempt;
  previousAttempt?: DegreeMissingAttempt;
  enrolledSemester?: string;
  matchedEnrollmentBy?: "code" | "name";
}

export interface DegreeMissingChoiceGap {
  scope: "credit-category" | "module";
  name: string;
  requiredCredits?: number;
  completedCredits?: number;
  remainingCredits?: number;
  remainingCourses?: number;
  remainingHours?: number;
  note?: string;
}

export interface DegreeMissingManualReview {
  code:
    | "PROGRESS_DETAILS_UNAVAILABLE"
    | "PROGRESS_SOURCE_ERROR"
    | "GRADES_UNAVAILABLE"
    | "ENROLLED_UNAVAILABLE"
    | "ENROLLMENT_SEMESTER_FALLBACK"
    | "REQUIRED_COURSE_STATUS_UNCLEAR"
    | "REQUIRED_COURSE_IDENTITY_UNCLEAR"
    | "CATEGORY_RULE_NOTE"
    | "OVERLAPPING_CATEGORY"
    | "DEGREE_PROGRESS_WARNING";
  message: string;
  course?: Pick<DegreeMissingRequiredCourse, "code" | "name">;
}

export interface DegreeMissingAdvisory {
  primaryReference: "applicable-official-cultivation-plan";
  message: string;
  contact: string;
}

export const DEGREE_MISSING_ADVISORY: Readonly<DegreeMissingAdvisory> = Object.freeze({
  primaryReference: "applicable-official-cultivation-plan",
  message: "TIS 数据可能不完整或不一致，请以本人适用的正式培养方案为准。",
  contact: "如本报告与培养方案不一致或仍有疑问，请联系系秘书或教学工作部确认。",
});

export interface TisDegreeMissing {
  schemaVersion: "1";
  kind: "tis-degree-missing";
  generatedAt: string;
  reportedAt: string;
  context: DegreeProgressContext;
  officialSummary: DegreeProgressSummary;
  summary: Pick<DegreeProgressSummary, "remainingCredits" | "remainingCourses">;
  advisory: DegreeMissingAdvisory;
  enrolledSemester?: {
    value: string;
    source: DegreeMissingSemesterSource;
  };
  definiteMissingRequiredCourses: DegreeMissingRequiredCourse[];
  inProgressRequiredCourses: DegreeMissingRequiredCourse[];
  choiceGaps: DegreeMissingChoiceGap[];
  manualReview: DegreeMissingManualReview[];
  counts: {
    definiteMissingRequiredCourses: number;
    inProgressRequiredCourses: number;
    choiceGaps: number;
    manualReview: number;
  };
  sourceStatuses: {
    progressDetails: DegreeMissingSourceStatus;
    progress: TisDegreeProgress["sourceStatuses"];
    grades: DegreeMissingSourceStatus;
    enrolled: DegreeMissingSourceStatus;
  };
  warnings: TisDegreeProgress["warnings"];
}

export interface EvaluateTisDegreeMissingInput {
  progress: TisDegreeProgress;
  grades?: readonly GradeRecord[];
  enrolled?: readonly PersonalScheduleEntry[];
  enrolledSemester?: string;
  enrolledSemesterSource?: DegreeMissingSemesterSource;
  gradesSourceStatus?: DegreeMissingSourceStatus;
  enrolledSourceStatus?: DegreeMissingSourceStatus;
  generatedAt?: Date | string;
}

export async function deriveTisDegreeMissing(
  client: TisClient,
  options: { semester?: Semester; generatedAt?: Date | string; today?: Date } = {},
): Promise<TisDegreeMissing> {
  const progress = await client.degreeProgress({ details: true });
  let grades: GradeRecord[] | undefined;
  let gradesSourceStatus: DegreeMissingSourceStatus;
  try {
    grades = await client.grades();
    gradesSourceStatus = { state: "available", count: grades.length };
  } catch (error) {
    gradesSourceStatus = { state: "error", message: safeErrorMessage(error, "Grade history was unavailable.") };
  }

  let semester = options.semester;
  let semesterSource: DegreeMissingSemesterSource = options.semester ? "explicit" : "tis-current-term";
  let semesterFallbackMessage: string | undefined;
  if (!semester) {
    try {
      semester = semesterFromCurrentTerm(await client.currentTerm());
    } catch (error) {
      semester = currentSemester(options.today);
      semesterSource = "date-fallback";
      semesterFallbackMessage = safeErrorMessage(error, "TIS current-term metadata was unavailable.");
    }
  }

  let enrolled: PersonalScheduleEntry[] | undefined;
  let enrolledSourceStatus: DegreeMissingSourceStatus;
  try {
    enrolled = await client.enrolled(semester);
    enrolledSourceStatus = {
      state: semesterSource === "date-fallback" ? "fallback" : "available",
      count: enrolled.length,
      semester: semester.value,
      source: semesterSource,
      ...(semesterFallbackMessage ? { message: semesterFallbackMessage } : {}),
    };
  } catch (error) {
    enrolledSourceStatus = {
      state: "error",
      semester: semester.value,
      source: semesterSource,
      message: safeErrorMessage(error, "Current enrollment was unavailable."),
    };
  }

  return evaluateTisDegreeMissing({
    progress,
    grades,
    enrolled,
    enrolledSemester: semester.value,
    enrolledSemesterSource: semesterSource,
    gradesSourceStatus,
    enrolledSourceStatus,
    generatedAt: options.generatedAt,
  });
}

interface RequiredCourseCandidate {
  key: string;
  code?: string;
  name: string;
  groups: Set<string>;
  categories: Set<string>;
  credits?: number;
  hours?: number;
  courseNature?: string;
  majorTrack?: string;
  detailCompletions: DegreeMissingAttempt[];
}

export function evaluateTisDegreeMissing(input: EvaluateTisDegreeMissingInput): TisDegreeMissing {
  const { progress } = input;
  const manualReview: DegreeMissingManualReview[] = [];
  const addReview = manualReviewAdder(manualReview);
  const choiceGaps = buildChoiceGaps(progress);
  const requiredCourses = aggregateRequiredCourses(progress.courses ?? [], addReview);
  const ambiguousRequiredNames = collectAmbiguousRequiredNames(requiredCourses);
  const gradesStatus = normaliseDerivedStatus(input.gradesSourceStatus, input.grades, "Grade history was unavailable.");
  const enrolledStatus = normaliseDerivedStatus(
    input.enrolledSourceStatus,
    input.enrolled,
    "Current enrollment was unavailable.",
    input.enrolledSemester,
    input.enrolledSemesterSource,
  );

  if (!progress.detailsIncluded) {
    addReview("PROGRESS_DETAILS_UNAVAILABLE", progress.sourceStatuses.courses.message
      ? `TIS course details were unavailable: ${progress.sourceStatuses.courses.message}`
      : "TIS course details were unavailable, so exact required-course classification could not be completed.");
  }
  if (input.grades === undefined) {
    addReview("GRADES_UNAVAILABLE", gradesStatus.message || "Grade history was unavailable, so courses without an explicit TIS result remain unresolved.");
  }
  if (input.enrolled === undefined) {
    addReview("ENROLLED_UNAVAILABLE", enrolledStatus.message || "Current enrollment was unavailable, so missing courses cannot be distinguished from courses already in progress.");
  }
  if (enrolledStatus.state === "fallback" || input.enrolledSemesterSource === "date-fallback") {
    addReview(
      "ENROLLMENT_SEMESTER_FALLBACK",
      enrolledStatus.message || "The enrollment semester was inferred from the date because TIS current-term metadata was unavailable.",
    );
  }

  for (const [source, status] of Object.entries(progress.sourceStatuses)) {
    if (source === "courses" || status.state !== "error") continue;
    addReview(
      "PROGRESS_SOURCE_ERROR",
      `${source} source failed: ${status.message || "TIS did not return a usable response."}`,
    );
  }
  for (const warning of progress.warnings) {
    addReview(
      warning.code === "OVERLAPPING_CATEGORIES" ? "OVERLAPPING_CATEGORY" : "DEGREE_PROGRESS_WARNING",
      warning.message,
    );
  }
  for (const category of progress.creditCategories) {
    if (!category.note) continue;
    addReview("CATEGORY_RULE_NOTE", `${category.name}: ${category.note}`);
  }

  const definiteMissingRequiredCourses: DegreeMissingRequiredCourse[] = [];
  const inProgressRequiredCourses: DegreeMissingRequiredCourse[] = [];
  for (const course of requiredCourses) {
    const attempts = matchingGrades(course, input.grades ?? [], ambiguousRequiredNames)
      .map(toAttempt)
      .sort(compareAttemptsNewestFirst);
    const completions = [...attempts, ...course.detailCompletions];
    if (completions.some((attempt) => attempt.completion === "passed")) continue;

    const ambiguousSources = ambiguousNameEvidence(course, input.grades, input.enrolled, ambiguousRequiredNames);
    if (ambiguousSources.length > 0) {
      addReview(
        "REQUIRED_COURSE_STATUS_UNCLEAR",
        `${courseLabel(course)} shares its name with another required course, and ${joinFragments(ambiguousSources)} matched only by name. The CLI did not guess which course it belongs to.`,
        course,
      );
      continue;
    }

    const enrollmentMatch = matchingEnrollment(course, input.enrolled ?? [], ambiguousRequiredNames);
    if (enrollmentMatch) {
      inProgressRequiredCourses.push(renderCourse(course, {
        reason: input.enrolledSemester
          ? `Enrolled in ${input.enrolledSemester}; completion is not counted until a passing result is posted.`
          : "Currently enrolled; completion is not counted until a passing result is posted.",
        previousAttempt: attempts[0] ?? newestAttempt(course.detailCompletions),
        ...(input.enrolledSemester ? { enrolledSemester: input.enrolledSemester } : {}),
        matchedEnrollmentBy: enrollmentMatch,
      }));
      continue;
    }

    const unknownAttempt = completions.find((attempt) => attempt.completion === "unknown");
    if (unknownAttempt) {
      addReview(
        "REQUIRED_COURSE_STATUS_UNCLEAR",
        `${courseLabel(course)} has an unrecognized or incomplete result and was not classified as missing.`,
        course,
      );
      continue;
    }
    if (input.enrolled === undefined) {
      addReview(
        "REQUIRED_COURSE_STATUS_UNCLEAR",
        `${courseLabel(course)} is not known to be passed, but current enrollment was unavailable.`,
        course,
      );
      continue;
    }

    const explicitNonPass = completions.find((attempt) =>
      attempt.completion === "failed" || attempt.completion === "non-completed",
    );
    if (input.grades === undefined && !explicitNonPass) {
      addReview(
        "REQUIRED_COURSE_STATUS_UNCLEAR",
        `${courseLabel(course)} has no explicit passing result in course details, but grade history was unavailable.`,
        course,
      );
      continue;
    }

    const latestAttempt = attempts[0] ?? newestAttempt(course.detailCompletions);
    const reason = explicitNonPass?.completion === "failed"
      ? "The required course has no passing attempt; the latest recognized result is failing."
      : explicitNonPass?.completion === "non-completed"
        ? "The required course has no passing attempt; the latest recognized result is non-completed."
        : "The required course has no passing attempt and is not present in current enrollment.";
    definiteMissingRequiredCourses.push(renderCourse(course, {
      reason,
      ...(latestAttempt ? { latestAttempt } : {}),
    }));
  }

  definiteMissingRequiredCourses.sort(compareRenderedCourses);
  inProgressRequiredCourses.sort(compareRenderedCourses);
  const counts = {
    definiteMissingRequiredCourses: definiteMissingRequiredCourses.length,
    inProgressRequiredCourses: inProgressRequiredCourses.length,
    choiceGaps: choiceGaps.length,
    manualReview: manualReview.length,
  };
  return {
    schemaVersion: "1",
    kind: "tis-degree-missing",
    generatedAt: timestamp(input.generatedAt ?? new Date()),
    reportedAt: progress.reportedAt,
    context: progress.context,
    officialSummary: progress.summary,
    summary: compact({
      remainingCredits: progress.summary.remainingCredits,
      remainingCourses: progress.summary.remainingCourses,
    }),
    advisory: { ...DEGREE_MISSING_ADVISORY },
    ...(input.enrolledSemester && input.enrolledSemesterSource
      ? { enrolledSemester: { value: input.enrolledSemester, source: input.enrolledSemesterSource } }
      : {}),
    definiteMissingRequiredCourses,
    inProgressRequiredCourses,
    choiceGaps,
    manualReview,
    counts,
    sourceStatuses: {
      progressDetails: compact({
        state: (progress.sourceStatuses.courses.state === "available" || progress.sourceStatuses.courses.state === "empty"
          ? "available"
          : "error") as DegreeMissingSourceState,
        count: progress.sourceStatuses.courses.count,
        message: progress.sourceStatuses.courses.message,
      }),
      progress: progress.sourceStatuses,
      grades: gradesStatus,
      enrolled: enrolledStatus,
    },
    warnings: progress.warnings,
  };
}

function aggregateRequiredCourses(
  courses: readonly DegreeProgressCourse[],
  addReview: ReturnType<typeof manualReviewAdder>,
): RequiredCourseCandidate[] {
  const grouped = new Map<string, RequiredCourseCandidate>();
  for (const course of courses) {
    if (course.required !== true) continue;
    const key = courseKey(course.code, course.name);
    if (!key) {
      addReview("REQUIRED_COURSE_IDENTITY_UNCLEAR", "TIS returned a required course without a usable code or name.");
      continue;
    }
    const entry = grouped.get(key) ?? {
      key,
      ...(clean(course.code) ? { code: clean(course.code) } : {}),
      name: clean(course.name) || clean(course.code) || "Unnamed required course",
      groups: new Set<string>(),
      categories: new Set<string>(),
      ...(course.credits !== undefined ? { credits: course.credits } : {}),
      ...(course.hours !== undefined ? { hours: course.hours } : {}),
      ...(clean(course.courseNature) ? { courseNature: clean(course.courseNature) } : {}),
      ...(clean(course.majorTrack) ? { majorTrack: clean(course.majorTrack) } : {}),
      detailCompletions: [],
    };
    if (clean(course.group)) entry.groups.add(clean(course.group));
    if (clean(course.category)) entry.categories.add(clean(course.category));
    if (entry.credits === undefined && course.credits !== undefined) entry.credits = course.credits;
    if (entry.hours === undefined && course.hours !== undefined) entry.hours = course.hours;
    const detailAttempt = courseAttempt(course);
    if (detailAttempt) entry.detailCompletions.push(detailAttempt);
    grouped.set(key, entry);
  }
  return [...grouped.values()];
}

function collectAmbiguousRequiredNames(courses: readonly RequiredCourseCandidate[]): ReadonlySet<string> {
  const counts = new Map<string, number>();
  for (const course of courses) {
    const key = normaliseName(course.name);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key));
}

function buildChoiceGaps(progress: TisDegreeProgress): DegreeMissingChoiceGap[] {
  const output: DegreeMissingChoiceGap[] = [];
  for (const category of progress.creditCategories) {
    if (!positive(category.remainingCredits) && !positive(category.remainingCourses) && !positive(category.remainingHours)) continue;
    output.push(compact({
      scope: "credit-category" as const,
      name: category.name,
      requiredCredits: category.requiredCredits,
      completedCredits: category.completedCredits,
      remainingCredits: category.remainingCredits,
      remainingCourses: category.remainingCourses,
      remainingHours: category.remainingHours,
      note: category.note,
    }));
  }
  for (const module of progress.moduleGaps) {
    if (!positive(module.remainingCredits) && !positive(module.remainingCourses) && module.passed !== false) continue;
    output.push(compact({
      scope: "module" as const,
      name: module.name,
      remainingCredits: module.remainingCredits,
      remainingCourses: module.remainingCourses,
    }));
  }
  return output;
}

function matchingGrades(
  course: RequiredCourseCandidate,
  grades: readonly GradeRecord[],
  ambiguousRequiredNames: ReadonlySet<string>,
): GradeRecord[] {
  return grades.filter((grade) => matchesIdentity(course, grade.code, grade.name, ambiguousRequiredNames));
}

function matchingEnrollment(
  course: RequiredCourseCandidate,
  enrolled: readonly PersonalScheduleEntry[],
  ambiguousRequiredNames: ReadonlySet<string>,
): "code" | "name" | undefined {
  if (course.code) {
    const byCode = enrolled.some((entry) => normaliseCode(entry.courseCode) === normaliseCode(course.code));
    if (byCode) return "code";
    if (hasAmbiguousRequiredName(course, ambiguousRequiredNames)) return undefined;
    const byNameWithNoCode = enrolled.some((entry) =>
      !clean(entry.courseCode) && normaliseName(entry.courseName) === normaliseName(course.name),
    );
    return byNameWithNoCode ? "name" : undefined;
  }
  if (hasAmbiguousRequiredName(course, ambiguousRequiredNames)) return undefined;
  return enrolled.some((entry) => normaliseName(entry.courseName) === normaliseName(course.name)) ? "name" : undefined;
}

function matchesIdentity(
  course: RequiredCourseCandidate,
  code: string,
  name: string,
  ambiguousRequiredNames: ReadonlySet<string>,
): boolean {
  if (course.code) {
    if (clean(code)) return normaliseCode(code) === normaliseCode(course.code);
    if (hasAmbiguousRequiredName(course, ambiguousRequiredNames)) return false;
    return normaliseName(name) === normaliseName(course.name);
  }
  if (hasAmbiguousRequiredName(course, ambiguousRequiredNames)) return false;
  return normaliseName(name) === normaliseName(course.name);
}

function ambiguousNameEvidence(
  course: RequiredCourseCandidate,
  grades: readonly GradeRecord[] | undefined,
  enrolled: readonly PersonalScheduleEntry[] | undefined,
  ambiguousRequiredNames: ReadonlySet<string>,
): string[] {
  if (!hasAmbiguousRequiredName(course, ambiguousRequiredNames)) return [];
  const sources: string[] = [];
  if (ambiguousGradeEvidence(course, grades ?? [])) sources.push("grade rows without a reliable course code");
  if (ambiguousEnrollmentEvidence(course, enrolled ?? [])) sources.push("enrolled-course rows without a reliable course code");
  return sources;
}

function ambiguousGradeEvidence(course: RequiredCourseCandidate, grades: readonly GradeRecord[]): boolean {
  const name = normaliseName(course.name);
  if (!name) return false;
  if (course.code) {
    return grades.some((grade) => !clean(grade.code) && normaliseName(grade.name) === name);
  }
  return grades.some((grade) => normaliseName(grade.name) === name);
}

function ambiguousEnrollmentEvidence(course: RequiredCourseCandidate, enrolled: readonly PersonalScheduleEntry[]): boolean {
  const name = normaliseName(course.name);
  if (!name) return false;
  if (course.code) {
    return enrolled.some((entry) => !clean(entry.courseCode) && normaliseName(entry.courseName) === name);
  }
  return enrolled.some((entry) => normaliseName(entry.courseName) === name);
}

function hasAmbiguousRequiredName(
  course: RequiredCourseCandidate,
  ambiguousRequiredNames: ReadonlySet<string>,
): boolean {
  return ambiguousRequiredNames.has(normaliseName(course.name));
}

function courseAttempt(course: DegreeProgressCourse): DegreeMissingAttempt | undefined {
  if (course.numericScore === undefined && !clean(course.letterGrade)) return undefined;
  const grade: GradeRecord = {
    code: clean(course.code),
    name: clean(course.name),
    nameEn: "",
    semester: clean(course.semester),
    credits: course.credits ?? 0,
    letterGrade: clean(course.letterGrade),
    ...(course.numericScore !== undefined ? { numericScore: course.numericScore } : {}),
    nature: clean(course.courseNature),
    department: clean(course.college),
  };
  return toAttempt(grade);
}

function toAttempt(grade: GradeRecord): DegreeMissingAttempt {
  return compact({
    semester: clean(grade.semester) || undefined,
    letterGrade: clean(grade.letterGrade) || undefined,
    numericScore: grade.numericScore,
    completion: classifyGradeCompletion(grade).completion,
  });
}

function newestAttempt(attempts: readonly DegreeMissingAttempt[]): DegreeMissingAttempt | undefined {
  return [...attempts].sort(compareAttemptsNewestFirst)[0];
}

function compareAttemptsNewestFirst(left: DegreeMissingAttempt, right: DegreeMissingAttempt): number {
  return (right.semester ?? "").localeCompare(left.semester ?? "")
    || ((right.numericScore ?? Number.NEGATIVE_INFINITY) - (left.numericScore ?? Number.NEGATIVE_INFINITY));
}

function renderCourse(
  course: RequiredCourseCandidate,
  extra: Pick<DegreeMissingRequiredCourse, "reason"> & Partial<DegreeMissingRequiredCourse>,
): DegreeMissingRequiredCourse {
  return compact({
    ...(course.code ? { code: course.code } : {}),
    name: course.name,
    groups: [...course.groups].sort(),
    categories: [...course.categories].sort(),
    credits: course.credits,
    hours: course.hours,
    courseNature: course.courseNature,
    majorTrack: course.majorTrack,
    ...extra,
  });
}

function compareRenderedCourses(left: DegreeMissingRequiredCourse, right: DegreeMissingRequiredCourse): number {
  return (left.code ?? left.name).localeCompare(right.code ?? right.name);
}

function normaliseDerivedStatus<T>(
  provided: DegreeMissingSourceStatus | undefined,
  records: readonly T[] | undefined,
  fallbackMessage: string,
  semester?: string,
  source?: DegreeMissingSemesterSource,
): DegreeMissingSourceStatus {
  const state: DegreeMissingSourceState = provided?.state ?? (records === undefined ? "error" : "available");
  return compact({
    state,
    count: provided?.count ?? records?.length,
    semester: provided?.semester ?? semester,
    source: provided?.source ?? source,
    message: sanitise(provided?.message ?? (records === undefined ? fallbackMessage : "")) || undefined,
  });
}

function manualReviewAdder(target: DegreeMissingManualReview[]) {
  const seen = new Set<string>();
  return (
    code: DegreeMissingManualReview["code"],
    rawMessage: string,
    course?: Pick<RequiredCourseCandidate, "code" | "name">,
  ): void => {
    const message = sanitise(rawMessage);
    const key = `${code}|${course?.code ?? ""}|${course?.name ?? ""}|${message}`;
    if (seen.has(key)) return;
    seen.add(key);
    target.push({
      code,
      message,
      ...(course ? { course: compact({ code: course.code, name: course.name }) } : {}),
    });
  };
}

function courseKey(code: string | undefined, name: string | undefined): string | undefined {
  if (clean(code)) return `code:${normaliseCode(code)}`;
  if (clean(name)) return `name:${normaliseName(name)}`;
  return undefined;
}

function courseLabel(course: Pick<RequiredCourseCandidate, "code" | "name">): string {
  return [clean(course.code), clean(course.name)].filter(Boolean).join(" ") || "Required course";
}

function normaliseCode(value: string | undefined): string {
  return clean(value).toUpperCase().replaceAll(/\s+/g, "");
}

function normaliseName(value: string | undefined): string {
  return clean(value).toLocaleLowerCase().replaceAll(/\s+/g, "");
}

function clean(value: string | undefined): string {
  return value?.trim() ?? "";
}

function positive(value: number | undefined): boolean {
  return value !== undefined && value > 0;
}

function timestamp(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function sanitise(value: string): string {
  return value
    .replace(/(password|authorization|cookie|token|sid)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replaceAll(/\s+/g, " ")
    .trim()
    .slice(0, 360);
}

function safeErrorMessage(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  return sanitise(raw) || fallback;
}

function joinFragments(values: readonly string[]): string {
  if (values.length <= 1) return values[0] ?? "";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== ""),
  ) as T;
}
