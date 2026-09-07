import assert from "node:assert/strict";
import test from "node:test";
import {
  BLACKBOARD_BROWSER_AUTH_POLICY,
  createBlackboardBrowserAdapter,
  type BlackboardBrowserCookie,
  type BlackboardBrowserOptions,
  type BlackboardBrowserRuntime,
  type BlackboardBrowserSession,
} from "../services/blackboard-browser.js";

test("Blackboard browser auth policy is manual-only and ephemeral", () => {
  assert.deepEqual(BLACKBOARD_BROWSER_AUTH_POLICY, {
    mode: "human-only",
    credentialsAcceptedByCli: false,
    challengeAutomation: false,
    cookiesPersisted: false,
    retryPolicy: "DO_NOT_RETRY_AUTOMATICALLY",
  });
});

test("Blackboard browser adapter reuses authenticated cookies for same-origin GET reads", async () => {
  let seenUrl = "";
  let seenHeaders = new Headers();
  let seenMethod = "";
  const runtime = new FakeBlackboardRuntime({
    cookies: [{ name: "BbRouter", value: "cookie-1", domain: "bb.sustech.edu.cn", path: "/", secure: true }],
  });
  const adapter = await createBlackboardBrowserAdapter(
    { interactive: true },
    runtime,
    async (input, init) => {
      seenUrl = String(input);
      seenHeaders = new Headers(init?.headers);
      seenMethod = String(init?.method ?? "GET");
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  );

  const response = await adapter.fetch("https://bb.sustech.edu.cn/learn/api/public/v1/users/me", {
    headers: { accept: "application/json" },
  });

  assert.equal(runtime.lastOptions?.interactive, true);
  assert.equal(seenUrl, "https://bb.sustech.edu.cn/learn/api/public/v1/users/me");
  assert.equal(seenMethod, "GET");
  assert.equal(seenHeaders.get("accept"), "application/json");
  assert.match(seenHeaders.get("cookie") ?? "", /BbRouter=cookie-1/u);
  assert.deepEqual(await response.json(), { ok: true });
});

test("Blackboard browser adapter rejects cross-origin or non-GET requests", async () => {
  const runtime = new FakeBlackboardRuntime({
    cookies: [{ name: "BbRouter", value: "cookie-1", domain: "bb.sustech.edu.cn", path: "/", secure: true }],
  });
  const adapter = await createBlackboardBrowserAdapter(
    {},
    runtime,
    async () => new Response("ok", { status: 200 }),
  );

  await assert.rejects(
    adapter.fetch("https://evil.example/learn/api/public/v1/users/me"),
    (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "UNSAFE_SERVICE_URL"),
  );

  await assert.rejects(
    adapter.fetch("https://bb.sustech.edu.cn/learn/api/public/v1/users/me", { method: "POST" }),
    (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "BROWSER_METHOD_BLOCKED"),
  );
});

class FakeBlackboardRuntime implements BlackboardBrowserRuntime {
  public lastOptions?: BlackboardBrowserOptions;

  public constructor(private readonly fixtures: {
    cookies: BlackboardBrowserCookie[];
  }) {}

  public async authenticate(options?: BlackboardBrowserOptions): Promise<BlackboardBrowserSession> {
    this.lastOptions = options;
    return {
      authenticatedUrl: "https://bb.sustech.edu.cn/ultra/institution-page",
      cookies: this.fixtures.cookies,
      authentication: BLACKBOARD_BROWSER_AUTH_POLICY,
    };
  }
}
