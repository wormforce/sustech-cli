import { CliError } from "../core/errors.js";
import {
  deleteStoredBlackboardCalendarLink,
  loadStoredBlackboardCalendarLink,
  saveStoredBlackboardCalendarLink,
  type CredentialBackend,
  type CredentialStoreOptions,
} from "../core/keyring.js";
import { USER_AGENT } from "../core/version.js";

export const BLACKBOARD_CALENDAR_FEED_HOST = "bb.sustech.edu.cn";
export const BLACKBOARD_CALENDAR_FEED_MAX_BYTES = 2 * 1024 * 1024;

const BLACKBOARD_CALENDAR_FEED_PATH = /^\/webapps\/calendar\/calendarFeed\/([A-Za-z0-9_-]{8,256})\/learn\.ics$/;
const BLACKBOARD_CALENDAR_REDIRECT_PATH = /^\/bbcswebdav\/[^\u0000-\u001f\u007f]{1,1024}\.ics$/i;

export interface BlackboardCalendarLink {
  profile: string;
  url: string;
  maskedUrl: string;
  backend: CredentialBackend;
}

export interface BlackboardCalendarLinkSaveResult {
  profile: string;
  maskedUrl: string;
  backend: CredentialBackend;
  persistent: true;
}

export interface BlackboardCalendarFeed {
  profile?: string;
  maskedUrl: string;
  content: string;
  contentType: string;
  size: number;
  redirects: number;
}

export interface BlackboardCalendarFetchOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
}

export interface StoredBlackboardCalendarFetchOptions extends BlackboardCalendarFetchOptions {
  profile?: string;
  keyring?: CredentialStoreOptions;
}

export function normalizeBlackboardCalendarLink(value: string): string {
  const url = parseBlackboardCalendarLink(value);
  const match = BLACKBOARD_CALENDAR_FEED_PATH.exec(url.pathname);
  if (!match) throw invalidBlackboardCalendarLink(url, "The Blackboard calendar link path is not a supported Learn feed.");
  if (url.username || url.password || url.port || url.search || url.hash) {
    throw invalidBlackboardCalendarLink(url, "The Blackboard calendar link must not include credentials, a custom port, query text, or a fragment.");
  }
  const normalized = new URL(`https://${BLACKBOARD_CALENDAR_FEED_HOST}/webapps/calendar/calendarFeed/${match[1]}/learn.ics`);
  return normalized.toString();
}

export function maskBlackboardCalendarLink(value: string): string {
  const normalized = new URL(normalizeBlackboardCalendarLink(value));
  normalized.pathname = normalized.pathname.replace(BLACKBOARD_CALENDAR_FEED_PATH, "/webapps/calendar/calendarFeed/[REDACTED]/learn.ics");
  return normalized.toString();
}

export async function saveBlackboardCalendarLink(
  input: { profile?: string; url: string },
  options: CredentialStoreOptions = {},
): Promise<BlackboardCalendarLinkSaveResult> {
  const url = normalizeBlackboardCalendarLink(input.url);
  const saved = await saveStoredBlackboardCalendarLink({ profile: input.profile, url }, options);
  return {
    profile: saved.profile,
    maskedUrl: maskBlackboardCalendarLink(url),
    backend: saved.backend,
    persistent: saved.persistent,
  };
}

export async function loadBlackboardCalendarLink(
  requestedProfile?: string,
  options: CredentialStoreOptions = {},
): Promise<BlackboardCalendarLink> {
  const stored = await loadStoredBlackboardCalendarLink(requestedProfile, options);
  const url = normalizeBlackboardCalendarLink(stored.url);
  return {
    profile: stored.profile,
    url,
    maskedUrl: maskBlackboardCalendarLink(url),
    backend: stored.backend,
  };
}

export async function deleteBlackboardCalendarLink(
  requestedProfile?: string,
  options: CredentialStoreOptions = {},
): Promise<{ profile: string; removed: boolean; backend: CredentialBackend | "unavailable" }> {
  return await deleteStoredBlackboardCalendarLink(requestedProfile, options);
}

export async function fetchStoredBlackboardCalendarFeed(
  options: StoredBlackboardCalendarFetchOptions = {},
): Promise<BlackboardCalendarFeed> {
  const stored = await loadBlackboardCalendarLink(options.profile, options.keyring);
  const feed = await fetchBlackboardCalendarFeed(stored.url, options);
  return { ...feed, profile: stored.profile };
}

export async function fetchBlackboardCalendarFeed(
  url: string,
  options: BlackboardCalendarFetchOptions = {},
): Promise<BlackboardCalendarFeed> {
  const normalizedUrl = normalizeBlackboardCalendarLink(url);
  const maskedUrl = maskBlackboardCalendarLink(normalizedUrl);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxBytes = options.maxBytes ?? BLACKBOARD_CALENDAR_FEED_MAX_BYTES;

  let currentUrl = normalizedUrl;
  for (let redirects = 0; redirects <= 4; redirects += 1) {
    const response = await fetchCalendarResponse(fetchImpl, currentUrl, timeoutMs, maskedUrl);
    if (isRedirect(response.status)) {
      const location = response.headers.get("location");
      if (!location) {
        throw new CliError("The Blackboard calendar feed returned a redirect without a destination.", "BLACKBOARD_CALENDAR_REDIRECT_INVALID", 1, {
          url: maskedUrl,
          status: response.status,
        });
      }
      currentUrl = resolveBlackboardCalendarRedirect(currentUrl, location, maskedUrl);
      continue;
    }
    if (!response.ok) {
      throw new CliError("The Blackboard calendar feed returned an HTTP error.", "BLACKBOARD_CALENDAR_HTTP_ERROR", 1, {
        url: maskedUrl,
        status: response.status,
      });
    }
    return await parseBlackboardCalendarFeed(response, { maskedUrl, redirects, maxBytes });
  }
  throw new CliError("The Blackboard calendar feed redirected too many times.", "BLACKBOARD_CALENDAR_REDIRECT_LIMIT", 1, {
    url: maskedUrl,
  });
}

async function fetchCalendarResponse(
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number,
  maskedUrl: string,
): Promise<Response> {
  try {
    return await fetchImpl(url, {
      method: "GET",
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/calendar,text/plain;q=0.9,*/*;q=0.1",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new CliError("Could not reach the Blackboard calendar feed.", "BLACKBOARD_CALENDAR_NETWORK_ERROR", 1, {
      url: maskedUrl,
      reason: error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network",
    });
  }
}

async function parseBlackboardCalendarFeed(
  response: Response,
  options: { maskedUrl: string; redirects: number; maxBytes: number },
): Promise<BlackboardCalendarFeed> {
  const contentLength = parseContentLength(response.headers.get("content-length"));
  if (contentLength !== undefined && contentLength > options.maxBytes) {
    throw new CliError("The Blackboard calendar feed is too large to trust automatically.", "BLACKBOARD_CALENDAR_FEED_TOO_LARGE", 1, {
      url: options.maskedUrl,
      size: contentLength,
      maxBytes: options.maxBytes,
    });
  }

  const bytes = await readBoundedCalendarBody(response, options);

  const contentType = (response.headers.get("content-type") ?? "text/calendar").split(";", 1)[0]!.trim().toLowerCase();
  if (contentType === "text/html" || contentType === "application/xhtml+xml") {
    throw new CliError("The Blackboard calendar feed returned HTML instead of ICS data.", "BLACKBOARD_CALENDAR_FEED_NOT_ICS", 1, {
      url: options.maskedUrl,
      contentType,
    });
  }

  const content = stripUtf8Bom(new TextDecoder("utf-8").decode(bytes));
  if (!/^\s*BEGIN:VCALENDAR(?:\r?\n|$)/.test(content)) {
    throw new CliError("The Blackboard calendar feed did not begin with VCALENDAR data.", "BLACKBOARD_CALENDAR_FEED_NOT_ICS", 1, {
      url: options.maskedUrl,
      contentType,
    });
  }

  return {
    maskedUrl: options.maskedUrl,
    content,
    contentType,
    size: bytes.byteLength,
    redirects: options.redirects,
  };
}

async function readBoundedCalendarBody(
  response: Response,
  options: { maskedUrl: string; maxBytes: number },
): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > options.maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new CliError("The Blackboard calendar feed is too large to trust automatically.", "BLACKBOARD_CALENDAR_FEED_TOO_LARGE", 1, {
          url: options.maskedUrl,
          size,
          maxBytes: options.maxBytes,
        });
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function parseBlackboardCalendarLink(value: string): URL {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new CliError("The Blackboard calendar link must be a valid URL.", "INVALID_BLACKBOARD_CALENDAR_LINK", 2);
  }
  const protocol = url.protocol.toLowerCase();
  if (protocol !== "https:" && protocol !== "webcal:") {
    throw invalidBlackboardCalendarLink(url, "The Blackboard calendar link must use https or webcal.");
  }
  if (url.hostname.toLowerCase() !== BLACKBOARD_CALENDAR_FEED_HOST) {
    throw invalidBlackboardCalendarLink(url, "The Blackboard calendar link must stay on bb.sustech.edu.cn.");
  }
  return url;
}

function invalidBlackboardCalendarLink(url: URL, message: string): CliError {
  return new CliError(message, "INVALID_BLACKBOARD_CALENDAR_LINK", 2, {
    host: url.hostname.toLowerCase(),
    path: redactCalendarPath(url.pathname),
    protocol: url.protocol.replace(/:$/, ""),
  });
}

function redactCalendarPath(pathname: string): string {
  const partiallyRedacted = pathname.replace(
    /^(\/webapps\/calendar\/calendarFeed\/)[^/]+/,
    "$1[REDACTED]",
  );
  return partiallyRedacted.replace(
    BLACKBOARD_CALENDAR_FEED_PATH,
    "/webapps/calendar/calendarFeed/[REDACTED]/learn.ics",
  );
}

function resolveBlackboardCalendarRedirect(currentUrl: string, location: string, maskedUrl: string): string {
  let nextUrl: URL;
  try {
    nextUrl = new URL(location, currentUrl);
  } catch {
    throw new CliError("The Blackboard calendar feed returned an invalid redirect target.", "BLACKBOARD_CALENDAR_REDIRECT_INVALID", 1, {
      url: maskedUrl,
    });
  }
  if (
    nextUrl.protocol !== "https:"
    || nextUrl.hostname.toLowerCase() !== BLACKBOARD_CALENDAR_FEED_HOST
    || Boolean(nextUrl.username || nextUrl.password || nextUrl.port)
    || !isAllowedBlackboardCalendarRedirectPath(nextUrl.pathname)
  ) {
    throw new CliError("The Blackboard calendar feed attempted an unsafe redirect.", "BLACKBOARD_CALENDAR_REDIRECT_UNSAFE", 1, {
      url: maskedUrl,
      locationHost: nextUrl.hostname.toLowerCase(),
      locationProtocol: nextUrl.protocol.replace(/:$/, ""),
    });
  }
  return nextUrl.toString();
}

function isAllowedBlackboardCalendarRedirectPath(pathname: string): boolean {
  return BLACKBOARD_CALENDAR_FEED_PATH.test(pathname) || BLACKBOARD_CALENDAR_REDIRECT_PATH.test(pathname);
}

function parseContentLength(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function stripUtf8Bom(value: string): string {
  return value.startsWith("\uFEFF") ? value.slice(1) : value;
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}
