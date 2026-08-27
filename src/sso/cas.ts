import type { Credentials } from "../core/credentials.js";
import { CliError } from "../core/errors.js";
import { USER_AGENT } from "../core/version.js";

const CAS_BASE = "https://cas.sustech.edu.cn/cas";
const DEFAULT_TIMEOUT_MS = 30_000;

interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
}

export interface CasServiceConfig {
  name: string;
  baseUrl: string;
  serviceUrl: string;
  submitValue?: string | null;
  allowedRedirectHosts?: readonly string[];
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
        const delimiter = attribute.indexOf("=");
        const attributeName = (delimiter >= 0 ? attribute.slice(0, delimiter) : attribute).trim().toLowerCase();
        const attributeValue = delimiter >= 0 ? attribute.slice(delimiter + 1).trim() : "";
        if (attributeName === "domain" && attributeValue) {
          domain = attributeValue.replace(/^\./, "").toLowerCase();
        }
        if (attributeName === "path" && attributeValue) path = attributeValue;
      }
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

export class CasSession {
  private readonly cookies = new CookieJar();
  private readonly baseUrl: URL;
  private readonly serviceUrl: URL;
  private readonly allowedRedirectHosts: ReadonlySet<string>;
  private authenticated = false;

  public constructor(
    private readonly credentials: Credentials,
    private readonly config: CasServiceConfig,
  ) {
    this.baseUrl = httpsUrl(config.baseUrl, "baseUrl");
    this.serviceUrl = httpsUrl(config.serviceUrl, "serviceUrl");
    const casHost = new URL(CAS_BASE).hostname;
    this.allowedRedirectHosts = new Set([
      casHost,
      this.baseUrl.hostname,
      this.serviceUrl.hostname,
      ...(config.allowedRedirectHosts ?? []),
    ].map((host) => host.toLowerCase()));
  }

  public async login(): Promise<void> {
    if (this.authenticated) return;
    const loginUrl = `${CAS_BASE}/login?service=${encodeURIComponent(this.serviceUrl.toString())}`;
    const loginPage = await this.requestRaw(loginUrl);
    if (!loginPage.ok) {
      throw new CliError("CAS login page could not be loaded.", "CAS_UNAVAILABLE", 1, {
        service: this.config.name,
        status: loginPage.status,
      });
    }
    const page = await loginPage.text();
    const execution = /name=["']execution["']\s+value=["']([^"']+)["']/.exec(page)?.[1];
    if (!execution) {
      throw new CliError("CAS login page did not include an execution token.", "CAS_PROTOCOL_ERROR", 1, {
        service: this.config.name,
      });
    }
    if (requiresInteractiveCaptcha(page)) {
      throw new CliError(
        "CAS currently requires an interactive CAPTCHA that the CLI will not bypass.",
        "CAS_INTERACTIVE_CHALLENGE_REQUIRED",
        2,
        {
          service: this.config.name,
          remediation: "Sign in through the official SUSTech browser page. Password-only CLI authentication is unavailable while this challenge is enabled.",
          passwordSubmitted: false,
        },
      );
    }

    const form = new URLSearchParams({
      username: this.credentials.sid,
      password: this.credentials.password,
      execution,
      _eventId: "submit",
    });
    if (this.config.submitValue !== null) form.set("submit", this.config.submitValue ?? "提交");

    const result = await this.requestRaw(loginUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    const finalUrl = new URL(result.url);
    if (!result.ok || finalUrl.hostname !== this.baseUrl.hostname) {
      throw new CliError(
        `CAS rejected the credentials or did not complete the ${this.config.name} login.`,
        "AUTHENTICATION_FAILED",
        2,
        { service: this.config.name, status: result.status },
      );
    }
    this.authenticated = true;
  }

  public async get(path: string, headers: Record<string, string> = {}): Promise<Response> {
    return this.requestService(path, { headers });
  }

  public async fetch(input: string, init: RequestInit = {}): Promise<Response> {
    return this.requestService(input, init);
  }

  public async getJson(path: string, query: Record<string, string> = {}): Promise<unknown> {
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    const relative = `${url.pathname}${url.search}`;
    return this.parseJson(await this.get(relative, { accept: "application/json" }), relative);
  }

  public async getText(path: string): Promise<string> {
    const response = await this.get(path);
    return response.text();
  }

  public async postForm(
    path: string,
    data: Record<string, string | number | string[]>,
  ): Promise<unknown> {
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(data)) {
      if (Array.isArray(value)) {
        for (const item of value) form.append(key, item);
      } else {
        form.set(key, String(value));
      }
    }
    const response = await this.requestService(path, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        "x-requested-with": "XMLHttpRequest",
      },
      body: form.toString(),
    });
    return this.parseJson(response, path);
  }

  public async postJson(path: string, data: Record<string, unknown>): Promise<unknown> {
    const response = await this.requestService(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-requested-with": "XMLHttpRequest",
      },
      body: JSON.stringify(data),
    });
    return this.parseJson(response, path);
  }

  public async postText(
    path: string,
    data: Record<string, string | number> = {},
  ): Promise<string> {
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(data)) form.set(key, String(value));
    const response = await this.requestService(path, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        "x-requested-with": "XMLHttpRequest",
      },
      body: form.toString(),
    });
    return response.text();
  }

  protected async requestService(path: string, init: RequestInit = {}): Promise<Response> {
    if (!this.authenticated) await this.login();
    const url = new URL(path, this.baseUrl);
    if (url.origin !== this.baseUrl.origin) {
      throw new CliError("A service request attempted to leave its configured origin.", "UNSAFE_SERVICE_URL", 1, {
        service: this.config.name,
        host: url.hostname,
      });
    }
    const response = await this.requestRaw(url.toString(), init);
    if (!response.ok) {
      throw new CliError(`${this.config.name} request failed.`, "SERVICE_HTTP_ERROR", 1, {
        service: this.config.name,
        path: url.pathname,
        status: response.status,
      });
    }
    return response;
  }

  private async parseJson(response: Response, path: string): Promise<unknown> {
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("json")) {
      throw new CliError(
        `${this.config.name} returned non-JSON content; the session may have expired.`,
        "SERVICE_SESSION_EXPIRED",
        1,
        { service: this.config.name, path },
      );
    }
    try {
      return await response.json();
    } catch (error) {
      throw new CliError(`${this.config.name} returned invalid JSON.`, "SERVICE_PROTOCOL_ERROR", 1, {
        service: this.config.name,
        path,
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async requestRaw(url: string, init: RequestInit = {}): Promise<Response> {
    let currentUrl = url;
    let method = init.method ?? "GET";
    let body = init.body;
    let headers = new Headers(init.headers);
    const signal = init.signal ?? AbortSignal.timeout(this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    for (let redirects = 0; redirects < 8; redirects += 1) {
      const parsedUrl = new URL(currentUrl);
      const cookie = this.cookies.header(parsedUrl);
      headers.delete("cookie");
      if (cookie) headers.set("cookie", cookie);
      headers.set("user-agent", USER_AGENT);

      let response: Response;
      try {
        response = await fetch(currentUrl, { method, headers, body, redirect: "manual", signal });
      } catch (error) {
        const timedOut = signal.aborted;
        throw new CliError(
          timedOut ? `${this.config.name} request timed out.` : `Could not reach ${this.config.name}.`,
          timedOut ? "NETWORK_TIMEOUT" : "NETWORK_ERROR",
          1,
          { service: this.config.name, cause: error instanceof Error ? error.message : String(error) },
        );
      }
      this.cookies.add(response, currentUrl);

      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      const location = response.headers.get("location");
      if (!location) return response;
      const nextUrl = new URL(location, currentUrl);
      if (nextUrl.protocol !== "https:" || !this.allowedRedirectHosts.has(nextUrl.hostname.toLowerCase())) {
        throw new CliError("CAS/service attempted an unsafe redirect.", "UNSAFE_REDIRECT", 1, {
          service: this.config.name,
          from: parsedUrl.hostname,
          to: nextUrl.hostname,
        });
      }
      currentUrl = nextUrl.toString();
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST")) {
        method = "GET";
        body = undefined;
        headers = new Headers();
      }
    }
    throw new CliError("CAS/service redirected too many times.", "TOO_MANY_REDIRECTS", 1, {
      service: this.config.name,
    });
  }
}

function requiresInteractiveCaptcha(page: string): boolean {
  return /name=["']g-recaptcha-response["']/i.test(page)
    && /(?:slideVerify|captchaVerification|su-recaptcha)/i.test(page);
}

function singleSetCookie(headers: Headers): string[] {
  const value = headers.get("set-cookie");
  return value ? [value] : [];
}

function domainMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function httpsUrl(value: string, field: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new CliError(`CAS ${field} must use HTTPS.`, "UNSAFE_SERVICE_URL", 1, { field, protocol: url.protocol });
  }
  return url;
}
