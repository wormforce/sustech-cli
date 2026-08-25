import { CliError } from "./errors.js";

const USER_AGENT = "sustech-cli/0.2 (+https://github.com/aprylewu/sustech-cli)";

export async function fetchJson(url: string, options: { timeoutMs?: number } = {}): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: "application/json", "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
    });
  } catch (error) {
    throw new CliError("Could not reach the upstream service.", "NETWORK_ERROR", 1, {
      url: safeUrl(url),
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  if (!response.ok) {
    throw new CliError("The upstream service returned an HTTP error.", "UPSTREAM_HTTP_ERROR", 1, {
      url: safeUrl(url),
      status: response.status,
    });
  }
  try {
    return await response.json();
  } catch (error) {
    throw new CliError("The upstream service returned invalid JSON.", "UPSTREAM_PROTOCOL_ERROR", 1, {
      url: safeUrl(url),
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

function safeUrl(value: string): string {
  const url = new URL(value);
  url.username = "";
  url.password = "";
  return url.toString();
}
