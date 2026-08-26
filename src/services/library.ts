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
  summary: "The CLI resolves the dynamic authcenter service URL, completes CAS, and exposes read plus typed mutation IC booking APIs.",
  notes: [
    "The IC booking cookie remains in memory and is never returned in command output.",
    "Identity, idle-summary, lab, and reservation-count reads completed an opt-in live smoke test on 2026-08-26.",
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
  devId: number;
  title: string;
  roomName: string;
  labName: string;
  beginTime: string;
  endTime: string;
  status: number;
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
  return matches.length === 1 ? matches[0] : matches[0];
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
  const checkedAt = (options.now ?? new Date()).toISOString();
  const now = options.now ?? new Date();
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
      if (!fitsLibraryOpenWindow(room, timing.start.time, timing.end.time)) {
        blockers.push(libraryIssue(
          "OUTSIDE_OPEN_WINDOW",
          `Room '${room.devName}' is not open for the selected local time window.`,
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
  warnings.push(libraryIssue(
    "SLOT_AVAILABILITY_UNVERIFIED",
    "This preview checks room inventory, member rules, and policy constraints only; the upstream service may still reject the reservation if the exact slot is already occupied.",
  ));

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
  const checkedAt = (options.now ?? new Date()).toISOString();
  const now = options.now ?? new Date();
  const reservation = await getLibraryReservationInfo(adapter, target.reservationId);
  const blockers: LibraryBookingMutationIssue[] = [];
  if (!reservation) {
    blockers.push(libraryIssue("RESERVATION_NOT_FOUND", `Reservation '${target.reservationId}' was not present in the live reservation list.`));
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
): Promise<LibraryBookingCreateSuccess> {
  const preview = await buildLibraryBookingCreatePreview(adapter, target);
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
): Promise<LibraryBookingCancelSuccess> {
  const preview = await buildLibraryBookingCancelPreview(adapter, target);
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
