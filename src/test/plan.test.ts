import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { CliError } from "../core/errors.js";
import { parseBlockedTime } from "../tis/planner.js";
import { addPlanEntries, createPlanDocument, loadPlan, removePlanEntries, savePlan } from "../tis/plan.js";

test("persistent TIS plans keep schema/version and normalize local state", async () => {
  const tempDir = mkdtempSync(join(process.cwd(), ".tmp-sustech-cli-plan-"));
  const planPath = join(tempDir, "tis-plan.json");

  try {
    const initial = createPlanDocument({
      semester: { xn: "2025-2026", xq: "1", value: "2025-2026-1" },
      requestedCodes: ["cs101", "CS101", "ma101"],
      blocked: [parseBlockedTime("MON:1-2"), parseBlockedTime("1:1-2")],
    });
    await savePlan(planPath, initial);

    const written = JSON.parse(readFileSync(planPath, "utf8")) as { schemaVersion: string; kind: string };
    assert.equal(statSync(planPath).isFile(), true);
    assert.equal(written.schemaVersion, "1");
    assert.equal(written.kind, "tis-plan");
    if (process.platform !== "win32") assert.equal(statSync(planPath).mode & 0o777, 0o600);

    const loaded = await loadPlan(planPath);
    assert.deepEqual(loaded.plan.requestedCodes, ["CS101", "MA101"]);
    assert.equal(loaded.plan.blocked.length, 1);

    const added = addPlanEntries(loaded.plan, {
      requestedCodes: ["ee101"],
      blocked: [parseBlockedTime("WED:3-4")],
    });
    await savePlan(planPath, added);
    const updated = await loadPlan(planPath);
    assert.deepEqual(updated.plan.requestedCodes, ["CS101", "MA101", "EE101"]);
    assert.equal(updated.plan.blocked.length, 2);

    const removed = removePlanEntries(updated.plan, {
      requestedCodes: ["MA101"],
      blocked: [parseBlockedTime("MON:1-2")],
    });
    assert.deepEqual(removed.requestedCodes, ["CS101", "EE101"]);
    assert.deepEqual(removed.blocked.map((entry) => `${entry.day}:${entry.periodStart}-${entry.periodEnd}`), ["3:3-4"]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("persistent TIS plans reject invalid stored preferences instead of silently defaulting", async () => {
  const tempDir = mkdtempSync(join(process.cwd(), ".tmp-sustech-cli-plan-invalid-"));
  const badThresholdPath = join(tempDir, "bad-threshold.json");
  const badWeightPath = join(tempDir, "bad-weight.json");

  try {
    writeFileSync(badThresholdPath, JSON.stringify({
      schemaVersion: "1",
      kind: "tis-plan",
      savedAt: "2026-08-26T00:00:00.000Z",
      requestedCodes: ["CS101"],
      blocked: [],
      preferences: {
        earlyPeriodThreshold: "oops",
      },
    }), "utf8");
    writeFileSync(badWeightPath, JSON.stringify({
      schemaVersion: "1",
      kind: "tis-plan",
      savedAt: "2026-08-26T00:00:00.000Z",
      requestedCodes: ["CS101"],
      blocked: [],
      preferences: {
        weights: {
          gapSegment: -1,
        },
      },
    }), "utf8");

    await assert.rejects(
      () => loadPlan(badThresholdPath),
      (error: unknown) => error instanceof CliError && error.code === "TIS_PLAN_INVALID",
    );
    await assert.rejects(
      () => loadPlan(badWeightPath),
      (error: unknown) => error instanceof CliError && error.code === "TIS_PLAN_INVALID",
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("persistent TIS plans refuse symbolic-link targets or parent directories during atomic writes", async () => {
  const tempDir = mkdtempSync(join(process.cwd(), ".tmp-sustech-cli-plan-link-"));
  const realDir = join(tempDir, "real");
  const linkedDir = join(tempDir, "linked");
  const realTarget = join(tempDir, "real-target.json");
  const linkedTarget = join(tempDir, "linked-target.json");

  try {
    const initial = createPlanDocument({ requestedCodes: ["CS101"] });
    await savePlan(realTarget, initial);
    symlinkSync(realDir, linkedDir);
    symlinkSync(realTarget, linkedTarget);

    await assert.rejects(
      () => savePlan(join(linkedDir, "plan.json"), initial),
      (error: unknown) => error instanceof CliError && error.code === "UNSAFE_LOCAL_PATH",
    );
    await assert.rejects(
      () => savePlan(linkedTarget, initial),
      (error: unknown) => error instanceof CliError && error.code === "UNSAFE_LOCAL_PATH",
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
