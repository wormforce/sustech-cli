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
      nextDeadline: sourceState(input.nextDeadline),
      nextEvaluation: sourceState(input.nextEvaluation),
      nextExam: sourceState(input.nextExam),
      weather: input.weather === undefined ? "missing" : "provided",
      airQuality: input.airQuality === undefined ? "missing" : "provided",
      libraryStatus: input.libraryStatus === undefined ? "missing" : "provided",
    };

    const snapshot: ContextSnapshot = {
      level,
      generatedAt: (input.generatedAt ?? new Date()).toISOString(),
      referenceAt: now.toISOString(),
      timezone: "Asia/Shanghai",
      date: formatDate(now),
      time: formatTime(now),
      weekday: new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", weekday: "long" }).format(now),
      ...(academic.day ? { academicDay: academic.day } : {}),
      ...(academic.day && academic.day.week > 0 ? { weekParity: academic.day.week % 2 ? "odd" as const : "even" as const } : {}),
      ...(academic.day?.week ? { week: academic.day.week } : {}),
      ...(academic.day?.label ? { label: academic.day.label } : {}),
      ...(academic.day?.phase ? { phase: academic.day.phase } : {}),
      ...(academic.day?.holiday?.name ? { holiday: academic.day.holiday.name } : {}),
      schedule: input.schedule ?? {},
      ...(LEVEL_ORDER[level] >= LEVEL_ORDER.normal ? {
        nextDeadline: input.nextDeadline ?? null,
        nextEvaluation: input.nextEvaluation ?? null,
        nextExam: input.nextExam ?? null,
        weather: environmentFreshness(input.weather, now),
        airQuality: environmentFreshness(input.airQuality, now),
      } : {}),
      ...(LEVEL_ORDER[level] >= LEVEL_ORDER.verbose ? {
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
      generatedAt: snapshot.generatedAt,
      referenceAt: snapshot.referenceAt,
      timezone: snapshot.timezone,
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
    if (snapshot.academicDay) record.academicDay = snapshot.academicDay;
    if (snapshot.weekParity) record.weekParity = snapshot.weekParity;
    if (LEVEL_ORDER[snapshot.level] >= LEVEL_ORDER.normal) {
      record.nextDeadline = snapshot.nextDeadline ?? null;
      record.nextEvaluation = snapshot.nextEvaluation ?? null;
      record.nextExam = snapshot.nextExam ?? null;
      record.weather = snapshot.weather ?? null;
      record.airQuality = snapshot.airQuality ?? null;
    }
    if (LEVEL_ORDER[snapshot.level] >= LEVEL_ORDER.verbose) {
      record.libraryStatus = snapshot.libraryStatus ?? null;
    }
    return record;
  }

  public toText(snapshot: ContextSnapshot): string {
    return snapshot.lines.join("\n");
  }
}

function renderLines(snapshot: ContextSnapshot): string[] {
  const isToday = snapshot.date === formatDate(new Date(snapshot.generatedAt));
  const lines = [
    `${isToday ? "Today is" : "Date preview:"} [${snapshot.date}], [${snapshot.weekday}]`,
    ...(snapshot.label ? [`According to SUSTech academic calendar, this is [${snapshot.label}]`] : []),
    `${isToday ? "Current time is" : "Reference time:"} [${snapshot.time}] (Asia/Shanghai)`,
    ...(snapshot.holiday ? [`Today is [${snapshot.holiday}]`] : []),
    ...(snapshot.academicDay?.compensatory ? [`Makeup timetable: ${snapshot.academicDay.compensatory.weekType} ${snapshot.academicDay.compensatory.workday}`] : []),
  ];
  appendSchedule(lines, snapshot.schedule);
  if (LEVEL_ORDER[snapshot.level] >= LEVEL_ORDER.normal) appendNormal(lines, snapshot.nextDeadline ?? null, snapshot.nextEvaluation ?? null, snapshot.nextExam ?? null);
  if (LEVEL_ORDER[snapshot.level] >= LEVEL_ORDER.normal) appendVerbose(lines, snapshot.weather ?? null, snapshot.airQuality ?? null, snapshot.libraryStatus ?? null);
  if (snapshot.sourceStatus.nextDeadline === "empty" && LEVEL_ORDER[snapshot.level] >= LEVEL_ORDER.normal) lines.push("No upcoming assignments in the retrieved Blackboard deadlines.");
  if (snapshot.sourceStatus.nextExam === "empty" && LEVEL_ORDER[snapshot.level] >= LEVEL_ORDER.normal) lines.push("No upcoming exams in the retrieved TIS records.");
  return lines;
}

function appendSchedule(lines: string[], schedule: ScheduleReminder): void {
  if (schedule.todayClasses?.length === 0 && !schedule.omissionCount) lines.push("No classes scheduled today in the retrieved timetable.");
  if (schedule.now) {
    lines.push(`Now: [${schedule.now}]`);
  }
  if (schedule.next) {
    const detail = schedule.nextDetail ? ` — ${schedule.nextDetail}` : "";
    lines.push(`Next: [${schedule.next}]${detail}`);
    return;
  }
  if (!schedule.next && schedule.tomorrowMorning) {
    lines.push(`Tomorrow morning: [${schedule.tomorrowMorning}]`);
  }
}

function appendNormal(
  lines: string[],
  nextDeadline: DeadlineSummary | null,
  nextEvaluation: EvaluationSummary | null,
  nextExam: ExamSummary | null,
): void {
  if (nextDeadline) lines.push(`Next deadline: [${nextDeadline.name}] — ${deadlineStatus(nextDeadline.daysLeft, nextDeadline.dueAt)}${nextDeadline.dueAt ? ` (${nextDeadline.dueAt})` : ""}`);
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
    lines.push(`Weather at SUSTech: [${weather.condition}]${temperature}${observationLabel(weather)}`);
  }
  if (airQuality) {
    lines.push(`Air quality: [${airQuality.standard ? `${airQuality.standard} ` : ""}AQI ${airQuality.aqi}]${airQuality.level ? ` ${airQuality.level}` : ""}${observationLabel(airQuality)}`);
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
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(now);
}

function formatTime(now: Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
}

function sourceState(value: unknown): SourceState {
  return value === undefined ? "missing" : value === null ? "empty" : "provided";
}

function environmentFreshness<T extends WeatherSummary | AirQualitySummary>(value: T | null | undefined, now: Date): T | null {
  if (!value) return null;
  const observed = value.observedAt ? Date.parse(value.observedAt) : NaN;
  return { ...value, freshness: !Number.isFinite(observed) ? "unknown" : now.getTime() - observed > 3 * 3600000 ? "stale" : "fresh" };
}

function observationLabel(value: WeatherSummary | AirQualitySummary): string {
  return value.freshness === "stale" ? ` (stale; observed ${value.observedAt})`
    : value.observedAt ? ` (observed ${value.observedAt})` : " (observation time unavailable)";
}
