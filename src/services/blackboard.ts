import {
  arrayValue,
  booleanValue,
  cleanText,
  fetchJson,
  numberValue,
  recordValue,
  requestUrl,
  ServiceError,
  stringValue,
} from "./base.js";
import type { ServiceAdapter, ServiceStatus } from "./base.js";

export const BLACKBOARD_BASE = "https://bb.sustech.edu.cn";

export const BLACKBOARD_STATUS: ServiceStatus = {
  service: "blackboard",
  availability: "adapter_required",
  auth: "cookie-session",
  campusNetwork: false,
  browser: false,
  summary: "Blackboard read APIs are available with an authenticated CAS cookie session.",
  notes: [
    "The adapter must provide Blackboard cookies for bb.sustech.edu.cn.",
    "The CLI CAS bridge completed an opt-in live courses read on 2026-08-26.",
    "Assignment submission and downloads are intentionally excluded here.",
  ],
  endpoints: [
    "/learn/api/public/v1/users/me",
    "/learn/api/public/v1/users/{uid}/courses",
    "/learn/api/public/v1/courses/{courseId}",
    "/learn/api/public/v1/courses/{courseId}/contents",
    "/learn/api/public/v1/courses/{courseId}/gradebook/columns",
  ],
};

export interface BlackboardUser {
  id: string;
  userName: string;
  displayName: string;
}

export interface BlackboardCourse {
  id: string;
  numericId: string;
  name: string;
  courseCode: string;
  externalId: string;
  roleId: string;
  availability: string;
}

export interface BlackboardContentItem {
  id: string;
  parentId: string;
  title: string;
  handler: string;
  kind: "file" | "folder" | "assignment" | "document" | "unknown";
  hasChildren: boolean;
}

export interface BlackboardAssignment {
  id: string;
  contentId: string;
  title: string;
  scorePossible?: number;
}

export async function getBlackboardUser(adapter: ServiceAdapter): Promise<BlackboardUser> {
  const raw = await fetchJson<unknown>(adapter, buildBlackboardUrl("/learn/api/public/v1/users/me"));
  return normaliseBlackboardUser(raw);
}

export async function listBlackboardCourses(
  adapter: ServiceAdapter,
  options: { query?: string } = {},
): Promise<BlackboardCourse[]> {
  const user = await getBlackboardUser(adapter);
  const page = await fetchBlackboardPage(adapter, `/learn/api/public/v1/users/${encodeURIComponent(user.id)}/courses`);
  const courses = await Promise.all(
    page.results
      .map((item) => recordValue(item))
      .map(async (enrollment) => {
        const courseId = stringValue(enrollment.courseId);
        const detail = courseId
          ? await fetchJson<unknown>(adapter, buildBlackboardUrl(`/learn/api/public/v1/courses/${canonicalCourseId(courseId)}`))
          : undefined;
        return normaliseBlackboardCourse(enrollment, detail);
      }),
  );
  const query = options.query?.trim().toLowerCase();
  if (!query) return courses;
  return courses.filter((course) =>
    course.id.toLowerCase().includes(query)
    || course.numericId.toLowerCase().includes(query)
    || course.name.toLowerCase().includes(query)
    || course.courseCode.toLowerCase().includes(query),
  );
}

export async function listBlackboardContent(
  adapter: ServiceAdapter,
  courseId: string,
  parentId?: string,
): Promise<BlackboardContentItem[]> {
  const path = parentId
    ? `/learn/api/public/v1/courses/${canonicalCourseId(courseId)}/contents/${canonicalCourseId(parentId)}/children`
    : `/learn/api/public/v1/courses/${canonicalCourseId(courseId)}/contents`;
  const page = await fetchBlackboardPage(adapter, path);
  return page.results.map((item) => normaliseBlackboardContentItem(item));
}

export async function listBlackboardAssignments(
  adapter: ServiceAdapter,
  courseId: string,
): Promise<BlackboardAssignment[]> {
  const url = buildBlackboardUrl(`/learn/api/public/v1/courses/${canonicalCourseId(courseId)}/gradebook/columns`, {
    _fields: "id,name,contentId,score.possible",
  });
  const page = await fetchBlackboardPage(adapter, url, { absolute: true });
  return page.results
    .map((item) => normaliseBlackboardAssignment(item))
    .filter((assignment) => assignment.contentId);
}

export function normaliseBlackboardUser(raw: unknown): BlackboardUser {
  const record = recordValue(raw);
  return {
    id: stringValue(record.id),
    userName: stringValue(record.userName ?? record.userNameOrId),
    displayName: cleanText(record.name ?? record.displayName ?? record.userName),
  };
}

export function normaliseBlackboardCourse(enrollment: unknown, detail?: unknown): BlackboardCourse {
  const enrollmentRecord = recordValue(enrollment);
  const detailRecord = recordValue(detail);
  const id = stringValue(detailRecord.id ?? enrollmentRecord.courseId ?? enrollmentRecord.id);
  const availabilityRecord = recordValue(detailRecord.availability);
  return {
    id,
    numericId: numericIdFromBlackboardId(id),
    name: cleanText(detailRecord.name ?? enrollmentRecord.courseName ?? enrollmentRecord.name),
    courseCode: stringValue(detailRecord.courseCode ?? detailRecord.externalId),
    externalId: stringValue(detailRecord.externalId),
    roleId: stringValue(enrollmentRecord.courseRoleId ?? enrollmentRecord.roleId),
    availability: stringValue(availabilityRecord.available ?? availabilityRecord.type ?? detailRecord.availability),
  };
}

export function normaliseBlackboardContentItem(raw: unknown): BlackboardContentItem {
  const record = recordValue(raw);
  const handler = stringValue(record.contentHandler && recordValue(record.contentHandler).id);
  return {
    id: canonicalIdBody(record.id),
    parentId: canonicalIdBody(record.parentId),
    title: cleanText(record.title),
    handler,
    kind: classifyBlackboardHandler(handler),
    hasChildren: booleanValue(record.hasChildren),
  };
}

export function normaliseBlackboardAssignment(raw: unknown): BlackboardAssignment {
  const record = recordValue(raw);
  const score = recordValue(record.score);
  return {
    id: canonicalIdBody(record.id),
    contentId: canonicalIdBody(record.contentId),
    title: cleanText(record.name),
    ...(score.possible !== undefined ? { scorePossible: numberValue(score.possible) } : {}),
  };
}

export function classifyBlackboardHandler(handler: string): BlackboardContentItem["kind"] {
  switch (handler) {
    case "resource/x-bb-file":
      return "file";
    case "resource/x-bb-folder":
      return "folder";
    case "resource/x-bb-assignment":
      return "assignment";
    case "resource/x-bb-document":
      return "document";
    default:
      return "unknown";
  }
}

export function buildBlackboardUrl(path: string, query: Record<string, string> = {}): string {
  return requestUrl(BLACKBOARD_BASE, path, query);
}

async function fetchBlackboardPage(
  adapter: ServiceAdapter,
  pathOrUrl: string,
  options: { absolute?: boolean } = {},
): Promise<{ results: unknown[] }> {
  let url = options.absolute ? pathOrUrl : buildBlackboardUrl(pathOrUrl);
  const results: unknown[] = [];
  const visited = new Set<string>();
  for (let page = 1; page <= 100; page += 1) {
    const parsedUrl = new URL(url, BLACKBOARD_BASE);
    if (parsedUrl.origin !== BLACKBOARD_BASE) {
      throw new ServiceError("Blackboard pagination attempted to leave its configured origin.", { url: parsedUrl.toString() });
    }
    url = parsedUrl.toString();
    if (visited.has(url)) {
      throw new ServiceError("Blackboard pagination returned a repeated next-page URL.", { url });
    }
    visited.add(url);

    const raw = await fetchJson<unknown>(adapter, url);
    const record = recordValue(raw);
    results.push(...arrayValue(record.results));
    const nextPage = stringValue(recordValue(record.paging).nextPage);
    if (!nextPage) return { results };
    url = new URL(nextPage, url).toString();
  }
  throw new ServiceError("Blackboard pagination exceeded the safe page limit.", { url });
}

function canonicalCourseId(value: string): string {
  if (value.startsWith("_") && value.endsWith("_1")) return value;
  const numeric = numericIdFromBlackboardId(value);
  return numeric ? `_${numeric}_1` : value;
}

function canonicalIdBody(value: unknown): string {
  const text = stringValue(value);
  if (!text) return "";
  if (text.startsWith("_") && text.endsWith("_1")) return text.slice(1, -2);
  return text;
}

function numericIdFromBlackboardId(value: string): string {
  const match = /_(\d+)_/.exec(value);
  return match?.[1] ?? value.replace(/^_/, "").replace(/_1$/, "");
}
