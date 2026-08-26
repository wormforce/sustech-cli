import assert from "node:assert/strict";
import test from "node:test";
import type { Credentials } from "../core/credentials.js";
import { CliError } from "../core/errors.js";
import { BookingSession } from "../services/booking-auth.js";

const credentials: Credentials = {
  sid: "12200000",
  password: "secret-password",
  source: "environment",
};

test("BookingSession completes the CAS ticket and GetUserProfile handshake before attaching Authorization", async () => {
  const requests: string[] = [];
  let redirectedWriteCalls = 0;
  const token = "12345678-1234-1234-1234-123456789abc";
  const session = new BookingSession(credentials, {
    fetchImpl: async (input, init) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      requests.push(`${method} ${url}`);
      const headers = new Headers(init?.headers);

      if (url.startsWith("https://cas.sustech.edu.cn/cas/login?service=") && method === "GET") {
        return textResponse("<input name=\"execution\" value=\"exec-1\">", 200, {
          "content-type": "text/html",
          "set-cookie": "CASTGC=cas-cookie; Path=/cas",
        });
      }
      if (url.startsWith("https://cas.sustech.edu.cn/cas/login?service=") && method === "POST") {
        const form = new URLSearchParams(String(init?.body));
        assert.equal(form.get("username"), credentials.sid);
        assert.equal(form.get("password"), credentials.password);
        assert.equal(form.get("execution"), "exec-1");
        assert.equal(form.get("_eventId"), "submit");
        assert.equal(form.get("submit"), "提交");
        assert.match(headers.get("cookie") ?? "", /CASTGC=cas-cookie/);
        return textResponse("", 302, {
          location: "https://booking.sustech.edu.cn/redirect?ticket=ST-BOOKING-1",
        });
      }
      if (url === "https://booking.sustech.edu.cn/redirect?ticket=ST-BOOKING-1") {
        return textResponse("", 302, {
          location: "https://booking.sustech.edu.cn/home",
          "set-cookie": "BOOKINGSESSID=booking-cookie; Domain=booking.sustech.edu.cn; Path=/",
        });
      }
      if (url === "https://booking.sustech.edu.cn/home") {
        assert.equal(headers.get("cookie"), "BOOKINGSESSID=booking-cookie");
        return textResponse("<html>ok</html>", 200, { "content-type": "text/html" });
      }
      if (url === "https://booking.sustech.edu.cn/api/SystemApi/GetUserProfile") {
        assert.equal(headers.get("authorization"), null);
        assert.equal(headers.get("x-requested-with"), "XMLHttpRequest");
        assert.equal(headers.get("cookie"), "BOOKINGSESSID=booking-cookie");
        const body = JSON.parse(String(init?.body)) as {
          MessageType: number;
          MessageID: string;
          Data: { Url: string; St: string };
        };
        assert.equal(body.MessageType, 1001);
        assert.match(body.MessageID, /^[0-9a-f-]{36}$/i);
        assert.equal(body.Data.Url, "https://booking.sustech.edu.cn/redirect");
        assert.equal(body.Data.St, "ST-BOOKING-1");
        return jsonResponse({
          IsSuccess: true,
          Data: {
            Token: token,
            UserInfoModel: { XM: "Test Student", YHM: credentials.sid, DeptName: "致诚书院" },
          },
        });
      }
      if (url === "https://booking.sustech.edu.cn/api/SystemApi/GetMyMeetings") {
        assert.equal(headers.get("authorization"), token);
        assert.equal(headers.get("cookie"), "BOOKINGSESSID=booking-cookie");
        return jsonResponse({ IsSuccess: true, Data: { rows: [] } });
      }
      if (url === "https://booking.sustech.edu.cn/api/SystemApi/GetMeetingRoomAllByCondition") {
        return textResponse("", 307, {
          location: "https://booking.sustech.edu.cn/api/SystemApi/AddMeeting",
        });
      }
      if (url === "https://booking.sustech.edu.cn/api/SystemApi/AddMeeting") {
        redirectedWriteCalls += 1;
        return jsonResponse({ IsSuccess: true });
      }
      throw new Error(`Unexpected request ${method} ${url}`);
    },
  });

  assert.equal(session.userProfile, undefined);
  const response = await session.fetch("https://booking.sustech.edu.cn/api/SystemApi/GetMyMeetings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ MessageType: 1002, MessageID: "m-1", Data: { page: 1 } }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(session.userProfile, {
    name: "Test Student",
    sid: credentials.sid,
    department: "致诚书院",
  });
  const profileJson = JSON.stringify(session.userProfile);
  assert.match(profileJson, /Test Student/);
  assert.doesNotMatch(profileJson, /token|cookie|password|12345678-1234-1234-1234-123456789abc/i);
  assert.deepEqual(requests, [
    "GET https://cas.sustech.edu.cn/cas/login?service=https%3A%2F%2Fbooking.sustech.edu.cn%2Fredirect",
    "POST https://cas.sustech.edu.cn/cas/login?service=https%3A%2F%2Fbooking.sustech.edu.cn%2Fredirect",
    "GET https://booking.sustech.edu.cn/redirect?ticket=ST-BOOKING-1",
    "GET https://booking.sustech.edu.cn/home",
    "POST https://booking.sustech.edu.cn/api/SystemApi/GetUserProfile",
    "POST https://booking.sustech.edu.cn/api/SystemApi/GetMyMeetings",
  ]);
  await assert.rejects(
    () => session.fetch("https://booking.sustech.edu.cn/api/SystemApi/GetMeetingRoomAllByCondition", {
      method: "POST",
      body: "{}",
    }),
    (error: unknown) => error instanceof CliError && error.code === "UNSAFE_REDIRECT",
  );
  assert.equal(redirectedWriteCalls, 0);
});

test("BookingSession rejects unsafe CAS redirects before exchanging the ticket", async () => {
  const session = new BookingSession(credentials, {
    fetchImpl: async (input, init) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.startsWith("https://cas.sustech.edu.cn/cas/login?service=") && method === "GET") {
        return textResponse("<input name=\"execution\" value=\"exec-1\">");
      }
      if (url.startsWith("https://cas.sustech.edu.cn/cas/login?service=") && method === "POST") {
        return textResponse("", 302, { location: "https://evil.example/redirect?ticket=ST-BAD" });
      }
      throw new Error(`Unexpected request ${method} ${url}`);
    },
  });

  await assert.rejects(
    session.login(),
    (error: unknown) => error instanceof CliError && error.code === "UNSAFE_REDIRECT",
  );
});

test("BookingSession pins CAS tickets to the configured service path", async () => {
  const session = new BookingSession(credentials, {
    fetchImpl: async (input, init) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.startsWith("https://cas.sustech.edu.cn/cas/login?service=") && method === "GET") {
        return textResponse("<input name=\"execution\" value=\"exec-1\">");
      }
      if (url.startsWith("https://cas.sustech.edu.cn/cas/login?service=") && method === "POST") {
        return textResponse("", 302, {
          location: "https://booking.sustech.edu.cn/api/SystemApi/AddMeeting?ticket=ST-BAD-PATH",
        });
      }
      throw new Error(`Unexpected request ${method} ${url}`);
    },
  });

  await assert.rejects(
    () => session.login(),
    (error: unknown) => error instanceof CliError && error.code === "UNSAFE_REDIRECT",
  );
});

test("BookingSession reports network restrictions when the booking host blocks the token handshake", async () => {
  const session = new BookingSession(credentials, {
    fetchImpl: async (input, init) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.startsWith("https://cas.sustech.edu.cn/cas/login?service=") && method === "GET") {
        return textResponse("<input name=\"execution\" value=\"exec-1\">");
      }
      if (url.startsWith("https://cas.sustech.edu.cn/cas/login?service=") && method === "POST") {
        return textResponse("", 302, { location: "https://booking.sustech.edu.cn/redirect?ticket=ST-BOOKING-2" });
      }
      if (url === "https://booking.sustech.edu.cn/redirect?ticket=ST-BOOKING-2") {
        return textResponse("", 302, {
          location: "https://booking.sustech.edu.cn/home",
          "set-cookie": "BOOKINGSESSID=booking-cookie; Domain=booking.sustech.edu.cn; Path=/",
        });
      }
      if (url === "https://booking.sustech.edu.cn/home") {
        return textResponse("<html>ok</html>", 200, { "content-type": "text/html" });
      }
      if (url === "https://booking.sustech.edu.cn/api/SystemApi/GetUserProfile") {
        return textResponse("Access forbidden, please contact administrator.", 403, {
          "content-type": "text/plain",
        });
      }
      throw new Error(`Unexpected request ${method} ${url}`);
    },
  });

  await assert.rejects(
    session.login(),
    (error: unknown) => error instanceof CliError && error.code === "NETWORK_RESTRICTED",
  );
});

test("BookingSession blocks booking write endpoints even after a successful login", async () => {
  let requests = 0;
  const session = new BookingSession(credentials, {
    fetchImpl: async (input, init) => {
      requests += 1;
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.startsWith("https://cas.sustech.edu.cn/cas/login?service=") && method === "GET") {
        return textResponse("<input name=\"execution\" value=\"exec-1\">");
      }
      if (url.startsWith("https://cas.sustech.edu.cn/cas/login?service=") && method === "POST") {
        return textResponse("", 302, { location: "https://booking.sustech.edu.cn/redirect?ticket=ST-BOOKING-3" });
      }
      if (url === "https://booking.sustech.edu.cn/redirect?ticket=ST-BOOKING-3") {
        return textResponse("", 302, {
          location: "https://booking.sustech.edu.cn/home",
          "set-cookie": "BOOKINGSESSID=booking-cookie; Domain=booking.sustech.edu.cn; Path=/",
        });
      }
      if (url === "https://booking.sustech.edu.cn/home") {
        return textResponse("<html>ok</html>", 200, { "content-type": "text/html" });
      }
      if (url === "https://booking.sustech.edu.cn/api/SystemApi/GetUserProfile") {
        return jsonResponse({
          IsSuccess: true,
          Data: {
            Token: "12345678-1234-1234-1234-123456789abc",
            UserInfoModel: { XM: "Test Student", YHM: credentials.sid },
          },
        });
      }
      throw new Error(`Unexpected request ${method} ${url}`);
    },
  });

  await session.login();
  assert.equal(requests, 5);

  await assert.rejects(
    session.fetch("https://booking.sustech.edu.cn/api/SystemApi/AddMeeting", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }),
    (error: unknown) => error instanceof CliError && error.code === "BOOKING_WRITE_BLOCKED",
  );
  assert.equal(requests, 5);
});

function textResponse(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: new Headers(headers) });
}

function jsonResponse(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return textResponse(JSON.stringify(value), status, {
    "content-type": "application/json",
    ...headers,
  });
}
