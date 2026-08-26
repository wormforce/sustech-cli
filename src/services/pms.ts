import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, resolve as resolvePath } from "node:path";
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
  summary: "The CLI performs the PMS token, public-key, RSA login flow, reads printer and queue state, and applies guarded print-queue upload/delete mutations.",
  notes: [
    "The OSESSIONID cookie and encrypted login material remain in memory and are never returned in command output.",
    "A live smoke attempt on 2026-08-26 reached the campus-network gate before login; the auth flow remains protocol-fixture verified.",
    "Generic PMS fetch access remains fail-closed and read-only; write endpoints are exposed only through typed allowlisted methods.",
    "Cloud-print upload uses preview/apply, requires --confirm, and binds apply to the previewed SHA-256 digest.",
    "Print-job deletion uses preview/apply with exact job-id revalidation before the write.",
    "Scan-job download is not implemented because the current source evidence does not expose a documented download endpoint.",
  ],
  endpoints: [
    "/api/client/Auth/GetAuthToken",
    "/api/client/Auth/PublicKey",
    "/api/client/Auth/Login",
    "/api/client/Auth/Check",
    "/api/client/Station/GetSrvList",
    "/api/client/Station/GetList",
    "/api/client/CloudPrint/Upload",
    "/api/client/PrintJob/Get",
    "/api/client/PrintJob/Del",
    "/api/client/Scan/Get",
    "/api/client/Report/DetailPage",
  ],
};

export const PMS_COLOR_BW = 1;
export const PMS_COLOR_COLOR = 2;
export const PMS_PAPER_UNSPECIFIED = -1;
export const PMS_PAPER_A3 = 8;
export const PMS_PAPER_A4 = 9;
export const PMS_DUPLEX_SINGLE = 1;
export const PMS_DUPLEX_SHORT_EDGE = 2;
export const PMS_DUPLEX_LONG_EDGE = 3;

export type PmsPrintColor = "bw" | "color";
export type PmsPaper = "unspecified" | "A3" | "A4";
export type PmsDuplex = "single" | "short" | "long";

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

export interface PmsUploadFile {
  path: string;
  absolutePath: string;
  name: string;
  size: number;
  sha256: string;
}

export interface PmsPrintUploadOptions {
  color: PmsPrintColor;
  colorCode: typeof PMS_COLOR_BW | typeof PMS_COLOR_COLOR;
  paper: PmsPaper;
  paperCode: typeof PMS_PAPER_UNSPECIFIED | typeof PMS_PAPER_A3 | typeof PMS_PAPER_A4;
  duplex: PmsDuplex;
  duplexCode: typeof PMS_DUPLEX_SINGLE | typeof PMS_DUPLEX_SHORT_EDGE | typeof PMS_DUPLEX_LONG_EDGE;
  pageFrom: number;
  pageTo: number;
  copies: number;
}

export interface PmsMutationWarning {
  code: string;
  message: string;
}

export interface PmsMutationVerification {
  status: "confirmed" | "not_observed" | "unavailable" | "ambiguous";
  message: string;
  observedJobIds: number[];
}

export interface PmsPrintUploadPreview {
  checkedAt: string;
  existingJobs: readonly Pick<PmsPrintJob, "jobId" | "fileName" | "createdAt">[];
  file: PmsUploadFile;
  options: PmsPrintUploadOptions;
  warnings: readonly PmsMutationWarning[];
  applyAllowed: boolean;
  confirmation: {
    required: true;
    available: boolean;
    expectedSha256: string;
    argv?: string[];
    command?: string;
  };
}

export interface PmsPrintDeletePreview {
  checkedAt: string;
  totalJobs: number;
  job: PmsPrintJob;
  confirmation: {
    required: true;
    available: boolean;
    argv?: string[];
    command?: string;
  };
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

export async function inspectPmsUploadFile(path: string): Promise<PmsUploadFile> {
  return (await readPmsUploadPayload(path)).file;
}

export async function readPmsUploadPayload(path: string): Promise<{ file: PmsUploadFile; bytes: Uint8Array }> {
  const absolutePath = resolvePath(path);
  let info;
  let buffer: Buffer;
  try {
    info = await stat(absolutePath);
    buffer = await readFile(absolutePath);
  } catch (error) {
    throw new CliError(
      "The PMS upload file could not be read.",
      "PMS_UPLOAD_FILE_NOT_READABLE",
      2,
      {
        file: absolutePath,
        cause: error instanceof Error ? error.message : String(error),
      },
    );
  }
  if (!info.isFile()) {
    throw new CliError(
      "The PMS upload target must be a regular file.",
      "PMS_UPLOAD_FILE_NOT_REGULAR",
      2,
      { file: absolutePath },
    );
  }
  if (buffer.byteLength === 0) {
    throw new CliError(
      "The PMS upload file is empty.",
      "PMS_UPLOAD_FILE_EMPTY",
      2,
      { file: absolutePath },
    );
  }
  return {
    file: {
      path,
      absolutePath,
      name: basename(absolutePath),
      size: buffer.byteLength,
      sha256: createHash("sha256").update(buffer).digest("hex"),
    },
    bytes: buffer,
  };
}

export function buildPmsPrintUploadPreview(
  jobs: readonly PmsPrintJob[],
  file: PmsUploadFile,
  options: PmsPrintUploadOptions,
  confirmation: PmsPrintUploadPreview["confirmation"],
  now: Date = new Date(),
): PmsPrintUploadPreview {
  const warnings: PmsMutationWarning[] = [];
  const duplicateNames = jobs.filter((job) => job.fileName === file.name);
  if (duplicateNames.length > 0) {
    warnings.push({
      code: "DUPLICATE_FILENAME",
      message: `The current queue already contains ${duplicateNames.length} job(s) named ${file.name}; verify the intended file before adding another copy.`,
    });
  }
  return {
    checkedAt: now.toISOString(),
    existingJobs: jobs.map((job) => ({
      jobId: job.jobId,
      fileName: job.fileName,
      createdAt: job.createdAt,
    })),
    file,
    options,
    warnings,
    applyAllowed: true,
    confirmation,
  };
}

export function findPmsPrintJob(jobs: readonly PmsPrintJob[], jobId: number): PmsPrintJob | undefined {
  return jobs.find((job) => job.jobId === jobId);
}

export function buildPmsPrintDeletePreview(
  jobs: readonly PmsPrintJob[],
  job: PmsPrintJob,
  confirmation: PmsPrintDeletePreview["confirmation"],
  now: Date = new Date(),
): PmsPrintDeletePreview {
  return {
    checkedAt: now.toISOString(),
    totalJobs: jobs.length,
    job,
    confirmation,
  };
}

export function verifyPmsPrintUpload(
  previousJobs: readonly PmsPrintJob[],
  currentJobs: readonly PmsPrintJob[],
  file: Pick<PmsUploadFile, "name">,
  options: PmsPrintUploadOptions,
): PmsMutationVerification {
  const previousIds = new Set(previousJobs.map((job) => job.jobId));
  const candidates = currentJobs.filter((job) => !previousIds.has(job.jobId) && matchesUploadedPrintJob(job, file.name, options));
  if (candidates.length === 1) {
    return {
      status: "confirmed",
      message: "A new print-queue entry with the expected filename and options was read back from PMS.",
      observedJobIds: [candidates[0].jobId],
    };
  }
  if (candidates.length > 1) {
    return {
      status: "ambiguous",
      message: "Multiple new print-queue entries matched the requested file/options, so the upload could not be confirmed uniquely.",
      observedJobIds: candidates.map((job) => job.jobId),
    };
  }
  return {
    status: "not_observed",
    message: "PMS accepted the upload request, but no uniquely matching new print job was observed in the read-back queue state.",
    observedJobIds: [],
  };
}

export function verifyPmsPrintDeletion(
  currentJobs: readonly PmsPrintJob[],
  deletedJobId: number,
): PmsMutationVerification {
  const stillPresent = currentJobs.some((job) => job.jobId === deletedJobId);
  if (!stillPresent) {
    return {
      status: "confirmed",
      message: "The exact print job was absent from the read-back queue state.",
      observedJobIds: [],
    };
  }
  return {
    status: "not_observed",
    message: "The exact print job still appeared in the read-back queue state.",
    observedJobIds: [deletedJobId],
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

export function pmsUpstreamError(record: Record<string, unknown>): CliError {
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

export function pmsPaperName(code: number): string {
  if (code === PMS_PAPER_A4) return "A4";
  if (code === PMS_PAPER_A3) return "A3";
  return "";
}

export function pmsDuplexLabel(code: number): string {
  if (code === PMS_DUPLEX_LONG_EDGE) return "双面长边";
  if (code === PMS_DUPLEX_SHORT_EDGE) return "双面短边";
  return "单面";
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

function paperName(code: number): string {
  return pmsPaperName(code);
}

function matchesUploadedPrintJob(
  job: PmsPrintJob,
  expectedFileName: string,
  options: PmsPrintUploadOptions,
): boolean {
  if (job.fileName !== expectedFileName) return false;
  if (job.copies !== options.copies) return false;
  if (job.color !== (options.colorCode === PMS_COLOR_COLOR)) return false;
  if (job.duplexLabel !== pmsDuplexLabel(options.duplexCode)) return false;
  if (options.paperCode !== PMS_PAPER_UNSPECIFIED && job.paper !== pmsPaperName(options.paperCode)) return false;
  return true;
}
