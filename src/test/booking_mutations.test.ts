import assert from "node:assert/strict";
import test from "node:test";
import { CliError } from "../core/errors.js";
import {
  BOOKING_API,
  buildBookingCreatePreview,
  applyBookingCancel,
  applyBookingCreate,
  type BookingCreateTarget,
  type BookingMutationAdapter,
} from "../services/booking.js";
import {
  LIBRARY_BOOKING_BASE,
  buildLibraryBookingCancelPreview,
  buildLibraryBookingCreatePreview,
  applyLibraryBookingCancel,
  applyLibraryBookingCreate,
  getLibraryReservationInfo,
  type LibraryBookingCreateTarget,
  type LibraryBookingMutationAdapter,
  type LibraryBookingReservationPayload,
} from "../services/library.js";

const TEST_BASE_NOW_MS = Date.now();

test("booking create precheck fails closed before any write when the live room state is unsafe", async () => {
  const slot = futureSlot();
  const fixture = makeBookingAdapter({
    rooms: [bookingRoomRaw({ IsAvailable: false })],
    meetings: [],
  });

  await assert.rejects(
    () => applyBookingCreate(fixture.adapter, {
      roomId: "ZC02",
      title: "team sync",
      start: slot.startIso,
      end: slot.endIso,
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
  const slot = futureSlot();
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
    start: slot.startIso,
    end: slot.endIso,
    participants: 2,
  });

  assert.equal(result.meeting.id, "M-1");
  assert.equal(result.verification.status, "confirmed");
  assert.equal(fixture.stats.addCalls, 1);
});

test("booking create preview confirms exact point-in-time availability from the room calendar", async () => {
  const slot = futureSlot();
  const fixture = makeBookingAdapter({
    rooms: [bookingRoomRaw()],
    meetings: [],
  });

  const preview = await buildBookingCreatePreview(fixture.adapter, {
    roomId: "ZC02",
    title: "team sync",
    start: slot.startIso,
    end: slot.endIso,
    participants: 2,
  });

  assert.equal(preview.applyAllowed, true);
  assert.equal(preview.slotCheck?.status, "available");
  assert.ok(preview.warnings.some((warning) => warning.code === "SLOT_AVAILABILITY_POINT_IN_TIME"));
  assert.ok(!preview.warnings.some((warning) => warning.code === "SLOT_AVAILABILITY_UNVERIFIED"));
});

test("booking create preview blocks when the room calendar shows an overlapping booking", async () => {
  const slot = futureSlot();
  const fixture = makeBookingAdapter({
    rooms: [bookingRoomRaw()],
    meetings: [],
    roomCalendar: [bookingMeetingRaw({
      StartTime: undefined,
      EndTime: undefined,
      StartDateTime: slot.startIso,
      EndDateTime: slot.endIso,
      Topical: "another meeting",
    })],
  });

  const preview = await buildBookingCreatePreview(fixture.adapter, {
    roomId: "ZC02",
    title: "team sync",
    start: slot.startIso,
    end: slot.endIso,
    participants: 2,
  });

  assert.equal(preview.applyAllowed, false);
  assert.equal(preview.slotCheck?.status, "occupied");
  assert.ok(preview.blockers.some((warning) => warning.code === "SLOT_OCCUPIED"));
});

test("booking create preview fails closed when the exact room calendar cannot be read", async () => {
  const slot = futureSlot();
  const fixture = makeBookingAdapter({
    rooms: [bookingRoomRaw()],
    meetings: [],
    roomCalendarError: true,
  });

  const preview = await buildBookingCreatePreview(fixture.adapter, {
    roomId: "ZC02",
    title: "team sync",
    start: slot.startIso,
    end: slot.endIso,
    participants: 2,
  });

  assert.equal(preview.applyAllowed, false);
  assert.equal(preview.slotCheck?.status, "unavailable");
  assert.ok(preview.blockers.some((blocker) => blocker.code === "SLOT_CHECK_FAILED"));
});

test("booking create preview fails closed when the live room calendar payload is malformed", async () => {
  const slot = futureSlot();
  const fixture = makeBookingAdapter({
    rooms: [bookingRoomRaw()],
    meetings: [],
    roomCalendarPayload: { unexpected: true },
  });

  const preview = await buildBookingCreatePreview(fixture.adapter, {
    roomId: "ZC02",
    title: "team sync",
    start: slot.startIso,
    end: slot.endIso,
    participants: 2,
  });

  assert.equal(preview.applyAllowed, false);
  assert.equal(preview.slotCheck?.status, "unavailable");
  assert.match(preview.slotCheck?.message ?? "", /malformed/i);
  assert.ok(preview.blockers.some((blocker) => blocker.code === "SLOT_CHECK_FAILED"));
});

test("booking create preview sends the target Shanghai day to the live room calendar near midnight", async () => {
  const slot = futureSlot(1, 0, 60, 30);
  let requestedCurrentDate = "";
  const fixture = makeBookingAdapter({
    rooms: [bookingRoomRaw({
      CanBookStartTime: "1970-01-01T00:00:00",
      CanBookEndTime: "1970-01-01T23:59:00",
    })],
    meetings: [],
    onRoomCalendarRequest(currentDate) {
      requestedCurrentDate = currentDate;
    },
  });

  const preview = await buildBookingCreatePreview(fixture.adapter, {
    roomId: "ZC02",
    title: "late sync",
    start: slot.startIso,
    end: slot.endIso,
    participants: 2,
  });

  assert.equal(preview.slotCheck?.status, "available");
  assert.equal(requestedCurrentDate, `${slot.date}T00:00:00+08:00`);
});

test("booking create exits 5 when read-back is ambiguous after a successful write", async () => {
  const slot = futureSlot();
  const target: BookingCreateTarget = {
    roomId: "ZC02",
    title: "team sync",
    start: slot.startIso,
    end: slot.endIso,
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

test("booking cancel exits 5 when the meeting still exists after a typed cancelMeeting write", async () => {
  const fixture = makeBookingAdapter({
    rooms: [bookingRoomRaw()],
    meetings: [bookingMeetingRaw({ MeetingID: "M-1" })],
    onCancel() {
      return { cancelled: true };
    },
  });

  await assert.rejects(
    () => applyBookingCancel(fixture.adapter, { meetingId: "M-1" }),
    (error: unknown) => {
      assert(error instanceof CliError);
      assert.equal(error.code, "BOOKING_WRITE_UNVERIFIED");
      assert.equal(error.exitCode, 5);
      assert.equal(error.details?.warning, "DO_NOT_RETRY_AUTOMATICALLY");
      return true;
    },
  );
});

test("booking cancel exits 5 when read-back fails after a typed cancelMeeting write", async () => {
  let cancelled = false;
  const adapter: BookingMutationAdapter = {
    name: "booking-fixture",
    async fetch(input) {
      const url = String(input);
      if (url === `${BOOKING_API}/GetMyMeetings`) {
        if (cancelled) throw new Error("read-back failed");
        return jsonResponse({ IsSuccess: true, Data: { rows: [bookingMeetingRaw({ MeetingID: "M-1" })] } });
      }
      throw new Error(`Unexpected booking URL ${url}`);
    },
    async addMeeting() {
      throw new Error("unexpected add");
    },
    async cancelMeeting() {
      cancelled = true;
      return { cancelled: true };
    },
  };

  await assert.rejects(
    () => applyBookingCancel(adapter, { meetingId: "M-1" }),
    (error: unknown) => {
      assert(error instanceof CliError);
      assert.equal(error.code, "BOOKING_WRITE_UNVERIFIED");
      assert.equal(error.exitCode, 5);
      assert.equal(error.details?.warning, "DO_NOT_RETRY_AUTOMATICALLY");
      return true;
    },
  );
});

test("library booking create precheck enforces ASCII or English group capacity labels", async () => {
  const slot = futureSlot();
  const fixture = makeLibraryAdapter({
    rooms: [libraryRoomGroupRaw({ devName: "G104 (3-10 people)" })],
    reservations: [],
  });

  await assert.rejects(
    () => applyLibraryBookingCreate(fixture.adapter, {
      classKind: 1,
      kindId: 1,
      labId: 2,
      devId: 13,
      title: "study group",
      start: slot.startIso,
      end: slot.endIso,
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

test("library booking create preview confirms the slot is available when room inventory exposes exact reservations", async () => {
  const slot = futureSlot();
  const fixture = makeLibraryAdapter({
    rooms: [libraryRoomGroupRaw({ devName: "C105（1-3人）" })],
    reservations: [],
  });

  const preview = await buildLibraryBookingCreatePreview(fixture.adapter, {
    classKind: 1,
    kindId: 1,
    labId: 2,
    devId: 13,
    title: "study group",
    start: slot.startIso,
    end: slot.endIso,
    memberKind: 1,
    members: [],
  });

  assert.equal(preview.applyAllowed, true);
  assert.equal(preview.slotCheck?.status, "available");
  assert.ok(!preview.warnings.some((warning) => warning.code === "SLOT_AVAILABILITY_UNVERIFIED"));
});

test("library booking create fails closed when room capacity naming cannot be classified safely", async () => {
  const slot = futureSlot();
  const fixture = makeLibraryAdapter({
    rooms: [libraryRoomGroupRaw({ devName: "Focus Room 13" })],
    reservations: [],
  });

  await assert.rejects(
    () => applyLibraryBookingCreate(fixture.adapter, {
      classKind: 1,
      kindId: 1,
      labId: 2,
      devId: 13,
      title: "study group",
      start: slot.startIso,
      end: slot.endIso,
      memberKind: 1,
      members: [],
    }),
    (error: unknown) => {
      assert(error instanceof CliError);
      assert.equal(error.code, "LIBRARY_BOOKING_PRECHECK_FAILED");
      assert.equal(error.exitCode, 4);
      assert.equal(error.details?.warning, "NO_MUTATION_PERFORMED");
      assert.ok(Array.isArray(error.details?.blockers));
      assert.ok(error.details?.blockers.some((blocker: { code?: string }) => blocker.code === "ROOM_CAPACITY_POLICY_UNKNOWN"));
      return true;
    },
  );
});

test("library booking create preview blocks when room inventory exposes an overlapping reservation", async () => {
  const slot = futureSlot();
  const fixture = makeLibraryAdapter({
    rooms: [libraryRoomGroupRaw({
      devName: "C105（1-3人）",
      resvInfos: [{
        testName: "other group",
        resvBeginTime: new Date(`${slot.startIso}+08:00`).getTime(),
        resvEndTime: new Date(`${slot.endIso}+08:00`).getTime(),
      }],
    })],
    roomOpenDays: [{
      fixedDay: slot.date,
      openTimes: [{ openStartTime: "08:00", openEndTime: "09:00", openLimit: 1 }],
    }],
    reservations: [],
  });

  const preview = await buildLibraryBookingCreatePreview(fixture.adapter, {
    classKind: 1,
    kindId: 1,
    labId: 2,
    devId: 13,
    title: "study group",
    start: slot.startIso,
    end: slot.endIso,
    memberKind: 1,
    members: [],
  });

  assert.equal(preview.applyAllowed, false);
  assert.equal(preview.slotCheck?.status, "occupied");
  assert.ok(preview.blockers.some((warning) => warning.code === "SLOT_OCCUPIED"));
});

test("library booking create preview fails closed when the exact room open-times endpoint does not cover the target day", async () => {
  const slot = futureSlot();
  const fixture = makeLibraryAdapter({
    rooms: [libraryRoomGroupRaw({
      devName: "C105（1-3人）",
      resvInfos: { state: "reserved-without-window" },
    })],
    roomOpenDays: [],
    reservations: [],
  });

  const preview = await buildLibraryBookingCreatePreview(fixture.adapter, {
    classKind: 1,
    kindId: 1,
    labId: 2,
    devId: 13,
    title: "study group",
    start: slot.startIso,
    end: slot.endIso,
    memberKind: 1,
    members: [],
  });

  assert.equal(preview.applyAllowed, false);
  assert.equal(preview.slotCheck?.status, "unavailable");
  assert.ok(preview.blockers.some((blocker) => blocker.code === "SLOT_CHECK_FAILED"));
});

test("library booking create confirms the exact reservation by read-back after a typed createReservation write", async () => {
  const slot = futureSlot();
  const fixture = makeLibraryAdapter({
    rooms: [libraryRoomGroupRaw({ devName: "C105（1-3人）" })],
    reservations: [],
    onCreate(_payload, state) {
      state.reservations.push(libraryReservationRaw({
        resvId: 9001,
        uuid: "uuid-9001",
        testName: "study group",
        resvBeginTime: slot.startObserved,
        resvEndTime: slot.endObserved,
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
    start: slot.startIso,
    end: slot.endIso,
    memberKind: 1,
    members: [],
  });

  assert.equal(result.reservation.reservationId, 9001);
  assert.equal(result.verification.status, "confirmed");
  assert.equal(fixture.stats.createCalls, 1);
});

test("library booking create exits 5 when the upstream accepted the write but the exact reservation is not observable", async () => {
  const slot = futureSlot();
  const target: LibraryBookingCreateTarget = {
    classKind: 1,
    kindId: 1,
    labId: 2,
    devId: 13,
    title: "study group",
    start: slot.startIso,
    end: slot.endIso,
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
  const slot = futureSlot();
  const fixture = makeLibraryAdapter({
    rooms: [libraryRoomGroupRaw({ devName: "C105（1-3人）" })],
    reservations: [libraryReservationRaw({ resvId: 9001, uuid: "uuid-9001", resvBeginTime: slot.startObserved, resvEndTime: slot.endObserved })],
    onCancel(uuid, state) {
      state.reservations = state.reservations.filter((entry) => String(entry.uuid) !== uuid);
      return { message: "删除成功" };
    },
  });

  const result = await applyLibraryBookingCancel(fixture.adapter, { reservationId: 9001 });
  assert.equal(result.verification.status, "confirmed");
  assert.equal(fixture.stats.cancelCalls, 1);
});

test("library booking cancel exits 5 when the reservation still exists after a typed cancelReservation write", async () => {
  const slot = futureSlot();
  const fixture = makeLibraryAdapter({
    rooms: [libraryRoomGroupRaw({ devName: "C105（1-3人）" })],
    reservations: [libraryReservationRaw({ resvId: 9001, uuid: "uuid-9001", resvBeginTime: slot.startObserved, resvEndTime: slot.endObserved })],
    onCancel() {
      return { message: "删除成功" };
    },
  });

  await assert.rejects(
    () => applyLibraryBookingCancel(fixture.adapter, { reservationId: 9001 }),
    (error: unknown) => {
      assert(error instanceof CliError);
      assert.equal(error.code, "LIBRARY_BOOKING_WRITE_UNVERIFIED");
      assert.equal(error.exitCode, 5);
      assert.equal(error.details?.warning, "DO_NOT_RETRY_AUTOMATICALLY");
      return true;
    },
  );
});

test("library booking cancel exits 5 when read-back fails after a typed cancelReservation write", async () => {
  const slot = futureSlot();
  let cancelled = false;
  const adapter: LibraryBookingMutationAdapter = {
    name: "library-booking-fixture",
    async fetch(input) {
      const url = new URL(String(input));
      if (url.pathname === "/ic-web/reserve/resvInfo" && url.searchParams.get("resvId") === "9001") {
        if (cancelled) throw new Error("read-back failed");
        return jsonResponse({
          code: 0,
          message: "ok",
          count: 1,
          data: [libraryReservationRaw({ resvId: 9001, uuid: "uuid-9001", resvBeginTime: slot.startObserved, resvEndTime: slot.endObserved })],
        });
      }
      throw new Error(`Unexpected library URL ${url.toString()}`);
    },
    async createReservation() {
      throw new Error("unexpected create");
    },
    async cancelReservation() {
      cancelled = true;
      return { message: "删除成功" };
    },
  };

  await assert.rejects(
    () => applyLibraryBookingCancel(adapter, { reservationId: 9001 }),
    (error: unknown) => {
      assert(error instanceof CliError);
      assert.equal(error.code, "LIBRARY_BOOKING_WRITE_UNVERIFIED");
      assert.equal(error.exitCode, 5);
      assert.equal(error.details?.warning, "DO_NOT_RETRY_AUTOMATICALLY");
      return true;
    },
  );
});

test("library booking cancel preview fails closed when the live reservation lookup is ambiguous", async () => {
  const slot = futureSlot();
  const fixture = makeLibraryAdapter({
    rooms: [libraryRoomGroupRaw({ devName: "C105（1-3人）" })],
    reservations: [
      libraryReservationRaw({ resvId: 9001, uuid: "uuid-9001-a", resvBeginTime: slot.startObserved, resvEndTime: slot.endObserved }),
      libraryReservationRaw({ resvId: 9001, uuid: "uuid-9001-b", resvBeginTime: slot.startObserved, resvEndTime: slot.endObserved }),
    ],
  });

  const preview = await buildLibraryBookingCancelPreview(fixture.adapter, { reservationId: 9001 });

  assert.equal(preview.applyAllowed, false);
  assert.ok(preview.blockers.some((blocker: { code: string }) => blocker.code === "RESERVATION_LOOKUP_AMBIGUOUS"));
});

test("library reservation lookup ambiguity never exposes uuid tokens in error details", async () => {
  const slot = futureSlot();
  const fixture = makeLibraryAdapter({
    rooms: [libraryRoomGroupRaw({ devName: "C105（1-3人）" })],
    reservations: [
      libraryReservationRaw({ resvId: 9001, uuid: "uuid-9001-a", resvBeginTime: slot.startObserved, resvEndTime: slot.endObserved }),
      libraryReservationRaw({ resvId: 9001, uuid: "uuid-9001-b", resvBeginTime: slot.startObserved, resvEndTime: slot.endObserved }),
    ],
  });

  await assert.rejects(
    () => getLibraryReservationInfo(fixture.adapter, 9001),
    (error: unknown) => {
      assert(error instanceof CliError);
      assert.equal(error.code, "LIBRARY_RESERVATION_LOOKUP_AMBIGUOUS");
      assert.ok(Array.isArray(error.details?.matches));
      assert.ok(error.details?.matches.every((entry: Record<string, unknown>) => !("uuid" in entry)));
      return true;
    },
  );
});

function makeBookingAdapter(config: {
  rooms: unknown[];
  meetings: Record<string, unknown>[];
  roomCalendar?: Record<string, unknown>[];
  roomCalendarPayload?: unknown;
  roomCalendarError?: boolean;
  onRoomCalendarRequest?: (currentDate: string) => void;
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
        if (url === `${BOOKING_API}/GetMeetingByMeetingRoomList`) {
          if (config.roomCalendarError) throw new Error("calendar unavailable");
          const envelope = JSON.parse(String(_init?.body)) as {
            MessageType: number;
            Data: { meetingroomid: string; currentdate: string };
          };
          assert.equal(envelope.MessageType, 5001);
          assert.equal(envelope.Data.meetingroomid, "ZC02");
          config.onRoomCalendarRequest?.(envelope.Data.currentdate);
          return jsonResponse({
            IsSuccess: true,
            Data: Object.prototype.hasOwnProperty.call(config, "roomCalendarPayload")
              ? config.roomCalendarPayload
              : { rows: config.roomCalendar ?? [] },
          });
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
  roomOpenDays?: unknown[];
  roomOpenTimesError?: boolean;
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
        if (url.pathname === "/ic-web/room/openTimes") {
          if (config.roomOpenTimesError) throw new Error("room open-times unavailable");
          const beginDate = url.searchParams.get("beginDate") || futureSlot().date;
          const openDays = config.roomOpenDays ?? [{
            fixedDay: beginDate,
            openTimes: [{ openStartTime: "08:00", openEndTime: "21:59", openLimit: 1 }],
          }];
          return jsonResponse({
            code: 0,
            message: "ok",
            data: openDays,
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
  const slot = futureSlot();
  return {
    MeetingID: "M-1",
    MeetingRoomID: "ZC02",
    MeetingRoomName: "致诚楼讨论间",
    MeetingName: "team sync",
    StartTime: slot.startIso,
    EndTime: slot.endIso,
    Status: "Booked",
    ...overrides,
  };
}

function libraryRoomGroupRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    devId: 13,
    roomId: 113,
    devName: "C105（1-3人）",
    minResvTime: 10,
    resvInfos: [],
    openTimes: [{ openStartTime: "08:00", openEndTime: "21:59", openLimit: 1 }],
    ...overrides,
  };
}

function libraryReservationRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const slot = futureSlot();
  return {
    resvId: 9001,
    uuid: "uuid-9001",
    testName: "study group",
    resvBeginTime: slot.startObserved,
    resvEndTime: slot.endObserved,
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

function futureSlot(daysAhead = 1, startHour = 10, durationMinutes = 60, startMinute = 0): {
  date: string;
  startIso: string;
  endIso: string;
  startObserved: string;
  endObserved: string;
} {
  const day = new Date(TEST_BASE_NOW_MS + daysAhead * 24 * 60 * 60 * 1000);
  const date = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(day);
  const startTotalMinutes = startHour * 60 + startMinute;
  const endTotalMinutes = startTotalMinutes + durationMinutes;
  const endHour = Math.floor(endTotalMinutes / 60);
  const endMinute = endTotalMinutes % 60;
  return {
    date,
    startIso: `${date}T${pad(startHour)}:${pad(startMinute)}:00`,
    endIso: `${date}T${pad(endHour)}:${pad(endMinute)}:00`,
    startObserved: `${date} ${pad(startHour)}:${pad(startMinute)}:00`,
    endObserved: `${date} ${pad(endHour)}:${pad(endMinute)}:00`,
  };
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
