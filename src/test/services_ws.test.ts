import assert from "node:assert/strict";
import test from "node:test";
import { countWsPrograms, extractWsToken, getWsProgramDetail, listWsPrograms, parseWsDate, parseWsDetailHtml } from "../services/ws.js";
import type { ServiceAdapter } from "../services/base.js";

test("WS token extraction, list normalization, and HTML detail parsing follow the upstream endpoints", async () => {
  const token = extractWsToken([{
    FunctionList: [{
      Pages: [{
        PageUrl: "/StudentExchange_2247/ProjectDetail2247.do?userToken=ABCDEF1234&ts=891",
      }],
    }],
  }]);
  assert.deepEqual(token, { userToken: "ABCDEF1234", ts: "891" });
  assert.equal(parseWsDate("/Date(1787702400000)/"), "2026-08-26");

  const adapter = routeAdapter((url) => {
    if (url.startsWith("https://ws.sustech.edu.cn/StudentExchange_2247/GetShortProjectListForStudent.do?")) {
      return jsonResponse({
        RecordCount: 1,
        CurrentPageIndex: 1,
        PageSize: 10,
        DataList: [{
          ID: 12,
          Code: "WS2026-001",
          Name: "MIT Exchange &nbsp;Program",
          NameEn: "MIT Exchange Program",
          RegionName: "North America",
          ProjectSchoolName: "MIT",
          ProjectTypeText: "Exchange",
          ApplyBeginDate: "/Date(1787616000000)/",
          ApplyEndDate: "/Date(1788307200000)/",
          ApplyRangeText: "本科生",
          StudentExchangeProjectStatusIDText: "开放申请",
          IsAppliable: true,
          TokenKey: "DETAILTOKEN",
        }],
      });
    }
    if (url.startsWith("https://ws.sustech.edu.cn/StudentExchange_2247/GetShortProjectListCountForStudent.do?")) {
      return jsonResponse({ RecordCount: 1 });
    }
    if (url.startsWith("https://ws.sustech.edu.cn/StudentExchange_2247/ProjectDetail2247.do?")) {
      return textResponse(`
        <h4 class="sub-title">基本信息</h4>
        <blockquote>
          <p class="p"><strong>项目名称：&nbsp;&nbsp;</strong>MIT Exchange Program</p>
          <p class="p"><strong>申请要求：&nbsp;&nbsp;</strong></p>
          <p class="p">GPA 3.5+</p>
        </blockquote>
        <table>
          <tr><td>学期</td><td>名额</td></tr>
          <tr><td>2026 秋</td><td>2</td></tr>
        </table>
      `);
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  const list = await listWsPrograms(adapter, token, { keywords: "MIT" });
  assert.equal(list.total, 1);
  assert.deepEqual(list.programs[0], {
    id: "12",
    code: "WS2026-001",
    name: "MIT Exchange Program",
    nameEn: "MIT Exchange Program",
    regionName: "North America",
    schoolName: "MIT",
    projectType: "Exchange",
    applyBeginDate: "2026-08-25",
    applyEndDate: "2026-09-02",
    applyRange: "本科生",
    status: "开放申请",
    appliable: true,
    token: "DETAILTOKEN",
  });

  const count = await countWsPrograms(adapter, token, { keywords: "MIT" });
  assert.equal(count, 1);

  const detail = await getWsProgramDetail(adapter, token, { id: 12, code: "WS2026-001", programToken: "DETAILTOKEN" });
  assert.equal(detail.sections["基本信息"]?.["项目名称"], "MIT Exchange Program");
  assert.equal(detail.sections["基本信息"]?.["申请要求"], "GPA 3.5+");
  assert.deepEqual(detail.tables, [[["学期", "名额"], ["2026 秋", "2"]]]);
  assert.equal(detail.token, "DETAILTOKEN");

  const parsed = parseWsDetailHtml(`
    <h4 class="sub-title">项目介绍</h4>
    <blockquote><p class="p"><strong>地点：&nbsp;&nbsp;</strong>Boston</p></blockquote>
  `);
  assert.equal(parsed.sections["项目介绍"]?.["地点"], "Boston");
});

function routeAdapter(route: (url: string, init?: RequestInit) => Response | Promise<Response>): ServiceAdapter {
  return {
    name: "fixture",
    fetch(input: string, init?: RequestInit): Promise<Response> {
      return Promise.resolve(route(String(input), init));
    },
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function textResponse(value: string, status = 200): Response {
  return new Response(value, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
