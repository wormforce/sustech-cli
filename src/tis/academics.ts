import type { GpaSummary, GradeRecord } from "./types.js";

export function summariseGrades(grades: GradeRecord[]): GpaSummary {
  let weightedPoints = 0;
  let credits = 0;
  let courseCount = 0;

  for (const grade of grades) {
    if (grade.gpaPoints === undefined || grade.credits <= 0) continue;
    weightedPoints += grade.gpaPoints * grade.credits;
    credits += grade.credits;
    courseCount += 1;
  }

  return {
    gpa: credits > 0 ? round(weightedPoints / credits, 3) : 0,
    credits: round(credits, 2),
    courseCount,
  };
}

export function gradesBySemester(grades: GradeRecord[]): Record<string, GpaSummary> {
  const grouped = new Map<string, GradeRecord[]>();
  for (const grade of grades) {
    const semester = grade.semester || "Unknown";
    grouped.set(semester, [...(grouped.get(semester) ?? []), grade]);
  }
  return Object.fromEntries(
    [...grouped.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([semester, records]) => [semester, summariseGrades(records)]),
  );
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
