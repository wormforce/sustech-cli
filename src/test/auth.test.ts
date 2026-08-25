import assert from "node:assert/strict";
import test from "node:test";
import { CliError } from "../core/errors.js";
import { TisSession } from "../tis/auth.js";

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
