import assert from "node:assert/strict";
import { chmod, lstat, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
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
    assert.equal(metadata.mode & 0o777, 0o600);
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
      grades: academicSnapshotSource([{ semester: "2026-2027-1", code: "MA101", letterGrade: "A" }]),
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
  assert.equal(diff.sources.grades?.unchanged, 1);
  assert.equal(diff.sources.blackboardDeadlines?.comparable, false);
  assert.equal(diff.summary.changed, 1);
  assert.equal(diff.summary.added, 1);
  assert.equal(diff.summary.unavailableSources, 1);
  assert.equal(diff.summary.hasChanges, true);
});

test("academic snapshot loader rejects oversized files before parsing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sustech-academic-snapshot-large-"));
  const destination = join(directory, "large.json");
  try {
    await writeFile(destination, "{}", "utf8");
    await chmod(destination, 0o600);
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
