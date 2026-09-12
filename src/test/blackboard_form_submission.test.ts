import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { CliError } from "../core/errors.js";
import { confirmBlackboardNoAttempts, submitBlackboardOriginalForm, type BlackboardFormSubmission } from "../services/blackboard-assignment-form.js";
import { applyBlackboardOriginalSubmission } from "../services/blackboard-submission.js";
import { listBlackboardAttempts } from "../services/blackboard.js";
import type { ServiceAdapter } from "../services/base.js";

const origin = "https://bb.sustech.edu.cn";
const target = { courseId: "8343", contentId: "629896", columnId: "991" };
const attemptsPath = "/learn/api/public/v2/courses/_8343_1/gradebook/columns/_991_1/attempts";
const formPath = "/webapps/assignment/uploadAssignment";
const formHtml = `<!doctype html><title>上传作业: Report</title>
<form id="uploadAssignmentFormId" method="post" enctype="multipart/form-data" action="${formPath}?action=submit">
<input type="hidden" name="course_id" value="_8343_1">
<input type="hidden" name="content_id" value="_629896_1">
<input type="hidden" name="attempt_id" value="">
<input type="hidden" name="blackboard.platform.security.NonceUtil.nonce" value="fixture-private-nonce">
<input type="hidden" name="blackboard.platform.security.NonceUtil.nonce.ajax" value="fixture-ajax-nonce">
<input type="hidden" name="studentSubmission.text_f" value="fixture-editor-reference">
<input type="hidden" name="studentSubmission.type" value="H">
<input type="hidden" name="student_commentstype" value="H">
<input type="hidden" name="group_id" value="">
<textarea name="studentSubmission.text"></textarea><textarea name="student_comments"></textarea>
<input type="file" id="newFile_chooseLocalFile"></form>`;

function fileInput(): Extract<BlackboardFormSubmission, { kind: "file" }> {
  const bytes = new TextEncoder().encode("reviewed file bytes");
  return { kind: "file", bytes, file: { path: "/tmp/report.pdf", absolutePath: "/tmp/report.pdf", name: "report.pdf", size: bytes.length, sha256: hash(bytes) } };
}
function textInput(): Extract<BlackboardFormSubmission, { kind: "text" }> {
  const text = "第一行 <literal>\nSecond & line";
  return { kind: "text", text, textFile: { path: "/tmp/answer.txt", absolutePath: "/tmp/answer.txt", size: Buffer.byteLength(text), sha256: hash(Buffer.from(text)), charCount: [...text].length } };
}
function hash(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
function json(data: unknown, status = 200): Response { return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } }); }
function adapter(route: (url: URL, init: RequestInit) => Response | Promise<Response>): ServiceAdapter {
  return { name: "offline-fixture", fetch: (url, init = {}) => Promise.resolve(route(new URL(url), init)) };
}
function acknowledgement(): Response { return json({ destinationUrl: `${formPath}?course_id=_8343_1&content_id=_629896_1&mode=DEFAULT` }); }

test("Original submission sends one multipart POST with the fresh nonce, exact file and picker fields", async () => {
  const input = fileInput();
  const calls: string[] = [];
  await submitBlackboardOriginalForm(adapter(async (url, init) => {
    calls.push(`${init.method ?? "GET"} ${url.pathname}`);
    assert.equal(url.pathname, formPath);
    if (!init.method) {
      assert.equal(url.searchParams.get("action"), "newAttempt");
      return new Response(formHtml);
    }
    assert.equal(init.method, "POST");
    assert.equal(init.redirect, "manual");
    const headers = new Headers(init.headers);
    assert.equal(headers.get("content-type"), null); // FormData supplies the boundary.
    assert.equal(headers.get("x-requested-with"), "XMLHttpRequest");
    const body = init.body as FormData;
    assert.equal(body.get("blackboard.platform.security.NonceUtil.nonce"), "fixture-private-nonce");
    assert.equal(body.get("blackboard.platform.security.NonceUtil.nonce.ajax"), "fixture-ajax-nonce");
    assert.equal(body.get("dispatch"), "submit");
    assert.equal(body.get("isAjaxSubmit"), "true");
    assert.equal(body.get("attempt_id"), "");
    assert.equal(body.get("newFile_attachmentType"), "L");
    assert.equal(body.get("newFile_fileId"), "new");
    assert.equal(body.get("newFile_linkTitle"), input.file.name);
    const file = body.get("newFile_LocalFile0") as File;
    assert.equal(file.name, input.file.name);
    assert.equal(hash(new Uint8Array(await file.arrayBuffer())), input.file.sha256);
    return acknowledgement();
  }), target, input);
  assert.deepEqual(calls, [`GET ${formPath}`, `POST ${formPath}`]);
});

test("Original text and comment submissions fill exposed editor fields with escaped text", async () => {
  await submitBlackboardOriginalForm(adapter((_, init) => {
    if (!init.method) return new Response(formHtml);
    const body = init.body as FormData;
    assert.equal(body.get("studentSubmission.text"), "第一行 &lt;literal&gt;<br />Second &amp; line");
    assert.equal(body.get("student_comments"), "Please &lt;review&gt;");
    assert.equal(body.has("newFile_LocalFile0"), false);
    return acknowledgement();
  }), target, textInput(), { comment: "Please <review>" });
});

test("changed buffers are rejected before the GET and again before the submission POST", async () => {
  const input = fileInput();
  input.bytes[0] = 0;
  await assert.rejects(submitBlackboardOriginalForm(adapter(() => { throw Error("must not fetch"); }), target, input), { code: "BLACKBOARD_FILE_CHANGED" });
  const pending = fileInput();
  let calls = 0;
  await assert.rejects(submitBlackboardOriginalForm(adapter(() => {
    calls += 1; pending.bytes[0] = 0; return new Response(formHtml);
  }), target, pending), { code: "BLACKBOARD_FILE_CHANGED" });
  assert.equal(calls, 1);
});

test("invalid, foreign, resumed, grouped and draft-bearing forms cannot send a submission POST", async () => {
  const invalidForms = [
    "<title>Login</title>",
    formHtml.replace('value="_8343_1"', 'value="_9000_1"'),
    formHtml.replace(`action="${formPath}`, 'action="https://evil.example/steal'),
    formHtml.replace('action=submit"', 'action=submit&course_id=_8343_1&course_id=_9000_1"'),
    formHtml.replace('value="fixture-private-nonce"', 'value=""'),
    formHtml.replace('name="attempt_id" value=""', 'name="attempt_id" value="_2200_1"'),
    formHtml.replace('name="group_id" value=""', 'name="group_id" value="_5_1"'),
    formHtml.replace('<textarea name="studentSubmission.text"></textarea>', '<textarea name="studentSubmission.text">existing draft</textarea>'),
    formHtml.replace('</form>', '<input type="hidden" name="course_id" value="_8343_1"></form>'),
  ];
  for (const html of invalidForms) {
    let posts = 0;
    await assert.rejects(submitBlackboardOriginalForm(adapter((_, init) => {
      if (init.method === "POST") posts += 1;
      return new Response(html);
    }), target, fileInput()), { code: "BLACKBOARD_SUBMISSION_FORM_ERROR" });
    assert.equal(posts, 0);
  }
});

test("only a matching first-upload view form corroborates an empty attempt history", async () => {
  const read = adapter((url, init) => {
    assert.equal(init.method, undefined);
    assert.equal(url.searchParams.get("mode"), "view");
    assert.equal(url.searchParams.has("action"), false);
    return new Response(formHtml);
  });
  assert.equal(await confirmBlackboardNoAttempts(read, target), true);
  for (const html of [formHtml.replace("上传作业:", "复查提交历史记录:"), '<title>项目不可用</title>', formHtml + '<form id="aggregateGradeForm"></form>', formHtml + '<a href="?attempt_id=_2200_1">previous attempt</a>']) {
    assert.equal(await confirmBlackboardNoAttempts(adapter(() => new Response(html)), target), false);
  }
});

function attemptsAdapter(html = formHtml, options: { laterPage?: boolean; hiddenColumn?: boolean; status?: number } = {}): ServiceAdapter {
  return adapter((url) => {
    if (url.pathname.endsWith("/users/me")) return json({ id: "_1_1" });
    if (url.pathname === attemptsPath) {
      if (options.laterPage && !url.searchParams.has("offset")) return json({ results: [{ id: "_2200_1" }], paging: { nextPage: `${attemptsPath}?offset=1` } });
      throw new CliError("Blackboard request failed.", "SERVICE_HTTP_ERROR", 1, { status: options.status ?? 404, path: attemptsPath });
    }
    if (url.pathname.endsWith("/columns/_991_1")) {
      assert.equal(options.laterPage, undefined);
      return json({ id: "_991_1", contentId: "_629896_1", availability: { available: options.hiddenColumn ? "No" : "Yes" }, grading: { type: "Attempts" }, scoreProviderHandle: "resource/x-bb-assignment" });
    }
    if (url.pathname.endsWith("/contents/_629896_1")) return json({ id: "_629896_1", contentHandler: { id: "resource/x-bb-assignment" } });
    if (url.pathname === formPath) {
      assert.equal(url.searchParams.get("mode"), "view");
      return new Response(html);
    }
    throw Error(`Unexpected fixture URL ${url.pathname}`);
  });
}

test("initial attempts 404 becomes empty only after accessible column/content and a blank matching view form", async () => {
  assert.deepEqual(await listBlackboardAttempts(attemptsAdapter(), "8343", "991"), []);
  for (const fixture of [attemptsAdapter("<title>Login</title>"), attemptsAdapter(formHtml, { hiddenColumn: true }), attemptsAdapter(formHtml, { laterPage: true }), attemptsAdapter(formHtml, { status: 403 })]) {
    await assert.rejects(listBlackboardAttempts(fixture, "8343", "991"), { code: "SERVICE_HTTP_ERROR" });
  }
});

function writeFlow(options: { postError?: boolean; oldOnly?: boolean; multiple?: boolean; wrongFile?: boolean; inProgress?: boolean; preparationError?: boolean; comment?: string; text?: string } = {}) {
  let posts = 0;
  const fixture = adapter((url, init) => {
    if (url.pathname === formPath) {
      if (!init.method) return new Response(formHtml, { status: options.preparationError ? 403 : 200 });
      posts += 1;
      if (options.postError) throw new CliError("Blackboard request failed.", "SERVICE_HTTP_ERROR", 1, { status: 404, path: `${formPath}?nonce=must-not-leak`, bodySample: "private nonce and draft" });
      return acknowledgement();
    }
    if (url.pathname.endsWith("/users/me")) return json({ id: "_1_1" });
    if (url.pathname === attemptsPath) return json({ results: [{ id: "_2200_1" }, ...(!options.oldOnly ? [{ id: "_2201_1" }] : []), ...(options.multiple ? [{ id: "_2202_1" }] : [])] });
    if (url.pathname === `${attemptsPath}/_2201_1`) return json({ id: "_2201_1", status: options.inProgress ? "InProgress" : "NeedsGrading", studentSubmission: options.text ?? "", studentComments: options.comment ?? "", attemptReceipt: { receiptId: "fixture-receipt" } });
    if (url.pathname.endsWith("/attempts/_2201_1/files")) return json({ results: [{ id: "_3301_1", name: options.wrongFile ? "other.pdf" : "report.pdf" }] });
    throw Error(`Unexpected fixture URL ${url.pathname}`);
  });
  return { adapter: fixture, posts: () => posts };
}

test("form apply verifies exactly one new attempt and can recover a lost POST response without resending", async () => {
  for (const postError of [false, true]) {
    const flow = writeFlow({ postError });
    const result = await applyBlackboardOriginalSubmission(flow.adapter, target, fileInput(), [{ id: "2200" }]);
    assert.equal(result.attempt.id, "2201");
    assert.equal(result.attempt.attemptReceipt?.receiptId, "fixture-receipt");
    assert.equal(result.verification.status, "confirmed");
    assert.equal(result.recoveredAfterError, postError);
    assert.equal(flow.posts(), 1);
  }
});

test("old same-named submissions, multiple new attempts and mismatched read-back remain uncertain", async () => {
  for (const options of [{ oldOnly: true, postError: true }, { multiple: true }, { wrongFile: true }, { inProgress: true }]) {
    const flow = writeFlow(options);
    await assert.rejects(applyBlackboardOriginalSubmission(flow.adapter, target, fileInput(), [{ id: "2200" }]), (error: unknown) => {
      assert.ok(error instanceof CliError);
      assert.equal(error.code, "BLACKBOARD_SUBMISSION_OUTCOME_UNKNOWN");
      assert.equal(error.exitCode, 5);
      assert.equal(error.details?.warning, "DO_NOT_RETRY_AUTOMATICALLY");
      if (options.postError) assert.deepEqual(error.details?.upstream, { code: "SERVICE_HTTP_ERROR", message: "Blackboard request failed.", path: formPath, status: 404 });
      assert.doesNotMatch(JSON.stringify(error.details), /must-not-leak|private nonce/);
      return true;
    });
    assert.equal(flow.posts(), 1);
  }
});

test("text and comment read-back compare decoded plain text including literal angle brackets", async () => {
  const flow = writeFlow({ text: "第一行 &lt;literal&gt;<br />Second &amp; line", comment: "Please &lt;review&gt;" });
  const result = await applyBlackboardOriginalSubmission(flow.adapter, target, textInput(), [{ id: "2200" }], { comment: "Please <review>" });
  assert.equal(result.verification.status, "confirmed");
  assert.equal(flow.posts(), 1);
  const noComment = writeFlow();
  await assert.rejects(applyBlackboardOriginalSubmission(noComment.adapter, target, fileInput(), [{ id: "2200" }], { comment: "required comment" }), { code: "BLACKBOARD_SUBMISSION_OUTCOME_UNKNOWN" });
});

test("form preparation failure reports its HTTP status and sends no submission POST", async () => {
  const flow = writeFlow({ preparationError: true });
  await assert.rejects(applyBlackboardOriginalSubmission(flow.adapter, target, fileInput(), []), (error: unknown) => {
    assert.ok(error instanceof CliError);
    assert.equal(error.code, "BLACKBOARD_SUBMISSION_PREPARATION_FAILED");
    assert.equal(error.details?.submissionPostSent, false);
    assert.equal((error.details?.upstream as { status: number }).status, 403);
    return true;
  });
  assert.equal(flow.posts(), 0);
});
