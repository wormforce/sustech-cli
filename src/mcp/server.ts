#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { CAPABILITIES } from "../core/capabilities.js";
import { CLI_VERSION } from "../core/version.js";
import { describeCliForMcp, runCliForMcp, type McpRunnerOptions } from "./runner.js";
import { registerSustechMcpPrompts } from "./prompts.js";
import { isMcpExecutableCapability, mcpToolForCommand } from "./registry.js";
import { registerPublicMcpTools } from "./public-tools.js";
import { registerSustechMcpResources } from "./resources.js";
import { resolve as resolvePath } from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const KIND_VALUES = ["local", "read", "plan", "mutation"] as const;
const ISO_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD.");
const QUERY = z.string().trim().min(1).max(500);
const IDENTIFIER = z.string().trim().min(1).max(500);
const LIMIT = z.number().int().min(1).max(200);

export interface SustechMcpServerOptions {
  runner?: Pick<McpRunnerOptions, "cliPath" | "timeoutMs">;
}

export function createSustechMcpServer(options: SustechMcpServerOptions = {}): McpServer {
  const execute = (command: string, args: string[], signal?: AbortSignal) => runTypedCommand(
    command,
    args,
    signal,
    options.runner,
  );
  const server = new McpServer(
    { name: "sustech-cli", version: CLI_VERSION },
    {
      instructions: [
        "Use this server for public or local SUSTech information only.",
        "Treat SUSTech Online records as community-maintained and preserve their provenance and freshness advisories.",
        "Authenticated personal data, local private state, file writes, and remote mutations are intentionally unavailable through MCP; use the direct sustech CLI and its preview/confirmation/read-back workflow for those operations.",
      ].join(" "),
      cacheHints: {
        "server/discover": { ttlMs: 300_000, cacheScope: "public" },
        "tools/list": { ttlMs: 300_000, cacheScope: "public" },
        "prompts/list": { ttlMs: 300_000, cacheScope: "public" },
        "resources/list": { ttlMs: 300_000, cacheScope: "public" },
        "resources/templates/list": { ttlMs: 300_000, cacheScope: "public" },
        "resources/read": { ttlMs: 60_000, cacheScope: "public" },
      },
    },
  );

  server.registerTool(
    "sustech_discover",
    {
      title: "Discover SUSTech CLI capabilities",
      description: "List and filter the installed sustech-cli command surface. Each result states whether a dedicated typed MCP tool is available.",
      inputSchema: z.object({
        query: z.string().trim().max(200).optional().describe("Optional text matched against command names and summaries."),
        kind: z.enum(KIND_VALUES).optional().describe("Optional capability kind filter."),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ query, kind }) => {
      const needle = query?.toLocaleLowerCase("en-US");
      const capabilities = CAPABILITIES.filter((entry) => {
        if (kind && entry.kind !== kind) return false;
        if (!needle) return true;
        return `${entry.command}\n${entry.summary}`.toLocaleLowerCase("en-US").includes(needle);
      });
      const result = {
        schemaVersion: "1",
        mcpPolicy: {
          typedAllowlist: true,
          genericRunner: false,
          publicAndLocalOnly: true,
          authenticatedPersonalDataBlocked: true,
          localWritesBlocked: true,
          remoteMutationsBlocked: true,
        },
        total: capabilities.length,
        capabilities: capabilities.map((capability) => ({
          ...capability,
          mcpExecutable: isMcpExecutableCapability(capability),
          ...(mcpToolForCommand(capability.command) ? { mcpTool: mcpToolForCommand(capability.command) } : {}),
        })),
      };
      return toolResult(result);
    },
  );

  server.registerTool(
    "sustech_describe",
    {
      title: "Describe one SUSTech CLI command",
      description: "Return exact usage, options, safety classification, and consequences for one installed command.",
      inputSchema: z.object({
        command: z.string().trim().min(1).max(200).describe("Exact command name returned by sustech_discover."),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ command }, ctx) => {
      try {
        const result = await describeCliForMcp(command, { ...options.runner, signal: ctx.mcpReq.signal });
        return toolResult(result.envelope, result.exitCode !== 0 || result.envelope.ok === false);
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "sustech_version",
    {
      title: "Read the installed SUSTech CLI version",
      description: "Return the installed sustech-cli and Node.js runtime versions.",
      inputSchema: z.object({}),
      annotations: readOnlyAnnotations(false),
    },
    async (_input, ctx) => execute("version", [], ctx.mcpReq.signal),
  );

  server.registerTool(
    "sustech_calendar_day",
    {
      title: "Read one SUSTech academic-calendar day",
      description: "Resolve one date into teaching week, holiday, makeup, and exam flags from the public calendar dataset.",
      inputSchema: z.object({
        date: ISO_DATE,
        level: z.enum(["undergraduate", "graduate"]).optional(),
      }),
      annotations: readOnlyAnnotations(true),
    },
    async ({ date, level }, ctx) => execute("calendar day", [date, ...option("--calendar-level", level)], ctx.mcpReq.signal),
  );

  server.registerTool(
    "sustech_online_search",
    {
      title: "Search selected SUSTech Online public information",
      description: "Search talks and institutional contacts from selected community-maintained SUSTech Online pages, with provenance and freshness metadata.",
      inputSchema: z.object({
        query: QUERY,
        section: z.enum(["talks", "contact"]).optional(),
        since: ISO_DATE.optional(),
        until: ISO_DATE.optional(),
        limit: LIMIT.optional(),
      }),
      annotations: readOnlyAnnotations(true),
    },
    async ({ query, section, since, until, limit }, ctx) => execute("online search", [
      query,
      ...option("--section", section),
      ...option("--since", since),
      ...option("--until", until),
      ...numberOption("--limit", limit),
    ], ctx.mcpReq.signal),
  );

  server.registerTool(
    "sustech_online_talks_list",
    {
      title: "List public SUSTech talks",
      description: "List public talks indexed by the community-maintained SUSTech Online repository.",
      inputSchema: z.object({ since: ISO_DATE.optional(), until: ISO_DATE.optional(), limit: LIMIT.optional() }),
      annotations: readOnlyAnnotations(true),
    },
    async ({ since, until, limit }, ctx) => execute("online talks list", [
      ...option("--since", since),
      ...option("--until", until),
      ...numberOption("--limit", limit),
    ], ctx.mcpReq.signal),
  );

  server.registerTool(
    "sustech_online_talks_search",
    {
      title: "Search public SUSTech talks",
      description: "Search titles, speakers, places, and other public talk fields indexed by SUSTech Online.",
      inputSchema: z.object({ query: QUERY, since: ISO_DATE.optional(), until: ISO_DATE.optional(), limit: LIMIT.optional() }),
      annotations: readOnlyAnnotations(true),
    },
    async ({ query, since, until, limit }, ctx) => execute("online talks search", [
      query,
      ...option("--since", since),
      ...option("--until", until),
      ...numberOption("--limit", limit),
    ], ctx.mcpReq.signal),
  );

  server.registerTool(
    "sustech_online_talks_get",
    {
      title: "Read one public SUSTech talk",
      description: "Read one exact talk by the stable identifier returned by a talks list or search.",
      inputSchema: z.object({ id: IDENTIFIER }),
      annotations: readOnlyAnnotations(true),
    },
    async ({ id }, ctx) => execute("online talks get", [id], ctx.mcpReq.signal),
  );

  server.registerTool(
    "sustech_online_contact_search",
    {
      title: "Search institutional SUSTech contacts",
      description: "Search selected public institutional contacts from SUSTech Online. Personal, social, finance, and emergency content is excluded.",
      inputSchema: z.object({ query: QUERY, limit: LIMIT.optional() }),
      annotations: readOnlyAnnotations(true),
    },
    async ({ query, limit }, ctx) => execute("online contact search", [query, ...numberOption("--limit", limit)], ctx.mcpReq.signal),
  );

  server.registerTool(
    "sustech_online_contact_get",
    {
      title: "Read one institutional SUSTech contact",
      description: "Read one exact institutional public contact by the stable identifier returned by contact search.",
      inputSchema: z.object({ id: IDENTIFIER }),
      annotations: readOnlyAnnotations(true),
    },
    async ({ id }, ctx) => execute("online contact get", [id], ctx.mcpReq.signal),
  );

  registerPublicMcpTools(server);
  registerSustechMcpResources(server);
  registerSustechMcpPrompts(server);

  return server;
}

function toolResult(value: Record<string, unknown>, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
    ...(isError ? { isError: true } : {}),
  };
}

function toolError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const code = /^([A-Z][A-Z0-9_]+):/u.exec(message)?.[1] ?? "MCP_REQUEST_REJECTED";
  return toolResult({ ok: false, error: { code, message } }, true);
}

async function runTypedCommand(
  command: string,
  args: string[],
  signal?: AbortSignal,
  runnerOptions: Pick<McpRunnerOptions, "cliPath" | "timeoutMs"> = {},
) {
  try {
    const result = await runCliForMcp(command, args, { ...runnerOptions, signal });
    return toolResult(result.envelope, result.exitCode !== 0 || result.envelope.ok === false);
  } catch (error) {
    return toolError(error);
  }
}

function option(name: string, value: string | undefined): string[] {
  return value === undefined ? [] : [name, value];
}

function numberOption(name: string, value: number | undefined): string[] {
  return value === undefined ? [] : [name, String(value)];
}

function readOnlyAnnotations(openWorldHint: boolean) {
  return { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint };
}

if (isDirectExecution()) {
  const args = process.argv.slice(2);
  if (args.length === 1 && ["-h", "--help"].includes(args[0]!)) {
    process.stdout.write([
      "sustech-mcp — local SUSTech Model Context Protocol server",
      "",
      "Usage:",
      "  sustech-mcp             Serve MCP over stdio",
      "  sustech-mcp --help      Show this help",
      "  sustech-mcp --version   Print the installed version",
      "",
      "Configure an MCP client to launch `sustech-mcp` as a local command.",
      "The server exposes public/local read-only tools; authenticated data and writes remain in `sustech`.",
      "",
    ].join("\n"));
  } else if (args.length === 1 && ["-V", "--version"].includes(args[0]!)) {
    process.stdout.write(`${CLI_VERSION}\n`);
  } else if (args.length > 0) {
    process.stderr.write(`sustech-mcp: unsupported argument: ${args.join(" ")}\n`);
    process.exitCode = 2;
  } else {
    serveStdio(() => createSustechMcpServer(), {
      onerror: (error) => process.stderr.write(`sustech-mcp: ${error.message}\n`),
    });
  }
}

function isDirectExecution(): boolean {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolvePath(process.argv[1]));
  } catch {
    return false;
  }
}
