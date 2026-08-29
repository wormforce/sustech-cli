import type { Capability } from "../core/capabilities.js";
import { PUBLIC_MCP_TOOL_BY_COMMAND } from "./public-tool-names.js";

export const MCP_TOOL_BY_COMMAND = {
  capabilities: "sustech_discover",
  describe: "sustech_describe",
  version: "sustech_version",
  "calendar day": "sustech_calendar_day",
  "online search": "sustech_online_search",
  "online talks list": "sustech_online_talks_list",
  "online talks search": "sustech_online_talks_search",
  "online talks get": "sustech_online_talks_get",
  "online contact search": "sustech_online_contact_search",
  "online contact get": "sustech_online_contact_get",
  ...PUBLIC_MCP_TOOL_BY_COMMAND,
} as const;

export type McpExposedCommand = keyof typeof MCP_TOOL_BY_COMMAND;

export function mcpToolForCommand(command: string): string | undefined {
  return MCP_TOOL_BY_COMMAND[command as McpExposedCommand];
}

export function isMcpExecutableCapability(capability: Capability): boolean {
  return mcpToolForCommand(capability.command) !== undefined;
}
