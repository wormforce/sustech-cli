import type { AcademicCalendar } from "../calendar/client.js";
import type { CalendarDayInfo } from "../calendar/types.js";

export type ContextLevel = "terse" | "normal" | "verbose";
export type SourceState = "provided" | "derived" | "empty" | "missing";

export interface ContextClass {
  name: string;
  startAt: string;
  endAt: string;
  location?: string;
  week: number;
  periodStart: number;
  periodEnd: number;
  status: "completed" | "in-progress" | "upcoming";
  makeupFor?: string;
}

export interface ScheduleReminder {
  now?: string;
  next?: string;
  nextDetail?: string;
  tomorrowMorning?: string;
  currentClass?: ContextClass;
  nextClass?: ContextClass;
  todayClasses?: ContextClass[];
  omissionCount?: number;
}

export interface DeadlineSummary {
  name: string;
  daysLeft?: number;
  dueAt?: string;
  course?: string;
}

export interface EvaluationSummary {
  course: string;
  name: string;
  daysLeft?: number;
  dueAt?: string;
}

export interface ExamSummary {
  name: string;
  code: string;
  date: string;
  time?: string;
  building?: string;
  room?: string;
  campus?: string;
}

export interface WeatherSummary {
  source?: string;
  observedAt?: string;
  freshness?: "fresh" | "stale" | "unknown";
  condition: string;
  icon?: string;
  tempC?: number;
  feelsLikeC?: number;
  humidity?: number;
  windKmh?: number;
  precipitationMm?: number;
}

export interface AirQualitySummary {
  standard?: "US EPA";
  source?: string;
  observedAt?: string;
  freshness?: "fresh" | "stale" | "unknown";
  aqi: number;
  level?: string;
  pm25?: number;
  pm10?: number;
  ozone?: number;
}

export interface ContextInput {
  now?: Date | string;
  generatedAt?: Date;
  calendar?: AcademicCalendar;
  academicDay?: CalendarDayInfo;
  schedule?: ScheduleReminder;
  nextDeadline?: DeadlineSummary | null;
  nextEvaluation?: EvaluationSummary | null;
  nextExam?: ExamSummary | null;
  weather?: WeatherSummary | null;
  airQuality?: AirQualitySummary | null;
  libraryStatus?: string | null;
}

export interface ContextSourceStatus {
  academicDay: SourceState;
  schedule: SourceState;
  nextDeadline: SourceState;
  nextEvaluation: SourceState;
  nextExam: SourceState;
  weather: SourceState;
  airQuality: SourceState;
  libraryStatus: SourceState;
}

export interface ContextSnapshot {
  level: ContextLevel;
  generatedAt: string;
  referenceAt: string;
  timezone: "Asia/Shanghai";
  date: string;
  time: string;
  weekday: string;
  week?: number;
  label?: string;
  phase?: string;
  holiday?: string;
  academicDay?: CalendarDayInfo;
  weekParity?: "odd" | "even";
  schedule: ScheduleReminder;
  nextDeadline?: DeadlineSummary | null;
  nextEvaluation?: EvaluationSummary | null;
  nextExam?: ExamSummary | null;
  weather?: WeatherSummary | null;
  airQuality?: AirQualitySummary | null;
  libraryStatus?: string | null;
  sourceStatus: ContextSourceStatus;
  lines: string[];
}
