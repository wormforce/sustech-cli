import assert from "node:assert/strict";
import { test } from "node:test";
import { normalisePersonalScheduleEntry } from "../tis/normalise.js";
import { enrichScheduleEntriesWithDatetimes } from "../tis/client.js";

test("schedule entry normalisation extracts periods correctly", () => {
  const raw = {
    RWH: "2026-2027-1-CS101-001",
    KEY: "xq1_jc1",
    KCDM: "CS101",
    KCMC: "Programming",
    SKJS: "Prof. Zhang",
    SKDD: "一教101",
    SKSJ: "Programming\n[Prof. Zhang]\n[1-8周]\n[一教101]\n[1-2节]",
    SKSJ_EN: "",
    KSJC: 1,
    JSJC: 2,
    ZC: "011111111",
  };

  const entry = normalisePersonalScheduleEntry(raw);
  
  assert.equal(entry.courseCode, "CS101");
  assert.equal(entry.periodStart, 1);
  assert.equal(entry.periodEnd, 2);
  assert.equal(entry.room, "一教101");
  assert.equal(entry.day, 1);
  assert.deepEqual(entry.weeks, [1, 2, 3, 4, 5, 6, 7, 8]);
});

test("schedule enrichment adds full ISO datetime timestamps", () => {
  const entry: import("../tis/types.js").PersonalScheduleEntry = {
    rwh: "2026-2027-1-CS101-001",
    key: "xq1_jc1",
    courseCode: "CS101",
    courseName: "Programming",
    teacher: "Prof. Zhang",
    room: "一教101",
    description: "",
    descriptionEn: "",
    day: 1,
    periodStart: 1,
    periodEnd: 2,
    weeks: [1, 2, 3],
  };

  const enriched = enrichScheduleEntriesWithDatetimes([entry], {
    teachingStartDate: "2026-09-07",
    week: 1,
  });

  assert.equal(enriched.length, 1);
  assert.equal(enriched[0]?.startAt, "2026-09-07T08:00:00+08:00");
  assert.equal(enriched[0]?.endAt, "2026-09-07T09:50:00+08:00");
});

test("multiple rooms are parsed into rooms array", () => {
  const raw = {
    RWH: "2026-2027-1-PHY201-001",
    KEY: "xq3_jc5",
    KCDM: "PHY201",
    KCMC: "Physics Lab",
    SKJS: "Prof. Li",
    SKDD: "505, 506",
    SKSJ: "Physics Lab\n[Prof. Li]\n[1-8周]\n[505, 506]\n[5-6节]",
    SKSJ_EN: "",
    KSJC: 5,
    JSJC: 6,
    ZC: "11111111",
  };

  const entry = normalisePersonalScheduleEntry(raw);
  
  assert.equal(entry.room, "505, 506");
  assert.deepEqual(entry.rooms, ["505", "506"]);
});

test("single room does not populate rooms array", () => {
  const raw = {
    RWH: "2026-2027-1-CS101-001",
    KEY: "xq1_jc1",
    KCDM: "CS101",
    KCMC: "Programming",
    SKJS: "Prof. Zhang",
    SKDD: "一教101",
    SKSJ: "Programming\n[Prof. Zhang]\n[1-16周]\n[一教101]\n[1-2节]",
    SKSJ_EN: "",
    KSJC: 1,
    JSJC: 2,
    ZC: "1111111111111111",
  };

  const entry = normalisePersonalScheduleEntry(raw);
  
  assert.equal(entry.room, "一教101");
  assert.equal(entry.rooms, undefined);
});

test("entries without period data are not enriched", () => {
  const entry: import("../tis/types.js").PersonalScheduleEntry = {
    rwh: "2026-2027-1-CS101-001",
    key: "unknown",
    courseCode: "CS101",
    courseName: "Programming",
    teacher: "Prof. Zhang",
    room: "一教101",
    description: "",
    descriptionEn: "",
    weeks: [1, 2, 3],
  };

  const enriched = enrichScheduleEntriesWithDatetimes([entry], {
    teachingStartDate: "2026-09-07",
    week: 1,
  });

  assert.equal(enriched.length, 1);
  assert.equal(enriched[0]?.startAt, undefined);
  assert.equal(enriched[0]?.endAt, undefined);
});

test("entries not scheduled for the query week are not enriched", () => {
  const entry: import("../tis/types.js").PersonalScheduleEntry = {
    rwh: "2026-2027-1-CS101-001",
    key: "xq1_jc1",
    courseCode: "CS101",
    courseName: "Programming",
    teacher: "Prof. Zhang",
    room: "一教101",
    description: "",
    descriptionEn: "",
    day: 1,
    periodStart: 1,
    periodEnd: 2,
    weeks: [5, 6, 7],
  };

  const enriched = enrichScheduleEntriesWithDatetimes([entry], {
    teachingStartDate: "2026-09-07",
    week: 1,
  });

  assert.equal(enriched.length, 1);
  assert.equal(enriched[0]?.startAt, undefined);
  assert.equal(enriched[0]?.endAt, undefined);
});
