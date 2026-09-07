import assert from "node:assert/strict";
import test from "node:test";
import { gradesBySemester, summariseGrades } from "../tis/academics.js";
import { normaliseExam, normaliseGrade, normalisePersonalScheduleEntry } from "../tis/normalise.js";

test("academic records are normalized into stable Agent-facing fields", () => {
  const grade = normaliseGrade({
    kcdm: "CS101",
    kcmc: "程序设计基础",
    kcmc_en: "Introduction to Programming",
    xnxqmc: "2025秋季",
    xf: "3",
    xscj: "A",
    zzcj: "93",
    kcxz: "必修",
    yxmc: "计算机科学与工程系",
  });
  assert.deepEqual(grade, {
    code: "CS101",
    name: "程序设计基础",
    nameEn: "Introduction to Programming",
    semester: "2025秋季",
    credits: 3,
    letterGrade: "A",
    numericScore: 93,
    nature: "必修",
    department: "计算机科学与工程系",
    gpaPoints: 3.94,
  });

  const exam = normaliseExam({
    KCDM: "CS101",
    KCMC: "程序设计基础",
    KSRQ: "2026-01-10",
    XQJMC: "星期六",
    KSJTSJ: "10:00-11:45",
    KSJC: "3",
    JSJC: "4",
    JXLMC: "一教",
    JXCDMC: "101",
  });
  assert.equal(exam.periodStart, 3);
  assert.equal(exam.room, "101");

  const schedule = normalisePersonalScheduleEntry({
    RWH: "2025-2026-1-CS101-001",
    KEY: "xq2_jc3",
    KCDM: "CS101",
    KCMC: "程序设计基础",
    KSJC: "3",
    JSJC: "4",
    ZC: "011010",
  });
  assert.equal(schedule.day, 2);
  assert.deepEqual(schedule.weeks, [1, 2, 4]);

  const fallback = normalisePersonalScheduleEntry({
    KEY: "xq5_jc9",
    KCWZSM: "写作课",
    SKSJ: "写作课\n周五晚上",
    ZC: "1",
  });
  assert.equal(fallback.courseName, "写作课");
  assert.equal(fallback.periodStart, 9);
  assert.equal(fallback.periodEnd, 9);
  assert.deepEqual(fallback.weeks, []);
});

test("GPA summaries use credit-weighted SUSTech grade points", () => {
  const grades = [
    normaliseGrade({ kcdm: "A", xnxqmc: "2025秋季", xf: 3, xscj: "A" }),
    normaliseGrade({ kcdm: "B", xnxqmc: "2025秋季", xf: 1, xscj: "B" }),
    normaliseGrade({ kcdm: "P", xnxqmc: "2025春季", xf: 2, xscj: "P" }),
  ];
  assert.deepEqual(summariseGrades(grades), { gpa: 3.843, credits: 4, courseCount: 2 });
  assert.deepEqual(gradesBySemester(grades), {
    "2025春季": { gpa: 0, credits: 0, courseCount: 0 },
    "2025秋季": { gpa: 3.843, credits: 4, courseCount: 2 },
  });
});
