import assert from "node:assert/strict";
import test from "node:test";
import { CasSession } from "../sso/cas.js";

const credentials = { sid: "12345678", password: "secret", source: "environment" as const };

test("generic CAS session refuses redirects outside the configured service hosts", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, {
    status: 302,
    headers: { location: "https://evil.example/steal" },
  });
  try {
    const session = new CasSession(credentials, {
      name: "Blackboard",
      baseUrl: "https://bb.sustech.edu.cn",
      serviceUrl: "https://bb.sustech.edu.cn/webapps/bb-sso-BBLEARN/index.jsp",
    });
    await assert.rejects(session.login(), (error: unknown) => {
      assert.equal((error as { code?: string }).code, "UNSAFE_REDIRECT");
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("generic CAS session rejects non-HTTPS service configuration", () => {
  assert.throws(
    () => new CasSession(credentials, {
      name: "Unsafe",
      baseUrl: "http://example.test",
      serviceUrl: "https://example.test/cas",
    }),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, "UNSAFE_SERVICE_URL");
      return true;
    },
  );
});

test("generic CAS session stops before submitting a password when an interactive CAPTCHA is required", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (input) => {
    calls += 1;
    return responseWithUrl(`
      <form>
        <input name="execution" value="e1">
        <input name="g-recaptcha-response" required>
        <div id="su-recaptcha"></div>
        <script>document.querySelector('#su-recaptcha').slideVerify({});</script>
      </form>
    `, 200, String(input));
  };
  try {
    const session = new CasSession(credentials, {
      name: "TIS",
      baseUrl: "https://tis.sustech.edu.cn",
      serviceUrl: "https://tis.sustech.edu.cn/cas",
    });
    await assert.rejects(session.login(), (error: unknown) => {
      assert.equal((error as { code?: string }).code, "CAS_INTERACTIVE_CHALLENGE_REQUIRED");
      assert.equal((error as { details?: { passwordSubmitted?: boolean } }).details?.passwordSubmitted, false);
      return true;
    });
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("generic CAS session safely follows a same-host Blackboard attachment redirect", async () => {
  const originalFetch = globalThis.fetch;
  const serviceUrl = "https://bb.sustech.edu.cn/webapps/bb-sso-BBLEARN/index.jsp";
  const attachmentUrl = "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_10_1/contents/_20_1/attachments/_30_1/download";
  const signedUrl = "https://bb.sustech.edu.cn/bbcswebdav/xid-30_1?temporary=fresh&signature=secret";
  const requests: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    requests.push(`${method} ${url}`);
    if (url.startsWith("https://cas.sustech.edu.cn/cas/login?") && method === "GET") {
      return responseWithUrl('<input name="execution" value="e1">', 200, url);
    }
    if (url.startsWith("https://cas.sustech.edu.cn/cas/login?") && method === "POST") {
      return responseWithUrl(null, 302, url, { location: serviceUrl });
    }
    if (url === serviceUrl) return responseWithUrl("signed in", 200, url);
    if (url === attachmentUrl) return responseWithUrl(null, 302, url, { location: signedUrl });
    if (url === signedUrl) {
      return responseWithUrl("attachment bytes", 200, url, { "content-type": "application/pdf" });
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  try {
    const session = new CasSession(credentials, {
      name: "Blackboard",
      baseUrl: "https://bb.sustech.edu.cn",
      serviceUrl,
    });
    await session.login();
    const response = await session.fetch(attachmentUrl);
    assert.equal(await response.text(), "attachment bytes");
    assert.deepEqual(requests.slice(-2), [`GET ${attachmentUrl}`, `GET ${signedUrl}`]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

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
