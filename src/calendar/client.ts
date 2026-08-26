import { CliError } from "../core/errors.js";
import { fetchJson } from "../core/http.js";
import type { Semester } from "../core/semester.js";
import type {
  CalendarDayInfo,
  CalendarLevel,
  CalendarPayloads,
  CalendarTermSnapshot,
  CompensatoryDay,
  Holiday,
  SemesterSeason,
  TeachingWindow,
  WeekdayName,
  WeekParity,
} from "./types.js";

const DEFAULT_REPO_BASE = "https://raw.githubusercontent.com/dumixthestpd/sustech-calendar/main";
const WEEKDAYS: WeekdayName[] = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

export class CalendarError extends CliError {
  public constructor(message: string, code: string, details?: Record<string, unknown>) {
    super(message, code, 1, details);
    this.name = "CalendarError";
  }
}

export class CalendarTerm {
  private readonly holidayList: Holiday[];
  private readonly extraBreakSet: Set<string>;

  public constructor(
    public readonly snapshot: CalendarTermSnapshot,
    holidays: Holiday[],
  ) {
    this.holidayList = holidays;
    this.extraBreakSet = new Set(snapshot.extraBreaks);
  }

  public dateOf(week: number, weekday: number | WeekdayName): string {
    const weekdayIndex = typeof weekday === "number" ? weekday : WEEKDAYS.indexOf(weekday);
    const maxWeek = Math.max(
      this.snapshot.totalTeachingWeeks,
      ...this.snapshot.midterm.equivalentWeeks,
      ...this.snapshot.final.equivalentWeeks,
    );
    if (!Number.isInteger(week) || week < 1 || week > maxWeek) {
      throw new CalendarError("Week is out of range for this semester.", "CALENDAR_WEEK_OUT_OF_RANGE", {
        week,
        maxWeek,
        semester: this.snapshot.humanName,
      });
    }
    if (!Number.isInteger(weekdayIndex) || weekdayIndex < 0 || weekdayIndex > 6) {
      throw new CalendarError("Weekday must be between 0 and 6.", "CALENDAR_WEEKDAY_OUT_OF_RANGE", {
        weekday,
      });
    }
    return formatDate(addDays(teachingMonday(this.snapshot.teachingStart), ((week - 1) * 7) + weekdayIndex));
  }

  public weekOf(input: Date | string): number {
    const date = dateOnly(input);
    if (!this.contains(date)) return 0;
    return Math.floor(daysBetween(teachingMonday(this.snapshot.teachingStart), date) / 7) + 1;
  }

  public contains(input: Date | string): boolean {
    const date = dateOnly(input);
    return compare(date, this.snapshot.signIn) >= 0 && compare(date, this.snapshot.final.end) <= 0;
  }

  public day(input: Date | string): CalendarDayInfo {
    const date = dateOnly(input);
    const dateKey = formatDate(date);
    const week = this.weekOf(date);
    const weekdayIndex = mondayIndex(date);
    const weekday = WEEKDAYS[weekdayIndex];
    const holiday = this.holidayAt(dateKey);
    const compensatory = this.snapshot.compensatories.find((candidate) => candidate.date === dateKey);
    const isFinal = week > 0 && this.snapshot.final.equivalentWeeks.includes(week);
    const isMidterm = week > 0 && this.snapshot.midterm.equivalentWeeks.includes(week);
    const isExtraBreak = this.extraBreakSet.has(dateKey);
    const isWeekend = weekdayIndex >= 5;
    const isTeachingDay = week > 0 && !holiday && !compensatory && !isFinal && !isExtraBreak && !isWeekend;

    return {
      date: dateKey,
      weekday,
      weekdayIndex,
      week,
      label: week > 0 ? `Week ${week} of ${this.snapshot.humanName}` : `Outside ${this.snapshot.humanName}`,
      phase: `${this.snapshot.humanName} semester`,
      ...(holiday ? { holiday } : {}),
      ...(compensatory ? { compensatory } : {}),
      semester: {
        season: this.snapshot.season,
        level: this.snapshot.level,
        humanName: this.snapshot.humanName,
        semester: this.snapshot.semester,
      },
      flags: {
        isHoliday: holiday !== undefined,
        isCompensatory: compensatory !== undefined,
        isTeachingDay,
        hasClass: isTeachingDay || compensatory !== undefined,
        isExtraBreak,
        isFinal,
        isMidterm,
        isWeekend,
      },
    };
  }

  private holidayAt(date: string): Holiday | undefined {
    return this.holidayList.find((holiday) => holiday.start <= date && date <= holiday.end);
  }
}

export class AcademicCalendar {
  public readonly spring: CalendarTerm;
  public readonly fall: CalendarTerm;
  public readonly summer?: CalendarTerm;

  private readonly holidaysByDate: Holiday[];

  public constructor(
    public readonly year: number,
    public readonly level: CalendarLevel,
    snapshots: {
      spring: CalendarTermSnapshot;
      fall: CalendarTermSnapshot;
      summer?: CalendarTermSnapshot;
      holidays: Holiday[];
    },
  ) {
    this.holidaysByDate = [...snapshots.holidays];
    this.spring = new CalendarTerm(snapshots.spring, this.holidaysByDate);
    this.fall = new CalendarTerm(snapshots.fall, this.holidaysByDate);
    this.summer = snapshots.summer ? new CalendarTerm(snapshots.summer, this.holidaysByDate) : undefined;
  }

  public terms(): CalendarTerm[] {
    return [this.spring, ...(this.summer ? [this.summer] : []), this.fall];
  }

  public day(input: Date | string = new Date()): CalendarDayInfo {
    const date = dateOnly(input);
    for (const term of this.terms()) {
      if (term.contains(date)) return term.day(date);
    }
    const dateKey = formatDate(date);
    const holiday = this.holidaysByDate.find((candidate) => candidate.start <= dateKey && dateKey <= candidate.end);
    const weekdayIndex = mondayIndex(date);
    const weekday = WEEKDAYS[weekdayIndex];
    return {
      date: dateKey,
      weekday,
      weekdayIndex,
      week: 0,
      label: "Outside the loaded semesters",
      phase: "Out of semester",
      ...(holiday ? { holiday } : {}),
      flags: {
        isHoliday: holiday !== undefined,
        isCompensatory: false,
        isTeachingDay: false,
        hasClass: false,
        isExtraBreak: false,
        isFinal: false,
        isMidterm: false,
        isWeekend: weekdayIndex >= 5,
      },
    };
  }

  public static fromPayloads(
    year: number,
    level: CalendarLevel,
    payloads: CalendarPayloads,
  ): AcademicCalendar {
    const selected = level === "undergraduate" ? payloads.undergraduate : payloads.graduate;
    const spring = termFromPayload("spring", level, expectRecord(selected.spring_semester), year);
    const fall = termFromPayload("fall", level, expectRecord(selected.fall_semester), year);
    const rawSummer = asRecord(selected.summer_semester);
    const summer = rawSummer.teaching_start ? termFromPayload("summer", level, rawSummer, year) : undefined;
    return new AcademicCalendar(year, level, {
      spring,
      fall,
      ...(summer ? { summer } : {}),
      holidays: asArray(payloads.general.holidays).map(normaliseHoliday),
    });
  }
}

export class CalendarClient {
  public async loadYear(
    year: number,
    level: CalendarLevel = "undergraduate",
    options: { baseUrl?: string; timeoutMs?: number } = {},
  ): Promise<AcademicCalendar> {
    const baseUrl = yearBaseUrl(options.baseUrl ?? DEFAULT_REPO_BASE, year);
    const [undergraduate, graduate, general] = await Promise.all([
      fetchJson(`${baseUrl}/undergraduate.json`, options),
      fetchJson(`${baseUrl}/graduate.json`, options),
      fetchJson(`${baseUrl}/general.json`, options),
    ]);
    return AcademicCalendar.fromPayloads(year, level, {
      undergraduate: expectRecord(undergraduate),
      graduate: expectRecord(graduate),
      general: expectRecord(general),
    });
  }
}

function termFromPayload(
  season: SemesterSeason,
  level: CalendarLevel,
  payload: Record<string, unknown>,
  year: number,
): CalendarTermSnapshot {
  const teachingStart = expectDate(payload.teaching_start, "teaching_start");
  const finalWindow = windowFromPayload(expectRecord(payload.final), "final");
  const midtermWindow = windowFromPayload(expectRecord(payload.midterm), "midterm");
  return {
    season,
    level,
    humanName: `${teachingStart.slice(0, 4)} ${capitalise(season)}`,
    semester: termSemester(teachingStart, season),
    start: optionalDate(payload.start) ?? teachingStart,
    end: optionalDate(payload.end) ?? finalWindow.end,
    signIn: expectDate(payload.sign_in, "sign_in"),
    teachingStart,
    teachingEnd: lastTeachingDay(teachingStart, finalWindow),
    ...(optionalDate(payload.freshman_arrival) ? { freshmanArrival: optionalDate(payload.freshman_arrival) } : {}),
    totalTeachingWeeks: expectInteger(payload.total_teaching_weeks, "total_teaching_weeks"),
    midterm: midtermWindow,
    final: finalWindow,
    compensatories: asArray(payload.compensatories).map(normaliseCompensatory),
    extraBreaks: asArray(payload.extra_breaks).map((value) => expectDate(value, "extra_break")),
  };
}

function windowFromPayload(payload: Record<string, unknown>, name: string): TeachingWindow {
  return {
    start: expectDate(payload.start, `${name}.start`),
    end: expectDate(payload.end, `${name}.end`),
    equivalentWeeks: asArray(payload.equivalent_weeks).map((value) => expectInteger(value, `${name}.equivalent_weeks`)),
  };
}

function normaliseHoliday(value: unknown): Holiday {
  const holiday = expectRecord(value);
  return {
    name: expectString(holiday.name, "holiday.name"),
    start: expectDate(holiday.start, "holiday.start"),
    end: expectDate(holiday.end, "holiday.end"),
  };
}

function normaliseCompensatory(value: unknown): CompensatoryDay {
  const day = expectRecord(value);
  const weekType = expectString(day.week_type, "compensatory.week_type");
  const workday = expectString(day.workday_type, "compensatory.workday_type");
  if (weekType !== "odd" && weekType !== "even") {
    throw new CalendarError("Compensatory day returned an invalid week parity.", "CALENDAR_PROTOCOL_ERROR", {
      weekType,
    });
  }
  if (!WEEKDAYS.includes(workday as WeekdayName)) {
    throw new CalendarError("Compensatory day returned an invalid weekday.", "CALENDAR_PROTOCOL_ERROR", {
      workday,
    });
  }
  return {
    date: expectDate(day.date, "compensatory.date"),
    weekType: weekType as WeekParity,
    workday: workday as WeekdayName,
  };
}

function termSemester(teachingStart: string, season: SemesterSeason): Semester {
  const year = Number(teachingStart.slice(0, 4));
  if (season === "fall") {
    return { xn: `${year}-${year + 1}`, xq: "1", value: `${year}-${year + 1}-1` };
  }
  const xq = season === "spring" ? "2" : "3";
  return { xn: `${year - 1}-${year}`, xq, value: `${year - 1}-${year}-${xq}` };
}

function lastTeachingDay(teachingStart: string, finalWindow: TeachingWindow): string {
  const finalWeeks = [...finalWindow.equivalentWeeks].sort((left, right) => left - right);
  const lastTeachingWeek = (finalWeeks[0] ?? 1) - 1;
  if (lastTeachingWeek < 1) {
    return formatDate(addDays(teachingStart, -1));
  }
  const monday = teachingMonday(teachingStart);
  const lastCandidate = addDays(monday, ((lastTeachingWeek - 1) * 7) + 6);
  return formatDate(minDate(lastCandidate, addDays(finalWindow.end, -1)));
}

function yearBaseUrl(baseUrl: string, year: number): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return /\/\d{4}$/.test(trimmed) ? trimmed : `${trimmed}/${year}`;
}

function teachingMonday(date: string): Date {
  const value = dateOnly(date);
  return addDays(value, -mondayIndex(value));
}

function mondayIndex(value: Date): number {
  return (value.getUTCDay() + 6) % 7;
}

function dateOnly(input: Date | string): Date {
  if (input instanceof Date) {
    return new Date(Date.UTC(input.getFullYear(), input.getMonth(), input.getDate()));
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(input);
  if (!match) {
    throw new CalendarError("Date must be in YYYY-MM-DD format.", "CALENDAR_INVALID_DATE", { input });
  }
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(input: Date | string, days: number): Date {
  const date = input instanceof Date ? input : dateOnly(input);
  return new Date(date.getTime() + (days * 24 * 60 * 60 * 1000));
}

function compare(left: Date | string, right: Date | string): number {
  return dateOnly(left).getTime() - dateOnly(right).getTime();
}

function minDate(left: Date, right: Date): Date {
  return left.getTime() <= right.getTime() ? left : right;
}

function daysBetween(left: Date | string, right: Date | string): number {
  return Math.round((dateOnly(right).getTime() - dateOnly(left).getTime()) / (24 * 60 * 60 * 1000));
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function expectRecord(value: unknown): Record<string, unknown> {
  const record = asRecord(value);
  if (Object.keys(record).length === 0 && value !== record) {
    throw new CalendarError("Calendar payload had an invalid object shape.", "CALENDAR_PROTOCOL_ERROR");
  }
  return record;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function expectString(value: unknown, field: string): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  throw new CalendarError("Calendar payload omitted a required string field.", "CALENDAR_PROTOCOL_ERROR", { field });
}

function expectDate(value: unknown, field: string): string {
  const date = expectString(value, field);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new CalendarError("Calendar payload returned an invalid date.", "CALENDAR_PROTOCOL_ERROR", {
      field,
      value,
    });
  }
  return date;
}

function optionalDate(value: unknown): string | undefined {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? value.trim() : undefined;
}

function expectInteger(value: unknown, field: string): number {
  const parsed = Number(value);
  if (Number.isInteger(parsed)) return parsed;
  throw new CalendarError("Calendar payload returned an invalid integer.", "CALENDAR_PROTOCOL_ERROR", {
    field,
    value,
  });
}
