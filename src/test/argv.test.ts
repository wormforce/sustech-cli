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
  assert.equal(inferCommandName(["bb", "roster", "_8343_1", "--role", "Student", "--json"]), "bb roster");
  assert.equal(inferCommandName(["bb", "message-folders", "_8343_1", "--json"]), "bb message-folders");
  assert.equal(inferCommandName(["bb", "messages", "_8343_1", "--folder-type", "Inbox", "--json"]), "bb messages");
  assert.equal(inferCommandName(["bb", "message-participants", "_8343_1", "_71_1", "--json"]), "bb message-participants");
  assert.equal(inferCommandName(["bb", "message-send", "preview", "_8343_1", "--to-user", "_1_1", "--text-file", "/tmp/msg.txt", "--json"]), "bb message-send preview");
  assert.equal(inferCommandName(["bb", "discussions", "_8343_1", "--page", "2", "--json"]), "bb discussions");
  assert.equal(inferCommandName(["bb", "discussion-groups", "_8343_1", "_65_1", "--json"]), "bb discussion-groups");
  assert.equal(inferCommandName(["bb", "discussion", "_8343_1", "_65_1", "--status", "Published", "--json"]), "bb discussion");
  assert.equal(inferCommandName(["bb", "discussion-replies", "_8343_1", "_65_1", "_71_1", "--json"]), "bb discussion-replies");
  assert.equal(inferCommandName(["bb", "discussion-post", "preview", "_8343_1", "_65_1", "--text-file", "/tmp/post.txt", "--json"]), "bb discussion-post preview");
  assert.equal(inferCommandName(["bb", "discussion-reply", "apply", "_8343_1", "_65_1", "_71_1", "--text-file", "/tmp/reply.txt", "--expected-sha256", "a".repeat(64), "--confirm", "--json"]), "bb discussion-reply apply");
  assert.equal(inferCommandName(["academic", "snapshot", "save", "--destination", "/tmp/state.json", "--json"]), "academic snapshot save");
  assert.equal(inferCommandName(["academic", "snapshot", "diff", "before.json", "after.json", "--json"]), "academic snapshot diff");
  assert.equal(inferCommandName(["academic", "changes", "before.json", "after.json", "--json"]), "academic changes");
  assert.equal(inferCommandName(["academic", "watch", "--state", "/tmp/state.json", "--json"]), "academic watch");
  assert.equal(inferCommandName(["describe", "bb", "submit", "apply", "--json"]), "describe");
  assert.equal(inferCommandName(["library", "search", "machine learning", "--limit", "5", "--json"]), "library search");
  assert.equal(inferCommandName(["library", "detail", "L:alma991234567890106561", "--json"]), "library detail");
  assert.equal(inferCommandName(["online", "search", "AI", "--section", "talks", "--json"]), "online search");
  assert.equal(inferCommandName(["online", "talks", "search", "AI safety", "--limit", "5", "--json"]), "online talks search");
  assert.equal(inferCommandName(["online", "contact", "get", "teaching:教学工作部", "--json"]), "online contact get");
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
