import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  downloadBlackboardContentAttachment,
  listBlackboardContentAttachments,
} from "../services/blackboard.js";
import type { ServiceAdapter } from "../services/base.js";

test("Blackboard content attachments list and stream through the official REST download endpoint", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "sustech-bb-attachment-"));
  const destination = join(tempDir, "assignment.pdf");
  let bytes = new TextEncoder().encode("first attachment bytes");
  let calls = 0;
  const adapter = routeAdapter((url) => {
    calls += 1;
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8537_1/contents/_629896_1") {
      return jsonResponse({
        id: "_629896_1",
        title: "Homework 1",
        contentHandler: { id: "resource/x-bb-assignment" },
      });
    }
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8537_1/contents/_629896_1/attachments") {
      // Some Learn releases return a singleton here instead of a paged collection.
      return jsonResponse({ id: "_42588_1", fileName: "assignment.pdf", mimeType: "application/pdf" });
    }
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8537_1/contents/_629896_1/attachments/_42588_1/download") {
      return binaryResponse(bytes, "application/pdf");
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  try {
    const attachments = await listBlackboardContentAttachments(adapter, "8537", "629896");
    assert.deepEqual(attachments, [{
      id: "42588",
      fileName: "assignment.pdf",
      mimeType: "application/pdf",
      source: "learn-rest",
    }]);
    assert.equal("downloadUrl" in attachments[0]!, false);

    const downloaded = await downloadBlackboardContentAttachment(
      adapter,
      "_8537_1",
      "_629896_1",
      "_42588_1",
      destination,
    );
    assert.equal(await readFile(destination, "utf8"), "first attachment bytes");
    assert.equal(downloaded.destination, destination);
    assert.equal(downloaded.size, bytes.byteLength);
    assert.equal(downloaded.sha256, createHash("sha256").update(bytes).digest("hex"));
    assert.equal(downloaded.overwritten, false);

    const callsBeforeRefusal = calls;
    await assert.rejects(
      downloadBlackboardContentAttachment(adapter, "8537", "629896", "42588", destination),
      hasCode("BLACKBOARD_DOWNLOAD_DESTINATION_EXISTS"),
    );
    assert.equal(calls, callsBeforeRefusal, "an existing destination is rejected before another network request");
    assert.equal(await readFile(destination, "utf8"), "first attachment bytes");

    bytes = new TextEncoder().encode("replacement bytes");
    const replaced = await downloadBlackboardContentAttachment(
      adapter,
      "8537",
      "629896",
      "42588",
      destination,
      { overwrite: true },
    );
    assert.equal(replaced.overwritten, true);
    assert.equal(await readFile(destination, "utf8"), "replacement bytes");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("Blackboard BBML attachment links get stable opaque IDs without exposing signed URLs", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "sustech-bb-bbml-"));
  const destination = join(tempDir, "instructions.pdf");
  const bytes = new TextEncoder().encode("embedded attachment");
  let contentReads = 0;
  const body = (signature: string) => [
    "<p>Please read:</p>",
    `<a href=\"/bbcswebdav/xid-123_1?temporary=${signature}&amp;signature=${signature}\"`,
    " data-bbfile=\"{&quot;render&quot;:&quot;attachment&quot;,&quot;linkName&quot;:&quot;Instructions.pdf&quot;,&quot;mimeType&quot;:&quot;application/pdf&quot;}\">",
    "fallback name</a>",
  ].join("");
  const adapter = routeAdapter((url) => {
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8537_1/contents/_629896_1") {
      contentReads += 1;
      return jsonResponse({
        id: "_629896_1",
        title: "Homework 1",
        body: body(contentReads === 1 ? "first" : "fresh"),
        contentHandler: { id: "resource/x-bb-assignment" },
      });
    }
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8537_1/contents/_629896_1/attachments") {
      return jsonResponse({ message: "not available for this content type" }, 404);
    }
    if (url === "https://bb.sustech.edu.cn/bbcswebdav/xid-123_1?temporary=fresh&signature=fresh") {
      return binaryResponse(bytes, "application/pdf");
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  try {
    const attachments = await listBlackboardContentAttachments(adapter, "8537", "629896");
    assert.equal(attachments.length, 1);
    assert.match(attachments[0]!.id, /^embedded-[0-9a-f]{16}$/);
    assert.equal(attachments[0]!.fileName, "Instructions.pdf");
    assert.equal(attachments[0]!.mimeType, "application/pdf");
    assert.equal(attachments[0]!.source, "bbml");
    assert.equal(JSON.stringify(attachments).includes("temporary=first"), false);

    const downloaded = await downloadBlackboardContentAttachment(
      adapter,
      "8537",
      "629896",
      attachments[0]!.id,
      destination,
    );
    assert.equal(downloaded.attachment.fileName, "Instructions.pdf");
    assert.equal(await readFile(destination, "utf8"), "embedded attachment");
    assert.equal(contentReads, 2, "download resolves the stable ID against a fresh signed URL");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("Blackboard attachment downloads never overwrite symbolic-link destinations", {
  skip: process.platform === "win32",
}, async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "sustech-bb-symlink-"));
  const target = join(tempDir, "target.txt");
  const destination = join(tempDir, "assignment.pdf");
  await writeFile(target, "keep me", "utf8");
  await symlink(target, destination);
  const adapter = routeAdapter((url) => {
    throw new Error(`Network access should not occur for a symbolic-link destination: ${url}`);
  });

  try {
    await assert.rejects(
      downloadBlackboardContentAttachment(adapter, "10", "20", "30", destination, { overwrite: true }),
      hasCode("BLACKBOARD_DOWNLOAD_DESTINATION_INVALID"),
    );
    assert.equal(await readFile(target, "utf8"), "keep me");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("Blackboard attachment downloads reject a symbolic-link parent before network access", {
  skip: process.platform === "win32",
}, async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "sustech-bb-parent-link-"));
  const realParent = join(tempDir, "real-parent");
  const linkedParent = join(tempDir, "linked-parent");
  await mkdir(realParent);
  await symlink(realParent, linkedParent);
  let calls = 0;
  const adapter = routeAdapter((url) => {
    calls += 1;
    throw new Error(`Network access should not occur for a symbolic-link parent: ${url}`);
  });

  try {
    await assert.rejects(
      downloadBlackboardContentAttachment(
        adapter,
        "10",
        "20",
        "30",
        join(linkedParent, "assignment.pdf"),
      ),
      hasCode("UNSAFE_LOCAL_PATH"),
    );
    assert.equal(calls, 0);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("Blackboard content attachment discovery and download reject unsafe upstream URLs", async () => {
  const ignoredEmbedded = routeAdapter((url) => {
    if (url.endsWith("/contents/_20_1")) {
      return jsonResponse({
        id: "_20_1",
        body: "<a href=\"https://evil.example/bbcswebdav/secret\">bad.pdf</a>",
        contentHandler: { id: "resource/x-bb-assignment" },
      });
    }
    if (url.endsWith("/contents/_20_1/attachments")) return jsonResponse({}, 404);
    throw new Error(`Unexpected URL ${url}`);
  });
  assert.deepEqual(await listBlackboardContentAttachments(ignoredEmbedded, "10", "20"), []);

  const unsafeRest = routeAdapter((url) => {
    if (url.endsWith("/contents/_20_1")) {
      return jsonResponse({ id: "_20_1", contentHandler: { id: "resource/x-bb-assignment" } });
    }
    if (url.endsWith("/contents/_20_1/attachments")) {
      return jsonResponse({
        id: "_30_1",
        fileName: "bad.pdf",
        downloadUrl: "https://evil.example/bbcswebdav/secret",
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  });
  await assert.rejects(
    listBlackboardContentAttachments(unsafeRest, "10", "20"),
    hasCode("UNSAFE_SERVICE_URL"),
  );
});

test("Blackboard attachment download errors do not echo signed URLs", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "sustech-bb-redaction-"));
  const destination = join(tempDir, "private.pdf");
  const signature = "do-not-leak-this-signature";
  const adapter = routeAdapter((url) => {
    if (url.endsWith("/contents/_20_1")) {
      return jsonResponse({
        id: "_20_1",
        body: `<a href=\"/bbcswebdav/xid-private_1?signature=${signature}\">private.pdf</a>`,
        contentHandler: { id: "resource/x-bb-document" },
      });
    }
    if (url.endsWith("/contents/_20_1/attachments")) return jsonResponse({}, 404);
    throw new Error(`Network failed for ${url}`);
  });

  try {
    const [attachment] = await listBlackboardContentAttachments(adapter, "10", "20");
    await assert.rejects(
      downloadBlackboardContentAttachment(adapter, "10", "20", attachment!.id, destination),
      (error: unknown) => {
        assert.equal(JSON.stringify(error).includes(signature), false);
        return true;
      },
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("Blackboard permits JSON assignment files after a safe WebDAV redirect", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "sustech-bb-json-"));
  const destination = join(tempDir, "fixture.json");
  const bytes = '{"answer":42}';
  const adapter = routeAdapter((url) => {
    if (url.endsWith("/contents/_20_1")) {
      return jsonResponse({ id: "_20_1", contentHandler: { id: "resource/x-bb-assignment" } });
    }
    if (url.endsWith("/contents/_20_1/attachments")) {
      return jsonResponse({ id: "_30_1", fileName: "fixture.json", mimeType: "application/json" });
    }
    if (url.endsWith("/attachments/_30_1/download")) {
      const response = new Response(bytes, {
        status: 200,
        headers: { "content-type": "application/json", "content-length": String(bytes.length) },
      });
      Object.defineProperty(response, "url", {
        value: "https://bb.sustech.edu.cn/bbcswebdav/xid-30_1?signature=fresh",
      });
      return response;
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  try {
    const result = await downloadBlackboardContentAttachment(adapter, "10", "20", "30", destination);
    assert.equal(result.contentType, "application/json");
    assert.equal(await readFile(destination, "utf8"), bytes);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("Blackboard attachment size mismatches leave no destination or temporary file", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "sustech-bb-size-"));
  const destination = join(tempDir, "truncated.pdf");
  const adapter = routeAdapter((url) => {
    if (url.endsWith("/contents/_20_1")) {
      return jsonResponse({ id: "_20_1", contentHandler: { id: "resource/x-bb-assignment" } });
    }
    if (url.endsWith("/contents/_20_1/attachments")) {
      return jsonResponse({ id: "_30_1", fileName: "truncated.pdf", mimeType: "application/pdf" });
    }
    if (url.endsWith("/attachments/_30_1/download")) {
      return new Response("short", {
        status: 200,
        headers: { "content-type": "application/pdf", "content-length": "999" },
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  try {
    await assert.rejects(
      downloadBlackboardContentAttachment(adapter, "10", "20", "30", destination),
      hasCode("BLACKBOARD_DOWNLOAD_SIZE_MISMATCH"),
    );
    await assert.rejects(readFile(destination), (error: unknown) => nodeCode(error) === "ENOENT");
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

function binaryResponse(bytes: Uint8Array, contentType: string): Response {
  return new Response(bytes, {
    status: 200,
    headers: { "content-type": contentType, "content-length": String(bytes.byteLength) },
  });
}

function hasCode(code: string): (error: unknown) => boolean {
  return (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}

function nodeCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : "";
}
