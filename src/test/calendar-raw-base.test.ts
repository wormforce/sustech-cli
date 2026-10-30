import assert from "node:assert/strict";
import test from "node:test";
import { CalendarClient, calendarRepoBase } from "../calendar/client.js";
import { CliError } from "../core/errors.js";

const DEFAULT_BASE = "https://raw.githubusercontent.com/dumixthestpd/sustech-calendar/main";
const MIRROR_BASE = "https://ghfast.top/https://raw.githubusercontent.com/dumixthestpd/sustech-calendar/main";

test("defaults to the public calendar repository", () => {
  assert.equal(calendarRepoBase({}), DEFAULT_BASE);
});

test("accepts an HTTPS mirror override and trims surrounding slashes and spaces", () => {
  assert.equal(calendarRepoBase({ SUSTECH_CALENDAR_RAW_BASE: MIRROR_BASE }), MIRROR_BASE);
  assert.equal(calendarRepoBase({ SUSTECH_CALENDAR_RAW_BASE: `${MIRROR_BASE}/` }), MIRROR_BASE);
  assert.equal(calendarRepoBase({ SUSTECH_CALENDAR_RAW_BASE: `  ${MIRROR_BASE}  ` }), MIRROR_BASE);
});

test("rejects unsafe or malformed overrides", () => {
  const values = [
    "http://mirror.example/repo",
    "https://user:secret@mirror.example/repo",
    "https://mirror.example/repo?token=1",
    "https://mirror.example/repo#fragment",
    "not a url",
  ];
  for (const value of values) {
    assert.throws(
      () => calendarRepoBase({ SUSTECH_CALENDAR_RAW_BASE: value }),
      (error: unknown) => error instanceof CliError && error.code === "CALENDAR_RAW_BASE_INVALID",
    );
  }
});

test("loadYear reads the configured mirror base", async () => {
  const originalBase = process.env.SUSTECH_CALENDAR_RAW_BASE;
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  process.env.SUSTECH_CALENDAR_RAW_BASE = MIRROR_BASE;
  globalThis.fetch = (async (input: string | URL | Request) => {
    requested.push(String(input));
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    await assert.rejects(() => new CalendarClient().loadYear(2026));
    assert.equal(requested.length, 3);
    for (const url of requested) {
      assert.ok(url.startsWith(`${MIRROR_BASE}/2026/`), url);
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBase === undefined) delete process.env.SUSTECH_CALENDAR_RAW_BASE;
    else process.env.SUSTECH_CALENDAR_RAW_BASE = originalBase;
  }
});
