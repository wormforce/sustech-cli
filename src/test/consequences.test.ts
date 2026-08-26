import assert from "node:assert/strict";
import test from "node:test";
import { CONSEQUENCES, consequenceByOperation } from "../core/consequences.js";

test("consequence registry has stable unique operation IDs", () => {
  assert.equal(new Set(CONSEQUENCES.map((entry) => entry.operation)).size, CONSEQUENCES.length);
  assert.equal(consequenceByOperation("tis.drop")?.irreversible, true);
  assert.equal(consequenceByOperation("blackboard.download")?.availability, "implemented");
  assert.equal(consequenceByOperation("blackboard.submit")?.availability, "implemented");
});

test("implemented mutations declare a read-back verification rule", () => {
  const implemented = CONSEQUENCES.filter((entry) => entry.availability === "implemented");
  assert.ok(implemented.length > 0);
  assert.ok(implemented.every((entry) => entry.verification.trim().length > 0));
});
