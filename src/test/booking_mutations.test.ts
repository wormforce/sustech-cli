import assert from "node:assert/strict";
import test from "node:test";
import { CliError } from "../core/errors.js";
import {
  BOOKING_API,
  applyBookingCancel,
  applyBookingCreate,
  type BookingCreateTarget,
  type BookingMutationAdapter,
} from "../services/booking.js";
import {
  LIBRARY_BOOKING_BASE,
  applyLibraryBookingCancel,
  applyLibraryBookingCreate,
  type LibraryBookingCreateTarget,
  type LibraryBookingMutationAdapter,
  type LibraryBookingReservationPayload,
} from "../services/library.js";

test("booking create precheck fails closed before any write when the live room state is unsafe", async () => {
  const fixture = makeBookingAdapter({
    rooms: [bookingRoomRaw({ IsAvailable: false })],
    meetings: [],
  });

  await assert.rejects(
    () => applyBookingCreate(fixture.adapter, {
      roomId: "ZC02",
      title: "team sync",
      start: "2026-08-28T10:00:00",
      end: "2026-08-28T11:00:00",
      participants: 1,
    }),
    (error: unknown) => {
      assert(error instanceof CliError);
      assert.equal(error.code, "BOOKING_PRECHECK_FAILED");
      assert.equal(error.exitCode, 4);
      assert.equal(error.details?.warning, "NO_MUTATION_PERFORMED");
      return true;
    },
  );
  assert.equal(fixture.stats.addCalls, 0);
});

test("booking create confirms the exact meeting by read-back after a typed addMeeting write", async () => {
  const fixture = makeBookingAdapter({
    rooms: [bookingRoomRaw()],
    meetings: [],
    onAdd(input, state) {
      state.meetings.push(bookingMeetingRaw({
        MeetingID: "M-1",
        MeetingRoomID: input.roomId,
        MeetingRoomName: "致诚楼讨论间",
        MeetingName: input.title,
        StartTime: input.start,
        EndTime: input.end,
      }));
      return { MeetingID: "M-1" };
    },
  });

  const result = await applyBookingCreate(fixture.adapter, {
    roomId: "ZC02",
    title: "team sync",
    start: "2026-08-28T10:00:00",
    end: "2026-08-28T11:00:00",
    participants: 2,
  });

  assert.equal(result.meeting.id, "M-1");
  assert.equal(result.verification.status, "confirmed");
  assert.equal(fixture.stats.addCalls, 1);
});

test("booking create exits 5 when read-back is ambiguous after a successful write", async () => {
  const target: BookingCreateTarget = {
    roomId: "ZC02",
    title: "team sync",
    start: "2026-08-28T10:00:00",
    end: "2026-08-28T11:00:00",
    participants: 1,
  };
  const fixture = makeBookingAdapter({
    rooms: [bookingRoomRaw()],
    meetings: [],
    onAdd(_input, state) {
      state.meetings.push(bookingMeetingRaw({ MeetingID: "M-1" }));
      state.meetings.push(bookingMeetingRaw({ MeetingID: "M-2" }));
      return {};
    },
  });

  await assert.rejects(
    () => applyBookingCreate(fixture.adapter, target),
    (error: unknown) => {
      assert(error instanceof CliError);
      assert.equal(error.code, "BOOKING_WRITE_UNVERIFIED");
      assert.equal(error.exitCode, 5);
      assert.equal(error.details?.warning, "DO_NOT_RETRY_AUTOMATICALLY");
      return true;
    },
  );
});

test("booking cancel confirms the exact meeting ID is absent after a typed cancelMeeting write", async () => {
  const fixture = makeBookingAdapter({
    rooms: [bookingRoomRaw()],
    meetings: [bookingMeetingRaw({ MeetingID: "M-1" })],
    onCancel(meetingId, state) {
      state.meetings = state.meetings.filter((entry) => String(entry.MeetingID) !== meetingId);
      return { cancelled: true };
    },
  });

  const result = await applyBookingCancel(fixture.adapter, { meetingId: "M-1" });
  assert.equal(result.verification.status, "confirmed");
  assert.equal(fixture.stats.cancelCalls, 1);
});

test("library booking create precheck fails closed for group rooms without enough explicit members", async () => {
  const fixture = makeLibraryAdapter({
    rooms: [libraryRoomGroupRaw({ devName: "G104（3-10人）" })],
    reservations: [],
  });

  await assert.rejects(
    () => applyLibraryBookingCreate(fixture.adapter, {
      classKind: 1,
      kindId: 1,
      labId: 2,
      devId: 13,
      title: "study group",
      start: "2026-08-28T10:00:00",
      end: "2026-08-28T11:00:00",
      memberKind: 1,
      members: [],
    }),
    (error: unknown) => {
      assert(error instanceof CliError);
      assert.equal(error.code, "LIBRARY_BOOKING_PRECHECK_FAILED");
      assert.equal(error.exitCode, 4);
      assert.equal(error.details?.warning, "NO_MUTATION_PERFORMED");
      return true;
    },
  );
  assert.equal(fixture.stats.createCalls, 0);
});

test("library booking create confirms the exact reservation by read-back after a typed createReservation write", async () => {
  const fixture = makeLibraryAdapter({
    rooms: [libraryRoomGroupRaw({ devName: "C105（1-3人）" })],
    reservations: [],
    onCreate(_payload, state) {
      state.reservations.push(libraryReservationRaw({
        resvId: 9001,
        uuid: "uuid-9001",
        testName: "study group",
        resvBeginTime: "2026-08-28 10:00:00",
        resvEndTime: "2026-08-28 11:00:00",
      }));
      return { resvId: 9001, uuid: "uuid-9001" };
    },
  });

  const result = await applyLibraryBookingCreate(fixture.adapter, {
    classKind: 1,
    kindId: 1,
    labId: 2,
    devId: 13,
    title: "study group",
    start: "2026-08-28T10:00:00",
    end: "2026-08-28T11:00:00",
    memberKind: 1,
    members: [],
  });

  assert.equal(result.reservation.reservationId, 9001);
  assert.equal(result.verification.status, "confirmed");
  assert.equal(fixture.stats.createCalls, 1);
});

test("library booking create exits 5 when the upstream accepted the write but the exact reservation is not observable", async () => {
  const target: LibraryBookingCreateTarget = {
    classKind: 1,
    kindId: 1,
    labId: 2,
    devId: 13,
    title: "study group",
    start: "2026-08-28T10:00:00",
    end: "2026-08-28T11:00:00",
    memberKind: 1,
    members: [],
  };
  const fixture = makeLibraryAdapter({
    rooms: [libraryRoomGroupRaw({ devName: "C105（1-3人）" })],
    reservations: [],
    onCreate() {
      return { resvId: 9002, uuid: "uuid-9002" };
    },
  });

  await assert.rejects(
    () => applyLibraryBookingCreate(fixture.adapter, target),
    (error: unknown) => {
      assert(error instanceof CliError);
      assert.equal(error.code, "LIBRARY_BOOKING_WRITE_UNVERIFIED");
      assert.equal(error.exitCode, 5);
      assert.equal(error.details?.warning, "DO_NOT_RETRY_AUTOMATICALLY");
      return true;
    },
  );
});

test("library booking cancel confirms the exact reservation ID is absent after a typed cancelReservation write", async () => {
  const fixture = makeLibraryAdapter({
    rooms: [libraryRoomGroupRaw({ devName: "C105（1-3人）" })],
    reservations: [libraryReservationRaw({ resvId: 9001, uuid: "uuid-9001" })],
    onCancel(uuid, state) {
      state.reservations = state.reservations.filter((entry) => String(entry.uuid) !== uuid);
      return { message: "删除成功" };
    },
  });

  const result = await applyLibraryBookingCancel(fixture.adapter, { reservationId: 9001 });
  assert.equal(result.verification.status, "confirmed");
  assert.equal(fixture.stats.cancelCalls, 1);
});

function makeBookingAdapter(config: {
  rooms: unknown[];
  meetings: Record<string, unknown>[];
  onAdd?: (input: BookingCreateTarget, state: { meetings: Record<string, unknown>[] }) => Record<string, unknown>;
  onCancel?: (meetingId: string, state: { meetings: Record<string, unknown>[] }) => Record<string, unknown>;
}): { adapter: BookingMutationAdapter; stats: { addCalls: number; cancelCalls: number } } {
  const state = { meetings: [...config.meetings] };
  const stats = { addCalls: 0, cancelCalls: 0 };
  return {
    adapter: {
      name: "booking-fixture",
      async fetch(input, _init) {
        const url = String(input);
        if (url === `${BOOKING_API}/GetMeetingRoomAllByCondition`) {
          return jsonResponse({ IsSuccess: true, Data: { rows: config.rooms } });
        }
        if (url === `${BOOKING_API}/GetMyMeetings`) {
          return jsonResponse({ IsSuccess: true, Data: { rows: state.meetings } });
        }
        throw new Error(`Unexpected booking URL ${url}`);
      },
      async addMeeting(input) {
        stats.addCalls += 1;
        return config.onAdd ? config.onAdd(input, state) : {};
      },
      async cancelMeeting(meetingId) {
        stats.cancelCalls += 1;
        return config.onCancel ? config.onCancel(meetingId, state) : {};
      },
    },
    stats,
  };
}

function makeLibraryAdapter(config: {
  rooms: unknown[];
  reservations: Record<string, unknown>[];
  onCreate?: (payload: LibraryBookingReservationPayload, state: { reservations: Record<string, unknown>[] }) => Record<string, unknown>;
  onCancel?: (uuid: string, state: { reservations: Record<string, unknown>[] }) => Record<string, unknown>;
}): { adapter: LibraryBookingMutationAdapter; stats: { createCalls: number; cancelCalls: number } } {
  const state = { reservations: [...config.reservations] };
  const stats = { createCalls: 0, cancelCalls: 0 };
  return {
    adapter: {
      name: "library-booking-fixture",
      async fetch(input, _init) {
        const url = new URL(String(input));
        if (url.href === `${LIBRARY_BOOKING_BASE}/ic-web/auth/userInfo`) {
          return jsonResponse({
            code: 0,
            message: "ok",
            data: {
              accNo: 12200000,
              pid: "12200000",
              logonName: "12200000",
              trueName: "Student Name",
              className: "CS2022",
              deptName: "Computer Science and Engineering",
            },
          });
        }
        if (url.pathname === "/ic-web/roomDevice/roomInfos") {
          return jsonResponse({
            code: 0,
            message: "ok",
            data: [{
              campusId: 1,
              campusName: "涵泳讨论间",
              labInfos: [{
                labId: 2,
                labName: "涵泳一层",
                roomInfos: config.rooms,
              }],
            }],
          });
        }
        if (url.pathname === "/ic-web/reserve/resvInfo") {
          const reservationId = url.searchParams.get("resvId");
          const rows = reservationId
            ? state.reservations.filter((entry) => String(entry.resvId) === reservationId)
            : state.reservations;
          return jsonResponse({
            code: 0,
            message: "ok",
            count: rows.length,
            data: rows,
          });
        }
        throw new Error(`Unexpected library URL ${url.toString()}`);
      },
      async createReservation(payload) {
        stats.createCalls += 1;
        return config.onCreate ? config.onCreate(payload, state) : {};
      },
      async cancelReservation(uuid) {
        stats.cancelCalls += 1;
        return config.onCancel ? config.onCancel(uuid, state) : {};
      },
    },
    stats,
  };
}

function bookingRoomRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    MeetingRoomID: "ZC02",
    MeetingRoomName: "致诚楼讨论间",
    MeetingRoomType: "会议室",
    CapacityNumber: 8,
    MeetingRoomLocal: "致诚书院 2F",
    IsAvailable: true,
    IsApproval: false,
    NumberOfDaysAhead: 30,
    CanBookStartTime: "1970-01-01T08:00:00",
    CanBookEndTime: "1970-01-01T22:00:00",
    DeptName: "致诚书院",
    ...overrides,
  };
}

function bookingMeetingRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    MeetingID: "M-1",
    MeetingRoomID: "ZC02",
    MeetingRoomName: "致诚楼讨论间",
    MeetingName: "team sync",
    StartTime: "2026-08-28T10:00:00",
    EndTime: "2026-08-28T11:00:00",
    Status: "Booked",
    ...overrides,
  };
}

function libraryRoomGroupRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    devId: 13,
    devName: "C105（1-3人）",
    minResvTime: 10,
    resvInfos: [],
    openTimes: [{ openStartTime: "08:00", openEndTime: "21:59", openLimit: 1 }],
    ...overrides,
  };
}

function libraryReservationRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    resvId: 9001,
    uuid: "uuid-9001",
    testName: "study group",
    resvBeginTime: "2026-08-28 10:00:00",
    resvEndTime: "2026-08-28 11:00:00",
    resvStatus: 1027,
    resvDevInfoList: [{
      devId: 13,
      devName: "C105（1-3人）",
      roomName: "C105（1-3人）",
      labName: "涵泳一层",
    }],
    ...overrides,
  };
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
