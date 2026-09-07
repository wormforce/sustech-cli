import assert from "node:assert/strict";
import test from "node:test";
import { authenticateBlackboardBrowserSession, authenticateCredentials } from "../core/auth-check.js";
import { CliError } from "../core/errors.js";
import { BLACKBOARD_BROWSER_AUTH_POLICY, type BlackboardBrowserRuntime, type BlackboardBrowserSession } from "../services/blackboard-browser.js";
import { TisSession } from "../tis/auth.js";

const credentials = { sid: "12345678", password: "secret", source: "environment" as const };

test("CAS authentication refuses redirects outside SUSTech HTTPS hosts", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  let sawAbortSignal = false;
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    calls += 1;
    sawAbortSignal = sawAbortSignal || init?.signal instanceof AbortSignal;
    if (calls === 1) {
      return new Response('<form><input name="execution" value="token"></form>', {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }
    return new Response(null, {
      status: 307,
      headers: { location: "https://example.net/credential-forward" },
    });
  }) as typeof fetch;

  try {
    await assert.rejects(
      new TisSession({ sid: "12345678", password: "secret", source: "environment" }).login(),
      (error: unknown) => error instanceof CliError && error.code === "UNSAFE_REDIRECT",
    );
    assert.equal(sawAbortSignal, true);
  } finally {
    globalThis.fetch = original;
  }
});

test("Blackboard auth checks read the official users/me endpoint before succeeding", async () => {
  const original = globalThis.fetch;
  const requests: string[] = [];
  const serviceUrl = "https://bb.sustech.edu.cn/webapps/bb-sso-BBLEARN/index.jsp";
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    requests.push(`${method} ${url}`);
    if (url.startsWith("https://cas.sustech.edu.cn/cas/login?") && method === "GET") {
      return responseWithUrl('<form><input name="execution" value="token"></form>', 200, url, {
        "content-type": "text/html",
      });
    }
    if (url.startsWith("https://cas.sustech.edu.cn/cas/login?") && method === "POST") {
      return responseWithUrl(null, 302, url, { location: serviceUrl });
    }
    if (url === serviceUrl) return responseWithUrl("signed in", 200, url);
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/users/me") {
      return responseWithUrl(JSON.stringify({
        id: "_1_1",
        userName: "12200000",
        name: "Student Name",
      }), 200, url, {
        "content-type": "application/json",
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  }) as typeof fetch;

  try {
    const result = await authenticateCredentials(credentials, "bb");
    assert.deepEqual(result, {
      authenticated: true,
      credentialSource: "environment",
      identity: "Student Name",
    });
    assert.deepEqual(requests, [
      `GET ${new URL(`https://cas.sustech.edu.cn/cas/login?service=${encodeURIComponent(serviceUrl)}`).toString()}`,
      `POST ${new URL(`https://cas.sustech.edu.cn/cas/login?service=${encodeURIComponent(serviceUrl)}`).toString()}`,
      `GET ${serviceUrl}`,
      "GET https://bb.sustech.edu.cn/learn/api/public/v1/users/me",
    ]);
  } finally {
    globalThis.fetch = original;
  }
});

test("Blackboard auth checks fail when the REST user read is unavailable after CAS login", async () => {
  const original = globalThis.fetch;
  const requests: string[] = [];
  const serviceUrl = "https://bb.sustech.edu.cn/webapps/bb-sso-BBLEARN/index.jsp";
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    requests.push(`${method} ${url}`);
    if (url.startsWith("https://cas.sustech.edu.cn/cas/login?") && method === "GET") {
      return responseWithUrl('<form><input name="execution" value="token"></form>', 200, url, {
        "content-type": "text/html",
      });
    }
    if (url.startsWith("https://cas.sustech.edu.cn/cas/login?") && method === "POST") {
      return responseWithUrl(null, 302, url, { location: serviceUrl });
    }
    if (url === serviceUrl) return responseWithUrl("signed in", 200, url);
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/users/me") {
      return responseWithUrl("upstream unavailable", 503, url, {
        "content-type": "text/plain",
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  }) as typeof fetch;

  try {
    await assert.rejects(
      authenticateCredentials(credentials, "bb"),
      (error: unknown) => {
        assert.ok(error instanceof CliError);
        assert.equal(error.code, "SERVICE_HTTP_ERROR");
        assert.equal(error.details?.bodySample, "upstream unavailable");
        return true;
      },
    );
    assert.equal(requests.at(-1), "GET https://bb.sustech.edu.cn/learn/api/public/v1/users/me");
  } finally {
    globalThis.fetch = original;
  }
});

test("Blackboard browser auth checks read the official users/me endpoint without stored credentials", async () => {
  const requests: string[] = [];
  const result = await authenticateBlackboardBrowserSession({
    interactive: true,
    runtime: new FakeBlackboardRuntime(),
    fetchImpl: async (input, init) => {
      const url = String(input);
      requests.push(`${init?.method ?? "GET"} ${url}`);
      if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/users/me") {
        return responseWithUrl(JSON.stringify({
          id: "_1_1",
          userName: "12200000",
          name: "Student Name",
        }), 200, url, {
          "content-type": "application/json",
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    },
  });

  assert.deepEqual(result, {
    authenticated: true,
    credentialSource: "browser-session",
    identity: "Student Name",
  });
  assert.deepEqual(requests, ["GET https://bb.sustech.edu.cn/learn/api/public/v1/users/me"]);
});

class FakeBlackboardRuntime implements BlackboardBrowserRuntime {
  public async authenticate(): Promise<BlackboardBrowserSession> {
    return {
      authenticatedUrl: "https://bb.sustech.edu.cn/ultra/institution-page",
      cookies: [{ name: "BbRouter", value: "cookie-1", domain: "bb.sustech.edu.cn", path: "/", secure: true }],
      authentication: BLACKBOARD_BROWSER_AUTH_POLICY,
    };
  }
}

function responseWithUrl(
  body: string | null,
  status: number,
  url: string,
  headers?: Record<string, string>,
): Response {
  const response = new Response(body, { status, headers });
  Object.defineProperty(response, "url", { value: url });
  return response;
}
