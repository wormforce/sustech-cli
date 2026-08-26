import { CliError } from "../core/errors.js";
import type { PersonalScheduleEntry } from "./types.js";
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
}

const CHINA_OFFSET_MINUTES = 8 * 60;
const PERIOD_START_TIMES: Readonly<Record<number, [number, number]>> = {
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
const PERIOD_DURATION_MINUTES = 50;

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
): IcsOccurrence[] {
  const weekOneMonday = parseIsoDate(weekOneMondayFromAnchor(anchor));
  const occurrences: IcsOccurrence[] = [];

  for (const entry of entries) {
    if (entry.day === undefined || entry.periodStart === undefined || entry.periodEnd === undefined) continue;
    for (const week of [...entry.weeks].sort((left, right) => left - right)) {
      const date = addUtcDays(weekOneMonday, (week - 1) * 7 + (entry.day - 1));
      const start = periodStartUtc(date, entry.periodStart);
      const end = periodEndUtc(date, entry.periodEnd);
      const summary = [entry.courseCode, entry.courseName].filter(Boolean).join(" ").trim() || entry.courseName || entry.courseCode || "SUSTech Class";
      const description = [entry.teacher, entry.description, `Week ${week}`].filter(Boolean).join(" | ");
      occurrences.push({
        uid: `${entry.rwh || entry.key || summary}-${toIsoDate(date)}-p${entry.periodStart}@sustech-cli`,
        summary,
        location: entry.room || undefined,
        description,
        startUtc: start,
        endUtc: end,
        date: toIsoDate(date),
        week,
        day: entry.day,
        periodStart: entry.periodStart,
        periodEnd: entry.periodEnd,
      });
    }
  }

  return occurrences.sort((left, right) => left.startUtc.localeCompare(right.startUtc) || left.uid.localeCompare(right.uid));
}

export function buildScheduleIcs(
  entries: readonly PersonalScheduleEntry[],
  anchor: IcsAnchor,
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

  for (const event of scheduleOccurrences(entries, anchor)) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${escapeIcs(event.uid)}`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART:${event.startUtc}`);
    lines.push(`DTEND:${event.endUtc}`);
    lines.push(`SUMMARY:${escapeIcs(event.summary)}`);
    if (event.location) lines.push(`LOCATION:${escapeIcs(event.location)}`);
    lines.push(`DESCRIPTION:${escapeIcs(event.description)}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}

function periodStartUtc(date: Date, period: number): string {
  const slot = PERIOD_START_TIMES[period];
  if (!slot) throw new CliError("ICS export encountered an unsupported class period.", "UNSUPPORTED_PERIOD", 2, { period });
  return formatUtc(new Date(chinaLocalUtcMillis(date, slot[0], slot[1])));
}

function periodEndUtc(date: Date, period: number): string {
  const slot = PERIOD_START_TIMES[period];
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

function escapeIcs(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}
