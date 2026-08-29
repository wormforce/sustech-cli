import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import { CAPABILITIES } from "../core/capabilities.js";
import { describeCliForMcp, runCliForMcp } from "./runner.js";
import { isMcpExecutableCapability, mcpToolForCommand } from "./registry.js";

const JSON_MIME_TYPE = "application/json";
const OPAQUE_TOKEN_RE = /^[A-Za-z0-9._:-]{1,160}$/u;

export function registerSustechMcpResources(server: McpServer): void {
  server.registerResource(
    "sustech-version-resource",
    "sustech://version",
    {
      title: "Installed sustech-cli version",
      description: "Read the installed sustech-cli and Node.js runtime versions as JSON.",
      mimeType: JSON_MIME_TYPE,
    },
    async (uri, ctx) => jsonResource(uri, await cliEnvelope("version", [], ctx.mcpReq.signal)),
  );

  server.registerResource(
    "sustech-capabilities-resource",
    "sustech://capabilities",
    {
      title: "Installed sustech-cli capability registry",
      description: "Read the installed sustech-cli capability registry as JSON.",
      mimeType: JSON_MIME_TYPE,
    },
    async (uri, ctx) => jsonResource(uri, await cliEnvelope("capabilities", [], ctx.mcpReq.signal)),
  );

  server.registerResource(
    "sustech-services-resource",
    "sustech://services",
    {
      title: "Built-in service adapter status",
      description: "Read the installed service-adapter availability registry as JSON.",
      mimeType: JSON_MIME_TYPE,
    },
    async (uri, ctx) => jsonResource(uri, await cliEnvelope("services status", [], ctx.mcpReq.signal)),
  );

  server.registerResource(
    "sustech-consequences-resource",
    "sustech://consequences",
    {
      title: "CLI consequence rules",
      description: "Read structured risk and verification rules for consequence-rich operations as JSON.",
      mimeType: JSON_MIME_TYPE,
    },
    async (uri, ctx) => jsonResource(uri, await cliEnvelope("consequences", [], ctx.mcpReq.signal)),
  );

  server.registerResource(
    "sustech-mcp-policy-resource",
    "sustech://mcp/policy",
    {
      title: "SUSTech MCP policy",
      description: "Read the local sustech MCP transport, allowlist, and safety boundary as JSON.",
      mimeType: JSON_MIME_TYPE,
    },
    async (uri) => jsonResource(uri, mcpPolicyResource()),
  );

  server.registerResource(
    "sustech-faculty-profile-resource",
    new ResourceTemplate("sustech://faculty/{slug}", { list: undefined }),
    {
      title: "Faculty profile resource",
      description: "Read one public faculty profile by slug as JSON.",
      mimeType: JSON_MIME_TYPE,
    },
    async (uri, variables, ctx) => guardedJsonResource(uri, async () => {
      const slug = requireOpaqueToken(variables.slug, "slug");
      return cliEnvelope("faculty get", [slug], ctx.mcpReq.signal);
    }),
  );

  server.registerResource(
    "sustech-command-description-resource",
    new ResourceTemplate("sustech://command/{command}", { list: undefined }),
    {
      title: "SUSTech CLI command description",
      description: "Read usage, options, safety classification, and consequence metadata for one installed command.",
      mimeType: JSON_MIME_TYPE,
    },
    async (uri, variables, ctx) => guardedJsonResource(uri, async () => {
      const command = requireInstalledCommand(variables.command);
      return describeEnvelope(command, ctx.mcpReq.signal);
    }),
  );

  server.registerResource(
    "sustech-online-talk-resource",
    new ResourceTemplate("sustech://online/talk/{id}", { list: undefined }),
    {
      title: "SUSTech Online talk resource",
      description: "Read one public SUSTech Online talk by its stable slug identifier as JSON.",
      mimeType: JSON_MIME_TYPE,
    },
    async (uri, variables, ctx) => guardedJsonResource(uri, async () => {
      const id = requirePathSafeIdentifier(variables.id, "id");
      return cliEnvelope("online talks get", [id], ctx.mcpReq.signal);
    }),
  );

  server.registerResource(
    "sustech-nces-course-resource",
    new ResourceTemplate("sustech://nces/course/{id}", { list: undefined }),
    {
      title: "NCES course resource",
      description: "Read one public NCES course by numeric identifier as JSON.",
      mimeType: JSON_MIME_TYPE,
    },
    async (uri, variables, ctx) => guardedJsonResource(uri, async () => {
      const id = requirePositiveIntegerString(variables.id, "id");
      return cliEnvelope("nces course", [id], ctx.mcpReq.signal);
    }),
  );

  server.registerResource(
    "sustech-library-record-resource",
    new ResourceTemplate("sustech://library/{context}/{docId}", { list: undefined }),
    {
      title: "Library catalog record resource",
      description: "Read one public Primo library record by context and doc ID as JSON.",
      mimeType: JSON_MIME_TYPE,
    },
    async (uri, variables, ctx) => guardedJsonResource(uri, async () => {
      const context = requirePrimoSegment(variables.context, "context");
      const docId = requirePrimoSegment(variables.docId, "docId");
      return cliEnvelope("library detail", [`${context}:${docId}`], ctx.mcpReq.signal);
    }),
  );
}

async function cliEnvelope(command: string, args: string[], signal?: AbortSignal): Promise<Record<string, unknown>> {
  try {
    const result = await runCliForMcp(command, args, { signal });
    return result.envelope;
  } catch (error) {
    return resourceError(error);
  }
}

async function describeEnvelope(command: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
  try {
    return (await describeCliForMcp(command, { signal })).envelope;
  } catch (error) {
    return resourceError(error);
  }
}

function resourceError(error: unknown): Record<string, unknown> {
  const message = error instanceof Error ? error.message : String(error);
  return {
    ok: false,
    error: {
      code: /^([A-Z][A-Z0-9_]+):/u.exec(message)?.[1] ?? "MCP_REQUEST_REJECTED",
      message,
    },
  };
}

function jsonResource(uri: URL, value: Record<string, unknown>) {
  return {
    contents: [{
      uri: uri.href,
      mimeType: JSON_MIME_TYPE,
      text: JSON.stringify(value, null, 2),
    }],
  };
}

async function guardedJsonResource(
  uri: URL,
  load: () => Promise<Record<string, unknown>>,
) {
  try {
    return jsonResource(uri, await load());
  } catch (error) {
    return jsonResource(uri, resourceError(error));
  }
}

function mcpPolicyResource(): Record<string, unknown> {
  const exposedCommands = CAPABILITIES
    .filter((capability) => isMcpExecutableCapability(capability))
    .map((capability) => ({
      command: capability.command,
      kind: capability.kind,
      network: capability.network,
      authentication: capability.authentication,
      status: capability.status,
      mcpTool: mcpToolForCommand(capability.command),
    }));
  return {
    schemaVersion: "1",
    transport: "stdio",
    typedAllowlist: true,
    genericRunner: false,
    publicAndLocalOnly: true,
    authenticatedPersonalDataBlocked: true,
    localWritesBlocked: true,
    remoteMutationsBlocked: true,
    authenticatedReadsExposed: false,
    localPrivateWritesExposed: false,
    notes: [
      "Use dedicated typed MCP tools and resources for public or non-sensitive local metadata.",
      "Use the direct sustech CLI for authenticated personal data, local file writes, browser-assisted reads, and all remote mutations.",
      "SUSTech Online remains community-maintained and should retain provenance and freshness advisories.",
    ],
    exposedCommands,
  };
}

function variableText(value: unknown): string {
  const raw = typeof value === "string" ? value : String(value ?? "");
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new Error("MCP_RESOURCE_INVALID_ARGUMENT: resource variable contains invalid percent-encoding.");
  }
}

function requireInstalledCommand(value: unknown): string {
  const command = requireInlineText(value, "command", 200);
  if (!CAPABILITIES.some((capability) => capability.command === command)) {
    throw new Error(`MCP_RESOURCE_INVALID_ARGUMENT: unknown sustech command '${command}'.`);
  }
  return command;
}

function requireOpaqueToken(value: unknown, name: string): string {
  const text = requireInlineText(value, name, 160);
  if (!OPAQUE_TOKEN_RE.test(text)) {
    throw new Error(`MCP_RESOURCE_INVALID_ARGUMENT: '${name}' contains unsupported characters.`);
  }
  return text;
}

function requirePathSafeIdentifier(value: unknown, name: string): string {
  const text = requireInlineText(value, name, 500);
  if (text === "." || text === ".." || /[%/\\?#\u0000-\u001f\u007f]/u.test(text)) {
    throw new Error(`MCP_RESOURCE_INVALID_ARGUMENT: '${name}' contains unsupported path characters.`);
  }
  return text;
}

function requirePositiveIntegerString(value: unknown, name: string): string {
  const text = requireInlineText(value, name, 16);
  if (!/^[1-9]\d*$/u.test(text)) {
    throw new Error(`MCP_RESOURCE_INVALID_ARGUMENT: '${name}' must be a positive integer.`);
  }
  return text;
}

function requirePrimoSegment(value: unknown, name: string): string {
  const text = requireInlineText(value, name, 500);
  if (/[%/?#\\\u0000-\u001f\u007f]/u.test(text)) {
    throw new Error(`MCP_RESOURCE_INVALID_ARGUMENT: '${name}' cannot contain path separators or URL fragments.`);
  }
  return text;
}

function requireInlineText(value: unknown, name: string, maxLength: number): string {
  const text = variableText(value).trim();
  if (!text) throw new Error(`MCP_RESOURCE_INVALID_ARGUMENT: '${name}' is required.`);
  if (text.length > maxLength) {
    throw new Error(`MCP_RESOURCE_INVALID_ARGUMENT: '${name}' cannot exceed ${maxLength} characters.`);
  }
  if (/[\u0000-\u001f\u007f]/u.test(text)) {
    throw new Error(`MCP_RESOURCE_INVALID_ARGUMENT: '${name}' cannot contain control characters.`);
  }
  return text;
}
