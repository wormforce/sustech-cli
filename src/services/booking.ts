import { randomUUID } from "node:crypto";
import {
  arrayValue,
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
  availability: "adapter_required",
  auth: "bearer-header",
  campusNetwork: true,
  browser: false,
  summary: "The eHall booking APIs are stable JSON RPC methods once the adapter provides the Authorization header.",
  notes: [
    "The service must be reachable from the campus network or an approved campus access path.",
    "This module only covers read paths and payload builders.",
    "Mutating calls such as AddMeeting and CancelMeeting are intentionally excluded.",
  ],
  endpoints: [
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
    available: Boolean(record.IsAvailable),
    approvalRequired: Boolean(record.IsApproval),
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
    unread: Boolean(record.IsUnread ?? record.Unread),
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
    throw new Error(`Booking adapter is not authenticated for ${method}.`);
  }
  if (record.IsSuccess !== true) {
    throw new Error(`Booking API error on ${method}: ${stringValue(record.Message) || "unknown error"}`);
  }
  return record.Data;
}

function extractTime(value: string): string {
  const match = /T(\d{2}:\d{2}:\d{2})/.exec(value);
  return match?.[1] ?? value;
}
