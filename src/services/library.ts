import { CliError } from "../core/errors.js";
import {
  arrayValue,
  booleanValue,
  cleanText,
  dateString,
  fetchJson,
  numberValue,
  recordValue,
  requestUrl,
  stringValue,
} from "./base.js";
import type { ServiceAdapter, ServiceStatus } from "./base.js";

export const LIBRARY_BASE = "https://lib.sustech.edu.cn";
export const LIBRARY_PRIMO_BASE = "https://sustc-primo.hosted.exlibrisgroup.com.cn/primo-explore";
export const LIBRARY_BOOKING_BASE = "https://booking.lib.sustech.edu.cn";
export const LIBRARY_BOOKING_API = `${LIBRARY_BOOKING_BASE}/ic-web`;

export const LIBRARY_CATALOG_STATUS: ServiceStatus = {
  service: "library-catalog",
  availability: "unavailable",
  auth: "browser",
  campusNetwork: true,
  browser: true,
  summary: "Primo catalog search currently depends on a browser session and legacy TLS handling.",
  notes: [
    "The upstream Python implementation renders the SPA in Chromium because the direct Primo host negotiates legacy SSL poorly.",
    "This TypeScript layer only preserves stable URL builders and normalized result shapes.",
  ],
  endpoints: [
    "/primo-explore/search",
    "/primo-explore/fulldisplay",
  ],
};

export const LIBRARY_BOOKING_STATUS: ServiceStatus = {
  service: "library-booking",
  availability: "implemented",
  auth: "cookie-session",
  campusNetwork: true,
  browser: false,
  summary: "The CLI resolves the dynamic authcenter service URL, completes CAS, and exposes read-only IC booking APIs.",
  notes: [
    "The IC booking cookie remains in memory and is never returned in command output.",
    "Identity, idle-summary, lab, and reservation-count reads completed an opt-in live smoke test on 2026-08-26.",
    "Reservation creation and cancellation are intentionally excluded here.",
  ],
  endpoints: [
    "/ic-web/auth/address",
    "/authcenter/toLoginPage",
    "/authcenter/doAuth/{relayId}",
    "/ic-web/auth/userInfo",
    "/ic-web/home/page/room/idle",
    "/ic-web/lab/devKindLabs",
    "/ic-web/roomDevice/roomInfos",
    "/ic-web/reserve/count",
    "/ic-web/reserve/resvInfo",
  ],
};

export interface PrimoSearchOptions {
  query?: string;
  queries?: ReadonlyArray<readonly [field: string, operator: string, value: string]>;
  scope?: "catalog" | "eresource" | "default";
  materialTypes?: readonly string[];
  libraries?: readonly string[];
  languages?: readonly string[];
  peerReviewed?: boolean;
  fullTextOnline?: boolean;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
  sortBy?: "relevance" | "date" | "title" | "author";
  lang?: string;
  mode?: "basic" | "advanced";
  displayMode?: "full" | "brief";
}

export interface PrimoSearchResult {
  rank: number;
  title: string;
  format: string;
  detailUrl: string;
  docId: string;
  fullText: boolean;
  peerReviewed: boolean;
  snippet: string;
}

export interface LibraryBookingUser {
  accNo: number;
  pid: string;
  logonName: string;
  trueName: string;
  className: string;
  deptName: string;
}

export interface LibraryIdleCategory {
  name: string;
  idleQuantity: number;
  totalQuantity: number;
}

export interface LibraryLab {
  labId: number;
  labName: string;
}

export interface LibraryRoom {
  devId: number;
  devName: string;
  minReservationMinutes: number;
  openTimes: Array<{ start: string; end: string; limit: number }>;
  reserved: boolean;
}

export interface LibraryCampusGroup {
  campusId: number;
  campusName: string;
  labs: Array<{ labId: number; labName: string; rooms: LibraryRoom[] }>;
}

export interface LibraryReservation {
  reservationId: number;
  uuid: string;
  title: string;
  roomName: string;
  labName: string;
  beginTime: string;
  endTime: string;
  status: number;
}

export interface LibraryReservationPage {
  reservations: LibraryReservation[];
  total: number;
  page: number;
  pageSize: number;
}

export function buildPrimoSearchUrl(options: PrimoSearchOptions): string {
  const queryString = buildPrimoQueryString(options);
  const scopeMap = {
    catalog: "catalog_scope",
    eresource: "eresource_scope",
    default: "default_scope",
  } as const;
  const sortMap = {
    relevance: "rank",
    date: "date_desc",
    title: "title_asc",
    author: "creator_asc",
  } as const;
  const url = new URL("/primo-explore/search", LIBRARY_PRIMO_BASE);
  url.searchParams.set("vid", "86SUSTC_INST:86SUSTC");
  url.searchParams.set("lang", options.lang ?? "zh_CN");
  url.searchParams.set("tab", "Everything");
  url.searchParams.set("search_scope", scopeMap[options.scope ?? "catalog"]);
  url.searchParams.set("mode", options.mode ?? "basic");
  url.searchParams.set("displayMode", options.displayMode ?? "full");
  url.searchParams.set("bulkSize", String(options.limit ?? 10));
  url.searchParams.set("highlight", "true");
  url.searchParams.set("dum", "true");
  url.searchParams.set("query", queryString);
  url.searchParams.set("displayField", "all");
  url.searchParams.set("pcAvailabiltyMode", "true");
  url.searchParams.set("sortby", sortMap[options.sortBy ?? "relevance"]);
  url.searchParams.set("offset", String(options.offset ?? 0));

  for (const facet of buildPrimoFacets(options)) {
    url.searchParams.append("facet", facet);
  }
  return url.toString();
}

export function buildPrimoDetailUrl(docId: string, lang = "zh_CN"): string {
  return requestUrl(LIBRARY_PRIMO_BASE, "/primo-explore/fulldisplay", {
    docid: docId,
    vid: "86SUSTC_INST:86SUSTC",
    lang,
    search_scope: "catalog_scope",
    tab: "Everything",
    context: "L",
  });
}

export function extractPrimoDocId(url: string): string {
  return new URL(url).searchParams.get("docid") ?? "";
}

export function normalisePrimoSearchResult(raw: unknown, rank: number): PrimoSearchResult {
  const record = recordValue(raw);
  const detailUrl = stringValue(record.detailUrl ?? record.detail_url);
  return {
    rank,
    title: cleanText(record.title),
    format: cleanText(record.format),
    detailUrl,
    docId: stringValue(record.docid ?? record.docId) || extractPrimoDocId(detailUrl),
    fullText: Boolean(record.fullText ?? record.full_text),
    peerReviewed: Boolean(record.peerReviewed ?? record.peer_reviewed),
    snippet: cleanText(record.snippet),
  };
}

export async function getLibraryBookingUser(adapter: ServiceAdapter): Promise<LibraryBookingUser> {
  const raw = await fetchJson<unknown>(adapter, requestUrl(LIBRARY_BOOKING_BASE, "/ic-web/auth/userInfo"));
  return normaliseLibraryBookingUser(unwrapLibraryBooking(raw));
}

export async function getLibraryIdleSummary(adapter: ServiceAdapter): Promise<LibraryIdleCategory[]> {
  const raw = await fetchJson<unknown>(adapter, requestUrl(LIBRARY_BOOKING_BASE, "/ic-web/home/page/room/idle"));
  return arrayValue(unwrapLibraryBooking(raw)).map((item) => normaliseLibraryIdleCategory(item));
}

export async function listLibraryLabs(adapter: ServiceAdapter, classKind = 1): Promise<LibraryLab[]> {
  const url = new URL("/ic-web/lab/devKindLabs", LIBRARY_BOOKING_BASE);
  url.searchParams.set("classKind", String(classKind));
  url.searchParams.set("kindIds", "");
  const raw = await fetchJson<unknown>(adapter, url.toString());
  return arrayValue(unwrapLibraryBooking(raw)).map((item) => normaliseLibraryLab(item));
}

export async function listLibraryRooms(
  adapter: ServiceAdapter,
  options: { kindId: number; labId: number; classKind?: number },
): Promise<LibraryCampusGroup[]> {
  const raw = await fetchJson<unknown>(adapter, requestUrl(LIBRARY_BOOKING_BASE, "/ic-web/roomDevice/roomInfos", {
    classKind: options.classKind ?? 1,
    kindId: options.kindId,
    labId: options.labId,
  }));
  return arrayValue(unwrapLibraryBooking(raw)).map((item) => normaliseLibraryCampusGroup(item));
}

export async function getLibraryReservationCount(adapter: ServiceAdapter): Promise<number> {
  const raw = await fetchJson<unknown>(adapter, requestUrl(LIBRARY_BOOKING_BASE, "/ic-web/reserve/count"));
  return numberValue(unwrapLibraryBooking(raw));
}

export async function listLibraryReservations(
  adapter: ServiceAdapter,
  options: {
    start: Date | string;
    end: Date | string;
    page?: number;
    pageSize?: number;
    needStatus?: number;
  },
): Promise<LibraryReservation[]> {
  return (await listLibraryReservationsPage(adapter, options)).reservations;
}

export async function listLibraryReservationsPage(
  adapter: ServiceAdapter,
  options: {
    start: Date | string;
    end: Date | string;
    page?: number;
    pageSize?: number;
    needStatus?: number;
  },
): Promise<LibraryReservationPage> {
  const page = options.page ?? 1;
  const pageSize = options.pageSize ?? 20;
  const raw = await fetchJson<unknown>(adapter, requestUrl(LIBRARY_BOOKING_BASE, "/ic-web/reserve/resvInfo", {
    beginDate: dateString(options.start),
    endDate: dateString(options.end),
    page,
    pageNum: pageSize,
    orderKey: "gmt_create",
    orderModel: "desc",
    ...(options.needStatus !== undefined ? { needStatus: options.needStatus } : {}),
  }));
  const data = unwrapLibraryBooking(raw);
  const dataRecord = recordValue(data);
  const rows = Array.isArray(data)
    ? data
    : arrayValue(dataRecord.data ?? dataRecord.rows ?? dataRecord.list);
  const envelope = recordValue(raw);
  const reservations = rows.map((item) => normaliseLibraryReservation(item));
  return {
    reservations,
    total: numberValue(envelope.count ?? dataRecord.count, reservations.length),
    page,
    pageSize,
  };
}

export function looksLikeLibraryBookingAuthError(raw: unknown): boolean {
  const record = recordValue(raw);
  return numberValue(record.code, -1) !== 0 && /未登录|请重新登录|session/i.test(stringValue(record.message));
}

export function normaliseLibraryBookingUser(raw: unknown): LibraryBookingUser {
  const record = recordValue(raw);
  return {
    accNo: numberValue(record.accNo),
    pid: stringValue(record.pid),
    logonName: stringValue(record.logonName),
    trueName: stringValue(record.trueName),
    className: stringValue(record.className),
    deptName: stringValue(record.deptName),
  };
}

export function normaliseLibraryIdleCategory(raw: unknown): LibraryIdleCategory {
  const record = recordValue(raw);
  return {
    name: cleanText(record.name),
    idleQuantity: numberValue(record.idelQuantity),
    totalQuantity: numberValue(record.totalQuantity),
  };
}

export function normaliseLibraryLab(raw: unknown): LibraryLab {
  const record = recordValue(raw);
  return {
    labId: numberValue(record.labId),
    labName: cleanText(record.labName),
  };
}

export function normaliseLibraryCampusGroup(raw: unknown): LibraryCampusGroup {
  const record = recordValue(raw);
  return {
    campusId: numberValue(record.campusId),
    campusName: cleanText(record.campusName),
    labs: arrayValue(record.labInfos).map((lab) => {
      const labRecord = recordValue(lab);
      return {
        labId: numberValue(labRecord.labId),
        labName: cleanText(labRecord.labName),
        rooms: arrayValue(labRecord.roomInfos).map((room) => normaliseLibraryRoom(room)),
      };
    }),
  };
}

export function normaliseLibraryRoom(raw: unknown): LibraryRoom {
  const record = recordValue(raw);
  return {
    devId: numberValue(record.devId),
    devName: cleanText(record.devName),
    minReservationMinutes: numberValue(record.minResvTime),
    openTimes: arrayValue(record.openTimes).map((item) => {
      const time = recordValue(item);
      return {
        start: stringValue(time.openStartTime),
        end: stringValue(time.openEndTime),
        limit: numberValue(time.openLimit),
      };
    }),
    reserved: Array.isArray(record.resvInfos)
      ? record.resvInfos.length > 0
      : booleanValue(record.resvInfos),
  };
}

export function normaliseLibraryReservation(raw: unknown): LibraryReservation {
  const record = recordValue(raw);
  const device = recordValue(arrayValue(record.resvDevInfoList)[0]);
  return {
    reservationId: numberValue(record.resvId),
    uuid: stringValue(record.uuid),
    title: cleanText(record.testName),
    roomName: cleanText(device.roomName ?? device.devName),
    labName: cleanText(device.labName),
    beginTime: reservationDateTime(record.resvBeginTime),
    endTime: reservationDateTime(record.resvEndTime),
    status: numberValue(record.resvStatus),
  };
}

function buildPrimoQueryString(options: PrimoSearchOptions): string {
  if (options.query && options.queries) {
    throw new Error("Use either `query` or `queries`, not both.");
  }
  if (options.queries?.length) {
    return options.queries.map(([field, operator, value]) => `${field},${operator},${value}`).join(";");
  }
  if (options.query) {
    return `any,contains,${options.query}`;
  }
  throw new Error("A Primo search requires `query` or `queries`.");
}

function buildPrimoFacets(options: PrimoSearchOptions): string[] {
  const facets: string[] = [];
  if (options.materialTypes?.length) facets.push(`rtype,include,${options.materialTypes.join(",")}`);
  if (options.libraries?.length) facets.push(`library,include,${options.libraries.join(",")}`);
  if (options.languages?.length) facets.push(`language,include,${options.languages.join(",")}`);
  if (options.peerReviewed) facets.push("tlevel,include,peer_reviewed");
  if (options.fullTextOnline) facets.push("pcavailability,include,true");
  if (options.dateFrom) facets.push(`date,include,[${options.dateFrom} TO ${options.dateTo ?? "*"}]`);
  return facets;
}

function unwrapLibraryBooking(raw: unknown): unknown {
  const record = recordValue(raw);
  if (looksLikeLibraryBookingAuthError(record)) {
    throw new CliError("The library-booking session was rejected by the upstream service.", "AUTHENTICATION_FAILED", 2, {
      service: "library-booking",
    });
  }
  if (numberValue(record.code, -1) !== 0) {
    throw new CliError("Library booking returned an application error.", "SERVICE_UPSTREAM_ERROR", 1, {
      service: "library-booking",
      code: numberValue(record.code, -1),
      message: stringValue(record.message) || "unknown error",
    });
  }
  return record.data;
}

function reservationDateTime(value: unknown): string {
  const numeric = numberValue(value);
  if (numeric > 0) return `${new Date(numeric + 8 * 60 * 60 * 1000).toISOString().slice(0, -1)}+08:00`;
  const text = stringValue(value);
  return text;
}
