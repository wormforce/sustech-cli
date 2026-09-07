import assert from "node:assert/strict";
import test from "node:test";
import type { ServiceAdapter } from "../services/base.js";
import {
  ONLINE_CONTACT_REPO_PATH,
  ONLINE_CONTACT_SITE_PATH,
  ONLINE_MAX_DOCUMENT_BYTES,
  ONLINE_TALKS_INDEX_REPO_PATH,
  ONLINE_TALKS_INDEX_SITE_PATH,
  onlineRawUrl,
  onlineSiteUrl,
} from "../online/shared.js";
import {
  getOnlineManualRecord,
  listOnlineManualRecords,
  listOnlineManualRecordsWithStatus,
  loadOnlineManualCorpus,
  onlineManualRawUrl,
  onlineManualSiteUrl,
  searchOnlineManual,
  searchOnlineManualWithStatus,
} from "../online/manual.js";
import { formatOnlineManualRecord, formatOnlineManualRecords } from "../online/manual-text.js";
import { searchOnlineWithStatus } from "../online/search.js";

const FETCHED_AT = "2026-09-04T00:00:00.000Z";
const UPDATED_AT = "2026-09-01T09:45:32.000Z";

const SERVICE_REPO_PATH = "docs/service/README.md";
const SERVICE_SITE_PATH = "/service/";
const LIFE_REPO_PATH = "docs/life/README.md";
const LIFE_SITE_PATH = "/life/";
const CALENDAR_REPO_PATH = "docs/calendar/README.md";
const CALENDAR_SITE_PATH = "/calendar/";

const SERVICE_MARKDOWN = `
# 服务与技巧

## SID (Student ID) 相关

### 🆔学号

- [学号的含义](./sid)

### 💳校园卡&学生证

- [校园卡](./campus-card)
- [火车票学生优惠使用指南](./student-train-ticket/)
- [恶意入口](javascript:alert(1))
- 使用校园卡可进入宿舍、校门和图书馆等场所。

## 信息服务

### 校园网络

- [校园网络介绍与连接指南](./network)
- [eduroam（学术网路漫游）](./network/eduroam)

### Ehall

1. [SUSTech ehall | 成绩查询](http://ehall.sustech.edu.cn/publicapp/sys/cjcxapp/index.do)

## 教学相关

### 👨‍🏫Sakai

- [Sakai | 文件分享](./sakai)

### 计算机研究协会（CRA）

1. [镜像站](https://mirrors.sustech.edu.cn/)
2. [Markdown](https://md.cra.moe/)

## 退税

- [如何申报退税？](/service/tax/)

## 软件授权

### 教育邮箱福利

1. [Office 365](https://signup.microsoft.com/signup?sku=Education)
2. [Jetbrains 全家桶](https://www.jetbrains.com/zh/student/)

### 非官方Windows套件激活服务

1. [KMS](https://example.invalid/kms)
`;

const LIFE_MARKDOWN = `
# 生活在南科

## 住宿

::: tip 宿舍房型图

宿舍房型图可至[此页面](/life/dormitory/dorm-floor-plan.html)查看。

:::

- [🏠住在南科](./dormitory)

  包含宿舍概况，位置，房型图等。

- 新生宿舍楼下有超市，晚归进入宿舍需要登记。

## 餐饮

- [☕️校园餐饮](./catering)

## Tips

- 出入校门、食堂买饭买水果买饮品、进出宿舍楼等都需要刷校园卡。
- 关于校园卡，请参考“[校园卡](/service/campus-card)”一节。
`;

const CALENDAR_MARKDOWN = `
# 校历

校历暂时缺失结构。
`;

test("manual search returns bounded records for full content and short linked sections", async () => {
  const adapter = manualAdapter();

  const campusCard = await searchOnlineManual("校园卡", {
    adapter,
    fetchedAt: FETCHED_AT,
    source: ["service", "life"],
    limit: 1,
  });
  assert.equal(campusCard.length, 1);
  assert.equal(campusCard[0]?.sourceKey, "service");
  assert.equal(campusCard[0]?.title, "校园卡&学生证");
  assert.equal(campusCard[0]?.provenance.sourceUrl, onlineManualSiteUrl(SERVICE_SITE_PATH));
  assert.ok(campusCard[0]?.summary.includes("校园卡"));
  assert.deepEqual(
    campusCard[0]?.links.map((link) => link.url),
    [
      "https://sustech.online/service/campus-card",
      "https://sustech.online/service/student-train-ticket/",
    ],
  );

  const sakai = await searchOnlineManual("Sakai", {
    adapter,
    fetchedAt: FETCHED_AT,
    source: "service",
    limit: 1,
  });
  assert.equal(sakai[0]?.title, "Sakai");
  assert.deepEqual(sakai[0]?.links, [{ text: "Sakai | 文件分享", url: "https://sustech.online/service/sakai" }]);

  const dormitory = await searchOnlineManual("宿舍", {
    adapter,
    fetchedAt: FETCHED_AT,
    source: ["service", "life"],
    limit: 1,
  });
  assert.equal(dormitory.length, 1);
  assert.equal(dormitory[0]?.sourceKey, "life");
  assert.equal(dormitory[0]?.title, "住宿");
  assert.ok(dormitory[0]?.content.includes("宿舍"));

  const exact = await getOnlineManualRecord(dormitory[0]!.id, {
    adapter,
    fetchedAt: FETCHED_AT,
    source: ["service", "life"],
  });
  assert.equal(exact.title, "住宿");

  const ehall = await getOnlineManualRecord("Ehall", {
    adapter,
    fetchedAt: FETCHED_AT,
    source: "service",
  });
  assert.deepEqual(ehall.links, [{
    text: "SUSTech ehall | 成绩查询",
    url: "http://ehall.sustech.edu.cn/publicapp/sys/cjcxapp/index.do",
  }]);

  const benefits = await getOnlineManualRecord("教育邮箱福利", {
    adapter,
    fetchedAt: FETCHED_AT,
    source: "service",
  });
  assert.deepEqual(benefits.links, []);
});

test("manual list excludes non-allowlisted sections and keeps community provenance", async () => {
  const records = await listOnlineManualRecords({
    adapter: manualAdapter(),
    fetchedAt: FETCHED_AT,
    source: ["service", "life"],
  });
  const titles = records.map((record) => record.title);
  assert.ok(titles.includes("校园卡&学生证"));
  assert.ok(titles.includes("住宿"));
  assert.ok(!titles.includes("退税"));
  assert.ok(!titles.includes("餐饮"));
  assert.ok(!titles.includes("非官方Windows套件激活服务"));

  const campusCard = records.find((record) => record.title === "校园卡&学生证");
  assert.equal(campusCard?.pageRepoPath, SERVICE_REPO_PATH);
  assert.equal(campusCard?.pageUrl, onlineManualSiteUrl(SERVICE_SITE_PATH));
  assert.deepEqual(campusCard?.provenance.advisories, ["COMMUNITY_MAINTAINED"]);
});

test("manual corpus reports invalid and partial sources without fabricating records", async () => {
  const corpus = await loadOnlineManualCorpus({
    adapter: manualAdapter({ calendarMarkdown: CALENDAR_MARKDOWN }),
    fetchedAt: FETCHED_AT,
    source: ["service", "life", "calendar"],
  });
  assert.equal(corpus.records.some((record) => record.sourceKey === "calendar"), false);

  const calendarStatus = corpus.sourceStatuses.find((status) => status.sourceKey === "calendar");
  assert.equal(calendarStatus?.status, "invalid");
  assert.equal(calendarStatus?.recordCount, 0);
  assert.match(calendarStatus?.message ?? "", /No allowlisted manual sections/u);

  const lifeStatus = corpus.sourceStatuses.find((status) => status.sourceKey === "life");
  assert.equal(lifeStatus?.status, "ok");
  assert.ok(corpus.records.some((record) => record.sourceKey === "life"));
});

test("manual searches expose partial sources while unified manual search respects source filters", async () => {
  const adapter = manualAdapter({ calendarMarkdown: CALENDAR_MARKDOWN });
  const manual = await searchOnlineManualWithStatus("校园卡", {
    adapter,
    fetchedAt: FETCHED_AT,
    source: ["service", "calendar"],
  });
  assert.equal(manual.partial, true);
  assert.equal(manual.matchedTotal, 1);
  assert.equal(manual.records[0]?.title, "校园卡&学生证");
  assert.equal(manual.sourceStatuses.find((status) => status.sourceKey === "calendar")?.status, "invalid");

  const unified = await searchOnlineWithStatus("校园卡", {
    adapter,
    fetchedAt: FETCHED_AT,
    section: "manual",
    source: ["service"],
    limit: 2,
  });
  assert.equal(unified.partial, false);
  assert.equal(unified.manualMatchedTotal, 1);
  assert.equal(unified.hits[0]?.kind, "manual");
  assert.equal(unified.hits[0]?.title, "校园卡&学生证");
  assert.equal(unified.hits[0]?.url, "https://sustech.online/service/campus-card");
  assert.deepEqual(unified.manualSourceStatuses.map((status) => status.sourceKey), ["service"]);

  await assert.rejects(
    searchOnlineManual("校历", {
      adapter,
      fetchedAt: FETCHED_AT,
      source: "calendar",
    }),
    /No allowlisted SUSTech Online manual source/u,
  );
});

test("manual text output surfaces partial source status in list and detail modes", async () => {
  const adapter = manualAdapter({ calendarMarkdown: CALENDAR_MARKDOWN });
  const listed = await listOnlineManualRecords({
    adapter,
    fetchedAt: FETCHED_AT,
    source: "service",
    limit: 1,
  });
  const withStatus = await searchOnlineManualWithStatus("校园卡", {
    adapter,
    fetchedAt: FETCHED_AT,
    source: ["service", "calendar"],
    limit: 1,
  });
  const detailReport = await getOnlineManualRecord("校园卡&学生证", {
    adapter,
    fetchedAt: FETCHED_AT,
    source: ["service", "calendar"],
  });
  const listText = formatOnlineManualRecords(
    listed,
    "SUSTech Online manual",
    { partial: withStatus.partial, sourceStatuses: withStatus.sourceStatuses },
  );
  const detailText = formatOnlineManualRecord(detailReport, {
    partial: withStatus.partial,
    sourceStatuses: withStatus.sourceStatuses,
  });
  assert.match(listText, /Partial result: 1 manual source\(s\)/u);
  assert.match(detailText, /Partial result: 1 manual source\(s\)/u);
});

test("unscoped unified search keeps manual opt-in and preserves talk/contact behavior", async () => {
  const requested: string[] = [];
  const adapter: ServiceAdapter = {
    name: "unscoped-online-fixture",
    async fetch(input: string): Promise<Response> {
      requested.push(input);
      if (input === onlineRawUrl(ONLINE_TALKS_INDEX_REPO_PATH)) {
        return textResponse(`
# 讲座信息
## 2026-09-10 周四
- 10:00 - [Alice Professor：Quantum Widgets](2026-09-10T10-00-00_Alice.md)
`);
      }
      if (input === onlineSiteUrl(ONLINE_TALKS_INDEX_SITE_PATH)) return htmlResponse(UPDATED_AT);
      if (input === onlineRawUrl(ONLINE_CONTACT_REPO_PATH)) {
        return textResponse(`
# 黄页
## 电话与邮件
### 行政
- 党政办公室: 88010229
`);
      }
      if (input === onlineSiteUrl(ONLINE_CONTACT_SITE_PATH)) return htmlResponse(UPDATED_AT);
      throw new Error(`Unexpected fixture URL: ${input}`);
    },
  };

  const report = await searchOnlineWithStatus("党政办公室", { adapter, fetchedAt: FETCHED_AT });
  assert.deepEqual(report.hits.map((hit) => hit.kind), ["contact"]);
  assert.equal(report.partial, false);
  assert.deepEqual(report.manualSourceStatuses, []);
  assert.equal(requested.includes(onlineManualRawUrl(SERVICE_REPO_PATH)), false);
});

test("manual reads tolerate missing freshness HTML and mark it unknown", async () => {
  const records = await searchOnlineManual("校园卡", {
    adapter: manualAdapter({ failSiteFor: new Set(["service"]) }),
    fetchedAt: FETCHED_AT,
    source: "service",
  });
  assert.ok(records[0]?.provenance.advisories.includes("SOURCE_UPDATE_UNKNOWN"));
});

test("manual get fails closed on ambiguous exact titles but accepts deterministic ids and section paths", async () => {
  const duplicateServiceMarkdown = `
# 服务与技巧

## SID (Student ID) 相关

### 💳校园卡&学生证

- [校园卡](./campus-card)

## 软件授权

### 校园卡&学生证

- [备用校园卡说明](./campus-card-backup)
`;
  const adapter = manualAdapter({ serviceMarkdown: duplicateServiceMarkdown });

  await assert.rejects(
    getOnlineManualRecord("校园卡&学生证", {
      adapter,
      fetchedAt: FETCHED_AT,
      source: "service",
    }),
    hasCode("ONLINE_MANUAL_LOOKUP_AMBIGUOUS"),
  );

  const byPath = await getOnlineManualRecord("软件授权 / 校园卡&学生证", {
    adapter,
    fetchedAt: FETCHED_AT,
    source: "service",
  });
  assert.equal(byPath.sourceKey, "service");
  assert.equal(byPath.title, "校园卡&学生证");

  const byId = await getOnlineManualRecord(byPath.id, {
    adapter,
    fetchedAt: FETCHED_AT,
    source: "service",
  });
  assert.equal(byId.id, byPath.id);
  assert.equal(byId.sectionPath, "软件授权 / 校园卡&学生证");
});

test("manual list reports matchedTotal before limit truncation", async () => {
  const report = await listOnlineManualRecordsWithStatus({
    adapter: manualAdapter(),
    fetchedAt: FETCHED_AT,
    source: "service",
    limit: 2,
  });
  assert.equal(report.records.length, 2);
  assert.ok(report.matchedTotal > report.records.length);
});

test("manual allowlist rejects path escape and fetched-url escape", async () => {
  assert.throws(() => onlineManualRawUrl("docs/../secret.md"), hasCode("ONLINE_SOURCE_NOT_ALLOWED"));
  assert.throws(() => onlineManualSiteUrl("/service/../secret/"), hasCode("ONLINE_SOURCE_NOT_ALLOWED"));

  const escapedAdapter: ServiceAdapter = {
    name: "escaped-source",
    async fetch(input: string): Promise<Response> {
      if (input === onlineManualRawUrl(SERVICE_REPO_PATH)) {
        const response = textResponse(SERVICE_MARKDOWN);
        Object.defineProperty(response, "url", {
          value: "https://raw.githubusercontent.com/SUSTech-CRA/sustech-online-ng/master/docs/secret.md",
        });
        return response;
      }
      if (input === onlineManualSiteUrl(SERVICE_SITE_PATH)) return htmlResponse(UPDATED_AT);
      throw new Error(`Unexpected fixture URL: ${input}`);
    },
  };
  const corpus = await loadOnlineManualCorpus({
    adapter: escapedAdapter,
    fetchedAt: FETCHED_AT,
    source: "service",
  });
  assert.equal(corpus.records.length, 0);
  assert.equal(corpus.sourceStatuses[0]?.status, "error");
  assert.match(corpus.sourceStatuses[0]?.message ?? "", /allowlist target/u);
});

test("manual corpus bounds oversized sources as errors", async () => {
  const oversizedAdapter: ServiceAdapter = {
    name: "oversized-manual",
    async fetch(input: string): Promise<Response> {
      if (input === onlineManualRawUrl(SERVICE_REPO_PATH)) {
        return new Response(new Uint8Array(ONLINE_MAX_DOCUMENT_BYTES + 1), { status: 200 });
      }
      if (input === onlineManualSiteUrl(SERVICE_SITE_PATH)) return htmlResponse(UPDATED_AT);
      throw new Error(`Unexpected fixture URL: ${input}`);
    },
  };
  const corpus = await loadOnlineManualCorpus({
    adapter: oversizedAdapter,
    fetchedAt: FETCHED_AT,
    source: "service",
  });
  assert.equal(corpus.records.length, 0);
  assert.equal(corpus.sourceStatuses[0]?.status, "error");
  assert.match(corpus.sourceStatuses[0]?.message ?? "", /oversized document/u);
});

function manualAdapter(options: {
  calendarMarkdown?: string;
  failSiteFor?: ReadonlySet<string>;
  lifeMarkdown?: string;
  serviceMarkdown?: string;
} = {}): ServiceAdapter {
  return {
    name: "manual-fixture",
    async fetch(input: string): Promise<Response> {
      if (input === onlineManualRawUrl(SERVICE_REPO_PATH)) return textResponse(options.serviceMarkdown ?? SERVICE_MARKDOWN);
      if (input === onlineManualRawUrl(LIFE_REPO_PATH)) return textResponse(options.lifeMarkdown ?? LIFE_MARKDOWN);
      if (input === onlineManualRawUrl(CALENDAR_REPO_PATH)) return textResponse(options.calendarMarkdown ?? CALENDAR_MARKDOWN);
      if (input === onlineManualSiteUrl(SERVICE_SITE_PATH)) {
        if (options.failSiteFor?.has("service")) throw new Error("service metadata unavailable");
        return htmlResponse(UPDATED_AT);
      }
      if (input === onlineManualSiteUrl(LIFE_SITE_PATH)) {
        if (options.failSiteFor?.has("life")) throw new Error("life metadata unavailable");
        return htmlResponse(UPDATED_AT);
      }
      if (input === onlineManualSiteUrl(CALENDAR_SITE_PATH)) {
        if (options.failSiteFor?.has("calendar")) throw new Error("calendar metadata unavailable");
        return htmlResponse(UPDATED_AT);
      }
      throw new Error(`Unexpected fixture URL: ${input}`);
    },
  };
}

function textResponse(body: string, contentType = "text/markdown"): Response {
  return new Response(body, { status: 200, headers: { "content-type": contentType } });
}

function htmlResponse(updatedAt: string): Response {
  return textResponse(`<time datetime="${updatedAt}"></time>`, "text/html");
}

function hasCode(code: string): (error: unknown) => boolean {
  return (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}
