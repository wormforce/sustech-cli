import assert from "node:assert/strict";
import test from "node:test";
import { listBlackboardAnnouncements, nextBlackboardAnnouncement } from "../services/blackboard.js";
import type { ServiceAdapter } from "../services/base.js";

test("Blackboard announcements merge system and course items, sort newest first, and strip HTML", async () => {
  const adapter = routeAdapter((url) => {
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/announcements") {
      return jsonResponse({
        results: [{
          id: "_500_1",
          title: "<b>System</b> alert",
          body: "<p>Bring&nbsp;&amp;&nbsp;ID</p>",
          created: "2026-08-25T00:00:00.000Z",
          modified: "2026-08-25T09:00:00.000Z",
          availability: { duration: { type: "Permanent" } },
        }],
      });
    }
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/users/me") {
      return jsonResponse({ id: "_1_1", userName: "12200000", name: "Student Name" });
    }
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/users/_1_1/courses") {
      return jsonResponse({ results: [{ courseId: "_8343_1", courseRoleId: "Student" }] });
    }
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8343_1") {
      return jsonResponse({
        id: "_8343_1",
        name: "<i>Physical</i> Chemistry",
        courseCode: "CHEM201",
        externalId: "CHEM201-2026",
        availability: { available: "Yes" },
      });
    }
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8343_1/announcements") {
      return jsonResponse({
        results: [
          {
            id: "_601_1",
            title: "Week <i>2</i>",
            body: "<div>Slides&nbsp;ready</div>",
            created: "2026-08-26T08:00:00.000Z",
            modified: "2026-08-26T08:00:00.000Z",
            availability: { duration: { type: "Restricted", start: "2026-08-26T00:00:00.000Z" } },
          },
          {
            id: "_602_1",
            title: "Alpha",
            body: "<p>A</p>",
            created: "2026-08-24T08:00:00.000Z",
            modified: "2026-08-24T08:00:00.000Z",
            availability: { duration: { type: "Permanent" } },
          },
          {
            id: "_603_1",
            title: "Beta",
            body: "<p>B</p>",
            created: "2026-08-24T08:00:00.000Z",
            modified: "2026-08-24T08:00:00.000Z",
            availability: { duration: { type: "Permanent" } },
          },
        ],
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  const report = await listBlackboardAnnouncements(adapter, {
    now: new Date("2026-08-26T12:00:00.000Z"),
  });

  assert.equal(report.partial, false);
  assert.equal(report.systemAnnouncements, 1);
  assert.equal(report.courseAnnouncements, 3);
  assert.equal(report.coursesMatched, 1);
  assert.equal(report.coursesScanned, 1);
  assert.deepEqual(
    report.announcements.map((announcement) => announcement.title),
    ["Week 2", "System alert", "Alpha", "Beta"],
  );
  assert.equal(report.announcements[0]?.body, "Slides ready");
  assert.equal(report.announcements[0]?.source, "course");
  assert.equal(report.announcements[0]?.courseId, "_8343_1");
  assert.equal(report.announcements[0]?.courseCode, "CHEM201");
  assert.equal(report.announcements[0]?.courseName, "Physical Chemistry");
  assert.equal(report.announcements[1]?.body, "Bring & ID");
  assert.equal(report.announcements[1]?.source, "system");
  assert.equal(nextBlackboardAnnouncement(report)?.id, "601");
});

test("Blackboard announcements respect the days window using modified then created timestamps", async () => {
  const adapter = routeAdapter((url) => {
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/announcements") {
      return jsonResponse({
        results: [
          {
            id: "_500_1",
            title: "Boundary",
            body: "included",
            created: "2026-08-20T00:00:00.000Z",
            modified: "2026-08-24T12:00:00.000Z",
          },
          {
            id: "_501_1",
            title: "Too old",
            body: "excluded",
            created: "2026-08-20T00:00:00.000Z",
            modified: "2026-08-24T11:59:59.000Z",
          },
        ],
      });
    }
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/users/me") {
      return jsonResponse({ id: "_1_1", userName: "12200000", name: "Student Name" });
    }
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/users/_1_1/courses") {
      return jsonResponse({ results: [{ courseId: "_8343_1", courseRoleId: "Student" }] });
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
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8343_1/announcements") {
      return jsonResponse({
        results: [
          {
            id: "_601_1",
            title: "Created fallback",
            body: "included",
            created: "2026-08-24T13:00:00.000Z",
            modified: "",
          },
          {
            id: "_602_1",
            title: "No parseable time",
            body: "excluded",
            created: "not-a-date",
            modified: "",
          },
        ],
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  const report = await listBlackboardAnnouncements(adapter, {
    now: new Date("2026-08-26T12:00:00.000Z"),
    days: 2,
  });

  assert.equal(report.days, 2);
  assert.deepEqual(
    report.announcements.map((announcement) => announcement.title),
    ["Created fallback", "Boundary"],
  );
});

test("Blackboard announcements skip system announcements when courseQuery is set", async () => {
  let systemCalls = 0;
  const adapter = routeAdapter((url) => {
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/announcements") {
      systemCalls += 1;
      throw new Error(`System announcements should be skipped when filtering courses: ${url}`);
    }
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/users/me") {
      return jsonResponse({ id: "_1_1", userName: "12200000", name: "Student Name" });
    }
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/users/_1_1/courses") {
      return jsonResponse({
        results: [
          { courseId: "_8343_1", courseRoleId: "Student" },
          { courseId: "_9000_1", courseRoleId: "Student" },
        ],
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
        name: "Advanced Writing",
        courseCode: "HUMN201",
        externalId: "HUMN201-2026",
        availability: { available: "Yes" },
      });
    }
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8343_1/announcements") {
      return jsonResponse({
        results: [{
          id: "_601_1",
          title: "Lab reminder",
          body: "bring notebook",
          created: "2026-08-26T08:00:00.000Z",
          modified: "2026-08-26T08:00:00.000Z",
        }],
      });
    }
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_9000_1/announcements") {
      throw new Error(`Unmatched course should not be scanned: ${url}`);
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  const report = await listBlackboardAnnouncements(adapter, {
    now: new Date("2026-08-26T12:00:00.000Z"),
    courseQuery: "chem201",
  });

  assert.equal(systemCalls, 0);
  assert.equal(report.courseQuery, "chem201");
  assert.equal(report.systemAnnouncements, 0);
  assert.equal(report.coursesMatched, 1);
  assert.equal(report.coursesScanned, 1);
  assert.deepEqual(report.announcements.map((announcement) => announcement.title), ["Lab reminder"]);
  assert.equal(report.announcements[0]?.source, "course");
});

test("Blackboard announcements keep successes and record per-course failures as partial", async () => {
  const adapter = routeAdapter((url) => {
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/announcements") {
      return jsonResponse({ results: [] });
    }
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/users/me") {
      return jsonResponse({ id: "_1_1", userName: "12200000", name: "Student Name" });
    }
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/users/_1_1/courses") {
      return jsonResponse({
        results: [
          { courseId: "_8343_1", courseRoleId: "Student" },
          { courseId: "_9000_1", courseRoleId: "Student" },
        ],
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
        name: "Materials Science",
        courseCode: "MSE201",
        externalId: "MSE201-2026",
        availability: { available: "Yes" },
      });
    }
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8343_1/announcements") {
      return jsonResponse({
        results: [{
          id: "_601_1",
          title: "Week 2",
          body: "all good",
          created: "2026-08-26T08:00:00.000Z",
          modified: "2026-08-26T08:00:00.000Z",
        }],
      });
    }
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_9000_1/announcements") {
      return jsonResponse({ message: "upstream unavailable" }, 503);
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  const report = await listBlackboardAnnouncements(adapter, {
    now: new Date("2026-08-26T12:00:00.000Z"),
  });

  assert.equal(report.partial, true);
  assert.equal(report.coursesMatched, 2);
  assert.equal(report.coursesScanned, 2);
  assert.equal(report.courseAnnouncements, 1);
  assert.equal(report.announcements.length, 1);
  assert.equal(report.announcements[0]?.title, "Week 2");
  assert.equal(report.failures.length, 1);
  assert.deepEqual(report.failures[0], {
    stage: "announcements",
    message: "Upstream service returned an HTTP error.",
    code: "SERVICE_ERROR",
    status: 503,
    courseId: "_9000_1",
    courseCode: "MSE201",
    courseName: "Materials Science",
  });
});

test("Blackboard announcements skip courses whose announcement tool is unavailable or unauthorized", async () => {
  const adapter = routeAdapter((url) => {
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/announcements") {
      return jsonResponse({ results: [] });
    }
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/users/me") {
      return jsonResponse({ id: "_1_1", userName: "12200000", name: "Student Name" });
    }
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/users/_1_1/courses") {
      return jsonResponse({
        results: [
          { courseId: "_8343_1", courseRoleId: "Student" },
          { courseId: "_9000_1", courseRoleId: "Student" },
          { courseId: "_9100_1", courseRoleId: "Student" },
        ],
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
        name: "Materials Science",
        courseCode: "MSE201",
        externalId: "MSE201-2026",
        availability: { available: "Yes" },
      });
    }
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_9100_1") {
      return jsonResponse({
        id: "_9100_1",
        name: "Algorithms",
        courseCode: "CS208",
        externalId: "CS208-2026",
        availability: { available: "Yes" },
      });
    }
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8343_1/announcements") {
      return jsonResponse({
        results: [{
          id: "_601_1",
          title: "Week 2",
          body: "all good",
          created: "2026-08-26T08:00:00.000Z",
          modified: "2026-08-26T08:00:00.000Z",
        }],
      });
    }
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_9000_1/announcements") {
      return jsonResponse({
        status: 400,
        message: "The announcement tool for current course is not available!",
      }, 400);
    }
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_9100_1/announcements") {
      return jsonResponse({
        status: 403,
        message: "Current user doesn't have corresponding permission. (course.announcements.VIEW)",
      }, 403);
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  const report = await listBlackboardAnnouncements(adapter, {
    now: new Date("2026-08-26T12:00:00.000Z"),
  });

  assert.equal(report.partial, false);
  assert.equal(report.coursesMatched, 3);
  assert.equal(report.coursesScanned, 3);
  assert.equal(report.courseAnnouncements, 1);
  assert.equal(report.announcements.length, 1);
  assert.equal(report.announcements[0]?.courseCode, "CHEM201");
  assert.deepEqual(report.failures, []);
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
