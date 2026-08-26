import assert from "node:assert/strict";
import test from "node:test";
import { CAMPUS_RESOURCES, searchResources } from "../resources/catalog.js";

test("resource registry has stable unique IDs and HTTPS URLs", () => {
  assert.equal(new Set(CAMPUS_RESOURCES.map((entry) => entry.id)).size, CAMPUS_RESOURCES.length);
  assert.ok(CAMPUS_RESOURCES.every((entry) => new URL(entry.url).protocol === "https:"));
});

test("resource search filters by category and text", () => {
  const matches = searchResources("library", "academic");
  assert.ok(matches.length >= 2);
  assert.ok(matches.every((entry) => entry.category === "academic"));
});
