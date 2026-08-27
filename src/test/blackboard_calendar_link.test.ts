import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchBlackboardCalendarFeed,
  maskBlackboardCalendarLink,
  normalizeBlackboardCalendarLink,
} from "../services/blackboard-calendar.js";

test("Blackboard calendar links normalize webcal URLs and fully mask the opaque token", () => {
  const normalized = normalizeBlackboardCalendarLink("webcal://bb.sustech.edu.cn/webapps/calendar/calendarFeed/token-123/learn.ics");
  assert.equal(normalized, "https://bb.sustech.edu.cn/webapps/calendar/calendarFeed/token-123/learn.ics");
  assert.equal(
    maskBlackboardCalendarLink(normalized),
    "https://bb.sustech.edu.cn/webapps/calendar/calendarFeed/[REDACTED]/learn.ics",
  );
});

test("Blackboard calendar link validation rejects non-feed or unsafe URLs", () => {
  for (const value of [
    "http://bb.sustech.edu.cn/webapps/calendar/calendarFeed/token-123/learn.ics",
    "https://bb.sustech.edu.cn/webapps/calendar/calendarFeed/token-123/learn.ics?download=1",
    "https://example.com/webapps/calendar/calendarFeed/token-123/learn.ics",
    "https://bb.sustech.edu.cn/webapps/calendar/calendarFeed/token-123/not-ics",
  ]) {
    assert.throws(
      () => normalizeBlackboardCalendarLink(value),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "INVALID_BLACKBOARD_CALENDAR_LINK");
        return true;
      },
    );
  }
});

test("Blackboard calendar link validation redacts the token in error details", () => {
  assert.throws(
    () => normalizeBlackboardCalendarLink("https://bb.sustech.edu.cn/webapps/calendar/calendarFeed/token-123/not-ics"),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, "INVALID_BLACKBOARD_CALENDAR_LINK");
      assert.equal(
        (error as { details?: { path?: string } }).details?.path,
        "/webapps/calendar/calendarFeed/[REDACTED]/not-ics",
      );
      return true;
    },
  );
});

test("Blackboard calendar feed rejects cross-origin redirects", async () => {
  const url = "https://bb.sustech.edu.cn/webapps/calendar/calendarFeed/token-123/learn.ics";
  const requests: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push(`${init?.method ?? "GET"} ${String(input)}`);
    return responseWithUrl(null, 302, String(input), { location: "https://evil.example/steal.ics" });
  };

  await assert.rejects(
    fetchBlackboardCalendarFeed(url, { fetchImpl }),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, "BLACKBOARD_CALENDAR_REDIRECT_UNSAFE");
      return true;
    },
  );
  assert.deepEqual(requests, [`GET ${url}`]);
});

test("Blackboard calendar feed rejects unrelated same-origin redirect paths", async () => {
  const url = "https://bb.sustech.edu.cn/webapps/calendar/calendarFeed/token-123/learn.ics";
  const fetchImpl: typeof fetch = async (input) => responseWithUrl(null, 302, String(input), {
    location: "https://bb.sustech.edu.cn/learn/api/public/v1/users/me",
  });

  await assert.rejects(
    fetchBlackboardCalendarFeed(url, { fetchImpl }),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, "BLACKBOARD_CALENDAR_REDIRECT_UNSAFE");
      return true;
    },
  );
});

test("Blackboard calendar network errors never expose the subscription token", async () => {
  const token = "private-token-1234567890";
  const url = `https://bb.sustech.edu.cn/webapps/calendar/calendarFeed/${token}/learn.ics`;
  const fetchImpl: typeof fetch = async (input) => {
    throw new Error(`Request failed for ${String(input)}`);
  };

  await assert.rejects(
    fetchBlackboardCalendarFeed(url, { fetchImpl }),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, "BLACKBOARD_CALENDAR_NETWORK_ERROR");
      assert.doesNotMatch(JSON.stringify(error), new RegExp(token));
      return true;
    },
  );
});

test("Blackboard calendar feed rejects HTML bodies", async () => {
  const url = "https://bb.sustech.edu.cn/webapps/calendar/calendarFeed/token-123/learn.ics";
  const fetchImpl: typeof fetch = async (input) => responseWithUrl("<html>login</html>", 200, String(input), {
    "content-type": "text/html; charset=utf-8",
  });

  await assert.rejects(
    fetchBlackboardCalendarFeed(url, { fetchImpl }),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, "BLACKBOARD_CALENDAR_FEED_NOT_ICS");
      return true;
    },
  );
});

test("Blackboard calendar feed enforces the size limit while reading a chunked body", async () => {
  const url = "https://bb.sustech.edu.cn/webapps/calendar/calendarFeed/token-123/learn.ics";
  const oversized = `BEGIN:VCALENDAR\r\n${"X".repeat(128)}\r\nEND:VCALENDAR\r\n`;
  const fetchImpl: typeof fetch = async (input) => responseWithUrl(oversized, 200, String(input), {
    "content-type": "text/calendar",
  });

  await assert.rejects(
    fetchBlackboardCalendarFeed(url, { fetchImpl, maxBytes: 32 }),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, "BLACKBOARD_CALENDAR_FEED_TOO_LARGE");
      return true;
    },
  );
});

test("Blackboard calendar feed safely follows same-origin redirects and returns ICS content", async () => {
  const sourceUrl = "https://bb.sustech.edu.cn/webapps/calendar/calendarFeed/token-123/learn.ics";
  const signedUrl = "https://bb.sustech.edu.cn/bbcswebdav/calendar/signed.ics?token=secret";
  const ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n";
  const requests: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push(`${init?.method ?? "GET"} ${url}`);
    if (url === sourceUrl) return responseWithUrl(null, 302, url, { location: signedUrl });
    if (url === signedUrl) {
      return responseWithUrl(ics, 200, url, {
        "content-type": "text/calendar; charset=utf-8",
        "content-length": String(Buffer.byteLength(ics, "utf8")),
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const result = await fetchBlackboardCalendarFeed(sourceUrl, { fetchImpl });
  assert.equal(result.maskedUrl, "https://bb.sustech.edu.cn/webapps/calendar/calendarFeed/[REDACTED]/learn.ics");
  assert.equal(result.redirects, 1);
  assert.equal(result.content, ics);
  assert.equal(result.contentType, "text/calendar");
  assert.equal(result.size, Buffer.byteLength(ics, "utf8"));
  assert.deepEqual(requests, [`GET ${sourceUrl}`, `GET ${signedUrl}`]);
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
