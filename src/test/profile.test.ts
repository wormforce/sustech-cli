import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CliError } from "../core/errors.js";
import { formatStudentProfile } from "../core/text.js";
import { parseSemester } from "../core/semester.js";
import {
  collectStudentProfile,
  saveStudentProfile,
  tisIdentityFromUserMe,
  type StudentProfileReport,
} from "../profile/report.js";

test("profile collection keeps only whitelisted identity fields and masks the student id", async () => {
  const report = await collectStudentProfile({
    semester: parseSemester("2026-2027-1"),
    generatedAt: "2026-08-26T10:00:00+08:00",
    loadTisUserMe: async () => ({
      studentId: "12410000",
      name: "Test Student",
      department: "Computer Science",
      pylx: "Undergraduate",
      id: "internal-user-id",
      email: "student@sustech.edu.cn",
    }),
    loadCurrentCourses: async () => ([
      { rwh: "R1", key: "1", courseCode: "CS101", courseName: "A", teacher: "", room: "", description: "", descriptionEn: "", weeks: [1] },
      { rwh: "R1", key: "2", courseCode: "CS101", courseName: "A", teacher: "", room: "", description: "", descriptionEn: "", weeks: [1] },
      { rwh: "", key: "3", courseCode: "MA101", courseName: "B", teacher: "", room: "", description: "", descriptionEn: "", weeks: [1] },
      { rwh: "", key: "4", courseCode: "MA101", courseName: "B", teacher: "", room: "", description: "", descriptionEn: "", weeks: [1] },
      { rwh: "", key: "5", courseCode: "", courseName: "Unknown", teacher: "", room: "", description: "", descriptionEn: "", weeks: [1] },
    ]),
    loadExams: async () => [],
    loadBlackboardDeadlines: async () => ({
      generatedAt: "2026-08-26T10:00:00.000Z",
      coursesMatched: 0,
      coursesScanned: 0,
      deadlines: [],
      failures: [],
    }),
  });

  assert.deepEqual(report.identity, {
    studentIdMasked: "12****00",
    name: "Test Student",
    department: "Computer Science",
    studentType: "Undergraduate",
  });
  assert.equal("id" in (report.identity ?? {}), false);
  assert.equal("email" in (report.identity ?? {}), false);
  assert.equal(report.academics.currentCourses?.courseCount, 2);
  assert.equal(report.academics.currentCourses?.sourceRows, 5);
  assert.equal(report.academics.currentCourses?.omittedRows, 1);
  assert.equal(report.sources.tisCurrentCourses.status, "partial");
  assert.equal(report.sources.tisCurrentCourses.failures[0]?.code, "COURSE_IDENTITY_UNKNOWN");
});

test("profile identity parser does not treat internal TIS codes as student ids", () => {
  const identity = tisIdentityFromUserMe({
    yhdm: "internal-code",
    id: "internal-id",
    sid: "12410000",
    studentId: "",
    name: "Test Student",
    department: "Computer Science",
    pylx: "Undergraduate",
  });
  assert.deepEqual(identity, {
    name: "Test Student",
    department: "Computer Science",
    studentType: "Undergraduate",
  });
});

test("profile collection chooses the next future exam and omits same-day or future unknown-time exams conservatively", async () => {
  const report = await collectStudentProfile({
    semester: parseSemester("2026-2027-1"),
    generatedAt: "2026-08-26T10:00:00+08:00",
    loadTisUserMe: async () => ({ studentId: "12410000" }),
    loadCurrentCourses: async () => [],
    loadExams: async () => ([
      {
        code: "CS101",
        name: "Programming",
        date: "2026-08-26",
        weekday: "Wed",
        weekdayEn: "Wed",
        time: "",
        building: "一教",
        room: "101",
        campus: "SUSTech",
        type: "Final",
        semester: "2026秋季",
      },
      {
        code: "MA101",
        name: "Calculus",
        date: "2026-08-26",
        weekday: "Wed",
        weekdayEn: "Wed",
        time: "08:00-09:00",
        building: "一教",
        room: "102",
        campus: "SUSTech",
        type: "Final",
        semester: "2026秋季",
      },
      {
        code: "PH101",
        name: "Physics",
        date: "2026-08-27",
        weekday: "Thu",
        weekdayEn: "Thu",
        time: "",
        building: "二教",
        room: "201",
        campus: "SUSTech",
        type: "Final",
        semester: "2026秋季",
      },
      {
        code: "EE101",
        name: "Circuits",
        date: "2026-08-27",
        weekday: "Thu",
        weekdayEn: "Thu",
        time: "15:00-17:00",
        building: "二教",
        room: "202",
        campus: "SUSTech",
        type: "Final",
        semester: "2026秋季",
      },
    ]),
    loadBlackboardDeadlines: async () => ({
      generatedAt: "2026-08-26T10:00:00.000Z",
      coursesMatched: 0,
      coursesScanned: 0,
      deadlines: [],
      failures: [],
    }),
  });

  assert.equal(report.sources.tisNextExam.status, "partial");
  assert.equal(report.academics.nextExam?.code, "EE101");
  assert.equal(report.academics.nextExam?.date, "2026-08-27");
  assert.equal(report.sources.tisNextExam.failures[0]?.code, "EXAM_TIME_UNKNOWN_TODAY");
  assert.equal(report.sources.tisNextExam.failures[1]?.code, "EXAM_TIME_UNKNOWN");
});

test("profile source failures redact secrets before surfacing them", async () => {
  const report = await collectStudentProfile({
    semester: parseSemester("2026-2027-1"),
    loadTisUserMe: async () => { throw new Error("token=secret password=also-secret cookie=abc authorization=bearer"); },
    loadCurrentCourses: async () => [],
    loadExams: async () => [],
    loadBlackboardDeadlines: async () => ({
      generatedAt: "2026-08-26T10:00:00.000Z",
      coursesMatched: 0,
      coursesScanned: 0,
      deadlines: [],
      failures: [],
    }),
  });

  const message = report.sources.tisIdentity.failures[0]?.message ?? "";
  assert.doesNotMatch(message, /secret|also-secret|abc|bearer/);
  assert.match(message, /token=\[redacted\]/);
  assert.match(message, /password=\[redacted\]/);
  assert.match(message, /cookie=\[redacted\]/);
  assert.match(message, /authorization=\[redacted\]/);
});

test("profile exports save exclusively, keep private permissions, and reject symbolic links", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sustech-profile-"));
  const destination = join(directory, "profile.json");
  const target = join(directory, "target.json");
  const linkPath = join(directory, "link.json");
  const brokenLinkPath = join(directory, "broken-link.json");
  const parentTarget = join(directory, "parent-target");
  const parentLink = join(directory, "parent-link");
  const nestedDestination = join(parentLink, "nested.json");
  const report = sampleReport();

  try {
    assert.equal(await saveStudentProfile(destination, report), destination);
    const metadata = await lstat(destination);
    assert.equal(metadata.mode & 0o777, 0o600);
    const loaded = JSON.parse(await readFile(destination, "utf8")) as StudentProfileReport;
    assert.equal(loaded.kind, report.kind);
    assert.equal(loaded.schemaVersion, report.schemaVersion);

    await assert.rejects(
      saveStudentProfile(destination, report),
      (error: unknown) => error instanceof CliError && error.code === "PROFILE_EXPORT_EXISTS",
    );

    await writeFile(target, "protected", "utf8");
    await symlink(target, linkPath);
    await symlink(join(directory, "missing-target.json"), brokenLinkPath);
    await assert.rejects(
      saveStudentProfile(linkPath, report, { overwrite: true }),
      (error: unknown) => error instanceof CliError && error.code === "UNSAFE_LOCAL_PATH",
    );
    await assert.rejects(
      saveStudentProfile(linkPath, report),
      (error: unknown) => error instanceof CliError && error.code === "UNSAFE_LOCAL_PATH",
    );
    await assert.rejects(
      saveStudentProfile(brokenLinkPath, report),
      (error: unknown) => error instanceof CliError && error.code === "UNSAFE_LOCAL_PATH",
    );
    await mkdir(parentTarget);
    await symlink(parentTarget, parentLink);
    await assert.rejects(
      saveStudentProfile(nestedDestination, report),
      (error: unknown) => error instanceof CliError && error.code === "UNSAFE_LOCAL_PATH",
    );
    assert.equal(await readFile(target, "utf8"), "protected");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("profile text output states the guarded export format and source statuses", () => {
  const text = formatStudentProfile(sampleReport(), { path: "/tmp/profile.json" });
  assert.match(text, /Format: versioned JSON/);
  assert.match(text, /tisIdentity: ok/);
  assert.match(text, /blackboardNextDeadline: partial/);
});

test("user-me identity parser returns null when no whitelisted fields are present", () => {
  assert.equal(tisIdentityFromUserMe({ id: "internal-only", email: "student@sustech.edu.cn" }), null);
});

function sampleReport(): StudentProfileReport {
  return {
    schemaVersion: "1",
    kind: "sustech-student-profile",
    generatedAt: "2026-08-26T02:00:00.000Z",
    semester: "2026-2027-1",
    identity: {
      studentIdMasked: "12****00",
      name: "Test Student",
      department: "Computer Science",
      studentType: "Undergraduate",
    },
    academics: {
      currentCourses: {
        semester: "2026-2027-1",
        courseCount: 2,
        sourceRows: 3,
        omittedRows: 0,
      },
      nextExam: {
        semester: "2026秋季",
        code: "CS101",
        name: "Programming",
        date: "2026-09-01",
        time: "09:00-11:00",
        building: "一教",
        room: "101",
        campus: "SUSTech",
        type: "Final",
      },
      nextBlackboardDeadline: {
        courseCode: "CS101",
        courseName: "Programming",
        title: "HW1",
        dueAt: "2026-09-02T15:00:00Z",
        daysLeft: 7,
      },
    },
    sources: {
      tisIdentity: { status: "ok", data: { studentIdMasked: "12****00" }, failures: [] },
      tisCurrentCourses: {
        status: "ok",
        data: { semester: "2026-2027-1", courseCount: 2, sourceRows: 3, omittedRows: 0 },
        failures: [],
      },
      tisNextExam: {
        status: "ok",
        data: {
          semester: "2026秋季",
          code: "CS101",
          name: "Programming",
          date: "2026-09-01",
          time: "09:00-11:00",
        },
        failures: [],
      },
      blackboardNextDeadline: {
        status: "partial",
        data: {
          courseCode: "CS101",
          courseName: "Programming",
          title: "HW1",
          dueAt: "2026-09-02T15:00:00Z",
          daysLeft: 7,
        },
        failures: [{ code: "BLACKBOARD_DEADLINE_READ_FAILED", message: "one course was unavailable" }],
      },
    },
    summary: {
      okSources: 3,
      partialSources: 1,
      missingSources: 0,
      errorSources: 0,
    },
  };
}
