import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { CLI_VERSION } from "../core/version.js";

test("stdio MCP entrypoint exposes help and version without starting the protocol", () => {
  const serverPath = fileURLToPath(new URL("../mcp/server.js", import.meta.url));

  const help = spawnSync(process.execPath, [serverPath, "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage:/u);
  assert.match(help.stdout, /Serve MCP over stdio/u);

  const version = spawnSync(process.execPath, [serverPath, "--version"], { encoding: "utf8" });
  assert.equal(version.status, 0);
  assert.equal(version.stdout.trim(), CLI_VERSION);

  const invalid = spawnSync(process.execPath, [serverPath, "--bogus"], { encoding: "utf8" });
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /unsupported argument/u);
  assert.equal(invalid.stdout, "");
});

test("stdio MCP entrypoint runs through an npm-style executable symlink", { skip: process.platform === "win32" }, () => {
  const serverPath = fileURLToPath(new URL("../mcp/server.js", import.meta.url));
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "sustech-mcp-bin-"));
  const executablePath = join(temporaryDirectory, "sustech-mcp");
  try {
    symlinkSync(serverPath, executablePath);
    const version = spawnSync(process.execPath, [executablePath, "--version"], { encoding: "utf8" });
    assert.equal(version.status, 0);
    assert.equal(version.stdout.trim(), CLI_VERSION);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("packaged stdio MCP negotiates the current protocol and serves typed tools", async () => {
  const serverPath = fileURLToPath(new URL("../mcp/server.js", import.meta.url));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    stderr: "pipe",
  });
  const client = new Client(
    { name: "sustech-cli-stdio-test", version: "1.0.0" },
    { versionNegotiation: { mode: "auto" } },
  );

  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.ok(listed.tools.some((tool) => tool.name === "sustech_online_talks_search"));
    assert.ok(listed.tools.some((tool) => tool.name === "sustech_library_search"));
    assert.ok(listed.tools.every((tool) => tool.name !== "sustech_run"));

    const resources = await client.listResources();
    assert.equal(resources.resources.length, 5);
    assert.ok(resources.resources.some((resource) => resource.uri === "sustech://version"));

    const prompts = await client.listPrompts();
    assert.equal(prompts.prompts.length, 4);
    assert.ok(prompts.prompts.some((prompt) => prompt.name === "sustech_public_lookup"));

    const version = await client.callTool({ name: "sustech_version", arguments: {} });
    assert.equal(version.isError, undefined);
    assert.equal((version.structuredContent as { ok: boolean }).ok, true);

    const versionResource = await client.readResource({ uri: "sustech://version" });
    assert.match(resourceText(versionResource.contents[0]), /"command": "version"/);

    const guardedOnline = await client.callTool({
      name: "sustech_online_talks_get",
      arguments: { id: "%2F" },
    });
    assert.equal(guardedOnline.isError, true);
    assert.match(JSON.stringify(guardedOnline.structuredContent), /ONLINE_SOURCE_NOT_ALLOWED/);
  } finally {
    await client.close();
  }
});

function resourceText(
  content: { text: string; uri: string } | { blob: string; uri: string } | undefined,
): string {
  assert.ok(content);
  assert.ok("text" in content);
  return content.text;
}
