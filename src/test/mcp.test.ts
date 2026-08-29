import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { fileURLToPath } from "node:url";
import { MCP_TOOL_BY_COMMAND } from "../mcp/registry.js";
import { createSustechMcpServer } from "../mcp/server.js";
import {
  describeCliForMcp,
  runCliForMcp,
  validateMcpCommand,
} from "../mcp/runner.js";

test("MCP runner blocks remote mutations and local state writes", () => {
  assert.throws(
    () => validateMcpCommand("tis selection apply", []),
    /MCP_MUTATION_BLOCKED/,
  );
  assert.throws(
    () => validateMcpCommand("tis plan add", ["CS101"]),
    /MCP_MUTATION_BLOCKED/,
  );
  assert.throws(
    () => validateMcpCommand("version", ["--reveal"]),
    /MCP_ARGUMENT_BLOCKED/,
  );
  assert.throws(
    () => validateMcpCommand("library search", ["aspirin", "--browser"]),
    /MCP_ARGUMENT_BLOCKED/,
  );
  assert.throws(
    () => validateMcpCommand("library detail", ["L:alma123", "--interactive"]),
    /MCP_ARGUMENT_BLOCKED/,
  );
  assert.doesNotThrow(() => validateMcpCommand("calendar day", ["--date", "2026-08-29"]));
  assert.doesNotThrow(() => validateMcpCommand("faculty search", ["vision"]));
  assert.throws(() => validateMcpCommand("profile show", []), /MCP_COMMAND_NOT_EXPOSED/);
  assert.throws(() => validateMcpCommand("context", []), /MCP_COMMAND_NOT_EXPOSED/);
  assert.throws(() => validateMcpCommand("wifi status", []), /MCP_COMMAND_NOT_EXPOSED/);
});

test("MCP runner reuses CLI JSON envelopes", async () => {
  const version = await runCliForMcp("version");
  assert.equal(version.exitCode, 0);
  assert.equal(version.envelope.ok, true);
  assert.equal(version.envelope.command, "version");

  const description = await describeCliForMcp("version");
  assert.equal(description.exitCode, 0);
  assert.equal(description.envelope.ok, true);
  assert.equal(description.envelope.command, "describe");
});

test("MCP runner terminates the CLI when the client cancels", async () => {
  const controller = new AbortController();
  const slowCliPath = fileURLToPath(new URL("./fixtures/slow-cli.js", import.meta.url));
  const pending = runCliForMcp("version", [], { cliPath: slowCliPath, signal: controller.signal });
  setTimeout(() => controller.abort(), 25);
  await assert.rejects(pending, /MCP_CLI_CANCELLED/u);
});

test("MCP client cancellation reaches the server tool and terminates its CLI process", { skip: process.platform === "win32" }, async () => {
  const slowCliPath = fileURLToPath(new URL("./fixtures/slow-cli.js", import.meta.url));
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "sustech-mcp-cancel-"));
  const markerPath = join(temporaryDirectory, "cancelled.txt");
  const readyMarkerPath = join(temporaryDirectory, "ready.txt");
  const previousMarker = process.env.SUSTECH_MCP_TEST_CANCEL_MARKER;
  const previousReadyMarker = process.env.SUSTECH_MCP_TEST_READY_MARKER;
  process.env.SUSTECH_MCP_TEST_CANCEL_MARKER = markerPath;
  process.env.SUSTECH_MCP_TEST_READY_MARKER = readyMarkerPath;
  const server = createSustechMcpServer({ runner: { cliPath: slowCliPath } });
  const client = new Client({ name: "sustech-cli-cancel-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const controller = new AbortController();
    const pending = client.callTool(
      { name: "sustech_version", arguments: {} },
      { signal: controller.signal },
    );
    await waitForFile(readyMarkerPath);
    controller.abort();
    await assert.rejects(pending, /abort|cancel/u);
    await waitForFile(markerPath);
    assert.equal(readFileSync(markerPath, "utf8").trim(), "cancelled");
  } finally {
    if (previousMarker === undefined) delete process.env.SUSTECH_MCP_TEST_CANCEL_MARKER;
    else process.env.SUSTECH_MCP_TEST_CANCEL_MARKER = previousMarker;
    if (previousReadyMarker === undefined) delete process.env.SUSTECH_MCP_TEST_READY_MARKER;
    else process.env.SUSTECH_MCP_TEST_READY_MARKER = previousReadyMarker;
    await Promise.allSettled([client.close(), server.close()]);
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

async function waitForFile(path: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (existsSync(path)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`Timed out waiting for test marker: ${path}`);
}

test("MCP runner rejects pre-cancelled and timed-out commands", async () => {
  const slowCliPath = fileURLToPath(new URL("./fixtures/slow-cli.js", import.meta.url));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    runCliForMcp("version", [], { cliPath: slowCliPath, signal: controller.signal }),
    /MCP_CLI_CANCELLED/u,
  );
  await assert.rejects(
    runCliForMcp("version", [], { cliPath: slowCliPath, timeoutMs: 10 }),
    /MCP_CLI_TIMEOUT/u,
  );
});

test("MCP runner rejects missing, invalid, and oversized CLI envelopes", async () => {
  const emptyCliPath = fileURLToPath(new URL("./fixtures/empty-cli.js", import.meta.url));
  const invalidCliPath = fileURLToPath(new URL("./fixtures/invalid-json-cli.js", import.meta.url));
  const oversizedCliPath = fileURLToPath(new URL("./fixtures/oversized-cli.js", import.meta.url));
  await assert.rejects(runCliForMcp("version", [], { cliPath: emptyCliPath }), /MCP_CLI_NO_OUTPUT/u);
  await assert.rejects(runCliForMcp("version", [], { cliPath: invalidCliPath }), /MCP_CLI_INVALID_OUTPUT/u);
  await assert.rejects(runCliForMcp("version", [], { cliPath: oversizedCliPath }), /MCP_OUTPUT_TOO_LARGE/u);
});

test("MCP exposes discovery, description, and a typed public-read allowlist", async () => {
  const server = createSustechMcpServer();
  const client = new Client({ name: "sustech-cli-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const listed = await client.listTools();
    assert.deepEqual(
      listed.tools.map((tool) => tool.name).sort(),
      [...new Set(Object.values(MCP_TOOL_BY_COMMAND))].sort(),
    );
    assert.ok(listed.tools.every((tool) => tool.name !== "sustech_run"));
    assert.ok(listed.tools.every((tool) => tool.annotations?.readOnlyHint === true));
    assert.equal(listed.tools.length, 33);
    assert.ok(listed.tools.some((tool) => tool.name === "sustech_library_search_url"));
    assert.ok(listed.tools.some((tool) => tool.name === "sustech_transit_live"));

    const discovered = await client.callTool({
      name: "sustech_discover",
      arguments: { kind: "read", query: "calendar" },
    });
    assert.equal(discovered.isError, undefined);
    const discovery = discovered.structuredContent as { capabilities: Array<{ command: string; mcpExecutable: boolean }> };
    assert.ok(discovery.capabilities.some((entry) => entry.command === "calendar day" && entry.mcpExecutable));

    const run = await client.callTool({ name: "sustech_version", arguments: {} });
    assert.equal(run.isError, undefined);
    assert.equal((run.structuredContent as { ok: boolean }).ok, true);

    const consequences = await client.callTool({
      name: "sustech_consequences",
      arguments: { operation: "tis.drop" },
    });
    assert.equal(consequences.isError, undefined);
    assert.equal((consequences.structuredContent as { command: string }).command, "consequences");

    const resources = await client.callTool({
      name: "sustech_resources_search",
      arguments: { query: "library" },
    });
    assert.equal(resources.isError, undefined);
    assert.equal((resources.structuredContent as { command: string }).command, "resources search");

    const services = await client.callTool({
      name: "sustech_services_status",
      arguments: { service: "sustech-online" },
    });
    assert.equal(services.isError, undefined);
    assert.equal((services.structuredContent as { command: string }).command, "services status");

    const blocked = await client.callTool({
      name: "sustech_describe",
      arguments: { command: "tis plan add" },
    });
    assert.equal(blocked.isError, undefined);
    const described = blocked.structuredContent as { data: { capability: { command: string } } };
    assert.equal(described.data.capability.command, "tis plan add");

    const listedResources = await client.listResources();
    assert.equal(listedResources.resources.length, 5);
    assert.ok(listedResources.resources.some((resource) => resource.uri === "sustech://version"));
    assert.ok(listedResources.resources.some((resource) => resource.uri === "sustech://mcp/policy"));

    const listedTemplates = await client.listResourceTemplates();
    assert.equal(listedTemplates.resourceTemplates.length, 5);
    assert.ok(listedTemplates.resourceTemplates.some((resource) => resource.uriTemplate === "sustech://faculty/{slug}"));
    assert.ok(listedTemplates.resourceTemplates.some((resource) => resource.uriTemplate === "sustech://library/{context}/{docId}"));

    const versionResource = await client.readResource({ uri: "sustech://version" });
    assert.equal(versionResource.contents[0]?.mimeType, "application/json");
    assert.match(resourceText(versionResource.contents[0]), /"command": "version"/);

    const policyResource = await client.readResource({ uri: "sustech://mcp/policy" });
    assert.match(resourceText(policyResource.contents[0]), /"typedAllowlist": true/);

    const prompts = await client.listPrompts();
    assert.equal(prompts.prompts.length, 4);
    assert.deepEqual(
      prompts.prompts.map((prompt) => prompt.name).sort(),
      [
        "sustech_course_research",
        "sustech_guarded_cli_review",
        "sustech_public_lookup",
        "sustech_talk_digest",
      ],
    );

    const prompt = await client.getPrompt({
      name: "sustech_public_lookup",
      arguments: { question: "Where can I find public SUSTech talks?" },
    });
    assert.match(JSON.stringify(prompt.messages), /community-maintained/u);

    const commandResource = await client.readResource({ uri: "sustech://command/version" });
    assert.match(resourceText(commandResource.contents[0]), /"command": "describe"/u);

    const spacedCommandResource = await client.readResource({ uri: "sustech://command/calendar%20day" });
    assert.match(resourceText(spacedCommandResource.contents[0]), /"calendar day"/u);

    const invalidCommandResource = await client.readResource({ uri: "sustech://command/%252F" });
    assert.match(resourceText(invalidCommandResource.contents[0]), /MCP_RESOURCE_INVALID_ARGUMENT/u);

    const invalidNcesResource = await client.readResource({ uri: "sustech://nces/course/not-a-number" });
    assert.match(resourceText(invalidNcesResource.contents[0]), /MCP_RESOURCE_INVALID_ARGUMENT/u);

    const invalidLibraryResource = await client.readResource({ uri: "sustech://library/public-json/%252F" });
    assert.match(resourceText(invalidLibraryResource.contents[0]), /MCP_RESOURCE_INVALID_ARGUMENT/u);

    const guardedTalkResource = await client.readResource({ uri: "sustech://online/talk/%252F" });
    assert.match(resourceText(guardedTalkResource.contents[0]), /MCP_RESOURCE_INVALID_ARGUMENT/u);
  } finally {
    await Promise.allSettled([client.close(), server.close()]);
  }
});

function resourceText(
  content: { text: string; uri: string } | { blob: string; uri: string } | undefined,
): string {
  assert.ok(content);
  assert.ok("text" in content);
  return content.text;
}
