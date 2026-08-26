import { CliError } from "./errors.js";
import { USER_AGENT } from "./version.js";

export interface FetchOptions {
  timeoutMs?: number;
  headers?: Record<string, string>;
}

export async function fetchJson(url: string, options: FetchOptions = {}): Promise<unknown> {
  const response = await fetchResponse(url, options);
  try {
    return await response.json();
  } catch (error) {
    throw new CliError("The upstream service returned invalid JSON.", "UPSTREAM_PROTOCOL_ERROR", 1, {
      url: safeUrl(url),
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function fetchText(url: string, options: FetchOptions = {}): Promise<string> {
  const response = await fetchResponse(url, options);
  return response.text();
}

async function fetchResponse(url: string, options: FetchOptions): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "user-agent": USER_AGENT, ...options.headers },
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
  return response;
}

function safeUrl(value: string): string {
  const url = new URL(value);
  url.username = "";
  url.password = "";
  return url.toString();
}
