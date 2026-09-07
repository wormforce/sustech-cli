import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { CalendarTerm } from "../calendar/client.js";
import { buildContextSchedule } from "../context/schedule.js";
import {
  buildIcsContent,
  buildScheduleIcs,
  holidayToIcsEvent,
  inferWeekOneMonday,
  nearestUpcomingExam,
  parseIsoDateTimeToUtcStamp,
  parseShenzhenExamTimeRange,
  PERIOD_START_TIMES,
  scheduleOccurrences,
  summariseCurrentOrNextClass,
  teachingPeriodAtShenzhenTime,
  writeIcsFile,
} from "../tis/remaining-calendar.js";
import type { ExamRecord, PersonalScheduleEntry } from "../tis/types.js";

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

const FALL_2026 = new CalendarTerm({
  season: "fall",
  level: "undergraduate",
  humanName: "2026 Fall",
  semester: { xn: "2026-2027", xq: "1", value: "2026-2027-1" },
  start: "2026-09-01",
  end: "2027-01-11",
  signIn: "2026-09-04",
  teachingStart: "2026-09-07",
  teachingEnd: "2026-12-27",
  totalTeachingWeeks: 16,
  midterm: { start: "2026-10-26", end: "2026-11-08", equivalentWeeks: [8, 9] },
  final: { start: "2026-12-28", end: "2027-01-08", equivalentWeeks: [17] },
  compensatories: [
    { date: "2026-09-20", weekType: "odd", workday: "Friday" },
    { date: "2026-10-10", weekType: "odd", workday: "Wednesday" },
  ],
  extraBreaks: ["2026-11-20"],
}, [
  { name: "Mid-Autumn Festival", start: "2026-09-25", end: "2026-09-27" },
  { name: "National Day", start: "2026-10-01", end: "2026-10-07" },
]);

test("week-one inference backtracks from today's week index to the semester anchor", () => {
  assert.equal(inferWeekOneMonday("2026-03-04", 2), "2026-02-23");
});

test("daily snapshot exposes current and next classes together on the adjusted makeup date", () => {
  const morning = { ...ENTRIES[0], day: 5, weeks: [3], periodStart: 5, periodEnd: 6 };
  const afternoon = { ...morning, rwh: "R2", periodStart: 7, periodEnd: 8 };
  const snapshot = buildContextSchedule([morning, afternoon], FALL_2026, new Date("2026-09-20T14:30:00+08:00"));
  assert.equal(snapshot.todayClasses?.length, 2);
  assert.equal(snapshot.currentClass?.startAt, "2026-09-20T06:00:00Z");
  assert.equal(snapshot.nextClass?.startAt, "2026-09-20T08:20:00Z");
  assert.equal(snapshot.currentClass?.makeupFor, "2026-09-25");
  assert.ok(snapshot.now && snapshot.next);
  const holiday = buildContextSchedule([morning], FALL_2026, new Date("2026-09-25T14:30:00+08:00"));
  assert.deepEqual(holiday.todayClasses, []);
  assert.equal(holiday.nextClass, undefined);
  const beforeTerm = buildContextSchedule([{ ...ENTRIES[0], weeks: [1] }], FALL_2026, new Date("2026-09-05T10:00:00+08:00"));
  assert.equal(beforeTerm.nextClass?.startAt, "2026-09-07T02:20:00Z");
  const priorDay = buildContextSchedule([morning], FALL_2026, new Date("2026-09-19T10:00:00+08:00"));
  assert.equal(priorDay.tomorrowMorning, undefined);
  const unknownTime = buildContextSchedule([{ ...morning, weeks: [] }], FALL_2026, new Date("2026-09-20T10:00:00+08:00"));
  assert.equal(unknownTime.omissionCount, 1);
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

test("legacy ICS export keeps the historical thirteenth TIS period", () => {
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

test("2026 fall uses the current SUSTech period schedule", () => {
  assert.deepEqual(PERIOD_START_TIMES, {
    1: [8, 0],
    2: [9, 0],
    3: [10, 20],
    4: [11, 20],
    5: [14, 0],
    6: [15, 0],
    7: [16, 20],
    8: [17, 20],
    9: [19, 0],
    10: [20, 0],
    11: [21, 0],
  });
  assert.match(
    teachingPeriodAtShenzhenTime(new Date("2026-09-08T06:05:00Z"))?.periodLabel ?? "",
    /P5 14:00-14:50/,
  );
  assert.match(
    teachingPeriodAtShenzhenTime(new Date("2026-09-08T08:25:00Z"))?.periodLabel ?? "",
    /P7 16:20-17:10/,
  );
  assert.match(
    teachingPeriodAtShenzhenTime(new Date("2026-09-08T13:05:00Z"))?.periodLabel ?? "",
    /P11 21:00-21:50/,
  );
  assert.equal(teachingPeriodAtShenzhenTime(new Date("2026-09-08T14:05:00Z")), undefined);
});

test("calendar-adjusted occurrences move odd-week classes onto compensatory days", () => {
  const friday: PersonalScheduleEntry = {
    ...ENTRIES[0],
    rwh: "FRIDAY",
    key: "xq5_jc5",
    day: 5,
    periodStart: 5,
    periodEnd: 6,
    weeks: [3],
  };
  const wednesday: PersonalScheduleEntry = {
    ...ENTRIES[0],
    rwh: "WEDNESDAY",
    key: "xq3_jc7",
    day: 3,
    periodStart: 7,
    periodEnd: 8,
    weeks: [5],
  };
  const holidayOnly: PersonalScheduleEntry = {
    ...ENTRIES[0],
    rwh: "MONDAY",
    key: "xq1_jc1",
    day: 1,
    periodStart: 1,
    periodEnd: 2,
    weeks: [5],
  };

  const occurrences = scheduleOccurrences(
    [friday, wednesday, holidayOnly],
    { teachingStartDate: FALL_2026.snapshot.teachingStart },
    FALL_2026,
  );
  assert.deepEqual(occurrences.map((entry) => entry.date), ["2026-09-20", "2026-10-10"]);
  assert.deepEqual(occurrences.map((entry) => entry.sourceDate), ["2026-09-25", "2026-10-07"]);
  assert.ok(occurrences.every((entry) => entry.isCompensatory));
  assert.equal(occurrences[0]?.startUtc, "20260920T060000Z");
  assert.equal(occurrences[1]?.endUtc, "20261010T101000Z");
});

test("teaching-period lookup uses Asia/Shanghai wall clock boundaries", () => {
  const period = teachingPeriodAtShenzhenTime(new Date("2026-08-26T02:25:00Z"));
  assert.equal(period?.date, "2026-08-26");
  assert.equal(period?.weekday, 3);
  assert.equal(period?.periodStart, 3);
  assert.match(period?.periodLabel ?? "", /P3 10:20-11:10/);

  const none = teachingPeriodAtShenzhenTime(new Date("2026-08-26T04:15:00Z"));
  assert.equal(none, undefined);
});

test("generic ICS builder supports all-day holidays and timed deadline-style events", () => {
  const ics = buildIcsContent([
    {
      uid: "deadline-1@sustech-cli",
      summary: "Deadline · CS101 Project 1",
      description: "Course: 程序设计",
      startUtc: "20260826T100000Z",
    },
    holidayToIcsEvent({ name: "Labor Day", start: "2026-05-01", end: "2026-05-05" }),
  ], {
    calendarName: "SUSTech Mixed",
    nowUtc: new Date(Date.UTC(2026, 7, 26, 0, 0, 0)),
  });

  assert.match(ics, /X-WR-CALNAME:SUSTech Mixed/);
  assert.match(ics, /UID:deadline-1@sustech-cli/);
  assert.match(ics, /DTSTART:20260826T100000Z/);
  assert.doesNotMatch(ics, /DTEND:20260826T100000Z/);
  assert.match(ics, /SUMMARY:Labor Day/);
  assert.match(ics, /DTSTART;VALUE=DATE:20260501/);
  assert.match(ics, /DTEND;VALUE=DATE:20260506/);
});

test("exam datetime helpers accept exact values and reject guesses", () => {
  assert.equal(parseIsoDateTimeToUtcStamp("2026-08-26T18:00:00+08:00"), "20260826T100000Z");
  assert.equal(parseIsoDateTimeToUtcStamp("2026-02-30T18:00:00+08:00"), undefined);
  assert.equal(parseIsoDateTimeToUtcStamp("2026/08/26 18:00"), undefined);
  assert.deepEqual(parseShenzhenExamTimeRange("2026-08-28", "09:00-11:00"), {
    startUtc: "20260828T010000Z",
    endUtc: "20260828T030000Z",
  });
  assert.equal(parseShenzhenExamTimeRange("2026-08-28", "morning"), undefined);
});

test("current-or-next class summary distinguishes active and upcoming classes", () => {
  const active = summariseCurrentOrNextClass([
    { ...ENTRIES[0], day: 3, weeks: [4] },
  ], {
    currentWeek: 4,
    now: new Date("2026-08-26T02:25:00Z"),
  });
  assert.match(active.now ?? "", /CS101 程序设计/);

  const upcoming = summariseCurrentOrNextClass([
    { ...ENTRIES[0], day: 3, weeks: [4] },
  ], {
    currentWeek: 4,
    now: new Date("2026-08-25T00:10:00Z"),
  });
  assert.equal(upcoming.now, undefined);
  assert.match(upcoming.next ?? "", /CS101 程序设计/);
  assert.match(upcoming.nextDetail ?? "", /week 4 Wednesday|today|tomorrow/i);
});

test("current class summary follows compensatory dates instead of the holiday weekday", () => {
  const wednesday: PersonalScheduleEntry = {
    ...ENTRIES[0],
    day: 3,
    periodStart: 7,
    periodEnd: 8,
    weeks: [5],
  };
  const holiday = summariseCurrentOrNextClass([wednesday], {
    currentWeek: 5,
    now: new Date("2026-10-07T08:30:00Z"),
    calendarTerm: FALL_2026,
  });
  assert.equal(holiday.now, undefined);
  assert.match(holiday.nextDetail ?? "", /Saturday \(makeup for Wednesday\)/);

  const makeup = summariseCurrentOrNextClass([wednesday], {
    currentWeek: 5,
    now: new Date("2026-10-10T08:30:00Z"),
    calendarTerm: FALL_2026,
  });
  assert.match(makeup.now ?? "", /today \(makeup for Wednesday\).*16:20-18:10/);
});

test("nearest upcoming exam keeps exact-order semantics and reports omitted malformed rows", () => {
  const exams: ExamRecord[] = [
    {
      code: "CS101",
      name: "Programming",
      date: "2026-08-26",
      weekday: "周三",
      weekdayEn: "Wednesday",
      time: "09:00-11:00",
      building: "理学院",
      room: "101",
      campus: "南科大",
      type: "期末",
      semester: "2025-2026学年春季学期",
    },
    {
      code: "MA101",
      name: "Calculus",
      date: "2026-08-26",
      weekday: "周三",
      weekdayEn: "Wednesday",
      time: "15:00-17:00",
      building: "主楼",
      room: "201",
      campus: "南科大",
      type: "期末",
      semester: "2025-2026学年春季学期",
    },
    {
      code: "PH101",
      name: "Physics",
      date: "later",
      weekday: "周四",
      weekdayEn: "Thursday",
      time: "09:00-11:00",
      building: "主楼",
      room: "301",
      campus: "南科大",
      type: "期末",
      semester: "2025-2026学年春季学期",
    },
  ];

  const selected = nearestUpcomingExam(exams, { now: new Date("2026-08-26T04:00:00Z") });
  assert.equal(selected.exam?.code, "MA101");
  assert.equal(selected.omissions.length, 1);
  assert.match(selected.omissions[0]?.message ?? "", /exact YYYY-MM-DD/);
});

test("nearest upcoming exam omits future rows whose time is not exact", () => {
  const exams: ExamRecord[] = [
    {
      code: "CS203",
      name: "Data Structures",
      date: "2026-08-29",
      weekday: "周六",
      weekdayEn: "Saturday",
      time: "",
      building: "主楼",
      room: "101",
      campus: "南科大",
      type: "期末",
      semester: "2025-2026学年春季学期",
    },
    {
      code: "MA205",
      name: "Probability",
      date: "2026-08-30",
      weekday: "周日",
      weekdayEn: "Sunday",
      time: "09:00-11:00",
      building: "理学院",
      room: "201",
      campus: "南科大",
      type: "期末",
      semester: "2025-2026学年春季学期",
    },
  ];

  const selected = nearestUpcomingExam(exams, { now: new Date("2026-08-26T04:00:00Z") });
  assert.equal(selected.exam?.code, "MA205");
  assert.equal(selected.omissions.length, 1);
  assert.match(selected.omissions[0]?.message ?? "", /future exam time could not be parsed exactly/i);
});

test("safe ICS writer rejects symlinks and keeps new files mode 0600", async () => {
  const tempDir = await mkdtemp(join(process.cwd(), ".tmp-sustech-cli-ics-"));
  const destination = join(tempDir, "schedule.ics");
  const symlinkPath = join(tempDir, "schedule-link.ics");
  const symlinkedParent = join(tempDir, "linked-parent");
  const guardedDestination = join(symlinkedParent, "nested.ics");
  const payload = "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n";

  try {
    const result = await writeIcsFile(payload, destination);
    assert.equal(result.overwritten, false);
    assert.equal((await readFile(destination, "utf8")), payload);
    const metadata = await stat(destination);
    assert.equal(metadata.isFile(), true);
    if (process.platform !== "win32") assert.equal(metadata.mode & 0o777, 0o600);

    await symlink(destination, symlinkPath);
    await assert.rejects(() => writeIcsFile(payload, symlinkPath), /symbolic link/i);
    await symlink(tempDir, symlinkedParent);
    await assert.rejects(() => writeIcsFile(payload, guardedDestination), /symbolic link/i);
    await assert.rejects(() => writeIcsFile(payload, destination), /already exists/i);

    await writeFile(destination, "old", "utf8");
    const overwritten = await writeIcsFile(payload, destination, { overwrite: true });
    assert.equal(overwritten.overwritten, true);
    assert.equal((await readFile(destination, "utf8")), payload);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
