import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { inferCommandName } from "../core/argv.js";
import { CAPABILITIES, type Capability } from "../core/capabilities.js";
import { isMcpExecutableCapability } from "./registry.js";

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_ARGUMENTS = 128;
const MAX_ARGUMENT_LENGTH = 4_096;

const LOCAL_WRITE_COMMANDS = new Set([
  "tis plan add",
  "tis plan init",
  "tis plan remove",
]);

const BLOCKED_ARGUMENTS = new Set([
  "-h",
  "--browser",
  "--confirm",
  "--credentials-file",
  "--destination",
  "--file",
  "--help",
  "--interactive",
  "--json",
  "--jsonl",
  "--output",
  "--overwrite",
  "--password-stdin",
  "--path",
  "--pretty",
  "--requirements",
  "--reveal",
  "--state",
  "--url-stdin",
  "--",
]);

export interface McpCliEnvelope {
  schemaVersion?: string;
  ok?: boolean;
  command?: string;
  data?: unknown;
  error?: unknown;
  [key: string]: unknown;
}

export interface McpCliRunResult {
  exitCode: number;
  envelope: McpCliEnvelope;
}

export interface McpRunnerOptions {
  cliPath?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export function capabilityByCommand(command: string): Capability | undefined {
  return CAPABILITIES.find((entry) => entry.command === command);
}

export function validateMcpCommand(command: string, args: readonly string[]): Capability {
  const capability = capabilityByCommand(command);
  if (!capability) throw new Error(`Unknown sustech command: ${command}`);
  if (capability.kind === "mutation" || LOCAL_WRITE_COMMANDS.has(command)) {
    throw new Error(`MCP_MUTATION_BLOCKED: '${command}' changes state and must be run directly in the CLI.`);
  }
  if (!isMcpExecutableCapability(capability)) {
    throw new Error(`MCP_COMMAND_NOT_EXPOSED: '${command}' does not have a typed MCP tool.`);
  }
  if (args.length > MAX_ARGUMENTS) throw new Error(`Too many arguments; maximum is ${MAX_ARGUMENTS}.`);

  for (const argument of args) {
    if (argument.length > MAX_ARGUMENT_LENGTH) {
      throw new Error(`An argument exceeds the ${MAX_ARGUMENT_LENGTH}-character limit.`);
    }
    if (argument.includes("\0")) throw new Error("Arguments cannot contain NUL bytes.");
    const optionName = argument.startsWith("--") ? argument.split("=", 1)[0] : argument;
    if (BLOCKED_ARGUMENTS.has(optionName)) {
      throw new Error(`MCP_ARGUMENT_BLOCKED: '${optionName}' is unavailable through MCP.`);
    }
  }

  const inferred = inferCommandName([...command.split(" "), ...args]);
  if (inferred !== command) {
    throw new Error(`Arguments changed the command from '${command}' to '${inferred}'.`);
  }
  return capability;
}

export async function runCliForMcp(
  command: string,
  args: readonly string[] = [],
  options: McpRunnerOptions = {},
): Promise<McpCliRunResult> {
  validateMcpCommand(command, args);
  return spawnStructuredCli([...command.split(" "), ...args], options);
}

export async function describeCliForMcp(
  command: string,
  options: McpRunnerOptions = {},
): Promise<McpCliRunResult> {
  if (!capabilityByCommand(command)) throw new Error(`Unknown sustech command: ${command}`);
  return spawnStructuredCli(["describe", ...command.split(" ")], options);
}

async function spawnStructuredCli(
  argv: readonly string[],
  options: McpRunnerOptions,
): Promise<McpCliRunResult> {
  const cliPath = options.cliPath ?? fileURLToPath(new URL("../cli.js", import.meta.url));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120_000) {
    throw new Error("MCP runner timeout must be between 1 and 120000 milliseconds.");
  }
  if (options.signal?.aborted) {
    throw cancelError(options.signal.reason, true);
  }

  return new Promise<McpCliRunResult>((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...argv, "--json"], {
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    let stdoutBytes = 0;
    let settled = false;
    let terminationReason: Error | undefined;
    let forceKill: NodeJS.Timeout | undefined;

    const cleanup = (): void => {
      clearTimeout(timeout);
      if (forceKill) clearTimeout(forceKill);
      options.signal?.removeEventListener("abort", abortHandler);
    };

    const terminate = (reason: Error): void => {
      if (terminationReason) return;
      terminationReason = reason;
      child.kill("SIGTERM");
      forceKill = setTimeout(() => child.kill("SIGKILL"), 1_000);
      forceKill.unref();
    };

    const abortHandler = (): void => {
      terminate(cancelError(options.signal?.reason));
    };

    const timeout = setTimeout(() => {
      terminate(new Error(`MCP_CLI_TIMEOUT: command exceeded ${timeoutMs} milliseconds.`));
    }, timeoutMs);
    timeout.unref();
    options.signal?.addEventListener("abort", abortHandler, { once: true });
    if (options.signal?.aborted) abortHandler();

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_OUTPUT_BYTES) {
        terminate(new Error(`MCP_OUTPUT_TOO_LARGE: command exceeded ${MAX_OUTPUT_BYTES} bytes.`));
        return;
      }
      stdout.push(chunk);
    });

    // Consume stderr so the child cannot block. It is intentionally not returned
    // because upstream diagnostics may contain sensitive campus-service details.
    child.stderr.resume();

    child.once("error", (error) => {
      cleanup();
      if (settled) return;
      settled = true;
      reject(error);
    });

    child.once("close", (code) => {
      cleanup();
      if (settled) return;
      settled = true;
      if (terminationReason) {
        reject(terminationReason);
        return;
      }
      const raw = Buffer.concat(stdout).toString("utf8").trim();
      if (!raw) {
        reject(new Error(`MCP_CLI_NO_OUTPUT: sustech exited with code ${code ?? 1}.`));
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        reject(new Error("MCP_CLI_INVALID_OUTPUT: sustech did not return one JSON envelope."));
        return;
      }
      if (!isRecord(parsed)) {
        reject(new Error("MCP_CLI_INVALID_OUTPUT: sustech returned a non-object JSON value."));
        return;
      }
      resolve({ exitCode: code ?? 1, envelope: parsed as McpCliEnvelope });
    });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cancelError(reason: unknown, beforeStart = false): Error {
  const detail = reason instanceof Error
    ? reason.message
    : typeof reason === "string"
      ? reason
      : beforeStart
        ? "request was cancelled before the CLI started."
        : "request was cancelled by the MCP client.";
  return new Error(`MCP_CLI_CANCELLED: ${detail}`);
}
