import assert from "node:assert/strict";
import test from "node:test";
import { buildScheduleIcs, inferWeekOneMonday, scheduleOccurrences } from "../tis/remaining-calendar.js";
import type { PersonalScheduleEntry } from "../tis/types.js";

const ENTRIES: PersonalScheduleEntry[] = [
  {
    rwh: "R1",
    key: "xq1_jc3",
    courseCode: "CS101",
    courseName: "程序设计",
    teacher: "张三",
    room: "智华楼102",
    description: "程序设计导论",
    descriptionEn: "Intro to Programming",
    day: 1,
    periodStart: 3,
    periodEnd: 4,
    weeks: [1, 3],
  },
];

test("week-one inference backtracks from today's week index to the semester anchor", () => {
  assert.equal(inferWeekOneMonday("2026-03-04", 2), "2026-02-23");
});

test("ICS export expands schedule entries into dated UTC events", () => {
  const occurrences = scheduleOccurrences(ENTRIES, { weekOneMonday: "2026-02-23" });
  assert.equal(occurrences.length, 2);
  assert.equal(occurrences[0].date, "2026-02-23");
  assert.equal(occurrences[0].startUtc, "20260223T022000Z");
  assert.equal(occurrences[0].endUtc, "20260223T041000Z");

  const ics = buildScheduleIcs(ENTRIES, { weekOneMonday: "2026-02-23" }, {
    calendarName: "SUSTech Test",
    nowUtc: new Date(Date.UTC(2026, 1, 20, 0, 0, 0)),
  });
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /X-WR-CALNAME:SUSTech Test/);
  assert.match(ics, /SUMMARY:CS101 程序设计/);
  assert.match(ics, /DTSTART:20260223T022000Z/);
  assert.match(ics, /LOCATION:智华楼102/);
});

test("ICS export supports the thirteenth TIS period", () => {
  const lateEntry: PersonalScheduleEntry = {
    ...ENTRIES[0],
    key: "xq1_jc13",
    periodStart: 13,
    periodEnd: 13,
    weeks: [1],
  };
  const [occurrence] = scheduleOccurrences([lateEntry], { weekOneMonday: "2026-02-23" });
  assert.equal(occurrence?.startUtc, "20260223T140000Z");
  assert.equal(occurrence?.endUtc, "20260223T145000Z");
});
