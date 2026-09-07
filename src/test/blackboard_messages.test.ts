import assert from "node:assert/strict";
import test from "node:test";
import {
  listBlackboardCourseMessageFolders,
  listBlackboardCourseMessageParticipants,
  listBlackboardCourseMessages,
} from "../services/blackboard.js";
import type { ServiceAdapter } from "../services/base.js";
import {
  formatBlackboardMessageFolders,
  formatBlackboardMessageParticipants,
  formatBlackboardMessages,
} from "../services/text.js";

test("Blackboard message folders normalize course folder counts and paging", async () => {
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
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8343_1/messages/folders?offset=25&limit=25") {
      return jsonResponse({
        results: [
          {
            name: "inbox",
            label: "Inbox",
            type: "Inbox",
            courseMessagesCounts: {
              courseId: "_8343_1",
              unreadCount: 4,
              totalCount: 12,
            },
          },
          {
            name: "project-team",
            label: "Project Team",
            type: "Custom",
            courseMessagesCounts: {
              courseId: "_8343_1",
              unreadCount: 1,
              totalCount: 5,
            },
          },
        ],
        paging: {
          nextPage: "/learn/api/public/v1/courses/_8343_1/messages/folders?offset=50&limit=25",
        },
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  const report = await listBlackboardCourseMessageFolders(adapter, {
    courseId: "8343",
    page: 2,
    pageSize: 25,
  });

  assert.equal(report.courseId, "_8343_1");
  assert.equal(report.courseCode, "CHEM201");
  assert.equal(report.courseName, "Physical Chemistry");
  assert.equal(report.page, 2);
  assert.equal(report.pageSize, 25);
  assert.equal(report.returned, 2);
  assert.equal(report.hasMore, true);
  assert.equal(report.nextPage, 3);
  assert.deepEqual(report.folders[0], {
    name: "inbox",
    label: "Inbox",
    type: "Inbox",
    unreadCount: 4,
    totalCount: 12,
  });
  assert.match(formatBlackboardMessageFolders(report), /Project Team/u);
  assert.match(formatBlackboardMessageFolders(report), /Next page: 3/u);
});

test("Blackboard course messages normalize sender data, attachments, and folder filters", async () => {
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
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8343_1/messages?offset=0&limit=2&folderType=Custom&folderName=Project+Team&sort=postedDate%28desc%29&expand=sender") {
      return jsonResponse({
        results: [
          {
            id: "_71_1",
            subject: "<b>Project</b> update",
            body: "<p>Bring&nbsp;report</p>",
            postedDate: "2026-09-03T08:00:00.000Z",
            isRead: false,
            type: "Normal",
            senderId: "_7_1",
            sender: {
              id: "_7_1",
              userName: "achen",
              givenName: { text: "Alice" },
              familyName: { rawText: "Chen" },
              preferredDisplayName: "GivenName",
            },
            attachment: {
              id: "_91_1",
              fileName: "report.pdf",
              mimeType: "application/pdf",
              fileLocation: "COURSE",
            },
            toUsers: ["_1_1", "_2_1"],
            ccUsers: ["_3_1"],
            bccUsers: [],
            isExistingAttachment: false,
            isReply: false,
          },
          {
            id: "_72_1",
            subject: "",
            body: "<div>FYI</div>",
            postedDate: "2026-09-03T08:30:00.000Z",
            isRead: true,
            type: "System",
            senderId: "_8_1",
            toUsers: [],
            ccUsers: [],
            bccUsers: ["_9_1"],
            isExistingAttachment: true,
            isReply: true,
          },
        ],
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  const report = await listBlackboardCourseMessages(adapter, {
    courseId: "_8343_1",
    folderType: "Custom",
    folderName: " Project Team ",
    page: 1,
    pageSize: 2,
    sort: "postedDate(desc)",
  });

  assert.equal(report.courseId, "_8343_1");
  assert.equal(report.courseCode, "CHEM201");
  assert.equal(report.folderType, "Custom");
  assert.equal(report.folderName, "Project Team");
  assert.equal(report.sort, "postedDate(desc)");
  assert.equal(report.returned, 2);
  assert.equal(report.hasMore, false);
  assert.equal(report.messages[0]?.id, "71");
  assert.equal(report.messages[0]?.subject, "Project update");
  assert.equal(report.messages[0]?.body, "Bring report");
  assert.equal(report.messages[0]?.sender?.displayName, "Alice Chen");
  assert.equal(report.messages[0]?.attachment?.fileName, "report.pdf");
  assert.deepEqual(report.messages[0]?.toUsers, ["_1_1", "_2_1"]);
  assert.equal(report.messages[1]?.id, "72");
  assert.equal(report.messages[1]?.subject, "");
  assert.equal(report.messages[1]?.isRead, true);
  assert.equal(report.messages[1]?.isReply, true);
  assert.deepEqual(report.messages[1]?.bccUsers, ["_9_1"]);
  assert.match(formatBlackboardMessages(report), /Project update/u);
  assert.match(formatBlackboardMessages(report), /attachment report\.pdf/u);
  assert.match(formatBlackboardMessages(report), /unread/u);
});

test("Blackboard message participants normalize canonical ids and display-name preferences", async () => {
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
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8343_1/messages/_71_1/participants?offset=0&limit=2&participationType=To&sort=participationType&expand=user") {
      return jsonResponse({
        results: [
          {
            messageId: "_71_1",
            userId: "_1_1",
            participationType: "To",
            user: {
              id: "_1_1",
              userName: "alicej",
              otherName: { displayText: "AJ" },
              givenName: { text: "Alice" },
              familyName: { plainText: "Jones" },
              preferredDisplayName: "Both",
            },
          },
          {
            messageId: "_71_1",
            userId: "_2_1",
            participationType: "To",
          },
        ],
        paging: {
          nextPage: "/learn/api/public/v1/courses/_8343_1/messages/_71_1/participants?offset=2&limit=2",
        },
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  const report = await listBlackboardCourseMessageParticipants(adapter, {
    courseId: "8343",
    messageId: "71",
    participationType: "To",
    page: 1,
    pageSize: 2,
    sort: "participationType",
  });

  assert.equal(report.courseId, "_8343_1");
  assert.equal(report.courseCode, "CHEM201");
  assert.equal(report.messageId, "71");
  assert.equal(report.participationType, "To");
  assert.equal(report.returned, 2);
  assert.equal(report.hasMore, true);
  assert.equal(report.nextPage, 2);
  assert.equal(report.participants[0]?.messageId, "71");
  assert.equal(report.participants[0]?.displayName, "AJ Alice Jones");
  assert.equal(report.participants[0]?.user?.userName, "alicej");
  assert.equal(report.participants[1]?.displayName, "_2_1");
  assert.match(formatBlackboardMessageParticipants(report), /AJ Alice Jones/u);
  assert.match(formatBlackboardMessageParticipants(report), /Next page: 2/u);
});

function routeAdapter(route: (url: string, init?: RequestInit) => Response | Promise<Response>): ServiceAdapter {
  return {
    name: "blackboard-message-fixture",
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
