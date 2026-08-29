import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { CONSEQUENCES } from "../core/consequences.js";
import { DEPARTMENTS } from "../faculty/client.js";
import type { ResourceCategory } from "../resources/catalog.js";
import { runCliForMcp } from "./runner.js";
import { PUBLIC_MCP_TOOL_BY_COMMAND } from "./public-tool-names.js";

const YEAR = z.number().int().min(2000).max(2100);
const QUERY = z.string().trim().min(1).max(500);
const IDENTIFIER = z.string().trim().regex(/^[A-Za-z0-9._:-]{1,160}$/, "Unsupported identifier format.");
const LINE_NAME = z.string().trim().min(1).max(160);
const PRIMO_SEGMENT = z.string().trim().min(1).max(500)
  .refine((value) => !/[/?#]/u.test(value), "Primo identifiers cannot contain path separators or URL fragments.");
const RESOURCE_CATEGORIES = ["official", "academic", "maps", "papers", "community"] as const satisfies readonly ResourceCategory[];
const TRANSIT_DAY_TYPES = ["workday", "holiday"] as const;
const NCES_SORTS = ["rating", "reviews", "name"] as const;
const FACULTY_LIMIT = z.number().int().min(1).max(200);
const TRANSIT_LIMIT = z.number().int().min(1).max(100);
const PAPERS_MAX = z.number().int().min(1).max(100);
const NCES_PAGE = z.number().int().min(1).max(10_000);
const NCES_PAGE_SIZE = z.number().int().min(1).max(50);
const LIBRARY_LIMIT = z.number().int().min(1).max(50);
const TRANSIT_ROUTE_INDEX = z.number().int().min(0).max(100);
const TRANSIT_DIRECTION = z.number().int().min(0).max(1);
const SERVICE_NAMES = [
  "blackboard",
  "booking",
  "library-catalog",
  "library-booking",
  "ws",
  "pms",
  "nces",
  "papers",
  "sustech-online",
] as const;
const CONSEQUENCE_OPERATIONS = CONSEQUENCES.map((entry) => entry.operation) as [string, ...string[]];

export function registerPublicMcpTools(server: McpServer): void {
  server.registerTool(
    PUBLIC_MCP_TOOL_BY_COMMAND.consequences,
    {
      title: "List SUSTech CLI consequence rules",
      description: "Return structured risk and verification rules for one exact consequence-rich operation or the full registry.",
      inputSchema: z.object({
        operation: z.enum(CONSEQUENCE_OPERATIONS).optional(),
      }),
      annotations: readOnlyAnnotations(false),
    },
    async ({ operation }, ctx) => runTypedCommand("consequences", operation === undefined ? [] : [operation], ctx.mcpReq.signal),
  );

  server.registerTool(
    PUBLIC_MCP_TOOL_BY_COMMAND["calendar terms"],
    {
      title: "Read SUSTech academic terms",
      description: "Read public semester boundaries for one academic-calendar year and level.",
      inputSchema: z.object({
        year: YEAR.optional(),
        level: z.enum(["undergraduate", "graduate"]).optional(),
      }),
      annotations: readOnlyAnnotations(true),
    },
    async ({ year, level }, ctx) => runTypedCommand("calendar terms", [
      ...numberOption("--year", year),
      ...option("--calendar-level", level),
    ], ctx.mcpReq.signal),
  );

  server.registerTool(
    PUBLIC_MCP_TOOL_BY_COMMAND["resources list"],
    {
      title: "List built-in campus resources",
      description: "List the built-in resource registry, optionally filtered by category.",
      inputSchema: z.object({
        category: z.enum(RESOURCE_CATEGORIES).optional(),
      }),
      annotations: readOnlyAnnotations(false),
    },
    async ({ category }, ctx) => runTypedCommand("resources list", option("--category", category), ctx.mcpReq.signal),
  );

  server.registerTool(
    PUBLIC_MCP_TOOL_BY_COMMAND["resources search"],
    {
      title: "Search built-in campus resources",
      description: "Search the built-in resource registry by keyword and optional category.",
      inputSchema: z.object({
        query: QUERY,
        category: z.enum(RESOURCE_CATEGORIES).optional(),
      }),
      annotations: readOnlyAnnotations(false),
    },
    async ({ query, category }, ctx) => runTypedCommand("resources search", [query, ...option("--category", category)], ctx.mcpReq.signal),
  );

  server.registerTool(
    PUBLIC_MCP_TOOL_BY_COMMAND["services status"],
    {
      title: "Read service adapter availability",
      description: "Report which built-in service adapters are implemented, preview-only, or unavailable.",
      inputSchema: z.object({
        service: z.enum(SERVICE_NAMES).optional(),
      }),
      annotations: readOnlyAnnotations(false),
    },
    async ({ service }, ctx) => runTypedCommand("services status", service === undefined ? [] : [service], ctx.mcpReq.signal),
  );

  server.registerTool(
    PUBLIC_MCP_TOOL_BY_COMMAND["papers search"],
    {
      title: "Search public paper metadata",
      description: "Search public CrossRef paper metadata with optional minimum year and open-access filtering.",
      inputSchema: z.object({
        query: QUERY,
        max: PAPERS_MAX.optional(),
        minYear: z.number().int().min(1900).max(new Date().getFullYear() + 1).optional(),
        openAccessOnly: z.boolean().optional(),
        resolveOpenAccess: z.boolean().optional(),
      }),
      annotations: readOnlyAnnotations(true),
    },
    async ({ query, max, minYear, openAccessOnly, resolveOpenAccess }, ctx) => runTypedCommand("papers search", [
      query,
      ...numberOption("--max", max),
      ...numberOption("--min-year", minYear),
      ...(openAccessOnly ? ["--open-access"] : []),
      ...(resolveOpenAccess ? ["--resolve-oa"] : []),
    ], ctx.mcpReq.signal),
  );

  server.registerTool(
    PUBLIC_MCP_TOOL_BY_COMMAND["nces browse"],
    {
      title: "Browse NCES community course evaluations",
      description: "Browse public NCES courses by page, page size, and supported sort order.",
      inputSchema: z.object({
        page: NCES_PAGE.optional(),
        pageSize: NCES_PAGE_SIZE.optional(),
        sort: z.enum(NCES_SORTS).optional(),
      }),
      annotations: readOnlyAnnotations(true),
    },
    async ({ page, pageSize, sort }, ctx) => runTypedCommand("nces browse", [
      ...numberOption("--page", page),
      ...numberOption("--page-size", pageSize),
      ...option("--sort", sort),
    ], ctx.mcpReq.signal),
  );

  server.registerTool(
    PUBLIC_MCP_TOOL_BY_COMMAND["nces search"],
    {
      title: "Search NCES courses",
      description: "Search public NCES courses and review samples by keyword.",
      inputSchema: z.object({
        query: QUERY,
      }),
      annotations: readOnlyAnnotations(true),
    },
    async ({ query }, ctx) => runTypedCommand("nces search", [query], ctx.mcpReq.signal),
  );

  server.registerTool(
    PUBLIC_MCP_TOOL_BY_COMMAND["nces course"],
    {
      title: "Read one NCES course",
      description: "Read one public NCES course and its reviews by numeric course identifier.",
      inputSchema: z.object({
        id: z.number().int().min(1),
      }),
      annotations: readOnlyAnnotations(true),
    },
    async ({ id }, ctx) => runTypedCommand("nces course", [String(id)], ctx.mcpReq.signal),
  );

  server.registerTool(
    PUBLIC_MCP_TOOL_BY_COMMAND["library search"],
    {
      title: "Search the public library catalog",
      description: "Search public Primo metadata through the normalized JSON path without opening a browser session.",
      inputSchema: z.object({
        query: QUERY,
        limit: LIBRARY_LIMIT.optional(),
      }),
      annotations: readOnlyAnnotations(true),
    },
    async ({ query, limit }, ctx) => runTypedCommand("library search", [
      query,
      ...numberOption("--limit", limit),
    ], ctx.mcpReq.signal),
  );

  server.registerTool(
    PUBLIC_MCP_TOOL_BY_COMMAND["library detail"],
    {
      title: "Read one library catalog record",
      description: "Read one exact public Primo record by CONTEXT:DOC_ID reference.",
      inputSchema: z.object({
        context: PRIMO_SEGMENT,
        docId: PRIMO_SEGMENT,
      }),
      annotations: readOnlyAnnotations(true),
    },
    async ({ context, docId }, ctx) => runTypedCommand("library detail", [`${context}:${docId}`], ctx.mcpReq.signal),
  );

  server.registerTool(
    PUBLIC_MCP_TOOL_BY_COMMAND["library search-url"],
    {
      title: "Build a library discovery URL",
      description: "Build a browser handoff URL for Primo without fabricating catalog results.",
      inputSchema: z.object({
        query: QUERY,
        limit: LIBRARY_LIMIT.optional(),
      }),
      annotations: readOnlyAnnotations(false),
    },
    async ({ query, limit }, ctx) => runTypedCommand("library search-url", [
      query,
      ...numberOption("--limit", limit),
    ], ctx.mcpReq.signal),
  );

  server.registerTool(
    PUBLIC_MCP_TOOL_BY_COMMAND["faculty departments"],
    {
      title: "List public faculty departments",
      description: "List the known public SUSTech faculty departments.",
      inputSchema: z.object({}),
      annotations: readOnlyAnnotations(false),
    },
    async (_input, ctx) => runTypedCommand("faculty departments", [], ctx.mcpReq.signal),
  );

  server.registerTool(
    PUBLIC_MCP_TOOL_BY_COMMAND["faculty list"],
    {
      title: "List faculty profiles in one department",
      description: "List public faculty profiles in one exact department, with optional full-profile expansion.",
      inputSchema: z.object({
        department: z.enum(DEPARTMENTS),
        full: z.boolean().optional(),
        limit: FACULTY_LIMIT.optional(),
      }),
      annotations: readOnlyAnnotations(true),
    },
    async ({ department, full, limit }, ctx) => runTypedCommand("faculty list", [
      department,
      ...(full ? ["--full"] : []),
      ...numberOption("--limit", limit),
    ], ctx.mcpReq.signal),
  );

  server.registerTool(
    PUBLIC_MCP_TOOL_BY_COMMAND["faculty get"],
    {
      title: "Read one faculty profile",
      description: "Read one public faculty profile by exact slug.",
      inputSchema: z.object({
        slug: IDENTIFIER,
      }),
      annotations: readOnlyAnnotations(true),
    },
    async ({ slug }, ctx) => runTypedCommand("faculty get", [slug], ctx.mcpReq.signal),
  );

  server.registerTool(
    PUBLIC_MCP_TOOL_BY_COMMAND["faculty search"],
    {
      title: "Search faculty profiles",
      description: "Search public faculty profiles by keyword, with an optional exact department filter.",
      inputSchema: z.object({
        query: QUERY,
        department: z.enum(DEPARTMENTS).optional(),
        limit: FACULTY_LIMIT.optional(),
      }),
      annotations: readOnlyAnnotations(true),
    },
    async ({ query, department, limit }, ctx) => runTypedCommand("faculty search", [
      query,
      ...option("--department", department),
      ...numberOption("--limit", limit),
    ], ctx.mcpReq.signal),
  );

  server.registerTool(
    PUBLIC_MCP_TOOL_BY_COMMAND["faculty render"],
    {
      title: "Render one faculty profile as Markdown",
      description: "Render one public faculty profile into agent-readable Markdown by exact slug.",
      inputSchema: z.object({
        slug: IDENTIFIER,
      }),
      annotations: readOnlyAnnotations(true),
    },
    async ({ slug }, ctx) => runTypedCommand("faculty render", [slug], ctx.mcpReq.signal),
  );

  server.registerTool(
    PUBLIC_MCP_TOOL_BY_COMMAND["transit facilities"],
    {
      title: "List campus facilities and gates",
      description: "List public campus buildings and gates from the transit datasets.",
      inputSchema: z.object({}),
      annotations: readOnlyAnnotations(true),
    },
    async (_input, ctx) => runTypedCommand("transit facilities", [], ctx.mcpReq.signal),
  );

  server.registerTool(
    PUBLIC_MCP_TOOL_BY_COMMAND["transit find"],
    {
      title: "Search campus facilities and stops",
      description: "Search public campus buildings, gates, and bus stops by keyword.",
      inputSchema: z.object({
        query: QUERY,
        limit: TRANSIT_LIMIT.optional(),
      }),
      annotations: readOnlyAnnotations(true),
    },
    async ({ query, limit }, ctx) => runTypedCommand("transit find", [
      query,
      ...numberOption("--limit", limit),
    ], ctx.mcpReq.signal),
  );

  server.registerTool(
    PUBLIC_MCP_TOOL_BY_COMMAND["transit lines"],
    {
      title: "List public bus lines",
      description: "List public campus bus lines for workdays or holidays.",
      inputSchema: z.object({
        dayType: z.enum(TRANSIT_DAY_TYPES).optional(),
      }),
      annotations: readOnlyAnnotations(true),
    },
    async ({ dayType }, ctx) => runTypedCommand("transit lines", option("--day", dayType), ctx.mcpReq.signal),
  );

  server.registerTool(
    PUBLIC_MCP_TOOL_BY_COMMAND["transit schedule"],
    {
      title: "Read a public bus schedule",
      description: "Read departures for one exact public bus line and optional sub-route index.",
      inputSchema: z.object({
        lineId: LINE_NAME,
        routeIndex: TRANSIT_ROUTE_INDEX.optional(),
        dayType: z.enum(TRANSIT_DAY_TYPES).optional(),
      }),
      annotations: readOnlyAnnotations(true),
    },
    async ({ lineId, routeIndex, dayType }, ctx) => runTypedCommand("transit schedule", [
      lineId,
      ...numberOption("--route-index", routeIndex),
      ...option("--day", dayType),
    ], ctx.mcpReq.signal),
  );

  server.registerTool(
    PUBLIC_MCP_TOOL_BY_COMMAND["transit stops"],
    {
      title: "List public stops for one route",
      description: "List public stops for one exact live route code and direction.",
      inputSchema: z.object({
        line: LINE_NAME,
        direction: TRANSIT_DIRECTION.optional(),
      }),
      annotations: readOnlyAnnotations(true),
    },
    async ({ line, direction }, ctx) => runTypedCommand("transit stops", [
      line,
      ...numberOption("--direction", direction),
    ], ctx.mcpReq.signal),
  );

  server.registerTool(
    PUBLIC_MCP_TOOL_BY_COMMAND["transit live"],
    {
      title: "Read live campus bus positions",
      description: "Read public live campus bus positions from the transit dataset.",
      inputSchema: z.object({}),
      annotations: readOnlyAnnotations(true),
    },
    async (_input, ctx) => runTypedCommand("transit live", [], ctx.mcpReq.signal),
  );
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

async function runTypedCommand(command: string, args: string[], signal?: AbortSignal) {
  try {
    const result = await runCliForMcp(command, args, { signal });
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
