import assert from "node:assert/strict";
import test from "node:test";
import type { ServiceAdapter } from "../services/base.js";
import {
  ONLINE_CONTACT_REPO_PATH,
  ONLINE_CONTACT_SITE_PATH,
  getOnlineContact,
  onlineRawUrl,
  onlineSiteUrl,
  parseOnlineContactsMarkdown,
  searchOnlineContacts,
} from "../online/index.js";

const FETCHED_AT = "2026-09-01T00:00:00.000Z";
const UPDATED_AT = "2025-03-04T16:26:17.000Z";

const CONTACT_MARKDOWN = `
# 黄页

## 电话与邮件

**座机默认区号0755**

**24h 校内服务热线（物业热线，报修用，查号用）: 88010123**

**一般办公时间**
- 周一至周五
- 上午 8:30 - 12:00
- 下午 2:00 - 5:30

### 教学

- [教授邮件列表](./professor-emails)

- 学生事务中心
  - 南科大中心二楼
  - 电话：88010555
  - 公共邮箱：servicescenter@sustech.edu.cn
  - 本科生教学事务
    - 选课、退课、成绩单打印

- [教学工作部 | 联系方式](https://tao.sustech.edu.cn/department/index.html)
  - 办公地点: 南科大中心三楼 303
  - 公共邮箱（教学事务）: tao@sustech.edu.cn
  - 选课咨询电话: 88010300

### 物流、餐饮、康体、后勤

| 名称 | 地址 | 电话 | 工作时间 |
| --- | --- | --- | --- |
| 信息中心 | 行政楼一楼 | 88010777 | 8:30-17:30 |
| 餐饮服务中心 | | 88015026 | |

### 医疗与安全

- 24小时急诊联系电话: 18218715551
- 安保报警: 88010110

### 行政

- 党政办公室: 88010229

### 更多官方部门的联系方式

- [联系我们/南方科技大学](https://www.sustech.edu.cn/zh/contact_us.html)

- [伪造官方入口](https://sustech.edu.cn.evil.example/phishing)

## 报销抬头

> 开户银行：测试银行
> 银行账号：8110301013200000000

## 常用Q群

- 美食旅游：1094223907
`;

test("contact parser keeps only selected institutional records", () => {
  const records = parseOnlineContactsMarkdown(CONTACT_MARKDOWN, {
    fetchedAt: FETCHED_AT,
    sourceUpdatedAt: UPDATED_AT,
    sourceMetadataAvailable: true,
  });
  const names = records.map((record) => record.name);
  assert.ok(names.includes("24h 校内服务热线"));
  assert.ok(names.includes("学生事务中心"));
  assert.ok(names.includes("教学工作部"));
  assert.ok(names.includes("信息中心"));
  assert.ok(names.includes("党政办公室"));
  assert.ok(names.includes("联系我们/南方科技大学"));
  assert.ok(!names.includes("伪造官方入口"));
  assert.ok(!names.some((name) => /教授邮件|餐饮|急诊|安保|美食/u.test(name)));
  assert.equal(JSON.stringify(records).includes("8110301013200000000"), false);
  assert.equal(JSON.stringify(records).includes("1094223907"), false);

  const student = records.find((record) => record.name === "学生事务中心");
  assert.deepEqual(student?.phones, ["88010555"]);
  assert.deepEqual(student?.emails, ["servicescenter@sustech.edu.cn"]);
  assert.equal(student?.address, "南科大中心二楼");
  assert.deepEqual(student?.hours, ["周一至周五", "上午 8:30 - 12:00", "下午 2:00 - 5:30"]);
  assert.ok(student?.provenance.advisories.includes("STALE_SOURCE"));
  assert.equal(student?.provenance.advisories.includes("AI_PROCESSED_SOURCE"), false);
  assert.equal(student?.provenance.license, "CC-BY-SA-4.0");

  const teaching = records.find((record) => record.name === "教学工作部");
  assert.equal(teaching?.notes.some((note) => note.includes("tao@sustech.edu.cn")), false);
});

test("contact search ranks the full selected set before applying limit", async () => {
  const adapter = contactAdapter();
  const results = await searchOnlineContacts("信息中心", { adapter, fetchedAt: FETCHED_AT, limit: 1 });
  assert.deepEqual(results.map((record) => record.name), ["信息中心"]);

  const exact = await getOnlineContact(results[0].id, { adapter, fetchedAt: FETCHED_AT });
  assert.equal(exact.name, "信息中心");
  await assert.rejects(
    getOnlineContact("信息", { adapter, fetchedAt: FETCHED_AT }),
    hasCode("ONLINE_CONTACT_NOT_FOUND"),
  );
});

test("contact reads tolerate unavailable freshness HTML but mark it unknown", async () => {
  const records = await searchOnlineContacts("信息中心", {
    adapter: contactAdapter({ failSite: true }),
    fetchedAt: FETCHED_AT,
  });
  assert.ok(records[0].provenance.advisories.includes("SOURCE_UPDATE_UNKNOWN"));
});

function contactAdapter(options: { failSite?: boolean } = {}): ServiceAdapter {
  return {
    name: "contact-fixture",
    async fetch(input: string): Promise<Response> {
      if (input === onlineRawUrl(ONLINE_CONTACT_REPO_PATH)) return textResponse(CONTACT_MARKDOWN);
      if (input === onlineSiteUrl(ONLINE_CONTACT_SITE_PATH)) {
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
