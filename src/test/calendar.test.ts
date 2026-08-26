import assert from "node:assert/strict";
import test from "node:test";
import { AcademicCalendar, CalendarClient } from "../calendar/client.js";
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
      compensatories: [
        { date: "2026-02-28", week_type: "odd", workday_type: "Monday" },
        { date: "2026-05-09", week_type: "odd", workday_type: "Tuesday" },
      ],
    },
    summer_semester: { start: "2026-06-29", end: "2026-08-07" },
    fall_semester: {
      start: "2026-09-01",
      end: "2027-01-11",
      sign_in: "2026-09-04",
      teaching_start: "2026-09-07",
      freshman_arrival: "2026-08-17",
      total_teaching_weeks: 18,
      midterm: { start: "2026-10-26", end: "2026-11-08", equivalent_weeks: [8, 9] },
      final: { start: "2026-12-28", end: "2027-01-08", equivalent_weeks: [17, 18] },
      compensatories: [
        { date: "2026-09-20", week_type: "odd", workday_type: "Friday" },
        { date: "2026-10-10", week_type: "odd", workday_type: "Wednesday" },
      ],
      extra_breaks: ["2026-11-20"],
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
    summer_semester: { start: "2026-06-29", end: "2026-08-07" },
    fall_semester: {
      start: "2026-09-01",
      end: "2027-01-11",
      sign_in: "2026-09-04",
      teaching_start: "2026-09-07",
      freshman_arrival: "2026-08-25",
      total_teaching_weeks: 18,
      midterm: { start: "2026-10-26", end: "2026-11-08", equivalent_weeks: [8, 9] },
      final: { start: "2026-12-28", end: "2027-01-08", equivalent_weeks: [17, 18] },
      compensatories: [],
    },
  },
  general: {
    holidays: [
      { name: "New Year's Day", start: "2026-01-01", end: "2026-01-01" },
      { name: "Labor Day", start: "2026-05-01", end: "2026-05-05" },
      { name: "National Day", start: "2026-10-01", end: "2026-10-07" },
    ],
  },
};

test("calendar client loads all three JSON payloads and omits summer when the term is minimal", async () => {
  await withFetch(async (url) => {
    if (url.endsWith("/undergraduate.json")) return jsonResponse(PAYLOADS.undergraduate);
    if (url.endsWith("/graduate.json")) return jsonResponse(PAYLOADS.graduate);
    assert.ok(url.endsWith("/general.json"));
    return jsonResponse(PAYLOADS.general);
  }, async () => {
    const calendar = await new CalendarClient().loadYear(2026);
    assert.equal(calendar.level, "undergraduate");
    assert.equal(calendar.spring.snapshot.humanName, "2026 Spring");
    assert.equal(calendar.summer, undefined);
    assert.equal(calendar.fall.snapshot.semester.value, "2026-2027-1");
  });
});

test("calendar term performs week and date math on the Monday-anchored teaching grid", () => {
  const calendar = AcademicCalendar.fromPayloads(2026, "undergraduate", PAYLOADS);
  assert.equal(calendar.spring.dateOf(1, 0), "2026-02-23");
  assert.equal(calendar.spring.dateOf(2, 4), "2026-03-06");
  assert.equal(calendar.spring.weekOf("2026-02-25"), 1);
  assert.equal(calendar.spring.weekOf("2026-03-25"), 5);
  assert.equal(calendar.spring.weekOf("2026-06-22"), 0);
});

test("calendar day classification preserves holidays, finals, compensatory days, and extra breaks", () => {
  const calendar = AcademicCalendar.fromPayloads(2026, "undergraduate", PAYLOADS);

  const holiday = calendar.day("2026-05-01");
  assert.equal(holiday.holiday?.name, "Labor Day");
  assert.equal(holiday.flags.isTeachingDay, false);

  const compensatory = calendar.day("2026-02-28");
  assert.equal(compensatory.compensatory?.workday, "Monday");
  assert.equal(compensatory.flags.hasClass, true);
  assert.equal(compensatory.flags.isTeachingDay, false);

  const finals = calendar.day("2026-06-10");
  assert.equal(finals.flags.isFinal, true);
  assert.equal(finals.flags.hasClass, false);

  const extraBreak = calendar.day("2026-11-20");
  assert.equal(extraBreak.flags.isExtraBreak, true);
  assert.equal(extraBreak.flags.isTeachingDay, false);
});

test("calendar exposes holidays even when the date is outside a loaded semester", () => {
  const calendar = AcademicCalendar.fromPayloads(2026, "undergraduate", PAYLOADS);
  const day = calendar.day("2026-01-01");
  assert.equal(day.week, 0);
  assert.equal(day.holiday?.name, "New Year's Day");
  assert.equal(day.flags.isHoliday, true);
  assert.equal(day.semester, undefined);
});

async function withFetch(
  implementation: (url: string) => Promise<Response>,
  action: () => Promise<void>,
): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => implementation(String(input))) as typeof fetch;
  try {
    await action();
  } finally {
    globalThis.fetch = original;
  }
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
