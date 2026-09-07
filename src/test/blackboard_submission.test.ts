import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  attachBlackboardAttemptFile,
  createBlackboardAttempt,
  downloadBlackboardAttemptFile,
  evaluateBlackboardSubmissionPreflight,
  getBlackboardAttempt,
  getBlackboardUploadSettings,
  inspectBlackboardSubmissionFile,
  inspectBlackboardSubmissionTextFile,
  listBlackboardAttemptFiles,
  listBlackboardAttempts,
  publicBlackboardAttemptFile,
  readBlackboardSubmissionPayload,
  readBlackboardSubmissionTextPayload,
  updateBlackboardAttempt,
  uploadBlackboardTemporaryFile,
} from "../services/blackboard.js";
import type { ServiceAdapter } from "../services/base.js";

test("Blackboard submission helpers follow the official attempt/upload/file flow", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "sustech-bb-"));
  const filePath = join(tempDir, "report.pdf");
  await writeFile(filePath, "%PDF-1.7\nmock", "utf8");

  try {
    const calls: string[] = [];
    const adapter = routeAdapter(async (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);

      if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/uploads/settings") {
        return jsonResponse({ supportsInlineRender: true, maxUploadSizeInBytes: 1024 });
      }
      if (url === "https://bb.sustech.edu.cn/learn/api/public/v2/courses/_8343_1/gradebook/columns/_991_1/attempts" && (init?.method ?? "GET") === "POST") {
        assert.equal(new Headers(init?.headers).get("content-type"), "application/json");
        assert.deepEqual(JSON.parse(String(init?.body)), { status: "InProgress" });
        return jsonResponse({
          id: "_2201_1",
          userId: "_1_1",
          status: "InProgress",
          created: "2026-08-26T10:00:00.000Z",
        }, 201);
      }
      if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/uploads") {
        assert.equal(init?.method, "POST");
        const form = init?.body;
        assert.ok(form instanceof FormData);
        const uploaded = form.get("file");
        assert.ok(uploaded instanceof File);
        assert.equal(uploaded.name, "report.pdf");
        assert.equal(await uploaded.text(), "%PDF-1.7\nmock");
        return jsonResponse({ id: "upload-1" }, 201);
      }
      if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8343_1/gradebook/attempts/_2201_1/files" && init?.method === "POST") {
        assert.deepEqual(JSON.parse(String(init.body)), {
          name: "report.pdf",
          uploadId: "upload-1",
        });
        return jsonResponse({
          id: "_3301_1",
          name: "report.pdf",
          downloadUrl: "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8343_1/gradebook/attempts/_2201_1/files/_3301_1/download",
        }, 201);
      }
      if (url === "https://bb.sustech.edu.cn/learn/api/public/v2/courses/_8343_1/gradebook/columns/_991_1/attempts/_2201_1" && init?.method === "PATCH") {
        assert.deepEqual(JSON.parse(String(init.body)), {
          status: "NeedsGrading",
          studentComments: "please grade",
        });
        return jsonResponse({
          id: "_2201_1",
          userId: "_1_1",
          status: "NeedsGrading",
          studentComments: "please grade",
          attemptReceipt: {
            receiptId: "receipt-1",
            submissionDate: "2026-08-26T10:01:00.000Z",
          },
        });
      }
      if (url === "https://bb.sustech.edu.cn/learn/api/public/v2/courses/_8343_1/gradebook/columns/_991_1/attempts/_2201_1") {
        return jsonResponse({
          id: "_2201_1",
          userId: "_1_1",
          status: "NeedsGrading",
          studentComments: "please grade",
          attemptReceipt: {
            receiptId: "receipt-1",
            submissionDate: "2026-08-26T10:01:00.000Z",
            submissionTotalSize: 12,
            courseId: "_8343_1",
            gradableItemId: "_991_1",
            attemptId: "_2201_1",
            userId: "_1_1",
            responseStatus: "ReceiptAndAttemptExist",
            submissionType: "ManuallySubmitted",
          },
        });
      }
      if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/users/me") {
        return jsonResponse({ id: "_1_1", userName: "12200000", name: "Student Name" });
      }
      if (url === "https://bb.sustech.edu.cn/learn/api/public/v2/courses/_8343_1/gradebook/columns/_991_1/attempts?userId=_1_1") {
        return jsonResponse({
          results: [{
            id: "_2201_1",
            userId: "_1_1",
            status: "NeedsGrading",
            created: "2026-08-26T10:00:00.000Z",
            attemptReceipt: {
              receiptId: "receipt-1",
              submissionDate: "2026-08-26T10:01:00.000Z",
            },
          }],
        });
      }
      if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8343_1/gradebook/attempts/_2201_1/files") {
        return jsonResponse({
          results: [{
            id: "_3301_1",
            name: "report.pdf",
            downloadUrl: "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8343_1/gradebook/attempts/_2201_1/files/_3301_1/download",
          }],
        });
      }

      throw new Error(`Unexpected URL ${url}`);
    });

    const payload = await readBlackboardSubmissionPayload(filePath);
    const file = payload.file;
    assert.equal(file.name, "report.pdf");
    assert.equal(file.size, 13);
    assert.match(file.sha256, /^[0-9a-f]{64}$/);

    const settings = await getBlackboardUploadSettings(adapter);
    assert.equal(settings.maxUploadSizeInBytes, 1024);

    const created = await createBlackboardAttempt(adapter, "8343", "991");
    assert.equal(created.id, "2201");

    const uploaded = await uploadBlackboardTemporaryFile(adapter, file, payload.bytes);
    assert.equal(uploaded.id, "upload-1");

    const attached = await attachBlackboardAttemptFile(adapter, "8343", "2201", {
      name: file.name,
      uploadId: uploaded.id,
    });
    assert.equal(attached.id, "3301");

    const submitted = await updateBlackboardAttempt(adapter, "8343", "991", "2201", {
      status: "NeedsGrading",
      studentComments: "please grade",
    });
    assert.equal(submitted.status, "NeedsGrading");
    assert.equal(submitted.attemptReceipt?.receiptId, "receipt-1");

    const readBack = await getBlackboardAttempt(adapter, "8343", "991", "2201");
    assert.equal(readBack.attemptReceipt?.submissionType, "ManuallySubmitted");

    const attempts = await listBlackboardAttempts(adapter, "8343", "991");
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0]?.id, "2201");

    const files = await listBlackboardAttemptFiles(adapter, "8343", "2201");
    assert.deepEqual(files, [{
      id: "3301",
      name: "report.pdf",
      viewUrl: "",
      downloadUrl: "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8343_1/gradebook/attempts/_2201_1/files/_3301_1/download",
    }]);

    assert.deepEqual(calls.slice(0, 8), [
      "GET https://bb.sustech.edu.cn/learn/api/public/v1/uploads/settings",
      "POST https://bb.sustech.edu.cn/learn/api/public/v2/courses/_8343_1/gradebook/columns/_991_1/attempts",
      "POST https://bb.sustech.edu.cn/learn/api/public/v1/uploads",
      "POST https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8343_1/gradebook/attempts/_2201_1/files",
      "PATCH https://bb.sustech.edu.cn/learn/api/public/v2/courses/_8343_1/gradebook/columns/_991_1/attempts/_2201_1",
      "GET https://bb.sustech.edu.cn/learn/api/public/v2/courses/_8343_1/gradebook/columns/_991_1/attempts/_2201_1",
      "GET https://bb.sustech.edu.cn/learn/api/public/v1/users/me",
      "GET https://bb.sustech.edu.cn/learn/api/public/v2/courses/_8343_1/gradebook/columns/_991_1/attempts?userId=_1_1",
    ]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("Blackboard attempt-file reads and downloads use the official attempt-files endpoint", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "sustech-bb-attempt-file-"));
  const destination = join(tempDir, "submitted-report.pdf");
  try {
    const calls: string[] = [];
    const adapter = routeAdapter((url) => {
      calls.push(url);
      if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8343_1/gradebook/attempts/_2201_1/files") {
        return jsonResponse({
          results: [{
            id: "_3301_1",
            name: "report.pdf",
            viewUrl: "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8343_1/gradebook/attempts/_2201_1/files/_3301_1",
            downloadUrl: "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8343_1/gradebook/attempts/_2201_1/files/_3301_1/download",
          }],
        });
      }
      if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8343_1/gradebook/attempts/_2201_1/files/_3301_1/download") {
        return new Response("%PDF-1.7\nsubmitted", {
          status: 200,
          headers: {
            "content-type": "application/pdf",
            "content-length": "18",
          },
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    const files = await listBlackboardAttemptFiles(adapter, "8343", "2201");
    assert.deepEqual(files, [{
      id: "3301",
      name: "report.pdf",
      viewUrl: "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8343_1/gradebook/attempts/_2201_1/files/_3301_1",
      downloadUrl: "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8343_1/gradebook/attempts/_2201_1/files/_3301_1/download",
    }]);

    const downloaded = await downloadBlackboardAttemptFile(adapter, "8343", "2201", "3301", destination);
    assert.equal(downloaded.file.id, "3301");
    assert.equal(downloaded.file.name, "report.pdf");
    assert.equal(downloaded.destination, destination);
    assert.equal(downloaded.size, 18);
    assert.equal(downloaded.contentType, "application/pdf");
    assert.equal(downloaded.overwritten, false);
    assert.match(downloaded.sha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(calls, [
      "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8343_1/gradebook/attempts/_2201_1/files",
      "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8343_1/gradebook/attempts/_2201_1/files",
      "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8343_1/gradebook/attempts/_2201_1/files/_3301_1/download",
    ]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("Blackboard attempt-file downloads synthesize the official download endpoint when metadata omits downloadUrl", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "sustech-bb-attempt-file-fallback-"));
  const destination = join(tempDir, "submitted-report.pdf");
  try {
    const calls: string[] = [];
    const adapter = routeAdapter((url) => {
      calls.push(url);
      if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8343_1/gradebook/attempts/_2201_1/files") {
        return jsonResponse({
          results: [{
            id: "_3301_1",
            name: "report.pdf",
          }],
        });
      }
      if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8343_1/gradebook/attempts/_2201_1/files/_3301_1/download") {
        return new Response("%PDF-1.7\nsubmitted", {
          status: 200,
          headers: {
            "content-type": "application/pdf",
            "content-length": "18",
          },
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    const files = await listBlackboardAttemptFiles(adapter, "8343", "2201");
    assert.deepEqual(files, [{
      id: "3301",
      name: "report.pdf",
      viewUrl: "",
      downloadUrl: "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8343_1/gradebook/attempts/_2201_1/files/_3301_1/download",
    }]);

    const downloaded = await downloadBlackboardAttemptFile(adapter, "8343", "2201", "3301", destination);
    assert.equal(downloaded.file.id, "3301");
    assert.equal(downloaded.file.name, "report.pdf");
    assert.equal(downloaded.destination, destination);
    assert.equal(downloaded.size, 18);
    assert.equal(downloaded.contentType, "application/pdf");
    assert.equal(downloaded.overwritten, false);
    assert.match(downloaded.sha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(calls, [
      "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8343_1/gradebook/attempts/_2201_1/files",
      "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8343_1/gradebook/attempts/_2201_1/files",
      "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8343_1/gradebook/attempts/_2201_1/files/_3301_1/download",
    ]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("Blackboard attempt-file downloads report unavailable when the official download endpoint is missing", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "sustech-bb-attempt-file-unavailable-"));
  const destination = join(tempDir, "submitted-report.pdf");
  try {
    const adapter = routeAdapter((url) => {
      if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8343_1/gradebook/attempts/_2201_1/files") {
        return jsonResponse({
          results: [{
            id: "_3301_1",
            name: "report.pdf",
          }],
        });
      }
      if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8343_1/gradebook/attempts/_2201_1/files/_3301_1/download") {
        return new Response("", { status: 404 });
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    await assert.rejects(
      () => downloadBlackboardAttemptFile(adapter, "8343", "2201", "3301", destination),
      (error: unknown) => Boolean(
        error
        && typeof error === "object"
        && "code" in error
        && error.code === "BLACKBOARD_ATTEMPT_FILE_UNAVAILABLE"
      ),
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("Blackboard attempt-file reads reject unsafe URLs", async () => {
  const adapter = routeAdapter((url) => {
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8343_1/gradebook/attempts/_2201_1/files") {
      return jsonResponse({
        results: [{
          id: "_3301_1",
          name: "report.pdf",
          downloadUrl: "https://evil.example/download",
        }],
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  await assert.rejects(
    listBlackboardAttemptFiles(adapter, "8343", "2201"),
    (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "UNSAFE_SERVICE_URL"),
  );
});

test("Blackboard public attempt-file output omits view and download URLs", () => {
  assert.deepEqual(
    publicBlackboardAttemptFile({
      id: "3301",
      name: "report.pdf",
      viewUrl: "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8343_1/gradebook/attempts/_2201_1/files/_3301_1",
      downloadUrl: "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8343_1/gradebook/attempts/_2201_1/files/_3301_1/download",
    }),
    {
      id: "3301",
      name: "report.pdf",
    },
  );
});

test("Blackboard submission preflight surfaces blockers and late-submission warnings", () => {
  const preflight = evaluateBlackboardSubmissionPreflight({
    assignment: {
      id: "991",
      contentId: "629896",
      title: "Homework 1",
      availability: "Yes",
      grading: {
        type: "Attempts",
        due: "2026-08-20T12:00:00.000Z",
        attemptsAllowed: 1,
        scoringModel: "Last",
      },
      scoreProviderHandle: "resource/x-bb-assignment",
    },
    content: {
      id: "629896",
      parentId: "0",
      title: "Homework 1",
      handler: "resource/x-bb-assignment",
      kind: "assignment",
      hasChildren: false,
    },
    attempts: [{
      id: "2201",
      userId: "_1_1",
      status: "InProgress",
      readyToPost: false,
      studentComments: "",
      studentSubmission: "",
      created: "2026-08-25T10:00:00.000Z",
      modified: "2026-08-25T10:00:00.000Z",
      attemptDate: "2026-08-25T10:00:00.000Z",
    }],
    submission: {
      kind: "file",
      file: {
        path: "report.pdf",
        absolutePath: "/tmp/report.pdf",
        name: "report.pdf",
        size: 2048,
        sha256: "0".repeat(64),
      },
    },
    uploadSettings: {
      supportsInlineRender: true,
      maxUploadSizeInBytes: 1024,
    },
    now: new Date("2026-08-26T00:00:00.000Z"),
  });

  assert.equal(preflight.ready, false);
  assert.equal(preflight.late, true);
  assert.equal(preflight.attemptsUsed, 1);
  assert.equal(preflight.attemptsAllowed, 1);
  assert.deepEqual(preflight.inProgressAttemptIds, ["2201"]);
  assert.deepEqual(preflight.blockers.map((entry) => entry.code), [
    "IN_PROGRESS_ATTEMPT_EXISTS",
    "ATTEMPT_LIMIT_REACHED",
    "FILE_TOO_LARGE",
  ]);
  assert.deepEqual(preflight.warnings.map((entry) => entry.code), ["LATE_SUBMISSION"]);

  const unsupported = evaluateBlackboardSubmissionPreflight({
    assignment: {
      id: "992",
      contentId: "629897",
      title: "Ultra assessment",
      availability: "Yes",
      grading: { type: "Attempts", attemptsAllowed: 1, scoringModel: "Last" },
      scoreProviderHandle: "resource/x-bb-assessment",
    },
    content: {
      id: "629897",
      parentId: "0",
      title: "Ultra assessment",
      handler: "resource/x-bb-asmt-test-link",
      kind: "assignment",
      hasChildren: false,
    },
    attempts: [],
    submission: {
      kind: "text",
      text: {
        path: "answer.txt",
        absolutePath: "/tmp/answer.txt",
        size: 10,
        sha256: "1".repeat(64),
        charCount: 10,
      },
    },
    uploadSettings: { supportsInlineRender: true, maxUploadSizeInBytes: 1024 },
    now: new Date("2026-08-26T00:00:00.000Z"),
  });
  assert.equal(unsupported.ready, true);
  assert.deepEqual(unsupported.blockers, []);

  const ultraFile = evaluateBlackboardSubmissionPreflight({
    assignment: {
      id: "993",
      contentId: "629898",
      title: "Ultra file upload",
      availability: "Yes",
      grading: { type: "Attempts", attemptsAllowed: 1, scoringModel: "Last" },
      scoreProviderHandle: "resource/x-bb-assessment",
    },
    content: {
      id: "629898",
      parentId: "0",
      title: "Ultra file upload",
      handler: "resource/x-bb-asmt-test-link",
      kind: "assignment",
      hasChildren: false,
    },
    attempts: [],
    submission: {
      kind: "file",
      file: {
        path: "answer.txt",
        absolutePath: "/tmp/answer.txt",
        name: "answer.txt",
        size: 10,
        sha256: "1".repeat(64),
      },
    },
    uploadSettings: { supportsInlineRender: true, maxUploadSizeInBytes: 1024 },
    now: new Date("2026-08-26T00:00:00.000Z"),
  });
  assert.deepEqual(ultraFile.blockers.map((entry) => entry.code), [
    "UNSUPPORTED_CONTENT_TYPE",
    "UNSUPPORTED_SCORE_PROVIDER",
  ]);
});

test("Blackboard upload binds the exact bytes to the inspected SHA-256 before any network write", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "sustech-bb-hash-"));
  const filePath = join(tempDir, "answer.txt");
  await writeFile(filePath, "reviewed bytes", "utf8");
  let networkCalls = 0;
  const adapter = routeAdapter(() => {
    networkCalls += 1;
    return jsonResponse({ id: "should-not-be-returned" }, 201);
  });

  try {
    const payload = await readBlackboardSubmissionPayload(filePath);
    await assert.rejects(
      uploadBlackboardTemporaryFile(adapter, payload.file, new TextEncoder().encode("different bytes")),
      (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "BLACKBOARD_FILE_CHANGED"),
    );
    assert.equal(networkCalls, 0);

    await writeFile(filePath, "changed on disk", "utf8");
    await assert.rejects(
      uploadBlackboardTemporaryFile(adapter, payload.file),
      (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "BLACKBOARD_FILE_CHANGED"),
    );
    assert.equal(networkCalls, 0);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("Blackboard text submission files must be UTF-8, non-empty regular files", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "sustech-bb-text-"));
  const textPath = join(tempDir, "answer.txt");
  const emptyPath = join(tempDir, "empty.txt");
  const invalidPath = join(tempDir, "binary.txt");
  await writeFile(textPath, "第一题答案\nSecond line", "utf8");
  await writeFile(emptyPath, "");
  await writeFile(invalidPath, Buffer.from([0xc3, 0x28]));

  try {
    const payload = await readBlackboardSubmissionTextPayload(textPath);
    const inspected = await inspectBlackboardSubmissionTextFile(textPath);
    assert.equal(payload.text, "第一题答案\nSecond line");
    assert.equal(payload.textFile.absolutePath, textPath);
    assert.equal(payload.textFile.charCount, [...payload.text].length);
    assert.deepEqual(inspected, payload.textFile);

    await assert.rejects(
      readBlackboardSubmissionTextPayload(emptyPath),
      (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "BLACKBOARD_TEXT_FILE_EMPTY"),
    );
    await assert.rejects(
      readBlackboardSubmissionTextPayload(invalidPath),
      (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "BLACKBOARD_TEXT_FILE_NOT_UTF8"),
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

function routeAdapter(route: (url: string, init?: RequestInit) => Response | Promise<Response>): ServiceAdapter {
  return {
    name: "fixture",
    fetch(input: string, init?: RequestInit): Promise<Response> {
      return Promise.resolve(route(String(input), init));
    },
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
