import type { AcademicCalendar } from "../calendar/client.js";
import type { CalendarDayInfo } from "../calendar/types.js";

export type ContextLevel = "terse" | "normal" | "verbose";
export type SourceState = "provided" | "derived" | "missing";

export interface ScheduleReminder {
  now?: string;
  next?: string;
  nextDetail?: string;
  tomorrowMorning?: string;
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
  condition: string;
  icon?: string;
  tempC?: number;
  feelsLikeC?: number;
  humidity?: number;
  windKmh?: number;
  precipitationMm?: number;
}

export interface AirQualitySummary {
  aqi: number;
  level?: string;
  pm25?: number;
  pm10?: number;
  ozone?: number;
}

export interface ContextInput {
  now?: Date | string;
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
  date: string;
  time: string;
  weekday: string;
  week?: number;
  label?: string;
  phase?: string;
  holiday?: string;
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
