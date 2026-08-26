import { CliError } from "../core/errors.js";

export type ServiceAvailability = "implemented" | "adapter_required" | "unavailable";
export type ServiceAuthMode = "none" | "cookie-session" | "bearer-header" | "browser";

export interface ServiceStatus {
  service: string;
  availability: ServiceAvailability;
  auth: ServiceAuthMode;
  campusNetwork: boolean;
  browser: boolean;
  summary: string;
  notes: readonly string[];
  endpoints: readonly string[];
}

export interface ServiceAdapter {
  readonly name: string;
  fetch(input: string, init?: RequestInit): Promise<Response>;
}

export class ServiceError extends CliError {
  public constructor(
    message: string,
    details: {
      url?: string;
      status?: number;
      bodySample?: string;
      cause?: string;
    } = {},
  ) {
    super(message, "SERVICE_ERROR", 1, details);
    this.name = "ServiceError";
  }
}

export function createFetchAdapter(fetchImpl: typeof fetch = globalThis.fetch, name = "fetch"): ServiceAdapter {
  return {
    name,
    fetch(input: string, init?: RequestInit): Promise<Response> {
      return fetchImpl(input, init);
    },
  };
}

export function requestUrl(
  base: string,
  path: string,
  query: Record<string, QueryValue> = {},
): string {
  const url = new URL(path, base);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null && item !== "") url.searchParams.append(key, String(item));
      }
      continue;
    }
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

export async function fetchJson<T>(adapter: ServiceAdapter, url: string, init?: RequestInit): Promise<T> {
  const response = await fetchResponse(adapter, url, init);
  const text = await response.text();
  if (!response.ok) {
    throw new ServiceError("Upstream service returned an HTTP error.", {
      url,
      status: response.status,
      bodySample: sampleText(text),
    });
  }
  return parseJson<T>(text, url);
}

export async function fetchText(adapter: ServiceAdapter, url: string, init?: RequestInit): Promise<string> {
  const response = await fetchResponse(adapter, url, init);
  const text = await response.text();
  if (!response.ok) {
    throw new ServiceError("Upstream service returned an HTTP error.", {
      url,
      status: response.status,
      bodySample: sampleText(text),
    });
  }
  return text;
}

export function parseJson<T>(text: string, url?: string): T {
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new ServiceError("Upstream service returned invalid JSON.", {
      url,
      bodySample: sampleText(text),
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

export function sampleText(value: string, limit = 160): string {
  return collapseWhitespace(value).slice(0, limit);
}

export function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, "");
}

export function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'");
}

export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function cleanText(value: unknown): string {
  return collapseWhitespace(decodeHtml(stripHtml(stringValue(value))));
}

export function stringValue(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

export function numberValue(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function booleanValue(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;
  }
  return fallback;
}

export function recordValue(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

export function arrayValue<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function dateString(value: Date | string): string {
  if (typeof value === "string") return value;
  return value.toISOString().slice(0, 10);
}

async function fetchResponse(adapter: ServiceAdapter, url: string, init?: RequestInit): Promise<Response> {
  try {
    return await adapter.fetch(url, init);
  } catch (error) {
    throw new ServiceError("Could not reach the upstream service.", {
      url,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

type QueryValue = string | number | boolean | readonly (string | number | boolean)[] | undefined | null;
