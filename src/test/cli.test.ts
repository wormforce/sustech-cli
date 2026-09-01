import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { academicSnapshotSource, buildAcademicSnapshot } from "../academic/snapshot.js";
import {
  buildBookingCreateApplyConfirmation,
  buildLibraryBookingCreateApplyConfirmation,
} from "../cli-confirmations.js";

const CLI_PATH = fileURLToPath(new URL("../cli.js", import.meta.url));

test("compiled CLI serves human text and versioned JSON from the real entrypoint", () => {
  const text = run(["version"]);
  assert.equal(text.status, 0);
  assert.match(text.stdout, /:\*##: :#######:/);
  assert.match(text.stdout, /sustech-cli 0\.10\.0/);
  assert.doesNotMatch(text.stdout, /\u001b\[/);

  const json = run(["version", "--json"]);
  assert.equal(json.status, 0);
  assert.deepEqual(JSON.parse(json.stdout), {
    schemaVersion: "1",
    ok: true,
    command: "version",
    data: { version: "0.10.0", runtime: `node ${process.version}` },
  });
});

test("bare invocation shows a local account dashboard while explicit help stays complete", () => {
  const welcome = runWithoutCredentials([]);
  assert.equal(welcome.status, 0);
  assert.match(welcome.stdout, /:\*##: :#######:/);
  assert.match(welcome.stdout, /Credentials  not configured/);
  assert.match(welcome.stdout, /sustech auth login/);
  assert.doesNotMatch(welcome.stdout, /Usage:/);

  const help = run(["--help"]);
  assert.equal(help.status, 0);
  assert.doesNotMatch(help.stdout, /:\*##: :#######:/);
  assert.match(help.stdout, /^sustech — SUSTech services/);
});

test("compiled CLI keeps parse and output-conflict errors machine-readable", () => {
  const invalid = run(["version", "--unknown", "--json"]);
  assert.equal(invalid.status, 2);
  assert.equal(JSON.parse(invalid.stdout).error.code, "USAGE");
  assert.equal(JSON.parse(invalid.stdout).command, "version");

  const conflict = run(["version", "--output", "jsonl", "--json"]);
  assert.equal(conflict.status, 2);
  const envelope = JSON.parse(conflict.stdout);
  assert.equal(envelope.ok, false);
  assert.equal(envelope.error.code, "OUTPUT_MODE_CONFLICT");
  assert.equal(envelope.command, "version");

  const irrelevant = run(["version", "--semester", "2025-2026-1", "--json"]);
  assert.equal(irrelevant.status, 2);
  assert.equal(JSON.parse(irrelevant.stdout).error.code, "USAGE");
  assert.match(JSON.parse(irrelevant.stdout).error.message, /not valid for 'version'/);

  const copiedFlag = run(["papers", "search", "ai", "--calendar-name", "wrong-command", "--json"]);
  assert.equal(copiedFlag.status, 2);
  assert.equal(JSON.parse(copiedFlag.stdout).error.code, "USAGE");
});

test("calendar and selection inputs reject normalized or silently-coerced values", () => {
  const invalidDate = run(["calendar", "day", "2026-02-30", "--json"]);
  assert.equal(invalidDate.status, 2);
  assert.equal(JSON.parse(invalidDate.stdout).error.code, "USAGE");

  const invalidCultivation = run([
    "tis", "selection", "preview", "drop",
    "--course-id", "COURSE-1",
    "--cultivation", "graduate",
    "--json",
  ]);
  assert.equal(invalidCultivation.status, 2);
  assert.equal(JSON.parse(invalidCultivation.stdout).error.code, "USAGE");
});

test("online commands are registered and reject unsafe IDs before network access", () => {
  const unsafe = run(["online", "talks", "get", "%2F", "--json"]);
  assert.equal(unsafe.status, 2);
  assert.equal(JSON.parse(unsafe.stdout).command, "online talks get");
  assert.equal(JSON.parse(unsafe.stdout).error.code, "ONLINE_SOURCE_NOT_ALLOWED");

  const invalidDate = run(["online", "talks", "list", "--since", "2026-02-30", "--json"]);
  assert.equal(invalidDate.status, 2);
  assert.equal(JSON.parse(invalidDate.stdout).error.code, "USAGE");

  const described = run(["describe", "online", "talks", "search", "--json"]);
  assert.equal(described.status, 0);
  assert.equal(JSON.parse(described.stdout).data.command, "online talks search");
});

test("enrollment preview is a no-network command with an exact apply handoff", () => {
  const result = run([
    "tis", "enroll", "preview",
    "--semester", "2025-2026-1",
    "--course-id", "deadbeef",
    "--rwh", "2025-2026-1-CS101-001",
    "--round", "bxxk",
    "--bid", "2",
    "--json",
  ]);
  assert.equal(result.status, 0);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.data.mutation, false);
  assert.equal(envelope.data.target.courseId, "deadbeef");
  assert.match(envelope.data.confirmation.command, /--confirm$/);

  const unsafe = run([
    "tis", "enroll", "preview",
    "--course-id", "deadbeef;echo",
    "--rwh", "2025-2026-1-CS101-001",
    "--json",
  ]);
  assert.equal(unsafe.status, 2);
  assert.equal(JSON.parse(unsafe.stdout).error.code, "USAGE");
});

test("booking and library-booking create handoff commands preserve optional metadata and quote unsafe shell text", () => {
  const booking = buildBookingCreateApplyConfirmation({
    roomId: "ZC02",
    title: "mentor's sync",
    start: "2026-08-28T10:00:00",
    end: "2026-08-28T11:00:00",
    participants: 3,
    description: "bring slides",
  }, {
    credentialsFile: "/tmp/booking creds.txt",
    profile: "daily ops",
  });
  assert.deepEqual(booking.argv, [
    "sustech",
    "booking",
    "create",
    "apply",
    "--credentials-file",
    "/tmp/booking creds.txt",
    "--profile",
    "daily ops",
    "--room-id",
    "ZC02",
    "--start",
    "2026-08-28T10:00:00",
    "--end",
    "2026-08-28T11:00:00",
    "--title",
    "mentor's sync",
    "--participants",
    "3",
    "--description",
    "bring slides",
    "--confirm",
  ]);
  assert.match(booking.command, /^sustech booking create apply /);
  assert.match(booking.command, /--credentials-file '\/tmp\/booking creds\.txt'/);
  assert.match(booking.command, /--profile 'daily ops'/);
  assert.match(booking.command, /--title 'mentor'\\''s sync'/);
  assert.match(booking.command, /--description 'bring slides'/);
  assert.match(booking.command, /--confirm$/);

  const library = buildLibraryBookingCreateApplyConfirmation({
    classKind: 1,
    kindId: 4,
    labId: 9,
    devId: 13,
    title: "AI reading group",
    start: "2026-08-28T19:00:00",
    end: "2026-08-28T20:00:00",
    memberKind: 2,
    members: [12200000, 12200001, 12200002],
    memo: "bring poster draft",
  }, {});
  assert.ok(!library.argv.includes("--credentials-file"));
  assert.ok(!library.argv.includes("--profile"));
  assert.ok(!library.command.includes("--credentials-file"));
  assert.ok(!library.command.includes("--profile"));
  assert.match(library.command, /^sustech lib-booking create apply /);
  assert.match(library.command, /--member 12200000 --member 12200001 --member 12200002/);
  assert.match(library.command, /--memo 'bring poster draft'/);
  assert.match(library.command, /--confirm$/);
});

test("blackboard submission preview now requires Blackboard authentication after local file validation", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "sustech-cli-bb-"));
  const filePath = join(tempDir, "report final.pdf");
  writeFileSync(filePath, "%PDF-1.7\nmock", "utf8");

  try {
    const result = runWithoutCredentials([
      "bb", "submit", "preview",
      "--course-id", "_8537_1",
      "--content-id", "_629896_1",
      "--file", filePath,
      "--comment", "late upload note",
      "--json",
    ]);
    assert.equal(result.status, 2);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.error.code, "CREDENTIALS_REQUIRED");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("blackboard apply requires both the preview hash and explicit confirmation before authentication", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "sustech-cli-bb-apply-"));
  const filePath = join(tempDir, "answer.txt");
  const contents = "reviewed answer";
  writeFileSync(filePath, contents, "utf8");
  const sha256 = createHash("sha256").update(contents).digest("hex");
  const baseArgs = [
    "bb", "submit", "apply",
    "--course-id", "_8537_1",
    "--content-id", "_629896_1",
    "--file", filePath,
  ];

  try {
    const unconfirmed = runWithoutCredentials([...baseArgs, "--expected-sha256", sha256, "--json"]);
    assert.equal(unconfirmed.status, 3);
    assert.equal(JSON.parse(unconfirmed.stdout).error.code, "CONFIRMATION_REQUIRED");

    const mismatched = runWithoutCredentials([
      ...baseArgs,
      "--expected-sha256", "0".repeat(64),
      "--confirm",
      "--json",
    ]);
    assert.equal(mismatched.status, 4);
    assert.equal(JSON.parse(mismatched.stdout).error.code, "BLACKBOARD_FILE_HASH_MISMATCH");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("context accepts calendar-level and help documents it", () => {
  const invalid = run(["context", "--calendar-level", "doctoral", "--json"]);
  assert.equal(invalid.status, 2);
  const envelope = JSON.parse(invalid.stdout);
  assert.equal(envelope.command, "context");
  assert.equal(envelope.error.code, "USAGE");
  assert.match(envelope.error.message, /--calendar-level must be undergraduate or graduate/);

  const help = run(["--help"]);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /sustech describe COMMAND\.\.\. \[--json\|--jsonl\]/);
  assert.match(help.stdout, /sustech context \[--date YYYY-MM-DD\] \[--calendar-level undergraduate\|graduate\] \[--level terse\|normal\|verbose\] \[--live\] \[--credentials-file PATH\]/);
  assert.match(help.stdout, /sustech academic changes BEFORE AFTER/);
  assert.match(help.stdout, /sustech academic watch --state PATH \[--semester YYYY-YYYY-N\] \[--include-blackboard\] \[--overwrite\]/);
  assert.match(help.stdout, /sustech library search QUERY \[--limit N\] \[--browser \[--interactive\]\]/);
  assert.match(help.stdout, /sustech library detail CONTEXT:DOC_ID \[--browser \[--interactive\]\]/);
  assert.match(help.stdout, /sustech online talks search QUERY \[--since YYYY-MM-DD\] \[--until YYYY-MM-DD\] \[--limit N\]/);
  assert.match(help.stdout, /sustech tis plan explain COURSE_OR_RWH --round ROUND/);
  assert.match(help.stdout, /sustech tis plan recommend \[CODE\.\.\.\] --round ROUND/);
  assert.match(help.stdout, /sustech tis degree missing \[--semester YYYY-YYYY-N\]/);
});

test("describe exposes structured command metadata without parsing the full help text", () => {
  const result = run(["describe", "bb", "submit", "apply", "--json"]);
  assert.equal(result.status, 0);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.command, "describe");
  assert.equal(envelope.data.command, "bb submit apply");
  assert.equal(envelope.data.capability.kind, "mutation");
  assert.equal(envelope.data.capability.authentication, "bb");
  assert.ok(Array.isArray(envelope.data.usage));
  assert.ok(envelope.data.usage[0].startsWith("sustech bb submit apply"));
  assert.ok(envelope.data.options.some((entry: { name: string }) => entry.name === "--expected-sha256"));
  assert.ok(envelope.data.options.some((entry: { name: string; shared: boolean }) => entry.name === "--json" && entry.shared === true));
  assert.ok(envelope.data.consequences.some((entry: { operation: string }) => entry.operation === "blackboard.submit"));
});

test("describe exposes typed public library catalog reads", () => {
  const result = run(["describe", "library", "detail", "--json"]);
  assert.equal(result.status, 0);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.command, "describe");
  assert.equal(envelope.data.command, "library detail");
  assert.equal(envelope.data.capability.kind, "read");
  assert.equal(envelope.data.capability.authentication, "none");
  assert.ok(envelope.data.usage.some((entry: string) => entry.startsWith("sustech library detail ")));
  assert.ok(envelope.data.options.some((entry: { name: string }) => entry.name === "--browser"));
  assert.ok(envelope.data.options.some((entry: { name: string }) => entry.name === "--interactive"));
});

test("describe exposes academic watch safety metadata and local state options", () => {
  const result = run(["describe", "academic", "watch", "--json"]);
  assert.equal(result.status, 0);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.command, "describe");
  assert.equal(envelope.data.command, "academic watch");
  assert.equal(envelope.data.capability.kind, "mutation");
  assert.equal(envelope.data.capability.authentication, "sustech-cas");
  assert.ok(envelope.data.usage.some((entry: string) => entry.startsWith("sustech academic watch --state PATH")));
  assert.ok(envelope.data.options.some((entry: { name: string }) => entry.name === "--state"));
  assert.ok(envelope.data.options.some((entry: { name: string }) => entry.name === "--include-blackboard"));
  assert.ok(envelope.data.options.some((entry: { name: string }) => entry.name === "--overwrite"));
  assert.ok(envelope.data.consequences.some((entry: { operation: string }) => entry.operation === "academic.snapshot.save"));
});

test("describe exposes advisory TIS plan decision commands and their live-read options", () => {
  const result = run(["describe", "tis", "plan", "recommend", "--json"]);
  assert.equal(result.status, 0);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.data.command, "tis plan recommend");
  assert.equal(envelope.data.capability.kind, "plan");
  assert.equal(envelope.data.capability.authentication, "tis");
  assert.ok(envelope.data.options.some((entry: { name: string }) => entry.name === "--round"));
  assert.ok(envelope.data.options.some((entry: { name: string }) => entry.name === "--max"));
});

test("blackboard content attachment commands keep selection and local writes explicit", () => {
  const list = runWithoutCredentials(["bb", "attachments", "_8537_1", "_629896_1", "--json"]);
  assert.equal(list.status, 2);
  assert.equal(JSON.parse(list.stdout).command, "bb attachments");
  assert.equal(JSON.parse(list.stdout).error.code, "CREDENTIALS_REQUIRED");

  const deadlines = runWithoutCredentials(["bb", "deadlines", "--json"]);
  assert.equal(deadlines.status, 2);
  assert.equal(JSON.parse(deadlines.stdout).command, "bb deadlines");
  assert.equal(JSON.parse(deadlines.stdout).error.code, "CREDENTIALS_REQUIRED");

  const missingDestination = runWithoutCredentials([
    "bb", "download", "_8537_1", "_629896_1", "_42588_1", "--json",
  ]);
  assert.equal(missingDestination.status, 2);
  assert.equal(JSON.parse(missingDestination.stdout).command, "bb download");
  assert.equal(JSON.parse(missingDestination.stdout).error.code, "USAGE");
  assert.match(JSON.parse(missingDestination.stdout).error.message, /--destination/);

  const irrelevantOverwrite = runWithoutCredentials([
    "bb", "attachments", "_8537_1", "_629896_1", "--overwrite", "--json",
  ]);
  assert.equal(irrelevantOverwrite.status, 2);
  assert.match(JSON.parse(irrelevantOverwrite.stdout).error.message, /not valid for 'bb attachments'/);

  const syncMissingDestination = runWithoutCredentials([
    "bb", "sync", "_8537_1", "--json",
  ]);
  assert.equal(syncMissingDestination.status, 2);
  assert.equal(JSON.parse(syncMissingDestination.stdout).command, "bb sync");
  assert.equal(JSON.parse(syncMissingDestination.stdout).error.code, "USAGE");

  const syncNeedsCredentials = runWithoutCredentials([
    "bb", "sync", "_8537_1", "--destination", "/tmp/bb-sync", "--json",
  ]);
  assert.equal(syncNeedsCredentials.status, 2);
  assert.equal(JSON.parse(syncNeedsCredentials.stdout).error.code, "CREDENTIALS_REQUIRED");
});

test("Blackboard calendar commands expose strict options without requiring credentials to validate input", () => {
  const calendar = runWithoutCredentials(["bb", "calendar", "--json"]);
  assert.equal(calendar.status, 2);
  assert.equal(JSON.parse(calendar.stdout).command, "bb calendar");
  assert.equal(JSON.parse(calendar.stdout).error.code, "CREDENTIALS_REQUIRED");

  const invalidType = runWithoutCredentials(["bb", "calendar", "--type", "Deadline", "--json"]);
  assert.equal(invalidType.status, 2);
  assert.equal(JSON.parse(invalidType.stdout).error.code, "USAGE");
  assert.match(JSON.parse(invalidType.stdout).error.message, /GradebookColumn/);

  const missingStdin = runWithoutCredentials(["bb", "calendar-link", "set", "--json"]);
  assert.equal(missingStdin.status, 2);
  assert.equal(JSON.parse(missingStdin.stdout).command, "bb calendar-link set");
  assert.equal(JSON.parse(missingStdin.stdout).error.code, "USAGE");

  const wrongProgressOption = runWithoutCredentials(["tis", "degree", "progress", "--semester", "2026-2027-1", "--json"]);
  assert.equal(wrongProgressOption.status, 2);
  assert.equal(JSON.parse(wrongProgressOption.stdout).command, "tis degree progress");
  assert.equal(JSON.parse(wrongProgressOption.stdout).error.code, "USAGE");

  const wrongMissingOption = runWithoutCredentials(["tis", "degree", "missing", "--details", "--json"]);
  assert.equal(wrongMissingOption.status, 2);
  assert.equal(JSON.parse(wrongMissingOption.stdout).command, "tis degree missing");
  assert.equal(JSON.parse(wrongMissingOption.stdout).error.code, "USAGE");
});

test("capabilities exposes safety metadata without requiring help-text parsing", () => {
  const result = run(["capabilities", "--json"]);
  assert.equal(result.status, 0);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.data.credentialStorage.profiles, true);
  assert.equal(envelope.data.credentialStorage.passwordArgument, false);
  assert.equal(typeof envelope.data.credentialStorage.backend.available, "boolean");
  const apply = envelope.data.capabilities.find((entry: { command: string }) => entry.command === "tis enroll apply");
  const preview = envelope.data.capabilities.find((entry: { command: string }) => entry.command === "tis enroll preview");
  const auth = envelope.data.capabilities.find((entry: { command: string }) => entry.command === "auth check");
  const authLogin = envelope.data.capabilities.find((entry: { command: string }) => entry.command === "auth login");
  const authStatus = envelope.data.capabilities.find((entry: { command: string }) => entry.command === "auth status");
  const authLogout = envelope.data.capabilities.find((entry: { command: string }) => entry.command === "auth logout");
  const bbApply = envelope.data.capabilities.find((entry: { command: string }) => entry.command === "bb submit apply");
  const bbPreview = envelope.data.capabilities.find((entry: { command: string }) => entry.command === "bb submit preview");
  const bbAttachments = envelope.data.capabilities.find((entry: { command: string }) => entry.command === "bb attachments");
  const bbDownload = envelope.data.capabilities.find((entry: { command: string }) => entry.command === "bb download");
  const selectionApply = envelope.data.capabilities.find((entry: { command: string }) => entry.command === "tis selection apply");
  const bidApply = envelope.data.capabilities.find((entry: { command: string }) => entry.command === "tis bid apply");
  const classroomLive = envelope.data.capabilities.find((entry: { command: string }) => entry.command === "tis classroom live");
  const classroomNow = envelope.data.capabilities.find((entry: { command: string }) => entry.command === "tis classroom now");
  const bbDeadlines = envelope.data.capabilities.find((entry: { command: string }) => entry.command === "bb deadlines");
  const bbCalendar = envelope.data.capabilities.find((entry: { command: string }) => entry.command === "bb calendar");
  const bbCalendarLinkShow = envelope.data.capabilities.find((entry: { command: string }) => entry.command === "bb calendar-link show");
  const bbCalendarLinkFetch = envelope.data.capabilities.find((entry: { command: string }) => entry.command === "bb calendar-link fetch");
  const bbSearch = envelope.data.capabilities.find((entry: { command: string }) => entry.command === "bb search");
  const bbSync = envelope.data.capabilities.find((entry: { command: string }) => entry.command === "bb sync");
  const planInit = envelope.data.capabilities.find((entry: { command: string }) => entry.command === "tis plan init");
  const planSolve = envelope.data.capabilities.find((entry: { command: string }) => entry.command === "tis plan solve");
  const degreeAudit = envelope.data.capabilities.find((entry: { command: string }) => entry.command === "tis degree audit");
  const degreeProgress = envelope.data.capabilities.find((entry: { command: string }) => entry.command === "tis degree progress");
  const degreeMissing = envelope.data.capabilities.find((entry: { command: string }) => entry.command === "tis degree missing");
  const snapshotSave = envelope.data.capabilities.find((entry: { command: string }) => entry.command === "academic snapshot save");
  const snapshotDiff = envelope.data.capabilities.find((entry: { command: string }) => entry.command === "academic snapshot diff");
  const academicChanges = envelope.data.capabilities.find((entry: { command: string }) => entry.command === "academic changes");
  const academicWatch = envelope.data.capabilities.find((entry: { command: string }) => entry.command === "academic watch");
  const tisIcal = envelope.data.capabilities.find((entry: { command: string }) => entry.command === "tis ical");
  const profileShow = envelope.data.capabilities.find((entry: { command: string }) => entry.command === "profile show");
  const profileExport = envelope.data.capabilities.find((entry: { command: string }) => entry.command === "profile export");
  assert.equal(apply.kind, "mutation");
  assert.equal(apply.confirmation, "required");
  assert.equal(preview.network, false);
  assert.equal(auth.authentication, "selected-service");
  assert.equal(authLogin.kind, "mutation");
  assert.equal(authLogin.network, true);
  assert.equal(authStatus.kind, "local");
  assert.equal(authStatus.network, false);
  assert.equal(authLogout.kind, "mutation");
  assert.equal(authLogout.network, false);
  assert.equal(bbApply.kind, "mutation");
  assert.equal(bbApply.authentication, "bb");
  assert.equal(bbApply.confirmation, "required");
  assert.equal(bbPreview.network, true);
  assert.equal(bbAttachments.kind, "read");
  assert.equal(bbAttachments.authentication, "bb");
  assert.equal(bbDownload.kind, "mutation");
  assert.equal(bbDownload.confirmation, "none");
  assert.equal(selectionApply.kind, "mutation");
  assert.equal(selectionApply.confirmation, "required");
  assert.equal(bidApply.kind, "mutation");
  assert.equal(bidApply.confirmation, "required");
  assert.equal(classroomLive.kind, "read");
  assert.equal(classroomNow.kind, "read");
  assert.equal(bbDeadlines.kind, "read");
  assert.equal(bbDeadlines.authentication, "bb");
  assert.equal(bbCalendar.kind, "read");
  assert.equal(bbCalendar.authentication, "bb");
  assert.equal(bbCalendarLinkShow.kind, "local");
  assert.equal(bbCalendarLinkShow.network, false);
  assert.equal(bbCalendarLinkFetch.kind, "mutation");
  assert.equal(bbCalendarLinkFetch.authentication, "none");
  assert.equal(bbSearch.kind, "read");
  assert.equal(bbSearch.authentication, "bb");
  assert.equal(bbSync.kind, "mutation");
  assert.equal(bbSync.authentication, "bb");
  assert.equal(planInit.kind, "local");
  assert.equal(planInit.network, false);
  assert.equal(planSolve.kind, "plan");
  assert.equal(planSolve.authentication, "tis");
  assert.equal(degreeAudit.kind, "plan");
  assert.equal(degreeAudit.authentication, "tis");
  assert.equal(degreeProgress.kind, "read");
  assert.equal(degreeProgress.authentication, "tis");
  assert.equal(degreeMissing.kind, "plan");
  assert.equal(degreeMissing.authentication, "tis");
  assert.equal(snapshotSave.kind, "mutation");
  assert.equal(snapshotSave.authentication, "sustech-cas");
  assert.equal(snapshotSave.confirmation, "none");
  assert.equal(snapshotDiff.kind, "local");
  assert.equal(snapshotDiff.network, false);
  assert.equal(academicChanges.kind, "local");
  assert.equal(academicChanges.network, false);
  assert.equal(academicWatch.kind, "mutation");
  assert.equal(academicWatch.authentication, "sustech-cas");
  assert.equal(academicWatch.confirmation, "none");
  assert.equal(tisIcal.kind, "mutation");
  assert.equal(tisIcal.authentication, "selected-service");
  assert.equal(profileShow.kind, "read");
  assert.equal(profileShow.authentication, "sustech-cas");
  assert.equal(profileExport.kind, "mutation");
  assert.equal(profileExport.authentication, "sustech-cas");
});

test("auth profile commands are machine-readable without exposing or inventing credentials", () => {
  const profile = `test-${process.pid}`;
  const status = runWithoutCredentials(["auth", "status", "--profile", profile, "--json"]);
  assert.equal(status.status, 0);
  const statusEnvelope = JSON.parse(status.stdout);
  assert.equal(statusEnvelope.data.profile, profile);
  assert.equal(statusEnvelope.data.configured, false);
  assert.equal(statusEnvelope.data.credentialAvailable, false);
  assert.equal("password" in statusEnvelope.data, false);

  const logout = runWithoutCredentials(["auth", "logout", "--profile", profile, "--json"]);
  assert.equal(logout.status, 0);
  assert.deepEqual(JSON.parse(logout.stdout).data, {
    profile,
    removed: false,
    backend: "unavailable",
  });

  const check = runWithoutCredentials(["auth", "check", "--profile", profile, "--service", "bb", "--json"]);
  assert.equal(check.status, 2);
  assert.equal(JSON.parse(check.stdout).error.code, "CREDENTIALS_REQUIRED");

  const missingSid = runWithoutCredentials(["auth", "login", "--password-stdin", "--json"]);
  assert.equal(missingSid.status, 2);
  assert.equal(JSON.parse(missingSid.stdout).error.code, "USAGE");
  assert.match(JSON.parse(missingSid.stdout).error.message, /requires --sid/);
});

test("new local Agent surfaces remain machine-readable and mutation-free", () => {
  const services = run(["services", "status", "--json"]);
  assert.equal(services.status, 0);
  assert.ok(JSON.parse(services.stdout).data.statuses.length >= 9);

  const onlineService = run(["services", "status", "sustech-online", "--json"]);
  assert.equal(onlineService.status, 0);
  assert.equal(JSON.parse(onlineService.stdout).data.statuses[0].availability, "implemented");

  const risks = run(["consequences", "tis.drop", "--json"]);
  assert.equal(risks.status, 0);
  assert.equal(JSON.parse(risks.stdout).data.consequences[0].irreversible, true);

  const resources = run(["resources", "search", "library", "--json"]);
  assert.equal(resources.status, 0);
  assert.ok(JSON.parse(resources.stdout).data.total >= 2);

  const selection = run([
    "tis", "selection", "preview", "drop",
    "--semester", "2025-2026-1",
    "--course-id", "COURSE-1",
    "--json",
  ]);
  assert.equal(selection.status, 0);
  assert.equal(JSON.parse(selection.stdout).data.mutation, false);
  assert.equal(JSON.parse(selection.stdout).data.applyAvailable, false);

  const exactSelection = run([
    "tis", "selection", "preview", "cart.remove",
    "--semester", "2025-2026-1",
    "--course-id", "deadbeef",
    "--rwh", "2025-2026-1-CS101-001",
    "--json",
  ]);
  assert.equal(exactSelection.status, 0);
  assert.equal(JSON.parse(exactSelection.stdout).data.applyAvailable, true);
  assert.match(JSON.parse(exactSelection.stdout).data.confirmation.command, /tis selection apply cart\.remove/);

  const missingLibraryDetail = run(["library", "detail", "--json"]);
  assert.equal(missingLibraryDetail.status, 2);
  assert.equal(JSON.parse(missingLibraryDetail.stdout).command, "library detail");
  assert.equal(JSON.parse(missingLibraryDetail.stdout).error.code, "USAGE");

  const library = run(["library", "search-url", "machine", "learning", "--json"]);
  assert.equal(library.status, 0);
  const libraryData = JSON.parse(library.stdout).data;
  assert.equal(libraryData.availability, "browser-required");
  assert.match(libraryData.url, /query=any%2Ccontains%2Cmachine\+learning/);

  const doctor = runWithoutCredentials(["doctor", "--profile", `doctor-${process.pid}`, "--service", "tis,pms", "--json"]);
  assert.equal(doctor.status, 0);
  const doctorData = JSON.parse(doctor.stdout).data;
  assert.equal(doctorData.live, false);
  assert.deepEqual(doctorData.requestedServices, ["tis", "pms"]);
  assert.equal(doctorData.checks.find((entry: { id: string }) => entry.id === "service.pms").status, "skipped");
});

test("TIS plan subcommands persist local planning state without network", () => {
  const tempDir = mkdtempSync(join(process.cwd(), ".tmp-sustech-cli-plan-cli-"));
  const planPath = join(tempDir, "plan.json");

  try {
    const init = run([
      "tis", "plan", "init", "CS101",
      "--semester", "2025-2026-1",
      "--block", "MON:1-2",
      "--early-period-threshold", "3",
      "--weight-gap-segment", "7",
      "--path", planPath,
      "--json",
    ]);
    assert.equal(init.status, 0);
    const initialized = JSON.parse(init.stdout).data.plan;
    assert.deepEqual(initialized.requestedCodes, ["CS101"]);
    assert.equal(initialized.preferences.earlyPeriodThreshold, 3);
    assert.equal(initialized.preferences.weights.gapSegment, 7);

    const add = run([
      "tis", "plan", "add", "MA101",
      "--block", "WED:3-4",
      "--weight-campus-switch", "9",
      "--path", planPath,
      "--json",
    ]);
    assert.equal(add.status, 0);
    const added = JSON.parse(add.stdout).data.plan;
    assert.deepEqual(added.requestedCodes, ["CS101", "MA101"]);
    assert.equal(added.blocked.length, 2);
    assert.equal(added.preferences.earlyPeriodThreshold, 3);
    assert.equal(added.preferences.weights.gapSegment, 7);
    assert.equal(added.preferences.weights.campusSwitch, 9);

    const remove = run([
      "tis", "plan", "remove", "CS101",
      "--block", "MON:1-2",
      "--path", planPath,
      "--json",
    ]);
    assert.equal(remove.status, 0);
    const removed = JSON.parse(remove.stdout).data.plan;
    assert.deepEqual(removed.requestedCodes, ["MA101"]);
    assert.equal(removed.blocked.length, 1);

    const show = run(["tis", "plan", "show", "--path", planPath, "--json"]);
    assert.equal(show.status, 0);
    const shown = JSON.parse(show.stdout).data;
    assert.equal(shown.path, planPath);
    assert.equal(shown.plan.preferences.weights.campusSwitch, 9);

    const explain = runWithoutCredentials([
      "tis", "plan", "explain", "MA101",
      "--round", "bxxk",
      "--path", planPath,
      "--json",
    ]);
    assert.equal(explain.status, 2);
    assert.equal(JSON.parse(explain.stdout).command, "tis plan explain");
    assert.equal(JSON.parse(explain.stdout).error.code, "CREDENTIALS_REQUIRED");

    const recommend = runWithoutCredentials([
      "tis", "plan", "recommend",
      "--round", "bxxk",
      "--path", planPath,
      "--json",
    ]);
    assert.equal(recommend.status, 2);
    assert.equal(JSON.parse(recommend.stdout).command, "tis plan recommend");
    assert.equal(JSON.parse(recommend.stdout).error.code, "CREDENTIALS_REQUIRED");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("library interactive mode never starts implicitly without the explicit browser transport", () => {
  const result = run(["library", "search", "machine learning", "--interactive", "--json"]);
  assert.equal(result.status, 2);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.command, "library search");
  assert.equal(envelope.error.code, "USAGE");
  assert.match(envelope.error.message, /--interactive requires --browser/);
});

test("TIS plan preference flags reject invalid ranges before local writes", () => {
  const tempDir = mkdtempSync(join(process.cwd(), ".tmp-sustech-cli-plan-cli-invalid-"));
  const planPath = join(tempDir, "plan.json");

  try {
    const result = run([
      "tis", "plan", "init", "CS101",
      "--weight-gap-segment", "101",
      "--path", planPath,
      "--json",
    ]);
    assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stdout).error.code, "USAGE");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("degree-audit validates local requirements format before credential lookup", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "sustech-cli-degree-cli-"));
  const requirementsPath = join(tempDir, "requirements.yaml");
  writeFileSync(requirementsPath, "kind: tis-degree-requirements\n", "utf8");

  try {
    const result = runWithoutCredentials([
      "tis", "degree", "audit",
      "--requirements", requirementsPath,
      "--json",
    ]);
    assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stdout).error.code, "DEGREE_REQUIREMENTS_UNSUPPORTED_FORMAT");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("degree-missing validates optional semester locally and otherwise requires TIS credentials", () => {
  const invalidSemester = runWithoutCredentials([
    "tis", "degree", "missing",
    "--semester", "2026/2027/1",
    "--json",
  ]);
  assert.equal(invalidSemester.status, 2);
  assert.equal(JSON.parse(invalidSemester.stdout).command, "tis degree missing");
  assert.equal(JSON.parse(invalidSemester.stdout).error.code, "INVALID_SEMESTER");

  const missingCredentials = runWithoutCredentials(["tis", "degree", "missing", "--json"]);
  assert.equal(missingCredentials.status, 2);
  assert.equal(JSON.parse(missingCredentials.stdout).command, "tis degree missing");
  assert.equal(JSON.parse(missingCredentials.stdout).error.code, "CREDENTIALS_REQUIRED");
});

test("academic snapshot and watch CLI validate local arguments before auth and compare verified files offline", () => {
  const missingDestination = runWithoutCredentials(["academic", "snapshot", "save", "--json"]);
  assert.equal(missingDestination.status, 2);
  assert.equal(JSON.parse(missingDestination.stdout).command, "academic snapshot save");
  assert.equal(JSON.parse(missingDestination.stdout).error.code, "USAGE");

  const missingState = runWithoutCredentials(["academic", "watch", "--json"]);
  assert.equal(missingState.status, 2);
  assert.equal(JSON.parse(missingState.stdout).command, "academic watch");
  assert.equal(JSON.parse(missingState.stdout).error.code, "USAGE");

  const tempDir = mkdtempSync(join(tmpdir(), "sustech-cli-academic-snapshot-cli-"));
  const beforePath = join(tempDir, "before.json");
  const afterPath = join(tempDir, "after.json");
  const statePath = join(tempDir, "state.json");
  const stateTarget = join(tempDir, "state-target.json");
  const stateLink = join(tempDir, "state-link.json");
  const stateParentTarget = join(tempDir, "state-parent-target");
  const stateParentLink = join(tempDir, "state-parent-link");
  const before = buildAcademicSnapshot({
    semester: "2026-2027-1",
    generatedAt: "2026-08-27T00:00:00.000Z",
    sources: { schedule: academicSnapshotSource([{ rwh: "R1", room: "一教101" }]) },
  });
  const after = buildAcademicSnapshot({
    semester: "2026-2027-1",
    generatedAt: "2026-08-28T00:00:00.000Z",
    sources: { schedule: academicSnapshotSource([{ rwh: "R1", room: "一教102" }]) },
  });

  try {
    writeFileSync(beforePath, JSON.stringify(before), "utf8");
    writeFileSync(afterPath, JSON.stringify(after), "utf8");
    writeFileSync(stateTarget, "{}", "utf8");
    symlinkSync(stateTarget, stateLink, "file");
    mkdirSync(stateParentTarget);
    symlinkSync(stateParentTarget, stateParentLink, "dir");

    const diffResult = run(["academic", "snapshot", "diff", beforePath, afterPath, "--json"]);
    assert.equal(diffResult.status, 0);
    const diffEnvelope = JSON.parse(diffResult.stdout);
    assert.equal(diffEnvelope.command, "academic snapshot diff");
    assert.equal(diffEnvelope.data.summary.changed, 1);
    assert.equal(diffEnvelope.data.summary.hasChanges, true);

    const changesResult = run(["academic", "changes", beforePath, afterPath, "--json"]);
    assert.equal(changesResult.status, 0);
    const changesEnvelope = JSON.parse(changesResult.stdout);
    assert.equal(changesEnvelope.command, "academic changes");
    assert.equal(changesEnvelope.data.summary.totalChanges, 1);
    assert.equal(changesEnvelope.data.state, "changed");

    const unsafeState = runWithoutCredentials(["academic", "watch", "--state", stateLink, "--json"]);
    assert.equal(unsafeState.status, 2);
    assert.equal(JSON.parse(unsafeState.stdout).error.code, "UNSAFE_LOCAL_PATH");

    const unsafeParent = runWithoutCredentials(["academic", "watch", "--state", join(stateParentLink, "state.json"), "--json"]);
    assert.equal(unsafeParent.status, 2);
    assert.equal(JSON.parse(unsafeParent.stdout).error.code, "UNSAFE_LOCAL_PATH");

    const needsCredentials = runWithoutCredentials(["academic", "watch", "--state", statePath, "--json"]);
    assert.equal(needsCredentials.status, 2);
    assert.equal(JSON.parse(needsCredentials.stdout).command, "academic watch");
    assert.equal(JSON.parse(needsCredentials.stdout).error.code, "CREDENTIALS_REQUIRED");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("booking, library-booking, and PMS expose authenticated commands with explicit mutation metadata", () => {
  const capabilities = JSON.parse(run(["capabilities", "--json"]).stdout).data.capabilities as Array<{
    command: string;
    kind: string;
    authentication: string;
    confirmation: string;
  }>;
  for (const [command, authentication] of [
    ["booking rooms", "booking"],
    ["booking create apply", "booking"],
    ["lib-booking reservations", "lib-booking"],
    ["lib-booking cancel apply", "lib-booking"],
    ["pms jobs", "pms"],
  ] as const) {
    const capability = capabilities.find((entry) => entry.command === command);
    if (command.endsWith("apply")) {
      assert.equal(capability?.kind, "mutation");
      assert.equal(capability?.confirmation, "required");
    } else {
      assert.equal(capability?.kind, "read");
      assert.equal(capability?.confirmation, "none");
    }
    assert.equal(capability?.authentication, authentication);
  }
  assert.equal(capabilities.find((entry) => entry.command === "pms upload preview")?.kind, "plan");
  assert.equal(capabilities.find((entry) => entry.command === "pms upload apply")?.kind, "mutation");
  assert.equal(capabilities.find((entry) => entry.command === "pms upload apply")?.confirmation, "required");
  assert.equal(capabilities.find((entry) => entry.command === "pms delete apply")?.kind, "mutation");
  assert.equal(capabilities.find((entry) => entry.command === "pms delete apply")?.confirmation, "required");

  for (const service of ["booking", "library-booking", "pms"]) {
    const status = run(["services", "status", service, "--json"]);
    assert.equal(status.status, 0);
    assert.equal(JSON.parse(status.stdout).data.statuses[0].availability, "implemented");
  }

  for (const args of [
    ["booking", "rooms", "--available", "--json"],
    ["lib-booking", "home-summary", "--json"],
    ["pms", "check", "--json"],
    ["auth", "check", "--service", "library-booking", "--json"],
  ]) {
    const result = runWithoutCredentials(args);
    assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stdout).error.code, "CREDENTIALS_REQUIRED");
  }
});

test("booking and library-booking apply commands require confirmation before credentials or network", () => {
  for (const args of [
    [
      "booking", "create", "apply",
      "--room-id", "ZC02",
      "--start", "2026-08-27T10:00",
      "--end", "2026-08-27T11:00",
      "--title", "team sync",
      "--json",
    ],
    [
      "booking", "cancel", "apply",
      "--meeting-id", "M-1",
      "--json",
    ],
    [
      "lib-booking", "create", "apply",
      "--kind-id", "1",
      "--lab-id", "2",
      "--dev-id", "13",
      "--start", "2026-08-27T10:00",
      "--end", "2026-08-27T11:00",
      "--title", "study group",
      "--json",
    ],
    [
      "lib-booking", "cancel", "apply",
      "--reservation-id", "9001",
      "--json",
    ],
  ]) {
    const result = runWithoutCredentials(args);
    assert.equal(result.status, 3);
    assert.equal(JSON.parse(result.stdout).error.code, "CONFIRMATION_REQUIRED");
  }
});

test("new authenticated commands reject invalid inputs before network or credential resolution", () => {
  for (const [args, expectedCode] of [
    [["booking", "rooms", "--page-size", "0", "--json"], "USAGE"],
    [["lib-booking", "rooms", "--kind-id", "0", "--lab-id", "1", "--json"], "USAGE"],
    [["lib-booking", "reservations", "--start", "2026-02-30", "--json"], "USAGE"],
    [["pms", "usage", "--begin", "2026-08-30", "--end", "2026-08-01", "--json"], "USAGE"],
    [["pms", "delete", "preview", "0", "--json"], "USAGE"],
    [["auth", "check", "--service", "not-a-service", "--json"], "USAGE"],
    [["doctor", "--service", "tis,not-a-service", "--json"], "USAGE"],
    [["papers", "fetch-oa", "not-a-doi", "--destination", "/tmp/paper.pdf", "--json"], "USAGE"],
    [["bb", "submit", "apply", "--course-id", "_8537_1", "--content-id", "_629896_1", "--file", "/tmp/report.pdf", "--expected-sha256", "not-a-sha", "--confirm", "--json"], "USAGE"],
    [["bb", "search", "hw", "--attachments", "bad", "--json"], "USAGE"],
    [["bb", "search", "hw", "--kind", "bad", "--json"], "USAGE"],
    [["bb", "search", "hw", "--page-size", "0", "--json"], "USAGE"],
    [["bb", "deadlines", "--days", "0", "--json"], "USAGE"],
    [["tis", "ical", "--include", "bad", "--json"], "USAGE"],
  ] as const) {
    const result = runWithoutCredentials([...args]);
    assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stdout).error.code, expectedCode);
  }
});

test("selection and bid apply require --confirm before any credential lookup or network", () => {
  const selection = runWithoutCredentials([
    "tis", "selection", "apply", "drop",
    "--course-id", "deadbeef",
    "--rwh", "2025-2026-1-CS101-001",
    "--json",
  ]);
  assert.equal(selection.status, 3);
  assert.equal(JSON.parse(selection.stdout).error.code, "CONFIRMATION_REQUIRED");

  const bid = runWithoutCredentials([
    "tis", "bid", "apply",
    "--pick", "2025-2026-1-CS101-001:deadbeef:3",
    "--json",
  ]);
  assert.equal(bid.status, 3);
  assert.equal(JSON.parse(bid.stdout).error.code, "CONFIRMATION_REQUIRED");
});

test("selection reconciliation is bounded, read-only, and validates locally before credentials", () => {
  const invalid = runWithoutCredentials([
    "tis", "selection", "reconcile", "cart.add",
    "--course-id", "selection-id",
    "--rwh", "task-id",
    "--round", "bxxk",
    "--attempts", "1",
    "--json",
  ]);
  assert.equal(invalid.status, 2);
  assert.equal(JSON.parse(invalid.stdout).error.code, "USAGE");

  const capabilities = JSON.parse(run(["capabilities", "--json"]).stdout).data.capabilities;
  const reconcile = capabilities.find((entry: { command:string }) => entry.command === "tis selection reconcile");
  assert.equal(reconcile.kind, "read");
  assert.equal(reconcile.confirmation, "none");
});

test("context live supports calendar level and degrades gracefully when credentials are unavailable", () => {
  const result = runWithoutCredentials(["context", "--calendar-level", "graduate", "--live", "--json"]);
  assert.equal(result.status, 0);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.data.sourceStatus.nextDeadline, "missing");
  assert.equal(envelope.data.sourceStatus.schedule, "missing");
  assert.equal(envelope.data.sourceStatus.nextExam, "missing");
  assert.equal(envelope.data.liveSources.tisSchedule.state, "credentials-missing");
  assert.equal(envelope.data.liveSources.tisExams.state, "credentials-missing");
  assert.equal(envelope.data.liveSources.blackboardDeadlines.state, "credentials-missing");
});

test("profile commands remain machine-readable when credentials are unavailable", () => {
  const show = runWithoutCredentials(["profile", "show", "--json"]);
  assert.equal(show.status, 0);
  const showEnvelope = JSON.parse(show.stdout);
  assert.equal(showEnvelope.command, "profile show");
  assert.equal(showEnvelope.data.summary.errorSources, 4);
  assert.equal(showEnvelope.data.sources.tisIdentity.failures[0].code, "CREDENTIALS_REQUIRED");
  assert.doesNotMatch(JSON.stringify(showEnvelope.data), /password|token|cookie|authorization/i);

  const exportMissingDestination = runWithoutCredentials(["profile", "export", "--json"]);
  assert.equal(exportMissingDestination.status, 2);
  assert.equal(JSON.parse(exportMissingDestination.stdout).command, "profile export");
  assert.equal(JSON.parse(exportMissingDestination.stdout).error.code, "USAGE");
});

test("profile export refuses to write an all-error empty report", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "sustech-cli-profile-export-"));
  const filePath = join(tempDir, "profile.json");
  try {
    const result = runWithoutCredentials(["profile", "export", "--destination", filePath, "--json"]);
    assert.equal(result.status, 1);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.command, "profile export");
    assert.equal(envelope.error.code, "PROFILE_NO_DATA");
    assert.equal(envelope.error.details.destination, filePath);
    assert.equal(envelope.error.details.sources.tisIdentity, "error");
    assert.equal(exists(filePath), false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("PMS upload preview validates the local file before requiring credentials", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "sustech-cli-pms-upload-"));
  const filePath = join(tempDir, "report final.pdf");
  writeFileSync(filePath, "%PDF-1.7\nmock", "utf8");

  try {
    const result = runWithoutCredentials([
      "pms", "upload", "preview",
      "--file", filePath,
      "--color", "color",
      "--paper", "A4",
      "--duplex", "long",
      "--page-from", "2",
      "--page-to", "4",
      "--copies", "3",
      "--json",
    ]);
    assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stdout).error.code, "CREDENTIALS_REQUIRED");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("PMS upload apply requires both the preview hash and explicit confirmation before authentication", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "sustech-cli-pms-upload-apply-"));
  const filePath = join(tempDir, "answer.txt");
  const contents = "reviewed print payload";
  writeFileSync(filePath, contents, "utf8");
  const sha256 = createHash("sha256").update(contents).digest("hex");
  const baseArgs = [
    "pms", "upload", "apply",
    "--file", filePath,
    "--color", "bw",
    "--paper", "unspecified",
    "--duplex", "single",
  ];

  try {
    const unconfirmed = runWithoutCredentials([...baseArgs, "--expected-sha256", sha256, "--json"]);
    assert.equal(unconfirmed.status, 3);
    assert.equal(JSON.parse(unconfirmed.stdout).error.code, "CONFIRMATION_REQUIRED");

    const mismatched = runWithoutCredentials([
      ...baseArgs,
      "--expected-sha256", "0".repeat(64),
      "--confirm",
      "--json",
    ]);
    assert.equal(mismatched.status, 4);
    assert.equal(JSON.parse(mismatched.stdout).error.code, "PMS_UPLOAD_FILE_HASH_MISMATCH");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("PMS delete apply requires explicit confirmation before authentication", () => {
  const result = runWithoutCredentials(["pms", "delete", "apply", "12345", "--json"]);
  assert.equal(result.status, 3);
  assert.equal(JSON.parse(result.stdout).error.code, "CONFIRMATION_REQUIRED");
});

function run(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function runWithoutCredentials(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const configRoot = mkdtempSync(join(tmpdir(), "sustech-cli-empty-config-"));
  try {
    const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
      encoding: "utf8",
      env: {
        ...process.env,
        SUSTECH_SID: "",
        SUSTECH_PASSWORD: "",
        SUSTECH_CREDENTIALS_FILE: "",
        SUSTECH_DISABLE_SYSTEM_KEYRING: "1",
        SUSTECH_PROFILE: "",
        XDG_CONFIG_HOME: configRoot,
      },
    });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  } finally {
    rmSync(configRoot, { recursive: true, force: true });
  }
}

function exists(path: string): boolean {
  return spawnSync(process.execPath, ["-e", `require('node:fs').accessSync(${JSON.stringify(path)})`], { encoding: "utf8" }).status === 0;
}
