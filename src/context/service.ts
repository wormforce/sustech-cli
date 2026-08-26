import type { AcademicCalendar } from "../calendar/client.js";
import type { CalendarDayInfo } from "../calendar/types.js";
import type {
  AirQualitySummary,
  ContextInput,
  ContextLevel,
  ContextSnapshot,
  ContextSourceStatus,
  DeadlineSummary,
  EvaluationSummary,
  ExamSummary,
  ScheduleReminder,
  SourceState,
  WeatherSummary,
} from "./types.js";

const LEVEL_ORDER: Record<ContextLevel, number> = { terse: 0, normal: 1, verbose: 2 };

export class ContextService {
  public build(input: ContextInput = {}, level: ContextLevel = "normal"): ContextSnapshot {
    const now = normaliseNow(input.now);
    const academic = resolveAcademicDay(input.academicDay, input.calendar, now);
    const sourceStatus: ContextSourceStatus = {
      academicDay: academic.state,
      schedule: input.schedule ? "provided" : "missing",
      nextDeadline: input.nextDeadline === undefined ? "missing" : "provided",
      nextEvaluation: input.nextEvaluation === undefined ? "missing" : "provided",
      nextExam: input.nextExam === undefined ? "missing" : "provided",
      weather: input.weather === undefined ? "missing" : "provided",
      airQuality: input.airQuality === undefined ? "missing" : "provided",
      libraryStatus: input.libraryStatus === undefined ? "missing" : "provided",
    };

    const snapshot: ContextSnapshot = {
      level,
      generatedAt: now.toISOString(),
      date: formatDate(now),
      time: formatTime(now),
      weekday: WEEKDAY_NAMES[now.getDay()],
      ...(academic.day?.week ? { week: academic.day.week } : {}),
      ...(academic.day?.label ? { label: academic.day.label } : {}),
      ...(academic.day?.phase ? { phase: academic.day.phase } : {}),
      ...(academic.day?.holiday?.name ? { holiday: academic.day.holiday.name } : {}),
      schedule: input.schedule ?? {},
      ...(LEVEL_ORDER[level] >= LEVEL_ORDER.normal ? {
        nextDeadline: input.nextDeadline ?? null,
        nextEvaluation: input.nextEvaluation ?? null,
        nextExam: input.nextExam ?? null,
      } : {}),
      ...(LEVEL_ORDER[level] >= LEVEL_ORDER.verbose ? {
        weather: input.weather ?? null,
        airQuality: input.airQuality ?? null,
        libraryStatus: input.libraryStatus ?? null,
      } : {}),
      sourceStatus,
      lines: [],
    };
    snapshot.lines = renderLines(snapshot);
    return snapshot;
  }

  public toRecord(snapshot: ContextSnapshot): Record<string, unknown> {
    const record: Record<string, unknown> = {
      date: snapshot.date,
      time: snapshot.time,
      weekday: snapshot.weekday,
      schedule: snapshot.schedule,
      sourceStatus: snapshot.sourceStatus,
    };
    if (snapshot.week !== undefined) record.week = snapshot.week;
    if (snapshot.label) record.label = snapshot.label;
    if (snapshot.phase) record.phase = snapshot.phase;
    if (snapshot.holiday) record.holiday = snapshot.holiday;
    if (LEVEL_ORDER[snapshot.level] >= LEVEL_ORDER.normal) {
      record.nextDeadline = snapshot.nextDeadline ?? null;
      record.nextEvaluation = snapshot.nextEvaluation ?? null;
      record.nextExam = snapshot.nextExam ?? null;
    }
    if (LEVEL_ORDER[snapshot.level] >= LEVEL_ORDER.verbose) {
      record.weather = snapshot.weather ?? null;
      record.airQuality = snapshot.airQuality ?? null;
      record.libraryStatus = snapshot.libraryStatus ?? null;
    }
    return record;
  }

  public toText(snapshot: ContextSnapshot): string {
    return snapshot.lines.join("\n");
  }
}

function renderLines(snapshot: ContextSnapshot): string[] {
  const lines = [
    `Today is [${snapshot.date}], [${snapshot.weekday}]`,
    ...(snapshot.label ? [`According to SUSTech academic calendar, this is [${snapshot.label}]`] : []),
    `Current time is [${snapshot.time}]`,
    ...(snapshot.holiday ? [`Today is [${snapshot.holiday}]`] : []),
  ];
  appendSchedule(lines, snapshot.schedule);
  if (LEVEL_ORDER[snapshot.level] >= LEVEL_ORDER.normal) appendNormal(lines, snapshot.nextDeadline ?? null, snapshot.nextEvaluation ?? null, snapshot.nextExam ?? null);
  if (LEVEL_ORDER[snapshot.level] >= LEVEL_ORDER.verbose) appendVerbose(lines, snapshot.weather ?? null, snapshot.airQuality ?? null, snapshot.libraryStatus ?? null);
  return lines;
}

function appendSchedule(lines: string[], schedule: ScheduleReminder): void {
  if (schedule.now) {
    lines.push(`Now: [${schedule.now}]`);
    return;
  }
  if (schedule.next) {
    const detail = schedule.nextDetail ? ` — ${schedule.nextDetail}` : "";
    lines.push(`Next: [${schedule.next}]${detail}`);
    return;
  }
  if (schedule.tomorrowMorning) {
    lines.push(`Tomorrow morning: [${schedule.tomorrowMorning}]`);
  }
}

function appendNormal(
  lines: string[],
  nextDeadline: DeadlineSummary | null,
  nextEvaluation: EvaluationSummary | null,
  nextExam: ExamSummary | null,
): void {
  if (nextDeadline) lines.push(`Next deadline: [${nextDeadline.name}] — ${deadlineStatus(nextDeadline.daysLeft, nextDeadline.dueAt)}`);
  if (nextEvaluation) lines.push(`Next evaluation: [${nextEvaluation.course} — ${nextEvaluation.name}] — ${deadlineStatus(nextEvaluation.daysLeft, nextEvaluation.dueAt, "Evaluation")}`);
  if (nextExam) {
    const location = [nextExam.building, nextExam.room].filter(Boolean).join(" ").trim() || nextExam.campus || "";
    lines.push(`Next exam: [${nextExam.name} (${nextExam.code})] — ${nextExam.date}${nextExam.time ? ` ${nextExam.time}` : ""}${location ? ` @ ${location}` : ""}`);
  }
}

function appendVerbose(
  lines: string[],
  weather: WeatherSummary | null,
  airQuality: AirQualitySummary | null,
  libraryStatus: string | null,
): void {
  if (weather?.condition) {
    const temperature = weather.tempC !== undefined ? ` ${weather.tempC}C` : "";
    lines.push(`Weather at SUSTech: [${weather.condition}]${temperature}`);
  }
  if (airQuality) {
    lines.push(`Air quality: [AQI ${airQuality.aqi}]${airQuality.level ? ` ${airQuality.level}` : ""}`);
  }
  if (libraryStatus) {
    lines.push(`Library: [${libraryStatus}]`);
  }
}

function deadlineStatus(daysLeft: number | undefined, dueAt: string | undefined, label = "Due"): string {
  if (typeof daysLeft === "number") {
    if (daysLeft < 0) return `${label} overdue by ${Math.abs(daysLeft)} day${Math.abs(daysLeft) === 1 ? "" : "s"}`;
    if (daysLeft === 0) return `${label} today`;
    if (daysLeft === 1) return `${label} tomorrow`;
    return `${label} in ${daysLeft} days`;
  }
  return dueAt ? `${label} at ${dueAt}` : `${label} date unavailable`;
}

function resolveAcademicDay(
  academicDay: CalendarDayInfo | undefined,
  calendar: AcademicCalendar | undefined,
  now: Date,
): { day?: CalendarDayInfo; state: SourceState } {
  if (academicDay) return { day: academicDay, state: "provided" };
  if (calendar) return { day: calendar.day(formatDate(now)), state: "derived" };
  return { state: "missing" };
}

function normaliseNow(value: Date | string | undefined): Date {
  if (value instanceof Date) return value;
  if (typeof value === "string") return new Date(value);
  return new Date();
}

function formatDate(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function formatTime(now: Date): string {
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
