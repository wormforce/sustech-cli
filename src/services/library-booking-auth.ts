import type { Credentials } from "../core/credentials.js";
import { CliError } from "../core/errors.js";
import { USER_AGENT } from "../core/version.js";
import type { ServiceAdapter } from "./base.js";
import { LIBRARY_BOOKING_BASE } from "./library.js";
import { requestUrl } from "./base.js";

const BOOKING_HOST = new URL(LIBRARY_BOOKING_BASE).hostname;
const BOOKING_FINAL_URL = `${LIBRARY_BOOKING_BASE}/ic/home`;
const BOOKING_ERROR_URL = `${LIBRARY_BOOKING_BASE}/#/error`;
const CAS_LOGIN_PATH = "/cas/login";
const CAS_LOGIN_HOST = "cas.sustech.edu.cn";
const DEFAULT_TIMEOUT_MS = 30_000;
const OFF_CAMPUS_BODY = "Access forbidden, please contact administrator.";
const AUTHCENTER_HOSTS = new Set([
  "auth.sustech.edu.cn",
  "authserver.sustech.edu.cn",
]);
const ALLOWED_READ_METHODS = new Set(["GET", "HEAD"]);
const ALLOWED_READ_PATHS = new Set([
  "/ic-web/auth/userInfo",
  "/ic-web/home/page/room/idle",
  "/ic-web/lab/devKindLabs",
  "/ic-web/roomDevice/roomInfos",
  "/ic-web/reserve/count",
  "/ic-web/reserve/resvInfo",
]);
const REDIRECT_HOSTS = new Set([
  BOOKING_HOST,
  CAS_LOGIN_HOST,
  ...AUTHCENTER_HOSTS,
]);

interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
}

export interface LibraryBookingSessionOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

class CookieJar {
  private readonly cookies = new Map<string, Cookie>();

  public add(response: Response, responseUrl: string): void {
    const headers = response.headers as Headers & { getSetCookie?: () => string[] };
    const values = headers.getSetCookie?.() ?? singleSetCookie(headers);
    const defaultDomain = new URL(responseUrl).hostname;

    for (const raw of values) {
      const [first, ...attributes] = raw.split(";");
      const delimiter = first.indexOf("=");
      if (delimiter <= 0) continue;
      const name = first.slice(0, delimiter).trim();
      const value = first.slice(delimiter + 1).trim();
      let domain = defaultDomain;
      let path = "/";
      for (const attribute of attributes) {
        const equalsIndex = attribute.indexOf("=");
        const attributeName = (equalsIndex >= 0 ? attribute.slice(0, equalsIndex) : attribute).trim().toLowerCase();
        const attributeValue = equalsIndex >= 0 ? attribute.slice(equalsIndex + 1).trim() : "";
        if (attributeName === "domain" && attributeValue) {
          domain = attributeValue.replace(/^\./, "").toLowerCase();
        }
        if (attributeName === "path" && attributeValue) path = attributeValue;
      }
      if (!validCookieDomain(defaultDomain, domain)) continue;
      this.cookies.set(`${name}|${domain}|${path}`, { name, value, domain, path });
    }
  }

  public header(url: URL): string | undefined {
    const values = [...this.cookies.values()]
      .filter((cookie) => domainMatches(url.hostname, cookie.domain) && url.pathname.startsWith(cookie.path))
      .map((cookie) => `${cookie.name}=${cookie.value}`);
    return values.length > 0 ? values.join("; ") : undefined;
  }

  public has(name: string, host = BOOKING_HOST): boolean {
    return [...this.cookies.values()].some((cookie) => cookie.name === name && domainMatches(host, cookie.domain));
  }
}

export class LibraryBookingSession implements ServiceAdapter {
  public readonly name = "library-booking";

  private readonly cookies = new CookieJar();
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private loginPromise?: Promise<void>;

  public constructor(
    private readonly credentials: Credentials,
    options: LibraryBookingSessionOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  public adapter(): ServiceAdapter {
    return this;
  }

  public async login(): Promise<void> {
    if (this.cookies.has("ic-cookie")) return;
    if (!this.loginPromise) {
      this.loginPromise = this.loginOnce().finally(() => {
        this.loginPromise = undefined;
      });
    }
    await this.loginPromise;
  }

  public async fetch(input: string, init: RequestInit = {}): Promise<Response> {
    const url = new URL(input, LIBRARY_BOOKING_BASE);
    if (!isStandardHttps(url) || url.origin !== LIBRARY_BOOKING_BASE) {
      throw new CliError("Library booking requests must stay on the booking origin.", "UNSAFE_SERVICE_URL", 1, {
        host: url.hostname,
      });
    }
    const method = (init.method ?? "GET").toUpperCase();
    if (!ALLOWED_READ_METHODS.has(method)) {
      throw new CliError("Library booking adapter only exposes read-only GET/HEAD requests.", "UNSAFE_SERVICE_REQUEST", 1, {
        method,
      });
    }
    if (!ALLOWED_READ_PATHS.has(url.pathname)) {
      throw new CliError("Library booking adapter rejected an unknown endpoint.", "UNSAFE_SERVICE_REQUEST", 1, {
        path: url.pathname,
      });
    }
    await this.login();
    const response = await this.requestRaw(url.toString(), { ...init, redirect: "manual" });
    if (isRedirect(response.status)) {
      throw new CliError("Library booking read endpoints are not allowed to redirect.", "UNSAFE_REDIRECT", 1, {
        service: "library-booking",
        path: url.pathname,
        status: response.status,
      });
    }
    return response;
  }

  private async loginOnce(): Promise<void> {
    const casLoginUrl = await this.resolveCasLoginUrl();
    const loginPage = await this.requestRaw(casLoginUrl.toString());
    if (!loginPage.ok) {
      throw new CliError("CAS login page could not be loaded for library booking.", "CAS_UNAVAILABLE", 1, {
        service: "library-booking",
        status: loginPage.status,
      });
    }
    const execution = extractExecution(await loginPage.text());
    if (!execution) {
      throw new CliError("CAS login page did not include an execution token.", "CAS_PROTOCOL_ERROR", 1, {
        service: "library-booking",
      });
    }

    const form = new URLSearchParams({
      username: this.credentials.sid,
      password: this.credentials.password,
      execution,
      _eventId: "submit",
      submit: "",
    });

    await this.requestRaw(casLoginUrl.toString(), {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });

    if (!this.cookies.has("ic-cookie")) {
      throw new CliError("Library booking login completed without an ic-cookie session.", "AUTHENTICATION_FAILED", 2, {
        service: "library-booking",
      });
    }
  }

  private async resolveCasLoginUrl(): Promise<URL> {
    const addressUrl = requestUrl(LIBRARY_BOOKING_BASE, "/ic-web/auth/address", {
      finalAddress: BOOKING_FINAL_URL,
      errPageUrl: BOOKING_ERROR_URL,
      manager: "false",
      consoleType: "16",
    });
    const addressResponse = await this.requestRaw(addressUrl, {
      headers: { accept: "application/json" },
    });
    const addressBody = await addressResponse.text();
    if (looksOffCampus(addressResponse, addressBody)) {
      throw new CliError(
        "Library booking auth is blocked off campus. Connect to the SUSTech campus network first.",
        "CAMPUS_NETWORK_REQUIRED",
        2,
        { service: "library-booking" },
      );
    }
    if (!addressResponse.ok) {
      throw new CliError("Library booking auth/address failed.", "SERVICE_HTTP_ERROR", 1, {
        service: "library-booking",
        status: addressResponse.status,
      });
    }

    const payload = parseAddressPayload(addressBody);
    if (payload.code !== 0) {
      throw new CliError("Library booking auth/address rejected the login bootstrap.", "SERVICE_PROTOCOL_ERROR", 1, {
        service: "library-booking",
        status: payload.code,
        message: payload.message,
      });
    }
    const authUrl = validateAuthcenterUrl(payload.data);
    const authcenterResponse = await this.requestRaw(authUrl.toString(), {
      redirect: "manual",
    });
    if (!isRedirect(authcenterResponse.status)) {
      throw new CliError("Library booking authcenter did not redirect to CAS.", "SERVICE_PROTOCOL_ERROR", 1, {
        service: "library-booking",
        status: authcenterResponse.status,
      });
    }
    const location = authcenterResponse.headers.get("location");
    if (!location) {
      throw new CliError("Library booking authcenter redirect omitted a target URL.", "SERVICE_PROTOCOL_ERROR", 1, {
        service: "library-booking",
      });
    }
    return validateCasLoginUrl(new URL(location, authUrl).toString());
  }

  private async requestRaw(url: string, init: RequestInit = {}): Promise<Response> {
    let currentUrl = url;
    let method = init.method ?? "GET";
    let body = init.body;
    let headers = new Headers(init.headers);
    const signal = init.signal ?? AbortSignal.timeout(this.timeoutMs);
    const followRedirects = init.redirect !== "manual";

    for (let redirects = 0; redirects < 8; redirects += 1) {
      const parsedUrl = new URL(currentUrl);
      const cookie = this.cookies.header(parsedUrl);
      headers.delete("cookie");
      if (cookie) headers.set("cookie", cookie);
      headers.set("user-agent", USER_AGENT);

      let response: Response;
      try {
        response = await this.fetchImpl(currentUrl, {
          method,
          headers,
          body,
          redirect: "manual",
          signal,
        });
      } catch (error) {
        if (error instanceof CliError) throw error;
        const timedOut = signal.aborted;
        throw new CliError(
          timedOut ? "Library booking request timed out." : "Could not reach the library booking service.",
          timedOut ? "NETWORK_TIMEOUT" : "NETWORK_ERROR",
          1,
          {
            service: "library-booking",
            cause: error instanceof Error ? error.message : String(error),
          },
        );
      }
      this.cookies.add(response, currentUrl);

      if (!followRedirects) return response;
      if (!isRedirect(response.status)) return response;
      const location = response.headers.get("location");
      if (!location) return response;
      const nextUrl = new URL(location, currentUrl);
      if (!isStandardHttps(nextUrl) || !REDIRECT_HOSTS.has(nextUrl.hostname.toLowerCase())) {
        throw new CliError("Library booking auth attempted an unsafe redirect.", "UNSAFE_REDIRECT", 1, {
          service: "library-booking",
          from: parsedUrl.hostname,
          to: nextUrl.hostname,
        });
      }
      const crossOrigin = nextUrl.origin !== parsedUrl.origin;
      if (crossOrigin && (response.status === 307 || response.status === 308) && method !== "GET" && method !== "HEAD") {
        throw new CliError("Library booking refused to forward a request body across origins.", "UNSAFE_REDIRECT", 1, {
          service: "library-booking",
          from: parsedUrl.hostname,
          to: nextUrl.hostname,
        });
      }
      if (crossOrigin) headers.delete("authorization");
      currentUrl = nextUrl.toString();
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST")) {
        method = "GET";
        body = undefined;
        headers = new Headers();
      }
    }

    throw new CliError("Library booking auth redirected too many times.", "TOO_MANY_REDIRECTS", 1, {
      service: "library-booking",
    });
  }
}

export function createLibraryBookingSession(
  credentials: Credentials,
  options: LibraryBookingSessionOptions = {},
): LibraryBookingSession {
  return new LibraryBookingSession(credentials, options);
}

function parseAddressPayload(body: string): { code: number; message: string; data: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (error) {
    throw new CliError("Library booking auth/address returned invalid JSON.", "SERVICE_PROTOCOL_ERROR", 1, {
      service: "library-booking",
      cause: error instanceof Error ? error.message : String(error),
    });
  }

  const record = isRecord(parsed) ? parsed : {};
  return {
    code: typeof record.code === "number" ? record.code : Number(record.code ?? Number.NaN),
    message: typeof record.message === "string" ? record.message : "",
    data: typeof record.data === "string" ? record.data : "",
  };
}

function validateAuthcenterUrl(value: string): URL {
  const url = httpsUrl(value, "authcenterUrl");
  if (!AUTHCENTER_HOSTS.has(url.hostname.toLowerCase()) || url.pathname !== "/authcenter/toLoginPage") {
    throw new CliError("Library booking auth/address returned an unexpected authcenter URL.", "UNSAFE_REDIRECT", 1, {
      service: "library-booking",
      host: url.hostname,
      path: url.pathname,
    });
  }
  return url;
}

function validateCasLoginUrl(value: string): URL {
  const url = httpsUrl(value, "casLoginUrl");
  if (url.hostname !== CAS_LOGIN_HOST || url.pathname !== CAS_LOGIN_PATH) {
    throw new CliError("Library booking authcenter did not redirect to the expected CAS login endpoint.", "UNSAFE_REDIRECT", 1, {
      service: "library-booking",
      host: url.hostname,
      path: url.pathname,
    });
  }
  const service = url.searchParams.get("service");
  if (!service) {
    throw new CliError("Library booking CAS login URL omitted its service parameter.", "SERVICE_PROTOCOL_ERROR", 1, {
      service: "library-booking",
    });
  }
  const serviceUrl = httpsUrl(service, "casServiceUrl");
  if (serviceUrl.hostname !== BOOKING_HOST || serviceUrl.pathname !== "/ic-web/auth/server") {
    throw new CliError("Library booking CAS login URL targeted an unexpected service host.", "UNSAFE_REDIRECT", 1, {
      service: "library-booking",
      host: serviceUrl.hostname,
      path: serviceUrl.pathname,
    });
  }
  return url;
}

function extractExecution(page: string): string {
  return /name=["']execution["']\s+value=["']([^"']+)["']/.exec(page)?.[1] ?? "";
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function looksOffCampus(response: Response, body: string): boolean {
  return response.status === 403 && body.includes(OFF_CAMPUS_BODY);
}

function singleSetCookie(headers: Headers): string[] {
  const value = headers.get("set-cookie");
  return value ? [value] : [];
}

function domainMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function validCookieDomain(responseHost: string, domain: string): boolean {
  return responseHost === domain
    || (domainMatches(responseHost, domain)
      && (domain === "sustech.edu.cn" || domain.endsWith(".sustech.edu.cn")));
}

function httpsUrl(value: string, field: string): URL {
  const url = new URL(value);
  if (!isStandardHttps(url)) {
    throw new CliError(`Library booking ${field} must use HTTPS.`, "UNSAFE_SERVICE_URL", 1, {
      field,
      protocol: url.protocol,
    });
  }
  return url;
}

function isStandardHttps(url: URL): boolean {
  return url.protocol === "https:" && !url.username && !url.password && !url.port;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
