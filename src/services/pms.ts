import { CliError } from "../core/errors.js";
import {
  arrayValue,
  fetchJson,
  numberValue,
  recordValue,
  requestUrl,
  stringValue,
} from "./base.js";
import type { ServiceAdapter, ServiceStatus } from "./base.js";

export const PMS_BASE = "https://pms.sustech.edu.cn";
export const PMS_API = `${PMS_BASE}/api`;

export const PMS_STATUS: ServiceStatus = {
  service: "pms",
  availability: "implemented",
  auth: "cookie-session",
  campusNetwork: true,
  browser: false,
  summary: "The CLI performs the PMS token, public-key, RSA login flow and exposes read-only printer and queue APIs.",
  notes: [
    "The OSESSIONID cookie and encrypted login material remain in memory and are never returned in command output.",
    "A live smoke attempt on 2026-08-26 reached the campus-network gate before login; the auth flow remains protocol-fixture verified.",
    "This adapter layer only covers read paths.",
    "Upload and delete endpoints are intentionally excluded.",
  ],
  endpoints: [
    "/api/client/Auth/GetAuthToken",
    "/api/client/Auth/PublicKey",
    "/api/client/Auth/Login",
    "/api/client/Auth/Check",
    "/api/client/Station/GetSrvList",
    "/api/client/Station/GetList",
    "/api/client/PrintJob/Get",
    "/api/client/Scan/Get",
    "/api/client/Report/DetailPage",
  ],
};

export interface PmsServerGroup {
  serverGroup: number;
  name: string;
}

export interface PmsStation {
  deviceSn: number;
  name: string;
  statusText: string;
  state: "idle" | "busy" | "fault" | "closed";
  papers: string[];
  canPrint: boolean;
  canCopy: boolean;
  canScan: boolean;
  canColor: boolean;
  serverGroup: number;
}

export interface PmsPrintJob {
  jobId: number;
  fileName: string;
  createdAt: string;
  copies: number;
  paper: string;
  totalPages: number;
  color: boolean;
  duplexLabel: string;
}

export interface PmsScanJob {
  jobId: number;
  fileName: string;
  fileSize: number;
  submittedAt: string;
}

export interface PmsUsageRecord {
  id: number;
  occurredAt: string;
  pages: number;
  paper: string;
  totalCost: number;
  deviceSn: number;
  memo: string;
}

export async function listPmsServerGroups(adapter: ServiceAdapter): Promise<PmsServerGroup[]> {
  const data = unwrapPms(await fetchJson<unknown>(adapter, requestUrl(PMS_BASE, "/api/client/Station/GetSrvList")));
  return arrayValue(data).map((item) => normalisePmsServerGroup(item));
}

export async function listPmsStations(adapter: ServiceAdapter, serverGroup?: number): Promise<PmsStation[]> {
  const data = unwrapPms(await fetchJson<unknown>(adapter, requestUrl(PMS_BASE, "/api/client/Station/GetList", { timestamp: 0 })));
  const stations = arrayValue(data).map((item) => normalisePmsStation(item));
  return serverGroup === undefined ? stations : stations.filter((station) => station.serverGroup === serverGroup);
}

export async function listPmsPrintJobs(adapter: ServiceAdapter): Promise<PmsPrintJob[]> {
  const data = unwrapPms(await fetchJson<unknown>(adapter, requestUrl(PMS_BASE, "/api/client/PrintJob/Get", { timestamp: 0 })));
  return arrayValue(data).map((item) => normalisePmsPrintJob(item));
}

export async function listPmsScanJobs(adapter: ServiceAdapter): Promise<PmsScanJob[]> {
  const data = unwrapPms(await fetchJson<unknown>(adapter, requestUrl(PMS_BASE, "/api/client/Scan/Get", { timestamp: 0 })));
  return arrayValue(data).map((item) => normalisePmsScanJob(item));
}

export async function listPmsUsageHistory(
  adapter: ServiceAdapter,
  options: { begin: string; end: string; type?: number; page?: number; pageSize?: number },
): Promise<{ records: PmsUsageRecord[]; totalPages: number }> {
  const response = await fetchJson<unknown>(adapter, requestUrl(PMS_BASE, "/api/client/Report/DetailPage"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      dwBeginDate: normalisePmsDate(options.begin),
      dwEndDate: normalisePmsDate(options.end),
      dwType: options.type ?? 1,
      dwPageNo: options.page ?? 1,
      dwRowCount: options.pageSize ?? 5,
    }),
  });
  const record = recordValue(response);
  if (numberValue(record.code, -1) !== 0) {
    throw pmsUpstreamError(record);
  }
  return {
    records: arrayValue(record.result).map((item) => normalisePmsUsageRecord(item)),
    totalPages: numberValue(record.dwTotalPage, 1),
  };
}

export function normalisePmsServerGroup(raw: unknown): PmsServerGroup {
  const record = recordValue(raw);
  return {
    serverGroup: numberValue(record.dwSN),
    name: stringValue(record.szName),
  };
}

export function normalisePmsStation(raw: unknown): PmsStation {
  const record = recordValue(raw);
  const status = numberValue(record.dwStatus);
  const paperCodes = [record.dwTrayPaper1, record.dwTrayPaper2, record.dwTrayPaper3, record.dwTrayPaper4]
    .map((value) => paperName(numberValue(value, -1)))
    .filter(Boolean);
  return {
    deviceSn: numberValue(record.dwDevSN),
    name: stringValue(record.szName),
    statusText: derivePmsStateText(status, stringValue(record.szStatInfo)),
    state: derivePmsState(status),
    papers: [...new Set(paperCodes)],
    canPrint: Boolean(numberValue(record.dwProperty) & 1),
    canCopy: Boolean(numberValue(record.dwProperty) & 2),
    canScan: Boolean(numberValue(record.dwProperty) & 4),
    canColor: Boolean(numberValue(record.dwProperty) & 8),
    serverGroup: Math.trunc(numberValue(record.dwDevSN) / 1000),
  };
}

export function normalisePmsPrintJob(raw: unknown): PmsPrintJob {
  const record = recordValue(raw);
  const details = parsePmsPaperDetail(record.szPaperDetail);
  const first = recordValue(details[0]);
  const attribe = stringValue(record.szAttribe);
  return {
    jobId: numberValue(record.dwJobId),
    fileName: stringValue(record.szJobName),
    createdAt: combinePmsDateTime(numberValue(record.dwCreateDate), numberValue(record.dwCreateTime)),
    copies: numberValue(record.dwCopies, 1),
    paper: paperName(numberValue(first.dwPaperID, -1)),
    totalPages: numberValue(first.dwBWPages) + numberValue(first.dwColorPages),
    color: attribe.includes("color"),
    duplexLabel: attribe.includes("vdup") ? "双面长边" : attribe.includes("hdup") ? "双面短边" : "单面",
  };
}

export function normalisePmsScanJob(raw: unknown): PmsScanJob {
  const record = recordValue(raw);
  return {
    jobId: numberValue(record.dwJobId),
    fileName: stringValue(record.szDisplayName),
    fileSize: numberValue(record.dwFileSize),
    submittedAt: combinePmsDateTime(numberValue(record.dwSubmitDate), numberValue(record.dwSubmitTime)),
  };
}

export function normalisePmsUsageRecord(raw: unknown): PmsUsageRecord {
  const record = recordValue(raw);
  return {
    id: numberValue(record.dwSID),
    occurredAt: combinePmsDateTime(numberValue(record.dwDate), numberValue(record.dwTime)),
    pages: numberValue(record.dwPages),
    paper: paperName(numberValue(record.dwPaperID ?? record.dwPaperId, -1)),
    totalCost: (numberValue(record.dwUsedCardMoney) + numberValue(record.dwUsedFreeMoney) + numberValue(record.dwUsedMoney)) / 100,
    deviceSn: numberValue(record.dwMFPSN),
    memo: stringValue(record.szMemo),
  };
}

function unwrapPms(raw: unknown): unknown {
  const record = recordValue(raw);
  if (numberValue(record.code, -1) !== 0) {
    throw pmsUpstreamError(record);
  }
  return record.result;
}

function pmsUpstreamError(record: Record<string, unknown>): CliError {
  return new CliError("PMS returned an application error.", "SERVICE_UPSTREAM_ERROR", 1, {
    service: "pms",
    code: numberValue(record.code, -1),
    message: stringValue(record.message) || "unknown error",
  });
}

function parsePmsPaperDetail(raw: unknown): unknown[] {
  const text = stringValue(raw);
  if (!text) return [];
  try {
    return JSON.parse(text) as unknown[];
  } catch {
    return [];
  }
}

function paperName(code: number): string {
  if (code === 9) return "A4";
  if (code === 8) return "A3";
  return "";
}

function derivePmsState(status: number): PmsStation["state"] {
  if (status === 0) return "closed";
  if (status & 1) return "idle";
  if (status & 2) return "busy";
  return "fault";
}

function derivePmsStateText(status: number, rawInfo: string): string {
  if (status === 0) return "未开放";
  if (status & 1) return "空闲";
  if (status & 2) return "忙碌";
  return rawInfo.split("-", 1)[0] || "不可用";
}

function combinePmsDateTime(rawDate: number, rawTime: number): string {
  if (!rawDate) return "";
  const date = String(rawDate).padStart(8, "0");
  const time = String(rawTime).padStart(6, "0");
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}`;
}

function normalisePmsDate(value: string): string {
  return value.replaceAll("-", "").replaceAll(".", "");
}
