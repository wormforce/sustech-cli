import { CliError } from "../core/errors.js";
import type { Credentials } from "../core/credentials.js";

const CAS_BASE = "https://cas.sustech.edu.cn/cas";
const TIS_BASE = "https://tis.sustech.edu.cn";
const USER_AGENT = "sustech-cli/0.1 (+https://github.com/aprylewu/sustech-cli)";

interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
}

class CookieJar {
  private readonly cookies = new Map<string, Cookie>();

  public add(response: Response, responseUrl: string): void {
    const headers = response.headers as Headers & { getSetCookie?: () => string[] };
    const setCookies = headers.getSetCookie?.() ?? [];
    const defaultDomain = new URL(responseUrl).hostname;

    for (const raw of setCookies) {
      const [first, ...attributes] = raw.split(";");
      const delimiter = first.indexOf("=");
      if (delimiter <= 0) continue;
      const name = first.slice(0, delimiter).trim();
      const value = first.slice(delimiter + 1).trim();
      let domain = defaultDomain;
      let path = "/";
      for (const attribute of attributes) {
        const [attributeName, attributeValue] = attribute.trim().split("=", 2);
        if (attributeName.toLowerCase() === "domain" && attributeValue) {
          domain = attributeValue.replace(/^\./, "").toLowerCase();
        }
        if (attributeName.toLowerCase() === "path" && attributeValue) path = attributeValue;
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

function domainMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

export class TisSession {
  private readonly cookies = new CookieJar();
  private authenticated = false;

  public constructor(private readonly credentials: Credentials) {}

  public async login(): Promise<void> {
    const service = `${TIS_BASE}/cas`;
    const loginUrl = `${CAS_BASE}/login?service=${encodeURIComponent(service)}`;
    const loginPage = await this.request(loginUrl);
    if (!loginPage.ok) {
      throw new CliError("CAS login page could not be loaded.", "CAS_UNAVAILABLE", 1, { status: loginPage.status });
    }
    const page = await loginPage.text();
    const execution = /name="execution"\s+value="([^"]+)"/.exec(page)?.[1];
    if (!execution) {
      throw new CliError("CAS login page did not include an execution token.", "CAS_PROTOCOL_ERROR", 1);
    }

    const form = new URLSearchParams({
      username: this.credentials.sid,
      password: this.credentials.password,
      execution,
      _eventId: "submit",
    });
    const result = await this.request(loginUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });

    const finalUrl = result.url.toLowerCase();
    if (finalUrl.includes("cas.sustech.edu.cn") || !result.ok) {
      throw new CliError(
        "CAS rejected the credentials or did not complete the TIS login.",
        "AUTHENTICATION_FAILED",
        2,
        { status: result.status },
      );
    }
    this.authenticated = true;
  }

  public async postForm(path: string, data: Record<string, string | number | string[]>): Promise<unknown> {
    if (!this.authenticated) await this.login();
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(data)) {
      if (Array.isArray(value)) {
        for (const item of value) form.append(key, item);
      } else {
        form.set(key, String(value));
      }
    }
    const response = await this.request(`${TIS_BASE}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        "x-requested-with": "XMLHttpRequest",
      },
      body: form.toString(),
    });
    if (!response.ok) {
      throw new CliError("TIS request failed.", "TIS_HTTP_ERROR", 1, { path, status: response.status });
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("json")) {
      throw new CliError("TIS returned HTML instead of JSON; the session may have expired.", "TIS_SESSION_EXPIRED", 1, { path });
    }
    return response.json();
  }

  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    let currentUrl = url;
    let method = init.method ?? "GET";
    let body = init.body;
    let headers = new Headers(init.headers);

    for (let redirects = 0; redirects < 8; redirects += 1) {
      const cookie = this.cookies.header(new URL(currentUrl));
      headers.delete("cookie");
      if (cookie) headers.set("cookie", cookie);
      headers.set("user-agent", USER_AGENT);

      let response: Response;
      try {
        response = await fetch(currentUrl, { method, headers, body, redirect: "manual" });
      } catch (error) {
        throw new CliError(
          "Could not reach SUSTech CAS/TIS.",
          "NETWORK_ERROR",
          1,
          { cause: error instanceof Error ? error.message : String(error) },
        );
      }
      this.cookies.add(response, currentUrl);

      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      const location = response.headers.get("location");
      if (!location) return response;
      currentUrl = new URL(location, currentUrl).toString();
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST")) {
        method = "GET";
        body = undefined;
        headers = new Headers();
      }
    }
    throw new CliError("CAS/TIS redirected too many times.", "TOO_MANY_REDIRECTS", 1);
  }
}
