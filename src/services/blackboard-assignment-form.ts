import { createHash } from "node:crypto";
import { load } from "cheerio";
import { CliError } from "../core/errors.js";
import { recordValue, stringValue, type ServiceAdapter } from "./base.js";
import type { BlackboardSubmissionFile, BlackboardSubmissionText } from "./blackboard.js";

const ORIGIN = "https://bb.sustech.edu.cn";
const ASSIGNMENT_PATH = "/webapps/assignment/uploadAssignment";
const NONCE = "blackboard.platform.security.NonceUtil.nonce";

export interface BlackboardFormTarget {
  courseId: string;
  contentId: string;
}

export type BlackboardFormSubmission =
  | { kind: "file"; file: BlackboardSubmissionFile; bytes: Uint8Array }
  | { kind: "text"; textFile: BlackboardSubmissionText; text: string };

interface AssignmentForm {
  action: string;
  fields: URLSearchParams;
  textFields: Set<string>;
}

/** Only the normal view page may establish that this student has never submitted. */
export async function confirmBlackboardNoAttempts(
  adapter: ServiceAdapter,
  target: BlackboardFormTarget,
): Promise<boolean> {
  const response = await adapter.fetch(assignmentUrl(target, { mode: "view" }));
  if (!response.ok) return false;
  assertAssignmentResponseUrl(response, target);
  const html = await response.text();
  const $ = load(html);
  if (!/^(?:Upload Assignment|上传作业)\s*[:：]/i.test($("title").text().trim())) return false;
  if ($("#aggregateGradeForm, [name='attemptId'], [name='attempt_id']").toArray()
    .some((element) => element.attribs.id === "aggregateGradeForm" || Boolean($(element).val()))) return false;
  if ($("a[href]").toArray().some((element) => {
    const url = new URL($(element).attr("href") ?? "", ORIGIN);
    return Boolean(url.searchParams.get("attempt_id") || url.searchParams.get("attemptId"));
  })) return false;
  parseAssignmentForm(html, target);
  return true;
}

/** Uses one cookie session, a fresh form nonce, and exactly one multipart POST. */
export async function submitBlackboardOriginalForm(
  adapter: ServiceAdapter,
  target: BlackboardFormTarget,
  submission: BlackboardFormSubmission,
  options: { comment?: string; onStage?: (stage: "prepare_form" | "submit_form") => void } = {},
): Promise<void> {
  assertSubmissionHash(submission);
  options.onStage?.("prepare_form");
  const response = await adapter.fetch(assignmentUrl(target, { action: "newAttempt", group_id: "" }));
  if (!response.ok) throw formError("Blackboard could not load the assignment submission form.", response.status);
  assertAssignmentResponseUrl(response, target);
  const form = parseAssignmentForm(await response.text(), target);
  const body = new FormData();
  for (const [name, value] of form.fields) body.append(name, value);
  body.set("isAjaxSubmit", "true");
  body.set("dispatch", "submit");

  if (submission.kind === "file") {
    body.set("newFile_attachmentType", "L");
    body.set("newFile_fileId", "new");
    body.set("newFile_artifactFileId", "undefined");
    body.set("newFile_artifactType", "undefined");
    body.set("newFile_artifactTypeResourceKey", "undefined");
    body.set("newFile_linkTitle", submission.file.name);
    body.set("newFile_LocalFile0", new Blob([submission.bytes]), submission.file.name);
  } else {
    setEditorText(body, form, ["studentSubmission.text"], submission.text);
  }
  if (options.comment) setEditorText(body, form, ["student_comments", "studentComments.text"], options.comment);

  // Reject changed buffers even if a caller changed them while the form GET was pending.
  assertSubmissionHash(submission);
  options.onStage?.("submit_form");
  const posted = await adapter.fetch(form.action, {
    method: "POST",
    headers: { "x-requested-with": "XMLHttpRequest", origin: ORIGIN, referer: assignmentUrl(target, { action: "newAttempt", group_id: "" }) },
    body,
    redirect: "manual",
  });
  if (!posted.ok) throw formError("Blackboard rejected the assignment form POST.", posted.status);
  // Never include HTML, nonces, cookies, or the destination query in diagnostics.
  let raw: unknown;
  try { raw = await posted.json(); } catch {
    throw formError("Blackboard returned a non-JSON response to the assignment form POST.");
  }
  const destination = stringValue(recordValue(raw).destinationUrl);
  if (!destination) throw formError("Blackboard did not acknowledge the assignment form submission.");
  assertAssignmentUrl(destination, target);
}

function parseAssignmentForm(html: string, target: BlackboardFormTarget): AssignmentForm {
  const $ = load(html);
  const form = $("form#uploadAssignmentFormId");
  if (form.length !== 1
    || form.attr("method")?.toLowerCase() !== "post"
    || form.attr("enctype")?.toLowerCase() !== "multipart/form-data") {
    throw formError("Blackboard did not expose a supported Original assignment submission form.");
  }
  const action = new URL(form.attr("action") ?? "", ORIGIN);
  if (action.origin !== ORIGIN || action.pathname !== ASSIGNMENT_PATH || action.searchParams.get("action") !== "submit"
    || action.searchParams.getAll("action").length !== 1 || action.searchParams.get("group_id")
    || ["course_id", "content_id", "group_id"].some((key) => action.searchParams.getAll(key).length > 1)
    || [...action.searchParams.keys()].some((key) => !["action", "course_id", "content_id", "group_id"].includes(key))
    || action.username || action.password || action.hash) throw formError("Blackboard returned an unexpected assignment form action.");
  for (const key of ["course_id", "content_id"] as const) {
    const expected = canonicalId(key === "course_id" ? target.courseId : target.contentId);
    if (action.searchParams.has(key) && action.searchParams.get(key) !== expected) {
      throw formError("Blackboard returned a form action for a different assignment.");
    }
  }
  const fields = new URLSearchParams();
  form.find("input[type=hidden][name]").each((_, element) => {
    if (!$(element).is(":disabled")) fields.append($(element).attr("name")!, $(element).attr("value") ?? "");
  });
  for (const [name, expected] of [["course_id", canonicalId(target.courseId)], ["content_id", canonicalId(target.contentId)]]) {
    if (fields.getAll(name).length !== 1 || fields.get(name) !== expected) {
      throw formError("Blackboard returned a submission form for a different or ambiguous assignment.");
    }
  }
  if (fields.getAll(NONCE).length !== 1 || !fields.get(NONCE)
    || fields.getAll("attempt_id").length !== 1 || fields.get("attempt_id") !== ""
    || fields.getAll("attemptId").some(Boolean)
    || fields.getAll("group_id").some(Boolean)
    || form.find("#newFile_chooseLocalFile[type=file]").length !== 1) {
    throw formError("Blackboard's form has no usable nonce, resumes an attempt, or is not an individual file/text assignment.");
  }
  const textFields = new Set<string>();
  form.find("textarea[name]").each((_, element) => {
    const name = $(element).attr("name")!;
    if (textFields.has(name) || fields.has(name)) throw formError("Blackboard returned ambiguous editor fields.");
    textFields.add(name);
    const value = $(element).val();
    if (typeof value === "string" && value.trim()) throw formError("Blackboard's form contains an existing draft; it will not be overwritten.");
    fields.append(name, "");
  });
  return { action: action.toString(), fields, textFields };
}

function setEditorText(body: FormData, form: AssignmentForm, names: string[], text: string): void {
  const name = names.find((entry) => form.textFields.has(entry));
  if (!name) throw formError("Blackboard did not expose the required text/comment editor field.");
  body.set(name, text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\r\n?|\n/g, "<br />"));
}

function assertSubmissionHash(submission: BlackboardFormSubmission): void {
  const bytes = submission.kind === "file" ? submission.bytes : Buffer.from(submission.text, "utf8");
  const source = submission.kind === "file" ? submission.file : submission.textFile;
  if (bytes.byteLength !== source.size || createHash("sha256").update(bytes).digest("hex") !== source.sha256) {
    throw new CliError("The Blackboard submission bytes no longer match the reviewed SHA-256.", "BLACKBOARD_FILE_CHANGED", 4);
  }
}

function assignmentUrl(target: BlackboardFormTarget, query: Record<string, string>): string {
  const url = new URL(ASSIGNMENT_PATH, ORIGIN);
  url.searchParams.set("course_id", canonicalId(target.courseId));
  url.searchParams.set("content_id", canonicalId(target.contentId));
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return url.toString();
}

function assertAssignmentResponseUrl(response: Response, target: BlackboardFormTarget): void {
  if (response.url) assertAssignmentUrl(response.url, target);
}

function assertAssignmentUrl(value: string, target: BlackboardFormTarget): void {
  let url: URL;
  try { url = new URL(value, ORIGIN); } catch { throw formError("Blackboard returned an invalid assignment URL."); }
  if (url.origin !== ORIGIN || url.pathname !== ASSIGNMENT_PATH || url.username || url.password
    || url.searchParams.getAll("course_id").length !== 1 || url.searchParams.get("course_id") !== canonicalId(target.courseId)
    || url.searchParams.getAll("content_id").length !== 1 || url.searchParams.get("content_id") !== canonicalId(target.contentId)) {
    throw formError("Blackboard returned a URL for an unexpected assignment.");
  }
}

function canonicalId(value: string): string {
  if (/^_\d+_1$/.test(value)) return value;
  if (/^\d+$/.test(value)) return `_${value}_1`;
  throw formError("Original assignment forms require an exact Blackboard course/content ID.");
}

function formError(message: string, status?: number): CliError {
  return new CliError(message, "BLACKBOARD_SUBMISSION_FORM_ERROR", 4, {
    path: ASSIGNMENT_PATH,
    ...(status !== undefined ? { status } : {}),
  });
}
