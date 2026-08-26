import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ServiceAdapter } from "../services/base.js";
import { downloadOpenAccessPdf } from "../services/papers.js";

const DOI = "10.1234/example";

test("OA paper download resolves Unpaywall, validates PDF bytes, and returns a digest", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sustech-paper-"));
  const destination = join(directory, "paper.pdf");
  const bytes = new TextEncoder().encode("%PDF-1.7\nfixture paper");
  let downloads = 0;
  try {
    const result = await downloadOpenAccessPdf(DOI, destination, {
      adapter: unpaywall("https://oa.example/paper.pdf"),
      fetchImpl: async (input) => {
        downloads += 1;
        assert.equal(String(input), "https://oa.example/paper.pdf");
        return new Response(bytes, { headers: { "content-type": "application/pdf", "content-length": String(bytes.byteLength) } });
      },
    });
    assert.equal(downloads, 1);
    assert.equal(await readFile(destination, "utf8"), new TextDecoder().decode(bytes));
    assert.equal(result.sha256, createHash("sha256").update(bytes).digest("hex"));
    assert.equal(result.sourceHost, "oa.example");
    assert.equal(result.overwritten, false);

    await assert.rejects(
      downloadOpenAccessPdf(DOI, destination, {
        adapter: unpaywall("https://oa.example/paper.pdf"),
        fetchImpl: async () => {
          throw new Error("network must not run");
        },
      }),
      hasCode("PAPER_DOWNLOAD_DESTINATION_EXISTS"),
    );
    assert.equal(downloads, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("OA paper download rejects HTML and cleans its temporary file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sustech-paper-html-"));
  const destination = join(directory, "paper.pdf");
  try {
    await assert.rejects(
      downloadOpenAccessPdf(DOI, destination, {
        adapter: unpaywall("https://oa.example/article"),
        fetchImpl: async () => new Response("<html>login</html>", { headers: { "content-type": "text/html" } }),
      }),
      hasCode("PAPER_DOWNLOAD_NOT_PDF"),
    );
    await assert.rejects(readFile(destination), (error: unknown) => nodeCode(error) === "ENOENT");
    const names = await import("node:fs/promises").then(({ readdir }) => readdir(directory));
    assert.deepEqual(names, []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("OA paper download refuses unsafe redirect targets and symbolic-link destinations", {
  skip: process.platform === "win32",
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), "sustech-paper-safe-"));
  const target = join(directory, "target.pdf");
  const destination = join(directory, "paper.pdf");
  await writeFile(target, "keep", "utf8");
  await symlink(target, destination);
  try {
    await assert.rejects(
      downloadOpenAccessPdf(DOI, destination, {
        overwrite: true,
        adapter: unpaywall("https://oa.example/paper.pdf"),
        fetchImpl: async () => new Response(null, { status: 302, headers: { location: "https://[::1]/private" } }),
      }),
      hasCode("PAPER_DOWNLOAD_DESTINATION_INVALID"),
    );
    assert.equal(await readFile(target, "utf8"), "keep");

    await rm(destination);
    await assert.rejects(
      downloadOpenAccessPdf(DOI, destination, {
        adapter: unpaywall("https://oa.example/paper.pdf"),
        fetchImpl: async () => new Response(null, { status: 302, headers: { location: "https://[::1]/private" } }),
      }),
      hasCode("PAPER_DOWNLOAD_URL_UNSAFE"),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("OA paper download rejects a symbolic-link parent before network access", {
  skip: process.platform === "win32",
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), "sustech-paper-parent-link-"));
  const realParent = join(directory, "real-parent");
  const linkedParent = join(directory, "linked-parent");
  await mkdir(realParent);
  await symlink(realParent, linkedParent);
  let networkCalls = 0;
  try {
    await assert.rejects(
      downloadOpenAccessPdf(DOI, join(linkedParent, "paper.pdf"), {
        adapter: {
          name: "must-not-run",
          async fetch(): Promise<Response> {
            networkCalls += 1;
            throw new Error("network must not run");
          },
        },
      }),
      hasCode("UNSAFE_LOCAL_PATH"),
    );
    assert.equal(networkCalls, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("OA paper download rejects private IPv4 ranges embedded in IPv6 literals", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sustech-paper-mapped-ip-"));
  let downloads = 0;
  try {
    for (const [index, url] of [
      "https://[::ffff:127.0.0.1]/paper.pdf",
      "https://[::ffff:169.254.1.1]/paper.pdf",
      "https://[::ffff:172.16.0.1]/paper.pdf",
      "https://[::ffff:192.168.1.1]/paper.pdf",
    ].entries()) {
      await assert.rejects(
        downloadOpenAccessPdf(DOI, join(directory, `paper-${index}.pdf`), {
          adapter: unpaywall(url),
          fetchImpl: async () => {
            downloads += 1;
            throw new Error("network must not run");
          },
        }),
        hasCode("PAPER_DOWNLOAD_URL_UNSAFE"),
      );
    }
    assert.equal(downloads, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function unpaywall(pdfUrl: string): ServiceAdapter {
  return {
    name: "fixture",
    async fetch(): Promise<Response> {
      return new Response(JSON.stringify({ is_oa: true, best_oa_location: { url_for_pdf: pdfUrl } }), {
        headers: { "content-type": "application/json" },
      });
    },
  };
}

function hasCode(code: string): (error: unknown) => boolean {
  return (error) => Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}

function nodeCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
}
