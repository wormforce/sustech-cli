import type { Capability } from "../core/capabilities.js";
import { PUBLIC_MCP_TOOL_BY_COMMAND } from "./public-tool-names.js";

export const MCP_TOOL_BY_COMMAND = {
  capabilities: "sustech_discover",
  describe: "sustech_describe",
  version: "sustech_version",
  ...PUBLIC_MCP_TOOL_BY_COMMAND,
} as const;

export type McpExposedCommand = keyof typeof MCP_TOOL_BY_COMMAND;

export function mcpToolForCommand(command: string): string | undefined {
  return MCP_TOOL_BY_COMMAND[command as McpExposedCommand];
}

export function isMcpExecutableCapability(capability: Capability): boolean {
  return mcpToolForCommand(capability.command) !== undefined;
}
