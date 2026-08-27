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
  assert.equal(inferCommandName(["tis", "plan", "solve", "--path", "/tmp/plan.json", "--json"]), "tis plan solve");
  assert.equal(
    inferCommandName(["tis", "plan", "add", "--weight-gap-segment", "3", "--path", "/tmp/plan.json", "--json"]),
    "tis plan add",
  );
  assert.equal(inferCommandName(["tis", "degree", "audit", "--requirements", "/tmp/req.json", "--json"]), "tis degree audit");
  assert.equal(inferCommandName(["tis", "degree", "progress", "--details", "--json"]), "tis degree progress");
  assert.equal(inferCommandName(["tis", "degree", "missing", "--semester", "2026-2027-1", "--json"]), "tis degree missing");
  assert.equal(inferCommandName(["bb", "calendar", "--since", "2026-08-01T00:00:00Z", "--json"]), "bb calendar");
  assert.equal(inferCommandName(["bb", "calendar-link", "show", "--reveal", "--json"]), "bb calendar-link show");
  assert.equal(inferCommandName(["academic", "snapshot", "save", "--destination", "/tmp/state.json", "--json"]), "academic snapshot save");
  assert.equal(inferCommandName(["academic", "snapshot", "diff", "before.json", "after.json", "--json"]), "academic snapshot diff");
  assert.equal(inferCommandName(["profile", "show", "--profile", "personal", "--json"]), "profile show");
  assert.equal(inferCommandName(["profile", "export", "--destination", "/tmp/profile.json", "--overwrite", "--json"]), "profile export");
  assert.equal(inferCommandName(["auth", "login", "--profile", "personal", "--sid", "12410000"]), "auth login");
  assert.equal(
    inferCommandName(["bb", "download", "8537", "629896", "42588", "--destination", "/tmp/file.pdf", "--json"]),
    "bb download",
  );
});

test("output inference accepts --output=value for parse failures", () => {
  assert.deepEqual(inferOutputOptions(["version", "--output=json"]), { mode: "json", pretty: false });
});
