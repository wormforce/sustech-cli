import { Writable } from "node:stream";
import { createInterface } from "node:readline/promises";
import { CliError } from "./errors.js";

const MAX_INPUT_BYTES = 16 * 1024;

export async function promptLoginSid(): Promise<string> {
  requireInteractiveTerminal();
  const readline = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
  try {
    return (await readline.question("Student ID: ")).trim();
  } finally {
    readline.close();
  }
}

export async function promptHiddenPassword(): Promise<string> {
  requireInteractiveTerminal();
  const output = new MutedOutput(process.stderr);
  const readline = createInterface({ input: process.stdin, output, terminal: true });
  const controller = new AbortController();
  readline.once("SIGINT", () => controller.abort());
  process.stderr.write("Password: ");
  output.muted = true;
  try {
    return await readline.question("", { signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new CliError("Credential prompt cancelled.", "CREDENTIAL_PROMPT_CANCELLED", 2);
    }
    throw error;
  } finally {
    output.muted = false;
    readline.close();
    process.stderr.write("\n");
  }
}

export async function readPasswordFromStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new CliError(
      "--password-stdin expects redirected input. Omit it to use the hidden terminal prompt.",
      "PASSWORD_STDIN_EXPECTED",
      2,
    );
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_INPUT_BYTES) {
      throw new CliError("Password input is unexpectedly large.", "INVALID_CREDENTIAL_PASSWORD", 2);
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
  if (!raw || /[\r\n]/.test(raw)) {
    throw new CliError("--password-stdin must provide exactly one non-empty line.", "INVALID_CREDENTIAL_PASSWORD", 2);
  }
  return raw;
}

function requireInteractiveTerminal(): void {
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw new CliError(
      "An interactive terminal is required. Use --password-stdin with --sid for controlled non-interactive input.",
      "INTERACTIVE_TERMINAL_REQUIRED",
      2,
    );
  }
}

class MutedOutput extends Writable {
  public muted = false;

  public constructor(private readonly target: NodeJS.WriteStream) {
    super();
  }

  public override _write(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    if (!this.muted) this.target.write(chunk, encoding);
    callback();
  }
}
