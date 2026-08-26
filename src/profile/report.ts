import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, stat, unlink } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { CliError } from "../core/errors.js";
import { maskSid } from "../core/keyring.js";
import { writeJsonAtomically } from "../core/local-store.js";
import type { Semester } from "../core/semester.js";
import type { BlackboardDeadline, BlackboardDeadlineReport } from "../services/blackboard.js";
import type { ExamRecord, PersonalScheduleEntry } from "../tis/types.js";

export const STUDENT_PROFILE_SCHEMA_VERSION = "1";
export const STUDENT_PROFILE_KIND = "sustech-student-profile";

export type StudentProfileSourceStatus = "ok" | "partial" | "missing" | "error";
export type StudentProfileSourceName = "tisIdentity" | "tisCurrentCourses" | "tisNextExam" | "blackboardNextDeadline";

export interface StudentProfileFailure {
  code: string;
  message: string;
}

export interface StudentProfileSource<T> {
  status: StudentProfileSourceStatus;
  data: T | null;
  failures: StudentProfileFailure[];
}

export interface TisIdentitySummary {
  studentIdMasked?: string;
  name?: string;
  department?: string;
  studentType?: string;
}

export interface TisCurrentCoursesSummary {
  semester: string;
  courseCount: number;
  sourceRows: number;
  omittedRows: number;
}

export interface TisExamSummary {
  semester: string;
  code: string;
  name: string;
  date: string;
  time: string;
  weekday?: string;
  building?: string;
  room?: string;
  campus?: string;
  type?: string;
}

export interface BlackboardDeadlineSummary {
  courseCode: string;
  courseName: string;
  title: string;
  dueAt: string;
  daysLeft: number;
}

export interface StudentProfileReport {
  schemaVersion: typeof STUDENT_PROFILE_SCHEMA_VERSION;
  kind: typeof STUDENT_PROFILE_KIND;
  generatedAt: string;
  semester: string;
  identity: TisIdentitySummary | null;
  academics: {
    currentCourses: TisCurrentCoursesSummary | null;
    nextExam: TisExamSummary | null;
    nextBlackboardDeadline: BlackboardDeadlineSummary | null;
  };
  sources: {
    tisIdentity: StudentProfileSource<TisIdentitySummary>;
    tisCurrentCourses: StudentProfileSource<TisCurrentCoursesSummary>;
    tisNextExam: StudentProfileSource<TisExamSummary>;
    blackboardNextDeadline: StudentProfileSource<BlackboardDeadlineSummary>;
  };
  summary: {
    okSources: number;
    partialSources: number;
    missingSources: number;
    errorSources: number;
  };
}

export async function collectStudentProfile(input: {
  semester: Semester;
  generatedAt?: Date | string;
  loadTisUserMe: () => Promise<unknown>;
  loadCurrentCourses: () => Promise<readonly PersonalScheduleEntry[]>;
  loadExams: () => Promise<readonly ExamRecord[]>;
  loadBlackboardDeadlines: () => Promise<BlackboardDeadlineReport>;
}): Promise<StudentProfileReport> {
  const generatedAt = normaliseIsoTimestamp(input.generatedAt ?? new Date());
  const tisIdentity = await captureProfileSource(async () => {
    const identity = tisIdentityFromUserMe(await input.loadTisUserMe());
    if (!identity) {
      throw new CliError(
        "TIS user profile did not expose any whitelisted identity fields.",
        "TIS_PROFILE_UNSUPPORTED",
        1,
      );
    }
    return identity;
  });
  const tisCurrentCourses = await captureTisCurrentCoursesSource(input.loadCurrentCourses, input.semester);
  const tisNextExam = await captureTisNextExamSource(input.loadExams, input.semester, new Date(generatedAt));
  const blackboardNextDeadline = await captureBlackboardDeadlineSource(input.loadBlackboardDeadlines);
  const sources = {
    tisIdentity,
    tisCurrentCourses,
    tisNextExam,
    blackboardNextDeadline,
  };
  const statusCounts = Object.values(sources).reduce(
    (totals, source) => {
      if (source.status === "ok") totals.okSources += 1;
      if (source.status === "partial") totals.partialSources += 1;
      if (source.status === "missing") totals.missingSources += 1;
      if (source.status === "error") totals.errorSources += 1;
      return totals;
    },
    { okSources: 0, partialSources: 0, missingSources: 0, errorSources: 0 },
  );
  return {
    schemaVersion: STUDENT_PROFILE_SCHEMA_VERSION,
    kind: STUDENT_PROFILE_KIND,
    generatedAt,
    semester: input.semester.value,
    identity: tisIdentity.data,
    academics: {
      currentCourses: tisCurrentCourses.data,
      nextExam: tisNextExam.data,
      nextBlackboardDeadline: blackboardNextDeadline.data,
    },
    sources,
    summary: statusCounts,
  };
}

export function hasExportableProfileData(report: StudentProfileReport): boolean {
  return [report.identity, report.academics.currentCourses, report.academics.nextExam, report.academics.nextBlackboardDeadline]
    .some((value) => value !== null);
}

export async function saveStudentProfile(
  destination: string,
  report: StudentProfileReport,
  options: { overwrite?: boolean } = {},
): Promise<string> {
  const absolutePath = resolveRequiredPath(destination, "Profile export destination");
  if (options.overwrite) {
    await writeJsonAtomically(absolutePath, report);
    return absolutePath;
  }

  await rejectExistingDestination(absolutePath);
  const temporary = resolve(dirname(absolutePath), `.${basename(absolutePath)}.${process.pid}.${randomUUID()}.profile-tmp`);
  let temporaryWritten = false;
  try {
    await writeJsonAtomically(temporary, report);
    temporaryWritten = true;
    await copyFile(temporary, absolutePath, constants.COPYFILE_EXCL);
  } catch (error) {
    if (isNodeError(error, "EEXIST")) {
      throw new CliError(
        `Refusing to replace an existing profile export: ${absolutePath}`,
        "PROFILE_EXPORT_EXISTS",
        2,
        { path: absolutePath },
      );
    }
    throw error;
  } finally {
    if (temporaryWritten) await unlink(temporary).catch(() => undefined);
  }
  return absolutePath;
}

export function tisIdentityFromUserMe(raw: unknown): TisIdentitySummary | null {
  const record = objectValue(raw);
  const studentId = firstScalar(record, "studentId", "sid", "xh", "yhdm");
  const name = firstScalar(record, "name", "xm", "trueName");
  const department = firstScalar(record, "department", "szmc", "deptName", "ssmc");
  const studentType = firstScalar(record, "pylx", "pylxmc", "studentType");
  const identity: TisIdentitySummary = {
    ...(studentId ? { studentIdMasked: maskSid(studentId) } : {}),
    ...(name ? { name } : {}),
    ...(department ? { department } : {}),
    ...(studentType ? { studentType } : {}),
  };
  return Object.keys(identity).length > 0 ? identity : null;
}

function blackboardDeadlineSummary(deadline: BlackboardDeadline): BlackboardDeadlineSummary {
  return {
    courseCode: deadline.courseCode,
    courseName: deadline.courseName,
    title: deadline.title,
    dueAt: deadline.dueAt,
    daysLeft: deadline.daysLeft,
  };
}

function tisExamSummary(exam: ExamRecord): TisExamSummary {
  return {
    semester: exam.semester,
    code: exam.code,
    name: exam.name,
    date: exam.date,
    time: exam.time,
    ...(exam.weekday ? { weekday: exam.weekday } : {}),
    ...(exam.building ? { building: exam.building } : {}),
    ...(exam.room ? { room: exam.room } : {}),
    ...(exam.campus ? { campus: exam.campus } : {}),
    ...(exam.type ? { type: exam.type } : {}),
  };
}

async function captureTisNextExamSource(
  loadExams: () => Promise<readonly ExamRecord[]>,
  semester: Semester,
  generatedAt: Date,
): Promise<StudentProfileSource<TisExamSummary>> {
  try {
    const exams = await loadExams();
    const failures: StudentProfileFailure[] = [];
    const unknownSemesterCount = exams.filter((exam) => !exam.semester).length;
    if (unknownSemesterCount > 0) {
      failures.push({
        code: "EXAM_SEMESTER_UNKNOWN",
        message: `${unknownSemesterCount} exam record(s) were omitted because TIS did not identify their semester.`,
      });
    }
    const nextExam = exams
      .filter((exam) => exam.semester && semesterLabelMatches(exam.semester, semester))
      .map((exam) => examFutureCandidate(exam, generatedAt))
      .flatMap((candidate) => {
        if (candidate.failure) failures.push(candidate.failure);
        return candidate.exam ? [candidate.exam] : [];
      })
      .sort((left, right) =>
        left.sortDate.localeCompare(right.sortDate)
        || left.sortMinutes - right.sortMinutes
        || left.exam.code.localeCompare(right.exam.code)
        || left.exam.name.localeCompare(right.exam.name),
      )[0]?.exam;
    if (!nextExam) {
      return {
        status: failures.length > 0 ? "partial" : "missing",
        data: null,
        failures,
      };
    }
    return {
      status: failures.length > 0 ? "partial" : "ok",
      data: tisExamSummary(nextExam),
      failures,
    };
  } catch (error) {
    return profileSourceError(error);
  }
}

async function captureBlackboardDeadlineSource(
  loadDeadlines: () => Promise<BlackboardDeadlineReport>,
): Promise<StudentProfileSource<BlackboardDeadlineSummary>> {
  try {
    const report = await loadDeadlines();
    const nextDeadline = report.deadlines[0];
    const failures = report.failures.map((failure) => ({
      code: failure.code || "BLACKBOARD_DEADLINE_READ_FAILED",
      message: sanitiseFailureMessage(failure.message),
    }));
    if (!nextDeadline) {
      return {
        status: failures.length > 0 ? "partial" : "missing",
        data: null,
        failures,
      };
    }
    return {
      status: failures.length > 0 ? "partial" : "ok",
      data: blackboardDeadlineSummary(nextDeadline),
      failures,
    };
  } catch (error) {
    return profileSourceError(error);
  }
}

async function captureProfileSource<T>(load: () => Promise<T>): Promise<StudentProfileSource<T>> {
  try {
    return {
      status: "ok",
      data: await load(),
      failures: [],
    };
  } catch (error) {
    return profileSourceError(error);
  }
}

async function captureTisCurrentCoursesSource(
  loadCurrentCourses: () => Promise<readonly PersonalScheduleEntry[]>,
  semester: Semester,
): Promise<StudentProfileSource<TisCurrentCoursesSummary>> {
  try {
    const entries = await loadCurrentCourses();
    const identities = new Set<string>();
    let omittedRows = 0;
    for (const entry of entries) {
      const identity = stableCourseIdentity(entry);
      if (!identity) {
        omittedRows += 1;
        continue;
      }
      identities.add(identity);
    }
    const data: TisCurrentCoursesSummary = {
      semester: semester.value,
      courseCount: identities.size,
      sourceRows: entries.length,
      omittedRows,
    };
    if (omittedRows > 0) {
      return {
        status: "partial",
        data,
        failures: [{
          code: "COURSE_IDENTITY_UNKNOWN",
          message: `${omittedRows} course row(s) were omitted because neither rwh nor courseCode was available for stable deduplication.`,
        }],
      };
    }
    return {
      status: "ok",
      data,
      failures: [],
    };
  } catch (error) {
    return profileSourceError(error);
  }
}

function profileSourceError<T>(error: unknown): StudentProfileSource<T> {
  return {
    status: "error",
    data: null,
    failures: [profileFailure(error)],
  };
}

function profileFailure(error: unknown): StudentProfileFailure {
  const code = error instanceof CliError ? error.code : "UNEXPECTED_ERROR";
  if (code === "CREDENTIALS_REQUIRED") {
    return {
      code,
      message: "Credentials are required; configure a saved profile, environment variables, or --credentials-file.",
    };
  }
  const raw = error instanceof Error ? error.message : String(error ?? "unknown profile failure");
  const message = sanitiseFailureMessage(raw);
  return { code, message: message || "profile source failed" };
}

function resolveRequiredPath(path: string, label: string): string {
  const trimmed = path.trim();
  if (!trimmed) throw new CliError(`${label} is required.`, "USAGE", 2);
  return resolve(trimmed);
}

async function rejectExistingDestination(path: string): Promise<void> {
  let metadata: Awaited<ReturnType<typeof stat>>;
  try {
    metadata = await stat(path);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return;
    throw error;
  }
  if (!metadata.isFile()) {
    throw new CliError("Profile export destination must be a regular file path.", "PROFILE_EXPORT_INVALID_DESTINATION", 2, { path });
  }
  throw new CliError(
    `The profile export destination already exists; pass --overwrite to replace it.`,
    "PROFILE_EXPORT_EXISTS",
    2,
    { path },
  );
}

function objectValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function firstScalar(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function stableCourseIdentity(entry: PersonalScheduleEntry): string {
  const rwh = entry.rwh.trim();
  if (rwh) return `rwh:${rwh}`;
  const courseCode = entry.courseCode.trim();
  if (courseCode) return `courseCode:${courseCode}`;
  return "";
}

function examFutureCandidate(
  exam: ExamRecord,
  generatedAt: Date,
): { exam?: { exam: ExamRecord; sortDate: string; sortMinutes: number }; failure?: StudentProfileFailure } {
  const current = shanghaiClock(generatedAt);
  const examDate = normaliseExamDate(exam.date);
  if (!examDate) {
    return {
      failure: {
        code: "EXAM_DATE_UNKNOWN",
        message: `Exam ${exam.code || exam.name || "(unnamed)"} was omitted because TIS returned an unparseable date.`,
      },
    };
  }
  if (examDate < current.date) return {};
  const timeWindow = parseExamTimeWindow(exam.time);
  if (examDate > current.date) {
    return {
      exam: {
        exam,
        sortDate: examDate,
        sortMinutes: timeWindow?.start ?? 0,
      },
    };
  }
  if (!timeWindow) {
    return {
      failure: {
        code: "EXAM_TIME_UNKNOWN_TODAY",
        message: `Exam ${exam.code || exam.name || "(unnamed)"} on ${examDate} was omitted because TIS did not provide a parseable time for a same-day exam.`,
      },
    };
  }
  const cutoff = timeWindow.end ?? timeWindow.start;
  if (current.minutes >= cutoff) return {};
  return {
    exam: {
      exam,
      sortDate: examDate,
      sortMinutes: timeWindow.start,
    },
  };
}

function normaliseExamDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(parsed.getTime())) return "";
  const normalized = `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, "0")}-${String(parsed.getUTCDate()).padStart(2, "0")}`;
  return normalized === `${match[1]}-${match[2]}-${match[3]}` ? normalized : "";
}

function parseExamTimeWindow(time: string): { start: number; end?: number } | null {
  const trimmed = time.trim();
  if (!trimmed) return null;
  const range = /^(\d{1,2}):(\d{2})(?:\s*-\s*(\d{1,2}):(\d{2}))?$/.exec(trimmed);
  if (!range) return null;
  const start = clockMinutes(range[1], range[2]);
  const end = range[3] && range[4] ? clockMinutes(range[3], range[4]) : undefined;
  if (start === null || (end !== undefined && end === null)) return null;
  return { start, ...(end !== undefined ? { end } : {}) };
}

function clockMinutes(hoursText: string, minutesText: string): number | null {
  const hours = Number(hoursText);
  const minutes = Number(minutesText);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
}

function shanghaiClock(value: Date): { date: string; minutes: number } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(value);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  const hour = parts.find((part) => part.type === "hour")?.value;
  const minute = parts.find((part) => part.type === "minute")?.value;
  if (!year || !month || !day || !hour || !minute) {
    throw new CliError("Profile timestamp could not be normalized for Asia/Shanghai.", "PROFILE_INVALID", 2);
  }
  return {
    date: `${year}-${month}-${day}`,
    minutes: Number(hour) * 60 + Number(minute),
  };
}

function sanitiseFailureMessage(raw: string): string {
  return raw
    .replace(/(password|authorization|cookie|token)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

function semesterLabelMatches(label: string, semester: Semester): boolean {
  const season = semester.xq === "1" ? "秋季" : semester.xq === "2" ? "春季" : "夏季";
  const startYear = semester.xn.slice(0, 4);
  const endYear = semester.xn.slice(5);
  return [semester.value, `${semester.xn}${semester.xq}`, `${startYear}${season}`, `${endYear}${season}`]
    .some((candidate) => label.includes(candidate))
    || (label.includes(semester.xn) && label.includes(season));
}

function normaliseIsoTimestamp(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new CliError("Profile timestamp is invalid.", "PROFILE_INVALID", 2, { value });
  return date.toISOString();
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
