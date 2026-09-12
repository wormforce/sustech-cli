import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";

// Every request is intercepted. This fixture never calls the real network.
const origin = "https://bb.sustech.edu.cn";
const formPath = "/webapps/assignment/uploadAssignment";
const attemptsPath = "/learn/api/public/v2/courses/_8343_1/gradebook/columns/_991_1/attempts";
const formHtml = `<title>Upload Assignment: Fixture</title>
<form id="uploadAssignmentFormId" method="post" enctype="multipart/form-data" action="${formPath}?action=submit">
<input type="hidden" name="course_id" value="_8343_1"><input type="hidden" name="content_id" value="_629896_1">
<input type="hidden" name="attempt_id" value=""><input type="hidden" name="blackboard.platform.security.NonceUtil.nonce" value="fixture-private-nonce">
<textarea name="studentSubmission.text"></textarea><textarea name="student_comments"></textarea>
<input type="file" id="newFile_chooseLocalFile"></form>`;
let submitted = false;
let fileName = "";
let text = "";
let comment = "";
let postCount = 0;
function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}
function assignment() {
  return { id: "_991_1", contentId: "_629896_1", name: "Fixture", availability: { available: "Yes" }, grading: { type: "Attempts", attemptsAllowed: 2 }, scoreProviderHandle: "resource/x-bb-assignment" };
}

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  const method = init.method ?? "GET";
  const trace = process.env.SUSTECH_TEST_BB_TRACE;
  if (trace) appendFileSync(trace, `${method} ${url.pathname}\n`);
  if (url.hostname === "cas.sustech.edu.cn" && url.pathname === "/cas/login") {
    if (method === "GET") return new Response('<input name="execution" value="fixture-execution">');
    const response = new Response("Fixture login", { headers: { "set-cookie": "JSESSIONID=fixture-session; Path=/" } });
    Object.defineProperty(response, "url", { value: `${origin}/webapps/bb-sso-BBLEARN/index.jsp` });
    return response;
  }
  assert.equal(url.origin, origin, "Fixture must not reach another origin");
  if (method === "POST") {
    assert.equal(url.pathname, formPath, "Public REST writes must not be used");
    assert.equal(++postCount, 1, "A submission POST must never be replayed");
    const body = init.body as FormData;
    assert.equal(body.get("blackboard.platform.security.NonceUtil.nonce"), "fixture-private-nonce");
    assert.equal(body.get("dispatch"), "submit");
    if (process.env.SUSTECH_TEST_BB_MODE === "redirect") return new Response(null, { status: 307, headers: { location: `${origin}${formPath}?action=submit` } });
    const file = body.get("newFile_LocalFile0");
    fileName = file instanceof File ? file.name : "";
    text = String(body.get("studentSubmission.text") ?? "");
    comment = String(body.get("student_comments") ?? "");
    submitted = true;
    if (process.env.SUSTECH_TEST_BB_MODE === "lost-response") throw new TypeError("Fixture lost response");
    return json({ destinationUrl: `${formPath}?course_id=_8343_1&content_id=_629896_1&mode=DEFAULT` });
  }
  assert.equal(method, "GET");
  if (url.pathname === "/learn/api/public/v1/users/me") return json({ id: "_1_1" });
  if (url.pathname.endsWith("/gradebook/columns")) return json({ results: [assignment()] });
  if (url.pathname.endsWith("/gradebook/columns/_991_1")) return json(assignment());
  if (url.pathname.endsWith("/contents/_629896_1")) return json({ id: "_629896_1", title: "Fixture", contentHandler: { id: "resource/x-bb-assignment" } });
  if (url.pathname === attemptsPath) return submitted ? json({ results: [{ id: "_2201_1", status: "NeedsGrading" }] }) : json({ status: 404, message: "找不到指定对象。" }, 404);
  if (url.pathname === `${attemptsPath}/_2201_1`) return json({ id: "_2201_1", status: "NeedsGrading", studentSubmission: text, studentComments: comment, attemptReceipt: { receiptId: "fixture-receipt" } });
  if (url.pathname.endsWith("/attempts/_2201_1/files")) return json({ results: fileName ? [{ id: "_3301_1", name: fileName }] : [] });
  if (url.pathname === "/learn/api/public/v1/uploads/settings") return json({}, 404);
  if (url.pathname === formPath) {
    assert.ok(["view", null].includes(url.searchParams.get("mode")));
    return new Response(formHtml);
  }
  throw new Error(`Unexpected fixture request ${method} ${url.pathname}`);
};
