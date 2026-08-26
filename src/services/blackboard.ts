import { createHash, randomUUID } from "node:crypto";
import { constants as fileSystemConstants } from "node:fs";
import { copyFile, link, lstat, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve as resolvePath, sep } from "node:path";
import { CliError } from "../core/errors.js";
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
  summary: "Blackboard REST reads, safe content-attachment downloads, and Classic assignment submission are available with an authenticated CAS cookie session.",
  notes: [
    "The adapter must provide Blackboard cookies for bb.sustech.edu.cn.",
    "The CLI CAS bridge completed an opt-in live courses read on 2026-08-26.",
    "Teacher-provided files use the Learn content-attachment endpoint or same-origin BBML links.",
    "Student submission files use the official Learn REST attempt/files flow and currently target Classic/Original assignments.",
    "No Blackboard write path has been live-submitted from this repository yet.",
  ],
  endpoints: [
    "/learn/api/public/v1/users/me",
    "/learn/api/public/v1/users/{uid}/courses",
    "/learn/api/public/v1/courses/{courseId}",
    "/learn/api/public/v1/courses/{courseId}/contents",
    "/learn/api/public/v1/courses/{courseId}/contents/{contentId}/attachments",
    "/learn/api/public/v1/courses/{courseId}/contents/{contentId}/attachments/{attachmentId}/download",
    "/learn/api/public/v2/courses/{courseId}/gradebook/columns",
    "/learn/api/public/v2/courses/{courseId}/gradebook/columns/{columnId}/attempts",
    "/learn/api/public/v1/courses/{courseId}/gradebook/attempts/{attemptId}/files",
    "/learn/api/public/v1/uploads",
    "/learn/api/public/v1/uploads/settings",
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

export type BlackboardContentAttachmentSource = "learn-rest" | "bbml" | "content-file";

export interface BlackboardContentAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  source: BlackboardContentAttachmentSource;
}

export interface BlackboardContentAttachmentDownload {
  attachment: BlackboardContentAttachment;
  destination: string;
  size: number;
  sha256: string;
  contentType: string;
  overwritten: boolean;
}

interface BlackboardContentAttachmentTarget extends BlackboardContentAttachment {
  downloadUrl: string;
}

export interface BlackboardAssignment {
  id: string;
  contentId: string;
  title: string;
  scorePossible?: number;
  availability: string;
  grading: {
    type: string;
    due?: string;
    attemptsAllowed?: number;
    scoringModel: string;
  };
  scoreProviderHandle: string;
}

export type BlackboardAttemptStatus =
  | "NotAttempted"
  | "Abandoned"
  | "InProgress"
  | "Suspended"
  | "Canceled"
  | "NeedsGrading"
  | "Completed"
  | "InProgressAgain"
  | "NeedsGradingAgain";

export interface BlackboardAttemptReceipt {
  receiptId: string;
  submissionDate: string;
  submissionTotalSize?: number;
  courseId: string;
  gradableItemId: string;
  attemptId: string;
  userId: string;
  responseStatus: string;
  submissionType: string;
}

export interface BlackboardAttempt {
  id: string;
  userId: string;
  status: BlackboardAttemptStatus | "";
  readyToPost: boolean;
  score?: number;
  displayGradeText?: string;
  displayGradeScore?: number;
  studentComments: string;
  studentSubmission: string;
  created: string;
  modified: string;
  attemptDate: string;
  attemptReceipt?: BlackboardAttemptReceipt;
}

export interface BlackboardAttemptFile {
  id: string;
  name: string;
  viewUrl: string;
  downloadUrl: string;
}

export interface BlackboardUploadSettings {
  maxUploadSizeInBytes?: number;
  supportsInlineRender: boolean;
}

export interface BlackboardSubmissionFile {
  path: string;
  absolutePath: string;
  name: string;
  size: number;
  sha256: string;
}

export interface BlackboardUploadedFileReference {
  id: string;
}

export interface BlackboardSubmissionPreflightIssue {
  code: string;
  message: string;
}

export interface BlackboardSubmissionPreflight {
  checkedAt: string;
  ready: boolean;
  late: boolean;
  attemptsUsed: number;
  attemptsAllowed?: number;
  inProgressAttemptIds: string[];
  blockers: BlackboardSubmissionPreflightIssue[];
  warnings: BlackboardSubmissionPreflightIssue[];
}

export interface BlackboardSubmissionPayload {
  file: BlackboardSubmissionFile;
  bytes: Uint8Array;
}

export type BlackboardFailureStage =
  | "courses"
  | "assignments"
  | "content"
  | "content-item"
  | "attachments"
  | "download"
  | "destination";

export interface BlackboardOperationFailure {
  stage: BlackboardFailureStage;
  message: string;
  code?: string;
  status?: number;
  courseId?: string;
  courseCode?: string;
  courseName?: string;
  parentId?: string;
  contentId?: string;
  attachmentId?: string;
  path?: string;
}

export interface BlackboardDeadline {
  courseId: string;
  courseCode: string;
  courseName: string;
  columnId: string;
  contentId: string;
  title: string;
  dueAt: string;
  daysLeft: number;
  availability: string;
  scorePossible?: number;
  attemptsAllowed?: number;
}

export interface BlackboardDeadlineReport {
  generatedAt: string;
  courseQuery?: string;
  days?: number;
  coursesMatched: number;
  coursesScanned: number;
  deadlines: BlackboardDeadline[];
  failures: BlackboardOperationFailure[];
}

export type BlackboardSearchAttachmentMode = "include" | "only" | "none";

export interface BlackboardSearchMatch {
  courseId: string;
  courseCode: string;
  courseName: string;
  contentId: string;
  parentId: string;
  title: string;
  kind: BlackboardContentItem["kind"];
  handler: string;
  hasChildren: boolean;
  path: string;
  matchReasons: readonly ("title" | "attachment")[];
  attachmentMatches: readonly BlackboardContentAttachment[];
}

export interface BlackboardSearchReport {
  generatedAt: string;
  query: string;
  courseQuery?: string;
  kind?: BlackboardContentItem["kind"];
  attachments: BlackboardSearchAttachmentMode;
  page: number;
  pageSize: number;
  coursesMatched: number;
  coursesScanned: number;
  contentsScanned: number;
  attachmentsScanned: number;
  totalMatches: number;
  returned: number;
  hasMore: boolean;
  nextPage?: number;
  results: BlackboardSearchMatch[];
  failures: BlackboardOperationFailure[];
}

export interface BlackboardSyncFile {
  courseId: string;
  courseCode: string;
  courseName: string;
  contentId: string;
  attachmentId: string;
  contentPath: string;
  relativePath: string;
  destination: string;
  source: BlackboardContentAttachmentSource;
  size: number;
  sha256: string;
  contentType: string;
  overwritten: boolean;
}

export interface BlackboardSyncReport {
  generatedAt: string;
  courseId: string;
  courseCode: string;
  courseName: string;
  destination: string;
  rootContentId?: string;
  plannedFiles: number;
  downloadedFiles: number;
  partial: boolean;
  files: BlackboardSyncFile[];
  failures: BlackboardOperationFailure[];
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

export async function getBlackboardContentItem(
  adapter: ServiceAdapter,
  courseId: string,
  contentId: string,
): Promise<BlackboardContentItem> {
  const raw = await getBlackboardContentRecord(adapter, courseId, contentId);
  return normaliseBlackboardContentItem(raw);
}

export async function listBlackboardContentAttachments(
  adapter: ServiceAdapter,
  courseId: string,
  contentId: string,
): Promise<BlackboardContentAttachment[]> {
  const targets = await resolveBlackboardContentAttachmentTargets(adapter, courseId, contentId);
  return targets.map(publicBlackboardContentAttachment);
}

export async function downloadBlackboardContentAttachment(
  adapter: ServiceAdapter,
  courseId: string,
  contentId: string,
  attachmentId: string,
  destination: string,
  options: { overwrite?: boolean } = {},
): Promise<BlackboardContentAttachmentDownload> {
  const output = await inspectBlackboardDownloadDestination(destination, options.overwrite === true);
  const targets = await resolveBlackboardContentAttachmentTargets(adapter, courseId, contentId);
  const requestedId = attachmentId.startsWith("embedded-") || attachmentId.startsWith("content-file-")
    ? attachmentId
    : canonicalIdBody(attachmentId);
  const target = targets.find((entry) => entry.id === requestedId);
  if (!target) {
    throw new CliError(
      "The requested Blackboard content attachment was not found.",
      "BLACKBOARD_ATTACHMENT_NOT_FOUND",
      2,
      {
        courseId: canonicalCourseId(courseId),
        contentId: canonicalCourseId(contentId),
        attachmentId: requestedId,
        availableAttachments: targets.map((entry) => ({ id: entry.id, fileName: entry.fileName })),
      },
    );
  }

  const response = await fetchBlackboardAttachmentResponse(adapter, target.downloadUrl);
  const tempPath = join(dirname(output.destination), `.${basename(output.destination)}.sustech-${randomUUID()}.tmp`);
  try {
    const streamed = await streamBlackboardAttachment(response, tempPath, target.mimeType);
    await finishBlackboardDownload(tempPath, output.destination, options.overwrite === true);
    return {
      attachment: publicBlackboardContentAttachment(target),
      destination: output.destination,
      size: streamed.size,
      sha256: streamed.sha256,
      contentType: streamed.contentType,
      overwritten: output.existed,
    };
  } finally {
    await rm(tempPath, { force: true }).catch(() => undefined);
  }
}

export async function listBlackboardAssignments(
  adapter: ServiceAdapter,
  courseId: string,
): Promise<BlackboardAssignment[]> {
  const url = buildBlackboardUrl(`/learn/api/public/v2/courses/${canonicalCourseId(courseId)}/gradebook/columns`);
  const page = await fetchBlackboardPage(adapter, url, { absolute: true });
  return page.results
    .map((item) => normaliseBlackboardAssignment(item))
    .filter((assignment) => assignment.contentId);
}

export async function getBlackboardAssignment(
  adapter: ServiceAdapter,
  courseId: string,
  columnId: string,
): Promise<BlackboardAssignment> {
  const raw = await fetchJson<unknown>(
    adapter,
    buildBlackboardUrl(`/learn/api/public/v2/courses/${canonicalCourseId(courseId)}/gradebook/columns/${canonicalCourseId(columnId)}`),
  );
  return normaliseBlackboardAssignment(raw);
}

export async function listBlackboardAttempts(
  adapter: ServiceAdapter,
  courseId: string,
  columnId: string,
  options: { status?: BlackboardAttemptStatus } = {},
): Promise<BlackboardAttempt[]> {
  const user = await getBlackboardUser(adapter);
  const url = buildBlackboardUrl(`/learn/api/public/v2/courses/${canonicalCourseId(courseId)}/gradebook/columns/${canonicalCourseId(columnId)}/attempts`, {
    userId: user.id,
    ...(options.status ? { attemptStatuses: options.status } : {}),
  });
  const page = await fetchBlackboardPage(adapter, url, { absolute: true });
  return page.results.map((item) => normaliseBlackboardAttempt(item));
}

export async function getBlackboardAttempt(
  adapter: ServiceAdapter,
  courseId: string,
  columnId: string,
  attemptId: string,
): Promise<BlackboardAttempt> {
  const raw = await fetchJson<unknown>(
    adapter,
    buildBlackboardUrl(`/learn/api/public/v2/courses/${canonicalCourseId(courseId)}/gradebook/columns/${canonicalCourseId(columnId)}/attempts/${canonicalCourseId(attemptId)}`),
  );
  return normaliseBlackboardAttempt(raw);
}

export async function createBlackboardAttempt(
  adapter: ServiceAdapter,
  courseId: string,
  columnId: string,
  input: { studentComments?: string } = {},
): Promise<BlackboardAttempt> {
  const raw = await fetchJson<unknown>(
    adapter,
    buildBlackboardUrl(`/learn/api/public/v2/courses/${canonicalCourseId(courseId)}/gradebook/columns/${canonicalCourseId(columnId)}/attempts`),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "InProgress", ...input }),
    },
  );
  return normaliseBlackboardAttempt(raw);
}

export async function updateBlackboardAttempt(
  adapter: ServiceAdapter,
  courseId: string,
  columnId: string,
  attemptId: string,
  input: { status: "NeedsGrading"; studentComments?: string },
): Promise<BlackboardAttempt> {
  const raw = await fetchJson<unknown>(
    adapter,
    buildBlackboardUrl(`/learn/api/public/v2/courses/${canonicalCourseId(courseId)}/gradebook/columns/${canonicalCourseId(columnId)}/attempts/${canonicalCourseId(attemptId)}`),
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  return normaliseBlackboardAttempt(raw);
}

export async function listBlackboardAttemptFiles(
  adapter: ServiceAdapter,
  courseId: string,
  attemptId: string,
): Promise<BlackboardAttemptFile[]> {
  const page = await fetchBlackboardPage(
    adapter,
    `/learn/api/public/v1/courses/${canonicalCourseId(courseId)}/gradebook/attempts/${canonicalCourseId(attemptId)}/files`,
  );
  return page.results.map((item) => normaliseBlackboardAttemptFile(item));
}

export async function attachBlackboardAttemptFile(
  adapter: ServiceAdapter,
  courseId: string,
  attemptId: string,
  input: { name: string; uploadId: string },
): Promise<BlackboardAttemptFile> {
  const raw = await fetchJson<unknown>(
    adapter,
    buildBlackboardUrl(`/learn/api/public/v1/courses/${canonicalCourseId(courseId)}/gradebook/attempts/${canonicalCourseId(attemptId)}/files`),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  return normaliseBlackboardAttemptFile(raw);
}

export async function uploadBlackboardTemporaryFile(
  adapter: ServiceAdapter,
  file: BlackboardSubmissionFile,
  bytes?: Uint8Array,
): Promise<BlackboardUploadedFileReference> {
  const buffer = bytes ?? await rereadBlackboardSubmissionBytes(file);
  if (bytes) assertBlackboardSubmissionBytes(file, buffer);
  const form = new FormData();
  form.set("file", new Blob([buffer]), file.name);
  const raw = await fetchJson<unknown>(adapter, buildBlackboardUrl("/learn/api/public/v1/uploads"), {
    method: "POST",
    body: form,
  });
  const record = recordValue(raw);
  const id = stringValue(record.id);
  if (!id) throw new ServiceError("Blackboard upload response did not include an upload ID.");
  return { id };
}

export async function getBlackboardUploadSettings(adapter: ServiceAdapter): Promise<BlackboardUploadSettings> {
  const raw = await fetchJson<unknown>(adapter, buildBlackboardUrl("/learn/api/public/v1/uploads/settings"));
  return normaliseBlackboardUploadSettings(raw);
}

export async function inspectBlackboardSubmissionFile(path: string): Promise<BlackboardSubmissionFile> {
  return (await readBlackboardSubmissionPayload(path)).file;
}

export async function readBlackboardSubmissionPayload(path: string): Promise<BlackboardSubmissionPayload> {
  const absolutePath = resolvePath(path);
  let info;
  let buffer: Buffer;
  try {
    info = await stat(absolutePath);
    buffer = await readFile(absolutePath);
  } catch (error) {
    throw new CliError(
      "The Blackboard submission file could not be read.",
      "BLACKBOARD_FILE_NOT_READABLE",
      2,
      {
        file: absolutePath,
        cause: error instanceof Error ? error.message : String(error),
      },
    );
  }
  if (!info.isFile()) {
    throw new CliError(
      "The Blackboard submission target must be a regular file.",
      "BLACKBOARD_FILE_NOT_REGULAR",
      2,
      { file: absolutePath },
    );
  }
  if (buffer.byteLength === 0) {
    throw new CliError(
      "The Blackboard submission file is empty.",
      "BLACKBOARD_FILE_EMPTY",
      2,
      { file: absolutePath },
    );
  }
  return {
    file: {
      path,
      absolutePath,
      name: basename(absolutePath),
      size: buffer.byteLength,
      sha256: createHash("sha256").update(buffer).digest("hex"),
    },
    bytes: buffer,
  };
}

export async function listBlackboardDeadlines(
  adapter: ServiceAdapter,
  options: { now?: Date; days?: number; courseQuery?: string } = {},
): Promise<BlackboardDeadlineReport> {
  const now = options.now ?? new Date();
  const report: BlackboardDeadlineReport = {
    generatedAt: now.toISOString(),
    ...(options.courseQuery ? { courseQuery: options.courseQuery } : {}),
    ...(options.days !== undefined ? { days: options.days } : {}),
    coursesMatched: 0,
    coursesScanned: 0,
    deadlines: [],
    failures: [],
  };
  const courses = await listBlackboardCoursesForAggregation(adapter, report.failures, options.courseQuery);
  report.coursesMatched = courses.length;
  for (const course of courses) {
    report.coursesScanned += 1;
    let assignments: BlackboardAssignment[];
    try {
      assignments = await listBlackboardAssignments(adapter, course.id);
    } catch (error) {
      report.failures.push(
        blackboardOperationFailure(error, {
          stage: "assignments",
          courseId: course.id,
          courseCode: course.courseCode,
          courseName: course.name,
        }),
      );
      continue;
    }
    for (const assignment of assignments) {
      const dueAt = assignment.grading.due;
      if (!dueAt) continue;
      const dueTime = Date.parse(dueAt);
      if (!Number.isFinite(dueTime)) {
        report.failures.push({
          stage: "assignments",
          courseId: course.id,
          courseCode: course.courseCode,
          courseName: course.name,
          contentId: assignment.contentId,
          message: `Assignment "${assignment.title}" returned an unparseable due date: ${dueAt}`,
        });
        continue;
      }
      const due = new Date(dueTime);
      if (due.getTime() < now.getTime()) continue;
      const daysLeft = blackboardDaysLeft(now, due);
      if (options.days !== undefined && daysLeft > options.days) continue;
      report.deadlines.push({
        courseId: course.id,
        courseCode: course.courseCode,
        courseName: course.name,
        columnId: assignment.id,
        contentId: assignment.contentId,
        title: assignment.title,
        dueAt,
        daysLeft,
        availability: assignment.availability,
        ...(assignment.scorePossible !== undefined ? { scorePossible: assignment.scorePossible } : {}),
        ...(assignment.grading.attemptsAllowed !== undefined ? { attemptsAllowed: assignment.grading.attemptsAllowed } : {}),
      });
    }
  }
  report.deadlines.sort((left, right) =>
    Date.parse(left.dueAt) - Date.parse(right.dueAt)
    || left.courseCode.localeCompare(right.courseCode)
    || left.title.localeCompare(right.title),
  );
  return report;
}

export function nextBlackboardDeadline(report: BlackboardDeadlineReport): BlackboardDeadline | null {
  return report.deadlines[0] ?? null;
}

export async function searchBlackboardContentTree(
  adapter: ServiceAdapter,
  options: {
    query: string;
    courseQuery?: string;
    kind?: BlackboardContentItem["kind"];
    attachments?: BlackboardSearchAttachmentMode;
    page?: number;
    pageSize?: number;
  },
): Promise<BlackboardSearchReport> {
  const query = options.query.trim();
  const needle = query.toLowerCase();
  const attachmentsMode = options.attachments ?? "none";
  const page = options.page ?? 1;
  const pageSize = options.pageSize ?? 25;
  const failures: BlackboardOperationFailure[] = [];
  const courses = await listBlackboardCoursesForAggregation(adapter, failures, options.courseQuery);
  const matches: BlackboardSearchMatch[] = [];
  const maxContents = 2_000;
  const maxAttachmentLookups = 200;
  let coursesScanned = 0;
  let contentsScanned = 0;
  let attachmentsScanned = 0;
  let attachmentLookups = 0;
  let traversalTruncated = false;
  let attachmentLookupsTruncated = false;

  for (const course of courses) {
    if (traversalTruncated) break;
    coursesScanned += 1;
    await walkBlackboardCourseContents(adapter, course, {
      shouldContinue(): boolean {
        return !traversalTruncated;
      },
      onFailure(failure): void {
        failures.push(failure);
      },
      async visit(entry): Promise<void> {
        if (contentsScanned >= maxContents) {
          if (!traversalTruncated) {
            traversalTruncated = true;
            failures.push({
              stage: "content",
              courseId: course.id,
              courseCode: course.courseCode,
              courseName: course.name,
              message: `Blackboard search stopped after ${maxContents} content items to keep traversal bounded.`,
            });
          }
          return;
        }
        contentsScanned += 1;
        const titleMatched = entry.item.title.toLowerCase().includes(needle);
        let attachmentMatches: BlackboardContentAttachment[] = [];
        if (attachmentsMode !== "none" && entry.item.kind !== "folder") {
          if (attachmentLookups >= maxAttachmentLookups) {
            if (!attachmentLookupsTruncated) {
              attachmentLookupsTruncated = true;
              failures.push({
                stage: "attachments",
                courseId: course.id,
                courseCode: course.courseCode,
                courseName: course.name,
                message: `Blackboard search stopped attachment-name lookups after ${maxAttachmentLookups} items; use --course or --kind to narrow the crawl.`,
              });
            }
          } else {
            attachmentLookups += 1;
            try {
              const attachments = await listBlackboardContentAttachments(adapter, course.id, entry.item.id);
              attachmentsScanned += attachments.length;
              attachmentMatches = attachments.filter((attachment) => attachment.fileName.toLowerCase().includes(needle));
            } catch (error) {
              failures.push(
                blackboardOperationFailure(error, {
                  stage: "attachments",
                  courseId: course.id,
                  courseCode: course.courseCode,
                  courseName: course.name,
                  contentId: entry.item.id,
                  path: entry.path,
                }),
              );
            }
          }
        }
        const matchReasons = [
          ...(titleMatched ? ["title" as const] : []),
          ...(attachmentMatches.length > 0 ? ["attachment" as const] : []),
        ];
        if (matchReasons.length === 0) return;
        if (attachmentsMode === "only" && attachmentMatches.length === 0) return;
        if (options.kind && entry.item.kind !== options.kind) return;
        matches.push({
          courseId: course.id,
          courseCode: course.courseCode,
          courseName: course.name,
          contentId: entry.item.id,
          parentId: entry.item.parentId,
          title: entry.item.title,
          kind: entry.item.kind,
          handler: entry.item.handler,
          hasChildren: entry.item.hasChildren,
          path: entry.path,
          matchReasons,
          attachmentMatches,
        });
      },
    });
  }

  const totalMatches = matches.length;
  const startIndex = (page - 1) * pageSize;
  const paged = matches.slice(startIndex, startIndex + pageSize);
  return {
    generatedAt: new Date().toISOString(),
    query,
    ...(options.courseQuery ? { courseQuery: options.courseQuery } : {}),
    ...(options.kind ? { kind: options.kind } : {}),
    attachments: attachmentsMode,
    page,
    pageSize,
    coursesMatched: courses.length,
    coursesScanned,
    contentsScanned,
    attachmentsScanned,
    totalMatches,
    returned: paged.length,
    hasMore: startIndex + paged.length < totalMatches,
    ...(startIndex + paged.length < totalMatches ? { nextPage: page + 1 } : {}),
    results: paged,
    failures,
  };
}

export async function syncBlackboardAttachments(
  adapter: ServiceAdapter,
  options: {
    courseId: string;
    destination: string;
    contentId?: string;
    overwrite?: boolean;
  },
): Promise<BlackboardSyncReport> {
  const destination = await ensureBlackboardDirectoryRoot(options.destination);
  const courseId = canonicalCourseId(options.courseId);
  let course = {
    id: courseId,
    courseCode: courseId,
    courseName: courseId,
  };
  try {
    const matched = await listBlackboardCourses(adapter, { query: courseId });
    const resolved = matched.find((entry) => canonicalCourseId(entry.id) === courseId) ?? matched[0];
    if (resolved) {
      course = {
        id: resolved.id,
        courseCode: resolved.courseCode,
        courseName: resolved.name,
      };
    }
  } catch {
    // Best effort only; sync should still proceed against the explicit course ID.
  }

  const report: BlackboardSyncReport = {
    generatedAt: new Date().toISOString(),
    courseId: course.id,
    courseCode: course.courseCode,
    courseName: course.courseName,
    destination,
    ...(options.contentId ? { rootContentId: canonicalIdBody(options.contentId) } : {}),
    plannedFiles: 0,
    downloadedFiles: 0,
    partial: false,
    files: [],
    failures: [],
  };

  await walkBlackboardCourseContents(
    adapter,
    {
      id: course.id,
      numericId: numericIdFromBlackboardId(course.id),
      name: course.courseName,
      courseCode: course.courseCode,
      externalId: "",
      roleId: "",
      availability: "",
    },
    {
      ...(options.contentId ? { rootContentId: options.contentId } : {}),
      onFailure(failure): void {
        report.failures.push(failure);
      },
      async visit(entry): Promise<void> {
        if (entry.item.kind === "folder") return;
        let attachments: BlackboardContentAttachment[];
        try {
          attachments = await listBlackboardContentAttachments(adapter, course.id, entry.item.id);
        } catch (error) {
          report.failures.push(
            blackboardOperationFailure(error, {
              stage: "attachments",
              courseId: course.id,
              courseCode: course.courseCode,
              courseName: course.courseName,
              contentId: entry.item.id,
              path: entry.path,
            }),
          );
          return;
        }
        if (attachments.length === 0) return;
        for (const attachment of attachments) {
          report.plannedFiles += 1;
          const relativePath = buildBlackboardSyncRelativePath(entry.pathTitles, entry.item.id, attachment);
          const absolutePath = resolvePath(destination, relativePath);
          assertBlackboardSyncPathWithinRoot(destination, absolutePath);
          try {
            await ensureBlackboardDirectoryWithinRoot(destination, dirname(absolutePath));
            const downloaded = await downloadBlackboardContentAttachment(
              adapter,
              course.id,
              entry.item.id,
              attachment.id,
              absolutePath,
              { overwrite: options.overwrite === true },
            );
            report.files.push({
              courseId: course.id,
              courseCode: course.courseCode,
              courseName: course.courseName,
              contentId: entry.item.id,
              attachmentId: attachment.id,
              contentPath: entry.path,
              relativePath,
              destination: downloaded.destination,
              source: attachment.source,
              size: downloaded.size,
              sha256: downloaded.sha256,
              contentType: downloaded.contentType,
              overwritten: downloaded.overwritten,
            });
            report.downloadedFiles += 1;
          } catch (error) {
            report.failures.push(
              blackboardOperationFailure(error, {
                stage: "download",
                courseId: course.id,
                courseCode: course.courseCode,
                courseName: course.courseName,
                contentId: entry.item.id,
                attachmentId: attachment.id,
                path: absolutePath,
              }),
            );
          }
        }
      },
    },
  );
  report.partial = report.failures.length > 0;
  return report;
}

export function selectBlackboardAssignment(
  assignments: readonly BlackboardAssignment[],
  selector: { contentId?: string; columnId?: string },
): BlackboardAssignment | undefined {
  const contentId = selector.contentId ? canonicalIdBody(selector.contentId) : undefined;
  const columnId = selector.columnId ? canonicalIdBody(selector.columnId) : undefined;
  return assignments.find((assignment) =>
    (contentId === undefined || assignment.contentId === contentId)
    && (columnId === undefined || assignment.id === columnId),
  );
}

export function evaluateBlackboardSubmissionPreflight(input: {
  assignment: BlackboardAssignment;
  content: BlackboardContentItem;
  attempts: readonly BlackboardAttempt[];
  file: BlackboardSubmissionFile;
  uploadSettings?: BlackboardUploadSettings;
  now?: Date;
}): BlackboardSubmissionPreflight {
  const now = input.now ?? new Date();
  const blockers: BlackboardSubmissionPreflightIssue[] = [];
  const warnings: BlackboardSubmissionPreflightIssue[] = [];
  const inProgressAttemptIds = input.attempts
    .filter((attempt) =>
      attempt.status === "InProgress"
      || attempt.status === "InProgressAgain"
      || attempt.status === "Suspended"
    )
    .map((attempt) => attempt.id);
  const attemptsUsed = input.attempts.filter((attempt) =>
    attempt.status !== "NotAttempted"
    && attempt.status !== "Abandoned"
    && attempt.status !== "Canceled"
  ).length;
  const attemptsAllowed = input.assignment.grading.attemptsAllowed;

  if (input.content.kind !== "assignment") {
    blockers.push({
      code: "UNSUPPORTED_CONTENT_TYPE",
      message: `Content handler ${input.content.handler || "unknown"} is not a Classic/Original assignment.`,
    });
  }
  if (input.assignment.scoreProviderHandle && input.assignment.scoreProviderHandle !== "resource/x-bb-assignment") {
    blockers.push({
      code: "UNSUPPORTED_SCORE_PROVIDER",
      message: `Score provider ${input.assignment.scoreProviderHandle} is not supported by the official attempt-file endpoint.`,
    });
  }
  if (input.assignment.availability && input.assignment.availability !== "Yes") {
    blockers.push({
      code: "ASSIGNMENT_UNAVAILABLE",
      message: "The assignment grade column is not available to students.",
    });
  }
  if (input.assignment.grading.type && input.assignment.grading.type !== "Attempts") {
    blockers.push({
      code: "ASSIGNMENT_NOT_ATTEMPT_BASED",
      message: `Grade column type ${input.assignment.grading.type} does not accept assignment attempts.`,
    });
  }
  if (inProgressAttemptIds.length > 0) {
    blockers.push({
      code: "IN_PROGRESS_ATTEMPT_EXISTS",
      message: `An in-progress attempt already exists (${inProgressAttemptIds.join(", ")}); this CLI will not silently resume or duplicate it.`,
    });
  }
  if (attemptsAllowed !== undefined && attemptsAllowed > 0 && attemptsUsed >= attemptsAllowed) {
    blockers.push({
      code: "ATTEMPT_LIMIT_REACHED",
      message: `Blackboard reports ${attemptsUsed} used attempt(s) and allows ${attemptsAllowed}.`,
    });
  }
  if (
    input.uploadSettings?.maxUploadSizeInBytes !== undefined
    && input.file.size > input.uploadSettings.maxUploadSizeInBytes
  ) {
    blockers.push({
      code: "FILE_TOO_LARGE",
      message: `The file is ${input.file.size} bytes; Blackboard's reported limit is ${input.uploadSettings.maxUploadSizeInBytes} bytes.`,
    });
  }

  const due = input.assignment.grading.due;
  const dueTimestamp = due ? Date.parse(due) : Number.NaN;
  const late = Number.isFinite(dueTimestamp) && now.getTime() > dueTimestamp;
  if (due && !Number.isFinite(dueTimestamp)) {
    warnings.push({
      code: "DUE_DATE_UNPARSEABLE",
      message: `Blackboard returned an unrecognized due date: ${due}.`,
    });
  } else if (late) {
    warnings.push({
      code: "LATE_SUBMISSION",
      message: `The grade-column due date (${due}) has passed; apply requires --allow-late.`,
    });
  }
  if (input.uploadSettings === undefined) {
    warnings.push({
      code: "UPLOAD_LIMIT_UNAVAILABLE",
      message: "This Blackboard version did not expose upload settings; the server will enforce its file-size limit.",
    });
  }

  return {
    checkedAt: now.toISOString(),
    ready: blockers.length === 0,
    late,
    attemptsUsed,
    ...(attemptsAllowed !== undefined ? { attemptsAllowed } : {}),
    inProgressAttemptIds,
    blockers,
    warnings,
  };
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
  const availability = recordValue(record.availability);
  const grading = recordValue(record.grading);
  return {
    id: canonicalIdBody(record.id),
    contentId: canonicalIdBody(record.contentId),
    title: cleanText(record.name),
    ...(score.possible !== undefined ? { scorePossible: numberValue(score.possible) } : {}),
    availability: stringValue(availability.available ?? record.availability),
    grading: {
      type: stringValue(grading.type),
      ...(grading.due !== undefined ? { due: stringValue(grading.due) } : {}),
      ...(grading.attemptsAllowed !== undefined ? { attemptsAllowed: numberValue(grading.attemptsAllowed) } : {}),
      scoringModel: stringValue(grading.scoringModel),
    },
    scoreProviderHandle: stringValue(record.scoreProviderHandle),
  };
}

export function normaliseBlackboardAttempt(raw: unknown): BlackboardAttempt {
  const record = recordValue(raw);
  const displayGrade = recordValue(record.displayGrade);
  const attemptReceipt = record.attemptReceipt ? normaliseBlackboardAttemptReceipt(record.attemptReceipt) : undefined;
  return {
    id: canonicalIdBody(record.id),
    userId: stringValue(record.userId),
    status: stringValue(record.status) as BlackboardAttemptStatus | "",
    readyToPost: booleanValue(record.readyToPost),
    ...(record.score !== undefined ? { score: numberValue(record.score) } : {}),
    ...(displayGrade.text !== undefined ? { displayGradeText: stringValue(displayGrade.text) } : {}),
    ...(displayGrade.score !== undefined ? { displayGradeScore: numberValue(displayGrade.score) } : {}),
    studentComments: cleanText(record.studentComments),
    studentSubmission: cleanText(record.studentSubmission),
    created: stringValue(record.created),
    modified: stringValue(record.modified),
    attemptDate: stringValue(record.attemptDate),
    ...(attemptReceipt ? { attemptReceipt } : {}),
  };
}

export function normaliseBlackboardAttemptReceipt(raw: unknown): BlackboardAttemptReceipt {
  const record = recordValue(raw);
  return {
    receiptId: stringValue(record.receiptId),
    submissionDate: stringValue(record.submissionDate),
    ...(record.submissionTotalSize !== undefined ? { submissionTotalSize: numberValue(record.submissionTotalSize) } : {}),
    courseId: canonicalCourseId(stringValue(record.courseId)),
    gradableItemId: canonicalIdBody(record.gradableItemId),
    attemptId: canonicalIdBody(record.attemptId),
    userId: stringValue(record.userId),
    responseStatus: stringValue(record.responseStatus),
    submissionType: stringValue(record.submissionType),
  };
}

export function normaliseBlackboardAttemptFile(raw: unknown): BlackboardAttemptFile {
  const record = recordValue(raw);
  return {
    id: canonicalIdBody(record.id),
    name: stringValue(record.name),
    viewUrl: stringValue(record.viewUrl),
    downloadUrl: stringValue(record.downloadUrl),
  };
}

export function normaliseBlackboardUploadSettings(raw: unknown): BlackboardUploadSettings {
  const record = recordValue(raw);
  return {
    ...(record.maxUploadSizeInBytes !== undefined ? { maxUploadSizeInBytes: numberValue(record.maxUploadSizeInBytes) } : {}),
    supportsInlineRender: booleanValue(record.supportsInlineRender),
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

async function getBlackboardContentRecord(
  adapter: ServiceAdapter,
  courseId: string,
  contentId: string,
): Promise<unknown> {
  return fetchJson<unknown>(
    adapter,
    buildBlackboardUrl(`/learn/api/public/v1/courses/${canonicalCourseId(courseId)}/contents/${canonicalCourseId(contentId)}`),
  );
}

async function resolveBlackboardContentAttachmentTargets(
  adapter: ServiceAdapter,
  courseId: string,
  contentId: string,
): Promise<BlackboardContentAttachmentTarget[]> {
  const canonicalCourse = canonicalCourseId(courseId);
  const canonicalContent = canonicalCourseId(contentId);
  const [rawContent, restAttachments] = await Promise.all([
    getBlackboardContentRecord(adapter, courseId, contentId),
    listBlackboardRestAttachmentTargets(adapter, canonicalCourse, canonicalContent),
  ]);
  const embedded = extractBlackboardEmbeddedAttachmentTargets(rawContent);
  const directFile = extractBlackboardContentFileTarget(rawContent);
  const unique = new Map<string, BlackboardContentAttachmentTarget>();
  for (const target of [...restAttachments, ...(directFile ? [directFile] : []), ...embedded]) {
    unique.set(target.id, target);
  }
  return [...unique.values()];
}

async function listBlackboardRestAttachmentTargets(
  adapter: ServiceAdapter,
  courseId: string,
  contentId: string,
): Promise<BlackboardContentAttachmentTarget[]> {
  const attachmentRoot = `/learn/api/public/v1/courses/${courseId}/contents/${contentId}/attachments`;
  let url = buildBlackboardUrl(attachmentRoot);
  const targets: BlackboardContentAttachmentTarget[] = [];
  const visited = new Set<string>();

  for (let page = 1; page <= 100; page += 1) {
    if (visited.has(url)) {
      throw new ServiceError("Blackboard attachment pagination returned a repeated next-page URL.", { url });
    }
    visited.add(url);

    let raw: unknown;
    try {
      raw = await fetchJson<unknown>(adapter, url);
    } catch (error) {
      if (isServiceStatus(error, 404)) return [];
      throw error;
    }
    const record = recordValue(raw);
    const collection = Array.isArray(raw)
      ? raw
      : arrayValue(record.results).length > 0
        ? arrayValue(record.results)
        : arrayValue(record.attachments).length > 0
          ? arrayValue(record.attachments)
          : stringValue(record.id)
            ? [raw]
            : [];
    for (const item of collection) {
      const attachment = normaliseBlackboardRestContentAttachment(item, attachmentRoot);
      if (attachment) targets.push(attachment);
    }

    const nextPage = stringValue(recordValue(record.paging).nextPage);
    if (!nextPage) return targets;
    const parsedNext = new URL(nextPage, url);
    if (parsedNext.origin !== BLACKBOARD_BASE) {
      throw new ServiceError("Blackboard attachment pagination attempted to leave its configured origin.", {
        url: `${parsedNext.origin}${parsedNext.pathname}`,
      });
    }
    url = parsedNext.toString();
  }
  throw new ServiceError("Blackboard attachment pagination exceeded the safe page limit.", { url });
}

function normaliseBlackboardRestContentAttachment(
  raw: unknown,
  attachmentRoot: string,
): BlackboardContentAttachmentTarget | undefined {
  const record = recordValue(raw);
  const id = canonicalIdBody(record.id);
  if (!id) return undefined;
  const upstreamDownloadUrl = stringValue(record.downloadUrl);
  const downloadUrl = upstreamDownloadUrl
    ? safeBlackboardDownloadUrl(upstreamDownloadUrl).toString()
    : buildBlackboardUrl(`${attachmentRoot}/${canonicalCourseId(id)}/download`);
  return {
    id,
    fileName: cleanText(record.fileName ?? record.name) || `attachment-${id}`,
    mimeType: stringValue(record.mimeType ?? record.contentType),
    source: "learn-rest",
    downloadUrl,
  };
}

function extractBlackboardEmbeddedAttachmentTargets(rawContent: unknown): BlackboardContentAttachmentTarget[] {
  const record = recordValue(rawContent);
  const body = stringValue(record.body);
  if (!body) return [];
  const targets: BlackboardContentAttachmentTarget[] = [];
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of body.matchAll(anchorPattern)) {
    const attributes = match[1] ?? "";
    const href = htmlAttribute(attributes, "href");
    if (!href) continue;
    let url: URL;
    try {
      url = safeBlackboardDownloadUrl(href);
    } catch {
      continue;
    }
    if (!url.pathname.toLowerCase().includes("/bbcswebdav/")) continue;

    const metadata = parseBlackboardFileMetadata(htmlAttribute(attributes, "data-bbfile"));
    const fileName = cleanText(metadata.linkName ?? metadata.alternativeText ?? match[2])
      || fileNameFromBlackboardUrl(url)
      || "attachment";
    targets.push({
      id: `embedded-${createHash("sha256").update(stableBlackboardAttachmentLocator(url)).digest("hex").slice(0, 16)}`,
      fileName,
      mimeType: stringValue(metadata.mimeType),
      source: "bbml",
      downloadUrl: url.toString(),
    });
  }
  return targets;
}

function extractBlackboardContentFileTarget(rawContent: unknown): BlackboardContentAttachmentTarget | undefined {
  const record = recordValue(rawContent);
  const handler = recordValue(record.contentHandler);
  if (stringValue(handler.id) !== "resource/x-bb-file") return undefined;
  const file = recordValue(handler.file);
  const rawUrl = stringValue(file.downloadUrl ?? file.url);
  if (!rawUrl) return undefined;
  const url = safeBlackboardDownloadUrl(rawUrl);
  return {
    id: `content-file-${createHash("sha256").update(stableBlackboardAttachmentLocator(url)).digest("hex").slice(0, 16)}`,
    fileName: cleanText(file.fileName ?? record.title) || fileNameFromBlackboardUrl(url) || "attachment",
    mimeType: stringValue(file.mimeType),
    source: "content-file",
    downloadUrl: url.toString(),
  };
}

function publicBlackboardContentAttachment(
  target: BlackboardContentAttachmentTarget,
): BlackboardContentAttachment {
  return {
    id: target.id,
    fileName: target.fileName,
    mimeType: target.mimeType,
    source: target.source,
  };
}

function htmlAttribute(attributes: string, name: string): string {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\s)${escapedName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(attributes);
  return decodeBlackboardHtmlEntities(match?.[1] ?? match?.[2] ?? match?.[3] ?? "");
}

function decodeBlackboardHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function parseBlackboardFileMetadata(value: string): Record<string, unknown> {
  if (!value) return {};
  try {
    return recordValue(JSON.parse(value));
  } catch {
    return {};
  }
}

function fileNameFromBlackboardUrl(url: URL): string {
  const raw = url.pathname.split("/").filter(Boolean).at(-1) ?? "";
  try {
    return cleanText(decodeURIComponent(raw));
  } catch {
    return cleanText(raw);
  }
}

function safeBlackboardDownloadUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value, BLACKBOARD_BASE);
  } catch {
    throw new CliError(
      "Blackboard returned an invalid attachment URL.",
      "UNSAFE_SERVICE_URL",
      1,
    );
  }
  const allowedPath = url.pathname.startsWith("/learn/api/public/")
    || url.pathname.toLowerCase().includes("/bbcswebdav/");
  if (url.protocol !== "https:" || url.origin !== BLACKBOARD_BASE || !allowedPath) {
    throw new CliError(
      "Blackboard returned an unsafe attachment URL.",
      "UNSAFE_SERVICE_URL",
      1,
      { host: url.hostname, path: url.pathname },
    );
  }
  return url;
}

function stableBlackboardAttachmentLocator(url: URL): string {
  // Blackboard BBML links can rotate short-lived query signatures between the
  // list and download commands. The same-origin resource path is the stable,
  // non-secret identity; the fresh signed URL remains private to each request.
  return `${url.origin}${url.pathname}`;
}

async function fetchBlackboardAttachmentResponse(adapter: ServiceAdapter, rawUrl: string): Promise<Response> {
  const url = safeBlackboardDownloadUrl(rawUrl);
  let response: Response;
  try {
    response = await adapter.fetch(url.toString(), { headers: { accept: "*/*" } });
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new ServiceError("Could not download the Blackboard attachment.", {
      url: `${url.origin}${url.pathname}`,
    });
  }
  if (!response.ok) {
    throw new ServiceError("Blackboard returned an HTTP error while downloading an attachment.", {
      url: `${url.origin}${url.pathname}`,
      status: response.status,
    });
  }
  const finalUrl = response.url ? safeBlackboardDownloadUrl(response.url) : undefined;
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("application/json") && finalUrl?.pathname.startsWith("/learn/api/public/")) {
    throw new ServiceError("Blackboard returned JSON instead of attachment bytes.", {
      url: `${url.origin}${url.pathname}`,
      status: response.status,
    });
  }
  return response;
}

async function inspectBlackboardDownloadDestination(
  destination: string,
  overwrite: boolean,
): Promise<{ destination: string; existed: boolean }> {
  const absolute = resolvePath(destination);
  const parent = dirname(absolute);
  let parentInfo;
  try {
    parentInfo = await stat(parent);
  } catch (error) {
    throw blackboardFileSystemError("The attachment destination directory could not be accessed.", parent, error);
  }
  if (!parentInfo.isDirectory()) {
    throw new CliError(
      "The attachment destination parent must be a directory.",
      "BLACKBOARD_DOWNLOAD_DESTINATION_INVALID",
      2,
      { destination: absolute },
    );
  }

  let existing;
  try {
    existing = await lstat(absolute);
  } catch (error) {
    if (nodeErrorCode(error) !== "ENOENT") {
      throw blackboardFileSystemError("The attachment destination could not be inspected.", absolute, error);
    }
  }
  if (existing && !overwrite) {
    throw new CliError(
      "The attachment destination already exists; pass --overwrite to replace it.",
      "BLACKBOARD_DOWNLOAD_DESTINATION_EXISTS",
      2,
      { destination: absolute },
    );
  }
  if (existing?.isSymbolicLink()) {
    throw new CliError(
      "The attachment destination must not be a symbolic link.",
      "BLACKBOARD_DOWNLOAD_DESTINATION_INVALID",
      2,
      { destination: absolute },
    );
  }
  if (existing && !existing.isFile()) {
    throw new CliError(
      "The attachment destination is not a regular file.",
      "BLACKBOARD_DOWNLOAD_DESTINATION_INVALID",
      2,
      { destination: absolute },
    );
  }
  return { destination: absolute, existed: existing !== undefined };
}

async function streamBlackboardAttachment(
  response: Response,
  tempPath: string,
  fallbackContentType: string,
): Promise<{ size: number; sha256: string; contentType: string }> {
  if (!response.body) {
    throw new ServiceError("Blackboard returned an attachment response without a body.");
  }
  const contentType = (response.headers.get("content-type") ?? "").split(";", 1)[0]?.trim()
    || fallbackContentType;
  const rawLength = response.headers.get("content-length") ?? "";
  const expectedLength = /^\d+$/.test(rawLength) ? Number(rawLength) : undefined;
  const verifyLength = response.headers.get("content-encoding") ? undefined : expectedLength;
  const hash = createHash("sha256");
  const reader = response.body.getReader();
  let handle;
  let size = 0;
  try {
    handle = await open(tempPath, "wx", 0o600);
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      hash.update(chunk.value);
      size += chunk.value.byteLength;
      let offset = 0;
      while (offset < chunk.value.byteLength) {
        const result = await handle.write(chunk.value, offset, chunk.value.byteLength - offset, null);
        if (result.bytesWritten <= 0) throw new Error("zero-byte file write");
        offset += result.bytesWritten;
      }
    }
    await handle.sync();
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof CliError) throw error;
    throw blackboardFileSystemError("The Blackboard attachment could not be written safely.", tempPath, error);
  } finally {
    await handle?.close().catch(() => undefined);
  }
  if (verifyLength !== undefined && Number.isSafeInteger(verifyLength) && size !== verifyLength) {
    throw new CliError(
      "The downloaded attachment size did not match Blackboard's response.",
      "BLACKBOARD_DOWNLOAD_SIZE_MISMATCH",
      1,
      { expectedSize: verifyLength, actualSize: size },
    );
  }
  return { size, sha256: hash.digest("hex"), contentType };
}

async function finishBlackboardDownload(tempPath: string, destination: string, overwrite: boolean): Promise<void> {
  if (overwrite) {
    try {
      await rename(tempPath, destination);
      return;
    } catch (error) {
      throw blackboardFileSystemError("The Blackboard attachment could not be moved into place.", destination, error);
    }
  }

  try {
    await link(tempPath, destination);
    return;
  } catch (error) {
    if (nodeErrorCode(error) === "EEXIST") throw blackboardDestinationAppeared(destination);
  }

  // Hard links are race-safe but unavailable on some otherwise writable
  // filesystems (for example exFAT and some SMB/cloud mounts). COPYFILE_EXCL
  // preserves the no-overwrite contract as the portable fallback.
  try {
    await copyFile(tempPath, destination, fileSystemConstants.COPYFILE_EXCL);
  } catch (error) {
    if (nodeErrorCode(error) === "EEXIST") throw blackboardDestinationAppeared(destination);
    throw blackboardFileSystemError("The Blackboard attachment could not be placed safely.", destination, error);
  }
}

function blackboardDestinationAppeared(destination: string): CliError {
  return new CliError(
    "The attachment destination appeared while the download was in progress; no file was overwritten.",
    "BLACKBOARD_DOWNLOAD_DESTINATION_EXISTS",
    2,
    { destination },
  );
}

function blackboardFileSystemError(message: string, path: string, error: unknown): CliError {
  return new CliError(message, "BLACKBOARD_DOWNLOAD_FILE_ERROR", 2, {
    path,
    cause: error instanceof Error ? error.message : String(error),
  });
}

interface BlackboardTraversalEntry {
  item: BlackboardContentItem;
  pathTitles: readonly string[];
  path: string;
}

async function listBlackboardCoursesForAggregation(
  adapter: ServiceAdapter,
  failures: BlackboardOperationFailure[],
  courseQuery?: string,
): Promise<BlackboardCourse[]> {
  let user: BlackboardUser;
  try {
    user = await getBlackboardUser(adapter);
  } catch (error) {
    failures.push(blackboardOperationFailure(error, { stage: "courses" }));
    return [];
  }
  let page: { results: unknown[] };
  try {
    page = await fetchBlackboardPage(adapter, `/learn/api/public/v1/users/${encodeURIComponent(user.id)}/courses`);
  } catch (error) {
    failures.push(blackboardOperationFailure(error, { stage: "courses" }));
    return [];
  }
  const query = courseQuery?.trim().toLowerCase();
  const courses: BlackboardCourse[] = [];
  for (const item of page.results) {
    const enrollment = recordValue(item);
    const courseId = stringValue(enrollment.courseId);
    const fallback = normaliseBlackboardCourse(enrollment);
    let course = fallback;
    if (courseId) {
      try {
        const detail = await fetchJson<unknown>(adapter, buildBlackboardUrl(`/learn/api/public/v1/courses/${canonicalCourseId(courseId)}`));
        course = normaliseBlackboardCourse(enrollment, detail);
      } catch (error) {
        failures.push(blackboardOperationFailure(error, {
          stage: "courses",
          courseId: fallback.id || canonicalCourseId(courseId),
          courseCode: fallback.courseCode,
          courseName: fallback.name,
        }));
      }
    }
    if (!query || blackboardCourseMatchesQuery(course, query)) courses.push(course);
  }
  return courses;
}

async function walkBlackboardCourseContents(
  adapter: ServiceAdapter,
  course: BlackboardCourse,
  options: {
    rootContentId?: string;
    visit(entry: BlackboardTraversalEntry): Promise<void> | void;
    onFailure(failure: BlackboardOperationFailure): void;
    shouldContinue?(): boolean;
  },
): Promise<void> {
  const visited = new Set<string>();

  const descend = async (parentId: string | undefined, ancestors: readonly string[]): Promise<void> => {
    if (options.shouldContinue && !options.shouldContinue()) return;
    let items: BlackboardContentItem[];
    try {
      items = await listBlackboardContent(adapter, course.id, parentId);
    } catch (error) {
      options.onFailure(
        blackboardOperationFailure(error, {
          stage: "content",
          courseId: course.id,
          courseCode: course.courseCode,
          courseName: course.name,
          ...(parentId ? { parentId } : {}),
        }),
      );
      return;
    }
    for (const item of items) {
      if (options.shouldContinue && !options.shouldContinue()) return;
      if (visited.has(item.id)) continue;
      visited.add(item.id);
      const pathTitles = [...ancestors, item.title || item.id];
      const entry: BlackboardTraversalEntry = {
        item,
        pathTitles,
        path: blackboardContentPath(course, pathTitles),
      };
      await options.visit(entry);
      if (options.shouldContinue && !options.shouldContinue()) return;
      if (item.hasChildren) await descend(item.id, pathTitles);
    }
  };

  if (options.rootContentId) {
    let rootItem: BlackboardContentItem;
    try {
      rootItem = await getBlackboardContentItem(adapter, course.id, options.rootContentId);
    } catch (error) {
      options.onFailure(
        blackboardOperationFailure(error, {
          stage: "content-item",
          courseId: course.id,
          courseCode: course.courseCode,
          courseName: course.name,
          contentId: canonicalIdBody(options.rootContentId),
        }),
      );
      return;
    }
    visited.add(rootItem.id);
    const rootPathTitles = [rootItem.title || rootItem.id];
    if (options.shouldContinue && !options.shouldContinue()) return;
    await options.visit({
      item: rootItem,
      pathTitles: rootPathTitles,
      path: blackboardContentPath(course, rootPathTitles),
    });
    if (rootItem.hasChildren) await descend(rootItem.id, rootPathTitles);
    return;
  }

  await descend(undefined, []);
}

function blackboardOperationFailure(
  error: unknown,
  context: Omit<BlackboardOperationFailure, "message" | "code" | "status">,
): BlackboardOperationFailure {
  const message = error instanceof Error ? error.message : String(error);
  return {
    ...context,
    message,
    ...(error instanceof CliError && error.code ? { code: error.code } : {}),
    ...(error instanceof CliError && Number.isFinite(Number(error.details?.status)) ? { status: Number(error.details?.status) } : {}),
  };
}

function blackboardContentPath(course: BlackboardCourse, pathTitles: readonly string[]): string {
  const courseLabel = [course.courseCode, course.name].filter(Boolean).join(" · ") || course.id;
  return [courseLabel, ...pathTitles].join(" / ");
}

function blackboardCourseMatchesQuery(course: BlackboardCourse, query: string): boolean {
  return course.id.toLowerCase().includes(query)
    || course.numericId.toLowerCase().includes(query)
    || course.name.toLowerCase().includes(query)
    || course.courseCode.toLowerCase().includes(query);
}

function blackboardDaysLeft(now: Date, due: Date): number {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const finish = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
  return Math.round((finish - start) / 86_400_000);
}

async function ensureBlackboardDirectoryRoot(destination: string): Promise<string> {
  const absolute = resolvePath(destination);
  await ensureBlackboardSafeDirectoryChain(absolute);
  return absolute;
}

async function ensureBlackboardSafeDirectoryChain(path: string): Promise<void> {
  const absolute = resolvePath(path);
  const parent = dirname(absolute);
  if (parent !== absolute) await ensureBlackboardSafeDirectoryChain(parent);
  let info;
  try {
    info = await lstat(absolute);
  } catch (error) {
    if (nodeErrorCode(error) !== "ENOENT") {
      throw new CliError(
        "The Blackboard sync destination could not be inspected.",
        "BLACKBOARD_SYNC_DESTINATION_INVALID",
        2,
        { path: absolute, cause: error instanceof Error ? error.message : String(error) },
      );
    }
    try {
      await mkdir(absolute, { mode: 0o700 });
      info = await lstat(absolute);
    } catch (mkdirError) {
      if (nodeErrorCode(mkdirError) === "EEXIST") {
        info = await lstat(absolute);
      } else {
        throw new CliError(
          "The Blackboard sync destination directory could not be created.",
          "BLACKBOARD_SYNC_DESTINATION_INVALID",
          2,
          { path: absolute, cause: mkdirError instanceof Error ? mkdirError.message : String(mkdirError) },
        );
      }
    }
  }
  if (info.isSymbolicLink()) {
    if (process.platform === "darwin" && absolute === "/var") return;
    throw new CliError(
      "The Blackboard sync destination must not use symbolic links.",
      "BLACKBOARD_SYNC_DESTINATION_INVALID",
      2,
      { path: absolute },
    );
  }
  if (!info.isDirectory()) {
    throw new CliError(
      "The Blackboard sync destination path must be a directory.",
      "BLACKBOARD_SYNC_DESTINATION_INVALID",
      2,
      { path: absolute },
    );
  }
}

async function ensureBlackboardDirectoryWithinRoot(root: string, path: string): Promise<void> {
  const absoluteRoot = resolvePath(root);
  const absolute = resolvePath(path);
  assertBlackboardSyncPathWithinRoot(absoluteRoot, absolute);
  const relativePath = relative(absoluteRoot, absolute);
  if (!relativePath || relativePath === ".") return;
  let current = absoluteRoot;
  for (const segment of relativePath.split(sep).filter(Boolean)) {
    current = join(current, segment);
    let info;
    try {
      info = await lstat(current);
    } catch (error) {
      if (nodeErrorCode(error) !== "ENOENT") {
        throw new CliError(
          "The Blackboard sync destination could not be inspected.",
          "BLACKBOARD_SYNC_DESTINATION_INVALID",
          2,
          { path: current, cause: error instanceof Error ? error.message : String(error) },
        );
      }
      try {
        await mkdir(current, { mode: 0o700 });
        continue;
      } catch (mkdirError) {
        throw new CliError(
          "The Blackboard sync destination directory could not be created.",
          "BLACKBOARD_SYNC_DESTINATION_INVALID",
          2,
          { path: current, cause: mkdirError instanceof Error ? mkdirError.message : String(mkdirError) },
        );
      }
    }
    if (info.isSymbolicLink()) {
      throw new CliError(
        "The Blackboard sync destination must not use symbolic links.",
        "BLACKBOARD_SYNC_DESTINATION_INVALID",
        2,
        { path: current },
      );
    }
    if (!info.isDirectory()) {
      throw new CliError(
        "The Blackboard sync destination path must be a directory.",
        "BLACKBOARD_SYNC_DESTINATION_INVALID",
        2,
        { path: current },
      );
    }
  }
}

function buildBlackboardSyncRelativePath(
  pathTitles: readonly string[],
  contentId: string,
  attachment: BlackboardContentAttachment,
): string {
  const directoryParts = pathTitles.map((title, index, parts) => {
    if (index === parts.length - 1) {
      return sanitiseBlackboardPathSegment(`${title} [content-${contentId}]`, `content-${contentId}`);
    }
    return sanitiseBlackboardPathSegment(title, "content");
  });
  const fileName = sanitiseBlackboardAttachmentFileName(attachment.fileName, attachment.id);
  return join(...directoryParts, fileName);
}

function sanitiseBlackboardPathSegment(value: string, fallback: string): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/g, "")
    .replace(/\.+$/g, "")
    .trim();
  return cleaned || fallback;
}

function sanitiseBlackboardAttachmentFileName(value: string, attachmentId: string): string {
  const safeAttachmentId = sanitiseBlackboardPathSegment(attachmentId, "attachment");
  const suffix = ` [${safeAttachmentId}]`;
  const extension = extname(value).slice(0, 32);
  const stem = extension ? value.slice(0, -extension.length) : value;
  const cleanStem = sanitiseBlackboardPathSegment(stem, "attachment");
  const cleanExtension = extension.replace(/[^.\w-]/g, "");
  return `${cleanStem}${suffix}${cleanExtension}`;
}

function assertBlackboardSyncPathWithinRoot(root: string, destination: string): void {
  const relativePath = relative(root, destination);
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new CliError(
      "The Blackboard sync target escaped the requested destination root.",
      "BLACKBOARD_SYNC_DESTINATION_INVALID",
      2,
      { root, destination },
    );
  }
}

function nodeErrorCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : "";
}

function isServiceStatus(error: unknown, status: number): boolean {
  return error instanceof CliError && Number(error.details?.status) === status;
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

async function rereadBlackboardSubmissionBytes(file: BlackboardSubmissionFile): Promise<Uint8Array> {
  const buffer = await readFile(file.absolutePath);
  assertBlackboardSubmissionBytes(file, buffer);
  return buffer;
}

function assertBlackboardSubmissionBytes(file: BlackboardSubmissionFile, buffer: Uint8Array): void {
  const actualSha256 = createHash("sha256").update(buffer).digest("hex");
  if (buffer.byteLength !== file.size || actualSha256 !== file.sha256) {
    throw new CliError(
      "The Blackboard submission file changed after it was previewed.",
      "BLACKBOARD_FILE_CHANGED",
      2,
      {
        file: file.absolutePath,
        expectedSize: file.size,
        actualSize: buffer.byteLength,
        expectedSha256: file.sha256,
        actualSha256,
      },
    );
  }
}
