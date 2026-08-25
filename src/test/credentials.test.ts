import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveCredentials } from "../core/credentials.js";

test("credential files accept one sid:password line and preserve colons in the password", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sustech-cli-credentials-"));
  const path = join(directory, "credentials.txt");
  try {
    await writeFile(path, "12410000:part:two\n", "utf8");
    const credentials = await resolveCredentials(path);
    assert.deepEqual(credentials, {
      sid: "12410000",
      password: "part:two",
      source: "file",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("credential files reject multiple lines", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sustech-cli-credentials-"));
  const path = join(directory, "credentials.txt");
  try {
    await writeFile(path, "12410000:first\n12410001:second\n", "utf8");
    await assert.rejects(resolveCredentials(path), /exactly one sid:password line/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
