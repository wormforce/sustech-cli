import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBlackboardDiscussionWritePreflight,
  type BlackboardDiscussionWriteInput,
  type BlackboardDiscussionWriteTarget,
} from "../cli.js";
import {
  createBlackboardDiscussionMessage,
  createBlackboardDiscussionReply,
} from "../services/blackboard.js";
import type { ServiceAdapter } from "../services/base.js";

test("Blackboard discussion write helpers follow the official discussion message and reply endpoints", async () => {
  const calls: string[] = [];
  const adapter = routeAdapter((url, init) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);

    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8343_1/discussions/_65_1/messages" && init?.method === "POST") {
      assert.equal(new Headers(init.headers).get("content-type"), "application/json");
      assert.deepEqual(JSON.parse(String(init.body)), {
        body: "Hello everyone",
        groupId: "_778_1",
        status: "Published",
      });
      return jsonResponse({
        id: "_8801_1",
        discussionId: "_65_1",
        parentId: "",
        threadId: "_8801_1",
        userId: "_1_1",
        groupId: "_778_1",
        givenName: "Alice",
        familyName: "Student",
        status: "Published",
        body: "<p>Hello everyone</p>",
        postDate: "2026-09-03T10:00:00.000Z",
        createdDate: "2026-09-03T10:00:00.000Z",
        modifiedDate: "2026-09-03T10:00:00.000Z",
        isRead: false,
      }, 201);
    }

    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8343_1/discussions/_65_1/messages/_8801_1/replies" && init?.method === "POST") {
      assert.equal(new Headers(init.headers).get("content-type"), "application/json");
      assert.deepEqual(JSON.parse(String(init.body)), {
        body: "Thanks!",
        status: "Draft",
      });
      return jsonResponse({
        id: "_8802_1",
        discussionId: "_65_1",
        parentId: "_8801_1",
        threadId: "_8801_1",
        userId: "_1_1",
        groupId: "",
        givenName: "Alice",
        familyName: "Student",
        status: "Draft",
        body: "Thanks!",
        postDate: "2026-09-03T10:01:00.000Z",
        createdDate: "2026-09-03T10:01:00.000Z",
        modifiedDate: "2026-09-03T10:01:00.000Z",
        isRead: false,
      }, 201);
    }

    throw new Error(`Unexpected URL ${url}`);
  });

  const created = await createBlackboardDiscussionMessage(adapter, "8343", "65", {
    body: "Hello everyone",
    groupId: "778",
    status: "Published",
  });
  assert.deepEqual(created, {
    id: "8801",
    discussionId: "65",
    parentId: "",
    threadId: "8801",
    userId: "_1_1",
    groupId: "778",
    givenName: "Alice",
    familyName: "Student",
    author: "Alice Student",
    status: "Published",
    body: "Hello everyone",
    postDate: "2026-09-03T10:00:00.000Z",
    editDate: "",
    createdDate: "2026-09-03T10:00:00.000Z",
    modifiedDate: "2026-09-03T10:00:00.000Z",
    isRead: false,
    source: "learn-rest",
  });

  const reply = await createBlackboardDiscussionReply(adapter, "8343", "65", "8801", {
    body: "Thanks!",
    status: "Draft",
  });
  assert.deepEqual(reply, {
    id: "8802",
    discussionId: "65",
    parentId: "8801",
    threadId: "8801",
    userId: "_1_1",
    groupId: "",
    givenName: "Alice",
    familyName: "Student",
    author: "Alice Student",
    status: "Draft",
    body: "Thanks!",
    postDate: "2026-09-03T10:01:00.000Z",
    editDate: "",
    createdDate: "2026-09-03T10:01:00.000Z",
    modifiedDate: "2026-09-03T10:01:00.000Z",
    isRead: false,
    source: "learn-rest",
  });

  assert.deepEqual(calls, [
    "POST https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8343_1/discussions/_65_1/messages",
    "POST https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8343_1/discussions/_65_1/messages/_8801_1/replies",
  ]);
});

test("Blackboard discussion write helpers reject blank text before network access", async () => {
  let called = false;
  const adapter = routeAdapter(() => {
    called = true;
    return jsonResponse({});
  });

  await assert.rejects(
    createBlackboardDiscussionMessage(adapter, "8343", "65", { body: " \n\t " }),
    hasCode("BLACKBOARD_DISCUSSION_TEXT_EMPTY"),
  );
  assert.equal(called, false);
});

test("Blackboard discussion-post preflight fails closed for Original HTML fallback discussions", async () => {
  const preflight = await buildBlackboardDiscussionWritePreflight(
    originalDiscussionWritePreviewAdapter(1),
    {},
    {
      mode: "post",
      courseId: "_8537_1",
      discussionId: "28850",
      status: "Published",
    } satisfies BlackboardDiscussionWriteTarget,
    sampleDiscussionWriteInput("课程讨论回复"),
  );

  assert.equal(preflight.discussion.source, "original-html");
  assert.equal(preflight.applyAllowed, false);
  assert.equal(preflight.confirmation.available, false);
  assert.equal(preflight.confirmation.expectedSha256, "abc123");
  assert.ok(preflight.blockers.some((entry) => entry.code === "REST_SURFACE_REQUIRED"));
  assert.match(
    preflight.blockers.find((entry) => entry.code === "REST_SURFACE_REQUIRED")?.message ?? "",
    /Original HTML fallback/u,
  );
  assert.equal(preflight.confirmation.command, undefined);
});

test("Blackboard discussion-reply preflight fails closed for Original HTML fallback parent messages", async () => {
  const preflight = await buildBlackboardDiscussionWritePreflight(
    originalDiscussionWritePreviewAdapter(100),
    {},
    {
      mode: "reply",
      courseId: "_8537_1",
      discussionId: "28850",
      messageId: "133567",
      status: "Published",
    } satisfies BlackboardDiscussionWriteTarget,
    sampleDiscussionWriteInput("我会准备好。"),
  );

  assert.equal(preflight.discussion.source, "original-html");
  assert.equal(preflight.parentMessage?.id, "133567");
  assert.equal(preflight.parentMessage?.source, "original-html");
  assert.equal(preflight.applyAllowed, false);
  assert.equal(preflight.confirmation.available, false);
  assert.ok(preflight.blockers.some((entry) => entry.code === "REST_SURFACE_REQUIRED"));
});

function routeAdapter(route: (url: string, init?: RequestInit) => Response | Promise<Response>): ServiceAdapter {
  return {
    name: "blackboard-discussion-write",
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

function sampleDiscussionWriteInput(body: string): BlackboardDiscussionWriteInput {
  return {
    textFile: {
      path: "discussion.txt",
      absolutePath: "/tmp/discussion.txt",
      size: Buffer.byteLength(body, "utf8"),
      sha256: "abc123",
      charCount: body.length,
    },
    body,
  };
}

function originalDiscussionWritePreviewAdapter(messageLimit: 1 | 100): ServiceAdapter {
  return routeAdapter((url) => {
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8537_1") {
      return jsonResponse({
        id: "_8537_1",
        name: "专业实习（2026夏）",
        courseCode: "BMEB470",
        externalId: "BMEB470-2026",
        availability: { available: "Yes" },
      });
    }
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8537_1/discussions/_28850_1") {
      return jsonResponse({ status: 400, message: "Original courses are not supported by this API" }, 400);
    }
    if (url === `https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8537_1/discussions/_28850_1/messages?offset=0&limit=${messageLimit}`) {
      return jsonResponse({ status: 400, message: "Original courses are not supported by this API" }, 400);
    }
    if (url === "https://bb.sustech.edu.cn/webapps/blackboard/content/launchLink.jsp?course_id=_8537_1&tool_id=_142_1&tool_type=TOOL&mode=reset") {
      return textResponse(`
        <html>
          <body>
            <input type="hidden" name="conf_id" value="_20961_1" />
            <div class="pagingprefs" id="listContainer_itemcount">
              <span>Displaying <strong>1</strong> to <strong>1</strong> of <strong>1</strong> items</span>
            </div>
            <table id="listContainer_datatable">
              <tr id="listContainer_row:_28850_1">
                <th scope="row"><span class="dbheading"><a href="/webapps/discussionboard/do/forum?action=list_threads&amp;course_id=_8537_1&amp;nav=discussion_board_entry&amp;conf_id=_20961_1&amp;forum_id=_28850_1">Choose Topic</a></span></th>
                <td><span class="mobile-table-label">Description: </span><span class="table-data-cell-value"><div class="item-description">Pick a topic and post your report.</div></span></td>
                <td><span class="mobile-table-label">Total Posts: </span><span class="table-data-cell-value"><span class="total-count none"> 4</span></span></td>
              </tr>
            </table>
          </body>
        </html>
      `, "text/html");
    }
    if (url === "https://bb.sustech.edu.cn/webapps/discussionboard/do/forum?action=list_threads&course_id=_8537_1&nav=discussion_board_entry&conf_id=_20961_1&forum_id=_28850_1&forum_view=list&showAll=true") {
      return textResponse(`
        <html>
          <body>
            <div class="pagingprefs" id="listContainer_itemcount">
              <span>Displaying <strong>1</strong> to <strong>1</strong> of <strong>1</strong> items</span>
            </div>
            <table id="listContainer_datatable">
              <tr id="listContainer_row:0">
                <th scope="row"><a href="/webapps/discussionboard/do/message?action=list_messages&amp;course_id=_8537_1&amp;nav=discussion_board_entry&amp;conf_id=_20961_1&amp;forum_id=_28850_1&amp;message_id=_133567_1">第一周课前思考</a></th>
                <td><span class="mobile-table-label">日期: </span><span class="table-data-cell-value"><span class="unreadmessage">20-12-28 下午5:30</span></span></td>
                <td><span class="mobile-table-label">作者: </span><span class="table-data-cell-value">匿名</span></td>
                <td><span class="mobile-table-label">状态: </span><span class="table-data-cell-value">已发布</span></td>
                <td><span class="mobile-table-label">未读帖子: </span><span class="table-data-cell-value"><span class="unread-count">1</span></span></td>
                <td><span class="mobile-table-label">未读对我的回复: </span><span class="table-data-cell-value"><span class="unread-count none">0</span></span></td>
                <td><span class="mobile-table-label">帖子总数: </span><span class="table-data-cell-value"><span class="total-count">1</span></span></td>
              </tr>
            </table>
          </body>
        </html>
      `, "text/html");
    }
    if (url === "https://bb.sustech.edu.cn/webapps/discussionboard/do/message?action=message_frame&course_id=_8537_1&nav=discussion_board_entry&conf_id=_20961_1&forum_id=_28850_1&message_id=_133567_1&thread_id=_133567_1") {
      return textResponse(`<div class="dbThreadBody"><div class="vtbegenerated"><p>请大家先思考课程目标。</p></div></div><div class="dbThreadFooter"></div>`, "text/html");
    }
    throw new Error(`Unexpected URL ${url}`);
  });
}

function textResponse(body: string, contentType: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": contentType },
  });
}
