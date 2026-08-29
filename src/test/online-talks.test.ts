import assert from "node:assert/strict";
import test from "node:test";
import type { ServiceAdapter } from "../services/base.js";
import {
  ONLINE_TALKS_INDEX_REPO_PATH,
  ONLINE_TALKS_INDEX_SITE_PATH,
  ONLINE_MAX_DOCUMENT_BYTES,
  getOnlineTalk,
  listOnlineTalks,
  normaliseTalkSlug,
  onlineRawUrl,
  onlineSiteUrl,
  parseOnlineTalkDetailMarkdown,
  parseOnlineTalksIndexMarkdown,
  searchOnlineTalks,
  talkRepoPathFromSlug,
  talkSitePathFromSlug,
} from "../online/index.js";

const FETCHED_AT = "2026-09-01T00:00:00.000Z";
const UPDATED_AT = "2026-08-20T00:00:00.000Z";
const FIRST_SLUG = "2026-09-10T10-00-00_Alice";
const SECOND_SLUG = "2026-08-20T15-30-00_Bob";

const INDEX_MARKDOWN = `
# 讲座信息

> 以下内容根据公开信息整理，并经大模型处理生成，可能存在疏漏或误差，请以实际信息为准。

## 2026-09-10 周四

- 10:00 - [《科学大讲堂 第1期》Alice Professor @ Example University：Quantum Widgets](${FIRST_SLUG}.md)

## 2026-08-20 周四

- 15:30 - [Bob Researcher：An Older Matching Lecture](${SECOND_SLUG}.md)
`;

const DETAIL_MARKDOWN = `
# 《科学大讲堂 第1期》Alice Professor @ Example University：Quantum Widgets

> 以下内容根据公开信息整理，并经大模型处理生成，可能存在疏漏或误差，请以实际信息为准。

* 题目: Quantum Widgets
* 主讲人：Alice Professor @ Example University
* 时间：2026年9月10日 10:00-11:00
* 地点：第一科研楼 101

## 主讲人简介
Alice studies widgets.

## 讲座简介
An introduction to quantum widgets.

## 海报链接
![](https://gtimg.liziwl.cn/poster.jpg)
`;

test("talk index parser returns stable records with community provenance", () => {
  const talks = parseOnlineTalksIndexMarkdown(INDEX_MARKDOWN, {
    fetchedAt: FETCHED_AT,
    sourceUpdatedAt: UPDATED_AT,
    sourceMetadataAvailable: true,
  });
  assert.equal(talks.length, 2);
  assert.equal(talks[0].id, FIRST_SLUG);
  assert.equal(talks[0].title, "Quantum Widgets");
  assert.equal(talks[0].speakerName, "Alice Professor");
  assert.equal(talks[0].speakerAffiliation, "Example University");
  assert.equal(talks[0].startAt, "2026-09-10T10:00:00+08:00");
  assert.equal(talks[0].provenance.authority, "community");
  assert.equal(talks[0].provenance.license, "CC-BY-SA-4.0");
  assert.deepEqual(talks[0].provenance.advisories, ["COMMUNITY_MAINTAINED", "AI_PROCESSED_SOURCE"]);
});

test("talk detail parser extracts bounded fields and falls back to the slug time", () => {
  const talk = parseOnlineTalkDetailMarkdown(FIRST_SLUG, DETAIL_MARKDOWN, {
    fetchedAt: FETCHED_AT,
    sourceUpdatedAt: UPDATED_AT,
    sourceMetadataAvailable: true,
  });
  assert.equal(talk.date, "2026-09-10");
  assert.equal(talk.timeText, "10:00");
  assert.equal(talk.endAt, "2026-09-10T11:00:00+08:00");
  assert.equal(talk.venue, "第一科研楼 101");
  assert.equal(talk.abstract, "An introduction to quantum widgets.");
  assert.equal(talk.speakerBio, "Alice studies widgets.");
  assert.equal(talk.posterUrl, "https://gtimg.liziwl.cn/poster.jpg");

  const unsafePoster = parseOnlineTalkDetailMarkdown(
    FIRST_SLUG,
    DETAIL_MARKDOWN.replace("https://gtimg.liziwl.cn/poster.jpg", "javascript:alert(1)"),
    {
      fetchedAt: FETCHED_AT,
      sourceUpdatedAt: UPDATED_AT,
      sourceMetadataAvailable: true,
    },
  );
  assert.equal(unsafePoster.posterUrl, undefined);

  const untrustedPoster = parseOnlineTalkDetailMarkdown(
    FIRST_SLUG,
    DETAIL_MARKDOWN.replace("https://gtimg.liziwl.cn/poster.jpg", "https://evil.example/poster.jpg"),
    {
      fetchedAt: FETCHED_AT,
      sourceUpdatedAt: UPDATED_AT,
      sourceMetadataAvailable: true,
    },
  );
  assert.equal(untrustedPoster.posterUrl, undefined);

  const withoutTime = parseOnlineTalkDetailMarkdown(FIRST_SLUG, DETAIL_MARKDOWN.replace(/^\* 时间：.*$/mu, ""), {
    fetchedAt: FETCHED_AT,
    sourceUpdatedAt: UPDATED_AT,
    sourceMetadataAvailable: true,
  });
  assert.equal(withoutTime.date, "2026-09-10");
  assert.equal(withoutTime.timeText, "10:00");
});

test("talk list and search apply date/limit after parsing the full index", async () => {
  const adapter = talksAdapter();
  const listed = await listOnlineTalks({
    adapter,
    fetchedAt: FETCHED_AT,
    since: "2026-09-01",
    until: "2026-09-30",
    limit: 1,
  });
  assert.deepEqual(listed.map((talk) => talk.id), [FIRST_SLUG]);

  const searched = await searchOnlineTalks("Older Matching", {
    adapter,
    fetchedAt: FETCHED_AT,
    limit: 1,
  });
  assert.deepEqual(searched.map((talk) => talk.id), [SECOND_SLUG]);

  const detail = await getOnlineTalk(FIRST_SLUG, { adapter, fetchedAt: FETCHED_AT });
  assert.equal(detail.title, "Quantum Widgets");
});

test("talk reads tolerate unavailable freshness HTML but mark it unknown", async () => {
  const adapter = talksAdapter({ failSite: true });
  const talks = await listOnlineTalks({ adapter, fetchedAt: FETCHED_AT, limit: 2 });
  assert.ok(talks[0].provenance.advisories.includes("SOURCE_UPDATE_UNKNOWN"));
});

test("talk reads reject invalid freshness metadata and bound streamed source bodies", async () => {
  const invalidTimestampAdapter: ServiceAdapter = {
    name: "invalid-timestamp",
    async fetch(input: string): Promise<Response> {
      if (input === onlineRawUrl(ONLINE_TALKS_INDEX_REPO_PATH)) return textResponse(INDEX_MARKDOWN);
      if (input === onlineSiteUrl(ONLINE_TALKS_INDEX_SITE_PATH)) {
        return textResponse('<time datetime="not-a-timestamp"></time>', "text/html");
      }
      throw new Error(`Unexpected fixture URL: ${input}`);
    },
  };
  const talks = await listOnlineTalks({ adapter: invalidTimestampAdapter, fetchedAt: FETCHED_AT });
  assert.equal(talks[0].provenance.sourceUpdatedAt, undefined);
  assert.ok(talks[0].provenance.advisories.includes("SOURCE_UPDATE_UNKNOWN"));

  const oversizedAdapter: ServiceAdapter = {
    name: "oversized-source",
    async fetch(input: string): Promise<Response> {
      if (input === onlineRawUrl(ONLINE_TALKS_INDEX_REPO_PATH)) {
        return new Response(new Uint8Array(ONLINE_MAX_DOCUMENT_BYTES + 1), { status: 200 });
      }
      if (input === onlineSiteUrl(ONLINE_TALKS_INDEX_SITE_PATH)) return textResponse("<html></html>", "text/html");
      throw new Error(`Unexpected fixture URL: ${input}`);
    },
  };
  await assert.rejects(
    listOnlineTalks({ adapter: oversizedAdapter, fetchedAt: FETCHED_AT }),
    /oversized document/u,
  );
});

test("talk IDs cannot escape the single-file source allowlist", () => {
  assert.throws(() => normaliseTalkSlug("%2F"), hasCode("ONLINE_SOURCE_NOT_ALLOWED"));
  assert.throws(() => normaliseTalkSlug("..%2Fsecret"), hasCode("ONLINE_SOURCE_NOT_ALLOWED"));
});

test("talk parsers never emit impossible source dates or times", () => {
  const invalidIndex = `${INDEX_MARKDOWN}\n## 2026-02-30 周一\n\n- 99:99 - [Invalid source row](2026-02-30T99-99-00_Invalid.md)\n`;
  const talks = parseOnlineTalksIndexMarkdown(invalidIndex, {
    fetchedAt: FETCHED_AT,
    sourceUpdatedAt: UPDATED_AT,
    sourceMetadataAvailable: true,
  });
  assert.deepEqual(talks.map((talk) => talk.id), [FIRST_SLUG, SECOND_SLUG]);

  const fallback = parseOnlineTalkDetailMarkdown(
    FIRST_SLUG,
    DETAIL_MARKDOWN.replace("2026年9月10日 10:00-11:00", "2026年2月30日 99:99"),
    { fetchedAt: FETCHED_AT, sourceUpdatedAt: UPDATED_AT, sourceMetadataAvailable: true },
  );
  assert.equal(fallback.startAt, "2026-09-10T10:00:00+08:00");
  assert.equal(fallback.endAt, undefined);

  assert.throws(
    () => parseOnlineTalkDetailMarkdown(
      "2026-02-30T99-99-00_Invalid",
      DETAIL_MARKDOWN.replace(/^\* 时间：.*$/mu, ""),
      { fetchedAt: FETCHED_AT, sourceUpdatedAt: UPDATED_AT, sourceMetadataAvailable: true },
    ),
    hasCode("UPSTREAM_PROTOCOL_ERROR"),
  );
});

test("talk date filters reject impossible dates before fetching", async () => {
  let fetched = false;
  await assert.rejects(
    listOnlineTalks({
      since: "2026-02-30",
      adapter: {
        name: "must-not-fetch",
        async fetch(): Promise<Response> {
          fetched = true;
          throw new Error("unexpected fetch");
        },
      },
    }),
    /real date using YYYY-MM-DD/u,
  );
  assert.equal(fetched, false);
});

function talksAdapter(options: { failSite?: boolean } = {}): ServiceAdapter {
  return {
    name: "talk-fixture",
    async fetch(input: string): Promise<Response> {
      if (input === onlineRawUrl(ONLINE_TALKS_INDEX_REPO_PATH)) return textResponse(INDEX_MARKDOWN);
      if (input === onlineSiteUrl(ONLINE_TALKS_INDEX_SITE_PATH)) {
        if (options.failSite) throw new Error("site metadata unavailable");
        return textResponse(`<time datetime="${UPDATED_AT}"></time>`, "text/html");
      }
      if (input === onlineRawUrl(talkRepoPathFromSlug(FIRST_SLUG))) return textResponse(DETAIL_MARKDOWN);
      if (input === onlineSiteUrl(talkSitePathFromSlug(FIRST_SLUG))) {
        if (options.failSite) throw new Error("site metadata unavailable");
        return textResponse(`<time datetime="${UPDATED_AT}"></time>`, "text/html");
      }
      throw new Error(`Unexpected fixture URL: ${input}`);
    },
  };
}

function textResponse(body: string, contentType = "text/markdown"): Response {
  return new Response(body, { status: 200, headers: { "content-type": contentType } });
}

function hasCode(code: string): (error: unknown) => boolean {
  return (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}
