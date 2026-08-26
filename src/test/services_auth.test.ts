import assert from "node:assert/strict";
import test from "node:test";
import {
  listBlackboardAssignments,
  listBlackboardCourses,
  normaliseBlackboardContentItem,
} from "../services/blackboard.js";
import { buildBookingEnvelope, listBookingRooms, looksLikeBookingAuthError } from "../services/booking.js";
import {
  getLibraryIdleSummary,
  listLibraryLabs,
  listLibraryReservations,
  listLibraryReservationsPage,
  looksLikeLibraryBookingAuthError,
  normaliseLibraryCampusGroup,
} from "../services/library.js";
import { listPmsPrintJobs, listPmsStations, listPmsUsageHistory } from "../services/pms.js";
import type { ServiceAdapter } from "../services/base.js";

test("Blackboard adapter resolves enrolled courses and assignment metadata through REST endpoints", async () => {
  const adapter = routeAdapter((url) => {
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/users/me") {
      return jsonResponse({ id: "_1_1", userName: "12200000", name: "Student Name" });
    }
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/users/_1_1/courses") {
      return jsonResponse({
        results: [{ courseId: "_8343_1", courseRoleId: "Student" }],
        paging: { nextPage: "/learn/api/public/v1/users/_1_1/courses?offset=1" },
      });
    }
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/users/_1_1/courses?offset=1") {
      return jsonResponse({
        results: [{ courseId: "_9000_1", courseRoleId: "Student" }],
      });
    }
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8343_1") {
      return jsonResponse({
        id: "_8343_1",
        name: "Physical Chemistry",
        courseCode: "CHEM201",
        externalId: "CHEM201-2026",
        availability: { available: "Yes" },
      });
    }
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_9000_1") {
      return jsonResponse({
        id: "_9000_1",
        name: "Algorithms",
        courseCode: "CS208",
        externalId: "CS208-2026",
        availability: { available: "Yes" },
      });
    }
    if (url.includes("/learn/api/public/v1/courses/_8343_1/gradebook/columns") && !url.includes("offset=1")) {
      return jsonResponse({
        results: [{
          id: "_991_1",
          name: "Lab Report 1",
          contentId: "_490876_1",
          score: { possible: 100 },
        }],
        paging: { nextPage: "/learn/api/public/v1/courses/_8343_1/gradebook/columns?offset=1" },
      });
    }
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8343_1/gradebook/columns?offset=1") {
      return jsonResponse({
        results: [{
          id: "_992_1",
          name: "Final Project",
          contentId: "_490877_1",
          score: { possible: 80 },
        }],
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  const courses = await listBlackboardCourses(adapter);
  assert.deepEqual(courses, [
    {
      id: "_8343_1",
      numericId: "8343",
      name: "Physical Chemistry",
      courseCode: "CHEM201",
      externalId: "CHEM201-2026",
      roleId: "Student",
      availability: "Yes",
    },
    {
      id: "_9000_1",
      numericId: "9000",
      name: "Algorithms",
      courseCode: "CS208",
      externalId: "CS208-2026",
      roleId: "Student",
      availability: "Yes",
    },
  ]);

  const assignments = await listBlackboardAssignments(adapter, "_8343_1");
  assert.deepEqual(assignments, [
    {
      id: "991",
      contentId: "490876",
      title: "Lab Report 1",
      scorePossible: 100,
    },
    {
      id: "992",
      contentId: "490877",
      title: "Final Project",
      scorePossible: 80,
    },
  ]);

  assert.deepEqual(normaliseBlackboardContentItem({
    id: "_888_1",
    parentId: "_100_1",
    title: "Slides",
    contentHandler: { id: "resource/x-bb-file" },
    hasChildren: false,
  }), {
    id: "888",
    parentId: "100",
    title: "Slides",
    handler: "resource/x-bb-file",
    kind: "file",
    hasChildren: false,
  });
});

test("booking adapter builds JSON envelope and normalizes room inventory", async () => {
  const envelope = buildBookingEnvelope({ page: 1 }, "11111111-1111-4111-8111-111111111111");
  assert.deepEqual(envelope, {
    MessageType: 1002,
    MessageID: "11111111-1111-4111-8111-111111111111",
    Data: { page: 1 },
  });
  assert.equal(looksLikeBookingAuthError({ IsSuccess: false, Message: "Authorization is NULL" }), true);

  const adapter = routeAdapter((_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.MessageType, 1002);
    return jsonResponse({
      IsSuccess: true,
      Data: {
        rows: [{
          MeetingRoomID: "ZC02",
          MeetingRoomName: "致诚楼讨论间",
          MeetingRoomType: "会议室",
          CapacityNumber: 8,
          MeetingRoomLocal: "致诚书院 2F",
          IsAvailable: "false",
          IsApproval: false,
          NumberOfDaysAhead: 30,
          CanBookStartTime: "1970-01-01T08:00:00",
          CanBookEndTime: "1970-01-01T22:00:00",
          Longitude: 113.9,
          Latitude: 22.6,
          DeptName: "致诚书院",
          MeetingRoomEquipments: [{ EquipmentName: "Projector" }],
          MeetingRoomManagers: [{ UserInfoModel: { XM: "李老师" } }],
        }],
      },
    });
  });

  const rooms = await listBookingRooms(adapter, { keyword: "致诚" });
  assert.equal(rooms.length, 1);
  assert.equal(rooms[0]?.available, false);
  assert.equal(rooms[0]?.bookStart, "08:00:00");
  assert.deepEqual(rooms[0]?.equipment, ["Projector"]);
});

test("library booking adapter exposes idle summary and reservations while surfacing auth errors", async () => {
  assert.equal(looksLikeLibraryBookingAuthError({ code: 300, message: "用户未登录，请重新登录" }), true);

  const adapter = routeAdapter((url) => {
    if (url === "https://booking.lib.sustech.edu.cn/ic-web/home/page/room/idle") {
      return jsonResponse({
        code: 0,
        message: "查询成功",
        data: [{ name: "讨论间", idelQuantity: 12, totalQuantity: 20 }],
      });
    }
    if (url.startsWith("https://booking.lib.sustech.edu.cn/ic-web/reserve/resvInfo?")) {
      return jsonResponse({
        code: 0,
        message: "查询成功",
        count: 42,
        data: { rows: [{
          resvId: 183442,
          uuid: "bdb93949",
          testName: "team sync",
          resvBeginTime: 1782885600000,
          resvEndTime: 1782889200000,
          resvStatus: 1027,
          resvDevInfoList: [{
            roomName: "C105（1-3人）",
            devName: "C105（1-3人）",
            labName: "涵泳一层",
          }],
        }] },
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  const idle = await getLibraryIdleSummary(adapter);
  assert.deepEqual(idle, [{ name: "讨论间", idleQuantity: 12, totalQuantity: 20 }]);

  const reservations = await listLibraryReservations(adapter, {
    start: "2026-07-01",
    end: "2026-07-10",
  });
  assert.equal(reservations[0]?.reservationId, 183442);
  assert.equal(reservations[0]?.roomName, "C105（1-3人）");
  assert.equal(reservations[0]?.beginTime, "2026-07-01T14:00:00.000+08:00");

  const reservationPage = await listLibraryReservationsPage(adapter, {
    start: "2026-07-01",
    end: "2026-07-10",
  });
  assert.equal(reservationPage.total, 42);
  assert.equal(reservationPage.reservations.length, 1);

  assert.deepEqual(normaliseLibraryCampusGroup({
    campusId: 1,
    campusName: "涵泳讨论间",
    labInfos: [{
      labId: 2,
      labName: "涵泳一层",
      roomInfos: [{
        devId: 13,
        devName: "C105（1-3人）",
        minResvTime: 10,
        resvInfos: [],
        openTimes: [{ openStartTime: "08:00", openEndTime: "21:59", openLimit: 1 }],
      }],
    }],
  }), {
    campusId: 1,
    campusName: "涵泳讨论间",
    labs: [{
      labId: 2,
      labName: "涵泳一层",
      rooms: [{
        devId: 13,
        devName: "C105（1-3人）",
        minReservationMinutes: 10,
        openTimes: [{ start: "08:00", end: "21:59", limit: 1 }],
        reserved: false,
      }],
    }],
  });
});

test("library lab lookup preserves the upstream's explicit empty kindIds parameter", async () => {
  const adapter = routeAdapter((rawUrl) => {
    const url = new URL(rawUrl);
    assert.equal(url.pathname, "/ic-web/lab/devKindLabs");
    assert.equal(url.searchParams.get("classKind"), "1");
    assert.equal(url.searchParams.has("kindIds"), true);
    assert.equal(url.searchParams.get("kindIds"), "");
    return jsonResponse({ code: 0, data: [{ labId: 1, labName: "涵泳一层" }] });
  });
  assert.deepEqual(await listLibraryLabs(adapter), [{ labId: 1, labName: "涵泳一层" }]);
});

test("PMS adapter normalizes station state, print queue, and usage history", async () => {
  const adapter = routeAdapter((url, init) => {
    if (url === "https://pms.sustech.edu.cn/api/client/Station/GetList?timestamp=0") {
      return jsonResponse({
        code: 0,
        result: [{
          dwDevSN: 1234001,
          szName: "慧园 1 栋打印点",
          szStatInfo: "Idle",
          dwStatus: 1,
          dwTrayPaper1: 9,
          dwTrayPaper2: 8,
          dwTrayPaper3: -1,
          dwTrayPaper4: -1,
          dwProperty: 1 | 2 | 4 | 8,
        }],
      });
    }
    if (url === "https://pms.sustech.edu.cn/api/client/PrintJob/Get?timestamp=0") {
      return jsonResponse({
        code: 0,
        result: [{
          dwJobId: 101,
          szJobName: "report.pdf",
          dwCreateDate: 20260826,
          dwCreateTime: 93015,
          dwCopies: 2,
          szAttribe: "color,vdup",
          szPaperDetail: JSON.stringify([{ dwPaperID: 9, dwBWPages: 0, dwColorPages: 12 }]),
        }],
      });
    }
    if (url === "https://pms.sustech.edu.cn/api/client/Report/DetailPage") {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.dwBeginDate, "20260801");
      return jsonResponse({
        code: 0,
        dwTotalPage: 1,
        result: [{
          dwSID: 7,
          dwDate: 20260826,
          dwTime: 93015,
          dwPages: 12,
          dwPaperID: 9,
          dwUsedCardMoney: 240,
          dwUsedFreeMoney: 0,
          dwUsedMoney: 0,
          dwMFPSN: 1234001,
          szMemo: "打印作业",
        }],
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  const stations = await listPmsStations(adapter);
  assert.deepEqual(stations, [{
    deviceSn: 1234001,
    name: "慧园 1 栋打印点",
    statusText: "空闲",
    state: "idle",
    papers: ["A4", "A3"],
    canPrint: true,
    canCopy: true,
    canScan: true,
    canColor: true,
    serverGroup: 1234,
  }]);

  const printJobs = await listPmsPrintJobs(adapter);
  assert.deepEqual(printJobs, [{
    jobId: 101,
    fileName: "report.pdf",
    createdAt: "2026-08-26T09:30:15",
    copies: 2,
    paper: "A4",
    totalPages: 12,
    color: true,
    duplexLabel: "双面长边",
  }]);

  const history = await listPmsUsageHistory(adapter, { begin: "2026-08-01", end: "2026-08-26" });
  assert.equal(history.totalPages, 1);
  assert.equal(history.records[0]?.totalCost, 2.4);
});

function routeAdapter(route: (url: string, init?: RequestInit) => Response | Promise<Response>): ServiceAdapter {
  return {
    name: "fixture",
    fetch(input: string, init?: RequestInit): Promise<Response> {
      return Promise.resolve(route(String(input), init));
    },
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
