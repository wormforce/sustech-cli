import assert from "node:assert/strict";
import test from "node:test";
import { AcademicCalendar } from "../calendar/client.js";
import { ContextService } from "../context/service.js";
import type { CalendarPayloads } from "../calendar/types.js";

const PAYLOADS: CalendarPayloads = {
  undergraduate: {
    spring_semester: {
      start: "2026-02-23",
      end: "2026-06-30",
      sign_in: "2026-02-24",
      teaching_start: "2026-02-25",
      total_teaching_weeks: 17,
      midterm: { start: "2026-04-13", end: "2026-04-26", equivalent_weeks: [8, 9] },
      final: { start: "2026-06-08", end: "2026-06-18", equivalent_weeks: [16, 17] },
      compensatories: [],
    },
    fall_semester: {
      start: "2026-09-01",
      end: "2027-01-11",
      sign_in: "2026-09-04",
      teaching_start: "2026-09-07",
      total_teaching_weeks: 18,
      midterm: { start: "2026-10-26", end: "2026-11-08", equivalent_weeks: [8, 9] },
      final: { start: "2026-12-28", end: "2027-01-08", equivalent_weeks: [17, 18] },
      compensatories: [],
    },
  },
  graduate: {
    spring_semester: {
      start: "2026-02-23",
      end: "2026-06-30",
      sign_in: "2026-02-24",
      teaching_start: "2026-02-25",
      total_teaching_weeks: 17,
      midterm: { start: "2026-04-13", end: "2026-04-26", equivalent_weeks: [8, 9] },
      final: { start: "2026-06-08", end: "2026-06-18", equivalent_weeks: [16, 17] },
      compensatories: [],
    },
    fall_semester: {
      start: "2026-09-01",
      end: "2027-01-11",
      sign_in: "2026-09-04",
      teaching_start: "2026-09-07",
      total_teaching_weeks: 18,
      midterm: { start: "2026-10-26", end: "2026-11-08", equivalent_weeks: [8, 9] },
      final: { start: "2026-12-28", end: "2027-01-08", equivalent_weeks: [17, 18] },
      compensatories: [],
    },
  },
  general: {
    holidays: [{ name: "Labor Day", start: "2026-05-01", end: "2026-05-05" }],
  },
};

test("context service derives academic labels from the calendar and keeps terse output read-only", () => {
  const calendar = AcademicCalendar.fromPayloads(2026, "undergraduate", PAYLOADS);
  const service = new ContextService();
  const snapshot = service.build({
    now: new Date("2026-05-29T14:30:00+08:00"),
    calendar,
    schedule: { next: "程序设计基础", nextDetail: "15:30 @ 一教101" },
  }, "terse");

  assert.equal(snapshot.week, 14);
  assert.equal(snapshot.sourceStatus.academicDay, "derived");
  assert.equal(snapshot.sourceStatus.schedule, "provided");
  assert.equal(snapshot.sourceStatus.nextDeadline, "missing");
  assert.match(service.toText(snapshot), /Week 14 of 2026 Spring/);

  const record = service.toRecord(snapshot);
  assert.equal(record.nextDeadline, undefined);
  assert.equal((record.schedule as { next?: string }).next, "程序设计基础");
});

test("context service includes deadlines, evaluations, and exams at normal level", () => {
  const service = new ContextService();
  const snapshot = service.build({
    now: "2026-05-29T14:30:00+08:00",
    academicDay: {
      date: "2026-05-29",
      weekday: "Friday",
      weekdayIndex: 4,
      week: 14,
      label: "Week 14 of 2026 Spring",
      phase: "2026 Spring semester",
      flags: {
        isHoliday: false,
        isCompensatory: false,
        isTeachingDay: true,
        hasClass: true,
        isExtraBreak: false,
        isFinal: false,
        isMidterm: false,
        isWeekend: false,
      },
    },
    nextDeadline: { name: "BB HW1", daysLeft: 1 },
    nextEvaluation: { course: "线性代数", name: "教学评估", daysLeft: 3 },
    nextExam: { name: "高等数学", code: "MA101", date: "2026-06-20", time: "09:00-11:00", building: "主楼", room: "301" },
  }, "normal");

  const record = service.toRecord(snapshot);
  assert.deepEqual(record.nextDeadline, { name: "BB HW1", daysLeft: 1 });
  assert.deepEqual(record.nextEvaluation, { course: "线性代数", name: "教学评估", daysLeft: 3 });
  assert.deepEqual(record.nextExam, {
    name: "高等数学",
    code: "MA101",
    date: "2026-06-20",
    time: "09:00-11:00",
    building: "主楼",
    room: "301",
  });
  assert.match(service.toText(snapshot), /Next exam: \[高等数学 \(MA101\)\]/);
});

test("context service exposes verbose environmental fields and explicit partial metadata", () => {
  const service = new ContextService();
  const snapshot = service.build({
    now: "2026-05-29T14:30:00+08:00",
    weather: { condition: "晴", tempC: 26, feelsLikeC: 29 },
    airQuality: { aqi: 48, level: "Good" },
    libraryStatus: "Main Hall: Open",
  }, "verbose");

  assert.equal(snapshot.sourceStatus.weather, "provided");
  assert.equal(snapshot.sourceStatus.academicDay, "missing");
  assert.equal(snapshot.sourceStatus.libraryStatus, "provided");
  assert.match(service.toText(snapshot), /Weather at SUSTech: \[晴\] 26C/);
  assert.match(service.toText(snapshot), /Library: \[Main Hall: Open\]/);

  const record = service.toRecord(snapshot);
  assert.deepEqual(record.weather, { condition: "晴", tempC: 26, feelsLikeC: 29 });
  assert.deepEqual(record.airQuality, { aqi: 48, level: "Good" });
  assert.equal(record.libraryStatus, "Main Hall: Open");
});
