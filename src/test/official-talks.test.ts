import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { OfficialTalksClient, OFFICIAL_TALKS_URL, parseOfficialTalks, queryOfficialTalks } from "../talks/client.js";

const NOW = new Date("2026-09-05T08:00:00.000Z");

function card(id: string, title: string, time: string, speaker = "Alice 教授", venue = "理学院&nbsp;101"): string {
  return `<div class="swiper-slide"><a href="/zh/events/${id}.html"><div class="evt_list"><div class="evt_ext"><p>${title}</p><div class="evt_adrr"><i></i>${venue}</div></div><div class="evt_peo"><i></i>${speaker}</div><div class="evt_time"><i></i>${time}</div></div></a></div>`;
}

function page(cards: string): string {
  const notice = card("999", "通知公告", "2026年09月20日 10:00");
  return `<div class="item6_slider"><ul><li class="one active"><div class="swiper-wrapper">${cards}</div></li><li class="two"><div class="swiper-wrapper">${notice}</div></li></ul></div>`;
}

const HTML = page([
  card("101", "Past", "2026年09月04日 14:00"),
  card("102", "Quantum &amp; <span>Materials</span>", "2026年09月08日 09:05"),
  card("103", "Soon", "2026年09月06日 14:00", "Bob", "会议中心"),
  card("104", "Unknown", "待定"),
  card("102", "Duplicate", "2026年09月08日 09:05"),
].join(""));

test("homepage parser extracts stable records, normalizes Beijing time, deduplicates, and excludes notices", () => {
  const result = parseOfficialTalks(HTML, NOW.toISOString());
  assert.deepEqual(result.talks.map((talk) => talk.id), ["101", "102", "103", "104"]);
  assert.equal(result.talks[1]!.title, "Quantum & Materials");
  assert.equal(result.talks[1]!.venue, "理学院 101");
  assert.equal(result.talks[1]!.startAt, "2026-09-08T09:05:00+08:00");
  assert.equal(result.talks[1]!.detailUrl, "https://www.sustech.edu.cn/zh/events/102.html");
  assert.deepEqual(result.provenance, { authority: "official", sourceUrl: OFFICIAL_TALKS_URL, fetchedAt: NOW.toISOString(), coverage: "homepage" });
  assert.equal(result.sourceTotal, 4);
});

test("default view keeps upcoming and unknown-time talks and sorts upcoming talks nearest first", () => {
  const result = queryOfficialTalks(parseOfficialTalks(HTML, NOW.toISOString()), { now: NOW });
  assert.deepEqual(result.talks.map((talk) => [talk.id, talk.timing]), [["103", "upcoming"], ["102", "upcoming"], ["104", "unknown"]]);
  assert.equal(result.scope, "upcoming");
  assert.equal(result.total, 3);
  assert.equal(result.sourceTotal, 4);
  assert.equal(result.unknownTimeCount, 1);
  assert.equal(result.referenceTime, NOW.toISOString());
});

test("--all includes started talks after upcoming and unknown records", () => {
  const result = queryOfficialTalks(parseOfficialTalks(HTML, NOW.toISOString()), { all: true, now: NOW });
  assert.deepEqual(result.talks.map((talk) => [talk.id, talk.timing]), [["103", "upcoming"], ["102", "upcoming"], ["104", "unknown"], ["101", "started"]]);
  assert.equal(result.scope, "all");
  assert.equal(result.total, 4);
});

test("search uses title, speaker, venue, and time and follows the same temporal scope", () => {
  const source = parseOfficialTalks(HTML, NOW.toISOString());
  assert.deepEqual(queryOfficialTalks(source, { query: "quantum", now: NOW }).talks.map((talk) => talk.id), ["102"]);
  assert.deepEqual(queryOfficialTalks(source, { query: "bob", now: NOW }).talks.map((talk) => talk.id), ["103"]);
  assert.deepEqual(queryOfficialTalks(source, { query: "会议中心", now: NOW }).talks.map((talk) => talk.id), ["103"]);
  assert.equal(queryOfficialTalks(source, { query: "past", now: NOW }).total, 0);
  assert.deepEqual(queryOfficialTalks(source, { query: "past", all: true, now: NOW }).talks.map((talk) => talk.id), ["101"]);
  assert.deepEqual(queryOfficialTalks(source, { query: "quantum", now: NOW }).warnings, []);
});

test("a talk at the reference instant has already started", () => {
  const source = parseOfficialTalks(page(card("101", "Exact", "2026年09月05日 16:00")), NOW.toISOString());
  assert.equal(queryOfficialTalks(source, { now: NOW }).total, 0);
  assert.equal(queryOfficialTalks(source, { now: NOW, all: true }).talks[0]!.timing, "started");
});

test("invalid lecture times remain visible with warnings and are never guessed", () => {
  for (const time of ["待定", "2026年2月30日 10:00", "2026年9月8日 25:00", "2026年9月8日 10:99"]) {
    const source = parseOfficialTalks(page(card("101", "Example", time)), NOW.toISOString());
    const result = queryOfficialTalks(source, { now: NOW });
    assert.equal(result.talks[0]!.startAt, undefined);
    assert.equal(result.talks[0]!.date, undefined);
    assert.equal(result.talks[0]!.timeText, time);
    assert.equal(result.talks[0]!.timing, "unknown");
    assert.equal(result.warnings.length, 1);
  }
});

test("empty lecture sections differ from broken pages and unsafe detail links", () => {
  assert.equal(parseOfficialTalks(page(""), NOW.toISOString()).total, 0);
  for (const html of ["<h1>Access denied</h1>", HTML.replaceAll("evt_ext", "changed"), HTML.replace("/zh/events/101.html", "https://example.com/zh/events/101.html")]) {
    assert.throws(() => parseOfficialTalks(html, NOW.toISOString()), { code: "UPSTREAM_PROTOCOL_ERROR" });
  }
});

test("official lecture transport is bounded and reports HTTP, protocol, and network failures", async () => {
  const client = new OfficialTalksClient({ name: "fixture", fetch: async (url, init) => {
    assert.equal(url, OFFICIAL_TALKS_URL);
    assert.equal(init?.redirect, "error");
    assert.ok(init?.signal);
    return new Response(HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
  } });
  assert.equal((await client.list({ all: true, now: NOW })).sourceTotal, 4);
  for (const [response, code] of [
    [new Response("unavailable", { status: 503 }), "UPSTREAM_HTTP_ERROR"],
    [new Response("{}", { headers: { "content-type": "application/json" } }), "UPSTREAM_PROTOCOL_ERROR"],
    [new Response("x".repeat(2 * 1024 * 1024 + 1), { headers: { "content-type": "text/html" } }), "UPSTREAM_PROTOCOL_ERROR"],
  ] as const) {
    await assert.rejects(new OfficialTalksClient({ name: "fixture", fetch: async () => response }).list(), { code });
  }
  await assert.rejects(new OfficialTalksClient({ name: "fixture", fetch: async () => { throw new Error("offline"); } }).list(), { code: "NETWORK_ERROR" });
});

const CLI = fileURLToPath(new URL("../cli.js", import.meta.url));

function run(args: string[]) {
  const mock = `Date = class extends Date { constructor(...args) { super(...(args.length ? args : [${JSON.stringify(NOW.toISOString())}])); } static now() { return ${NOW.getTime()}; } }; globalThis.fetch = async () => new Response(${JSON.stringify(HTML)}, {headers:{"content-type":"text/html"}});`;
  return spawnSync(process.execPath, ["--import", `data:text/javascript,${encodeURIComponent(mock)}`, CLI, ...args], { encoding: "utf8", timeout: 10_000 });
}

test("CLI supports upcoming text, --all, search, JSONL, discovery, and strict options", () => {
  const text = run(["talks", "list"]);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /南科大官网学术讲座 · 尚未开始 2 场/);
  assert.ok(text.stdout.indexOf("Soon") < text.stdout.indexOf("Quantum & Materials"));
  assert.doesNotMatch(text.stdout, /\nPast\n/);
  assert.match(text.stdout, /时间待确认（1 场）/);
  assert.match(text.stdout, /使用 --all/);

  const all = run(["talks", "list", "--all", "--json"]);
  assert.equal(all.status, 0, all.stderr);
  const envelope = JSON.parse(all.stdout);
  assert.equal(envelope.command, "talks list");
  assert.equal(envelope.data.scope, "all");
  assert.equal(envelope.data.total, 4);
  assert.equal(envelope.meta.authority, "official");

  assert.equal(JSON.parse(run(["talks", "search", "past", "--json"]).stdout).data.total, 0);
  assert.equal(JSON.parse(run(["talks", "search", "past", "--all", "--json"]).stdout).data.talks[0].id, "101");

  const jsonl = run(["talks", "list", "--jsonl"]);
  assert.equal(jsonl.status, 0, jsonl.stderr);
  assert.deepEqual(jsonl.stdout.trim().split("\n").map((line) => JSON.parse(line).type), ["item", "item", "item", "summary"]);

  const described = run(["describe", "talks", "list", "--json"]);
  assert.equal(described.status, 0, described.stderr);
  assert.deepEqual(JSON.parse(described.stdout).data.options.map((option: { name: string }) => option.name), ["--all", "--output", "--json", "--jsonl", "--pretty"]);

  for (const args of [["list", "extra"], ["search"], ["list", "--page", "2"], ["list", "--source", "homepage"], ["list", "--limit", "1"], ["list", "--confirm"]]) {
    const invalid = run(["talks", ...args, "--json"]);
    assert.equal(invalid.status, 2, invalid.stdout);
    assert.equal(JSON.parse(invalid.stdout).ok, false);
  }
});
