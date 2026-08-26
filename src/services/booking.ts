import { randomUUID } from "node:crypto";
import { CliError } from "../core/errors.js";
import {
  arrayValue,
  booleanValue,
  fetchJson,
  numberValue,
  recordValue,
  stringValue,
} from "./base.js";
import type { ServiceAdapter, ServiceStatus } from "./base.js";

export const BOOKING_BASE = "https://booking.sustech.edu.cn";
export const BOOKING_API = `${BOOKING_BASE}/api/SystemApi`;

export const BOOKING_STATUS: ServiceStatus = {
  service: "booking",
  availability: "implemented",
  auth: "bearer-header",
  campusNetwork: true,
  browser: false,
  summary: "The CLI performs the CAS ticket and GetUserProfile token handshake, then exposes read and typed mutation eHall booking APIs.",
  notes: [
    "The service must be reachable from the campus network or an approved campus access path.",
    "Credentials, cookies, CAS tickets, and the booking token remain in memory and are never returned in command output.",
    "The room-list path completed an opt-in read-only live smoke test on 2026-08-26.",
    "Create/cancel mutations are exposed only through typed preview/apply flows with explicit confirmation and post-readback verification.",
  ],
  endpoints: [
    "/redirect",
    "/api/SystemApi/AddMeeting",
    "/api/SystemApi/CancelMeeting",
    "/api/SystemApi/GetMeetingRoomAllByCondition",
    "/api/SystemApi/GetMyMeetings",
    "/api/SystemApi/GetUserProfile",
  ],
};

const AUTH_ERROR_MESSAGES = [
  "Authorization is NULL",
  "Authorization is invalid",
  "未登录",
  "请先登录",
];

export interface BookingRoom {
  id: string;
  name: string;
  roomType: string;
  capacity: number;
  location: string;
  available: boolean;
  approvalRequired: boolean;
  bookableDaysAhead: number;
  bookStart: string;
  bookEnd: string;
  longitude: number;
  latitude: number;
  department: string;
  equipment: string[];
  managers: string[];
}

export interface BookingMeeting {
  id: string;
  roomId: string;
  roomName: string;
  title: string;
  startAt: string;
  endAt: string;
  status: string;
  unread: boolean;
}

export interface BookingMutationIssue {
  code: string;
  message: string;
}

export interface BookingCreateTarget {
  roomId: string;
  title: string;
  start: string;
  end: string;
  participants: number;
  description?: string;
}

export interface BookingCancelTarget {
  meetingId: string;
}

export interface BookingCreatePreview {
  checkedAt: string;
  action: "create";
  target: BookingCreateTarget;
  room?: BookingRoom;
  blockers: BookingMutationIssue[];
  warnings: BookingMutationIssue[];
  applyAllowed: boolean;
}

export interface BookingCancelPreview {
  checkedAt: string;
  action: "cancel";
  target: BookingCancelTarget;
  meeting?: BookingMeeting;
  blockers: BookingMutationIssue[];
  warnings: BookingMutationIssue[];
  applyAllowed: boolean;
}

export interface BookingCreateSuccess {
  action: "create";
  target: BookingCreateTarget;
  room: BookingRoom;
  receipt: Record<string, unknown>;
  meeting: BookingMeeting;
  verification: { status: "confirmed"; message: string };
}

export interface BookingCancelSuccess {
  action: "cancel";
  target: BookingCancelTarget;
  meeting: BookingMeeting;
  receipt: Record<string, unknown>;
  verification: { status: "confirmed"; message: string };
}

export interface BookingMutationAdapter extends ServiceAdapter {
  addMeeting(input: BookingCreateTarget): Promise<Record<string, unknown>>;
  cancelMeeting(meetingId: string): Promise<Record<string, unknown>>;
}

export interface BookingEnvelope<T> {
  MessageType: 1002;
  MessageID: string;
  Data: T;
}

export function buildBookingEnvelope<T>(data: T, messageId = randomUUID()): BookingEnvelope<T> {
  return {
    MessageType: 1002,
    MessageID: messageId,
    Data: data,
  };
}

export async function listBookingRooms(
  adapter: ServiceAdapter,
  options: { page?: number; pageSize?: number; keyword?: string } = {},
): Promise<BookingRoom[]> {
  const payload = await callBooking(adapter, "GetMeetingRoomAllByCondition", {
    page: options.page ?? 1,
    rows: options.pageSize ?? 100,
  });
  const rooms = arrayValue(recordValue(payload).rows).map((item) => normaliseBookingRoom(item));
  const keyword = options.keyword?.trim().toLowerCase();
  if (!keyword) return rooms;
  return rooms.filter((room) =>
    room.name.toLowerCase().includes(keyword)
    || room.id.toLowerCase().includes(keyword)
    || room.roomType.toLowerCase().includes(keyword)
    || room.department.toLowerCase().includes(keyword)
    || room.location.toLowerCase().includes(keyword),
  );
}

export async function listMyBookingMeetings(
  adapter: ServiceAdapter,
  options: { page?: number; pageSize?: number } = {},
): Promise<BookingMeeting[]> {
  const payload = await callBooking(adapter, "GetMyMeetings", {
    page: options.page ?? 1,
    rows: options.pageSize ?? 50,
  });
  return arrayValue(recordValue(payload).rows).map((item) => normaliseBookingMeeting(item));
}

export async function buildBookingCreatePreview(
  adapter: ServiceAdapter,
  target: BookingCreateTarget,
  options: { now?: Date } = {},
): Promise<BookingCreatePreview> {
  const checkedAt = (options.now ?? new Date()).toISOString();
  const room = await findBookingRoom(adapter, target.roomId);
  const blockers: BookingMutationIssue[] = [];
  const warnings: BookingMutationIssue[] = [];
  const normalisedTarget = normaliseBookingCreateTarget(target);
  const timing = parseShanghaiRange(normalisedTarget.start, normalisedTarget.end);

  if (!normalisedTarget.title) {
    blockers.push(issue("TITLE_REQUIRED", "A non-empty meeting title is required."));
  }
  if (normalisedTarget.participants < 1) {
    blockers.push(issue("PARTICIPANTS_INVALID", "Participants must be at least 1."));
  }
  if (!room) {
    blockers.push(issue("ROOM_NOT_FOUND", `Room '${normalisedTarget.roomId}' was not found in the live room inventory.`));
  }
  if (!timing.start || !timing.end) {
    blockers.push(issue("TIME_INVALID", "Start and end must be valid local date-times."));
  } else {
    if (timing.start.epochMs < (options.now ?? new Date()).getTime()) {
      blockers.push(issue("START_IN_PAST", "The meeting start time is already in the past."));
    }
    if (timing.end.epochMs <= timing.start.epochMs) {
      blockers.push(issue("TIME_ORDER_INVALID", "End time must be after start time."));
    }
    if (timing.end.epochMs - timing.start.epochMs > 8 * 60 * 60 * 1000) {
      blockers.push(issue("DURATION_EXCEEDS_LIMIT", "Booking duration cannot exceed 8 hours."));
    }
    if (timing.start.date !== timing.end.date) {
      blockers.push(issue("MULTI_DAY_UNSUPPORTED", "Booking create only supports a single local calendar day."));
    }
  }

  if (room && timing.start && timing.end) {
    if (!room.available) {
      blockers.push(issue("ROOM_UNAVAILABLE", `Room '${room.name || room.id}' is currently marked unavailable.`));
    }
    if (room.capacity > 0 && normalisedTarget.participants > room.capacity) {
      blockers.push(issue("PARTICIPANTS_EXCEED_CAPACITY", `Participants (${normalisedTarget.participants}) exceed room capacity (${room.capacity}).`));
    }
    const daysAhead = daysBetweenShanghai(todayShanghai(options.now ?? new Date()), timing.start.date);
    if (room.bookableDaysAhead > 0 && daysAhead > room.bookableDaysAhead) {
      blockers.push(issue(
        "ADVANCE_WINDOW_EXCEEDED",
        `Room '${room.name || room.id}' allows booking only ${room.bookableDaysAhead} day(s) ahead; target is ${daysAhead} day(s) ahead.`,
      ));
    }
    if (!withinRoomWindow(room.bookStart, room.bookEnd, timing.start.time, timing.end.time)) {
      blockers.push(issue(
        "OUTSIDE_BOOKABLE_WINDOW",
        `Room '${room.name || room.id}' is bookable only during ${room.bookStart.slice(0, 5)}-${room.bookEnd.slice(0, 5)}.`,
      ));
    }
    if (room.approvalRequired) {
      warnings.push(issue(
        "APPROVAL_REQUIRED",
        `Room '${room.name || room.id}' requires approval after booking; verify downstream approval status manually.`,
      ));
    }
  }

  return {
    checkedAt,
    action: "create",
    target: normalisedTarget,
    ...(room ? { room } : {}),
    blockers,
    warnings,
    applyAllowed: blockers.length === 0,
  };
}

export async function buildBookingCancelPreview(
  adapter: ServiceAdapter,
  target: BookingCancelTarget,
  options: { now?: Date } = {},
): Promise<BookingCancelPreview> {
  const checkedAt = (options.now ?? new Date()).toISOString();
  const meetings = await listMyBookingMeetings(adapter, { page: 1, pageSize: 500 });
  const meeting = meetings.find((entry) => sameOpaqueId(entry.id, target.meetingId));
  const blockers = meeting
    ? []
    : [issue("MEETING_NOT_FOUND", `Meeting '${target.meetingId}' was not present in the live My Meetings list.`)];
  return {
    checkedAt,
    action: "cancel",
    target,
    ...(meeting ? { meeting } : {}),
    blockers,
    warnings: [],
    applyAllowed: blockers.length === 0,
  };
}

export async function applyBookingCreate(
  adapter: BookingMutationAdapter,
  target: BookingCreateTarget,
): Promise<BookingCreateSuccess> {
  const preview = await buildBookingCreatePreview(adapter, target);
  if (!preview.applyAllowed || !preview.room) {
    throw bookingPrecheckError("create", preview.target, preview.blockers);
  }

  let receipt: Record<string, unknown>;
  try {
    receipt = await adapter.addMeeting({
      ...preview.target,
      description: preview.target.description ?? "",
    });
  } catch (error) {
    throw wrapBookingWriteError("create", preview.target, error);
  }

  const meetingId = extractBookingMeetingId(receipt);
  const meetings = await readBookingMeetingsForVerification(adapter, "create", preview.target, receipt);
  const matching = meetings.filter((meeting) => bookingMeetingMatchesTarget(meeting, preview.target));
  if (meetingId) {
    const observed = meetings.find((meeting) => sameOpaqueId(meeting.id, meetingId));
    if (observed && bookingMeetingMatchesTarget(observed, preview.target)) {
      return {
        action: "create",
        target: preview.target,
        room: preview.room,
        receipt,
        meeting: observed,
        verification: { status: "confirmed", message: "The created meeting ID and exact room/time were read back from My Meetings." },
      };
    }
    throw bookingUnverifiedError(
      "create",
      preview.target,
      receipt,
      observed
        ? "Booking returned a meeting ID, but the read-back meeting did not match the exact room/time target."
        : `Booking returned meeting ID '${meetingId}', but that exact meeting was not observed in My Meetings.`,
    );
  }
  if (matching.length === 1 && sameOpaqueId(preview.room.id, matching[0]?.roomId ?? "")) {
    return {
      action: "create",
      target: preview.target,
      room: preview.room,
      receipt,
      meeting: matching[0],
      verification: { status: "confirmed", message: "The exact room/time tuple was read back from My Meetings." },
    };
  }
  if (matching.length > 1) {
    throw bookingUnverifiedError("create", preview.target, receipt, "Multiple exact room/time matches were observed; the created booking is ambiguous.");
  }
  throw bookingUnverifiedError("create", preview.target, receipt, "Booking succeeded upstream, but the exact room/time was not yet visible in My Meetings.");
}

export async function applyBookingCancel(
  adapter: BookingMutationAdapter,
  target: BookingCancelTarget,
): Promise<BookingCancelSuccess> {
  const preview = await buildBookingCancelPreview(adapter, target);
  if (!preview.applyAllowed || !preview.meeting) {
    throw bookingPrecheckError("cancel", target, preview.blockers);
  }

  let receipt: Record<string, unknown>;
  try {
    receipt = await adapter.cancelMeeting(target.meetingId);
  } catch (error) {
    throw wrapBookingWriteError("cancel", target, error);
  }

  const meetings = await readBookingMeetingsForVerification(adapter, "cancel", target, receipt);
  if (!meetings.some((meeting) => sameOpaqueId(meeting.id, target.meetingId))) {
    return {
      action: "cancel",
      target,
      meeting: preview.meeting,
      receipt,
      verification: { status: "confirmed", message: "The exact meeting ID is absent from My Meetings after cancellation." },
    };
  }
  throw bookingUnverifiedError("cancel", target, receipt, `Meeting '${target.meetingId}' was still present in My Meetings after cancellation.`);
}

export function looksLikeBookingAuthError(raw: unknown): boolean {
  const record = recordValue(raw);
  if (record.IsSuccess === true) return false;
  const message = stringValue(record.Message);
  return AUTH_ERROR_MESSAGES.some((token) => message.includes(token));
}

export function normaliseBookingRoom(raw: unknown): BookingRoom {
  const record = recordValue(raw);
  return {
    id: stringValue(record.MeetingRoomID),
    name: stringValue(record.MeetingRoomName),
    roomType: stringValue(record.MeetingRoomType),
    capacity: numberValue(record.CapacityNumber),
    location: stringValue(record.MeetingRoomLocal),
    available: booleanValue(record.IsAvailable),
    approvalRequired: booleanValue(record.IsApproval),
    bookableDaysAhead: numberValue(record.NumberOfDaysAhead),
    bookStart: extractTime(stringValue(record.CanBookStartTime)),
    bookEnd: extractTime(stringValue(record.CanBookEndTime)),
    longitude: numberValue(record.Longitude),
    latitude: numberValue(record.Latitude),
    department: stringValue(record.DeptName),
    equipment: arrayValue(record.MeetingRoomEquipments)
      .map((item) => stringValue(recordValue(item).EquipmentName))
      .filter(Boolean),
    managers: arrayValue(record.MeetingRoomManagers)
      .map((item) => stringValue(recordValue(recordValue(item).UserInfoModel).XM))
      .filter(Boolean),
  };
}

export function normaliseBookingMeeting(raw: unknown): BookingMeeting {
  const record = recordValue(raw);
  return {
    id: stringValue(record.MeetingID ?? record.ID),
    roomId: stringValue(record.MeetingRoomID),
    roomName: stringValue(record.MeetingRoomName),
    title: stringValue(record.MeetingName ?? record.Title),
    startAt: stringValue(record.StartTime ?? record.MeetingStart),
    endAt: stringValue(record.EndTime ?? record.MeetingEnd),
    status: stringValue(record.Status ?? record.MeetingStatus),
    unread: booleanValue(record.IsUnread ?? record.Unread),
  };
}

async function callBooking(adapter: ServiceAdapter, method: string, data: Record<string, unknown>): Promise<unknown> {
  const url = `${BOOKING_API}/${method}`;
  const response = await fetchJson<unknown>(adapter, url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(buildBookingEnvelope(data)),
  });
  const record = recordValue(response);
  if (looksLikeBookingAuthError(record)) {
    throw new CliError("The booking session was rejected by the upstream service.", "AUTHENTICATION_FAILED", 2, {
      service: "booking",
      operation: method,
    });
  }
  if (record.IsSuccess !== true) {
    throw new CliError("Booking returned an application error.", "SERVICE_UPSTREAM_ERROR", 1, {
      service: "booking",
      operation: method,
      errorCode: record.ErrorCode,
      message: stringValue(record.Message) || "unknown error",
    });
  }
  return record.Data;
}

function extractTime(value: string): string {
  const match = /T(\d{2}:\d{2}:\d{2})/.exec(value);
  return match?.[1] ?? value;
}

function normaliseBookingCreateTarget(target: BookingCreateTarget): BookingCreateTarget {
  return {
    roomId: target.roomId.trim(),
    title: target.title.trim(),
    start: target.start.trim(),
    end: target.end.trim(),
    participants: target.participants,
    description: target.description?.trim() ?? "",
  };
}

async function findBookingRoom(adapter: ServiceAdapter, roomId: string): Promise<BookingRoom | undefined> {
  const rooms = await listBookingRooms(adapter, { page: 1, pageSize: 500 });
  return rooms.find((room) => sameOpaqueId(room.id, roomId));
}

async function readBookingMeetingsForVerification(
  adapter: ServiceAdapter,
  action: "create" | "cancel",
  target: BookingCreateTarget | BookingCancelTarget,
  receipt: Record<string, unknown>,
): Promise<BookingMeeting[]> {
  try {
    return await listMyBookingMeetings(adapter, { page: 1, pageSize: 500 });
  } catch (error) {
    throw bookingUnverifiedError(
      action,
      target,
      receipt,
      `The upstream write returned success, but My Meetings could not be read back: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function bookingMeetingMatchesTarget(meeting: BookingMeeting, target: BookingCreateTarget): boolean {
  const start = parseObservedDateTime(meeting.startAt);
  const end = parseObservedDateTime(meeting.endAt);
  const expected = parseShanghaiRange(target.start, target.end);
  return sameOpaqueId(meeting.roomId, target.roomId)
    && meeting.title.trim() === target.title.trim()
    && Boolean(start && end && expected.start && expected.end)
    && start?.epochMs === expected.start?.epochMs
    && end?.epochMs === expected.end?.epochMs;
}

function extractBookingMeetingId(receipt: Record<string, unknown>): string {
  return stringValue(receipt.MeetingID ?? receipt.MeetingId ?? receipt.ID ?? receipt.id).trim();
}

function bookingPrecheckError(
  action: "create" | "cancel",
  target: BookingCreateTarget | BookingCancelTarget,
  blockers: readonly BookingMutationIssue[],
): CliError {
  return new CliError(
    `Booking ${action} is blocked by the current live preflight state.`,
    "BOOKING_PRECHECK_FAILED",
    4,
    {
      action,
      target,
      blockers,
      warning: "NO_MUTATION_PERFORMED",
    },
  );
}

function wrapBookingWriteError(
  action: "create" | "cancel",
  target: BookingCreateTarget | BookingCancelTarget,
  error: unknown,
): CliError {
  if (error instanceof CliError && error.code === "SERVICE_UPSTREAM_ERROR") {
    return new CliError(
      `Booking ${action} was rejected by the upstream service before verification.`,
      action === "create" ? "BOOKING_CREATE_REJECTED" : "BOOKING_CANCEL_REJECTED",
      4,
      {
        action,
        target,
        upstream: error.details,
        warning: "NO_MUTATION_PERFORMED",
      },
    );
  }
  if (error instanceof CliError && ["NETWORK_ERROR", "NETWORK_TIMEOUT", "SERVICE_HTTP_ERROR", "SERVICE_PROTOCOL_ERROR", "NETWORK_RESTRICTED", "UNSAFE_REDIRECT"].includes(error.code)) {
    return bookingUnverifiedError(
      action,
      target,
      {},
      `Booking ${action} may or may not have reached the upstream service: ${error.message}`,
      { upstream: { code: error.code, ...(error.details ?? {}) } },
    );
  }
  return error instanceof CliError
    ? error
    : new CliError(String(error), action === "create" ? "BOOKING_CREATE_FAILED" : "BOOKING_CANCEL_FAILED", 1);
}

function bookingUnverifiedError(
  action: "create" | "cancel",
  target: BookingCreateTarget | BookingCancelTarget,
  receipt: Record<string, unknown>,
  message: string,
  extra: Record<string, unknown> = {},
): CliError {
  return new CliError(
    `Booking ${action} was accepted or attempted, but the exact outcome could not be verified. ${message}`,
    "BOOKING_WRITE_UNVERIFIED",
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

function issue(code: string, message: string): BookingMutationIssue {
  return { code, message };
}

function sameOpaqueId(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function parseShanghaiRange(start: string, end: string): {
  start?: ParsedDateTime;
  end?: ParsedDateTime;
} {
  return {
    start: parseObservedDateTime(start),
    end: parseObservedDateTime(end),
  };
}

interface ParsedDateTime {
  epochMs: number;
  date: string;
  time: string;
}

function parseObservedDateTime(value: string): ParsedDateTime | undefined {
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

function withinRoomWindow(roomStart: string, roomEnd: string, meetingStart: string, meetingEnd: string): boolean {
  const startMinutes = parseClockMinutes(roomStart);
  const endMinutes = parseClockMinutes(roomEnd);
  const meetingStartMinutes = parseClockMinutes(meetingStart);
  const meetingEndMinutes = parseClockMinutes(meetingEnd);
  if (startMinutes === undefined || endMinutes === undefined || meetingStartMinutes === undefined || meetingEndMinutes === undefined) {
    return true;
  }
  return meetingStartMinutes >= startMinutes && meetingEndMinutes <= endMinutes;
}

function parseClockMinutes(value: string): number | undefined {
  const match = /^(\d{2}):(\d{2})/.exec(value);
  if (!match) return undefined;
  return Number(match[1]) * 60 + Number(match[2]);
}

function todayShanghai(now: Date): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function daysBetweenShanghai(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00+08:00`).getTime();
  const end = new Date(`${endDate}T00:00:00+08:00`).getTime();
  return Math.floor((end - start) / (24 * 60 * 60 * 1000));
}
