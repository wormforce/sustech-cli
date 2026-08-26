import { CliError } from "../core/errors.js";
import type { Course, ScheduleSlot } from "./types.js";

const DAY_NAMES = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const DAY_CODES: Readonly<Record<string, number>> = {
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
  SUN: 7,
  周一: 1,
  周二: 2,
  周三: 3,
  周四: 4,
  周五: 5,
  周六: 6,
  周日: 7,
};

export interface BlockedTime {
  day: number;
  dayName: string;
  periodStart: number;
  periodEnd: number;
}

export interface TimetableScoreWeights {
  earlySession: number;
  gapSegment: number;
  gapPeriod: number;
  distinctWeekday: number;
  campusSwitch: number;
}

export interface TimetablePreferenceInput {
  earlyPeriodThreshold?: number;
  weights?: Partial<TimetableScoreWeights>;
}

export interface TimetablePreferences {
  earlyPeriodThreshold: number;
  weights: TimetableScoreWeights;
}

export interface TimetableScoreMetrics {
  earlySessions: number;
  gapSegments: number;
  gapPeriods: number;
  distinctWeekdays: number;
  campusSwitches: number;
}

export interface TimetableScoreBreakdown {
  total: number;
  weights: TimetableScoreWeights;
  metrics: TimetableScoreMetrics;
  contributions: {
    earlySessions: number;
    gapSegments: number;
    gapPeriods: number;
    distinctWeekdays: number;
    campusSwitches: number;
  };
}

export interface TimetableSolution {
  index: number;
  totalCredits: number;
  sections: Course[];
  score: TimetableScoreBreakdown;
}

export interface TimetableResult {
  requestedCodes: string[];
  missingCodes: string[];
  blocked: BlockedTime[];
  solutions: TimetableSolution[];
  truncated: boolean;
  candidatesByCode: Record<string, number>;
  excludedUnscheduledByCode: Record<string, number>;
  preferences: TimetablePreferences;
  evaluatedCount: number;
  searchLimit: number;
  searchTruncated: boolean;
}

export const DEFAULT_TIMETABLE_PREFERENCES: TimetablePreferences = {
  earlyPeriodThreshold: 2,
  weights: {
    earlySession: 2,
    gapSegment: 5,
    gapPeriod: 1,
    distinctWeekday: 4,
    campusSwitch: 6,
  },
};

export function parseBlockedTime(value: string): BlockedTime {
  const match = /^([^:]+):(\d+)(?:-(\d+))?$/.exec(value.trim());
  if (!match) {
    throw new CliError(
      "--block must look like MON:1-4, 周三:7-8, or 5:9-10.",
      "INVALID_BLOCK",
      2,
      { received: value },
    );
  }
  const dayToken = match[1].trim().toUpperCase();
  const day = DAY_CODES[dayToken] ?? (/^[1-7]$/.test(dayToken) ? Number(dayToken) : undefined);
  const periodStart = Number(match[2]);
  const periodEnd = Number(match[3] ?? match[2]);
  if (day === undefined || periodStart < 1 || periodEnd > 13 || periodEnd < periodStart) {
    throw new CliError(
      "--block contains an invalid day or period range (valid periods: 1-13).",
      "INVALID_BLOCK",
      2,
      { received: value },
    );
  }
  return { day, dayName: DAY_NAMES[day], periodStart, periodEnd };
}

export function solveTimetables(
  catalog: Course[],
  requested: string[],
  options: { maxResults: number; blocked?: BlockedTime[]; preferences?: TimetablePreferenceInput; maxSearchCandidates?: number },
): TimetableResult {
  const requestedCodes = [...new Set(requested.map((code) => code.trim().toUpperCase()).filter(Boolean))];
  if (requestedCodes.length === 0) {
    throw new CliError("At least one course code is required.", "COURSE_CODES_REQUIRED", 2);
  }
  if (requestedCodes.length > 12) {
    throw new CliError("At most 12 course codes can be solved at once.", "TOO_MANY_COURSE_CODES", 2, {
      received: requestedCodes.length,
    });
  }

  const blocked = options.blocked ?? [];
  const preferences = normaliseTimetablePreferences(options.preferences);
  const searchLimit = boundedInteger(options.maxSearchCandidates, 5000, 1, 100000);
  const candidates = new Map<string, Course[]>();
  const excludedUnscheduledByCode: Record<string, number> = {};
  for (const code of requestedCodes) {
    const seen = new Set<string>();
    excludedUnscheduledByCode[code] = catalog.filter(
      (course) => course.code.toUpperCase() === code && course.schedule.length === 0,
    ).length;
    const sections = catalog.filter((course) => {
      const identity = course.rwh || `${course.code}/${course.classGroup}`;
      if (course.code.toUpperCase() !== code || course.schedule.length === 0 || seen.has(identity)) return false;
      seen.add(identity);
      return !course.schedule.some((slot) => blocked.some((entry) => slotOverlapsBlock(slot, entry)));
    });
    candidates.set(code, sections);
  }

  const missingCodes = requestedCodes.filter((code) => (candidates.get(code)?.length ?? 0) === 0);
  const candidatesByCode = Object.fromEntries(requestedCodes.map((code) => [code, candidates.get(code)?.length ?? 0]));
  if (missingCodes.length > 0) {
    return {
      requestedCodes,
      missingCodes,
      blocked,
      solutions: [],
      truncated: false,
      candidatesByCode,
      excludedUnscheduledByCode,
      preferences,
      evaluatedCount: 0,
      searchLimit,
      searchTruncated: false,
    };
  }

  const orderedCodes = [...requestedCodes].sort(
    (left, right) => (candidates.get(left)?.length ?? 0) - (candidates.get(right)?.length ?? 0),
  );
  const topSolutions: TimetableSolution[] = [];
  let evaluatedCount = 0;
  let searchTruncated = false;

  const visit = (index: number, selected: Course[]): boolean => {
    if (searchTruncated) return true;
    if (index === orderedCodes.length) {
      evaluatedCount += 1;
      const orderedSections = [...selected].sort(
        (left, right) => requestedCodes.indexOf(left.code.toUpperCase()) - requestedCodes.indexOf(right.code.toUpperCase()),
      );
      const solution: TimetableSolution = {
        index: 0,
        totalCredits: round(orderedSections.reduce((total, course) => total + course.credits, 0), 2),
        sections: orderedSections,
        score: scoreTimetable(orderedSections, preferences),
      };
      topSolutions.push(solution);
      topSolutions.sort(compareSolutions);
      if (topSolutions.length > options.maxResults) topSolutions.pop();
      if (evaluatedCount >= searchLimit) {
        searchTruncated = true;
        return true;
      }
      return false;
    }
    const code = orderedCodes[index];
    for (const section of candidates.get(code) ?? []) {
      if (selected.some((existing) => coursesConflict(section, existing))) continue;
      selected.push(section);
      if (visit(index + 1, selected)) {
        selected.pop();
        return true;
      }
      selected.pop();
    }
    return false;
  };
  visit(0, []);

  const truncated = searchTruncated || evaluatedCount > options.maxResults;
  const solutions = topSolutions.map((solution, index) => ({ ...solution, index: index + 1 }));
  return {
    requestedCodes,
    missingCodes,
    blocked,
    solutions,
    truncated,
    candidatesByCode,
    excludedUnscheduledByCode,
    preferences,
    evaluatedCount,
    searchLimit,
    searchTruncated,
  };
}

export function coursesConflict(left: Course, right: Course): boolean {
  return left.schedule.some((leftSlot) => right.schedule.some((rightSlot) => slotsConflict(leftSlot, rightSlot)));
}

export function slotsConflict(left: ScheduleSlot, right: ScheduleSlot): boolean {
  if (left.day !== right.day || left.periodEnd < right.periodStart || right.periodEnd < left.periodStart) return false;
  const rightWeeks = new Set(right.weeks);
  return left.weeks.some((week) => rightWeeks.has(week));
}

function slotOverlapsBlock(slot: ScheduleSlot, blocked: BlockedTime): boolean {
  return slot.day === blocked.day
    && slot.periodEnd >= blocked.periodStart
    && blocked.periodEnd >= slot.periodStart;
}

export function normaliseTimetablePreferences(
  value: TimetablePreferenceInput | undefined,
): TimetablePreferences {
  return {
    earlyPeriodThreshold: boundedInteger(
      value?.earlyPeriodThreshold,
      DEFAULT_TIMETABLE_PREFERENCES.earlyPeriodThreshold,
      1,
      13,
    ),
    weights: {
      earlySession: boundedInteger(value?.weights?.earlySession, DEFAULT_TIMETABLE_PREFERENCES.weights.earlySession, 0, 100),
      gapSegment: boundedInteger(value?.weights?.gapSegment, DEFAULT_TIMETABLE_PREFERENCES.weights.gapSegment, 0, 100),
      gapPeriod: boundedInteger(value?.weights?.gapPeriod, DEFAULT_TIMETABLE_PREFERENCES.weights.gapPeriod, 0, 100),
      distinctWeekday: boundedInteger(
        value?.weights?.distinctWeekday,
        DEFAULT_TIMETABLE_PREFERENCES.weights.distinctWeekday,
        0,
        100,
      ),
      campusSwitch: boundedInteger(value?.weights?.campusSwitch, DEFAULT_TIMETABLE_PREFERENCES.weights.campusSwitch, 0, 100),
    },
  };
}

function scoreTimetable(sections: readonly Course[], preferences: TimetablePreferences): TimetableScoreBreakdown {
  const metrics: TimetableScoreMetrics = {
    earlySessions: 0,
    gapSegments: 0,
    gapPeriods: 0,
    distinctWeekdays: 0,
    campusSwitches: 0,
  };
  const activeDays = new Set<number>();
  const meetingsByWeekDay = new Map<string, Array<{
    day: number;
    periodStart: number;
    periodEnd: number;
    campus: string;
  }>>();

  for (const course of sections) {
    const campus = course.campus.trim();
    for (const slot of course.schedule) {
      activeDays.add(slot.day);
      for (const week of slot.weeks) {
        metrics.earlySessions += slot.periodStart <= preferences.earlyPeriodThreshold ? 1 : 0;
        const key = `${week}:${slot.day}`;
        const dayMeetings = meetingsByWeekDay.get(key) ?? [];
        dayMeetings.push({
          day: slot.day,
          periodStart: slot.periodStart,
          periodEnd: slot.periodEnd,
          campus,
        });
        meetingsByWeekDay.set(key, dayMeetings);
      }
    }
  }

  metrics.distinctWeekdays = activeDays.size;

  for (const meetings of meetingsByWeekDay.values()) {
    meetings.sort((left, right) =>
      left.periodStart - right.periodStart
      || left.periodEnd - right.periodEnd
      || left.campus.localeCompare(right.campus),
    );
    for (let index = 1; index < meetings.length; index += 1) {
      const previous = meetings[index - 1];
      const current = meetings[index];
      const gap = current.periodStart - previous.periodEnd - 1;
      if (gap > 0) {
        metrics.gapSegments += 1;
        metrics.gapPeriods += gap;
      }
      if (previous.campus && current.campus && previous.campus !== current.campus) {
        metrics.campusSwitches += 1;
      }
    }
  }

  const contributions = {
    earlySessions: -metrics.earlySessions * preferences.weights.earlySession,
    gapSegments: -metrics.gapSegments * preferences.weights.gapSegment,
    gapPeriods: -metrics.gapPeriods * preferences.weights.gapPeriod,
    distinctWeekdays: -metrics.distinctWeekdays * preferences.weights.distinctWeekday,
    campusSwitches: -metrics.campusSwitches * preferences.weights.campusSwitch,
  };
  return {
    total: contributions.earlySessions
      + contributions.gapSegments
      + contributions.gapPeriods
      + contributions.distinctWeekdays
      + contributions.campusSwitches,
    weights: preferences.weights,
    metrics,
    contributions,
  };
}

function compareSolutions(left: TimetableSolution, right: TimetableSolution): number {
  if (left.score.total !== right.score.total) return right.score.total - left.score.total;
  if (left.score.metrics.distinctWeekdays !== right.score.metrics.distinctWeekdays) {
    return left.score.metrics.distinctWeekdays - right.score.metrics.distinctWeekdays;
  }
  if (left.score.metrics.gapSegments !== right.score.metrics.gapSegments) {
    return left.score.metrics.gapSegments - right.score.metrics.gapSegments;
  }
  if (left.score.metrics.gapPeriods !== right.score.metrics.gapPeriods) {
    return left.score.metrics.gapPeriods - right.score.metrics.gapPeriods;
  }
  if (left.score.metrics.earlySessions !== right.score.metrics.earlySessions) {
    return left.score.metrics.earlySessions - right.score.metrics.earlySessions;
  }
  if (left.score.metrics.campusSwitches !== right.score.metrics.campusSwitches) {
    return left.score.metrics.campusSwitches - right.score.metrics.campusSwitches;
  }
  return solutionIdentity(left).localeCompare(solutionIdentity(right));
}

function solutionIdentity(solution: TimetableSolution): string {
  return solution.sections.map((course) => course.rwh || `${course.code}/${course.classGroup}`).join("|");
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const candidate = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(candidate) || candidate < minimum || candidate > maximum) return fallback;
  return candidate;
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
