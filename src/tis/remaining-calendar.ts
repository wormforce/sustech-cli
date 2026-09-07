import { createHash, randomUUID } from "node:crypto";
import { constants as fileSystemConstants } from "node:fs";
import { copyFile, link, lstat, open, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join, resolve as resolvePath } from "node:path";
import { CliError } from "../core/errors.js";
import { assertPathAndParentsAreNotSymlinks } from "../core/local-store.js";
import type { CalendarTerm } from "../calendar/client.js";
import type { CompensatoryDay, Holiday, WeekdayName } from "../calendar/types.js";
import type { ExamRecord, PersonalScheduleEntry } from "./types.js";
import { addUtcDays, parseIsoDate, toIsoDate } from "./remaining-shared.js";

export interface IcsAnchor {
  weekOneMonday?: string;
  teachingStartDate?: string;
}

export interface IcsOccurrence {
  uid: string;
  summary: string;
  location?: string;
  description: string;
  startUtc: string;
  endUtc: string;
  date: string;
  week: number;
  day: number;
  periodStart: number;
  periodEnd: number;
  isCompensatory?: true;
  sourceDate?: string;
  sourceWeekday?: WeekdayName;
}

export interface IcsEvent {
  uid: string;
  summary: string;
  description: string;
  location?: string;
  startUtc?: string;
  endUtc?: string;
  startDate?: string;
  endDateExclusive?: string;
}

export interface IcsFileWriteResult {
  destination: string;
  size: number;
  sha256: string;
  overwritten: boolean;
}

export interface ScheduleReminderSummary {
  now?: string;
  next?: string;
  nextDetail?: string;
  tomorrowMorning?: string;
}

export interface ExamSelectionResult {
  exam?: ExamRecord;
  omissions: { code: string; message: string }[];
}

export interface TeachingPeriodWindow {
  date: string;
  time: string;
  weekday: number;
  periodStart: number;
  periodEnd: number;
  periodLabel: string;
}

const CHINA_OFFSET_MINUTES = 8 * 60;
const CURRENT_PERIOD_SCHEDULE_START = "2026-09-07";
export const PERIOD_START_TIMES: Readonly<Record<number, [number, number]>> = {
  1: [8, 0],
  2: [9, 0],
  3: [10, 20],
  4: [11, 20],
  5: [14, 0],
  6: [15, 0],
  7: [16, 20],
  8: [17, 20],
  9: [19, 0],
  10: [20, 0],
  11: [21, 0],
};
const LEGACY_PERIOD_START_TIMES: Readonly<Record<number, [number, number]>> = {
  1: [8, 0],
  2: [9, 0],
  3: [10, 20],
  4: [11, 20],
  5: [13, 30],
  6: [14, 30],
  7: [15, 30],
  8: [16, 30],
  9: [18, 0],
  10: [19, 0],
  11: [20, 0],
  12: [21, 0],
  13: [22, 0],
};
export const PERIOD_DURATION_MINUTES = 50;

export function inferWeekOneMonday(todayIsoDate: string, currentWeek: number): string {
  if (!Number.isInteger(currentWeek) || currentWeek < 1) {
    throw new CliError("Current week must be a positive integer.", "INVALID_CURRENT_WEEK", 2, { currentWeek });
  }
  const today = parseIsoDate(todayIsoDate);
  const mondayOffset = today.getUTCDay() === 0 ? -6 : 1 - today.getUTCDay();
  const currentWeekMonday = addUtcDays(today, mondayOffset);
  return toIsoDate(addUtcDays(currentWeekMonday, -7 * (currentWeek - 1)));
}

export function weekOneMondayFromAnchor(anchor: IcsAnchor): string {
  if (anchor.weekOneMonday) return anchor.weekOneMonday;
  if (!anchor.teachingStartDate) {
    throw new CliError("ICS export requires weekOneMonday or teachingStartDate.", "ICS_ANCHOR_REQUIRED", 2);
  }
  const teachingStart = parseIsoDate(anchor.teachingStartDate);
  const mondayOffset = teachingStart.getUTCDay() === 0 ? -6 : 1 - teachingStart.getUTCDay();
  return toIsoDate(addUtcDays(teachingStart, mondayOffset));
}

export function scheduleOccurrences(
  entries: readonly PersonalScheduleEntry[],
  anchor: IcsAnchor,
  calendarTerm?: CalendarTerm,
): IcsOccurrence[] {
  return resolveScheduleOccurrences(entries, anchor, calendarTerm).map(({ entry: _entry, ...occurrence }) => occurrence);
}

interface ResolvedScheduleOccurrence extends IcsOccurrence {
  entry: PersonalScheduleEntry;
}

function resolveScheduleOccurrences(
  entries: readonly PersonalScheduleEntry[],
  anchor: IcsAnchor,
  calendarTerm?: CalendarTerm,
): ResolvedScheduleOccurrence[] {
  const weekOneMonday = parseIsoDate(weekOneMondayFromAnchor(anchor));
  const occurrences: ResolvedScheduleOccurrence[] = [];

  for (const entry of entries) {
    if (entry.day === undefined || entry.periodStart === undefined || entry.periodEnd === undefined) continue;
    for (const week of [...entry.weeks].sort((left, right) => left - right)) {
      const date = addUtcDays(weekOneMonday, (week - 1) * 7 + (entry.day - 1));
      const dateText = toIsoDate(date);
      if (calendarTerm && !regularClassRunsOn(calendarTerm, dateText)) continue;
      occurrences.push(resolveOccurrence(entry, dateText, week));
    }
  }

  if (calendarTerm) {
    for (const compensatory of calendarTerm.snapshot.compensatories) {
      const target = compensatoryTarget(calendarTerm, compensatory);
      if (!target) continue;
      const sourceDay = weekdayNumber(compensatory.workday);
      for (const entry of entries) {
        if (
          entry.day !== sourceDay
          || entry.periodStart === undefined
          || entry.periodEnd === undefined
          || !entry.weeks.includes(target.week)
        ) continue;
        occurrences.push(resolveOccurrence(entry, compensatory.date, target.week, {
          sourceDate: target.date,
          sourceWeekday: compensatory.workday,
        }));
      }
    }
  }

  return occurrences.sort((left, right) => left.startUtc.localeCompare(right.startUtc) || left.uid.localeCompare(right.uid));
}

function resolveOccurrence(
  entry: PersonalScheduleEntry,
  date: string,
  week: number,
  makeup?: { sourceDate: string; sourceWeekday: WeekdayName },
): ResolvedScheduleOccurrence {
  const parsedDate = parseIsoDate(date);
  const summary = [entry.courseCode, entry.courseName].filter(Boolean).join(" ").trim()
    || entry.courseName
    || entry.courseCode
    || "SUSTech Class";
  const makeupDescription = makeup
    ? `Makeup for ${makeup.sourceWeekday} ${makeup.sourceDate}`
    : "";
  return {
    entry,
    uid: `${entry.rwh || entry.key || summary}-${date}-p${entry.periodStart}@sustech-cli`,
    summary,
    location: entry.room || undefined,
    description: [entry.teacher, entry.description, `Week ${week}`, makeupDescription].filter(Boolean).join(" | "),
    startUtc: periodStartUtc(parsedDate, entry.periodStart!),
    endUtc: periodEndUtc(parsedDate, entry.periodEnd!),
    date,
    week,
    day: entry.day!,
    periodStart: entry.periodStart!,
    periodEnd: entry.periodEnd!,
    ...(makeup ? {
      isCompensatory: true as const,
      sourceDate: makeup.sourceDate,
      sourceWeekday: makeup.sourceWeekday,
    } : {}),
  };
}

function regularClassRunsOn(term: CalendarTerm, date: string): boolean {
  const day = term.day(date);
  return date >= term.snapshot.teachingStart
    && date <= term.snapshot.teachingEnd
    && !day.flags.isHoliday
    && !day.flags.isExtraBreak
    && !day.flags.isFinal;
}

function compensatoryTarget(
  term: CalendarTerm,
  compensatory: CompensatoryDay,
): { week: number; date: string } | undefined {
  const parity = compensatory.weekType === "odd" ? 1 : 0;
  const compensatoryDate = parseIsoDate(compensatory.date);
  return Array.from({ length: term.snapshot.totalTeachingWeeks }, (_, index) => index + 1)
    .filter((week) => week % 2 === parity)
    .map((week) => ({ week, date: term.dateOf(week, compensatory.workday) }))
    .filter((candidate) => !regularClassRunsOn(term, candidate.date))
    .sort((left, right) => (
      Math.abs(parseIsoDate(left.date).getTime() - compensatoryDate.getTime())
      - Math.abs(parseIsoDate(right.date).getTime() - compensatoryDate.getTime())
    ))[0];
}

function weekdayNumber(weekday: WeekdayName): number {
  return ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].indexOf(weekday) + 1;
}

export function buildScheduleIcs(
  entries: readonly PersonalScheduleEntry[],
  anchor: IcsAnchor,
  options: { calendarName?: string; nowUtc?: Date; calendarTerm?: CalendarTerm } = {},
): string {
  return buildIcsContent(scheduleIcsEvents(entries, anchor, options.calendarTerm), options);
}

export function scheduleIcsEvents(
  entries: readonly PersonalScheduleEntry[],
  anchor: IcsAnchor,
  calendarTerm?: CalendarTerm,
): IcsEvent[] {
  return scheduleOccurrences(entries, anchor, calendarTerm).map((event) => ({
    uid: event.uid,
    summary: event.summary,
    description: event.description,
    ...(event.location ? { location: event.location } : {}),
    startUtc: event.startUtc,
    endUtc: event.endUtc,
  }));
}

export function buildIcsContent(
  events: readonly IcsEvent[],
  options: { calendarName?: string; nowUtc?: Date } = {},
): string {
  const stamp = formatUtc(options.nowUtc ?? new Date());
  const name = options.calendarName?.trim() || "SUSTech Schedule";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//sustech-cli//tis//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${escapeIcs(name)}`,
  ];

  for (const event of sortIcsEvents(events)) {
    assertIcsEvent(event);
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${escapeIcs(event.uid)}`);
    lines.push(`DTSTAMP:${stamp}`);
    if (event.startDate) {
      lines.push(`DTSTART;VALUE=DATE:${compactDate(event.startDate)}`);
      if (event.endDateExclusive) lines.push(`DTEND;VALUE=DATE:${compactDate(event.endDateExclusive)}`);
    } else if (event.startUtc) {
      lines.push(`DTSTART:${event.startUtc}`);
      if (event.endUtc) lines.push(`DTEND:${event.endUtc}`);
    }
    lines.push(`SUMMARY:${escapeIcs(event.summary)}`);
    if (event.location) lines.push(`LOCATION:${escapeIcs(event.location)}`);
    lines.push(`DESCRIPTION:${escapeIcs(event.description)}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}

export async function writeIcsFile(
  content: string,
  destination: string,
  options: { overwrite?: boolean } = {},
): Promise<IcsFileWriteResult> {
  const output = await inspectIcsDestination(destination, options.overwrite === true);
  const bytes = Buffer.from(content, "utf8");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const tempPath = join(dirname(output.destination), `.${basename(output.destination)}.sustech-${randomUUID()}.tmp`);
  try {
    let handle;
    try {
      handle = await open(tempPath, "wx", 0o600);
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle?.close().catch(() => undefined);
    }
    await finishIcsWrite(tempPath, output.destination, options.overwrite === true);
    return {
      destination: output.destination,
      size: bytes.byteLength,
      sha256,
      overwritten: output.existed,
    };
  } finally {
    await rm(tempPath, { force: true }).catch(() => undefined);
  }
}

export function parseIsoDateTimeToUtcStamp(value: string): string | undefined {
  const match = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T(?<hour>\d{2}):(?<minute>\d{2})(?::(?<second>\d{2}))?(?:\.\d+)?(?<zone>Z|(?<sign>[+-])(?<offsetHour>\d{2}):(?<offsetMinute>\d{2}))$/.exec(value.trim());
  if (!match?.groups) return undefined;
  const year = Number(match.groups.year);
  const month = Number(match.groups.month);
  const day = Number(match.groups.day);
  const hour = Number(match.groups.hour);
  const minute = Number(match.groups.minute);
  const second = Number(match.groups.second ?? "0");
  if (!validClock(hour, minute) || !Number.isInteger(second) || second < 0 || second > 59) return undefined;
  const offsetHour = Number(match.groups.offsetHour ?? "0");
  const offsetMinute = Number(match.groups.offsetMinute ?? "0");
  if (!Number.isInteger(offsetHour) || offsetHour < 0 || offsetHour > 23 || !Number.isInteger(offsetMinute) || offsetMinute < 0 || offsetMinute > 59) {
    return undefined;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  const offsetMinutes = match.groups.zone === "Z"
    ? 0
    : (match.groups.sign === "-" ? -1 : 1) * ((offsetHour * 60) + offsetMinute);
  const shifted = new Date(parsed.getTime() + (offsetMinutes * 60 * 1000));
  if (
    shifted.getUTCFullYear() !== year
    || shifted.getUTCMonth() + 1 !== month
    || shifted.getUTCDate() !== day
    || shifted.getUTCHours() !== hour
    || shifted.getUTCMinutes() !== minute
    || shifted.getUTCSeconds() !== second
  ) {
    return undefined;
  }
  return formatUtc(parsed);
}

export function parseShenzhenExamTimeRange(date: string, time: string): { startUtc: string; endUtc: string } | undefined {
  const range = /^(\d{1,2}):(\d{2})\s*[-–—~]\s*(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!range) return undefined;
  const startHour = Number(range[1]);
  const startMinute = Number(range[2]);
  const endHour = Number(range[3]);
  const endMinute = Number(range[4]);
  if (!validClock(startHour, startMinute) || !validClock(endHour, endMinute)) return undefined;
  const localDate = parseIsoDate(date);
  const start = new Date(chinaLocalUtcMillis(localDate, startHour, startMinute));
  const end = new Date(chinaLocalUtcMillis(localDate, endHour, endMinute));
  if (end.getTime() <= start.getTime()) return undefined;
  return {
    startUtc: formatUtc(start),
    endUtc: formatUtc(end),
  };
}

export function summariseCurrentOrNextClass(
  entries: readonly PersonalScheduleEntry[],
  options: { currentWeek: number; now: Date; calendarTerm?: CalendarTerm },
): ScheduleReminderSummary {
  if (options.calendarTerm) {
    return summariseCalendarAdjustedClasses(entries, options.now, options.calendarTerm);
  }

  const clock = shenzhenWallClock(options.now);
  const currentMinute = clock.hour * 60 + clock.minute;
  let active: { entry: PersonalScheduleEntry; week: number; date: string } | undefined;
  let next: { entry: PersonalScheduleEntry; week: number; dayOffset: number; startMinutes: number; date: string } | undefined;

  for (const entry of entries) {
    if (entry.day === undefined || entry.periodStart === undefined || entry.periodEnd === undefined) continue;
    for (const week of [...entry.weeks].sort((left, right) => left - right)) {
      if (week < options.currentWeek) continue;
      const dayOffset = (week - options.currentWeek) * 7 + (entry.day - clock.weekday);
      if (dayOffset < 0) continue;
      const date = toIsoDate(addUtcDays(parseIsoDate(clock.date), dayOffset));
      const periods = periodStartTimesForDate(date);
      const startSlot = periods[entry.periodStart];
      const endSlot = periods[entry.periodEnd];
      if (!startSlot || !endSlot) continue;
      const startMinutes = startSlot[0] * 60 + startSlot[1];
      const endMinutes = endSlot[0] * 60 + endSlot[1] + PERIOD_DURATION_MINUTES;
      if (dayOffset === 0 && startMinutes <= currentMinute && currentMinute < endMinutes) {
        if (!active || startMinutes < periodStartMinutes(active.entry.periodStart ?? 99, active.date)) {
          active = { entry, week, date };
        }
        continue;
      }
      if (dayOffset === 0 && startMinutes <= currentMinute) continue;
      if (!next || dayOffset < next.dayOffset || (dayOffset === next.dayOffset && startMinutes < next.startMinutes)) {
        next = { entry, week, dayOffset, startMinutes, date };
      }
      break;
    }
  }

  if (active) return { now: formatScheduleEntryLabel(active.entry, active.week, active.date) };
  if (next) {
    const detail = formatUpcomingScheduleEntryDetail(next.entry, next.week, next.dayOffset, next.date);
    return {
      next: formatScheduleEntryTitle(next.entry),
      nextDetail: detail,
      ...(next.dayOffset === 1 ? { tomorrowMorning: `${formatScheduleEntryTitle(next.entry)} — ${detail}` } : {}),
    };
  }
  return {};
}

function summariseCalendarAdjustedClasses(
  entries: readonly PersonalScheduleEntry[],
  now: Date,
  calendarTerm: CalendarTerm,
): ScheduleReminderSummary {
  const clock = shenzhenWallClock(now);
  const nowStamp = formatUtc(now);
  const occurrences = resolveScheduleOccurrences(
    entries,
    { teachingStartDate: calendarTerm.snapshot.teachingStart },
    calendarTerm,
  );
  const active = occurrences.find((occurrence) => occurrence.startUtc <= nowStamp && nowStamp < occurrence.endUtc);
  if (active) {
    return {
      now: formatScheduleEntryLabel(active.entry, active.week, active.date, active.sourceWeekday),
    };
  }

  const next = occurrences.find((occurrence) => occurrence.startUtc > nowStamp);
  if (!next) return {};
  const dayOffset = Math.round(
    (parseIsoDate(next.date).getTime() - parseIsoDate(clock.date).getTime()) / (24 * 60 * 60 * 1000),
  );
  const detail = formatUpcomingScheduleEntryDetail(
    next.entry,
    next.week,
    dayOffset,
    next.date,
    next.sourceWeekday,
  );
  return {
    next: formatScheduleEntryTitle(next.entry),
    nextDetail: detail,
    ...(dayOffset === 1 ? { tomorrowMorning: `${formatScheduleEntryTitle(next.entry)} — ${detail}` } : {}),
  };
}

export function nearestUpcomingExam(
  exams: readonly ExamRecord[],
  options: { now: Date },
): ExamSelectionResult {
  const clock = shenzhenWallClock(options.now);
  const today = clock.date;
  const currentMinutes = clock.hour * 60 + clock.minute;
  const omissions: { code: string; message: string }[] = [];
  const candidates: { exam: ExamRecord; date: string; timeOrder: number }[] = [];

  for (const exam of exams) {
    const code = exam.code || exam.name || "exam";
    try {
      parseIsoDate(exam.date);
    } catch {
      omissions.push({ code, message: `Skipped ${code}: exam date was not an exact YYYY-MM-DD value.` });
      continue;
    }
    if (exam.date < today) continue;
    if (exam.date === today) {
      const range = parseTimeRange(exam.time);
      if (!range) {
        omissions.push({ code, message: `Skipped ${code}: today's exam time could not be parsed exactly.` });
        continue;
      }
      const endMinutes = range.endHour * 60 + range.endMinute;
      if (endMinutes <= currentMinutes) continue;
      candidates.push({
        exam,
        date: exam.date,
        timeOrder: range.startHour * 60 + range.startMinute,
      });
      continue;
    }
    const range = parseTimeRange(exam.time);
    if (!range) {
      omissions.push({ code, message: `Skipped ${code}: future exam time could not be parsed exactly.` });
      continue;
    }
    candidates.push({
      exam,
      date: exam.date,
      timeOrder: range.startHour * 60 + range.startMinute,
    });
  }

  candidates.sort((left, right) =>
    left.date.localeCompare(right.date)
    || left.timeOrder - right.timeOrder
    || left.exam.code.localeCompare(right.exam.code)
    || left.exam.name.localeCompare(right.exam.name)
  );
  return {
    ...(candidates[0] ? { exam: candidates[0].exam } : {}),
    omissions,
  };
}

export function holidayToIcsEvent(holiday: Holiday): IcsEvent {
  return {
    uid: `holiday-${holiday.name}-${holiday.start}@sustech-cli`,
    summary: holiday.name,
    description: `SUSTech academic calendar holiday: ${holiday.name}`,
    startDate: holiday.start,
    endDateExclusive: toIsoDate(addUtcDays(parseIsoDate(holiday.end), 1)),
  };
}

export function teachingPeriodAtShenzhenTime(value: Date): TeachingPeriodWindow | undefined {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(value);
  const year = Number(partValue(parts, "year"));
  const month = Number(partValue(parts, "month"));
  const day = Number(partValue(parts, "day"));
  const hour = Number(partValue(parts, "hour"));
  const minute = Number(partValue(parts, "minute"));
  if (![year, month, day, hour, minute].every((entry) => Number.isInteger(entry))) return undefined;

  const wallClockDate = new Date(Date.UTC(year, month - 1, day));
  const weekday = wallClockDate.getUTCDay() === 0 ? 7 : wallClockDate.getUTCDay();
  const minutesSinceMidnight = hour * 60 + minute;
  const date = `${partValue(parts, "year")}-${partValue(parts, "month")}-${partValue(parts, "day")}`;
  for (const [periodText, [startHour, startMinute]] of Object.entries(periodStartTimesForDate(date))) {
    const periodStart = Number(periodText);
    const startTotal = startHour * 60 + startMinute;
    const endTotal = startTotal + PERIOD_DURATION_MINUTES;
    if (minutesSinceMidnight < startTotal || minutesSinceMidnight >= endTotal) continue;
    return {
      date,
      time: `${partValue(parts, "hour")}:${partValue(parts, "minute")}`,
      weekday,
      periodStart,
      periodEnd: periodStart,
      periodLabel: `P${periodStart} ${String(startHour).padStart(2, "0")}:${String(startMinute).padStart(2, "0")}-${formatPeriodEnd(endTotal)}`,
    };
  }
  return undefined;
}

function periodStartUtc(date: Date, period: number): string {
  const slot = periodStartTimesForDate(toIsoDate(date))[period];
  if (!slot) throw new CliError("ICS export encountered an unsupported class period.", "UNSUPPORTED_PERIOD", 2, { period });
  return formatUtc(new Date(chinaLocalUtcMillis(date, slot[0], slot[1])));
}

function periodEndUtc(date: Date, period: number): string {
  const slot = periodStartTimesForDate(toIsoDate(date))[period];
  if (!slot) throw new CliError("ICS export encountered an unsupported class period.", "UNSUPPORTED_PERIOD", 2, { period });
  return formatUtc(new Date(chinaLocalUtcMillis(date, slot[0], slot[1]) + PERIOD_DURATION_MINUTES * 60 * 1000));
}

function chinaLocalUtcMillis(date: Date, hour: number, minute: number): number {
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    hour,
    minute,
  ) - CHINA_OFFSET_MINUTES * 60 * 1000;
}

function formatUtc(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  const hour = String(value.getUTCHours()).padStart(2, "0");
  const minute = String(value.getUTCMinutes()).padStart(2, "0");
  const second = String(value.getUTCSeconds()).padStart(2, "0");
  return `${year}${month}${day}T${hour}${minute}${second}Z`;
}

function sortIcsEvents(events: readonly IcsEvent[]): IcsEvent[] {
  return [...events].sort((left, right) =>
    eventSortKey(left).localeCompare(eventSortKey(right))
    || left.uid.localeCompare(right.uid)
  );
}

function eventSortKey(event: IcsEvent): string {
  if (event.startUtc) return `0-${event.startUtc}`;
  if (event.startDate) return `1-${compactDate(event.startDate)}`;
  return `9-${event.uid}`;
}

function assertIcsEvent(event: IcsEvent): void {
  const timed = typeof event.startUtc === "string";
  const allDay = typeof event.startDate === "string";
  if (timed === allDay) {
    throw new CliError("ICS events must be either timed or all-day.", "ICS_EVENT_INVALID", 2, { uid: event.uid });
  }
  if (allDay && event.endUtc) throw new CliError("All-day ICS events must not include timed end fields.", "ICS_EVENT_INVALID", 2, { uid: event.uid });
  if (timed && event.endDateExclusive) throw new CliError("Timed ICS events must not include all-day end fields.", "ICS_EVENT_INVALID", 2, { uid: event.uid });
}

function compactDate(value: string): string {
  return value.replaceAll("-", "");
}

function validClock(hour: number, minute: number): boolean {
  return Number.isInteger(hour) && Number.isInteger(minute) && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

function parseTimeRange(value: string): { startHour: number; startMinute: number; endHour: number; endMinute: number } | undefined {
  const match = /^(\d{1,2}):(\d{2})\s*[-–—~]\s*(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return undefined;
  const startHour = Number(match[1]);
  const startMinute = Number(match[2]);
  const endHour = Number(match[3]);
  const endMinute = Number(match[4]);
  if (!validClock(startHour, startMinute) || !validClock(endHour, endMinute)) return undefined;
  if (endHour * 60 + endMinute <= startHour * 60 + startMinute) return undefined;
  return { startHour, startMinute, endHour, endMinute };
}

function formatScheduleEntryTitle(entry: PersonalScheduleEntry): string {
  return [entry.courseCode, entry.courseName || entry.description || entry.descriptionEn || "Unnamed course"].filter(Boolean).join(" ").trim();
}

function formatScheduleEntryLabel(
  entry: PersonalScheduleEntry,
  currentWeek: number,
  date: string,
  sourceWeekday?: WeekdayName,
): string {
  return `${formatScheduleEntryTitle(entry)} — ${formatUpcomingScheduleEntryDetail(entry, currentWeek, 0, date, sourceWeekday)}`;
}

function formatUpcomingScheduleEntryDetail(
  entry: PersonalScheduleEntry,
  week: number,
  dayOffset: number,
  date: string,
  sourceWeekday?: WeekdayName,
): string {
  const periods = periodStartTimesForDate(date);
  const start = periods[entry.periodStart ?? 0];
  const end = periods[entry.periodEnd ?? 0];
  const startText = start ? `${String(start[0]).padStart(2, "0")}:${String(start[1]).padStart(2, "0")}` : `P${entry.periodStart ?? "?"}`;
  const endTotal = end ? end[0] * 60 + end[1] + PERIOD_DURATION_MINUTES : undefined;
  const endText = endTotal === undefined ? `P${entry.periodEnd ?? "?"}` : formatPeriodEnd(endTotal);
  const parsedDate = parseIsoDate(date);
  const actualWeekday = parsedDate.getUTCDay() === 0 ? 7 : parsedDate.getUTCDay();
  const weekdayLabel = weekdayName(actualWeekday);
  const dayLabel = dayOffset === 0 ? "today" : dayOffset === 1 ? "tomorrow" : `week ${week} ${weekdayLabel}`;
  return [
    `${dayLabel}${sourceWeekday ? ` (makeup for ${sourceWeekday})` : ""}`,
    `${startText}-${endText}`,
    entry.room,
    entry.teacher,
  ].filter(Boolean).join(" @ ").replace(" @ ", " · ");
}

function weekdayName(day: number): string {
  return ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][day - 1] ?? `day ${day}`;
}

function periodStartMinutes(period: number, date: string): number {
  const slot = periodStartTimesForDate(date)[period];
  return slot ? slot[0] * 60 + slot[1] : Number.POSITIVE_INFINITY;
}

function periodStartTimesForDate(date: string): Readonly<Record<number, [number, number]>> {
  return date >= CURRENT_PERIOD_SCHEDULE_START ? PERIOD_START_TIMES : LEGACY_PERIOD_START_TIMES;
}

async function inspectIcsDestination(destination: string, overwrite: boolean): Promise<{ destination: string; existed: boolean }> {
  const absolute = resolvePath(destination);
  await assertPathAndParentsAreNotSymlinks(absolute);
  const parent = dirname(absolute);
  let parentInfo;
  try {
    parentInfo = await stat(parent);
  } catch (error) {
    throw icsFileError("The ICS destination directory could not be accessed.", parent, error);
  }
  if (!parentInfo.isDirectory()) {
    throw new CliError("The ICS destination parent must be a directory.", "ICS_DESTINATION_INVALID", 2, { destination: absolute });
  }

  let existing;
  try {
    existing = await lstat(absolute);
  } catch (error) {
    if (nodeErrorCode(error) !== "ENOENT") throw icsFileError("The ICS destination could not be inspected.", absolute, error);
  }
  if (existing?.isSymbolicLink() || (existing && !existing.isFile())) {
    throw new CliError("The ICS destination must be a regular file and must not be a symbolic link.", "ICS_DESTINATION_INVALID", 2, { destination: absolute });
  }
  if (existing && !overwrite) {
    throw new CliError("The ICS destination already exists; pass --overwrite to replace it.", "ICS_DESTINATION_EXISTS", 2, { destination: absolute });
  }
  return { destination: absolute, existed: existing !== undefined };
}

async function finishIcsWrite(tempPath: string, destination: string, overwrite: boolean): Promise<void> {
  if (overwrite) {
    try {
      await rename(tempPath, destination);
      return;
    } catch (error) {
      throw icsFileError("The ICS file could not be moved into place.", destination, error);
    }
  }
  try {
    await link(tempPath, destination);
    return;
  } catch (error) {
    if (nodeErrorCode(error) === "EEXIST") throw icsDestinationAppeared(destination);
  }
  try {
    await copyFile(tempPath, destination, fileSystemConstants.COPYFILE_EXCL);
  } catch (error) {
    if (nodeErrorCode(error) === "EEXIST") throw icsDestinationAppeared(destination);
    throw icsFileError("The ICS file could not be placed safely.", destination, error);
  }
}

function icsDestinationAppeared(destination: string): CliError {
  return new CliError("The ICS destination appeared while exporting; no file was overwritten.", "ICS_DESTINATION_EXISTS", 2, { destination });
}

function icsFileError(message: string, path: string, error: unknown): CliError {
  return new CliError(message, "ICS_FILE_ERROR", 2, { path, cause: error instanceof Error ? error.message : String(error) });
}

function nodeErrorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
}

function shenzhenWallClock(value: Date): { date: string; weekday: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(value);
  const date = `${partValue(parts, "year")}-${partValue(parts, "month")}-${partValue(parts, "day")}`;
  const wallClockDate = new Date(Date.UTC(Number(partValue(parts, "year")), Number(partValue(parts, "month")) - 1, Number(partValue(parts, "day"))));
  const weekday = wallClockDate.getUTCDay() === 0 ? 7 : wallClockDate.getUTCDay();
  return {
    date,
    weekday,
    hour: Number(partValue(parts, "hour")),
    minute: Number(partValue(parts, "minute")),
  };
}

function escapeIcs(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function partValue(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((part) => part.type === type)?.value ?? "";
}

function formatPeriodEnd(minutesSinceMidnight: number): string {
  const hour = Math.floor(minutesSinceMidnight / 60);
  const minute = minutesSinceMidnight % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
