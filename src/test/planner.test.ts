import assert from "node:assert/strict";
import test from "node:test";
import { coursesConflict, parseBlockedTime, solveTimetables } from "../tis/planner.js";
import type { Course, ScheduleSlot } from "../tis/types.js";

test("timetable solver respects week-aware conflicts and blocked periods", () => {
  const csA = course("CS101", "A", slot([1, 3, 5], 1, 1, 2));
  const csB = course("CS101", "B", slot([2, 4, 6], 1, 1, 2));
  const mathA = course("MA101", "A", slot([1, 3, 5], 1, 2, 3));
  const mathB = course("MA101", "B", slot([1, 2, 3], 3, 7, 8));

  assert.equal(coursesConflict(csA, mathA), true);
  assert.equal(coursesConflict(csB, mathA), false);
  assert.deepEqual(parseBlockedTime("周三:7-8"), {
    day: 3,
    dayName: "周三",
    periodStart: 7,
    periodEnd: 8,
  });

  const result = solveTimetables([csA, csB, mathA, mathB], ["CS101", "MA101"], {
    maxResults: 20,
    blocked: [parseBlockedTime("WED:7-8")],
  });
  assert.equal(result.solutions.length, 1);
  assert.deepEqual(result.solutions[0].sections.map((section) => section.classGroup), ["B", "A"]);
});

test("timetable solver reports missing course codes instead of claiming zero conflicts", () => {
  const result = solveTimetables([course("CS101", "A", slot([1], 1, 1, 2))], ["CS101", "NOPE"], {
    maxResults: 10,
  });
  assert.deepEqual(result.missingCodes, ["NOPE"]);
  assert.deepEqual(result.solutions, []);
});

test("timetable solver excludes unknown-time sections and reports truncation only when another solution exists", () => {
  const scheduledA = course("CS101", "A", slot([1], 1, 1, 2));
  const scheduledB = course("CS101", "B", slot([1], 2, 1, 2));
  const unscheduled = { ...course("CS101", "TBA", slot([1], 3, 1, 2)), schedule: [] };

  const oneOfTwo = solveTimetables([scheduledA, scheduledB, unscheduled], ["CS101"], { maxResults: 1 });
  assert.equal(oneOfTwo.solutions.length, 1);
  assert.equal(oneOfTwo.truncated, true);
  assert.equal(oneOfTwo.excludedUnscheduledByCode.CS101, 1);

  const exactlyOne = solveTimetables([scheduledA, unscheduled], ["CS101"], { maxResults: 1 });
  assert.equal(exactlyOne.truncated, false);
});

test("timetable solver ranks later and more compact combinations ahead of earlier or looser ones", () => {
  const early = course("CS101", "EARLY", slot([1, 2], 1, 1, 2), "南校区");
  const late = course("CS101", "LATE", slot([1, 2], 1, 3, 4), "南校区");
  const compact = course("MA101", "COMPACT", slot([1, 2], 1, 5, 6), "南校区");
  const loose = course("MA101", "LOOSE", slot([1, 2], 1, 8, 9), "南校区");

  const result = solveTimetables([early, late, compact, loose], ["CS101", "MA101"], { maxResults: 4 });
  assert.deepEqual(
    result.solutions.map((solution) => solution.sections.map((section) => section.classGroup)),
    [
      ["LATE", "COMPACT"],
      ["LATE", "LOOSE"],
      ["EARLY", "COMPACT"],
      ["EARLY", "LOOSE"],
    ],
  );
  assert.equal(result.solutions[0].score.metricUnit, "average-per-active-week");
  assert.equal(result.solutions[0].score.activeWeeks, 2);
  assert.equal(result.solutions[0].score.metrics.earlySessions, 0);
  assert.equal(result.solutions[0].score.metrics.gapPeriods, 0);
  assert.ok(result.solutions[0].score.total > result.solutions[3].score.total);
});

test("timetable scoring penalizes weekly campus switches and surfaces truthful search metadata", () => {
  const base = course("CS101", "BASE", slot([1, 2], 1, 3, 4), "南校区");
  const sameCampus = course("MA101", "SAME", slot([1, 2], 1, 5, 6), "南校区");
  const switchCampus = course("MA101", "SWITCH", slot([1, 2], 1, 5, 6), "北校区");

  const result = solveTimetables([base, sameCampus, switchCampus], ["CS101", "MA101"], {
    maxResults: 1,
    maxSearchCandidates: 1,
  });
  assert.equal(result.searchTruncated, true);
  assert.equal(result.evaluatedCount, 1);
  assert.equal(result.searchLimit, 1);

  const full = solveTimetables([base, sameCampus, switchCampus], ["CS101", "MA101"], { maxResults: 2 });
  assert.equal(full.solutions[0].sections[1].classGroup, "SAME");
  assert.equal(full.solutions[1].score.metrics.campusSwitches, 1);
  assert.equal(full.solutions[1].score.metrics.distinctWeekdays, 1);
});

function slot(weeks: number[], day: number, periodStart: number, periodEnd: number): ScheduleSlot {
  return { weeks, day, dayName: `day${day}`, periodStart, periodEnd, room: "R1" };
}

function course(code: string, classGroup: string, schedule: ScheduleSlot, campus = ""): Course {
  return {
    code,
    name: code,
    sectionName: classGroup,
    classGroup,
    rwh: `${code}-${classGroup}`,
    college: "",
    category: "",
    nature: "",
    campus,
    credits: 3,
    totalHours: 48,
    cultivation: "本科",
    taskType: "",
    language: "",
    teachers: [],
    schedule: [schedule],
  };
}
