import { existsSync } from "node:fs";
import { USER_AGENT } from "../core/version.js";
import { CliError } from "../core/errors.js";
import type { ServiceAdapter } from "./base.js";
import { BLACKBOARD_BASE } from "./blackboard.js";
import { redactBrowserDiagnostic } from "./library-browser.js";
import { chromium } from "playwright-core";
import type { Browser, BrowserContext, LaunchOptions, Page } from "playwright-core";

const BLACKBOARD_SERVICE_URL = `${BLACKBOARD_BASE}/webapps/bb-sso-BBLEARN/index.jsp`;
const DEFAULT_RENDER_TIMEOUT_MS = 30_000;
const DEFAULT_MANUAL_AUTH_TIMEOUT_MS = 5 * 60_000;

export const BLACKBOARD_BROWSER_AUTH_POLICY = {
  mode: "human-only" as const,
  credentialsAcceptedByCli: false,
  challengeAutomation: false,
  cookiesPersisted: false,
  retryPolicy: "DO_NOT_RETRY_AUTOMATICALLY" as const,
};

export interface BlackboardBrowserOptions {
  interactive?: boolean;
  executablePath?: string;
  renderTimeoutMs?: number;
  manualAuthTimeoutMs?: number;
}

export interface BlackboardBrowserCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  expires?: number;
}

export interface BlackboardBrowserSession {
  authenticatedUrl: string;
  cookies: BlackboardBrowserCookie[];
  authentication: typeof BLACKBOARD_BROWSER_AUTH_POLICY;
}

export interface BlackboardBrowserRuntime {
  authenticate(options?: BlackboardBrowserOptions): Promise<BlackboardBrowserSession>;
}

export async function createBlackboardBrowserAdapter(
  options: BlackboardBrowserOptions = {},
  runtime: BlackboardBrowserRuntime = new PlaywrightBlackboardBrowserRuntime(),
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<ServiceAdapter> {
  const session = await runtime.authenticate(options);
  return {
    name: "bb-browser",
    async fetch(input: string, init: RequestInit = {}): Promise<Response> {
      const url = safeBlackboardRequestUrl(String(input));
      const method = (init.method ?? "GET").toUpperCase();
      if (method !== "GET" || init.body !== undefined) {
        throw new CliError(
          "Blackboard browser authentication currently supports read-only GET requests only.",
          "BROWSER_METHOD_BLOCKED",
          2,
          {
            method,
            ...BLACKBOARD_BROWSER_AUTH_POLICY,
          },
        );
      }
      const headers = new Headers(init.headers);
      headers.set("user-agent", USER_AGENT);
      const cookie = cookieHeader(url, session.cookies);
      if (!cookie) {
        throw new CliError(
          "The Blackboard browser session did not yield a reusable cookie for this request.",
          "SERVICE_SESSION_EXPIRED",
          1,
          {
            interactiveOption: "--interactive",
            ...BLACKBOARD_BROWSER_AUTH_POLICY,
          },
        );
      }
      headers.set("cookie", cookie);
      let response: Response;
      try {
        response = await fetchImpl(url.toString(), {
          ...init,
          method: "GET",
          body: undefined,
          headers,
        });
      } catch (error) {
        throw new CliError(
          "The browser-backed Blackboard request could not be completed.",
          "BROWSER_NETWORK_ERROR",
          1,
          {
            cause: redactBrowserDiagnostic(error),
            ...BLACKBOARD_BROWSER_AUTH_POLICY,
          },
        );
      }
      const finalUrl = response.url ? new URL(response.url) : url;
      if (isCasPage(finalUrl.toString())) {
        throw new CliError(
          "The Blackboard browser session expired before the request could complete. Re-run the command with --browser --interactive.",
          "SERVICE_SESSION_EXPIRED",
          1,
          {
            interactiveOption: "--interactive",
            ...BLACKBOARD_BROWSER_AUTH_POLICY,
          },
        );
      }
      if (finalUrl.origin !== BLACKBOARD_BASE) {
        throw new CliError(
          "A browser-backed Blackboard request attempted to leave its configured origin.",
          "UNSAFE_SERVICE_URL",
          1,
          {
            host: finalUrl.hostname,
            path: finalUrl.pathname,
          },
        );
      }
      return response;
    },
  };
}

export class PlaywrightBlackboardBrowserRuntime implements BlackboardBrowserRuntime {
  public async authenticate(options: BlackboardBrowserOptions = {}): Promise<BlackboardBrowserSession> {
    return this.withPage(options, async (page, context) => {
      const renderTimeoutMs = boundedTimeout(options.renderTimeoutMs, DEFAULT_RENDER_TIMEOUT_MS);
      try {
        await page.goto(BLACKBOARD_SERVICE_URL, { waitUntil: "domcontentloaded", timeout: renderTimeoutMs });
      } catch (error) {
        throw browserAuthError("Blackboard browser authentication could not open the login entrypoint.", page.url() || BLACKBOARD_SERVICE_URL, error);
      }

      if (isCasPage(page.url())) {
        if (!options.interactive) {
          throw new CliError(
            "Blackboard requires an interactive CAS login for browser-backed reads.",
            "MANUAL_AUTH_REQUIRED",
            2,
            {
              interactiveOption: "--interactive",
              ...BLACKBOARD_BROWSER_AUTH_POLICY,
            },
          );
        }
        const authTimeoutMs = boundedTimeout(options.manualAuthTimeoutMs, DEFAULT_MANUAL_AUTH_TIMEOUT_MS);
        try {
          await page.waitForURL((candidate) => !isCasPage(candidate.toString()), { timeout: authTimeoutMs });
        } catch (error) {
          throw new CliError(
            "Manual Blackboard CAS login did not complete within the allowed time.",
            "MANUAL_AUTH_NOT_COMPLETED",
            2,
            {
              timeoutMs: authTimeoutMs,
              cause: redactBrowserDiagnostic(error),
              ...BLACKBOARD_BROWSER_AUTH_POLICY,
            },
          );
        }
      }

      try {
        await page.waitForLoadState("domcontentloaded", { timeout: renderTimeoutMs });
      } catch {
        // Ignore: if Blackboard already reached a stable document, cookies are enough.
      }

      const finalUrl = new URL(page.url() || BLACKBOARD_SERVICE_URL);
      if (isCasPage(finalUrl.toString())) {
        throw new CliError(
          "Blackboard browser authentication did not leave the CAS challenge page.",
          "MANUAL_AUTH_NOT_COMPLETED",
          2,
          {
            interactiveOption: "--interactive",
            ...BLACKBOARD_BROWSER_AUTH_POLICY,
          },
        );
      }
      if (finalUrl.origin !== BLACKBOARD_BASE) {
        throw new CliError(
          "Blackboard browser authentication left the configured Blackboard origin.",
          "UNSAFE_SERVICE_URL",
          1,
          {
            host: finalUrl.hostname,
            path: finalUrl.pathname,
          },
        );
      }

      const cookies = (await context.cookies(BLACKBOARD_BASE))
        .filter((cookie) => domainMatches(new URL(BLACKBOARD_BASE).hostname, cookie.domain))
        .map((cookie) => ({
          name: cookie.name,
          value: cookie.value,
          domain: normaliseCookieDomain(cookie.domain),
          path: cookie.path || "/",
          secure: Boolean(cookie.secure),
          ...(Number.isFinite(cookie.expires) && cookie.expires > 0 ? { expires: cookie.expires } : {}),
        }));
      if (cookies.length === 0) {
        throw new CliError(
          "Blackboard browser authentication did not yield a reusable session cookie.",
          "MANUAL_AUTH_NOT_COMPLETED",
          2,
          {
            interactiveOption: "--interactive",
            ...BLACKBOARD_BROWSER_AUTH_POLICY,
          },
        );
      }
      return {
        authenticatedUrl: finalUrl.toString(),
        cookies,
        authentication: BLACKBOARD_BROWSER_AUTH_POLICY,
      };
    });
  }

  private async withPage<T>(
    options: BlackboardBrowserOptions,
    operation: (page: Page, context: BrowserContext) => Promise<T>,
  ): Promise<T> {
    const browser = await launchLocalChromium(options);
    let context: BrowserContext | undefined;
    try {
      context = await browser.newContext();
      const page = await context.newPage();
      return await operation(page, context);
    } finally {
      await context?.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    }
  }
}

async function launchLocalChromium(options: BlackboardBrowserOptions): Promise<Browser> {
  const headless = !options.interactive;
  const explicitPath = options.executablePath?.trim() || process.env.SUSTECH_BROWSER_EXECUTABLE?.trim();
  const candidates: LaunchOptions[] = [];
  if (explicitPath) {
    candidates.push({ headless, executablePath: explicitPath });
  } else {
    const bundledPath = chromium.executablePath();
    if (bundledPath && existsSync(bundledPath)) candidates.push({ headless, executablePath: bundledPath });
    candidates.push({ headless, channel: "chrome" });
    candidates.push({ headless, channel: "msedge" });
  }

  let lastMessage = "No supported local Chromium browser was found.";
  for (const candidate of candidates) {
    try {
      return await chromium.launch(candidate);
    } catch (error) {
      lastMessage = redactBrowserDiagnostic(error);
    }
  }
  throw new CliError(
    "Blackboard browser authentication requires a local Chrome/Chromium browser.",
    "BROWSER_RUNTIME_UNAVAILABLE",
    1,
    {
      browser: "chromium",
      interactive: Boolean(options.interactive),
      cause: lastMessage,
      hint: "Install Google Chrome or set SUSTECH_BROWSER_EXECUTABLE to a compatible Chromium executable.",
    },
  );
}

function safeBlackboardRequestUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input, BLACKBOARD_BASE);
  } catch {
    throw new CliError("Blackboard browser-backed request URL was invalid.", "UNSAFE_SERVICE_URL", 1);
  }
  if (url.protocol !== "https:" || url.origin !== BLACKBOARD_BASE) {
    throw new CliError("A browser-backed Blackboard request attempted to leave its configured origin.", "UNSAFE_SERVICE_URL", 1, {
      host: url.hostname,
      path: url.pathname,
    });
  }
  return url;
}

function cookieHeader(url: URL, cookies: readonly BlackboardBrowserCookie[]): string | undefined {
  const values = cookies
    .filter((cookie) => domainMatches(url.hostname, cookie.domain))
    .filter((cookie) => url.pathname.startsWith(cookie.path || "/"))
    .map((cookie) => `${cookie.name}=${cookie.value}`);
  return values.length > 0 ? values.join("; ") : undefined;
}

function normaliseCookieDomain(value: string): string {
  return value.replace(/^\./, "").toLowerCase();
}

function domainMatches(host: string, domain: string): boolean {
  const normalizedHost = host.toLowerCase();
  const normalizedDomain = normaliseCookieDomain(domain);
  return normalizedHost === normalizedDomain || normalizedHost.endsWith(`.${normalizedDomain}`);
}

function boundedTimeout(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 1_000) return fallback;
  return Math.min(Math.floor(value), 10 * 60_000);
}

function isCasPage(value: string): boolean {
  try {
    const url = new URL(value);
    return url.hostname.toLowerCase() === "cas.sustech.edu.cn" || /\/(?:cas|authserver)\//i.test(url.pathname);
  } catch {
    return false;
  }
}

function browserAuthError(message: string, url: string, error: unknown): CliError {
  return new CliError(message, "BROWSER_RENDER_FAILED", 1, {
    url: safeBrowserUrl(url),
    cause: redactBrowserDiagnostic(error),
    retryPolicy: "DO_NOT_RETRY_AUTOMATICALLY",
  });
}

function safeBrowserUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/(?:auth|password|secret|session|ticket|token)/i.test(key)) url.searchParams.set(key, "[REDACTED]");
    }
    return url.toString();
  } catch {
    return value.split("?", 1)[0] ?? "";
  }
}
