import { constants as cryptoConstants } from "node:crypto";
import type { ClientRequest, IncomingHttpHeaders, IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
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
  sampleText,
  ServiceError,
  stringValue,
} from "./base.js";
import type { ServiceAdapter, ServiceStatus } from "./base.js";

export const LIBRARY_BASE = "https://lib.sustech.edu.cn";
export const LIBRARY_PRIMO_BASE = "https://sustc.primo.exlibrisgroup.com.cn";
export const LIBRARY_PRIMO_PUBLIC_BASE = "https://sustc.primo.exlibrisgroup.com.cn";
export const LIBRARY_PRIMO_PUBLIC_API = `${LIBRARY_PRIMO_PUBLIC_BASE}/primaws/rest/pub`;
export const LIBRARY_BOOKING_BASE = "https://booking.lib.sustech.edu.cn";
export const LIBRARY_BOOKING_API = `${LIBRARY_BOOKING_BASE}/ic-web`;

const PRIMO_PUBLIC_VID = "86SUSTC_INST:86SUSTC";
const PRIMO_PUBLIC_INST = "86SUSTC";
const PRIMO_PUBLIC_TAB = "Everything";
const PRIMO_PUBLIC_DEFAULT_LIMIT = 10;
const PRIMO_PUBLIC_DEFAULT_HEADERS = {
  accept: "application/json, text/plain, */*",
  "user-agent": "sustech-cli",
} as const;

export const LIBRARY_CATALOG_STATUS: ServiceStatus = {
  service: "library-catalog",
  availability: "implemented",
  auth: "none",
  campusNetwork: false,
  browser: false,
  summary: "Public Primo JSON search/detail reads are implemented against the SUSTech Discovery host without requiring a browser session.",
  notes: [
    "The public metadata API is read-only; it does not imply that a record's full text is openly accessible.",
    "Exact detail reads require both the Primo context and record ID; malformed or mismatched responses fail closed.",
    "An explicit --browser path uses an ephemeral local Chromium session; --interactive leaves any CAS challenge entirely to the user.",
    "The CLI also exposes `library search-url` when the upstream Discovery page itself is preferred over normalized JSON output.",
  ],
  endpoints: [
    "/primaws/rest/pub/pnxs",
    "/primaws/rest/pub/pnxs/{context}/{recordId}",
    "/discovery/search",
    "/discovery/fulldisplay",
  ],
};

export const LIBRARY_BOOKING_STATUS: ServiceStatus = {
  service: "library-booking",
  availability: "implemented",
  auth: "cookie-session",
  campusNetwork: true,
  browser: false,
  summary: "The CLI resolves the dynamic authcenter service URL, completes CAS, and exposes read plus typed mutation IC booking APIs.",
  notes: [
    "The IC booking cookie remains in memory and is never returned in command output.",
    "Identity, idle-summary, lab, and reservation-count reads completed an opt-in live smoke test on 2026-08-26.",
    "Create preview reads the exact room open-times endpoint for the target day and fails closed when that evidence is missing or unreadable.",
    "Reservation create/cancel are exposed only through typed preview/apply flows with explicit confirmation and post-readback verification.",
  ],
  endpoints: [
    "/ic-web/auth/address",
    "/authcenter/toLoginPage",
    "/authcenter/doAuth/{relayId}",
    "/ic-web/auth/userInfo",
    "/ic-web/home/page/room/idle",
    "/ic-web/lab/devKindLabs",
    "/ic-web/roomDevice/roomInfos",
    "/ic-web/room/openTimes",
    "/ic-web/reserve/count",
    "/ic-web/reserve",
    "/ic-web/reserve/delete",
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
  context: string;
  reference: string;
  fullText: boolean;
  peerReviewed: boolean;
  snippet: string;
}

export interface PrimoRecordRef {
  context: string;
  docId: string;
}

export interface PrimoPublicAdapterOptions {
  requestImpl?: PrimoPublicRequestImpl;
  timeoutMs?: number;
}

export interface PrimoCatalogSearchPage {
  query: string;
  apiUrl: string;
  searchUrl: string;
  total: number;
  totalLocal: number;
  totalRemote: number;
  first: number;
  last: number;
  items: PrimoSearchResult[];
}

export interface LibraryCatalogDetail {
  context: string;
  docId: string;
  reference: string;
  detailUrl: string;
  title: string;
  format: string;
  creators: string[];
  publisher: string;
  isPartOf: string;
  date: string;
  language: string;
  subjects: string[];
  identifiers: string[];
  description: string;
  availability: string[];
  fullText: boolean;
  peerReviewed: boolean;
  links: string[];
  sourceId: string;
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
  roomId?: number;
  devName: string;
  minReservationMinutes: number;
  openTimes: Array<{ start: string; end: string; limit: number }>;
  reserved: boolean;
  reservationSlots?: LibraryRoomReservationSlot[];
  reservationSlotsComplete?: boolean;
}

export interface LibraryCampusGroup {
  campusId: number;
  campusName: string;
  labs: Array<{ labId: number; labName: string; rooms: LibraryRoom[] }>;
}

export interface LibraryReservation {
  reservationId: number;
  uuid: string;
  devId: number;
  title: string;
  roomName: string;
  labName: string;
  beginTime: string;
  endTime: string;
  status: number;
}

export interface LibraryRoomReservationSlot {
  title: string;
  start: string;
  end: string;
}

export interface LibrarySlotCheck {
  status: "available" | "occupied" | "unavailable";
  date?: string;
  overlaps: LibraryRoomReservationSlot[];
  message?: string;
}

export interface LibraryBookingMutationIssue {
  code: string;
  message: string;
}

export interface LibraryBookingCreateTarget {
  classKind: number;
  kindId: number;
  labId: number;
  devId: number;
  title: string;
  start: string;
  end: string;
  memberKind: 1 | 2;
  members: number[];
  memo?: string;
}

export interface LibraryBookingCancelTarget {
  reservationId: number;
}

export interface LibraryBookingReservationPayload {
  sysKind: number;
  appAccNo: number;
  memberKind: number;
  resvMember: number[];
  resvBeginTime: string;
  resvEndTime: string;
  testName: string;
  resvProperty: number;
  resvDev: number[];
  memo: string;
}

export interface LibraryBookingCreatePreview {
  checkedAt: string;
  action: "create";
  target: LibraryBookingCreateTarget;
  user: LibraryBookingUser;
  room?: LibraryRoom;
  slotCheck?: LibrarySlotCheck;
  blockers: LibraryBookingMutationIssue[];
  warnings: LibraryBookingMutationIssue[];
  applyAllowed: boolean;
}

export interface LibraryBookingCancelPreview {
  checkedAt: string;
  action: "cancel";
  target: LibraryBookingCancelTarget;
  reservation?: LibraryReservation;
  blockers: LibraryBookingMutationIssue[];
  warnings: LibraryBookingMutationIssue[];
  applyAllowed: boolean;
}

export interface LibraryBookingCreateSuccess {
  action: "create";
  target: LibraryBookingCreateTarget;
  user: LibraryBookingUser;
  room: LibraryRoom;
  payload: LibraryBookingReservationPayload;
  receipt: Record<string, unknown>;
  reservation: LibraryReservation;
  verification: { status: "confirmed"; message: string };
}

export interface LibraryBookingCancelSuccess {
  action: "cancel";
  target: LibraryBookingCancelTarget;
  reservation: LibraryReservation;
  receipt: Record<string, unknown>;
  verification: { status: "confirmed"; message: string };
}

export interface LibraryBookingMutationAdapter extends ServiceAdapter {
  createReservation(payload: LibraryBookingReservationPayload): Promise<Record<string, unknown>>;
  cancelReservation(uuid: string): Promise<Record<string, unknown>>;
}

export interface LibraryReservationPage {
  reservations: LibraryReservation[];
  total: number;
  page: number;
  pageSize: number;
}

type PrimoPublicRequestImpl = (
  url: URL,
  options: {
    method: "GET";
    headers: Record<string, string>;
    rejectUnauthorized: true;
    secureOptions: number;
  },
  onResponse: (response: IncomingMessage) => void,
) => ClientRequest;

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
  const url = new URL("/discovery/search", LIBRARY_PRIMO_BASE);
  url.searchParams.set("vid", "86SUSTC_INST:86SUSTC");
  url.searchParams.set("lang", options.lang ?? "zh");
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

export function createPrimoPublicAdapter(options: PrimoPublicAdapterOptions = {}): ServiceAdapter {
  const requestImpl = options.requestImpl ?? httpsRequest as PrimoPublicRequestImpl;
  const timeoutMs = Number.isFinite(options.timeoutMs) && (options.timeoutMs ?? 0) > 0
    ? Math.trunc(options.timeoutMs ?? 0)
    : 30_000;
  return {
    name: "primo-public-https",
    fetch(input: string, init?: RequestInit): Promise<Response> {
      const url = normalisePrimoPublicApiUrl(input);
      const method = stringValue(init?.method, "GET").trim().toUpperCase() || "GET";
      if (method !== "GET") {
        throw new ServiceError("Primo public adapter only permits GET requests.", { url: input });
      }
      if (init?.body !== undefined && init.body !== null) {
        throw new ServiceError("Primo public adapter rejects request bodies.", { url: input });
      }
      if (init?.signal?.aborted) {
        throw abortPrimoPublicRequest(init.signal.reason);
      }
      const headers = normalisePrimoPublicHeaders(init?.headers);
      return new Promise<Response>((resolve, reject) => {
        let settled = false;
        const abortListener = (): void => {
          request.destroy(abortPrimoPublicRequest(init?.signal?.reason));
        };
        const cleanup = (): void => {
          init?.signal?.removeEventListener("abort", abortListener);
        };
        const fail = (error: unknown): void => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(error instanceof Error ? error : new Error(String(error)));
        };
        const succeed = (response: Response): void => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(response);
        };
        const request = requestImpl(url, {
          method: "GET",
          headers,
          rejectUnauthorized: true,
          secureOptions: cryptoConstants.SSL_OP_LEGACY_SERVER_CONNECT,
        }, (response) => {
          const chunks: Buffer[] = [];
          response.on("aborted", () => {
            fail(new Error("Primo public response aborted before completion."));
          });
          response.on("data", (chunk) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          response.on("end", () => {
            succeed(new Response(Buffer.concat(chunks), {
              status: response.statusCode ?? 502,
              headers: normalisePrimoIncomingHeaders(response.headers),
            }));
          });
          response.on("error", fail);
        });
        request.setTimeout(timeoutMs, () => {
          request.destroy(new Error(`Primo public request timed out after ${timeoutMs} ms.`));
        });
        request.on("error", fail);
        init?.signal?.addEventListener("abort", abortListener, { once: true });
        request.end();
      });
    },
  };
}

export function buildPrimoDetailUrl(docId: string, lang = "zh"): string {
  return requestUrl(LIBRARY_PRIMO_BASE, "/discovery/fulldisplay", {
    docid: docId,
    vid: "86SUSTC_INST:86SUSTC",
    lang,
    search_scope: "catalog_scope",
    tab: "Everything",
    context: "L",
  });
}

export function extractPrimoDocId(url: string): string {
  try {
    const parsed = new URL(url);
    const queryDocId = parsed.searchParams.get("docid");
    if (queryDocId) return queryDocId;
    const segments = parsed.pathname.split("/").filter(Boolean);
    const pnxsIndex = segments.lastIndexOf("pnxs");
    if (pnxsIndex >= 0 && segments.length > pnxsIndex + 2) return decodeURIComponent(segments[pnxsIndex + 2] ?? "");
    const permalinkIndex = segments.lastIndexOf("permalink");
    if (permalinkIndex >= 0 && segments.length > permalinkIndex + 3) return decodeURIComponent(segments[segments.length - 1] ?? "");
    return "";
  } catch {
    return "";
  }
}

export function extractPrimoContext(url: string): string {
  try {
    const parsed = new URL(url);
    const queryContext = parsed.searchParams.get("context");
    if (queryContext) return queryContext;
    const segments = parsed.pathname.split("/").filter(Boolean);
    const pnxsIndex = segments.lastIndexOf("pnxs");
    if (pnxsIndex >= 0 && segments.length > pnxsIndex + 1) return decodeURIComponent(segments[pnxsIndex + 1] ?? "");
    return "";
  } catch {
    return "";
  }
}

export function formatPrimoRecordRef(ref: PrimoRecordRef): string {
  const context = normalisePrimoPathSegment(ref.context, "context");
  const docId = normalisePrimoPathSegment(ref.docId, "docId");
  return `${context}:${docId}`;
}

export function parsePrimoRecordRef(input: PrimoRecordRef | string): PrimoRecordRef {
  if (typeof input !== "string") {
    return {
      context: normalisePrimoPathSegment(input.context, "context"),
      docId: normalisePrimoPathSegment(input.docId, "docId"),
    };
  }
  const trimmed = input.trim();
  if (!trimmed) throw new Error("A non-empty Primo record reference is required.");
  if (/^https?:\/\//i.test(trimmed)) {
    const context = extractPrimoContext(trimmed);
    const docId = extractPrimoDocId(trimmed);
    if (!context || !docId) throw new Error("Primo detail URLs must expose both `context` and `docid`.");
    return {
      context: normalisePrimoPathSegment(context, "context"),
      docId: normalisePrimoPathSegment(docId, "docId"),
    };
  }
  const slashMatch = /^([^/]+)\/(.+)$/.exec(trimmed);
  if (slashMatch) {
    return {
      context: normalisePrimoPathSegment(slashMatch[1] ?? "", "context"),
      docId: normalisePrimoPathSegment(slashMatch[2] ?? "", "docId"),
    };
  }
  const colonIndex = trimmed.indexOf(":");
  if (colonIndex > 0 && colonIndex < trimmed.length - 1) {
    return {
      context: normalisePrimoPathSegment(trimmed.slice(0, colonIndex), "context"),
      docId: normalisePrimoPathSegment(trimmed.slice(colonIndex + 1), "docId"),
    };
  }
  throw new Error("Primo detail lookups require both the context and record ID, for example `L:alma...`.");
}

export async function searchLibraryCatalog(
  adapter: ServiceAdapter,
  options: PrimoSearchOptions,
): Promise<PrimoCatalogSearchPage> {
  ensureSupportedPrimoApiOptions(options);
  const apiUrl = buildPrimoPublicSearchApiUrl(options);
  const raw = await fetchJson<unknown>(adapter, apiUrl, {
    headers: primoRequestHeaders(buildPrimoPublicSearchUrl(options)),
  });
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw primoProtocolError("Primo search response was not a JSON object.", raw);
  }
  const payload = raw as Record<string, unknown>;
  if (!payload.info || typeof payload.info !== "object" || Array.isArray(payload.info)) {
    throw primoProtocolError("Primo search response was missing the `info` object.", raw);
  }
  if (!Array.isArray(payload.docs)) {
    throw primoProtocolError("Primo search response was missing the `docs` array.", raw);
  }
  const info = payload.info as Record<string, unknown>;
  const docs = payload.docs as unknown[];
  const items = docs.map((entry, index) => normalisePrimoSearchResult(entry, index + 1 + (options.offset ?? 0), {
    requireContext: true,
    lang: options.lang,
    scope: options.scope ?? "default",
  }));
  return {
    query: buildPrimoQueryString(options),
    apiUrl,
    searchUrl: buildPrimoPublicSearchUrl(options),
    total: numberValue(info.total, items.length),
    totalLocal: numberValue(info.totalResultsLocal),
    totalRemote: numberValue(info.totalResultsPC),
    first: numberValue(info.first, items.length > 0 ? 1 : 0),
    last: numberValue(info.last, items.length),
    items,
  };
}

export async function getLibraryCatalogDetail(
  adapter: ServiceAdapter,
  input: PrimoRecordRef | string,
  options: { lang?: string; scope?: PrimoSearchOptions["scope"] } = {},
): Promise<LibraryCatalogDetail> {
  const ref = parsePrimoRecordRef(input);
  const apiUrl = buildPrimoPublicDetailApiUrl(ref, options.lang);
  const raw = await fetchJson<unknown>(adapter, apiUrl, {
    headers: primoRequestHeaders(buildPrimoPublicDetailUrl(ref, options.lang, options.scope)),
  });
  return normalisePrimoCatalogDetail(raw, ref, options);
}

export function normalisePrimoSearchResult(
  raw: unknown,
  rank: number,
  options: { requireContext?: boolean; lang?: string; scope?: PrimoSearchOptions["scope"] } = {},
): PrimoSearchResult {
  const record = recordValue(raw);
  const detailUrl = stringValue(record.detailUrl ?? record.detail_url);
  const pnx = recordValue(record.pnx);
  const control = recordValue(pnx.control);
  const display = recordValue(pnx.display);
  const search = recordValue(pnx.search);
  const facets = recordValue(pnx.facets);
  const docId = firstPrimoValue(control.recordid)
    || stringValue(record.docid ?? record.docId)
    || extractPrimoDocId(detailUrl)
    || extractPrimoDocId(stringValue(record["@id"]));
  if (!docId) throw primoProtocolError("Primo search response was missing the record ID.", raw);
  const context = firstNonEmptyString(
    stringValue(record.context),
    extractPrimoContext(detailUrl),
    extractPrimoContext(stringValue(record["@id"])),
    looksLikeLocalPrimoRecord(docId) ? "L" : "",
  );
  if (options.requireContext && !context) {
    throw primoProtocolError("Primo search response was missing the record context.", raw);
  }
  const title = cleanPrimoDisplayText(firstPrimoValue(display.title) || firstPrimoValue(search.title) || record.title);
  if (!title) throw primoProtocolError("Primo search response was missing the record title.", raw);
  const normalizedContext = context || "L";
  return {
    rank,
    title,
    format: cleanPrimoDisplayText(firstPrimoValue(display.type) || firstPrimoValue(search.rsrctype) || firstPrimoValue(search.recordtype) || record.format),
    detailUrl: detailUrl || buildPrimoPublicDetailUrl({ context: normalizedContext, docId }, options.lang, options.scope),
    docId,
    context: normalizedContext,
    reference: formatPrimoRecordRef({ context: normalizedContext, docId }),
    fullText: primoHasFullText(record),
    peerReviewed: primoIsPeerReviewed(display, facets, search, control, record),
    snippet: cleanPrimoDisplayText(record.snippet || primoBuildSnippet(display, search)),
  };
}

export function normalisePrimoCatalogDetail(
  raw: unknown,
  expected: PrimoRecordRef,
  options: { lang?: string; scope?: PrimoSearchOptions["scope"] } = {},
): LibraryCatalogDetail {
  const record = recordValue(raw);
  const pnx = recordValue(record.pnx);
  const control = recordValue(pnx.control);
  const display = recordValue(pnx.display);
  const search = recordValue(pnx.search);
  const facets = recordValue(pnx.facets);
  const addata = recordValue(pnx.addata);
  const context = stringValue(record.context).trim();
  const docId = firstPrimoValue(control.recordid);
  if (!context || !docId) {
    throw primoProtocolError("Primo detail response was missing the expected context or record ID.", raw);
  }
  if (context !== expected.context || docId !== expected.docId) {
    throw primoProtocolError(
      `Primo detail response mismatched the requested record (${expected.context}:${expected.docId}).`,
      raw,
    );
  }
  const title = cleanPrimoDisplayText(firstPrimoValue(display.title) || firstPrimoValue(search.title));
  if (!title) throw primoProtocolError("Primo detail response was missing the record title.", raw);
  return {
    context,
    docId,
    reference: formatPrimoRecordRef({ context, docId }),
    detailUrl: buildPrimoPublicDetailUrl({ context, docId }, options.lang, options.scope),
    title,
    format: cleanPrimoDisplayText(firstPrimoValue(display.type) || firstPrimoValue(search.rsrctype) || firstPrimoValue(search.recordtype)),
    creators: normalisePrimoCreators(display.creator, search.creator, addata.au),
    publisher: cleanPrimoDisplayText(firstPrimoValue(display.publisher) || firstPrimoValue(addata.pub) || firstPrimoValue(search.general)),
    isPartOf: cleanPrimoDisplayText(firstPrimoValue(display.ispartof)),
    date: cleanPrimoDisplayText(firstNonEmptyString(firstPrimoValue(addata.date), firstPrimoValue(search.creationdate), firstPrimoValue(search.startdate))),
    language: cleanPrimoDisplayText(firstPrimoValue(display.language) || firstPrimoValue(search.language)),
    subjects: uniqueStrings([
      ...primoSplitValues(display.subject),
      ...primoSplitValues(search.subject),
    ]),
    identifiers: uniqueStrings([
      ...primoStrings(display.identifier),
      ...primoStrings(addata.doi).map((value) => `DOI: ${value}`),
      ...primoStrings(addata.isbn).map((value) => `ISBN: ${value}`),
      ...primoStrings(addata.issn).map((value) => `ISSN: ${value}`),
    ]),
    description: cleanPrimoDisplayText(firstPrimoValue(display.description) || firstPrimoValue(display.rights) || firstPrimoValue(display.subject)),
    availability: uniqueStrings([
      ...primoStrings(recordValue(record.delivery).availability),
      ...primoStrings(recordValue(record.delivery).deliveryCategory),
      ...primoStrings(recordValue(pnx.delivery).delcategory),
    ].filter((value) => !/^(?:true|false|0|1)$/i.test(stringValue(value)))),
    fullText: primoHasFullText(record),
    peerReviewed: primoIsPeerReviewed(display, facets, search, control, record),
    links: uniqueStrings([
      ...extractPrimoEncodedLinks(recordValue(record.delivery).link),
      ...extractPrimoEncodedLinks(recordValue(pnx.links).backlink),
      ...extractPrimoEncodedLinks(recordValue(pnx.links).linktorsrc),
      ...extractPrimoEncodedLinks(recordValue(pnx.links).linktorsrcadditional),
      stringValue(recordValue(record.delivery).almaOpenurl),
    ]),
    sourceId: cleanText(firstPrimoValue(control.sourceid)),
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

export async function listLibraryRoomOpenTimes(
  adapter: ServiceAdapter,
  options: { roomId: number; beginDate: Date | string; endDate?: Date | string; classKind?: number },
): Promise<Array<{ fixedDay: string; openTimes: Array<{ start: string; end: string; limit: number }> }>> {
  const raw = await fetchJson<unknown>(adapter, requestUrl(LIBRARY_BOOKING_BASE, "/ic-web/room/openTimes", {
    classKind: options.classKind ?? 1,
    roomId: options.roomId,
    beginDate: dateString(options.beginDate),
    endDate: dateString(options.endDate ?? options.beginDate),
  }));
  const data = unwrapLibraryBooking(raw);
  const record = recordValue(data);
  const rows = Array.isArray(data)
    ? data
    : arrayValue(record.data ?? record.rows ?? record.list);
  return rows
    .map((item) => normaliseLibraryRoomOpenDay(item))
    .filter((item): item is { fixedDay: string; openTimes: Array<{ start: string; end: string; limit: number }> } => item !== undefined);
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

export async function getLibraryReservationInfo(
  adapter: ServiceAdapter,
  reservationId: number,
  options: { start?: string; end?: string } = {},
): Promise<LibraryReservation | undefined> {
  const raw = await fetchJson<unknown>(adapter, requestUrl(LIBRARY_BOOKING_BASE, "/ic-web/reserve/resvInfo", {
    beginDate: options.start ?? addIsoDays(todayShanghai(), -30),
    endDate: options.end ?? addIsoDays(todayShanghai(), 365),
    resvId: reservationId,
  }));
  const data = unwrapLibraryBooking(raw);
  const record = recordValue(data);
  const rows = Array.isArray(data)
    ? data
    : arrayValue(record.data ?? record.rows ?? record.list);
  const matches = rows
    .map((item) => normaliseLibraryReservation(item))
    .filter((item) => item.reservationId === reservationId);
  if (matches.length === 0) return undefined;
  if (matches.length > 1) {
    throw new CliError(
      "The live reservation lookup returned multiple rows for the same reservation ID.",
      "LIBRARY_RESERVATION_LOOKUP_AMBIGUOUS",
      1,
      {
        reservationId,
        matches: matches.map((entry) => ({
        reservationId: entry.reservationId,
          roomName: entry.roomName,
          beginTime: entry.beginTime,
          endTime: entry.endTime,
          status: entry.status,
        })),
      },
    );
  }
  return matches[0];
}

export function buildLibraryBookingReservationPayload(input: {
  accNo: number;
  devId: number;
  begin: string;
  end: string;
  title: string;
  classKind?: number;
  memberKind?: number;
  members?: number[];
  memo?: string;
}): LibraryBookingReservationPayload {
  return {
    sysKind: input.classKind ?? 1,
    appAccNo: input.accNo,
    memberKind: input.memberKind ?? 1,
    resvMember: input.members && input.members.length > 0 ? [...input.members] : [input.accNo],
    resvBeginTime: formatLibraryReservationDateTime(input.begin),
    resvEndTime: formatLibraryReservationDateTime(input.end),
    testName: input.title,
    resvProperty: 0,
    resvDev: [input.devId],
    memo: input.memo ?? "",
  };
}

export async function buildLibraryBookingCreatePreview(
  adapter: ServiceAdapter,
  target: LibraryBookingCreateTarget,
  options: { now?: Date } = {},
): Promise<LibraryBookingCreatePreview> {
  const now = options.now ?? new Date();
  const checkedAt = now.toISOString();
  const user = await getLibraryBookingUser(adapter);
  const groups = await listLibraryRooms(adapter, {
    classKind: target.classKind,
    kindId: target.kindId,
    labId: target.labId,
  });
  const room = flattenLibraryRooms(groups).find((entry) => entry.devId === target.devId);
  const normalisedTarget = normaliseLibraryBookingCreateTarget(target);
  const blockers: LibraryBookingMutationIssue[] = [];
  const warnings: LibraryBookingMutationIssue[] = [];
  const timing = parseObservedLibraryDateTimeRange(normalisedTarget.start, normalisedTarget.end);
  const members = normaliseMemberList(normalisedTarget.members, user.accNo);
  let slotCheck: LibrarySlotCheck | undefined;

  if (!normalisedTarget.title) {
    blockers.push(libraryIssue("TITLE_REQUIRED", "A non-empty reservation title is required."));
  }
  if (!room) {
    blockers.push(libraryIssue("ROOM_NOT_FOUND", `Room '${normalisedTarget.devId}' was not found in the live room inventory for the selected kind/lab.`));
  }
  if (members.invalid) {
    blockers.push(libraryIssue("MEMBER_LIST_INVALID", members.invalid));
  }
  if (!timing.start || !timing.end) {
    blockers.push(libraryIssue("TIME_INVALID", "Start and end must be valid local date-times."));
  } else {
    const durationMinutes = Math.round((timing.end.epochMs - timing.start.epochMs) / 60000);
    const minutesUntilStart = (timing.start.epochMs - now.getTime()) / 60000;
    const daysAhead = daysBetweenShanghai(todayShanghai(now), timing.start.date);
    if (timing.end.epochMs <= timing.start.epochMs) {
      blockers.push(libraryIssue("TIME_ORDER_INVALID", "End time must be after start time."));
    }
    if (timing.start.date !== timing.end.date) {
      blockers.push(libraryIssue("MULTI_DAY_UNSUPPORTED", "Library booking create only supports one local calendar day."));
    }
    if (timing.start.epochMs < now.getTime()) {
      blockers.push(libraryIssue("START_IN_PAST", "The reservation start time is already in the past."));
    }
    if (daysAhead > 2) {
      blockers.push(libraryIssue("ADVANCE_WINDOW_EXCEEDED", `Library policy limits advance booking to 2 days; target is ${daysAhead} day(s) ahead.`));
    }
    if (durationMinutes > 120) {
      blockers.push(libraryIssue("DURATION_EXCEEDS_LIMIT", "Library policy limits each reservation to 2 hours."));
    }
    if (durationMinutes <= 0) {
      blockers.push(libraryIssue("DURATION_INVALID", "Reservation duration must be positive."));
    }
    if (minutesUntilStart >= 0 && minutesUntilStart < 10) {
      warnings.push(libraryIssue("CANCELLATION_WINDOW_SHORT", "Less than 10 minutes remain before start; a later cancellation would violate policy 1.6."));
    }
    if (room) {
      if (room.minReservationMinutes > 0 && durationMinutes < room.minReservationMinutes) {
        blockers.push(libraryIssue(
          "DURATION_BELOW_ROOM_MINIMUM",
          `Room '${room.devName}' requires at least ${room.minReservationMinutes} minutes; target is ${durationMinutes} minutes.`,
        ));
      }
      if (!room.roomId) {
        slotCheck = {
          status: "unavailable",
          date: timing.start.date,
          overlaps: [],
          message: "The room inventory did not expose a stable roomId for the exact open-times check.",
        };
      } else {
        try {
          const openDays = await listLibraryRoomOpenTimes(adapter, {
            roomId: room.roomId,
            classKind: target.classKind,
            beginDate: timing.start.date,
            endDate: timing.start.date,
          });
          slotCheck = inspectLibraryRoomSlot(
            room,
            openDays,
            timing.start.date,
            timing.start.time,
            timing.end.time,
            timing.start.epochMs,
            timing.end.epochMs,
          );
        } catch (error) {
          slotCheck = {
            status: "unavailable",
            date: timing.start.date,
            overlaps: [],
            message: error instanceof Error ? error.message : String(error),
          };
        }
      }
      if (slotCheck.status === "occupied") {
        blockers.push(libraryIssue(
          "SLOT_OCCUPIED",
          slotCheck.message || `Room '${room.devName}' is not available for the requested time window.`,
        ));
      } else if (slotCheck.status === "unavailable") {
        blockers.push(libraryIssue(
          "SLOT_CHECK_FAILED",
          slotCheck.message
            || "The exact room open-times endpoint did not return usable availability evidence, so overlap cannot be ruled out.",
        ));
      } else {
        warnings.push(libraryIssue(
          "SLOT_AVAILABILITY_POINT_IN_TIME",
          "The exact room open-times endpoint included this interval at preview time; apply repeats this check, but availability can still change before the upstream write is accepted.",
        ));
      }
      const capacityClass = classifyLibraryRoomCapacity(room.devName);
      if (capacityClass === "unknown") {
        blockers.push(libraryIssue(
          "ROOM_CAPACITY_POLICY_UNKNOWN",
          `Room '${room.devName}' uses an unrecognized capacity label, so the required member policy could not be classified safely.`,
        ));
      } else if (capacityClass === "group") {
        if (normalisedTarget.memberKind !== 2) {
          blockers.push(libraryIssue("GROUP_MEMBER_KIND_REQUIRED", `Room '${room.devName}' requires --member-kind 2 and explicit member accNo values.`));
        }
        if (members.values.length < 3) {
          blockers.push(libraryIssue("GROUP_MEMBERS_REQUIRED", `Room '${room.devName}' requires booker plus at least 2 co-applicants (3 accNo values total).`));
        }
      } else if (capacityClass === "solo" && normalisedTarget.memberKind !== 1) {
        warnings.push(libraryIssue("GROUP_NOT_REQUIRED", `Room '${room.devName}' is a 1-3 person room; group booking is allowed but not required.`));
      }
    }
  }
  if (!slotCheck && room && timing.start && timing.end) {
    warnings.push(libraryIssue(
      "SLOT_AVAILABILITY_UNVERIFIED",
      "This preview could not reach the exact room open-times endpoint; rely on the blocked preflight result instead of guessing slot availability.",
    ));
  }

  if (normalisedTarget.memberKind === 1) {
    if (members.values.length !== 1 || members.values[0] !== user.accNo) {
      blockers.push(libraryIssue("SELF_MEMBER_MISMATCH", "Single-person reservations must use only the booker's own accNo."));
    }
  } else {
    if (members.values.length < 2) {
      blockers.push(libraryIssue("GROUP_TOO_SMALL", "Group reservations must include the booker's accNo plus at least one more accNo."));
    }
    if (!members.values.includes(user.accNo)) {
      blockers.push(libraryIssue("BOOKER_MISSING", "The member list must include the authenticated booker's accNo."));
    }
  }

  return {
    checkedAt,
    action: "create",
    target: {
      ...normalisedTarget,
      members: members.values,
    },
    user,
    ...(room ? { room } : {}),
    ...(slotCheck ? { slotCheck } : {}),
    blockers,
    warnings,
    applyAllowed: blockers.length === 0,
  };
}

export async function buildLibraryBookingCancelPreview(
  adapter: ServiceAdapter,
  target: LibraryBookingCancelTarget,
  options: { now?: Date } = {},
): Promise<LibraryBookingCancelPreview> {
  const now = options.now ?? new Date();
  const checkedAt = now.toISOString();
  const blockers: LibraryBookingMutationIssue[] = [];
  let reservation: LibraryReservation | undefined;
  try {
    reservation = await getLibraryReservationInfo(adapter, target.reservationId);
  } catch (error) {
    if (error instanceof CliError && error.code === "LIBRARY_RESERVATION_LOOKUP_AMBIGUOUS") {
      blockers.push(libraryIssue("RESERVATION_LOOKUP_AMBIGUOUS", error.message));
    } else {
      throw error;
    }
  }
  if (!reservation) {
    if (blockers.length === 0) {
      blockers.push(libraryIssue("RESERVATION_NOT_FOUND", `Reservation '${target.reservationId}' was not present in the live reservation list.`));
    }
  } else {
    const begin = parseObservedLibraryDateTime(reservation.beginTime);
    if (!begin) {
      blockers.push(libraryIssue("RESERVATION_TIME_INVALID", "The live reservation begin time could not be parsed safely."));
    } else {
      const minutesUntilStart = (begin.epochMs - now.getTime()) / 60000;
      if (minutesUntilStart < 0) {
        blockers.push(libraryIssue("RESERVATION_ALREADY_STARTED", "The reservation has already started; cancel is no longer the conservative action."));
      } else if (minutesUntilStart < 10) {
        blockers.push(libraryIssue("CANCELLATION_WINDOW_EXPIRED", "Library policy 1.6 requires cancellation at least 10 minutes before start."));
      }
    }
  }
  return {
    checkedAt,
    action: "cancel",
    target,
    ...(reservation ? { reservation } : {}),
    blockers,
    warnings: [],
    applyAllowed: blockers.length === 0,
  };
}

export async function applyLibraryBookingCreate(
  adapter: LibraryBookingMutationAdapter,
  target: LibraryBookingCreateTarget,
  options: { now?: Date } = {},
): Promise<LibraryBookingCreateSuccess> {
  const preview = await buildLibraryBookingCreatePreview(adapter, target, options);
  if (!preview.applyAllowed || !preview.room) {
    throw libraryPrecheckError("create", preview.target, preview.blockers);
  }
  const payload = buildLibraryBookingReservationPayload({
    accNo: preview.user.accNo,
    devId: preview.target.devId,
    begin: preview.target.start,
    end: preview.target.end,
    title: preview.target.title,
    classKind: preview.target.classKind,
    memberKind: preview.target.memberKind,
    members: preview.target.members,
    memo: preview.target.memo,
  });

  let receipt: Record<string, unknown>;
  try {
    receipt = await adapter.createReservation(payload);
  } catch (error) {
    throw wrapLibraryBookingWriteError("create", preview.target, error);
  }

  const reservationId = numberValue(receipt.resvId ?? receipt.reservationId);
  const uuid = stringValue(receipt.uuid).trim();
  const observed = await readLibraryReservationForVerification(adapter, "create", preview.target, receipt, reservationId, {
    start: preview.target.start.slice(0, 10),
    end: preview.target.end.slice(0, 10),
  });
  if (observed && libraryReservationMatchesTarget(observed, preview.target, uuid)) {
    return {
      action: "create",
      target: preview.target,
      user: preview.user,
      room: preview.room,
      payload,
      receipt,
      reservation: observed,
      verification: { status: "confirmed", message: "The exact reservation ID/room/time tuple was read back from the live reservation list." },
    };
  }
  throw libraryUnverifiedError(
    "create",
    preview.target,
    receipt,
    observed
      ? "A reservation row was observed, but it did not match the exact devId/title/time target."
      : "The upstream create returned success, but the exact reservation was not visible in the live read-back state.",
  );
}

export async function applyLibraryBookingCancel(
  adapter: LibraryBookingMutationAdapter,
  target: LibraryBookingCancelTarget,
  options: { now?: Date } = {},
): Promise<LibraryBookingCancelSuccess> {
  const preview = await buildLibraryBookingCancelPreview(adapter, target, options);
  if (!preview.applyAllowed || !preview.reservation) {
    throw libraryPrecheckError("cancel", target, preview.blockers);
  }
  if (!preview.reservation.uuid) {
    throw libraryPrecheckError("cancel", target, [libraryIssue("UUID_MISSING", "The live reservation row did not expose a cancellation uuid.")]);
  }

  let receipt: Record<string, unknown>;
  try {
    receipt = await adapter.cancelReservation(preview.reservation.uuid);
  } catch (error) {
    throw wrapLibraryBookingWriteError("cancel", target, error);
  }

  let observed: LibraryReservation | undefined;
  try {
    observed = await getLibraryReservationInfo(adapter, target.reservationId);
  } catch (error) {
    throw libraryUnverifiedError(
      "cancel",
      target,
      receipt,
      `The upstream cancel returned success, but the reservation list could not be read back: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!observed) {
    return {
      action: "cancel",
      target,
      reservation: preview.reservation,
      receipt,
      verification: { status: "confirmed", message: "The exact reservation ID is absent from the live reservation list after cancellation." },
    };
  }
  throw libraryUnverifiedError("cancel", target, receipt, `Reservation '${target.reservationId}' was still present after cancellation.`);
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
  const hasReservationState = Object.prototype.hasOwnProperty.call(record, "resvInfos");
  const explicitlyClear = record.resvInfos === null
    || record.resvInfos === false
    || (Array.isArray(record.resvInfos) && record.resvInfos.length === 0);
  const reservationState = normaliseLibraryReservationSlots(record.resvInfos);
  const reserved = hasReservationState && !explicitlyClear;
  const roomId = numberValue(record.roomId);
  return {
    devId: numberValue(record.devId),
    ...(roomId > 0 ? { roomId } : {}),
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
    reserved,
    ...(reservationState.slots.length > 0 ? { reservationSlots: reservationState.slots } : {}),
    ...(!hasReservationState || reserved
      ? { reservationSlotsComplete: hasReservationState && reservationState.complete }
      : {}),
  };
}

function normaliseLibraryRoomOpenDay(
  raw: unknown,
): { fixedDay: string; openTimes: Array<{ start: string; end: string; limit: number }> } | undefined {
  const record = recordValue(raw);
  const fixedDay = stringValue(record.fixedDay || record.date || record.openDate).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fixedDay)) return undefined;
  const openTimes = arrayValue(record.openTimes).map((item) => {
    const time = recordValue(item);
    return {
      start: stringValue(time.openStartTime ?? time.start).trim(),
      end: stringValue(time.openEndTime ?? time.end).trim(),
      limit: numberValue(time.openLimit ?? time.limit),
    };
  }).filter((item) => item.start && item.end);
  return { fixedDay, openTimes };
}

export function normaliseLibraryReservation(raw: unknown): LibraryReservation {
  const record = recordValue(raw);
  const device = recordValue(arrayValue(record.resvDevInfoList)[0]);
  return {
    reservationId: numberValue(record.resvId),
    uuid: stringValue(record.uuid),
    devId: numberValue(device.devId ?? device.roomId),
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

function normalisePrimoPublicApiUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch (error) {
    throw new ServiceError("Primo public adapter requires an absolute HTTPS URL.", {
      url: input,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  if (url.protocol !== "https:") {
    throw new ServiceError("Primo public adapter only permits HTTPS requests.", { url: input });
  }
  if (url.origin !== LIBRARY_PRIMO_PUBLIC_BASE) {
    throw new ServiceError("Primo public adapter only permits the fixed SUSTech Primo public origin.", { url: input });
  }
  if (url.username || url.password) {
    throw new ServiceError("Primo public adapter rejects credentialed URLs.", { url: input });
  }
  if (!url.pathname.startsWith("/primaws/rest/pub/")) {
    throw new ServiceError("Primo public adapter only permits the public Primo REST path.", { url: input });
  }
  if (url.hash) {
    throw new ServiceError("Primo public adapter rejects URL fragments.", { url: input });
  }
  return url;
}

function normalisePrimoPublicHeaders(headersInit?: RequestInit["headers"]): Record<string, string> {
  const output: Record<string, string> = { ...PRIMO_PUBLIC_DEFAULT_HEADERS };
  const headers = new Headers(headersInit);
  for (const [name, value] of headers.entries()) {
    const lower = name.toLowerCase();
    const text = value.trim();
    if (!text) continue;
    if (lower === "accept" || lower === "accept-language" || lower === "user-agent") {
      output[lower] = text;
      continue;
    }
    if (lower === "referer") {
      output.referer = normalisePrimoPublicReferer(text);
    }
  }
  return output;
}

function normalisePrimoPublicReferer(value: string): string {
  let referer: URL;
  try {
    referer = new URL(value);
  } catch (error) {
    throw new ServiceError("Primo public adapter requires an absolute same-origin referer.", {
      url: value,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  if (referer.protocol !== "https:" || referer.origin !== LIBRARY_PRIMO_PUBLIC_BASE || !referer.pathname.startsWith("/discovery/")) {
    throw new ServiceError("Primo public adapter only permits same-origin Discovery referers.", { url: value });
  }
  if (referer.username || referer.password || referer.hash) {
    throw new ServiceError("Primo public adapter rejects unsafe referer URLs.", { url: value });
  }
  return referer.toString();
}

function normalisePrimoIncomingHeaders(headers: IncomingHttpHeaders): Headers {
  const normalized = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === "set-cookie") continue;
    if (Array.isArray(value)) {
      for (const item of value) normalized.append(name, item);
      continue;
    }
    if (value !== undefined) normalized.set(name, value);
  }
  return normalized;
}

function abortPrimoPublicRequest(reason?: unknown): Error {
  if (reason instanceof Error) return reason;
  const error = new Error(typeof reason === "string" && reason.trim() ? reason : "The operation was aborted.");
  error.name = "AbortError";
  return error;
}

function buildPrimoPublicSearchUrl(options: PrimoSearchOptions): string {
  return requestUrl(LIBRARY_PRIMO_PUBLIC_BASE, "/discovery/search", {
    vid: PRIMO_PUBLIC_VID,
    lang: normalisePrimoPublicLang(options.lang),
    query: buildPrimoQueryString(options),
    tab: PRIMO_PUBLIC_TAB,
    search_scope: primoPublicScope(options.scope),
    offset: normalisePrimoOffset(options.offset),
  });
}

function buildPrimoPublicDetailUrl(
  ref: PrimoRecordRef,
  lang?: string,
  scope: PrimoSearchOptions["scope"] = "default",
): string {
  const normalizedRef = parsePrimoRecordRef(ref);
  return requestUrl(LIBRARY_PRIMO_PUBLIC_BASE, "/discovery/fulldisplay", {
    docid: normalizedRef.docId,
    context: normalizedRef.context,
    vid: PRIMO_PUBLIC_VID,
    lang: normalisePrimoPublicLang(lang),
    tab: PRIMO_PUBLIC_TAB,
    search_scope: primoPublicScope(scope),
  });
}

function buildPrimoPublicSearchApiUrl(options: PrimoSearchOptions): string {
  return requestUrl(LIBRARY_PRIMO_PUBLIC_BASE, "/primaws/rest/pub/pnxs", {
    vid: PRIMO_PUBLIC_VID,
    inst: PRIMO_PUBLIC_INST,
    tab: PRIMO_PUBLIC_TAB,
    scope: primoPublicScope(options.scope),
    q: buildPrimoQueryString(options),
    lang: normalisePrimoPublicLang(options.lang),
    sort: primoPublicSort(options.sortBy),
    limit: normalisePrimoLimit(options.limit),
    offset: normalisePrimoOffset(options.offset),
    pcAvailability: true,
    disableCache: false,
    skipDelivery: "Y",
    newspapersActive: false,
    newspapersSearch: false,
    blendFacetsSeparately: false,
    rapido: false,
    refEntryActive: false,
    rtaLinks: true,
  });
}

function buildPrimoPublicDetailApiUrl(ref: PrimoRecordRef, lang?: string): string {
  const normalizedRef = parsePrimoRecordRef(ref);
  return requestUrl(
    LIBRARY_PRIMO_PUBLIC_BASE,
    `/primaws/rest/pub/pnxs/${encodeURIComponent(normalizedRef.context)}/${encodeURIComponent(normalizedRef.docId)}`,
    {
      vid: PRIMO_PUBLIC_VID,
      lang: normalisePrimoPublicLang(lang),
      inst: PRIMO_PUBLIC_INST,
    },
  );
}

function ensureSupportedPrimoApiOptions(options: PrimoSearchOptions): void {
  const unsupported: string[] = [];
  if (options.materialTypes?.length) unsupported.push("materialTypes");
  if (options.libraries?.length) unsupported.push("libraries");
  if (options.languages?.length) unsupported.push("languages");
  if (options.peerReviewed === true) unsupported.push("peerReviewed");
  if (options.fullTextOnline === true) unsupported.push("fullTextOnline");
  if (options.dateFrom) unsupported.push("dateFrom");
  if (options.dateTo) unsupported.push("dateTo");
  if ((options.mode ?? "basic") !== "basic") unsupported.push("mode");
  if ((options.displayMode ?? "full") !== "full") unsupported.push("displayMode");
  if (unsupported.length > 0) {
    throw new Error(`Primo public JSON search does not safely support ${unsupported.join(", ")} yet.`);
  }
}

function normalisePrimoPathSegment(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`A non-empty Primo ${label} is required.`);
  if (/[/?#]/.test(trimmed)) throw new Error(`Primo ${label} must not contain path separators or URL fragments.`);
  return trimmed;
}

function firstPrimoValue(value: unknown): string {
  return primoStrings(value)[0] ?? "";
}

function firstNonEmptyString(...values: unknown[]): string {
  for (const value of values) {
    const text = stringValue(value).trim();
    if (text) return text;
  }
  return "";
}

function primoStrings(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((entry) => primoStrings(entry));
  const text = stringValue(value).trim();
  return text ? [text] : [];
}

function primoSplitValues(value: unknown): string[] {
  return primoStrings(value)
    .flatMap((entry) => entry.split(/\s*;\s*|\s*\|\|\s*|\s+·\s+/))
    .map((entry) => cleanPrimoDisplayText(entry))
    .filter(Boolean);
}

function cleanPrimoDisplayText(value: unknown): string {
  // PNX uses subfield markers such as `$$Q`; expose the boundary without
  // leaking the control syntax. Do not split a bare middle dot because it is
  // a valid letter inside words such as Catalan `Intel·ligència`.
  return cleanText(stringValue(value).replace(/\$\$[A-Za-z0-9]/g, " · "));
}

function uniqueStrings(values: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = stringValue(value).trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

function normalisePrimoCreators(...values: unknown[]): string[] {
  return uniqueStrings(values.flatMap((value) => primoSplitValues(value)));
}

function extractPrimoEncodedLinks(value: unknown): string[] {
  const links: string[] = [];
  for (const entry of primoStrings(value)) {
    const matches = [...entry.matchAll(/\$\$U([^$]+)(?=\$\$|$)/g)];
    if (matches.length > 0) {
      for (const match of matches) {
        const url = stringValue(match[1]).trim();
        if (url) links.push(url);
      }
      continue;
    }
    if (/^https?:\/\//i.test(entry)) links.push(entry);
  }
  return uniqueStrings(links);
}

function primoHasFullText(record: Record<string, unknown>): boolean {
  const topDelivery = recordValue(record.delivery);
  const pnx = recordValue(record.pnx);
  const pnxDelivery = recordValue(pnx.delivery);
  for (const candidate of [record.fullText, record.full_text, topDelivery.fullText, topDelivery.full_text, pnxDelivery.fulltext]) {
    if (typeof candidate === "boolean") return candidate;
    if (typeof candidate === "number") return candidate !== 0;
    if (typeof candidate === "string") {
      const normalized = candidate.trim().toLowerCase();
      if (normalized === "true" || normalized === "1") return true;
      if (normalized === "false" || normalized === "0") return false;
    }
  }

  const indicators = uniqueStrings([
    ...primoStrings(topDelivery.availability),
    ...primoStrings(topDelivery.deliveryCategory),
    ...primoStrings(pnxDelivery.fulltext),
    ...primoStrings(pnxDelivery.delcategory),
  ]).map((entry) => entry.toLowerCase());
  if (indicators.some((entry) => /(^|[\s_-])(false|no|none|unavailable)([\s_-]|$)|no_fulltext|no_full_text|no_link|without_fulltext/.test(entry))) {
    return false;
  }
  if (indicators.some((entry) => /full[\s_-]?text|online|electronic|view[\s_-]?online|link[\s_-]?to[\s_-]?source/.test(entry))) {
    return true;
  }
  return false;
}

function primoIsPeerReviewed(
  display: Record<string, unknown>,
  facets: Record<string, unknown>,
  search: Record<string, unknown>,
  control: Record<string, unknown>,
  record: Record<string, unknown>,
): boolean {
  for (const candidate of [record.peerReviewed, record.peer_reviewed, display.peerreviewed, facets.peerreviewed]) {
    if (typeof candidate === "boolean") return candidate;
    if (typeof candidate === "number") return candidate !== 0;
    if (typeof candidate === "string") {
      const normalized = candidate.trim().toLowerCase();
      if (normalized === "true" || normalized === "1") return true;
      if (normalized === "false" || normalized === "0") return false;
    }
  }
  const indicators = uniqueStrings([
    ...primoStrings(display.lds50),
    ...primoStrings(facets.tlevel),
    ...primoStrings(search.toplevel),
    ...primoStrings(control.sourcerecordid),
  ]).map((entry) => entry.toLowerCase());
  return indicators.some((entry) => entry.includes("peer_reviewed") || entry.includes("peer-reviewed"));
}

function primoBuildSnippet(display: Record<string, unknown>, search: Record<string, unknown>): string {
  return cleanPrimoDisplayText(firstNonEmptyString(
    firstPrimoValue(display.description),
    firstPrimoValue(display.ispartof),
    primoSplitValues(display.subject).join("; "),
    primoSplitValues(search.subject).join("; "),
    firstPrimoValue(search.general),
  ));
}

function looksLikeLocalPrimoRecord(docId: string): boolean {
  return /^alma(?:[-_]|$|\d)/i.test(docId.trim());
}

function primoProtocolError(message: string, raw: unknown): ServiceError {
  return new ServiceError(message, {
    url: LIBRARY_PRIMO_PUBLIC_API,
    bodySample: sampleText(typeof raw === "string" ? raw : JSON.stringify(raw)),
  });
}

function primoRequestHeaders(referer: string): RequestInit["headers"] {
  return {
    ...PRIMO_PUBLIC_DEFAULT_HEADERS,
    referer,
  };
}

function normalisePrimoPublicLang(lang?: string): string {
  const normalized = lang?.trim();
  return normalized || "en";
}

function normalisePrimoLimit(limit?: number): number {
  if (!Number.isFinite(limit) || !limit || limit < 1) return PRIMO_PUBLIC_DEFAULT_LIMIT;
  return Math.max(1, Math.min(50, Math.trunc(limit)));
}

function normalisePrimoOffset(offset?: number): number {
  if (!Number.isFinite(offset) || !offset || offset < 0) return 0;
  return Math.trunc(offset);
}

function primoPublicScope(scope: PrimoSearchOptions["scope"] = "default"): string {
  switch (scope) {
    case "catalog":
      return "MyInstitution";
    case "eresource":
      return "CentralIndex";
    default:
      return "MyInst_and_CI";
  }
}

function primoPublicSort(sortBy: PrimoSearchOptions["sortBy"] = "relevance"): string {
  switch (sortBy) {
    case "date":
      return "date";
    case "title":
      return "stitle";
    case "author":
      return "author";
    default:
      return "rank";
  }
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

function flattenLibraryRooms(groups: readonly LibraryCampusGroup[]): LibraryRoom[] {
  return groups.flatMap((group) => group.labs.flatMap((lab) => lab.rooms));
}

function normaliseLibraryBookingCreateTarget(target: LibraryBookingCreateTarget): LibraryBookingCreateTarget {
  return {
    classKind: target.classKind,
    kindId: target.kindId,
    labId: target.labId,
    devId: target.devId,
    title: target.title.trim(),
    start: target.start.trim(),
    end: target.end.trim(),
    memberKind: target.memberKind,
    members: [...target.members],
    memo: target.memo?.trim() ?? "",
  };
}

function normaliseMemberList(values: readonly number[], accNo: number): { values: number[]; invalid?: string } {
  const list = values.length > 0 ? [...values] : [accNo];
  const deduped = [...new Set(list)];
  if (deduped.some((value) => !Number.isSafeInteger(value) || value < 1)) {
    return { values: deduped.filter((value) => Number.isSafeInteger(value) && value > 0), invalid: "Member accNo values must be positive integers." };
  }
  if (deduped.length !== list.length) {
    return { values: deduped, invalid: "Member accNo values must be unique." };
  }
  return { values: deduped };
}

function formatLibraryReservationDateTime(value: string): string {
  const parsed = parseObservedLibraryDateTime(value);
  if (!parsed) return value;
  return `${parsed.date} ${parsed.time}:00`;
}

interface ParsedLibraryDateTime {
  epochMs: number;
  date: string;
  time: string;
}

function parseObservedLibraryDateTime(value: string): ParsedLibraryDateTime | undefined {
  const trimmed = value.trim();
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2}))?/.exec(trimmed);
  const normalized = match
    ? `${match[1]}T${match[2]}:${match[3] ?? "00"}`
    : trimmed.replace(" ", "T");
  const withOffset = /(?:[zZ]|[+-]\d{2}:\d{2})$/.test(trimmed) ? trimmed : `${normalized}+08:00`;
  const date = new Date(withOffset);
  if (!match || Number.isNaN(date.getTime())) return undefined;
  return {
    epochMs: date.getTime(),
    date: match[1],
    time: match[2],
  };
}

function parseObservedLibraryDateTimeRange(start: string, end: string): {
  start?: ParsedLibraryDateTime;
  end?: ParsedLibraryDateTime;
} {
  return {
    start: parseObservedLibraryDateTime(start),
    end: parseObservedLibraryDateTime(end),
  };
}

function fitsLibraryOpenWindow(room: LibraryRoom, start: string, end: string): boolean {
  if (room.openTimes.length === 0) return true;
  const startMinutes = parseLibraryClockMinutes(start);
  const endMinutes = parseLibraryClockMinutes(end);
  if (startMinutes === undefined || endMinutes === undefined) return false;
  return room.openTimes.some((window) => {
    const windowStart = parseLibraryClockMinutes(window.start);
    const windowEnd = parseLibraryClockMinutes(window.end);
    return windowStart !== undefined
      && windowEnd !== undefined
      && startMinutes >= windowStart
      && endMinutes <= windowEnd;
  });
}

function parseLibraryClockMinutes(value: string): number | undefined {
  const match = /^(\d{2}):(\d{2})/.exec(value);
  if (!match) return undefined;
  return Number(match[1]) * 60 + Number(match[2]);
}

function classifyLibraryRoomCapacity(devName: string): "solo" | "group" | "unknown" {
  const normalized = devName
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[~～–—]/g, "-")
    .replace(/\s+/g, " ");
  const range = /\((\d+)\s*-\s*(\d+)\s*(?:人|位|people|persons?)?\)/.exec(normalized);
  if (range) return Number(range[1]) >= 3 ? "group" : "solo";
  const plus = /\((\d+)\s*(?:人|位|people|persons?)?\s*(?:以上|\+|or more|and above)\)/.exec(normalized);
  if (plus) return Number(plus[1]) >= 3 ? "group" : "solo";
  return "unknown";
}

function inspectLibraryRoomSlot(
  room: LibraryRoom,
  openDays: readonly { fixedDay: string; openTimes: Array<{ start: string; end: string; limit: number }> }[],
  requestedDate: string,
  startTime: string,
  endTime: string,
  startEpochMs: number,
  endEpochMs: number,
): LibrarySlotCheck {
  if (room.reservationSlotsComplete === false) {
    return {
      status: "unavailable",
      date: requestedDate,
      overlaps: [],
      message: "The room inventory did not expose a complete parseable reservation state, so overlap cannot be ruled out safely.",
    };
  }
  const day = openDays.find((entry) => entry.fixedDay === requestedDate);
  if (!day) {
    return {
      status: "unavailable",
      date: requestedDate,
      overlaps: [],
      message: `The exact room open-times endpoint returned no usable availability for ${requestedDate}.`,
    };
  }
  const startMinutes = parseLibraryClockMinutes(startTime);
  const endMinutes = parseLibraryClockMinutes(endTime);
  const windows = day.openTimes.map((window) => ({
    ...window,
    startMinutes: parseLibraryClockMinutes(window.start),
    endMinutes: parseLibraryClockMinutes(window.end),
  }));
  if (
    startMinutes === undefined
    || endMinutes === undefined
    || day.openTimes.length !== windows.length
    || windows.some((window) => window.startMinutes === undefined || window.endMinutes === undefined)
  ) {
    return {
      status: "unavailable",
      date: requestedDate,
      overlaps: [],
      message: `The exact room open-times endpoint returned an unreadable window for ${requestedDate}.`,
    };
  }
  const slots = room.reservationSlots ?? [];
  const overlaps = slots.filter((slot) => {
    const parsed = parseObservedLibraryDateTimeRange(slot.start, slot.end);
    return Boolean(
      parsed.start
      && parsed.end
      && parsed.start.epochMs < endEpochMs
      && parsed.end.epochMs > startEpochMs,
    );
  });
  if (overlaps.length > 0) {
    return {
      status: "occupied",
      date: requestedDate,
      overlaps,
      message: `Room '${room.devName}' already has ${overlaps.length} overlapping reservation(s) in the requested time window.`,
    };
  }
  if (room.reserved && slots.length === 0) {
    return {
      status: "unavailable",
      date: requestedDate,
      overlaps: [],
      message: "The room is marked reserved, but the inventory did not expose parseable reservation windows for verification.",
    };
  }
  const contained = windows.some((window) =>
    startMinutes >= (window.startMinutes ?? Number.POSITIVE_INFINITY)
    && endMinutes <= (window.endMinutes ?? Number.NEGATIVE_INFINITY)
  );
  if (!contained) {
    return {
      status: "occupied",
      date: requestedDate,
      overlaps,
      message: overlaps.length > 0
        ? `Room '${room.devName}' already has ${overlaps.length} overlapping reservation(s) in the requested time window.`
        : `The exact room open-times endpoint did not include ${startTime}-${endTime} inside any open interval for ${requestedDate}.`,
    };
  }
  return {
    status: "available",
    date: requestedDate,
    overlaps,
  };
}

function normaliseLibraryReservationSlots(raw: unknown): {
  slots: LibraryRoomReservationSlot[];
  complete: boolean;
} {
  const candidates = flattenReservationSlotCandidates(raw);
  const parsed = candidates.map((value) => normaliseLibraryReservationSlot(value));
  return {
    slots: dedupeLibraryReservationSlots(parsed),
    complete: candidates.length > 0 && parsed.every((slot) => slot !== undefined),
  };
}

function flattenReservationSlotCandidates(raw: unknown): unknown[] {
  if (raw === null || raw === undefined || raw === false) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== "object") return [];
  const record = recordValue(raw);
  if (Array.isArray(record.data)) return record.data;
  if (Array.isArray(record.rows)) return record.rows;
  if (Array.isArray(record.list)) return record.list;
  if (Array.isArray(record.items)) return record.items;
  return [record];
}

function normaliseLibraryReservationSlot(raw: unknown): LibraryRoomReservationSlot | undefined {
  const record = recordValue(raw);
  const start = reservationDateTime(
    record.resvBeginTime
      ?? record.beginTime
      ?? record.start
      ?? record.startTime
      ?? record.begin,
  ).trim();
  const end = reservationDateTime(
    record.resvEndTime
      ?? record.endTime
      ?? record.end
      ?? record.endTimeStr
      ?? record.finishTime
      ?? record.stopTime,
  ).trim();
  const parsed = parseObservedLibraryDateTimeRange(start, end);
  if (!parsed.start || !parsed.end) return undefined;
  return {
    title: cleanText(record.testName ?? record.title ?? record.meetingName ?? record.name) || "Reserved slot",
    start,
    end,
  };
}

function dedupeLibraryReservationSlots(slots: Array<LibraryRoomReservationSlot | undefined>): LibraryRoomReservationSlot[] {
  const seen = new Set<string>();
  const output: LibraryRoomReservationSlot[] = [];
  for (const slot of slots) {
    if (!slot) continue;
    const key = `${slot.start}|${slot.end}|${slot.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(slot);
  }
  return output;
}

async function readLibraryReservationForVerification(
  adapter: ServiceAdapter,
  action: "create" | "cancel",
  target: LibraryBookingCreateTarget | LibraryBookingCancelTarget,
  receipt: Record<string, unknown>,
  reservationId: number,
  range: { start: string; end: string },
): Promise<LibraryReservation | undefined> {
  try {
    if (reservationId > 0) return await getLibraryReservationInfo(adapter, reservationId, range);
    const page = await listLibraryReservationsPage(adapter, {
      start: range.start,
      end: range.end,
      page: 1,
      pageSize: 200,
    });
    const matches = page.reservations.filter((entry) => action === "create" && libraryReservationMatchesTarget(entry, target as LibraryBookingCreateTarget));
    return matches.length === 1 ? matches[0] : undefined;
  } catch (error) {
    throw libraryUnverifiedError(
      action,
      target,
      receipt,
      `The upstream ${action} returned success, but live read-back failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function libraryReservationMatchesTarget(
  reservation: LibraryReservation,
  target: LibraryBookingCreateTarget,
  expectedUuid = "",
): boolean {
  const begin = parseObservedLibraryDateTime(reservation.beginTime);
  const end = parseObservedLibraryDateTime(reservation.endTime);
  const desired = parseObservedLibraryDateTimeRange(target.start, target.end);
  return reservation.devId === target.devId
    && reservation.title.trim() === target.title.trim()
    && Boolean(begin && end && desired.start && desired.end)
    && begin?.epochMs === desired.start?.epochMs
    && end?.epochMs === desired.end?.epochMs
    && (!expectedUuid || reservation.uuid === expectedUuid);
}

function libraryPrecheckError(
  action: "create" | "cancel",
  target: LibraryBookingCreateTarget | LibraryBookingCancelTarget,
  blockers: readonly LibraryBookingMutationIssue[],
): CliError {
  return new CliError(
    `Library booking ${action} is blocked by the current live preflight state.`,
    "LIBRARY_BOOKING_PRECHECK_FAILED",
    4,
    {
      action,
      target,
      blockers,
      warning: "NO_MUTATION_PERFORMED",
    },
  );
}

function wrapLibraryBookingWriteError(
  action: "create" | "cancel",
  target: LibraryBookingCreateTarget | LibraryBookingCancelTarget,
  error: unknown,
): CliError {
  if (error instanceof CliError && error.code === "SERVICE_UPSTREAM_ERROR") {
    return new CliError(
      `Library booking ${action} was rejected by the upstream service before verification.`,
      action === "create" ? "LIBRARY_BOOKING_CREATE_REJECTED" : "LIBRARY_BOOKING_CANCEL_REJECTED",
      4,
      {
        action,
        target,
        upstream: error.details,
        warning: "NO_MUTATION_PERFORMED",
      },
    );
  }
  if (error instanceof CliError && ["NETWORK_ERROR", "NETWORK_TIMEOUT", "SERVICE_HTTP_ERROR", "SERVICE_PROTOCOL_ERROR", "UNSAFE_REDIRECT", "CAMPUS_NETWORK_REQUIRED"].includes(error.code)) {
    return libraryUnverifiedError(
      action,
      target,
      {},
      `Library booking ${action} may or may not have reached the upstream service: ${error.message}`,
      { upstream: { code: error.code, ...(error.details ?? {}) } },
    );
  }
  return error instanceof CliError
    ? error
    : new CliError(String(error), action === "create" ? "LIBRARY_BOOKING_CREATE_FAILED" : "LIBRARY_BOOKING_CANCEL_FAILED", 1);
}

function libraryUnverifiedError(
  action: "create" | "cancel",
  target: LibraryBookingCreateTarget | LibraryBookingCancelTarget,
  receipt: Record<string, unknown>,
  message: string,
  extra: Record<string, unknown> = {},
): CliError {
  return new CliError(
    `Library booking ${action} was accepted or attempted, but the exact outcome could not be verified. ${message}`,
    "LIBRARY_BOOKING_WRITE_UNVERIFIED",
    5,
    {
      action,
      target,
      receipt,
      warning: "DO_NOT_RETRY_AUTOMATICALLY",
      ...extra,
    },
  );
}

function libraryIssue(code: string, message: string): LibraryBookingMutationIssue {
  return { code, message };
}

function todayShanghai(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function addIsoDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00+08:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetweenShanghai(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00+08:00`).getTime();
  const end = new Date(`${endDate}T00:00:00+08:00`).getTime();
  return Math.floor((end - start) / (24 * 60 * 60 * 1000));
}
