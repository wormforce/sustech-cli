import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  listBlackboardCalendarItems,
  listBlackboardCalendars,
  listBlackboardDeadlines,
  nextBlackboardDeadline,
  searchBlackboardContentTree,
  syncBlackboardAttachments,
} from "../services/blackboard.js";
import type { ServiceAdapter } from "../services/base.js";

test("Blackboard calendars and calendar items normalize mixed types", async () => {
  const since = "2026-08-20T00:00:00.000Z";
  const until = "2026-08-30T00:00:00.000Z";
  const adapter = routeAdapter((url) => {
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/calendars") {
      return jsonResponse({
        results: [
          { id: "PERSONAL", name: "My Calendar" },
          { id: "INSTITUTION", name: "Institution" },
          { id: "_8343_1", name: "Physical Chemistry" },
        ],
      });
    }
    if (url === `https://bb.sustech.edu.cn/learn/api/public/v1/calendars/items?since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}`) {
      return jsonResponse({
        results: [
          {
            id: "_801_1",
            type: "Personal",
            calendarId: "PERSONAL",
            calendarName: "My Calendar",
            title: "Advisor Meeting",
            description: "<p>Bring draft</p>",
            location: "Office 301",
            start: "2026-08-22T01:00:00.000Z",
            end: "2026-08-22T02:00:00.000Z",
            modified: "2026-08-21T12:00:00.000Z",
            color: "#2f7ed8",
            disableResizing: false,
            createdByUserId: "_2_1",
          },
          {
            id: "_991_1",
            type: "GradebookColumn",
            calendarId: "_8343_1",
            calendarName: "Physical Chemistry",
            title: "Lab Report 1",
            start: "2026-08-25T10:00:00.000Z",
            end: "2026-08-25T10:30:00.000Z",
            dynamicCalendarItemProps: {
              attemptable: true,
              categoryId: "_17_1",
              dateRangeLimited: false,
              eventType: "assignment",
              gradable: true,
            },
          },
          {
            id: "_992_1",
            type: "OfficeHours",
            calendarId: "_8343_1",
            calendarName: "Physical Chemistry",
            title: "TA Office Hours",
            start: "2026-08-26T08:00:00.000Z",
            end: "2026-08-26T09:00:00.000Z",
            recurrence: {
              frequency: "Weekly",
              interval: 1,
              repeatBroken: false,
              weekDays: ["Wednesday"],
              until: "2026-12-31T00:00:00.000Z",
            },
          },
        ],
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  const calendars = await listBlackboardCalendars(adapter);
  assert.deepEqual(calendars, [
    { id: "PERSONAL", name: "My Calendar", kind: "personal" },
    { id: "INSTITUTION", name: "Institution", kind: "institution" },
    { id: "_8343_1", name: "Physical Chemistry", kind: "course", courseId: "_8343_1" },
  ]);

  const report = await listBlackboardCalendarItems(adapter, { since, until });
  assert.equal(report.totalItems, 3);
  assert.equal(report.partial, false);
  assert.equal(report.items[0]?.type, "Personal");
  assert.equal(report.items[0]?.description, "Bring draft");
  assert.equal(report.items[1]?.id, "991");
  assert.equal(report.items[1]?.courseId, "_8343_1");
  assert.equal(report.items[1]?.dynamicCalendarItemProps?.eventType, "assignment");
  assert.deepEqual(report.items[2]?.recurrence?.weekDays, ["Wednesday"]);
  assert.equal(report.items[2]?.recurrence?.frequency, "Weekly");
});

test("Blackboard calendar items split long windows and deduplicate chunk boundaries", async () => {
  const seenWindows: string[] = [];
  const adapter = routeAdapter((url) => {
    const parsed = new URL(url);
    if (parsed.pathname !== "/learn/api/public/v1/calendars/items") throw new Error(`Unexpected URL ${url}`);
    const since = parsed.searchParams.get("since") ?? "";
    const until = parsed.searchParams.get("until") ?? "";
    seenWindows.push(`${since}|${until}`);
    if (since === "2026-01-01T00:00:00.000Z") {
      return jsonResponse({
        results: [
          {
            id: "_500_1",
            type: "Course",
            calendarId: "_8343_1",
            calendarName: "Physical Chemistry",
            title: "Boundary Event",
            start: "2026-04-23T00:00:00.000Z",
            end: "2026-04-23T01:00:00.000Z",
          },
          {
            id: "_410_1",
            type: "Personal",
            calendarId: "PERSONAL",
            calendarName: "My Calendar",
            title: "Winter Plan",
            start: "2026-01-02T09:00:00.000Z",
            end: "2026-01-02T10:00:00.000Z",
          },
        ],
      });
    }
    if (since === "2026-04-23T00:00:00.000Z") {
      return jsonResponse({
        results: [
          {
            id: "_500_1",
            type: "Course",
            calendarId: "_8343_1",
            calendarName: "Physical Chemistry",
            title: "Boundary Event",
            start: "2026-04-23T00:00:00.000Z",
            end: "2026-04-23T01:00:00.000Z",
          },
          {
            id: "_620_1",
            type: "Institution",
            calendarId: "INSTITUTION",
            calendarName: "Institution",
            title: "Holiday Notice",
            start: "2026-05-05T00:00:00.000Z",
            end: "2026-05-05T23:59:00.000Z",
          },
        ],
      });
    }
    throw new Error(`Unexpected chunk ${since}..${until}`);
  });

  const report = await listBlackboardCalendarItems(adapter, {
    since: "2026-01-01T00:00:00.000Z",
    until: "2026-05-10T00:00:00.000Z",
  });
  assert.equal(report.requestedChunks, 2);
  assert.equal(report.completedChunks, 2);
  assert.equal(report.partial, false);
  assert.equal(report.totalItems, 3);
  assert.deepEqual(report.items.map((item) => item.id), ["410", "500", "620"]);
  assert.deepEqual(seenWindows, [
    "2026-01-01T00:00:00.000Z|2026-04-23T00:00:00.000Z",
    "2026-04-23T00:00:00.000Z|2026-05-10T00:00:00.000Z",
  ]);
});

test("Blackboard calendar items reject invalid time windows", async () => {
  const adapter = routeAdapter((url) => {
    throw new Error(`Network access should not happen for invalid calendar times: ${url}`);
  });

  await assert.rejects(
    listBlackboardCalendarItems(adapter, { since: "not-a-date" }),
    (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "BLACKBOARD_CALENDAR_TIME_INVALID"),
  );
  await assert.rejects(
    listBlackboardCalendarItems(adapter, {
      since: "2026-08-30T00:00:00.000Z",
      until: "2026-08-20T00:00:00.000Z",
    }),
    (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "BLACKBOARD_CALENDAR_WINDOW_INVALID"),
  );
});

test("Blackboard calendar items keep successful chunks when later chunks fail", async () => {
  const adapter = routeAdapter((url) => {
    const parsed = new URL(url);
    if (parsed.pathname !== "/learn/api/public/v1/calendars/items") throw new Error(`Unexpected URL ${url}`);
    const since = parsed.searchParams.get("since");
    if (since === "2026-01-01T00:00:00.000Z") {
      return jsonResponse({
        results: [{
          id: "_700_1",
          type: "Course",
          calendarId: "_8343_1",
          calendarName: "Physical Chemistry",
          title: "Week 1 Quiz",
          start: "2026-02-10T08:00:00.000Z",
          end: "2026-02-10T09:00:00.000Z",
        }],
      });
    }
    if (since === "2026-04-23T00:00:00.000Z") {
      return jsonResponse({ message: "upstream unavailable" }, 503);
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  const report = await listBlackboardCalendarItems(adapter, {
    since: "2026-01-01T00:00:00.000Z",
    until: "2026-05-10T00:00:00.000Z",
    type: "Course",
  });
  assert.equal(report.requestedChunks, 2);
  assert.equal(report.completedChunks, 1);
  assert.equal(report.partial, true);
  assert.equal(report.totalItems, 1);
  assert.equal(report.items[0]?.title, "Week 1 Quiz");
  assert.equal(report.failures.length, 1);
  assert.equal(report.failures[0]?.stage, "calendar-items");
  assert.equal(report.failures[0]?.status, 503);
  assert.equal(report.failures[0]?.calendarItemType, "Course");
});

test("Blackboard deadlines aggregate future assignments and preserve per-course failures", async () => {
  const adapter = routeAdapter((url) => {
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
        name: "Algorithms",
        courseCode: "CS208",
        externalId: "CS208-2026",
        availability: { available: "Yes" },
      });
    }
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v2/courses/_8343_1/gradebook/columns") {
      return jsonResponse({
        results: [
          {
            id: "_991_1",
            name: "Quiz 0",
            contentId: "_490875_1",
            availability: { available: "Yes" },
            grading: {
              type: "Attempts",
              due: "2026-08-26T18:00:00+08:00",
              scoringModel: "Last",
            },
            scoreProviderHandle: "resource/x-bb-assignment",
          },
          {
            id: "_991_1",
            name: "Lab Report 1",
            contentId: "_490876_1",
            availability: { available: "Yes" },
            grading: {
              type: "Attempts",
              due: "2026-08-27T18:00:00+08:00",
              attemptsAllowed: 2,
              scoringModel: "Last",
            },
            score: { possible: 100 },
            scoreProviderHandle: "resource/x-bb-assignment",
          },
          {
            id: "_992_1",
            name: "Final Project",
            contentId: "_490877_1",
            availability: { available: "Yes" },
            grading: {
              type: "Attempts",
              due: "2026-09-10T09:00:00+08:00",
              scoringModel: "Last",
            },
            score: { possible: 80 },
            scoreProviderHandle: "resource/x-bb-assignment",
          },
          {
            id: "_993_1",
            name: "Broken Date",
            contentId: "_490878_1",
            availability: { available: "Yes" },
            grading: {
              type: "Attempts",
              due: "soon-ish",
              scoringModel: "Last",
            },
            scoreProviderHandle: "resource/x-bb-assignment",
          },
        ],
      });
    }
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v2/courses/_9000_1/gradebook/columns") {
      return jsonResponse({ message: "upstream unavailable" }, 503);
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  const report = await listBlackboardDeadlines(adapter, {
    now: new Date("2026-08-26T12:00:00+08:00"),
    days: 7,
  });
  assert.equal(report.coursesMatched, 2);
  assert.equal(report.coursesScanned, 2);
  assert.equal(report.deadlines.length, 2);
  assert.equal(report.deadlines[0]?.title, "Quiz 0");
  assert.equal(report.deadlines[0]?.daysLeft, 0);
  assert.equal(report.deadlines[1]?.title, "Lab Report 1");
  assert.equal(report.deadlines[1]?.daysLeft, 1);
  assert.equal(report.failures.length, 2);
  assert.ok(report.failures.some((failure) => /unparseable due date/i.test(failure.message)));
  assert.ok(report.failures.some((failure) => failure.status === 503));
  assert.equal(nextBlackboardDeadline(report)?.title, "Quiz 0");
});

test("Blackboard search defaults to title-only matches and avoids attachment lookups", async () => {
  let attachmentCalls = 0;
  const adapter = routeAdapter((url) => {
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
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8343_1/contents") {
      return jsonResponse({
        results: [{
          id: "_100_1",
          parentId: "_0_1",
          title: "Intro Notes",
          contentHandler: { id: "resource/x-bb-document" },
          hasChildren: false,
        }],
      });
    }
    if (url.includes("/attachments")) {
      attachmentCalls += 1;
      throw new Error(`Attachment lookup should be skipped by default: ${url}`);
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  const report = await searchBlackboardContentTree(adapter, { query: "intro" });
  assert.equal(report.attachments, "none");
  assert.equal(report.totalMatches, 1);
  assert.equal(report.results[0]?.title, "Intro Notes");
  assert.equal(report.attachmentsScanned, 0);
  assert.equal(attachmentCalls, 0);
});

test("Blackboard search can match attachment names when explicitly requested and bounds attachment lookups", async () => {
  let attachmentCalls = 0;
  const contentItems = Array.from({ length: 205 }, (_, index) => ({
    id: `_${index + 100}_1`,
    parentId: "_0_1",
    title: `Week ${index + 1}`,
    contentHandler: { id: "resource/x-bb-document" },
    hasChildren: false,
  }));
  const adapter = routeAdapter((url) => {
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
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8343_1/contents") {
      return jsonResponse({ results: contentItems });
    }
    const contentMatch = /\/contents\/_(\d+)_1$/.exec(url);
    if (contentMatch) {
      return jsonResponse({
        id: `_${contentMatch[1]}_1`,
        parentId: "_0_1",
        title: `Week ${contentMatch[1]}`,
        contentHandler: { id: "resource/x-bb-document" },
        hasChildren: false,
      });
    }
    const attachmentMatch = /\/contents\/_(\d+)_1\/attachments$/.exec(url);
    if (attachmentMatch) {
      attachmentCalls += 1;
      return jsonResponse({
        results: [{
          id: "_1_1",
          fileName: attachmentMatch[1] === "100" ? "spec-sheet.pdf" : "notes.txt",
          mimeType: "application/pdf",
        }],
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  const report = await searchBlackboardContentTree(adapter, {
    query: "spec",
    attachments: "include",
  });
  assert.equal(report.totalMatches, 1);
  assert.equal(report.results[0]?.attachmentMatches[0]?.fileName, "spec-sheet.pdf");
  assert.equal(attachmentCalls, 200);
  assert.ok(report.failures.some((failure) => /attachment-name lookups/.test(failure.message)));
});

test("Blackboard search avoids cycles while traversing nested content trees", async () => {
  const adapter = routeAdapter((url) => {
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
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8343_1/contents") {
      return jsonResponse({
        results: [{
          id: "_100_1",
          parentId: "_0_1",
          title: "Loop Root",
          contentHandler: { id: "resource/x-bb-folder" },
          hasChildren: true,
        }],
      });
    }
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8343_1/contents/_100_1/children") {
      return jsonResponse({
        results: [{
          id: "_200_1",
          parentId: "_100_1",
          title: "Loop Target",
          contentHandler: { id: "resource/x-bb-folder" },
          hasChildren: true,
        }],
      });
    }
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8343_1/contents/_200_1/children") {
      return jsonResponse({
        results: [{
          id: "_100_1",
          parentId: "_200_1",
          title: "Loop Root",
          contentHandler: { id: "resource/x-bb-folder" },
          hasChildren: true,
        }],
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  const report = await searchBlackboardContentTree(adapter, { query: "target" });
  assert.equal(report.totalMatches, 1);
  assert.equal(report.contentsScanned, 2);
  assert.equal(report.results[0]?.title, "Loop Target");
});

test("Blackboard search bounds oversized traversals", async () => {
  const contentItems = Array.from({ length: 2_005 }, (_, index) => ({
    id: `_${index + 100}_1`,
    parentId: "_0_1",
    title: `Topic ${index + 1}`,
    contentHandler: { id: "resource/x-bb-document" },
    hasChildren: false,
  }));
  const adapter = routeAdapter((url) => {
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
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8343_1/contents") {
      return jsonResponse({ results: contentItems });
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  const report = await searchBlackboardContentTree(adapter, { query: "nope" });
  assert.equal(report.contentsScanned, 2_000);
  assert.ok(report.failures.some((failure) => /stopped after 2000 content items/.test(failure.message)));
});

test("Blackboard sync downloads attachments into a safe destination and preserves no-overwrite semantics", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "sustech-bb-sync-"));
  const payload = new TextEncoder().encode("report bytes");
  const adapter = routeAdapter((url) => {
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/users/me") {
      return jsonResponse({ id: "_1_1", userName: "12200000", name: "Student Name" });
    }
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/users/_1_1/courses") {
      return jsonResponse({ results: [{ courseId: "_8537_1", courseRoleId: "Student" }] });
    }
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8537_1") {
      return jsonResponse({
        id: "_8537_1",
        name: "Data Structures",
        courseCode: "CS208",
        externalId: "CS208-2026",
        availability: { available: "Yes" },
      });
    }
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8537_1/contents") {
      return jsonResponse({
        results: [{
          id: "_300_1",
          parentId: "_0_1",
          title: "Homework / 1",
          contentHandler: { id: "resource/x-bb-assignment" },
          hasChildren: false,
        }],
      });
    }
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8537_1/contents/_300_1") {
      return jsonResponse({
        id: "_300_1",
        parentId: "_0_1",
        title: "Homework / 1",
        contentHandler: { id: "resource/x-bb-assignment" },
      });
    }
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8537_1/contents/_300_1/attachments") {
      return jsonResponse({
        results: [{
          id: "_42588_1",
          fileName: "../report.final.pdf",
          mimeType: "application/pdf",
        }],
      });
    }
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8537_1/contents/_300_1/attachments/_42588_1/download") {
      return binaryResponse(payload, "application/pdf");
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  try {
    const first = await syncBlackboardAttachments(adapter, {
      courseId: "_8537_1",
      destination: tempDir,
    });
    assert.equal(first.downloadedFiles, 1);
    assert.equal(first.partial, false);
    assert.deepEqual(first.files[0]?.relativePath.split(/[\\/]+/), ["Homework 1 [content-300]", "report.final [42588].pdf"]);
    assert.equal(first.files[0]?.relativePath.includes(".."), false);
    assert.equal(await readFile(first.files[0]!.destination, "utf8"), "report bytes");

    const second = await syncBlackboardAttachments(adapter, {
      courseId: "_8537_1",
      destination: tempDir,
    });
    assert.equal(second.downloadedFiles, 0);
    assert.equal(second.partial, true);
    assert.equal(second.failures[0]?.code, "BLACKBOARD_DOWNLOAD_DESTINATION_EXISTS");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("Blackboard sync rejects symbolic-link destinations before any network access", {
  skip: process.platform === "win32",
}, async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "sustech-bb-sync-link-"));
  const realDir = join(tempDir, "real");
  const linkDir = join(tempDir, "link");
  await rm(realDir, { recursive: true, force: true });
  await rm(linkDir, { recursive: true, force: true });
  const actualDir = await mkdtemp(`${realDir}-`);
  await symlink(actualDir, linkDir);
  const adapter = routeAdapter((url) => {
    throw new Error(`Network access should not happen for an invalid destination: ${url}`);
  });

  try {
    await assert.rejects(
      syncBlackboardAttachments(adapter, { courseId: "_8537_1", destination: linkDir }),
      (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "BLACKBOARD_SYNC_DESTINATION_INVALID"),
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("Blackboard sync rejects a symbolic-link parent before creating the destination", {
  skip: process.platform === "win32",
}, async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "sustech-bb-sync-parent-link-"));
  const realParent = join(tempDir, "real-parent");
  const linkedParent = join(tempDir, "linked-parent");
  await mkdir(realParent);
  await symlink(realParent, linkedParent);
  let calls = 0;
  const adapter = routeAdapter((url) => {
    calls += 1;
    throw new Error(`Network access should not happen for an invalid destination: ${url}`);
  });

  try {
    await assert.rejects(
      syncBlackboardAttachments(adapter, {
        courseId: "_8537_1",
        destination: join(linkedParent, "new-sync-root"),
      }),
      (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "BLACKBOARD_SYNC_DESTINATION_INVALID"),
    );
    assert.equal(calls, 0);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
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

function binaryResponse(bytes: Uint8Array, contentType: string): Response {
  return new Response(bytes, {
    status: 200,
    headers: { "content-type": contentType, "content-length": String(bytes.byteLength) },
  });
}
