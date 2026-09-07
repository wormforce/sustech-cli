import assert from "node:assert/strict";
import test from "node:test";
import { createBlackboardCourseMessage } from "../services/blackboard.js";
import type { ServiceAdapter } from "../services/base.js";

test("Blackboard course-message write helper follows the official message-create endpoint", async () => {
  const calls: string[] = [];
  const adapter = routeAdapter((url, init) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);

    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8343_1/messages" && init?.method === "POST") {
      assert.equal(new Headers(init.headers).get("content-type"), "application/json");
      assert.deepEqual(JSON.parse(String(init.body)), {
        subject: "Project update",
        body: "Bring the latest draft",
        toUsers: [{ id: "_1_1" }, { id: "_2_1" }],
        ccUsers: [{ id: "_3_1" }],
      });
      return jsonResponse({
        id: "_71_1",
        subject: "Project update",
        body: "<p>Bring the latest draft</p>",
        postedDate: "2026-09-03T08:00:00.000Z",
        isRead: false,
        type: "Normal",
        senderId: "_7_1",
        toUsers: ["_1_1", "_2_1"],
        ccUsers: ["_3_1"],
        bccUsers: [],
        isExistingAttachment: false,
        isReply: false,
      }, 201);
    }

    throw new Error(`Unexpected URL ${url}`);
  });

  const created = await createBlackboardCourseMessage(adapter, "8343", {
    subject: "Project update",
    body: "Bring the latest draft",
    toUsers: ["1", "_2_1"],
    ccUsers: ["3"],
  });

  assert.deepEqual(created, {
    id: "71",
    subject: "Project update",
    body: "Bring the latest draft",
    postedDate: "2026-09-03T08:00:00.000Z",
    isRead: false,
    type: "Normal",
    senderId: "_7_1",
    toUsers: ["_1_1", "_2_1"],
    ccUsers: ["_3_1"],
    bccUsers: [],
    isExistingAttachment: false,
    isReply: false,
  });

  assert.deepEqual(calls, [
    "POST https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8343_1/messages",
  ]);
});

test("Blackboard course-message write helper rejects blank text, missing recipients, and duplicated recipients before network access", async () => {
  let called = false;
  const adapter = routeAdapter(() => {
    called = true;
    return jsonResponse({});
  });

  await assert.rejects(
    createBlackboardCourseMessage(adapter, "8343", { body: " \n\t ", toUsers: ["1"] }),
    hasCode("BLACKBOARD_MESSAGE_TEXT_EMPTY"),
  );
  await assert.rejects(
    createBlackboardCourseMessage(adapter, "8343", { body: "hello", toUsers: [] }),
    hasCode("BLACKBOARD_MESSAGE_RECIPIENTS_EMPTY"),
  );
  await assert.rejects(
    createBlackboardCourseMessage(adapter, "8343", { body: "hello", toUsers: ["1"], ccUsers: ["_1_1"] }),
    hasCode("BLACKBOARD_MESSAGE_RECIPIENT_DUPLICATE"),
  );
  assert.equal(called, false);
});

function routeAdapter(route: (url: string, init?: RequestInit) => Response | Promise<Response>): ServiceAdapter {
  return {
    name: "blackboard-message-write",
    fetch(input: string, init?: RequestInit): Promise<Response> {
      return Promise.resolve(route(String(input), init));
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function hasCode(code: string): (error: unknown) => boolean {
  return (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}
