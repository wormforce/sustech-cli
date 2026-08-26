import assert from "node:assert/strict";
import test from "node:test";
import { buildDoctorReport, type DoctorInput } from "../doctor/service.js";
import { formatDoctorReport } from "../doctor/text.js";

function input(overrides: Partial<DoctorInput> = {}): DoctorInput {
  return {
    now: new Date("2026-08-27T01:00:00.000Z"),
    platform: "darwin",
    architecture: "arm64",
    nodeVersion: "v22.18.0",
    backend: { backend: "macos-keychain", available: true, persistent: true },
    profile: {
      profile: "main",
      configured: true,
      credentialAvailable: true,
      maskedSid: "12****78",
      backend: "macos-keychain",
      backendAvailable: true,
      persistent: true,
      profiles: ["main"],
    },
    services: ["tis", "pms"],
    live: false,
    ...overrides,
  };
}

test("doctor reports local readiness without pretending skipped services are healthy", () => {
  const report = buildDoctorReport(input());
  assert.equal(report.summary.healthy, true);
  assert.equal(report.summary.pass, 3);
  assert.equal(report.summary.skipped, 2);
  assert.equal(report.checks.find((check) => check.id === "service.pms")?.status, "skipped");
  assert.match(formatDoctorReport(report), /campus network or an approved campus access path/);
});

test("doctor keeps live failures independent and marks campus reachability remediation", () => {
  const report = buildDoctorReport(input({
    live: true,
    liveResults: [
      { service: "tis", status: "pass", message: "authentication succeeded" },
      { service: "pms", status: "fail", code: "SERVICE_ERROR", message: "campus network gate was not reachable" },
    ],
  }));
  assert.equal(report.summary.healthy, false);
  assert.equal(report.summary.fail, 1);
  const pms = report.checks.find((check) => check.id === "service.pms");
  assert.equal(pms?.details?.code, "SERVICE_ERROR");
  assert.match(pms?.remediation ?? "", /campus network/);
});

test("doctor fails unsupported runtimes and a missing profile only when live checks were requested", () => {
  const profile = { ...input().profile, configured: false, credentialAvailable: false };
  const local = buildDoctorReport(input({ nodeVersion: "v18.20.0", profile, live: false }));
  assert.equal(local.checks.find((check) => check.id === "runtime.node")?.status, "fail");
  assert.equal(local.checks.find((check) => check.id === "credentials.profile")?.status, "warn");

  const live = buildDoctorReport(input({ profile, live: true, liveResults: [] }));
  assert.equal(live.checks.find((check) => check.id === "credentials.profile")?.status, "fail");
});
