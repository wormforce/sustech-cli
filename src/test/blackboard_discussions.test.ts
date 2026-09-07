import assert from "node:assert/strict";
import test from "node:test";
import { CliError } from "../core/errors.js";
import {
  getBlackboardDiscussion,
  getBlackboardDiscussionMessages,
  listBlackboardDiscussionGroups,
  listBlackboardDiscussionReplies,
  listBlackboardDiscussions,
} from "../services/blackboard.js";
import type { ServiceAdapter } from "../services/base.js";
import {
  formatBlackboardDiscussion,
  formatBlackboardDiscussionGroups,
  formatBlackboardDiscussionReplies,
  formatBlackboardDiscussions,
} from "../services/text.js";

test("Blackboard discussions normalize course forums and paging metadata", async () => {
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
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8343_1/discussions?offset=25&limit=25&title=Lab&gradable=true&sort=modifiedDate%28desc%29") {
      return jsonResponse({
        results: [
          {
            id: "_65_1",
            title: "<b>Lab</b> board",
            available: true,
            gradable: true,
            gradebookColumnId: "_991_1",
            groupDiscussion: false,
            createdDate: "2026-08-20T08:00:00.000Z",
            modifiedDate: "2026-08-26T08:30:00.000Z",
            topic: {
              id: "_70_1",
              discussionId: "_65_1",
              parentId: "",
              threadId: "_70_1",
              userId: "_7_1",
              givenName: "Alice",
              familyName: "Chen",
              status: "Published",
              body: "<p>Start&nbsp;here</p>",
              postDate: "2026-08-20T08:00:00.000Z",
              editDate: "",
              createdDate: "2026-08-20T08:00:00.000Z",
              modifiedDate: "2026-08-20T08:00:00.000Z",
              isRead: true,
            },
          },
          {
            id: "_66_1",
            title: "Group project Q&A",
            available: false,
            gradable: false,
            groupDiscussion: true,
            createdDate: "2026-08-18T10:00:00.000Z",
            modifiedDate: "2026-08-24T10:00:00.000Z",
          },
        ],
        paging: {
          nextPage: "/learn/api/public/v1/courses/_8343_1/discussions?offset=50&limit=25",
        },
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  const report = await listBlackboardDiscussions(adapter, {
    courseId: "8343",
    title: "Lab",
    gradable: true,
    page: 2,
    pageSize: 25,
    sort: "modifiedDate(desc)",
  });

  assert.equal(report.courseId, "_8343_1");
  assert.equal(report.courseCode, "CHEM201");
  assert.equal(report.courseName, "Physical Chemistry");
  assert.equal(report.page, 2);
  assert.equal(report.pageSize, 25);
  assert.equal(report.returned, 2);
  assert.equal(report.hasMore, true);
  assert.equal(report.nextPage, 3);
  assert.equal(report.discussions[0]?.id, "65");
  assert.equal(report.discussions[0]?.title, "Lab board");
  assert.equal(report.discussions[0]?.gradebookColumnId, "991");
  assert.equal(report.discussions[0]?.topic?.body, "Start here");
  assert.equal(report.discussions[0]?.topic?.author, "Alice Chen");
  assert.equal(report.discussions[1]?.groupDiscussion, true);
  assert.equal(report.discussions[1]?.available, false);
  assert.match(formatBlackboardDiscussions(report), /Next page: 3/u);
});

test("Blackboard discussions fall back to Original-course HTML forum lists when REST rejects the course", async () => {
  const adapter = routeAdapter((url) => {
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8537_1") {
      return jsonResponse({
        id: "_8537_1",
        name: "专业实习（2026夏）",
        courseCode: "BMEB470",
        externalId: "BMEB470-2026",
        availability: { available: "Yes" },
      });
    }
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8537_1/discussions?offset=0&limit=25") {
      return jsonResponse({ status: 400, message: "Original courses are not supported by this API" }, 400);
    }
    if (url === "https://bb.sustech.edu.cn/webapps/blackboard/content/launchLink.jsp?course_id=_8537_1&tool_id=_142_1&tool_type=TOOL&mode=reset") {
      return textResponse(`
        <html>
          <body>
            <input type="hidden" name="conf_id" value="_20961_1" />
            <div class="pagingprefs" id="listContainer_itemcount">
              <span>Displaying <strong>1</strong> to <strong>2</strong> of <strong>2</strong> items</span>
            </div>
            <table id="listContainer_datatable">
              <tr id="listContainer_row:_28850_1">
                <th scope="row"><span class="dbheading"><a href="/webapps/discussionboard/do/forum?action=list_threads&course_id=_8537_1&nav=discussion_board_entry&conf_id=_20961_1&forum_id=_28850_1">Choose Topic</a></span></th>
                <td><span class="mobile-table-label">Description: </span><span class="table-data-cell-value"><div class="item-description">Pick a topic and post your report.</div></span></td>
                <td><span class="mobile-table-label">Total Posts: </span><span class="table-data-cell-value"><span class="total-count none"> 4</span></span></td>
                <td><span class="mobile-table-label">Unread Posts: </span><span class="table-data-cell-value"><span class="unread-count none"> 1</span></span></td>
                <td><span class="mobile-table-label">Unread Replies To Me: </span><span class="table-data-cell-value"><span class="unread-count none"> 0</span></span></td>
                <td><span class="mobile-table-label">Total Participants: </span><span class="table-data-cell-value"><span class="participants-count none"> 4</span></span></td>
              </tr>
              <tr id="listContainer_row:_28851_1">
                <th scope="row"><span class="dbheading"><a href="/webapps/discussionboard/do/forum?action=list_threads&course_id=_8537_1&nav=discussion_board_entry&conf_id=_20961_1&forum_id=_28851_1">Progress Q&amp;A</a></span></th>
                <td><span class="mobile-table-label">Description: </span><span class="table-data-cell-value"><div class="item-description"></div></span></td>
                <td><span class="mobile-table-label">Total Posts: </span><span class="table-data-cell-value"><span class="total-count none"> 0</span></span></td>
                <td><span class="mobile-table-label">Unread Posts: </span><span class="table-data-cell-value"><span class="unread-count none"> 0</span></span></td>
                <td><span class="mobile-table-label">Unread Replies To Me: </span><span class="table-data-cell-value"><span class="unread-count none"> 0</span></span></td>
                <td><span class="mobile-table-label">Total Participants: </span><span class="table-data-cell-value"><span class="participants-count none"> 0</span></span></td>
              </tr>
            </table>
          </body>
        </html>
      `, "text/html");
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  const report = await listBlackboardDiscussions(adapter, { courseId: "_8537_1" });
  assert.equal(report.courseCode, "BMEB470");
  assert.equal(report.returned, 2);
  assert.equal(report.hasMore, false);
  assert.equal(report.discussions[0]?.id, "28850");
  assert.equal(report.discussions[0]?.source, "original-html");
  assert.equal(report.discussions[0]?.metadataPartial, true);
  assert.equal(report.discussions[0]?.description, "Pick a topic and post your report.");
  assert.equal(report.discussions[0]?.totalPosts, 4);
  assert.equal(report.discussions[0]?.unreadPosts, 1);
  assert.equal(report.discussions[0]?.totalParticipants, 4);
  assert.equal(report.discussions[1]?.title, "Progress Q&A");
  assert.match(formatBlackboardDiscussions(report), /Original HTML fallback/u);
  assert.match(formatBlackboardDiscussions(report), /metadata partial/u);
});

test("Blackboard discussion fallback rejects gradable filtering for Original-course HTML forums", async () => {
  const adapter = routeAdapter((url) => {
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8537_1") {
      return jsonResponse({
        id: "_8537_1",
        name: "专业实习（2026夏）",
        courseCode: "BMEB470",
        externalId: "BMEB470-2026",
        availability: { available: "Yes" },
      });
    }
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8537_1/discussions?offset=0&limit=25&gradable=true") {
      return jsonResponse({ status: 400, message: "Original courses are not supported by this API" }, 400);
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  await assert.rejects(
    listBlackboardDiscussions(adapter, { courseId: "_8537_1", gradable: true }),
    (error: unknown) => {
      assert.ok(error instanceof CliError);
      assert.equal(error.code, "BLACKBOARD_DISCUSSIONS_FILTER_UNSUPPORTED");
      assert.equal(error.details?.courseId, "_8537_1");
      assert.equal(error.details?.filter, "gradable");
      return true;
    },
  );
});

test("Blackboard Original forum fallback still lists parseable forums when the HTML omits conf_id", async () => {
  const adapter = routeAdapter((url) => {
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8537_1") {
      return jsonResponse({
        id: "_8537_1",
        name: "专业实习（2026夏）",
        courseCode: "BMEB470",
        externalId: "BMEB470-2026",
        availability: { available: "Yes" },
      });
    }
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8537_1/discussions?offset=0&limit=25") {
      return jsonResponse({ status: 400, message: "Original courses are not supported by this API" }, 400);
    }
    if (url === "https://bb.sustech.edu.cn/webapps/blackboard/content/launchLink.jsp?course_id=_8537_1&tool_id=_142_1&tool_type=TOOL&mode=reset") {
      return textResponse(`
        <html>
          <body>
            <div class="pagingprefs" id="listContainer_itemcount">
              <span>Displaying <strong>1</strong> to <strong>2</strong> of <strong>2</strong> items</span>
            </div>
            <table id="listContainer_datatable">
              <tr id="listContainer_row:_28850_1"><th scope="row"><span class="dbheading"><a>Choose Topic</a></span></th></tr>
              <tr id="listContainer_row:_28851_1"><th scope="row"><span class="dbheading"><a>Progress Q&amp;A</a></span></th></tr>
            </table>
          </body>
        </html>
      `, "text/html");
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  const report = await listBlackboardDiscussions(adapter, { courseId: "_8537_1" });

  assert.equal(report.courseCode, "BMEB470");
  assert.equal(report.returned, 2);
  assert.equal(report.hasMore, false);
  assert.deepEqual(report.discussions.map((discussion) => discussion.id), ["28850", "28851"]);
  assert.deepEqual(report.discussions.map((discussion) => discussion.title), ["Choose Topic", "Progress Q&A"]);
});

test("Blackboard discussion messages normalize filters and forum metadata", async () => {
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
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8343_1/discussions/_65_1") {
      return jsonResponse({
        id: "_65_1",
        title: "Lab board",
        available: true,
        gradable: true,
        gradebookColumnId: "_991_1",
        groupDiscussion: false,
        createdDate: "2026-08-20T08:00:00.000Z",
        modifiedDate: "2026-08-26T08:30:00.000Z",
        topic: {
          id: "_70_1",
          discussionId: "_65_1",
          parentId: "",
          threadId: "_70_1",
          userId: "_7_1",
          givenName: "Alice",
          familyName: "Chen",
          status: "Published",
          body: "<p>Start here</p>",
          postDate: "2026-08-20T08:00:00.000Z",
          editDate: "",
          createdDate: "2026-08-20T08:00:00.000Z",
          modifiedDate: "2026-08-20T08:00:00.000Z",
          isRead: true,
        },
      });
    }
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8343_1/discussions/_65_1/messages?offset=0&limit=2&userId=_1_1&status=Published&isRead=false&sort=postDate%28desc%29") {
      return jsonResponse({
        results: [
          {
            id: "_71_1",
            discussionId: "_65_1",
            parentId: "",
            threadId: "_71_1",
            userId: "_1_1",
            givenName: "Student",
            familyName: "One",
            status: "Published",
            body: "<p>First&nbsp;post</p>",
            postDate: "2026-08-26T10:00:00.000Z",
            editDate: "",
            createdDate: "2026-08-26T09:59:00.000Z",
            modifiedDate: "2026-08-26T10:00:00.000Z",
            isRead: false,
          },
          {
            id: "_72_1",
            discussionId: "_65_1",
            parentId: "_71_1",
            threadId: "_71_1",
            userId: "_2_1",
            givenName: "",
            familyName: "",
            status: "Published",
            body: "<div>TA reply</div>",
            postDate: "2026-08-26T10:05:00.000Z",
            editDate: "",
            createdDate: "2026-08-26T10:04:00.000Z",
            modifiedDate: "2026-08-26T10:05:00.000Z",
            isRead: false,
          },
        ],
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  const report = await getBlackboardDiscussionMessages(adapter, {
    courseId: "_8343_1",
    discussionId: "65",
    userId: "_1_1",
    status: "Published",
    isRead: false,
    page: 1,
    pageSize: 2,
    sort: "postDate(desc)",
  });

  assert.equal(report.courseCode, "CHEM201");
  assert.equal(report.discussion.id, "65");
  assert.equal(report.discussion.topic?.body, "Start here");
  assert.equal(report.returned, 2);
  assert.equal(report.hasMore, false);
  assert.equal(report.messages[0]?.id, "71");
  assert.equal(report.messages[0]?.author, "Student One");
  assert.equal(report.messages[0]?.body, "First post");
  assert.equal(report.messages[0]?.isRead, false);
  assert.equal(report.messages[1]?.author, "_2_1");
  assert.equal(report.messages[1]?.parentId, "71");
  assert.equal(report.messages[1]?.threadId, "71");
  assert.match(formatBlackboardDiscussion(report), /Lab board/u);
  assert.match(formatBlackboardDiscussion(report), /unread/u);
});

test("Blackboard discussion messages fall back to Original-course HTML thread lists when REST rejects the course", async () => {
  const seen: string[] = [];
  const adapter = routeAdapter((url) => {
    seen.push(url);
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
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8537_1/discussions/_28850_1/messages?offset=0&limit=2&status=Published&isRead=false&sort=postDate%28desc%29") {
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
                <td><span class="mobile-table-label">Unread Posts: </span><span class="table-data-cell-value"><span class="unread-count none"> 1</span></span></td>
                <td><span class="mobile-table-label">Unread Replies To Me: </span><span class="table-data-cell-value"><span class="unread-count none"> 0</span></span></td>
                <td><span class="mobile-table-label">Total Participants: </span><span class="table-data-cell-value"><span class="participants-count none"> 4</span></span></td>
              </tr>
            </table>
          </body>
        </html>
      `, "text/html");
    }
    if (url === "https://bb.sustech.edu.cn/webapps/discussionboard/do/conference?action=list_forums&course_id=_8537_1&conf_id=_20961_1&nav=discussion_board_entry&toggle_mode=read&mode=view&showAll=true&startIndex=0&sortCol=position&sortDir=ASCENDING") {
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
                <td><span class="mobile-table-label">Unread Posts: </span><span class="table-data-cell-value"><span class="unread-count none"> 1</span></span></td>
                <td><span class="mobile-table-label">Unread Replies To Me: </span><span class="table-data-cell-value"><span class="unread-count none"> 0</span></span></td>
                <td><span class="mobile-table-label">Total Participants: </span><span class="table-data-cell-value"><span class="participants-count none"> 4</span></span></td>
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
              <span>Displaying <strong>1</strong> to <strong>2</strong> of <strong>2</strong> items</span>
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
              <tr id="listContainer_row:1">
                <th scope="row"><a href="/webapps/discussionboard/do/message?action=list_messages&amp;course_id=_8537_1&amp;nav=discussion_board_entry&amp;conf_id=_20961_1&amp;forum_id=_28850_1&amp;message_id=_133566_1">第一章预习要求</a></th>
                <td><span class="mobile-table-label">日期: </span><span class="table-data-cell-value"><span>20-12-27 下午4:05</span></span></td>
                <td><span class="mobile-table-label">作者: </span><span class="table-data-cell-value">张三</span></td>
                <td><span class="mobile-table-label">状态: </span><span class="table-data-cell-value">草稿</span></td>
                <td><span class="mobile-table-label">未读帖子: </span><span class="table-data-cell-value"><span class="unread-count none">0</span></span></td>
                <td><span class="mobile-table-label">未读对我的回复: </span><span class="table-data-cell-value"><span class="unread-count none">0</span></span></td>
                <td><span class="mobile-table-label">帖子总数: </span><span class="table-data-cell-value"><span class="total-count">3</span></span></td>
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

  const report = await getBlackboardDiscussionMessages(adapter, {
    courseId: "_8537_1",
    discussionId: "28850",
    status: "Published",
    isRead: false,
    page: 1,
    pageSize: 2,
    sort: "postDate(desc)",
  });

  assert.equal(report.courseCode, "BMEB470");
  assert.equal(report.discussion.id, "28850");
  assert.equal(report.discussion.source, "original-html");
  assert.equal(report.discussion.metadataPartial, true);
  assert.equal(report.returned, 1);
  assert.equal(report.hasMore, false);
  assert.equal(report.messages[0]?.id, "133567");
  assert.equal(report.messages[0]?.discussionId, "28850");
  assert.equal(report.messages[0]?.subject, "第一周课前思考");
  assert.equal(report.messages[0]?.author, "匿名");
  assert.equal(report.messages[0]?.status, "Published");
  assert.equal(report.messages[0]?.isRead, false);
  assert.equal(report.messages[0]?.postDate, "2020-12-28T09:30:00.000Z");
  assert.equal(report.messages[0]?.body, "请大家先思考课程目标。");
  assert.equal(report.messages[0]?.source, "original-html");
  assert.equal(report.messages[0]?.metadataPartial, true);
  assert.equal(report.messages[0]?.unreadPosts, 1);
  assert.equal(report.messages[0]?.totalPosts, 1);
  assert.deepEqual(
    seen.filter((url) => url.includes("message_frame")),
    ["https://bb.sustech.edu.cn/webapps/discussionboard/do/message?action=message_frame&course_id=_8537_1&nav=discussion_board_entry&conf_id=_20961_1&forum_id=_28850_1&message_id=_133567_1&thread_id=_133567_1"],
  );
  assert.match(formatBlackboardDiscussion(report), /Original HTML fallback/u);
  assert.match(formatBlackboardDiscussion(report), /metadata partial/u);
  assert.match(formatBlackboardDiscussion(report), /第一周课前思考/u);
});

test("Blackboard discussion fallback can recover conf_id from the final launch URL when the HTML omits it", async () => {
  const adapter = routeAdapter((url) => {
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
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8537_1/discussions/_28850_1/messages?offset=0&limit=1") {
      return jsonResponse({ status: 400, message: "Original courses are not supported by this API" }, 400);
    }
    if (url === "https://bb.sustech.edu.cn/webapps/blackboard/content/launchLink.jsp?course_id=_8537_1&tool_id=_142_1&tool_type=TOOL&mode=reset") {
      return textResponse(`
        <html>
          <body>
            <div class="pagingprefs" id="listContainer_itemcount">
              <span>Displaying <strong>1</strong> to <strong>1</strong> of <strong>1</strong> items</span>
            </div>
            <table id="listContainer_datatable">
              <tr id="listContainer_row:_28850_1">
                <th scope="row"><span class="dbheading"><a href="/webapps/discussionboard/do/forum?action=list_threads&amp;course_id=_8537_1&amp;nav=discussion_board_entry&amp;forum_id=_28850_1">Choose Topic</a></span></th>
              </tr>
            </table>
          </body>
        </html>
      `, "text/html", "https://bb.sustech.edu.cn/webapps/discussionboard/do/conference?action=list_forums&course_id=_8537_1&conf_id=_20961_1&nav=discussion_board_entry");
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
                <td><span class="mobile-table-label">日期: </span><span class="table-data-cell-value"><span>20-12-28 下午5:30</span></span></td>
                <td><span class="mobile-table-label">作者: </span><span class="table-data-cell-value">匿名</span></td>
                <td><span class="mobile-table-label">状态: </span><span class="table-data-cell-value">已发布</span></td>
                <td><span class="mobile-table-label">未读帖子: </span><span class="table-data-cell-value"><span class="unread-count none">0</span></span></td>
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

  const report = await getBlackboardDiscussionMessages(adapter, {
    courseId: "_8537_1",
    discussionId: "28850",
    page: 1,
    pageSize: 1,
  });

  assert.equal(report.discussion.id, "28850");
  assert.equal(report.discussion.source, "original-html");
  assert.equal(report.messages[0]?.id, "133567");
  assert.equal(report.messages[0]?.body, "请大家先思考课程目标。");
});

test("Blackboard discussion detail read fails closed when Blackboard rejects the REST discussion endpoint for an Original course", async () => {
  const adapter = routeAdapter((url) => {
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8537_1/discussions/_65_1") {
      return jsonResponse({ status: 400, message: "Original courses are not supported by this API" }, 400);
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  await assert.rejects(
    getBlackboardDiscussion(adapter, "_8537_1", "_65_1"),
    (error: unknown) => {
      assert.ok(error instanceof CliError);
      assert.equal(error.code, "BLACKBOARD_DISCUSSIONS_UNSUPPORTED");
      assert.equal(error.details?.courseId, "_8537_1");
      assert.equal(error.details?.discussionId, "_65_1");
      return true;
    },
  );
});

test("Blackboard discussion groups expose discoverable group ids for group-scoped threads", async () => {
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
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8343_1/discussions/_66_1") {
      return jsonResponse({
        id: "_66_1",
        title: "Group project Q&A",
        available: true,
        gradable: false,
        groupDiscussion: true,
        createdDate: "2026-08-18T10:00:00.000Z",
        modifiedDate: "2026-08-24T10:00:00.000Z",
      });
    }
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8343_1/discussions/_66_1/groups?offset=25&limit=25&sort=groupId%28desc%29") {
      return jsonResponse({
        results: [
          { groupId: "_88_1", discussionId: "_66_1", threadId: "_701_1" },
          { groupId: "_77_1", discussionId: "_66_1", threadId: "_702_1" },
        ],
        paging: {
          nextPage: "/learn/api/public/v1/courses/_8343_1/discussions/_66_1/groups?offset=50&limit=25",
        },
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  const report = await listBlackboardDiscussionGroups(adapter, {
    courseId: "8343",
    discussionId: "66",
    page: 2,
    pageSize: 25,
    sort: "groupId(desc)",
  });

  assert.equal(report.courseId, "_8343_1");
  assert.equal(report.courseCode, "CHEM201");
  assert.equal(report.discussion.id, "66");
  assert.equal(report.discussion.title, "Group project Q&A");
  assert.equal(report.discussion.groupDiscussion, true);
  assert.equal(report.returned, 2);
  assert.equal(report.hasMore, true);
  assert.equal(report.nextPage, 3);
  assert.equal(report.groups[0]?.groupId, "88");
  assert.equal(report.groups[0]?.threadId, "701");
  assert.equal(report.groups[1]?.discussionId, "66");
  assert.match(formatBlackboardDiscussionGroups(report), /Group project Q&A/u);
  assert.match(formatBlackboardDiscussionGroups(report), /Next page: 3/u);
});

test("Blackboard Original discussion forum fallback respects position(desc) sorting", async () => {
  const adapter = routeAdapter((url) => {
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8537_1") {
      return jsonResponse({
        id: "_8537_1",
        name: "专业实习（2026夏）",
        courseCode: "BMEB470",
        externalId: "BMEB470-2026",
        availability: { available: "Yes" },
      });
    }
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8537_1/discussions?offset=0&limit=25&sort=position%28desc%29") {
      return jsonResponse({
        status: 400,
        message: ": 1 errors\nField error in object 'discussionSortCriteriaPubV1' on field 'sort': rejected value [position(desc)]",
      }, 400);
    }
    if (url === "https://bb.sustech.edu.cn/webapps/blackboard/content/launchLink.jsp?course_id=_8537_1&tool_id=_142_1&tool_type=TOOL&mode=reset") {
      return textResponse(`
        <html>
          <body>
            <input type="hidden" name="conf_id" value="_20961_1" />
            <div class="pagingprefs" id="listContainer_itemcount">
              <span>Displaying <strong>1</strong> to <strong>2</strong> of <strong>2</strong> items</span>
            </div>
            <table id="listContainer_datatable">
              <tr id="listContainer_row:_28850_1"><th scope="row"><span class="dbheading"><a>Choose Topic</a></span></th></tr>
              <tr id="listContainer_row:_28851_1"><th scope="row"><span class="dbheading"><a>Progress Q&amp;A</a></span></th></tr>
            </table>
          </body>
        </html>
      `, "text/html");
    }
    if (url === "https://bb.sustech.edu.cn/webapps/discussionboard/do/conference?action=list_forums&course_id=_8537_1&conf_id=_20961_1&nav=discussion_board_entry&toggle_mode=read&mode=view&showAll=true&startIndex=0&sortCol=position&sortDir=ASCENDING") {
      return textResponse(`
        <html>
          <body>
            <input type="hidden" name="conf_id" value="_20961_1" />
            <div class="pagingprefs" id="listContainer_itemcount">
              <span>Displaying <strong>1</strong> to <strong>2</strong> of <strong>2</strong> items</span>
            </div>
            <table id="listContainer_datatable">
              <tr id="listContainer_row:_28850_1"><th scope="row"><span class="dbheading"><a>Choose Topic</a></span></th></tr>
              <tr id="listContainer_row:_28851_1"><th scope="row"><span class="dbheading"><a>Progress Q&amp;A</a></span></th></tr>
            </table>
          </body>
        </html>
      `, "text/html");
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  const report = await listBlackboardDiscussions(adapter, {
    courseId: "_8537_1",
    sort: "position(desc)",
  });

  assert.deepEqual(report.discussions.map((discussion) => discussion.id), ["28851", "28850"]);
  assert.deepEqual(report.discussions.map((discussion) => discussion.title), ["Progress Q&A", "Choose Topic"]);
});

test("Blackboard discussion replies fall back to Original-course HTML thread detail replies", async () => {
  const seen: string[] = [];
  const adapter = routeAdapter((url) => {
    seen.push(url);
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8537_1") {
      return jsonResponse({
        id: "_8537_1",
        name: "专业实习（2026夏）",
        courseCode: "BMEB470",
        externalId: "BMEB470-2026",
        availability: { available: "Yes" },
      });
    }
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8537_1/discussions/_28850_1/messages/_133567_1/replies?offset=0&limit=5&status=Published&isRead=false&sort=postDate%28desc%29") {
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
              </tr>
            </table>
          </body>
        </html>
      `, "text/html");
    }
    if (url === "https://bb.sustech.edu.cn/webapps/discussionboard/do/message?action=list_messages&course_id=_8537_1&nav=discussion_board_entry&conf_id=_20961_1&forum_id=_28850_1&message_id=_133567_1&thread_id=_133567_1") {
      return textResponse(`
        <html>
          <body>
            <div class="pagingprefs" id="listContainer_itemcount">
              <span>Displaying <strong>1</strong> to <strong>3</strong> of <strong>3</strong> items</span>
            </div>
            <table id="listContainer_datatable">
              <tr id="listContainer_row:0">
                <th scope="row"><a href="/webapps/discussionboard/do/message?action=list_messages&amp;course_id=_8537_1&amp;nav=discussion_board_entry&amp;conf_id=_20961_1&amp;forum_id=_28850_1&amp;message_id=_133567_1&amp;thread_id=_133567_1">第一周课前思考</a></th>
                <td><span class="mobile-table-label">日期: </span><span class="table-data-cell-value"><span>20-12-28 下午5:30</span></span></td>
                <td><span class="mobile-table-label">作者: </span><span class="table-data-cell-value">匿名</span></td>
                <td><span class="mobile-table-label">状态: </span><span class="table-data-cell-value">已发布</span></td>
                <td><span class="mobile-table-label">未读帖子: </span><span class="table-data-cell-value"><span class="unread-count none">0</span></span></td>
                <td><span class="mobile-table-label">未读对我的回复: </span><span class="table-data-cell-value"><span class="unread-count none">0</span></span></td>
                <td><span class="mobile-table-label">帖子总数: </span><span class="table-data-cell-value"><span class="total-count">3</span></span></td>
              </tr>
              <tr id="listContainer_row:1">
                <th scope="row"><a href="/webapps/discussionboard/do/message?action=list_messages&amp;course_id=_8537_1&amp;nav=discussion_board_entry&amp;conf_id=_20961_1&amp;forum_id=_28850_1&amp;message_id=_133568_1&amp;thread_id=_133567_1&amp;parent_id=_133567_1">RE: 第一周课前思考</a></th>
                <td><span class="mobile-table-label">日期: </span><span class="table-data-cell-value"><span class="unreadmessage">20-12-29 上午9:15</span></span></td>
                <td><span class="mobile-table-label">作者: </span><span class="table-data-cell-value">李四</span></td>
                <td><span class="mobile-table-label">状态: </span><span class="table-data-cell-value">已发布</span></td>
                <td><span class="mobile-table-label">未读帖子: </span><span class="table-data-cell-value"><span class="unread-count">1</span></span></td>
                <td><span class="mobile-table-label">未读对我的回复: </span><span class="table-data-cell-value"><span class="unread-count none">0</span></span></td>
                <td><span class="mobile-table-label">帖子总数: </span><span class="table-data-cell-value"><span class="total-count">1</span></span></td>
              </tr>
              <tr id="listContainer_row:2">
                <th scope="row"><a href="/webapps/discussionboard/do/message?action=list_messages&amp;course_id=_8537_1&amp;nav=discussion_board_entry&amp;conf_id=_20961_1&amp;forum_id=_28850_1&amp;message_id=_133569_1&amp;thread_id=_133567_1&amp;parent_id=_133567_1">RE: 第一周课前思考（补充）</a></th>
                <td><span class="mobile-table-label">日期: </span><span class="table-data-cell-value"><span>20-12-29 上午10:00</span></span></td>
                <td><span class="mobile-table-label">作者: </span><span class="table-data-cell-value">王五</span></td>
                <td><span class="mobile-table-label">状态: </span><span class="table-data-cell-value">草稿</span></td>
                <td><span class="mobile-table-label">未读帖子: </span><span class="table-data-cell-value"><span class="unread-count none">0</span></span></td>
                <td><span class="mobile-table-label">未读对我的回复: </span><span class="table-data-cell-value"><span class="unread-count none">0</span></span></td>
                <td><span class="mobile-table-label">帖子总数: </span><span class="table-data-cell-value"><span class="total-count">1</span></span></td>
              </tr>
            </table>
          </body>
        </html>
      `, "text/html");
    }
    if (url === "https://bb.sustech.edu.cn/webapps/discussionboard/do/message?action=message_frame&course_id=_8537_1&nav=discussion_board_entry&conf_id=_20961_1&forum_id=_28850_1&message_id=_133568_1&thread_id=_133567_1") {
      return textResponse(`<div class="dbThreadBody"><div class="vtbegenerated"><p>我认为课程目标应该先聚焦工程实践。</p></div></div><div class="dbThreadFooter"></div>`, "text/html");
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  const report = await listBlackboardDiscussionReplies(adapter, {
    courseId: "_8537_1",
    discussionId: "_28850_1",
    messageId: "133567",
    status: "Published",
    isRead: false,
    page: 1,
    pageSize: 5,
    sort: "postDate(desc)",
  });

  assert.equal(report.courseCode, "BMEB470");
  assert.equal(report.discussionId, "28850");
  assert.equal(report.messageId, "133567");
  assert.equal(report.returned, 1);
  assert.equal(report.hasMore, false);
  assert.equal(report.replies[0]?.id, "133568");
  assert.equal(report.replies[0]?.parentId, "133567");
  assert.equal(report.replies[0]?.threadId, "133567");
  assert.equal(report.replies[0]?.author, "李四");
  assert.equal(report.replies[0]?.status, "Published");
  assert.equal(report.replies[0]?.isRead, false);
  assert.equal(report.replies[0]?.body, "我认为课程目标应该先聚焦工程实践。");
  assert.equal(report.replies[0]?.source, "original-html");
  assert.equal(report.replies[0]?.metadataPartial, true);
  assert.equal(report.replies[0]?.unreadPosts, 1);
  assert.equal(report.replies[0]?.totalPosts, 1);
  assert.match(formatBlackboardDiscussionReplies(report), /Original HTML fallback/u);
  assert.match(formatBlackboardDiscussionReplies(report), /original-html/u);
  assert.match(formatBlackboardDiscussionReplies(report), /metadata partial/u);
  assert.deepEqual(
    seen.filter((url) => url.includes("message_frame")),
    ["https://bb.sustech.edu.cn/webapps/discussionboard/do/message?action=message_frame&course_id=_8537_1&nav=discussion_board_entry&conf_id=_20961_1&forum_id=_28850_1&message_id=_133568_1&thread_id=_133567_1"],
  );
});

test("Blackboard discussion replies normalize reply filters and paging", async () => {
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
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8343_1/discussions/_65_1/messages/_71_1/replies?offset=2&limit=2&groupId=_88_1&userId=_2_1&status=Draft&isRead=true&sort=modifiedDate") {
      return jsonResponse({
        results: [{
          id: "_80_1",
          discussionId: "_65_1",
          parentId: "_71_1",
          threadId: "_71_1",
          userId: "_2_1",
          groupId: "_88_1",
          givenName: "TA",
          familyName: "Two",
          status: "Draft",
          body: "<p>Need&nbsp;one more citation.</p>",
          postDate: "2026-08-26T10:10:00.000Z",
          editDate: "2026-08-26T10:12:00.000Z",
          createdDate: "2026-08-26T10:10:00.000Z",
          modifiedDate: "2026-08-26T10:12:00.000Z",
          isRead: true,
        }],
        paging: {
          nextPage: "/learn/api/public/v1/courses/_8343_1/discussions/_65_1/messages/_71_1/replies?offset=4&limit=2",
        },
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  const report = await listBlackboardDiscussionReplies(adapter, {
    courseId: "_8343_1",
    discussionId: "_65_1",
    messageId: "71",
    groupId: "88",
    userId: "_2_1",
    status: "Draft",
    isRead: true,
    page: 2,
    pageSize: 2,
    sort: "modifiedDate",
  });

  assert.equal(report.courseCode, "CHEM201");
  assert.equal(report.discussionId, "65");
  assert.equal(report.messageId, "71");
  assert.equal(report.groupId, "_88_1");
  assert.equal(report.userId, "_2_1");
  assert.equal(report.status, "Draft");
  assert.equal(report.isRead, true);
  assert.equal(report.returned, 1);
  assert.equal(report.hasMore, true);
  assert.equal(report.nextPage, 3);
  assert.equal(report.replies[0]?.id, "80");
  assert.equal(report.replies[0]?.author, "TA Two");
  assert.equal(report.replies[0]?.parentId, "71");
  assert.equal(report.replies[0]?.body, "Need one more citation.");
  assert.match(formatBlackboardDiscussionReplies(report), /Next page: 3/u);
});

test("Blackboard discussion replies preserve fallback filter errors after REST sort rejection", async () => {
  const adapter = routeAdapter((url) => {
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8537_1") {
      return jsonResponse({
        id: "_8537_1",
        name: "专业实习（2026夏）",
        courseCode: "BMEB470",
        externalId: "BMEB470-2026",
        availability: { available: "Yes" },
      });
    }
    if (url === "https://bb.sustech.edu.cn/learn/api/public/v1/courses/_8537_1/discussions/_28850_1/messages/_133567_1/replies?offset=0&limit=5&groupId=_88_1&status=Published&sort=position%28desc%29") {
      return jsonResponse({
        status: 400,
        message: ": 1 errors\nField error in object 'discussionSortCriteriaPubV1' on field 'sort': rejected value [position(desc)]",
      }, 400);
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  await assert.rejects(
    () => listBlackboardDiscussionReplies(adapter, {
      courseId: "_8537_1",
      discussionId: "_28850_1",
      messageId: "133567",
      groupId: "88",
      status: "Published",
      page: 1,
      pageSize: 5,
      sort: "position(desc)",
    }),
    (error: unknown) => {
      assert.ok(error instanceof CliError);
      assert.equal(error.code, "BLACKBOARD_DISCUSSIONS_FILTER_UNSUPPORTED");
      assert.equal(error.details?.filter, "groupId");
      return true;
    },
  );
});

function routeAdapter(route: (url: string, init?: RequestInit) => Response | Promise<Response>): ServiceAdapter {
  return {
    name: "route-adapter",
    fetch: async (input, init) => route(String(input), init),
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function textResponse(value: string, contentType = "text/plain", url?: string): Response {
  const response = new Response(value, {
    headers: { "content-type": `${contentType}; charset=utf-8` },
  });
  if (url) Object.defineProperty(response, "url", { value: url });
  return response;
}
