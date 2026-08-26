import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const CLI_PATH = new URL("../cli.js", import.meta.url);

test("compiled CLI serves human text and versioned JSON from the real entrypoint", () => {
  const text = run(["version"]);
  assert.equal(text.status, 0);
  assert.match(text.stdout, /^sustech-cli 0\.4\.0/);

  const json = run(["version", "--json"]);
  assert.equal(json.status, 0);
  assert.deepEqual(JSON.parse(json.stdout), {
    schemaVersion: "1",
    ok: true,
    command: "version",
    data: { version: "0.4.0", runtime: `node ${process.version}` },
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

test("capabilities exposes safety metadata without requiring help-text parsing", () => {
  const result = run(["capabilities", "--json"]);
  assert.equal(result.status, 0);
  const envelope = JSON.parse(result.stdout);
  const apply = envelope.data.capabilities.find((entry: { command: string }) => entry.command === "tis enroll apply");
  const preview = envelope.data.capabilities.find((entry: { command: string }) => entry.command === "tis enroll preview");
  const auth = envelope.data.capabilities.find((entry: { command: string }) => entry.command === "auth check");
  assert.equal(apply.kind, "mutation");
  assert.equal(apply.confirmation, "required");
  assert.equal(preview.network, false);
  assert.equal(auth.authentication, "selected-service");
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

  const library = run(["library", "search-url", "machine", "learning", "--json"]);
  assert.equal(library.status, 0);
  const libraryData = JSON.parse(library.stdout).data;
  assert.equal(libraryData.availability, "browser-required");
  assert.match(libraryData.url, /query=any%2Ccontains%2Cmachine\+learning/);
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
  for (const args of [
    ["booking", "rooms", "--page-size", "0", "--json"],
    ["lib-booking", "rooms", "--kind-id", "0", "--lab-id", "1", "--json"],
    ["lib-booking", "reservations", "--start", "2026-02-30", "--json"],
    ["pms", "usage", "--begin", "2026-08-30", "--end", "2026-08-01", "--json"],
    ["auth", "check", "--service", "not-a-service", "--json"],
  ]) {
    const result = runWithoutCredentials(args);
    assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stdout).error.code, "USAGE");
  }
});

function run(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [CLI_PATH.pathname, ...args], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function runWithoutCredentials(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [CLI_PATH.pathname, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      SUSTECH_SID: "",
      SUSTECH_PASSWORD: "",
      SUSTECH_CREDENTIALS_FILE: "",
    },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}
