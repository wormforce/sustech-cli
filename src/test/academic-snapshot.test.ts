import assert from "node:assert/strict";
import { chmod, lstat, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  comparableAcademicSnapshotSourceCount,
  diffAcademicSnapshotChanges,
  evaluateAcademicSnapshotWatch,
  formatAcademicSnapshotChanges,
  formatAcademicSnapshotWatch,
  summarizeAcademicSnapshotDiff,
} from "../academic/changes.js";
import {
  academicSnapshotSource,
  buildAcademicSnapshot,
  diffAcademicSnapshots,
  loadAcademicSnapshot,
  saveAcademicSnapshot,
} from "../academic/snapshot.js";
import { CliError } from "../core/errors.js";

test("academic snapshots save exclusively, use private permissions, and verify their digest", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sustech-academic-snapshot-"));
  const destination = join(directory, "snapshot.json");
  const snapshot = buildAcademicSnapshot({
    semester: "2026-2027-1",
    generatedAt: "2026-08-27T00:00:00.000Z",
    sources: {
      schedule: academicSnapshotSource([{ rwh: "R1", courseCode: "CS101", room: "一教101" }]),
      grades: academicSnapshotSource([]),
      exams: academicSnapshotSource([]),
    },
  });

  try {
    assert.equal(await saveAcademicSnapshot(destination, snapshot), destination);
    const metadata = await lstat(destination);
    assert.equal(metadata.isFile(), true);
    if (process.platform !== "win32") assert.equal(metadata.mode & 0o777, 0o600);
    assert.deepEqual(await loadAcademicSnapshot(destination), snapshot);

    await assert.rejects(
      saveAcademicSnapshot(destination, snapshot),
      (error: unknown) => error instanceof CliError && error.code === "ACADEMIC_SNAPSHOT_EXISTS",
    );

    const tampered = JSON.parse(await readFile(destination, "utf8")) as Record<string, unknown>;
    tampered.semester = "2026-2027-2";
    await writeFile(destination, JSON.stringify(tampered), "utf8");
    await assert.rejects(
      loadAcademicSnapshot(destination),
      (error: unknown) => error instanceof CliError && error.code === "ACADEMIC_SNAPSHOT_INVALID",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("academic snapshot destinations reject symbolic links and support explicit overwrite", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sustech-academic-snapshot-path-"));
  const snapshot = buildAcademicSnapshot({
    semester: "2026-2027-1",
    sources: { schedule: academicSnapshotSource([]) },
  });
  const destination = join(directory, "snapshot.json");
  const target = join(directory, "target.json");
  const linkPath = join(directory, "link.json");

  try {
    await writeFile(destination, "old", "utf8");
    await saveAcademicSnapshot(destination, snapshot, { overwrite: true });
    assert.deepEqual(await loadAcademicSnapshot(destination), snapshot);

    await writeFile(target, "protected", "utf8");
    await symlink(target, linkPath);
    await assert.rejects(
      saveAcademicSnapshot(linkPath, snapshot, { overwrite: true }),
      (error: unknown) => error instanceof CliError && error.code === "UNSAFE_LOCAL_PATH",
    );
    assert.equal(await readFile(target, "utf8"), "protected");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("academic snapshot diff distinguishes changes from additions and never compares partial sources", () => {
  const before = buildAcademicSnapshot({
    semester: "2026-2027-1",
    generatedAt: "2026-08-27T00:00:00.000Z",
    sources: {
      schedule: academicSnapshotSource([{ rwh: "R1", courseCode: "CS101", room: "一教101" }]),
      grades: academicSnapshotSource([
        { semester: "2026-2027-1", code: "MA101", letterGrade: "A" },
        { semester: "2026-2027-1", code: "PHY101", name: "Physics", letterGrade: "B" },
      ]),
      blackboardDeadlines: academicSnapshotSource(
        [{ courseId: "C1", columnId: "D1", title: "HW" }],
        { status: "partial", failures: [{ code: "COURSE_READ_FAILED", message: "one course unavailable" }] },
      ),
    },
  });
  const after = buildAcademicSnapshot({
    semester: "2026-2027-1",
    generatedAt: "2026-08-28T00:00:00.000Z",
    sources: {
      schedule: academicSnapshotSource([{ rwh: "R1", courseCode: "CS101", room: "一教102" }]),
      grades: academicSnapshotSource([
        { semester: "2026-2027-1", code: "MA101", letterGrade: "A" },
        { semester: "2026-2027-1", code: "CS101", letterGrade: "A-" },
      ]),
      blackboardDeadlines: academicSnapshotSource([{ courseId: "C1", columnId: "D1", title: "HW" }]),
    },
  });

  const diff = diffAcademicSnapshots(before, after);
  assert.equal(diff.sameSemester, true);
  assert.equal(diff.sources.schedule?.changed.length, 1);
  assert.equal(diff.sources.grades?.added.length, 1);
  assert.equal(diff.sources.grades?.removed.length, 1);
  assert.equal(diff.sources.grades?.unchanged, 1);
  assert.equal(diff.sources.blackboardDeadlines?.comparable, false);
  assert.equal(diff.summary.changed, 1);
  assert.equal(diff.summary.added, 1);
  assert.equal(diff.summary.removed, 1);
  assert.equal(diff.summary.unavailableSources, 1);
  assert.equal(diff.summary.hasChanges, true);

  const changes = summarizeAcademicSnapshotDiff(diff);
  assert.equal(changes.state, "partial");
  assert.equal(changes.summary.hasChanges, true);
  assert.equal(changes.summary.complete, false);
  assert.equal(changes.summary.noChangesConfirmed, false);
  assert.equal(changes.sources.blackboardDeadlines?.state, "unavailable");
  assert.deepEqual(changes.sources.blackboardDeadlines?.changes, []);
  assert.match(changes.sources.grades?.changes[0]?.description ?? "", /Grade record added: CS101/);
  assert.match(changes.sources.grades?.changes[1]?.description ?? "", /Grade record removed: PHY101 · Physics/);
});

test("academic change summaries cover timetable, grades, exams, and deadlines with readable serializable entries", () => {
  const before = buildAcademicSnapshot({
    semester: "2026-2027-1",
    generatedAt: "2026-08-27T00:00:00.000Z",
    sources: {
      schedule: academicSnapshotSource([{
        rwh: "R1",
        key: "xq1_jc1",
        courseCode: "CS101",
        courseName: "Programming",
        room: "一教101",
        teacher: "Teacher A",
        day: 1,
        periodStart: 1,
        periodEnd: 2,
        weeks: [1, 2, 3],
      }]),
      grades: academicSnapshotSource([{
        semester: "2026-2027-1",
        code: "MA101",
        name: "Calculus",
        letterGrade: "B+",
        numericScore: 87,
        gpaPoints: 3.6,
      }]),
      exams: academicSnapshotSource([{
        semester: "2026-2027-1",
        code: "PHY101",
        name: "Physics",
        type: "Final",
        date: "2027-01-05",
        weekday: "Tuesday",
        weekdayEn: "Tuesday",
        time: "09:00-11:00",
        building: "一教",
        room: "201",
      }]),
      blackboardDeadlines: academicSnapshotSource([
        {
          courseId: "C1",
          columnId: "D1",
          courseCode: "CS101",
          courseName: "Programming",
          title: "Project",
          dueAt: "2026-09-10T12:00:00.000Z",
          daysLeft: 14,
          availability: "Yes",
        },
        {
          courseId: "C1",
          columnId: "D2",
          courseCode: "CS101",
          courseName: "Programming",
          title: "Reading",
          dueAt: "2026-09-03T12:00:00.000Z",
          daysLeft: 7,
          availability: "Yes",
        },
      ]),
    },
  });
  const after = buildAcademicSnapshot({
    semester: "2026-2027-1",
    generatedAt: "2026-08-28T00:00:00.000Z",
    sources: {
      schedule: academicSnapshotSource([{
        rwh: "R1",
        key: "xq1_jc1",
        courseCode: "CS101",
        courseName: "Programming",
        room: "一教102",
        teacher: "Teacher A",
        day: 1,
        periodStart: 1,
        periodEnd: 2,
        weeks: [1, 2, 3],
      }]),
      grades: academicSnapshotSource([{
        semester: "2026-2027-1",
        code: "MA101",
        name: "Calculus",
        letterGrade: "A-",
        numericScore: 90,
        gpaPoints: 3.7,
      }]),
      exams: academicSnapshotSource([{
        semester: "2026-2027-1",
        code: "PHY101",
        name: "Physics",
        type: "Final",
        date: "2027-01-05",
        weekday: "周二",
        weekdayEn: "Tue",
        time: "14:00-16:00",
        building: "一教",
        room: "202",
      }]),
      blackboardDeadlines: academicSnapshotSource([
        {
          courseId: "C1",
          columnId: "D1",
          courseCode: "CS101",
          courseName: "Programming",
          title: "Project",
          dueAt: "2026-09-11T12:00:00.000Z",
          daysLeft: 14,
          availability: "Yes",
        },
        {
          courseId: "C1",
          columnId: "D2",
          courseCode: "CS101",
          courseName: "Programming",
          title: "Reading",
          dueAt: "2026-09-03T12:00:00.000Z",
          daysLeft: 6,
          availability: "Yes",
        },
      ]),
    },
  });

  const diff = diffAcademicSnapshots(before, after);
  assert.equal(diff.sources.blackboardDeadlines?.changed.length, 1);
  assert.equal(diff.sources.blackboardDeadlines?.unchanged, 1, "daysLeft alone must not create a change");

  const changes = diffAcademicSnapshotChanges(before, after);
  assert.equal(changes.state, "changed");
  assert.equal(changes.summary.complete, true);
  assert.equal(changes.summary.changedSources, 4);
  assert.equal(changes.summary.totalChanges, 4);
  assert.equal(changes.summary.noChangesConfirmed, false);
  assert.equal(changes.sources.schedule?.changes[0]?.title, "CS101 · Programming");
  assert.match(changes.sources.schedule?.changes[0]?.description ?? "", /room 一教101 → 一教102/);
  assert.match(changes.sources.grades?.changes[0]?.description ?? "", /grade B\+ → A-/);
  assert.match(changes.sources.exams?.changes[0]?.description ?? "", /time 09:00-11:00 → 14:00-16:00/);
  assert.match(changes.sources.blackboardDeadlines?.changes[0]?.description ?? "", /due 2026-09-10T12:00:00.000Z → 2026-09-11T12:00:00.000Z/);
  assert.deepEqual(JSON.parse(JSON.stringify(changes)), changes);

  const summaryText = formatAcademicSnapshotChanges(changes);
  assert.match(summaryText, /State: changed · 4 verified change\(s\)/);
  assert.match(summaryText, /Timetable entry changed: CS101 · Programming/);
  assert.match(summaryText, /Grade record changed: MA101 · Calculus/);
});

test("academic change tracking fails closed across semesters and never confirms no-change for partial input", () => {
  const before = buildAcademicSnapshot({
    semester: "2026-2027-1",
    generatedAt: "2026-08-27T00:00:00.000Z",
    sources: {
      grades: academicSnapshotSource([{ semester: "2026-2027-1", code: "CS101", letterGrade: "A" }]),
      exams: academicSnapshotSource([], {
        status: "partial",
        failures: [{ code: "EXAMS_PARTIAL", message: "one endpoint unavailable" }],
      }),
    },
  });
  const partialAfter = buildAcademicSnapshot({
    semester: "2026-2027-1",
    generatedAt: "2026-08-28T00:00:00.000Z",
    sources: {
      grades: academicSnapshotSource([{ semester: "2026-2027-1", code: "CS101", letterGrade: "A" }]),
      exams: academicSnapshotSource([]),
    },
  });
  const partial = diffAcademicSnapshotChanges(before, partialAfter);
  assert.equal(partial.state, "partial");
  assert.equal(partial.summary.hasChanges, false);
  assert.equal(partial.summary.noChangesConfirmed, false);
  assert.equal(partial.sources.grades?.state, "unchanged");
  assert.equal(partial.sources.exams?.state, "unavailable");

  const nextSemester = buildAcademicSnapshot({
    semester: "2026-2027-2",
    generatedAt: "2027-02-01T00:00:00.000Z",
    sources: {
      grades: academicSnapshotSource([{ semester: "2026-2027-2", code: "CS101", letterGrade: "A" }]),
    },
  });
  const crossSemester = diffAcademicSnapshotChanges(before, nextSemester);
  assert.equal(crossSemester.state, "partial");
  assert.equal(crossSemester.summary.comparableSources, 0);
  assert.equal(crossSemester.summary.totalChanges, 0);
  assert.equal(crossSemester.summary.noChangesConfirmed, false);
  assert.deepEqual(crossSemester.changes, []);
  assert.match(formatAcademicSnapshotChanges(crossSemester), /different semesters/);
});

test("academic watch creates a first baseline, preserves partial no-comparison state, and supports explicit reset", () => {
  const baseline = buildAcademicSnapshot({
    semester: "2026-2027-1",
    generatedAt: "2026-08-27T00:00:00.000Z",
    sources: {
      grades: academicSnapshotSource([{ semester: "2026-2027-1", code: "CS101", letterGrade: "A" }]),
      exams: academicSnapshotSource([], {
        status: "partial",
        failures: [{ code: "EXAMS_PARTIAL", message: "one endpoint unavailable" }],
      }),
    },
  });
  const firstRun = evaluateAcademicSnapshotWatch(undefined, baseline);
  assert.equal(firstRun.state, "baseline-created");
  assert.equal(firstRun.noComparison, true);
  assert.equal(firstRun.comparisonAvailable, false);
  assert.equal(firstRun.baselineUpdated, true);
  assert.match(formatAcademicSnapshotWatch(firstRun, "/tmp/academic-state.json"), /Baseline created/);

  const noComparable = evaluateAcademicSnapshotWatch(
    baseline,
    buildAcademicSnapshot({
      semester: "2026-2027-2",
      generatedAt: "2027-02-01T00:00:00.000Z",
      sources: {
        grades: academicSnapshotSource([{ semester: "2026-2027-2", code: "CS101", letterGrade: "A" }]),
      },
    }),
  );
  assert.equal(noComparable.state, "partial");
  assert.equal(noComparable.noComparison, false);
  assert.equal(noComparable.comparisonAvailable, false);
  assert.equal(noComparable.baselineUpdated, false);
  assert.equal(noComparable.changes?.summary.comparableSources, 0);
  assert.match(formatAcademicSnapshotWatch(noComparable, "/tmp/academic-state.json"), /left unchanged because no complete source was comparable/);

  const changed = evaluateAcademicSnapshotWatch(
    baseline,
    buildAcademicSnapshot({
      semester: "2026-2027-1",
      generatedAt: "2026-08-28T00:00:00.000Z",
      sources: {
        grades: academicSnapshotSource([{ semester: "2026-2027-1", code: "CS101", letterGrade: "A-" }]),
        exams: academicSnapshotSource([]),
      },
    }),
  );
  assert.equal(changed.state, "partial");
  assert.equal(changed.comparisonAvailable, true);
  assert.equal(changed.baselineUpdated, true);
  assert.equal(changed.changes?.summary.totalChanges, 1);

  const reset = evaluateAcademicSnapshotWatch(baseline, baseline, { overwrite: true });
  assert.equal(reset.state, "baseline-reset");
  assert.equal(reset.noComparison, true);
  assert.equal(reset.baselineUpdated, true);
  assert.match(formatAcademicSnapshotWatch(reset, "/tmp/academic-state.json"), /explicitly reset/);
});

test("academic watch baseline seeding only treats complete sources as comparable", () => {
  const comparable = buildAcademicSnapshot({
    semester: "2026-2027-1",
    sources: {
      grades: academicSnapshotSource([{ semester: "2026-2027-1", code: "CS101", letterGrade: "A" }]),
      exams: academicSnapshotSource([], {
        status: "partial",
        failures: [{ code: "EXAMS_PARTIAL", message: "one endpoint unavailable" }],
      }),
    },
  });
  const partialOnly = buildAcademicSnapshot({
    semester: "2026-2027-1",
    sources: {
      exams: academicSnapshotSource([], {
        status: "partial",
        failures: [{ code: "EXAMS_PARTIAL", message: "one endpoint unavailable" }],
      }),
    },
  });

  assert.equal(comparableAcademicSnapshotSourceCount(comparable), 1);
  assert.equal(comparableAcademicSnapshotSourceCount(partialOnly), 0);
});

test("academic snapshot loader rejects oversized files before parsing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sustech-academic-snapshot-large-"));
  const destination = join(directory, "large.json");
  try {
    await writeFile(destination, "{}", "utf8");
    if (process.platform !== "win32") await chmod(destination, 0o600);
    // A sparse extension exercises the metadata limit without allocating a large fixture.
    const handle = await import("node:fs/promises").then(({ open }) => open(destination, "r+"));
    await handle.truncate(16 * 1024 * 1024 + 1);
    await handle.close();
    await assert.rejects(
      loadAcademicSnapshot(destination),
      (error: unknown) => error instanceof CliError && error.code === "ACADEMIC_SNAPSHOT_TOO_LARGE",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
