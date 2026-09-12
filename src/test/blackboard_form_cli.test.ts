import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("compiled bb submit CLI uses CAS and one HTTP form POST, including first-attempt 404 recovery", () => {
  const temp = mkdtempSync(join(tmpdir(), "sustech-bb-form-cli-"));
  try {
    const file = join(temp, "report.pdf");
    const textFile = join(temp, "answer.txt");
    writeFileSync(file, "fixture file bytes");
    // A UTF-8 BOM must survive decoding so the submitted input still matches its byte hash.
    writeFileSync(textFile, "\ufeff第一行 <literal>\nSecond & line");
    const trace = join(temp, "requests.txt");
    const run = (operation: string, source: string, mode = "normal") => {
      writeFileSync(trace, "");
      const args = ["bb", "submit", operation, "--course-id", "8343", "--content-id", "629896", source === file ? "--file" : "--text-file", source, "--comment", "Please <review>", "--json"];
      if (operation === "apply") args.push("--confirm", "--expected-sha256", createHash("sha256").update(readFileSync(source)).digest("hex"));
      const result = spawnSync(process.execPath, ["--import", new URL("./fixtures/blackboard-form-fetch.js", import.meta.url).href, fileURLToPath(new URL("../cli.js", import.meta.url)), ...args], {
        encoding: "utf8", timeout: 15000,
        env: { ...process.env, SUSTECH_SID: "fixture-student", SUSTECH_PASSWORD: "fixture-password", SUSTECH_TEST_BB_TRACE: trace, SUSTECH_TEST_BB_MODE: mode },
      });
      assert.doesNotMatch(result.stdout + result.stderr, /fixture-private-nonce|fixture-password/);
      return { ...result, envelope: JSON.parse(result.stdout), requests: readFileSync(trace, "utf8").trim().split("\n") };
    };
    const preview = run("preview", file);
    assert.equal(preview.status, 0, preview.stdout + preview.stderr);
    assert.equal(preview.envelope.data.applyAllowed, true);
    assert.equal(preview.envelope.data.attemptsUsed, 0);
    assert.equal(preview.requests.some((line) => line.startsWith("POST /webapps/assignment/")), false);
    for (const [source, mode] of [[file, "normal"], [textFile, "normal"], [file, "lost-response"]]) {
      const result = run("apply", source!, mode!);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.equal(result.envelope.data.verification.status, "confirmed");
      assert.equal(result.envelope.data.attempt.id, "2201");
      assert.equal(result.requests.filter((line) => line === "POST /webapps/assignment/uploadAssignment").length, 1);
      assert.equal(result.requests.some((line) => line.startsWith("POST /learn/api/")), false);
    }
    const redirected = run("apply", file, "redirect");
    assert.equal(redirected.status, 5, redirected.stdout + redirected.stderr);
    assert.equal(redirected.envelope.error.code, "BLACKBOARD_SUBMISSION_OUTCOME_UNKNOWN");
    assert.equal(redirected.envelope.error.details.upstream.status, 307);
    assert.equal(redirected.requests.filter((line) => line === "POST /webapps/assignment/uploadAssignment").length, 1);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
