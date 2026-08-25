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

export interface TimetableSolution {
  index: number;
  totalCredits: number;
  sections: Course[];
}

export interface TimetableResult {
  requestedCodes: string[];
  missingCodes: string[];
  blocked: BlockedTime[];
  solutions: TimetableSolution[];
  truncated: boolean;
  candidatesByCode: Record<string, number>;
  excludedUnscheduledByCode: Record<string, number>;
}

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
  options: { maxResults: number; blocked?: BlockedTime[] },
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
    };
  }

  const orderedCodes = [...requestedCodes].sort(
    (left, right) => (candidates.get(left)?.length ?? 0) - (candidates.get(right)?.length ?? 0),
  );
  const rawSolutions: Course[][] = [];
  const collectionLimit = options.maxResults + 1;

  const visit = (index: number, selected: Course[]): void => {
    if (rawSolutions.length >= collectionLimit) return;
    if (index === orderedCodes.length) {
      rawSolutions.push([...selected]);
      return;
    }
    const code = orderedCodes[index];
    for (const section of candidates.get(code) ?? []) {
      if (selected.some((existing) => coursesConflict(section, existing))) continue;
      selected.push(section);
      visit(index + 1, selected);
      selected.pop();
      if (rawSolutions.length >= collectionLimit) return;
    }
  };
  visit(0, []);

  const truncated = rawSolutions.length > options.maxResults;
  const solutions = rawSolutions.slice(0, options.maxResults).map((sections, index) => ({
    index: index + 1,
    totalCredits: round(sections.reduce((total, course) => total + course.credits, 0), 2),
    sections: [...sections].sort(
      (left, right) => requestedCodes.indexOf(left.code.toUpperCase()) - requestedCodes.indexOf(right.code.toUpperCase()),
    ),
  }));
  return {
    requestedCodes,
    missingCodes,
    blocked,
    solutions,
    truncated,
    candidatesByCode,
    excludedUnscheduledByCode,
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

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
