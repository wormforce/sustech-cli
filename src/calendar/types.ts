import type { Semester } from "../core/semester.js";

export type CalendarLevel = "undergraduate" | "graduate";
export type SemesterSeason = "spring" | "summer" | "fall";
export type WeekParity = "odd" | "even";
export type WeekdayName =
  | "Monday"
  | "Tuesday"
  | "Wednesday"
  | "Thursday"
  | "Friday"
  | "Saturday"
  | "Sunday";

export interface Holiday {
  name: string;
  start: string;
  end: string;
}

export interface CompensatoryDay {
  date: string;
  weekType: WeekParity;
  workday: WeekdayName;
}

export interface TeachingWindow {
  start: string;
  end: string;
  equivalentWeeks: number[];
}

export interface CalendarTermSnapshot {
  season: SemesterSeason;
  level: CalendarLevel;
  humanName: string;
  semester: Semester;
  start: string;
  end: string;
  signIn: string;
  teachingStart: string;
  teachingEnd: string;
  freshmanArrival?: string;
  totalTeachingWeeks: number;
  midterm: TeachingWindow;
  final: TeachingWindow;
  compensatories: CompensatoryDay[];
  extraBreaks: string[];
}

export interface CalendarDayFlags {
  isHoliday: boolean;
  isCompensatory: boolean;
  isTeachingDay: boolean;
  hasClass: boolean;
  isExtraBreak: boolean;
  isFinal: boolean;
  isMidterm: boolean;
  isWeekend: boolean;
}

export interface CalendarDaySemester {
  season: SemesterSeason;
  level: CalendarLevel;
  humanName: string;
  semester: Semester;
}

export interface CalendarDayInfo {
  date: string;
  weekday: WeekdayName;
  weekdayIndex: number;
  week: number;
  label: string;
  phase: string;
  holiday?: Holiday;
  compensatory?: CompensatoryDay;
  semester?: CalendarDaySemester;
  flags: CalendarDayFlags;
}

export interface CalendarPayloads {
  undergraduate: Record<string, unknown>;
  graduate: Record<string, unknown>;
  general: Record<string, unknown>;
}
