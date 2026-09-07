import assert from "node:assert/strict";
import test from "node:test";
import { listBlackboardCourseRoster } from "../services/blackboard.js";
import type { ServiceAdapter } from "../services/base.js";
import { formatBlackboardRoster } from "../services/text.js";

test("Blackboard roster normalizes course memberships, expanded users, and paging", async () => {
  const adapter = routeAdapter((url) => {
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8343_1") {
      return jsonResponse({
        id: "_8343_1",
        name: "Physical Chemistry",
        courseCode: "CHEM201",
        externalId: "CHEM201-2026",
        availability: { available: "Yes" },
      });
    }
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8343_1/users?offset=0&limit=2&role=Student&availability.available=Yes&sort=lastAccessed%28desc%29&expand=user") {
      return jsonResponse({
        results: [
          {
            id: "_901_1",
            userId: "_1_1",
            courseId: "_8343_1",
            childCourseId: "_8344_1",
            created: "2026-08-20T08:00:00.000Z",
            modified: "2026-08-21T08:00:00.000Z",
            availability: { available: "Yes" },
            courseRoleId: "Student",
            lastAccessed: "2026-09-03T09:00:00.000Z",
            dueDateExceptionType: "Normal",
            timeLimitExceptionType: "150",
            displayOrder: 1,
            user: {
              id: "_1_1",
              userName: "alicej",
              availability: { available: "Yes" },
              name: {
                given: "Alice",
                family: "Jones",
                other: "AJ",
                preferredDisplayName: "Both",
              },
              contact: {
                email: "alice@example.edu",
                institutionEmail: "alice@sustech.edu.cn",
              },
              avatar: {
                viewUrl: "https://bb.sustech.edu.cn/avatars/alice",
              },
            },
          },
          {
            id: "_902_1",
            userId: "_2_1",
            courseId: "_8343_1",
            created: "2026-08-20T09:00:00.000Z",
            modified: "2026-08-22T09:00:00.000Z",
            availability: { available: "Yes" },
            courseRoleId: "Student",
            lastAccessed: "",
          },
        ],
        paging: {
          nextPage: "/learn/api/public/v1/courses/_8343_1/users?offset=2&limit=2",
        },
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  const report = await listBlackboardCourseRoster(adapter, {
    courseId: "8343",
    role: "Student",
    availability: "Yes",
    page: 1,
    pageSize: 2,
    sort: "lastAccessed(desc)",
  });

  assert.equal(report.courseId, "_8343_1");
  assert.equal(report.courseCode, "CHEM201");
  assert.equal(report.courseName, "Physical Chemistry");
  assert.equal(report.role, "Student");
  assert.equal(report.availability, "Yes");
  assert.equal(report.sort, "lastAccessed(desc)");
  assert.equal(report.returned, 2);
  assert.equal(report.hasMore, true);
  assert.equal(report.nextPage, 2);
  assert.equal(report.memberships[0]?.id, "901");
  assert.equal(report.memberships[0]?.courseId, "_8343_1");
  assert.equal(report.memberships[0]?.childCourseId, "_8344_1");
  assert.equal(report.memberships[0]?.displayOrder, 1);
  assert.equal(report.memberships[0]?.user?.displayName, "AJ Alice Jones");
  assert.equal(report.memberships[0]?.user?.institutionEmail, "alice@sustech.edu.cn");
  assert.equal(report.memberships[1]?.userId, "_2_1");
  assert.equal(report.memberships[1]?.user, undefined);
  assert.match(formatBlackboardRoster(report), /AJ Alice Jones/u);
  assert.match(formatBlackboardRoster(report), /Next page: 2/u);
});

function routeAdapter(route: (url: string, init?: RequestInit) => Response | Promise<Response>): ServiceAdapter {
  return {
    name: "blackboard-roster-fixture",
    async fetch(input: string, init?: RequestInit): Promise<Response> {
      return route(input, init);
    },
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
