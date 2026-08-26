import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildPmsPrintUploadPreview,
  readPmsUploadPayload,
  verifyPmsPrintDeletion,
  verifyPmsPrintUpload,
} from "../services/pms.js";

test("PMS upload payload inspection preserves the exact file hash and preview warns on duplicate filenames", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "sustech-cli-pms-service-"));
  const filePath = join(tempDir, "report.pdf");
  const contents = "fixture print bytes";
  writeFileSync(filePath, contents, "utf8");

  try {
    const payload = await readPmsUploadPayload(filePath);
    assert.equal(payload.file.name, "report.pdf");
    assert.equal(payload.file.size, Buffer.byteLength(contents));
    assert.equal(payload.file.sha256, createHash("sha256").update(contents).digest("hex"));
    assert.equal(Buffer.from(payload.bytes).toString("utf8"), contents);

    const preview = buildPmsPrintUploadPreview(
      [{
        jobId: 41,
        fileName: "report.pdf",
        createdAt: "2026-08-26T10:00:00",
        copies: 1,
        paper: "A4",
        totalPages: 3,
        color: false,
        duplexLabel: "单面",
      }],
      payload.file,
      {
        color: "bw",
        colorCode: 1,
        paper: "A4",
        paperCode: 9,
        duplex: "single",
        duplexCode: 1,
        pageFrom: 0,
        pageTo: 0,
        copies: 1,
      },
      {
        required: true,
        available: true,
        expectedSha256: payload.file.sha256,
        argv: ["sustech", "pms", "upload", "apply"],
        command: "sustech pms upload apply ...",
      },
      new Date("2026-08-26T10:30:00Z"),
    );
    assert.equal(preview.checkedAt, "2026-08-26T10:30:00.000Z");
    assert.equal(preview.warnings[0]?.code, "DUPLICATE_FILENAME");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("PMS upload verification distinguishes confirmed, ambiguous, and not-observed queue read-backs", () => {
  const previous = [{
    jobId: 10,
    fileName: "existing.pdf",
    createdAt: "2026-08-26T09:00:00",
    copies: 1,
    paper: "A4",
    totalPages: 2,
    color: false,
    duplexLabel: "单面",
  }];
  const options = {
    color: "color" as const,
    colorCode: 2 as const,
    paper: "A4" as const,
    paperCode: 9 as const,
    duplex: "long" as const,
    duplexCode: 3 as const,
    pageFrom: 0,
    pageTo: 0,
    copies: 2,
  };

  const confirmed = verifyPmsPrintUpload(previous, [
    ...previous,
    {
      jobId: 11,
      fileName: "report.pdf",
      createdAt: "2026-08-26T09:05:00",
      copies: 2,
      paper: "A4",
      totalPages: 5,
      color: true,
      duplexLabel: "双面长边",
    },
  ], { name: "report.pdf" }, options);
  assert.equal(confirmed.status, "confirmed");
  assert.deepEqual(confirmed.observedJobIds, [11]);

  const ambiguous = verifyPmsPrintUpload(previous, [
    ...previous,
    {
      jobId: 11,
      fileName: "report.pdf",
      createdAt: "2026-08-26T09:05:00",
      copies: 2,
      paper: "A4",
      totalPages: 5,
      color: true,
      duplexLabel: "双面长边",
    },
    {
      jobId: 12,
      fileName: "report.pdf",
      createdAt: "2026-08-26T09:06:00",
      copies: 2,
      paper: "A4",
      totalPages: 5,
      color: true,
      duplexLabel: "双面长边",
    },
  ], { name: "report.pdf" }, options);
  assert.equal(ambiguous.status, "ambiguous");
  assert.deepEqual(ambiguous.observedJobIds, [11, 12]);

  const missing = verifyPmsPrintUpload(previous, [
    ...previous,
    {
      jobId: 13,
      fileName: "report.pdf",
      createdAt: "2026-08-26T09:06:00",
      copies: 1,
      paper: "A4",
      totalPages: 5,
      color: true,
      duplexLabel: "双面长边",
    },
  ], { name: "report.pdf" }, options);
  assert.equal(missing.status, "not_observed");
  assert.deepEqual(missing.observedJobIds, []);
});

test("PMS delete verification confirms exact job absence", () => {
  const confirmed = verifyPmsPrintDeletion([], 77);
  assert.equal(confirmed.status, "confirmed");

  const stillPresent = verifyPmsPrintDeletion([{
    jobId: 77,
    fileName: "report.pdf",
    createdAt: "2026-08-26T09:00:00",
    copies: 1,
    paper: "A4",
    totalPages: 1,
    color: false,
    duplexLabel: "单面",
  }], 77);
  assert.equal(stillPresent.status, "not_observed");
  assert.deepEqual(stillPresent.observedJobIds, [77]);
});
