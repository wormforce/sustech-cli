import assert from "node:assert/strict";
import test from "node:test";
import { CAPABILITIES } from "../core/capabilities.js";
import { CONSEQUENCES, consequenceByOperation } from "../core/consequences.js";

const MUTATION_CONSEQUENCES: Readonly<Record<string, readonly string[]>> = {
  "profile export": ["profile.export"],
  "academic snapshot save": ["academic.snapshot.save"],
  "academic watch": ["academic.snapshot.save"],
  "papers fetch-oa": ["papers.fetch-oa"],
  "bb download": ["blackboard.download"],
  "bb sync": ["blackboard.sync"],
  "bb calendar-link set": ["blackboard.calendar-link.store"],
  "bb calendar-link fetch": ["blackboard.calendar-link.fetch"],
  "bb calendar-link delete": ["blackboard.calendar-link.delete"],
  "bb submit apply": ["blackboard.submit"],
  "booking create apply": ["booking.create"],
  "booking cancel apply": ["booking.cancel"],
  "lib-booking create apply": ["library-booking.create"],
  "lib-booking cancel apply": ["library-booking.cancel"],
  "pms upload apply": ["pms.upload"],
  "pms delete apply": ["pms.delete"],
  "auth login": ["credentials.store"],
  "auth logout": ["credentials.delete"],
  "tis ical": ["tis.ical.export"],
  "tis selection apply": ["tis.enroll", "tis.drop", "tis.cart.update", "tis.bid"],
  "tis bid apply": ["tis.bid"],
  "tis enroll apply": ["tis.enroll"],
};

test("consequence registry has stable unique operation IDs", () => {
  assert.equal(new Set(CONSEQUENCES.map((entry) => entry.operation)).size, CONSEQUENCES.length);
  assert.equal(consequenceByOperation("tis.drop")?.irreversible, true);
  assert.equal(consequenceByOperation("blackboard.download")?.availability, "implemented");
  assert.equal(consequenceByOperation("blackboard.sync")?.availability, "implemented");
  assert.equal(consequenceByOperation("blackboard.calendar-link.store")?.availability, "implemented");
  assert.equal(consequenceByOperation("blackboard.calendar-link.fetch")?.availability, "implemented");
  assert.equal(consequenceByOperation("blackboard.calendar-link.delete")?.availability, "implemented");
  assert.equal(consequenceByOperation("blackboard.submit")?.availability, "implemented");
  assert.equal(consequenceByOperation("pms.upload")?.availability, "implemented");
  assert.equal(consequenceByOperation("pms.delete")?.availability, "implemented");
});

test("implemented mutations declare a read-back verification rule", () => {
  const implemented = CONSEQUENCES.filter((entry) => entry.availability === "implemented");
  assert.ok(implemented.length > 0);
  assert.ok(implemented.every((entry) => entry.verification.trim().length > 0));
});

test("every advertised mutation maps to implemented consequence metadata", () => {
  const mutations = CAPABILITIES.filter((entry) => entry.kind === "mutation");
  assert.deepEqual(
    mutations.map((entry) => entry.command).sort(),
    Object.keys(MUTATION_CONSEQUENCES).sort(),
  );
  for (const mutation of mutations) {
    for (const operation of MUTATION_CONSEQUENCES[mutation.command] ?? []) {
      assert.equal(consequenceByOperation(operation)?.availability, "implemented", `${mutation.command} -> ${operation}`);
    }
  }
});
