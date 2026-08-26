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
