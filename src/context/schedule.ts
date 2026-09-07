import type { CalendarTerm } from "../calendar/client.js";
import { CliError } from "../core/errors.js";
import { scheduleOccurrences } from "../tis/remaining-calendar.js";
import type { PersonalScheduleEntry } from "../tis/types.js";
import type { ContextClass, ScheduleReminder } from "./types.js";

/** Use the same holiday/makeup instances as ICS, with explicit timestamps for agents. */
export function buildContextSchedule(entries: readonly PersonalScheduleEntry[], term: CalendarTerm, now: Date): ScheduleReminder {
  const date = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(now);
  let omissionCount = 0;
  const occurrences = entries.flatMap((entry) => {
    if (entry.day === undefined || entry.periodStart === undefined || entry.periodEnd === undefined || entry.weeks.length === 0) {
      omissionCount++;
      return [];
    }
    try {
      return scheduleOccurrences([entry], { teachingStartDate: term.snapshot.teachingStart }, term);
    } catch (error) {
      if (!(error instanceof CliError) || error.code !== "UNSUPPORTED_PERIOD") throw error;
      omissionCount++;
      return [];
    }
  }).sort((left, right) => left.startUtc.localeCompare(right.startUtc) || left.uid.localeCompare(right.uid));
  const classes = occurrences
    .map((occurrence): ContextClass => {
      const startAt = expandedUtc(occurrence.startUtc);
      const endAt = expandedUtc(occurrence.endUtc);
      return {
        name: occurrence.summary,
        startAt,
        endAt,
        ...(occurrence.location ? { location: occurrence.location } : {}),
        week: occurrence.week,
        periodStart: occurrence.periodStart,
        periodEnd: occurrence.periodEnd,
        status: now.getTime() >= Date.parse(endAt) ? "completed"
          : now.getTime() >= Date.parse(startAt) ? "in-progress" : "upcoming",
        ...(occurrence.sourceDate ? { makeupFor: occurrence.sourceDate } : {}),
      };
    });
  const currentClass = classes.find((item) => item.status === "in-progress");
  const nextClass = classes.find((item) => item.status === "upcoming");
  const todayClasses = classes.filter((item) => shanghaiDate(item.startAt) === date);
  const tomorrow = shanghaiDate(new Date(Date.parse(`${date}T00:00:00+08:00`) + 86400000).toISOString());
  return {
    todayClasses,
    omissionCount,
    ...(currentClass ? { currentClass, now: `${currentClass.name} — ${classDetail(currentClass)}` } : {}),
    ...(nextClass ? {
      nextClass,
      next: nextClass.name,
      nextDetail: classDetail(nextClass),
      ...(shanghaiDate(nextClass.startAt) === tomorrow && shanghaiTime(nextClass.startAt) < "12:00"
        ? { tomorrowMorning: `${nextClass.name} — ${classDetail(nextClass)}` } : {}),
    } : {}),
  };
}

function expandedUtc(value: string): string {
  return value.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, "$1-$2-$3T$4:$5:$6Z");
}

function shanghaiDate(value: string): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(new Date(value));
}

function shanghaiTime(value: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
}

function classDetail(item: ContextClass): string {
  return `${shanghaiDate(item.startAt)} ${shanghaiTime(item.startAt)}–${shanghaiTime(item.endAt)}`
    + (item.location ? ` @ ${item.location}` : "")
    + (item.makeupFor ? ` (makeup for ${item.makeupFor})` : "");
}
