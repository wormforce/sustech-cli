import { CliError } from "./errors.js";

export const OUTPUT_SCHEMA_VERSION = "1";

export type OutputMode = "text" | "json" | "jsonl";

export interface OutputFlags {
  output?: string;
  json?: boolean;
  jsonl?: boolean;
  pretty?: boolean;
}

export interface OutputOptions {
  mode: OutputMode;
  pretty: boolean;
}

export interface CommandResult<T> {
  command: string;
  data: T;
  text: string;
  items?: unknown[];
  summary?: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

export interface ErrorResult {
  output: string;
  exitCode: number;
  stream: "stdout" | "stderr";
}

export function resolveOutputOptions(flags: OutputFlags): OutputOptions {
  const requested = [
    flags.json ? "json" : undefined,
    flags.jsonl ? "jsonl" : undefined,
    flags.output,
  ].filter((value): value is string => Boolean(value));

  if (requested.length > 1) {
    throw new CliError(
      "Choose only one output selector: --json, --jsonl, or --output.",
      "OUTPUT_MODE_CONFLICT",
      2,
    );
  }

  const mode = requested[0] ?? "text";
  if (!isOutputMode(mode)) {
    throw new CliError(
      "--output must be one of: text, json, jsonl.",
      "INVALID_OUTPUT_MODE",
      2,
      { received: mode },
    );
  }
  return { mode, pretty: Boolean(flags.pretty) };
}

export function inferOutputOptions(argv: string[]): OutputOptions {
  if (argv.includes("--jsonl")) return { mode: "jsonl", pretty: false };
  if (argv.includes("--json")) return { mode: "json", pretty: argv.includes("--pretty") };
  const outputIndex = argv.indexOf("--output");
  const output = outputIndex >= 0 ? argv[outputIndex + 1] : undefined;
  return {
    mode: isOutputMode(output) ? output : "text",
    pretty: argv.includes("--pretty"),
  };
}

export function renderSuccess<T>(result: CommandResult<T>, options: OutputOptions): string {
  if (options.mode === "text") return ensureTrailingNewline(result.text);

  if (options.mode === "json") {
    return stringify(
      {
        schemaVersion: OUTPUT_SCHEMA_VERSION,
        ok: true,
        command: result.command,
        data: result.data,
        ...(result.meta ? { meta: result.meta } : {}),
      },
      options.pretty,
    );
  }

  if (result.items) {
    const lines = result.items.map((item) =>
      JSON.stringify({
        schemaVersion: OUTPUT_SCHEMA_VERSION,
        type: "item",
        command: result.command,
        data: item,
      }),
    );
    lines.push(
      JSON.stringify({
        schemaVersion: OUTPUT_SCHEMA_VERSION,
        type: "summary",
        command: result.command,
        data: result.summary ?? { count: result.items.length },
        ...(result.meta ? { meta: result.meta } : {}),
      }),
    );
    return `${lines.join("\n")}\n`;
  }

  return `${JSON.stringify({
    schemaVersion: OUTPUT_SCHEMA_VERSION,
    type: "result",
    command: result.command,
    data: result.data,
    ...(result.meta ? { meta: result.meta } : {}),
  })}\n`;
}

export function renderError(error: unknown, command: string, options: OutputOptions): ErrorResult {
  const cliError = normaliseError(error);
  if (options.mode === "text") {
    const details = cliError.details ? `\n${JSON.stringify(cliError.details, null, 2)}` : "";
    return {
      output: `Error [${cliError.code}]: ${cliError.message}${details}\n`,
      exitCode: cliError.exitCode,
      stream: "stderr",
    };
  }

  const envelope = {
    schemaVersion: OUTPUT_SCHEMA_VERSION,
    ok: false,
    command,
    error: {
      code: cliError.code,
      message: cliError.message,
      ...(cliError.details ? { details: cliError.details } : {}),
    },
  };
  return {
    output: options.mode === "jsonl"
      ? `${JSON.stringify({ type: "error", ...envelope })}\n`
      : stringify(envelope, options.pretty),
    exitCode: cliError.exitCode,
    stream: "stdout",
  };
}

export function writeSuccess<T>(result: CommandResult<T>, options: OutputOptions): void {
  process.stdout.write(renderSuccess(result, options));
}

export function writeError(error: unknown, command: string, options: OutputOptions): number {
  const rendered = renderError(error, command, options);
  process[rendered.stream].write(rendered.output);
  return rendered.exitCode;
}

function normaliseError(error: unknown): CliError {
  if (error instanceof CliError) return error;
  return new CliError(
    error instanceof Error ? error.message : String(error),
    "UNEXPECTED_ERROR",
    1,
  );
}

function stringify(value: unknown, pretty: boolean): string {
  return `${JSON.stringify(value, null, pretty ? 2 : undefined)}\n`;
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function isOutputMode(value: unknown): value is OutputMode {
  return value === "text" || value === "json" || value === "jsonl";
}
