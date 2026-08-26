import assert from "node:assert/strict";
import test from "node:test";
import type { Credentials } from "../core/credentials.js";
import { CliError } from "../core/errors.js";
import { LibraryBookingSession } from "../services/library-booking-auth.js";
import { getLibraryBookingUser, getLibraryIdleSummary } from "../services/library.js";

const credentials: Credentials = {
  sid: "12200000",
  password: "secret-pass",
  source: "environment",
};

test("LibraryBookingSession resolves authcenter, completes CAS, and reuses ic-cookie for whoami", async () => {
  const dynamicServiceUrl = "https://booking.lib.sustech.edu.cn/authcenter/doAuth/338844332ed94776bf4ae4889dd1b0ba";
  const casLoginUrl = `https://cas.sustech.edu.cn/cas/login?service=${encodeURIComponent(dynamicServiceUrl)}`;
  const seen: Array<{ url: string; method: string; cookie: string; body: string }> = [];
  let authAddressCalls = 0;
  let redirectedWriteCalls = 0;

  const session = new LibraryBookingSession(credentials, {
    fetchImpl: async (input, init = {}) => {
      const url = String(input);
      seen.push({
        url,
        method: init.method ?? "GET",
        cookie: new Headers(init.headers).get("cookie") ?? "",
        body: typeof init.body === "string" ? init.body : "",
      });

      if (url.startsWith("https://booking.lib.sustech.edu.cn/ic-web/auth/address?")) {
        authAddressCalls += 1;
        return jsonResponse({
          code: 0,
          message: "ok",
          data: "https://booking.lib.sustech.edu.cn/authcenter/toLoginPage?redirectUrl=%2Fic%2Fhome&typeCode=16",
        });
      }
      if (url === "https://booking.lib.sustech.edu.cn/authcenter/toLoginPage?redirectUrl=%2Fic%2Fhome&typeCode=16") {
        return redirectResponse(casLoginUrl);
      }
      if (url === casLoginUrl && (init.method ?? "GET") === "GET") {
        return htmlResponse("<form><input name=\"execution\" value=\"e1s1\" /></form>");
      }
      if (url === casLoginUrl && init.method === "POST") {
        const body = String(init.body);
        assert.match(body, /username=12200000/);
        assert.match(body, /password=secret-pass/);
        assert.match(body, /execution=e1s1/);
        assert.match(body, /_eventId=submit/);
        assert.match(body, /submit=/);
        return redirectResponse(`${dynamicServiceUrl}?ticket=ST-1`, 302, "TGC=tgc-123; Domain=cas.sustech.edu.cn; Path=/");
      }
      if (url === `${dynamicServiceUrl}?ticket=ST-1`) {
        return redirectResponse("https://booking.lib.sustech.edu.cn/ic/home", 302, "ic-cookie=ic-123; Domain=booking.lib.sustech.edu.cn; Path=/");
      }
      if (url === "https://booking.lib.sustech.edu.cn/ic/home") {
        return htmlResponse("<html>ok</html>");
      }
      if (url === "https://booking.lib.sustech.edu.cn/ic-web/auth/userInfo") {
        assert.match(new Headers(init.headers).get("cookie") ?? "", /ic-cookie=ic-123/);
        return jsonResponse({
          code: 0,
          message: "ok",
          data: {
            accNo: 12200000,
            pid: "12200000",
            logonName: "12200000",
            trueName: "Student Name",
            className: "CS2022",
            deptName: "Computer Science and Engineering",
          },
        });
      }
      if (url === "https://booking.lib.sustech.edu.cn/ic-web/home/page/room/idle") {
        return redirectResponse("https://booking.lib.sustech.edu.cn/ic-web/reserve/create");
      }
      if (url === "https://booking.lib.sustech.edu.cn/ic-web/reserve/create") {
        redirectedWriteCalls += 1;
        return jsonResponse({ code: 0, data: [] });
      }
      throw new Error(`Unexpected URL ${url}`);
    },
  });

  assert.equal(session.adapter(), session);
  const user = await getLibraryBookingUser(session);
  assert.equal(user.trueName, "Student Name");
  assert.equal(authAddressCalls, 1);

  await session.login();
  assert.equal(authAddressCalls, 1);

  const whoamiCall = seen.find((entry) => entry.url === "https://booking.lib.sustech.edu.cn/ic-web/auth/userInfo");
  assert.match(whoamiCall?.cookie ?? "", /ic-cookie=ic-123/);

  await assert.rejects(
    () => session.fetch("https://booking.lib.sustech.edu.cn/ic-web/auth/userInfo", { method: "POST" }),
    (error: unknown) => error instanceof CliError && error.code === "UNSAFE_SERVICE_REQUEST",
  );
  await assert.rejects(
    () => session.fetch("https://booking.lib.sustech.edu.cn/ic-web/reserve/create"),
    (error: unknown) => error instanceof CliError && error.code === "UNSAFE_SERVICE_REQUEST",
  );
  await assert.rejects(
    () => getLibraryIdleSummary(session),
    (error: unknown) => error instanceof CliError && error.code === "UNSAFE_REDIRECT",
  );
  assert.equal(redirectedWriteCalls, 0);
});

test("LibraryBookingSession rejects a non-HTTPS authcenter bootstrap URL", async () => {
  const session = new LibraryBookingSession(credentials, {
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.startsWith("https://booking.lib.sustech.edu.cn/ic-web/auth/address?")) {
        return jsonResponse({
          code: 0,
          message: "ok",
          data: "http://authserver.sustech.edu.cn/authcenter/toLoginPage?uuid=abc",
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    },
  });

  await assert.rejects(() => session.login(), (error: unknown) => {
    assert(error instanceof CliError);
    assert.equal(error.code, "UNSAFE_SERVICE_URL");
    return true;
  });
});

test("LibraryBookingSession rejects an authcenter redirect that leaves the allowlist", async () => {
  const session = new LibraryBookingSession(credentials, {
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.startsWith("https://booking.lib.sustech.edu.cn/ic-web/auth/address?")) {
        return jsonResponse({
          code: 0,
          message: "ok",
          data: "https://authserver.sustech.edu.cn/authcenter/toLoginPage?uuid=abc",
        });
      }
      if (url === "https://authserver.sustech.edu.cn/authcenter/toLoginPage?uuid=abc") {
        return redirectResponse("https://evil.example/cas/login?service=https%3A%2F%2Fbooking.lib.sustech.edu.cn%2Fic-web%2Fauth%2Fserver");
      }
      throw new Error(`Unexpected URL ${url}`);
    },
  });

  await assert.rejects(() => session.login(), (error: unknown) => {
    assert(error instanceof CliError);
    assert.equal(error.code, "UNSAFE_REDIRECT");
    return true;
  });
});

test("LibraryBookingSession pins the dynamic CAS service to the auth handler path", async () => {
  const wrongService = "https://booking.lib.sustech.edu.cn/ic-web/reserve/create?uuid=abc";
  const session = new LibraryBookingSession(credentials, {
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.startsWith("https://booking.lib.sustech.edu.cn/ic-web/auth/address?")) {
        return jsonResponse({
          code: 0,
          message: "ok",
          data: "https://authserver.sustech.edu.cn/authcenter/toLoginPage?uuid=wrong-path",
        });
      }
      if (url === "https://authserver.sustech.edu.cn/authcenter/toLoginPage?uuid=wrong-path") {
        return redirectResponse(`https://cas.sustech.edu.cn/cas/login?service=${encodeURIComponent(wrongService)}`);
      }
      throw new Error(`Unexpected URL ${url}`);
    },
  });

  await assert.rejects(
    () => session.login(),
    (error: unknown) => error instanceof CliError && error.code === "UNSAFE_REDIRECT",
  );
});

test("LibraryBookingSession never forwards the CAS credential body through a cross-origin 307", async () => {
  const dynamicServiceUrl = "https://booking.lib.sustech.edu.cn/ic-web/auth/server?uuid=body-guard";
  const casLoginUrl = `https://cas.sustech.edu.cn/cas/login?service=${encodeURIComponent(dynamicServiceUrl)}`;
  let targetCalls = 0;
  const session = new LibraryBookingSession(credentials, {
    fetchImpl: async (input, init = {}) => {
      const url = String(input);
      if (url.startsWith("https://booking.lib.sustech.edu.cn/ic-web/auth/address?")) {
        return jsonResponse({
          code: 0,
          message: "ok",
          data: "https://authserver.sustech.edu.cn/authcenter/toLoginPage?uuid=body-guard",
        });
      }
      if (url === "https://authserver.sustech.edu.cn/authcenter/toLoginPage?uuid=body-guard") {
        return redirectResponse(casLoginUrl);
      }
      if (url === casLoginUrl && (init.method ?? "GET") === "GET") {
        return htmlResponse("<input name=\"execution\" value=\"e1s1\" />");
      }
      if (url === casLoginUrl && init.method === "POST") {
        return redirectResponse(`${dynamicServiceUrl}&ticket=ST-1`, 307);
      }
      targetCalls += 1;
      throw new Error(`Credential body reached ${url}`);
    },
  });

  await assert.rejects(
    () => session.login(),
    (error: unknown) => error instanceof CliError && error.code === "UNSAFE_REDIRECT",
  );
  assert.equal(targetCalls, 0);
});

test("LibraryBookingSession fails closed when the CAS exchange never yields ic-cookie", async () => {
  const dynamicServiceUrl = "https://booking.lib.sustech.edu.cn/ic-web/auth/server?uuid=missing-cookie";
  const casLoginUrl = `https://cas.sustech.edu.cn/cas/login?service=${encodeURIComponent(dynamicServiceUrl)}`;

  const session = new LibraryBookingSession(credentials, {
    fetchImpl: async (input, init = {}) => {
      const url = String(input);
      if (url.startsWith("https://booking.lib.sustech.edu.cn/ic-web/auth/address?")) {
        return jsonResponse({
          code: 0,
          message: "ok",
          data: "https://authserver.sustech.edu.cn/authcenter/toLoginPage?uuid=abc",
        });
      }
      if (url === "https://authserver.sustech.edu.cn/authcenter/toLoginPage?uuid=abc") {
        return redirectResponse(casLoginUrl);
      }
      if (url === casLoginUrl && (init.method ?? "GET") === "GET") {
        return htmlResponse("<form><input name=\"execution\" value=\"e1s1\" /></form>");
      }
      if (url === casLoginUrl && init.method === "POST") {
        return redirectResponse(`${dynamicServiceUrl}&ticket=ST-1`);
      }
      if (url === `${dynamicServiceUrl}&ticket=ST-1`) {
        return redirectResponse("https://booking.lib.sustech.edu.cn/ic/home");
      }
      if (url === "https://booking.lib.sustech.edu.cn/ic/home") {
        return htmlResponse("<html>ok</html>");
      }
      throw new Error(`Unexpected URL ${url}`);
    },
  });

  await assert.rejects(() => session.login(), (error: unknown) => {
    assert(error instanceof CliError);
    assert.equal(error.code, "AUTHENTICATION_FAILED");
    return true;
  });
});

test("LibraryBookingSession exposes typed allowlisted write methods without relaxing generic read-only fetch", async () => {
  const dynamicServiceUrl = "https://booking.lib.sustech.edu.cn/ic-web/auth/server?uuid=typed-write";
  const casLoginUrl = `https://cas.sustech.edu.cn/cas/login?service=${encodeURIComponent(dynamicServiceUrl)}`;
  const seen: Array<{ url: string; method: string; cookie: string; body: Record<string, unknown> }> = [];

  const session = new LibraryBookingSession(credentials, {
    fetchImpl: async (input, init = {}) => {
      const url = String(input);
      const method = (init.method ?? "GET").toUpperCase();
      if (url.startsWith("https://booking.lib.sustech.edu.cn/ic-web/auth/address?")) {
        return jsonResponse({
          code: 0,
          message: "ok",
          data: "https://authserver.sustech.edu.cn/authcenter/toLoginPage?uuid=typed-write",
        });
      }
      if (url === "https://authserver.sustech.edu.cn/authcenter/toLoginPage?uuid=typed-write") {
        return redirectResponse(casLoginUrl);
      }
      if (url === casLoginUrl && method === "GET") {
        return htmlResponse("<form><input name=\"execution\" value=\"e1s1\" /></form>");
      }
      if (url === casLoginUrl && method === "POST") {
        return redirectResponse(`${dynamicServiceUrl}&ticket=ST-1`, 302, "TGC=tgc-123; Domain=cas.sustech.edu.cn; Path=/");
      }
      if (url === `${dynamicServiceUrl}&ticket=ST-1`) {
        return redirectResponse("https://booking.lib.sustech.edu.cn/ic/home", 302, "ic-cookie=ic-123; Domain=booking.lib.sustech.edu.cn; Path=/");
      }
      if (url === "https://booking.lib.sustech.edu.cn/ic/home") {
        return htmlResponse("<html>ok</html>");
      }
      if (url === "https://booking.lib.sustech.edu.cn/ic-web/reserve" || url === "https://booking.lib.sustech.edu.cn/ic-web/reserve/delete") {
        seen.push({
          url,
          method,
          cookie: new Headers(init.headers).get("cookie") ?? "",
          body: JSON.parse(String(init.body)),
        });
        return jsonResponse({ code: 0, message: "ok", data: { ok: true } });
      }
      throw new Error(`Unexpected URL ${url}`);
    },
  });

  await session.createReservation({
    sysKind: 1,
    appAccNo: 12200000,
    memberKind: 1,
    resvMember: [12200000],
    resvBeginTime: "2026-08-28 10:00:00",
    resvEndTime: "2026-08-28 11:00:00",
    testName: "study group",
    resvProperty: 0,
    resvDev: [13],
    memo: "",
  });
  await session.cancelReservation("uuid-9001");

  assert.equal(seen.length, 2);
  assert.equal(seen[0]?.url, "https://booking.lib.sustech.edu.cn/ic-web/reserve");
  assert.equal(seen[0]?.method, "POST");
  assert.match(seen[0]?.cookie ?? "", /ic-cookie=ic-123/);
  assert.equal((seen[0]?.body.resvDev as number[])[0], 13);
  assert.equal(seen[1]?.url, "https://booking.lib.sustech.edu.cn/ic-web/reserve/delete");
  assert.equal(seen[1]?.body.uuid, "uuid-9001");
});

function jsonResponse(payload: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(payload), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

function htmlResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    ...init,
    headers: {
      "content-type": "text/html; charset=utf-8",
      ...(init.headers ?? {}),
    },
  });
}

function redirectResponse(location: string, status = 302, setCookie?: string): Response {
  return new Response(null, {
    status,
    headers: {
      location,
      ...(setCookie ? { "set-cookie": setCookie } : {}),
    },
  });
}
