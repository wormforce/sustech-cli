import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const CLI_PATH = fileURLToPath(new URL("../cli.js", import.meta.url));

test("compiled CLI serves human text and versioned JSON from the real entrypoint", () => {
  const text = run(["version"]);
  assert.equal(text.status, 0);
  assert.match(text.stdout, /^sustech-cli 0\.6\.0/);

  const json = run(["version", "--json"]);
  assert.equal(json.status, 0);
  assert.deepEqual(JSON.parse(json.stdout), {
    schemaVersion: "1",
    ok: true,
    command: "version",
    data: { version: "0.6.0", runtime: `node ${process.version}` },
  });
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
    assert.equal(mismatched.status, 2);
    assert.equal(JSON.parse(mismatched.stdout).error.code, "BLACKBOARD_FILE_HASH_MISMATCH");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
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
  const bbSearch = envelope.data.capabilities.find((entry: { command: string }) => entry.command === "bb search");
  const bbSync = envelope.data.capabilities.find((entry: { command: string }) => entry.command === "bb sync");
  const planInit = envelope.data.capabilities.find((entry: { command: string }) => entry.command === "tis plan init");
  const planSolve = envelope.data.capabilities.find((entry: { command: string }) => entry.command === "tis plan solve");
  const degreeAudit = envelope.data.capabilities.find((entry: { command: string }) => entry.command === "tis degree audit");
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
  assert.ok(JSON.parse(services.stdout).data.statuses.length >= 8);

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
      "--path", planPath,
      "--json",
    ]);
    assert.equal(init.status, 0);
    assert.deepEqual(JSON.parse(init.stdout).data.plan.requestedCodes, ["CS101"]);

    const add = run([
      "tis", "plan", "add", "MA101",
      "--block", "WED:3-4",
      "--path", planPath,
      "--json",
    ]);
    assert.equal(add.status, 0);
    const added = JSON.parse(add.stdout).data.plan;
    assert.deepEqual(added.requestedCodes, ["CS101", "MA101"]);
    assert.equal(added.blocked.length, 2);

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
    assert.equal(JSON.parse(show.stdout).data.path, planPath);
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

test("booking, library-booking, and PMS expose read-only Agent commands", () => {
  const capabilities = JSON.parse(run(["capabilities", "--json"]).stdout).data.capabilities as Array<{
    command: string;
    kind: string;
    authentication: string;
    confirmation: string;
  }>;
  for (const [command, authentication] of [
    ["booking rooms", "booking"],
    ["lib-booking reservations", "lib-booking"],
    ["pms jobs", "pms"],
  ] as const) {
    const capability = capabilities.find((entry) => entry.command === command);
    assert.equal(capability?.kind, "read");
    assert.equal(capability?.authentication, authentication);
    assert.equal(capability?.confirmation, "none");
  }

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

test("new authenticated commands reject invalid inputs before network or credential resolution", () => {
  for (const [args, expectedCode] of [
    [["booking", "rooms", "--page-size", "0", "--json"], "USAGE"],
    [["lib-booking", "rooms", "--kind-id", "0", "--lab-id", "1", "--json"], "USAGE"],
    [["lib-booking", "reservations", "--start", "2026-02-30", "--json"], "USAGE"],
    [["pms", "usage", "--begin", "2026-08-30", "--end", "2026-08-01", "--json"], "USAGE"],
    [["auth", "check", "--service", "not-a-service", "--json"], "USAGE"],
    [["doctor", "--service", "tis,not-a-service", "--json"], "USAGE"],
    [["papers", "fetch-oa", "not-a-doi", "--destination", "/tmp/paper.pdf", "--json"], "USAGE"],
    [["bb", "submit", "apply", "--course-id", "_8537_1", "--content-id", "_629896_1", "--file", "/tmp/report.pdf", "--expected-sha256", "not-a-sha", "--confirm", "--json"], "USAGE"],
    [["bb", "search", "hw", "--attachments", "bad", "--json"], "USAGE"],
    [["bb", "search", "hw", "--kind", "bad", "--json"], "USAGE"],
    [["bb", "search", "hw", "--page-size", "0", "--json"], "USAGE"],
    [["bb", "deadlines", "--days", "0", "--json"], "USAGE"],
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

test("context live degrades gracefully when Blackboard credentials are unavailable", () => {
  const result = runWithoutCredentials(["context", "--live", "--json"]);
  assert.equal(result.status, 0);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.data.sourceStatus.nextDeadline, "missing");
  assert.equal(envelope.data.liveSources.blackboardDeadlines.state, "credentials-missing");
});

function run(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function runWithoutCredentials(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      SUSTECH_SID: "",
      SUSTECH_PASSWORD: "",
      SUSTECH_CREDENTIALS_FILE: "",
      SUSTECH_PROFILE: "",
      XDG_CONFIG_HOME: join(tmpdir(), `sustech-cli-empty-config-${process.pid}`),
    },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}
