import assert from "node:assert/strict";
import test from "node:test";
import { CliError } from "../core/errors.js";
import {
  renderError,
  renderSuccess,
  resolveOutputOptions,
} from "../core/output.js";

const result = {
  command: "tis courses search",
  data: { courses: [{ code: "CS101" }], total: 1 },
  text: "CS101  Introduction to CS",
  items: [{ code: "CS101" }],
  summary: { total: 1 },
};

test("text is the default output mode", () => {
  assert.deepEqual(resolveOutputOptions({}), { mode: "text", pretty: false });
  assert.equal(renderSuccess(result, { mode: "text", pretty: false }), "CS101  Introduction to CS\n");
});

test("JSON output uses a versioned envelope", () => {
  const value = JSON.parse(renderSuccess(result, { mode: "json", pretty: false }));
  assert.equal(value.schemaVersion, "1");
  assert.equal(value.ok, true);
  assert.equal(value.command, "tis courses search");
  assert.equal(value.data.total, 1);
});

test("JSONL emits item records followed by a summary", () => {
  const lines = renderSuccess(result, { mode: "jsonl", pretty: false })
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(lines.length, 2);
  assert.equal(lines[0].type, "item");
  assert.equal(lines[0].data.code, "CS101");
  assert.equal(lines[1].type, "summary");
  assert.equal(lines[1].data.total, 1);
});

test("text errors use stderr while JSON errors remain machine-readable on stdout", () => {
  const error = new CliError("bad input", "USAGE", 2);
  const text = renderError(error, "tis", { mode: "text", pretty: false });
  const json = renderError(error, "tis", { mode: "json", pretty: false });
  assert.equal(text.stream, "stderr");
  assert.match(text.output, /Error \[USAGE\]/);
  assert.equal(json.stream, "stdout");
  assert.equal(JSON.parse(json.output).error.code, "USAGE");
});

test("conflicting output selectors are rejected", () => {
  assert.throws(() => resolveOutputOptions({ json: true, jsonl: true }), /Choose only one output selector/);
});
