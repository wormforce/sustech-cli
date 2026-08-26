import { constants, createPublicKey, publicEncrypt } from "node:crypto";
import { CliError } from "../core/errors.js";
import { USER_AGENT } from "../core/version.js";
import { numberValue, recordValue, stringValue } from "./base.js";
import { PMS_API, PMS_BASE, pmsUpstreamError } from "./pms.js";
import type { ServiceAdapter } from "./base.js";
import type { PmsPrintUploadOptions } from "./pms.js";

const PMS_HOST = new URL(PMS_BASE).hostname;
const PMS_SERVICE = new URL("/client/new/cprintPc/", PMS_BASE).toString();
const DEFAULT_TIMEOUT_MS = 30_000;
const OFF_CAMPUS_BODY = "Access forbidden, please contact administrator.";
const PMS_READONLY_PATHS = new Map<string, ReadonlySet<string>>([
  ["/api/client/Station/GetSrvList", new Set(["GET", "HEAD"])],
  ["/api/client/Station/GetList", new Set(["GET", "HEAD"])],
  ["/api/client/PrintJob/Get", new Set(["GET", "HEAD"])],
  ["/api/client/Scan/Get", new Set(["GET", "HEAD"])],
  ["/api/client/Report/DetailPage", new Set(["POST"])],
]);
const PMS_MUTATION_PATHS = new Map<string, ReadonlySet<string>>([
  ["/api/client/CloudPrint/Upload", new Set(["POST"])],
  ["/api/client/PrintJob/Del", new Set(["POST"])],
]);

interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
}

export interface PmsCredentials {
  username: string;
  password: string;
}

export interface PmsSessionOptions {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
}

export interface PmsLoginResult {
  authenticated: true;
  displayName: string;
  message: string;
}

export interface PmsCheckResult {
  authenticated: boolean;
  displayName?: string;
  message: string;
}

export interface PmsMutationResult {
  code: number;
  message: string;
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
        const separator = attribute.indexOf("=");
        const attributeName = (separator >= 0 ? attribute.slice(0, separator) : attribute).trim().toLowerCase();
        const attributeValue = separator >= 0 ? attribute.slice(separator + 1).trim() : "";
        if (attributeName === "domain" && attributeValue) domain = attributeValue.replace(/^\./, "").toLowerCase();
        if (attributeName === "path" && attributeValue) path = attributeValue;
      }
      if (!validCookieDomain(defaultDomain, domain)) continue;
      this.cookies.set(`${name}|${domain}|${path}`, { name, value, domain, path });
    }
  }

  public has(name: string, url: URL): boolean {
    return this.match(url).some((cookie) => cookie.name === name && cookie.value.length > 0);
  }

  public header(url: URL): string | undefined {
    const values = this.match(url).map((cookie) => `${cookie.name}=${cookie.value}`);
    return values.length > 0 ? values.join("; ") : undefined;
  }

  private match(url: URL): Cookie[] {
    return [...this.cookies.values()].filter(
      (cookie) => domainMatches(url.hostname, cookie.domain) && url.pathname.startsWith(cookie.path),
    );
  }
}

export class PmsSession implements ServiceAdapter {
  public readonly name = "pms-session";
  private readonly cookies = new CookieJar();
  private readonly baseUrl: URL;
  private readonly fetchImpl: typeof fetch;
  private authenticated = false;

  public constructor(
    private readonly credentials: PmsCredentials,
    private readonly options: PmsSessionOptions = {},
  ) {
    this.baseUrl = pmsUrl(options.baseUrl ?? PMS_BASE, "baseUrl");
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (!credentials.username || !credentials.password) {
      throw new CliError("PMS credentials require both username and password.", "AUTHENTICATION_FAILED", 2, {
        service: "pms",
      });
    }
  }

  public async login(): Promise<PmsLoginResult> {
    const authToken = await this.getAuthToken();
    const keyInfo = await this.getPublicKey();
    const encryptedPassword = encryptPmsPassword(keyInfo.publicKey, this.credentials.password, keyInfo.nonce);
    const response = await this.requestJson(apiUrl("/client/Auth/Login"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        szLogonName: this.credentials.username,
        szPassword: encryptedPassword,
        szToken: authToken,
      }),
    });
    const record = recordValue(response);
    const code = numberValue(record.code, -1);
    if (code !== 0) {
      throw pmsAuthFailure("Login", record);
    }
    if (!this.cookies.has("OSESSIONID", this.baseUrl)) {
      throw new CliError("PMS login succeeded but no session cookie was issued.", "AUTHENTICATION_FAILED", 2, {
        service: "pms",
        step: "Login",
      });
    }
    this.authenticated = true;
    const displayName = stringValue(recordValue(record.result).szTrueName, this.credentials.username);
    return {
      authenticated: true,
      displayName,
      message: `Logged in as ${displayName}`,
    };
  }

  public async check(): Promise<PmsCheckResult> {
    if (!this.cookies.has("OSESSIONID", this.baseUrl)) {
      return {
        authenticated: false,
        message: "PMS session not available",
      };
    }
    const response = await this.requestJson(apiUrl("/client/Auth/Check"), {
      method: "POST",
    });
    const record = recordValue(response);
    if (numberValue(record.code, -1) === 0) {
      this.authenticated = true;
      const displayName = stringValue(recordValue(record.result).szTrueName);
      return {
        authenticated: true,
        displayName: displayName || undefined,
        message: displayName ? `Logged in as ${displayName}` : "PMS session is authenticated",
      };
    }
    this.authenticated = false;
    return {
      authenticated: false,
      message: stringValue(record.message, "Not authenticated"),
    };
  }

  public async fetch(input: string, init: RequestInit = {}): Promise<Response> {
    const url = resolveServiceUrl(input, this.baseUrl, init.method);
    if (!this.authenticated) await this.login();
    const response = await this.requestRaw(url.toString(), { ...init, redirect: "manual" });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      throw new CliError("PMS read endpoints are not allowed to redirect.", "UNSAFE_REDIRECT", 1, {
        service: "pms",
        path: url.pathname,
        status: response.status,
      });
    }
    return response;
  }

  public async uploadPrintJob(
    file: { name: string; bytes: Uint8Array },
    options: PmsPrintUploadOptions,
  ): Promise<PmsMutationResult> {
    const url = resolveMutationUrl("/client/CloudPrint/Upload", "POST");
    if (!this.authenticated) await this.login();
    const form = new FormData();
    form.set("dwColor", String(options.colorCode));
    form.set("dwPaperId", String(options.paperCode));
    form.set("dwDuplex", String(options.duplexCode));
    form.set("dwFrom", String(options.pageFrom));
    form.set("dwTo", String(options.pageTo));
    form.set("dwCopies", String(options.copies));
    form.set("BackURL", "result.html");
    form.set("szPath", new Blob([file.bytes]), file.name);
    const response = await this.requestRaw(url, { method: "POST", body: form });
    if (response.status === 413) {
      throw new CliError("PMS rejected the upload as too large.", "PMS_UPLOAD_TOO_LARGE", 1, {
        service: "pms",
        path: new URL(url).pathname,
        status: response.status,
      });
    }
    const record = recordValue(await this.parseJsonResponse(response, url));
    if (numberValue(record.code, -1) !== 0) throw pmsUpstreamError(record);
    return {
      code: numberValue(record.code, 0),
      message: stringValue(record.message),
    };
  }

  public async deletePrintJob(jobId: number): Promise<PmsMutationResult> {
    const url = resolveMutationUrl("/client/PrintJob/Del", "POST");
    if (!this.authenticated) await this.login();
    const record = recordValue(await this.requestJson(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        dwJobId: jobId,
        dwOldJobId: jobId,
      }),
    }));
    if (numberValue(record.code, -1) !== 0) throw pmsUpstreamError(record);
    return {
      code: numberValue(record.code, 0),
      message: stringValue(record.message),
    };
  }

  private async getAuthToken(): Promise<string> {
    const response = await this.requestJson(apiUrl("/client/Auth/GetAuthToken"), { method: "POST" });
    const record = recordValue(response);
    if (numberValue(record.code, -1) !== 0) {
      throw pmsAuthFailure("GetAuthToken", record);
    }
    const token = stringValue(record.szToken);
    if (!token) {
      throw new CliError("PMS GetAuthToken did not return a token.", "SERVICE_PROTOCOL_ERROR", 1, {
        service: "pms",
        step: "GetAuthToken",
      });
    }
    return token;
  }

  private async getPublicKey(): Promise<{ publicKey: string; nonce: string }> {
    const response = await this.requestJson(apiUrl("/client/Auth/PublicKey"));
    const record = recordValue(response);
    if (numberValue(record.code, -1) !== 0) {
      throw pmsAuthFailure("PublicKey", record);
    }
    const result = recordValue(record.result);
    const publicKey = stringValue(result.publicKey);
    const nonce = stringValue(result.nonceStr);
    if (!publicKey || !nonce) {
      throw new CliError("PMS PublicKey did not return a usable key pair.", "SERVICE_PROTOCOL_ERROR", 1, {
        service: "pms",
        step: "PublicKey",
      });
    }
    return { publicKey, nonce };
  }

  private async requestJson(url: string, init: RequestInit = {}): Promise<unknown> {
    const response = await this.requestRaw(url, init);
    return this.parseJsonResponse(response, url);
  }

  private async parseJsonResponse(response: Response, url: string): Promise<unknown> {
    const text = await response.text();
    if (response.status === 403 && text.includes(OFF_CAMPUS_BODY)) {
      throw new CliError(
        "PMS is blocked off campus. Connect to the SUSTech campus network or an approved campus access path.",
        "CAMPUS_NETWORK_REQUIRED",
        2,
        { service: "pms", status: response.status },
      );
    }
    if (!response.ok) {
      throw new CliError("PMS returned an HTTP error.", "SERVICE_HTTP_ERROR", 1, {
        service: "pms",
        status: response.status,
        path: new URL(url).pathname,
      });
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("json")) {
      throw new CliError("PMS returned non-JSON content.", "SERVICE_PROTOCOL_ERROR", 1, {
        service: "pms",
        path: new URL(url).pathname,
      });
    }
    try {
      return JSON.parse(text) as unknown;
    } catch (error) {
      throw new CliError("PMS returned invalid JSON.", "SERVICE_PROTOCOL_ERROR", 1, {
        service: "pms",
        path: new URL(url).pathname,
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async requestRaw(url: string, init: RequestInit = {}): Promise<Response> {
    let currentUrl = pmsUrl(url, "url").toString();
    let method = init.method ?? "GET";
    let body = init.body;
    let headers = new Headers(init.headers);
    const signal = init.signal ?? AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const followRedirects = init.redirect !== "manual";

    for (let redirects = 0; redirects < 8; redirects += 1) {
      const parsed = pmsUrl(currentUrl, "url");
      const cookie = this.cookies.header(parsed);
      headers.delete("cookie");
      if (cookie) headers.set("cookie", cookie);
      headers.set("user-agent", USER_AGENT);
      headers.set("referer", PMS_SERVICE);
      if (!headers.has("accept")) headers.set("accept", "application/json, text/javascript, */*; q=0.01");
      if (!headers.has("x-requested-with")) headers.set("x-requested-with", "XMLHttpRequest");

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
        throw new CliError(signal.aborted ? "PMS request timed out." : "Could not reach PMS.", signal.aborted ? "NETWORK_TIMEOUT" : "NETWORK_ERROR", 1, {
          service: "pms",
          cause: error instanceof Error ? error.message : String(error),
        });
      }
      this.cookies.add(response, currentUrl);

      if (!followRedirects) return response;
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      const location = response.headers.get("location");
      if (!location) return response;
      const nextUrl = pmsUrl(new URL(location, currentUrl).toString(), "redirect");
      currentUrl = nextUrl.toString();
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST")) {
        method = "GET";
        body = undefined;
        headers = new Headers();
      }
    }

    throw new CliError("PMS redirected too many times.", "TOO_MANY_REDIRECTS", 1, {
      service: "pms",
    });
  }
}

export function createPmsSession(credentials: PmsCredentials, options: PmsSessionOptions = {}): PmsSession {
  return new PmsSession(credentials, options);
}

function encryptPmsPassword(publicKey: string, password: string, nonce: string): string {
  const key = createPublicKey(toPem(publicKey));
  const plaintext = Buffer.from(`${password};${nonce}`, "utf8");
  return publicEncrypt(
    {
      key,
      padding: constants.RSA_PKCS1_PADDING,
    },
    plaintext,
  ).toString("base64");
}

function toPem(value: string): string {
  if (value.includes("BEGIN PUBLIC KEY")) return value;
  const normalized = value.replace(/\s+/g, "");
  const lines = normalized.match(/.{1,64}/g) ?? [];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join("\n")}\n-----END PUBLIC KEY-----`;
}

function apiUrl(path: string): string {
  return new URL(path.replace(/^\//, ""), `${PMS_API}/`).toString();
}

function resolveServiceUrl(input: string, baseUrl: URL, method?: string): URL {
  const url = new URL(input, baseUrl);
  if (url.origin !== baseUrl.origin) {
    throw new CliError("A PMS request attempted to leave its configured origin.", "UNSAFE_SERVICE_URL", 1, {
      service: "pms",
      host: url.hostname,
    });
  }
  const safeUrl = pmsUrl(url.toString(), "serviceUrl");
  const normalizedMethod = (method ?? "GET").toUpperCase();
  const allowedMethods = PMS_READONLY_PATHS.get(safeUrl.pathname);
  if (!allowedMethods || !allowedMethods.has(normalizedMethod)) {
    throw new CliError("PMS adapter only allows documented read-only endpoints.", "UNSAFE_SERVICE_URL", 1, {
      service: "pms",
      path: safeUrl.pathname,
      method: normalizedMethod,
    });
  }
  return safeUrl;
}

function resolveMutationUrl(path: string, method: string): string {
  const url = pmsUrl(apiUrl(path), "serviceUrl");
  const normalizedMethod = method.toUpperCase();
  const allowedMethods = PMS_MUTATION_PATHS.get(url.pathname);
  if (!allowedMethods || !allowedMethods.has(normalizedMethod)) {
    throw new CliError("PMS adapter only allows documented typed mutation endpoints.", "UNSAFE_SERVICE_URL", 1, {
      service: "pms",
      path: url.pathname,
      method: normalizedMethod,
    });
  }
  return url.toString();
}

function pmsAuthFailure(step: string, record: Record<string, unknown>): CliError {
  return new CliError(`PMS ${step} failed: ${stringValue(record.message, "unknown error")}`, "AUTHENTICATION_FAILED", 2, {
    service: "pms",
    step,
    code: numberValue(record.code, -1),
  });
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

function pmsUrl(value: string, field: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    throw new CliError(`PMS ${field} must use HTTPS.`, "UNSAFE_SERVICE_URL", 1, {
      field,
      protocol: url.protocol,
    });
  }
  if (url.hostname.toLowerCase() !== PMS_HOST) {
    throw new CliError(`PMS ${field} must stay on ${PMS_HOST}.`, "UNSAFE_SERVICE_URL", 1, {
      field,
      host: url.hostname,
    });
  }
  return url;
}
