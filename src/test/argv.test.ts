import assert from "node:assert/strict";
import test from "node:test";
import { inferCommandName } from "../core/argv.js";
import { inferOutputOptions } from "../core/output.js";

test("command inference skips option values in machine-readable errors", () => {
  assert.equal(inferCommandName(["version", "--output", "jsonl", "--json"]), "version");
  assert.equal(
    inferCommandName(["tis", "courses", "search", "machine learning", "--limit", "20", "--json"]),
    "tis courses search",
  );
  assert.equal(inferCommandName(["tis", "timetable", "CS101", "MA101", "--block", "MON:1-2"]), "tis timetable");
});

test("output inference accepts --output=value for parse failures", () => {
  assert.deepEqual(inferOutputOptions(["version", "--output=json"]), { mode: "json", pretty: false });
});
