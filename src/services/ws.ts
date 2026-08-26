import {
  arrayValue,
  cleanText,
  fetchJson,
  fetchText,
  numberValue,
  recordValue,
  requestUrl,
  stringValue,
} from "./base.js";
import type { ServiceAdapter, ServiceStatus } from "./base.js";

export const WS_BASE = "https://ws.sustech.edu.cn";

export const WS_STATUS: ServiceStatus = {
  service: "ws",
  availability: "adapter_required",
  auth: "cookie-session",
  campusNetwork: false,
  browser: false,
  summary: "SUSTech Global exchange-program APIs are queryable with an authenticated WS CAS session.",
  notes: [
    "The adapter must already hold WS cookies.",
    "The menu endpoint is used to derive the per-session userToken and ts parameters.",
  ],
  endpoints: [
    "/Main/GetSmartLeftMenuTData.do",
    "/StudentExchange_2247/GetShortProjectListForStudent.do",
    "/StudentExchange_2247/GetShortProjectListCountForStudent.do",
    "/StudentExchange_2247/ProjectDetail2247.do",
  ],
};

export interface WsToken {
  userToken: string;
  ts: string;
}

export interface WsProgramSummary {
  id: string;
  code: string;
  name: string;
  nameEn: string;
  regionName: string;
  schoolName: string;
  projectType: string;
  applyBeginDate: string;
  applyEndDate: string;
  applyRange: string;
  status: string;
  appliable: boolean;
  token: string;
}

export interface WsProgramDetail {
  sections: Record<string, Record<string, string>>;
  tables: string[][][];
  token: string;
  rawLength: number;
}

export async function getWsToken(adapter: ServiceAdapter): Promise<WsToken> {
  const text = await fetchText(adapter, requestUrl(WS_BASE, "/Main/GetSmartLeftMenuTData.do"));
  const raw = JSON.parse(text) as unknown;
  return extractWsToken(raw);
}

export async function listWsPrograms(
  adapter: ServiceAdapter,
  token: WsToken,
  options: {
    page?: number;
    pageSize?: number;
    yearCode?: string;
    regionCode?: string;
    projectType?: number;
    keywords?: string;
  } = {},
): Promise<{ total: number; page: number; pageSize: number; programs: WsProgramSummary[] }> {
  const url = requestUrl(WS_BASE, "/StudentExchange_2247/GetShortProjectListForStudent.do", {
    pageSize: options.pageSize ?? 10,
    currentPageIndex: options.page ?? 1,
    ts: token.ts,
    userToken: token.userToken,
    ...(options.yearCode ? { YearCode: options.yearCode } : {}),
    ...(options.regionCode ? { RegionCode: options.regionCode } : {}),
    ...(options.projectType ? { ProjectType: options.projectType } : {}),
    ...(options.keywords ? { KeyWords: options.keywords } : {}),
  });
  const raw = await fetchJson<unknown>(adapter, url);
  const record = recordValue(raw);
  return {
    total: numberValue(record.RecordCount),
    page: numberValue(record.CurrentPageIndex, options.page ?? 1),
    pageSize: numberValue(record.PageSize, options.pageSize ?? 10),
    programs: arrayValue(record.DataList).map((item) => normaliseWsProgram(item)),
  };
}

export async function countWsPrograms(
  adapter: ServiceAdapter,
  token: WsToken,
  options: {
    yearCode?: string;
    regionCode?: string;
    projectType?: number;
    keywords?: string;
  } = {},
): Promise<number> {
  const url = requestUrl(WS_BASE, "/StudentExchange_2247/GetShortProjectListCountForStudent.do", {
    ts: token.ts,
    userToken: token.userToken,
    ...(options.yearCode ? { YearCode: options.yearCode } : {}),
    ...(options.regionCode ? { RegionCode: options.regionCode } : {}),
    ...(options.projectType ? { ProjectType: options.projectType } : {}),
    ...(options.keywords ? { KeyWords: options.keywords } : {}),
  });
  const raw = await fetchJson<unknown>(adapter, url);
  return numberValue(recordValue(raw).RecordCount);
}

export async function getWsProgramDetail(
  adapter: ServiceAdapter,
  token: WsToken,
  request: { id: number | string; code?: string; programToken?: string },
): Promise<WsProgramDetail> {
  const url = requestUrl(WS_BASE, "/StudentExchange_2247/ProjectDetail2247.do", {
    ID: request.id,
    ts: token.ts,
    userToken: token.userToken,
    ...(request.code ? { Code: request.code } : {}),
    ...(request.programToken ? { token: request.programToken } : {}),
  });
  const html = await fetchText(adapter, url);
  const parsed = parseWsDetailHtml(html);
  return {
    ...parsed,
    token: request.programToken ?? "",
  };
}

export function extractWsToken(raw: unknown): WsToken {
  const entries = arrayValue(raw);
  const firstEntry = recordValue(entries[0]);
  const firstFunction = recordValue(arrayValue(firstEntry.FunctionList)[0]);
  const firstPage = recordValue(arrayValue(firstFunction.Pages)[0]);
  const pageUrl = stringValue(firstPage.PageUrl);
  const userToken = /userToken=([A-F0-9]+)/i.exec(pageUrl)?.[1] ?? "";
  const ts = /ts=(\d+)/.exec(pageUrl)?.[1] ?? "891";
  return { userToken, ts };
}

export function normaliseWsProgram(raw: unknown): WsProgramSummary {
  const record = recordValue(raw);
  return {
    id: stringValue(record.ID),
    code: stringValue(record.Code),
    name: cleanText(record.Name),
    nameEn: cleanText(record.NameEn),
    regionName: cleanText(record.RegionName),
    schoolName: cleanText(record.ProjectSchoolName ?? record.ProjectAgencyName),
    projectType: cleanText(record.ProjectTypeText),
    applyBeginDate: parseWsDate(record.ApplyBeginDate) ?? stringValue(record.ApplyBeginDateText),
    applyEndDate: parseWsDate(record.ApplyEndDate) ?? stringValue(record.ApplyEndDateText),
    applyRange: cleanText(record.ApplyRangeText),
    status: cleanText(record.StudentExchangeProjectStatusIDText ?? record.IsValidTextByEndDate),
    appliable: Boolean(record.IsAppliable),
    token: stringValue(record.TokenKey),
  };
}

export function parseWsDetailHtml(html: string): Omit<WsProgramDetail, "token"> {
  const sections: Record<string, Record<string, string>> = {};
  const blocks = html.split(/<h4[^>]*class="sub-title"[^>]*>/i);
  for (const block of blocks.slice(1)) {
    const [titleHtml = "", bodyHtml = ""] = block.split(/<\/h4>\s*<blockquote[^>]*>/i, 2);
    const section = cleanText(titleHtml) || "基本信息";
    const pairs: Record<string, string> = {};
    let pendingKey = "";
    for (const row of matchAllWithin(bodyHtml, /<p class="p">(.*?)<\/p>/gis)) {
      const raw = row[1];
      const strong = /<strong[^>]*>(.*?)<\/strong>/is.exec(raw);
      if (strong) {
        const label = cleanText(strong[1]).replace(/：$/, "");
        const rest = cleanText(raw.slice(strong.index + strong[0].length));
        if (rest) pairs[label] = rest;
        else pendingKey = label;
        continue;
      }
      if (pendingKey) {
        const value = cleanText(raw);
        if (value) pairs[pendingKey] = value;
        pendingKey = "";
      }
    }
    if (Object.keys(pairs).length > 0) sections[section] = pairs;
  }

  const tables: string[][][] = [];
  for (const table of matchAllWithin(html, /<table[^>]*>(.*?)<\/table>/gis)) {
    const rows: string[][] = [];
    for (const row of matchAllWithin(table[1], /<tr[^>]*>(.*?)<\/tr>/gis)) {
      const cells = matchAllWithin(row[1], /<td[^>]*>(.*?)<\/td>/gis)
        .map((match) => cleanText(match[1]))
        .filter((cell) => cell && !cell.startsWith("{{"));
      if (cells.length > 0) rows.push(cells);
    }
    if (rows.length > 0) tables.push(rows);
  }

  return { sections, tables, rawLength: html.length };
}

export function parseWsDate(raw: unknown): string | null {
  const value = stringValue(raw);
  const match = /\/Date\((-?\d+)\)\//.exec(value);
  if (!match) return null;
  const millis = Number(match[1]);
  if (!Number.isFinite(millis) || millis < 0) return null;
  const date = new Date(millis);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function matchAllWithin(value: string, regexp: RegExp): RegExpMatchArray[] {
  return [...value.matchAll(regexp)];
}
