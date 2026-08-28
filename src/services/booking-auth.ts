import { randomUUID } from "node:crypto";
import type { Credentials } from "../core/credentials.js";
import { CliError } from "../core/errors.js";
import { USER_AGENT } from "../core/version.js";
import { recordValue, stringValue, type ServiceAdapter } from "./base.js";
import { BOOKING_BASE } from "./booking.js";

const CAS_BASE = "https://cas.sustech.edu.cn/cas";
export const BOOKING_SERVICE_URL = `${BOOKING_BASE}/redirect`;
const GET_USER_PROFILE_PATH = "/api/SystemApi/GetUserProfile";
const DEFAULT_TIMEOUT_MS = 30_000;
const OFF_CAMPUS_BODY = "Access forbidden, please contact administrator.";
type BookingMutationMethod = "AddMeeting" | "CancelMeeting";

export const BOOKING_READ_ONLY_PATHS = new Set<string>([
  GET_USER_PROFILE_PATH,
  "/api/SystemApi/GetMeetingByMeetingRoomList",
  "/api/SystemApi/GetMeetingRoomAllByCondition",
  "/api/SystemApi/GetMyMeetings",
]);

interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
}

export interface BookingAuthConfig {
  baseUrl?: string;
  serviceUrl?: string;
  submitValue?: string | null;
  allowedRedirectHosts?: readonly string[];
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface BookingUserProfile {
  name: string;
  sid: string;
  department?: string;
}

export class BookingSession implements ServiceAdapter {
  public readonly name = "booking";
  private readonly baseUrl: URL;
  private readonly serviceUrl: URL;
  private readonly submitValue: string | null;
  private readonly allowedRedirectHosts: ReadonlySet<string>;
  private readonly fetchImpl: typeof fetch;
  private readonly cookies = new CookieJar();
  private token?: string;
  private profile?: BookingUserProfile;
  private authenticated = false;

  public constructor(
    private readonly credentials: Credentials,
    config: BookingAuthConfig = {},
  ) {
    this.baseUrl = httpsUrl(config.baseUrl ?? BOOKING_BASE, "baseUrl");
    this.serviceUrl = httpsUrl(config.serviceUrl ?? BOOKING_SERVICE_URL, "serviceUrl");
    this.submitValue = config.submitValue ?? "提交";
    const casHost = new URL(CAS_BASE).hostname;
    this.allowedRedirectHosts = new Set([
      casHost,
      this.baseUrl.hostname,
      this.serviceUrl.hostname,
      ...(config.allowedRedirectHosts ?? []),
    ].map((host) => host.toLowerCase()));
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private readonly timeoutMs: number;

  public get userProfile(): BookingUserProfile | undefined {
    return this.profile;
  }

  public adapter(): ServiceAdapter {
    return this;
  }

  public async login(): Promise<void> {
    if (this.authenticated) return;
    const loginUrl = `${CAS_BASE}/login?service=${encodeURIComponent(this.serviceUrl.toString())}`;
    const loginPage = await this.requestRaw(loginUrl);
    if (!loginPage.ok) {
      throw new CliError("CAS login page could not be loaded for booking.", "CAS_UNAVAILABLE", 1, {
        service: this.name,
        status: loginPage.status,
      });
    }
    const page = await loginPage.text();
    const execution = /name=["']execution["']\s+value=["']([^"']+)["']/.exec(page)?.[1];
    if (!execution) {
      throw new CliError("CAS login page did not include an execution token for booking.", "CAS_PROTOCOL_ERROR", 1, {
        service: this.name,
      });
    }

    const form = new URLSearchParams({
      username: this.credentials.sid,
      password: this.credentials.password,
      execution,
      _eventId: "submit",
    });
    if (this.submitValue !== null) form.set("submit", this.submitValue);
    const loginResult = await this.requestRaw(loginUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    }, { followRedirects: false });
    if (![301, 302, 303].includes(loginResult.status)) {
      throw new CliError("CAS rejected the booking credentials.", "AUTHENTICATION_FAILED", 2, {
        service: this.name,
        status: loginResult.status,
      });
    }
    const location = loginResult.headers.get("location");
    if (!location) {
      throw new CliError("CAS did not return a booking service ticket.", "CAS_PROTOCOL_ERROR", 1, {
        service: this.name,
      });
    }
    const ticketUrl = new URL(location, loginUrl);
    if (!isStandardHttps(ticketUrl) || !this.allowedRedirectHosts.has(ticketUrl.hostname.toLowerCase())) {
      throw new CliError("CAS attempted an unsafe booking redirect.", "UNSAFE_REDIRECT", 1, {
        service: this.name,
        to: ticketUrl.hostname,
      });
    }
    if (ticketUrl.origin !== this.serviceUrl.origin || ticketUrl.pathname !== this.serviceUrl.pathname) {
      throw new CliError("CAS returned a ticket for an unexpected booking service URL.", "UNSAFE_REDIRECT", 1, {
        service: this.name,
        to: ticketUrl.hostname,
        path: ticketUrl.pathname,
      });
    }
    const ticket = ticketUrl.searchParams.get("ticket");
    if (!ticket) {
      throw new CliError("CAS booking redirect did not include a service ticket.", "CAS_PROTOCOL_ERROR", 1, {
        service: this.name,
      });
    }

    const landing = await this.requestRaw(ticketUrl.toString());
    if (!landing.ok) {
      throw new CliError("Booking did not accept the CAS ticket.", "AUTHENTICATION_FAILED", 2, {
        service: this.name,
        status: landing.status,
      });
    }

    this.token = await this.exchangeTicket(ticket);
    this.authenticated = true;
  }

  public async fetch(input: string, init: RequestInit = {}): Promise<Response> {
    const url = new URL(input, this.baseUrl);
    if (!isStandardHttps(url) || url.origin !== this.baseUrl.origin) {
      throw new CliError("A booking request attempted to leave the configured origin.", "UNSAFE_SERVICE_URL", 1, {
        service: this.name,
        host: url.hostname,
      });
    }
    enforceReadOnly(url, init.method ?? "GET");
    if (!this.authenticated) await this.login();
    const response = await this.requestRaw(
      url.toString(),
      withAuthorization(init, this.token),
      { followRedirects: false },
    );
    if (isRedirect(response.status)) {
      throw new CliError("Booking read endpoints are not allowed to redirect.", "UNSAFE_REDIRECT", 1, {
        service: this.name,
        path: url.pathname,
        status: response.status,
      });
    }
    return response;
  }

  public async addMeeting(input: {
    roomId: string;
    title: string;
    start: string;
    end: string;
    participants: number;
    description?: string;
  }): Promise<Record<string, unknown>> {
    return this.invokeMutation("AddMeeting", {
      MeetingRoomID: input.roomId,
      MeetingName: input.title,
      MeetingStart: input.start,
      MeetingEnd: input.end,
      NumberOfParticipants: input.participants,
      MeetingDesc: input.description ?? "",
    });
  }

  public async cancelMeeting(meetingId: string): Promise<Record<string, unknown>> {
    return this.invokeMutation("CancelMeeting", {
      MeetingID: meetingId,
    });
  }

  private async exchangeTicket(ticket: string): Promise<string> {
    const response = await this.requestRaw(new URL(GET_USER_PROFILE_PATH, this.baseUrl).toString(), {
      method: "POST",
      headers: {
        accept: "application/json, text/javascript, */*; q=0.01",
        "content-type": "application/json",
        "x-requested-with": "XMLHttpRequest",
      },
      body: JSON.stringify({
        MessageType: 1001,
        MessageID: randomUUID(),
        Data: {
          Url: this.serviceUrl.toString(),
          St: ticket,
        },
      }),
    });
    const text = await response.text();
    if (looksOffCampus(response.status, text)) {
      throw new CliError(
        "Booking blocked the request before login. This usually means the current network is outside the SUSTech campus access path.",
        "NETWORK_RESTRICTED",
        1,
        { service: this.name, status: response.status },
      );
    }
    if (!response.ok) {
      throw new CliError("Booking user-profile handshake failed.", "AUTHENTICATION_FAILED", 2, {
        service: this.name,
        status: response.status,
      });
    }
    let payload: Record<string, unknown>;
    try {
      payload = recordValue(JSON.parse(text));
    } catch (error) {
      throw new CliError("Booking user-profile handshake returned invalid JSON.", "SERVICE_PROTOCOL_ERROR", 1, {
        service: this.name,
        cause: error instanceof Error ? error.message : String(error),
      });
    }
    if (payload.IsSuccess !== true) {
      throw new CliError("Booking user-profile handshake was rejected.", "AUTHENTICATION_FAILED", 2, {
        service: this.name,
        message: stringValue(payload.Message),
        errorCode: payload.ErrorCode,
      });
    }
    const data = recordValue(payload.Data);
    const token = stringValue(data.Token);
    if (!token) {
      throw new CliError("Booking user-profile handshake did not return a token.", "CAS_PROTOCOL_ERROR", 1, {
        service: this.name,
      });
    }
    const info = recordValue(data.UserInfoModel ?? data.UserInfo);
    this.profile = {
      name: stringValue(info.XM ?? info.TrueName ?? data.name ?? data.Name ?? data.XM ?? data.trueName),
      sid: stringValue(
        info.YHM ?? info.UserCode ?? info.LogonName ?? data.sid ?? data.SID ?? data.UserCode ?? data.logonName ?? this.credentials.sid,
        this.credentials.sid,
      ),
      department: optionalString(
        info.DeptName ?? info.DepartmentName ?? data.deptName ?? data.DeptName ?? data.department ?? data.DepartmentName,
      ),
    };
    return token;
  }

  private async invokeMutation(method: BookingMutationMethod, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.authenticated) await this.login();
    const url = new URL(`/api/SystemApi/${method}`, this.baseUrl);
    const response = await this.requestRaw(url.toString(), withAuthorization({
      method: "POST",
      headers: {
        accept: "application/json, text/javascript, */*; q=0.01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        MessageType: 1002,
        MessageID: randomUUID(),
        Data: data,
      }),
    }, this.token), { followRedirects: false });
    if (isRedirect(response.status)) {
      throw new CliError("Booking mutation endpoints are not allowed to redirect.", "UNSAFE_REDIRECT", 1, {
        service: this.name,
        operation: method,
        path: url.pathname,
        status: response.status,
      });
    }
    const text = await response.text();
    if (looksOffCampus(response.status, text)) {
      throw new CliError(
        "Booking blocked the mutation request before it could complete. Verify campus-network access before retrying manually.",
        "NETWORK_RESTRICTED",
        1,
        { service: this.name, operation: method, status: response.status },
      );
    }
    if (!response.ok) {
      throw new CliError("Booking mutation returned an HTTP error.", "SERVICE_HTTP_ERROR", 1, {
        service: this.name,
        operation: method,
        status: response.status,
      });
    }
    let payload: Record<string, unknown>;
    try {
      payload = recordValue(JSON.parse(text));
    } catch (error) {
      throw new CliError("Booking mutation returned invalid JSON.", "SERVICE_PROTOCOL_ERROR", 1, {
        service: this.name,
        operation: method,
        cause: error instanceof Error ? error.message : String(error),
      });
    }
    if (payload.IsSuccess !== true) {
      throw new CliError("Booking mutation was rejected by the upstream service.", "SERVICE_UPSTREAM_ERROR", 1, {
        service: this.name,
        operation: method,
        errorCode: payload.ErrorCode,
        message: stringValue(payload.Message) || "unknown error",
      });
    }
    return recordValue(payload.Data);
  }

  private async requestRaw(
    url: string,
    init: RequestInit = {},
    options: { followRedirects?: boolean } = {},
  ): Promise<Response> {
    let currentUrl = url;
    let method = (init.method ?? "GET").toUpperCase();
    let body = init.body;
    let headers = new Headers(init.headers);
    const signal = init.signal ?? AbortSignal.timeout(this.timeoutMs);
    const followRedirects = options.followRedirects ?? true;

    for (let redirects = 0; redirects < 8; redirects += 1) {
      const parsedUrl = new URL(currentUrl);
      const requestHeaders = new Headers(headers);
      requestHeaders.set("user-agent", USER_AGENT);
      const cookie = this.cookies.header(parsedUrl);
      requestHeaders.delete("cookie");
      if (cookie) requestHeaders.set("cookie", cookie);

      let response: Response;
      try {
        response = await this.fetchImpl(currentUrl, {
          method,
          body,
          headers: requestHeaders,
          redirect: "manual",
          signal,
        });
      } catch (error) {
        const timedOut = signal.aborted;
        throw new CliError(
          timedOut ? "Booking request timed out." : "Could not reach booking.",
          timedOut ? "NETWORK_TIMEOUT" : "NETWORK_ERROR",
          1,
          { service: this.name, cause: error instanceof Error ? error.message : String(error) },
        );
      }
      this.cookies.add(response, currentUrl);

      if (!followRedirects || !isRedirect(response.status)) return response;
      const location = response.headers.get("location");
      if (!location) return response;
      const nextUrl = new URL(location, currentUrl);
      if (!isStandardHttps(nextUrl) || !this.allowedRedirectHosts.has(nextUrl.hostname.toLowerCase())) {
        throw new CliError("Booking/CAS attempted an unsafe redirect.", "UNSAFE_REDIRECT", 1, {
          service: this.name,
          from: parsedUrl.hostname,
          to: nextUrl.hostname,
        });
      }
      const crossOrigin = nextUrl.origin !== parsedUrl.origin;
      if (crossOrigin && (response.status === 307 || response.status === 308) && method !== "GET" && method !== "HEAD") {
        throw new CliError("Booking/CAS refused to forward a request body across origins.", "UNSAFE_REDIRECT", 1, {
          service: this.name,
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
    throw new CliError("Booking/CAS redirected too many times.", "TOO_MANY_REDIRECTS", 1, {
      service: this.name,
    });
  }
}

export function createBookingAuthAdapter(
  credentials: Credentials,
  config: BookingAuthConfig = {},
): ServiceAdapter {
  return new BookingSession(credentials, config).adapter();
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
        const marker = attribute.indexOf("=");
        const attributeName = (marker >= 0 ? attribute.slice(0, marker) : attribute).trim().toLowerCase();
        const attributeValue = marker >= 0 ? attribute.slice(marker + 1).trim() : "";
        if (attributeName === "domain" && attributeValue) domain = attributeValue.replace(/^\./, "").toLowerCase();
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
}

function withAuthorization(init: RequestInit, token?: string): RequestInit {
  if (!token) return init;
  const headers = new Headers(init.headers);
  headers.set("authorization", token);
  if (!headers.has("x-requested-with")) headers.set("x-requested-with", "XMLHttpRequest");
  return { ...init, headers };
}

function enforceReadOnly(url: URL, method: string): void {
  const normalizedMethod = method.toUpperCase();
  if (normalizedMethod === "POST" && BOOKING_READ_ONLY_PATHS.has(url.pathname)) return;
  throw new CliError("Booking write endpoints are blocked in the read-only adapter.", "BOOKING_WRITE_BLOCKED", 3, {
    path: url.pathname,
    method: normalizedMethod,
  });
}

function looksOffCampus(status: number, body: string): boolean {
  return status === 403 && body.includes(OFF_CAMPUS_BODY);
}

function isRedirect(status: number): boolean {
  return [301, 302, 303, 307, 308].includes(status);
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
    throw new CliError(`Booking ${field} must use HTTPS.`, "UNSAFE_SERVICE_URL", 1, {
      field,
      protocol: url.protocol,
    });
  }
  return url;
}

function isStandardHttps(url: URL): boolean {
  return url.protocol === "https:" && !url.username && !url.password && !url.port;
}

function optionalString(value: unknown): string | undefined {
  const normalized = stringValue(value).trim();
  return normalized ? normalized : undefined;
}
