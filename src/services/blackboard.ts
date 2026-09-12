import { createHash, randomUUID } from "node:crypto";
import { constants as fileSystemConstants } from "node:fs";
import { copyFile, link, lstat, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve as resolvePath, sep } from "node:path";
import { CliError } from "../core/errors.js";
import { assertPathAndParentsAreNotSymlinks } from "../core/local-store.js";
import {
  arrayValue,
  booleanValue,
  cleanText,
  collapseWhitespace,
  fetchJson,
  fetchText,
  fetchTextResponse,
  numberValue,
  recordValue,
  requestUrl,
  ServiceError,
  stringValue,
} from "./base.js";
import type { ServiceAdapter, ServiceStatus } from "./base.js";
import { confirmBlackboardNoAttempts } from "./blackboard-assignment-form.js";

export const BLACKBOARD_BASE = "https://bb.sustech.edu.cn";

export const BLACKBOARD_STATUS: ServiceStatus = {
  service: "blackboard",
  availability: "adapter_required",
  auth: "cookie-session",
  campusNetwork: false,
  browser: true,
  summary: "Blackboard REST reads, local file downloads, and guarded assignment submission are implemented, with an explicit browser-auth fallback for read-only and local-download paths.",
  notes: [
    "The adapter must provide Blackboard cookies for bb.sustech.edu.cn.",
    "The CLI CAS bridge completed an opt-in live courses read on 2026-08-26.",
    "A human-only --browser --interactive fallback can mint an ephemeral Blackboard session cookie when CAS blocks password-only login with an interactive challenge.",
    "Native shared-calendar links are separate bearer-like secrets stored only in the operating-system credential store.",
    "Course announcements follow the official Learn REST announcement endpoints; system announcements are included when the user's Blackboard role can read them.",
    "Course discussion forums, threads, and replies use the official Learn REST discussion endpoints when the target course exposes them; Blackboard Original courses can reject that API as unsupported.",
    "Course-message folders, message lists, and participant lists follow the official Learn REST course-message endpoints with explicit paging and server-side folder filters.",
    "Teacher-provided files use the Learn content-attachment endpoint or same-origin BBML links.",
    "Assignment files and text are submitted through the Classic/Original HTTP form with the CAS cookie session; attempt and attachment read-back uses Learn REST. No browser automation is required for submission.",
    "Individual Original file resubmission passed live CLI submission and REST read-back on 2026-09-11; text submission and first-submission 404 recovery remain fixture-tested only.",
  ],
  endpoints: [
    "/learn/api/public/v1/users/me",
    "/learn/api/public/v1/users/{uid}/courses",
    "/learn/api/public/v1/courses/{courseId}",
    "/learn/api/public/v1/announcements",
    "/learn/api/public/v1/courses/{courseId}/announcements",
    "/learn/api/public/v1/courses/{courseId}/discussions",
    "/learn/api/public/v1/courses/{courseId}/discussions/{discussionId}",
    "/learn/api/public/v1/courses/{courseId}/discussions/{discussionId}/messages",
    "/learn/api/public/v1/courses/{courseId}/discussions/{discussionId}/messages/{messageId}/replies",
    "/learn/api/public/v1/courses/{courseId}/messages",
    "/learn/api/public/v1/courses/{courseId}/messages/folders",
    "/learn/api/public/v1/courses/{courseId}/messages/{messageId}/participants",
    "/learn/api/public/v1/calendars",
    "/learn/api/public/v1/calendars/items",
    "/webapps/calendar/calendarFeed/{opaque}/learn.ics",
    "/learn/api/public/v1/courses/{courseId}/contents",
    "/learn/api/public/v1/courses/{courseId}/contents/{contentId}/attachments",
    "/learn/api/public/v1/courses/{courseId}/contents/{contentId}/attachments/{attachmentId}/download",
    "/learn/api/public/v2/courses/{courseId}/gradebook/columns",
    "/learn/api/public/v2/courses/{courseId}/gradebook/columns/{columnId}/attempts",
    "/learn/api/public/v1/courses/{courseId}/gradebook/attempts/{attemptId}/files",
    "/webapps/assignment/uploadAssignment",
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

export interface BlackboardAttemptFileReference {
  id: string;
  name: string;
}

export interface BlackboardAttemptFileDownload {
  file: BlackboardAttemptFile;
  destination: string;
  size: number;
  sha256: string;
  contentType: string;
  overwritten: boolean;
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

export interface BlackboardSubmissionText {
  path: string;
  absolutePath: string;
  size: number;
  sha256: string;
  charCount: number;
}

export type BlackboardSubmissionMaterial =
  | { kind: "file"; file: BlackboardSubmissionFile }
  | { kind: "text"; text: BlackboardSubmissionText };

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

export interface BlackboardSubmissionTextPayload {
  textFile: BlackboardSubmissionText;
  text: string;
}

export type BlackboardFailureStage =
  | "courses"
  | "announcements"
  | "calendar-items"
  | "assignments"
  | "attempts"
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
  calendarItemType?: BlackboardCalendarItemType;
  since?: string;
  until?: string;
  courseId?: string;
  courseCode?: string;
  courseName?: string;
  parentId?: string;
  contentId?: string;
  columnId?: string;
  attachmentId?: string;
  path?: string;
}

export type BlackboardAssignmentSubmissionState =
  | "not_attempted"
  | "in_progress"
  | "submitted"
  | "completed"
  | "mixed"
  | "other";

export interface BlackboardAssignmentAttemptSummary {
  state: BlackboardAssignmentSubmissionState;
  totalAttempts: number;
  submittedAttempts: number;
  completedAttempts: number;
  inProgressAttempts: number;
  latestAttemptId?: string;
  latestStatus?: BlackboardAttemptStatus | "";
  latestAttemptDate?: string;
  latestSubmissionDate?: string;
  latestDisplayGradeText?: string;
}

export interface BlackboardAssignmentWithAttempts {
  assignment: BlackboardAssignment;
  attemptSummary?: BlackboardAssignmentAttemptSummary;
}

export interface BlackboardAssignmentsWithAttemptsReport {
  generatedAt: string;
  courseId: string;
  totalAssignments: number;
  completedAttemptFetches: number;
  attemptedAssignments: number;
  partial: boolean;
  assignments: BlackboardAssignmentWithAttempts[];
  failures: BlackboardOperationFailure[];
}

export interface BlackboardScopedAssignment {
  courseId: string;
  courseCode: string;
  courseName: string;
  assignment: BlackboardAssignment;
  attemptSummary?: BlackboardAssignmentAttemptSummary;
}

export interface BlackboardAssignmentsAggregateReport {
  generatedAt: string;
  courseQuery?: string;
  withAttempts: boolean;
  submissionState?: BlackboardAssignmentSubmissionState;
  coursesMatched: number;
  coursesScanned: number;
  totalAssignments: number;
  completedAttemptFetches: number;
  attemptedAssignments: number;
  partial: boolean;
  assignments: BlackboardScopedAssignment[];
  failures: BlackboardOperationFailure[];
}

export interface BlackboardGradeEntry extends BlackboardScopedAssignment {
  attemptSummary: BlackboardAssignmentAttemptSummary;
}

export interface BlackboardGradesReport {
  generatedAt: string;
  courseQuery?: string;
  submissionState?: Exclude<BlackboardAssignmentSubmissionState, "not_attempted">;
  limit?: number;
  coursesMatched: number;
  coursesScanned: number;
  totalAssignments: number;
  completedAttemptFetches: number;
  attemptedAssignments: number;
  partial: boolean;
  grades: BlackboardGradeEntry[];
  failures: BlackboardOperationFailure[];
}

export function filterBlackboardAssignmentsBySubmissionState(
  assignments: readonly BlackboardAssignmentWithAttempts[],
  state: BlackboardAssignmentSubmissionState,
): BlackboardAssignmentWithAttempts[] {
  return assignments.filter((item) => item.attemptSummary?.state === state);
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
  attemptSummary?: BlackboardAssignmentAttemptSummary;
}

export interface BlackboardAnnouncement {
  id: string;
  source: "system" | "course";
  title: string;
  body: string;
  created: string;
  modified: string;
  creator?: string;
  draft?: boolean;
  availabilityType?: "Permanent" | "Restricted" | "";
  availableFrom?: string;
  availableUntil?: string;
  showAtLogin?: boolean;
  showInCourses?: boolean;
  courseId?: string;
  courseCode?: string;
  courseName?: string;
}

export interface BlackboardAnnouncementsReport {
  generatedAt: string;
  courseQuery?: string;
  days?: number;
  coursesMatched: number;
  coursesScanned: number;
  systemAnnouncements: number;
  courseAnnouncements: number;
  partial: boolean;
  announcements: BlackboardAnnouncement[];
  failures: BlackboardOperationFailure[];
}

export type BlackboardDiscussionMessageStatus =
  | "Published"
  | "Deleted"
  | "Draft"
  | "";

export interface BlackboardDiscussionMessage {
  id: string;
  discussionId: string;
  parentId: string;
  threadId: string;
  userId: string;
  groupId: string;
  givenName: string;
  familyName: string;
  author: string;
  status: BlackboardDiscussionMessageStatus;
  body: string;
  postDate: string;
  editDate: string;
  createdDate: string;
  modifiedDate: string;
  isRead: boolean;
  subject?: string;
  source?: "learn-rest" | "original-html";
  metadataPartial?: boolean;
  unreadPosts?: number;
  unreadRepliesToMe?: number;
  totalPosts?: number;
}

export interface BlackboardDiscussion {
  id: string;
  title: string;
  available: boolean;
  gradable: boolean;
  groupDiscussion: boolean;
  createdDate: string;
  modifiedDate: string;
  gradebookColumnId?: string;
  source?: "learn-rest" | "original-html";
  metadataPartial?: boolean;
  description?: string;
  totalPosts?: number;
  unreadPosts?: number;
  unreadRepliesToMe?: number;
  totalParticipants?: number;
  topic?: BlackboardDiscussionMessage;
}

export interface BlackboardDiscussionsPage {
  generatedAt: string;
  courseId: string;
  courseCode: string;
  courseName: string;
  title?: string;
  gradable?: boolean;
  sort?: string;
  page: number;
  pageSize: number;
  returned: number;
  hasMore: boolean;
  nextPage?: number;
  discussions: BlackboardDiscussion[];
}

export interface BlackboardDiscussionGroup {
  groupId: string;
  discussionId: string;
  threadId: string;
}

export interface BlackboardDiscussionGroupsPage {
  generatedAt: string;
  courseId: string;
  courseCode: string;
  courseName: string;
  discussion: BlackboardDiscussion;
  sort?: string;
  page: number;
  pageSize: number;
  returned: number;
  hasMore: boolean;
  nextPage?: number;
  groups: BlackboardDiscussionGroup[];
}

export interface BlackboardDiscussionMessagesPage {
  generatedAt: string;
  courseId: string;
  courseCode: string;
  courseName: string;
  discussion: BlackboardDiscussion;
  groupId?: string;
  userId?: string;
  status?: Exclude<BlackboardDiscussionMessageStatus, "">;
  isRead?: boolean;
  sort?: string;
  page: number;
  pageSize: number;
  returned: number;
  hasMore: boolean;
  nextPage?: number;
  messages: BlackboardDiscussionMessage[];
}

export interface BlackboardDiscussionRepliesPage {
  generatedAt: string;
  courseId: string;
  courseCode: string;
  courseName: string;
  discussionId: string;
  messageId: string;
  groupId?: string;
  userId?: string;
  status?: Exclude<BlackboardDiscussionMessageStatus, "">;
  isRead?: boolean;
  sort?: string;
  page: number;
  pageSize: number;
  returned: number;
  hasMore: boolean;
  nextPage?: number;
  replies: BlackboardDiscussionMessage[];
}

export interface BlackboardDiscussionMessageWriteInput {
  body: string;
  groupId?: string;
  status?: Exclude<BlackboardDiscussionMessageStatus, "">;
}

export type BlackboardCourseMessageFolderType =
  | "Inbox"
  | "Sent"
  | "Delete"
  | "Custom"
  | "";

export interface BlackboardCourseMessageFolder {
  name: string;
  label: string;
  type: BlackboardCourseMessageFolderType;
  totalCount: number;
  unreadCount: number;
}

export type BlackboardParticipantDisplayPreference =
  | "GivenName"
  | "OtherName"
  | "Both"
  | "";

export interface BlackboardParticipantUser {
  id: string;
  userName: string;
  otherName: string;
  givenName: string;
  familyName: string;
  middleName: string;
  suffix: string;
  title: string;
  preferredDisplayName: BlackboardParticipantDisplayPreference;
  displayName: string;
}

export interface BlackboardCourseMessageAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  fileLocation: string;
}

export type BlackboardCourseMessageType =
  | "System"
  | "Normal"
  | "";

export interface BlackboardCourseMessage {
  id: string;
  subject: string;
  body: string;
  postedDate: string;
  isRead: boolean;
  type: BlackboardCourseMessageType;
  senderId: string;
  sender?: BlackboardParticipantUser;
  attachment?: BlackboardCourseMessageAttachment;
  toUsers: string[];
  ccUsers: string[];
  bccUsers: string[];
  isExistingAttachment: boolean;
  isReply: boolean;
}

export interface BlackboardCourseMessageWriteInput {
  subject?: string;
  body: string;
  toUsers: string[];
  ccUsers?: string[];
  bccUsers?: string[];
}

export interface BlackboardCourseMessageFoldersPage {
  generatedAt: string;
  courseId: string;
  courseCode: string;
  courseName: string;
  page: number;
  pageSize: number;
  returned: number;
  hasMore: boolean;
  nextPage?: number;
  folders: BlackboardCourseMessageFolder[];
}

export interface BlackboardCourseMessagesPage {
  generatedAt: string;
  courseId: string;
  courseCode: string;
  courseName: string;
  folderType?: Exclude<BlackboardCourseMessageFolderType, "">;
  folderName?: string;
  sort?: string;
  page: number;
  pageSize: number;
  returned: number;
  hasMore: boolean;
  nextPage?: number;
  messages: BlackboardCourseMessage[];
}

export type BlackboardCourseMessageParticipationType =
  | "From"
  | "To"
  | "Cc"
  | "Bcc"
  | "";

export interface BlackboardCourseMessageParticipant {
  messageId: string;
  userId: string;
  participationType: BlackboardCourseMessageParticipationType;
  displayName: string;
  user?: BlackboardParticipantUser;
}

export interface BlackboardCourseMessageParticipantsPage {
  generatedAt: string;
  courseId: string;
  courseCode: string;
  courseName: string;
  messageId: string;
  participationType?: Exclude<BlackboardCourseMessageParticipationType, "">;
  sort?: string;
  page: number;
  pageSize: number;
  returned: number;
  hasMore: boolean;
  nextPage?: number;
  participants: BlackboardCourseMessageParticipant[];
}

export type BlackboardCourseMembershipAvailability =
  | "Yes"
  | "No"
  | "Disabled"
  | "";

export interface BlackboardCourseRosterUser {
  id: string;
  userName: string;
  displayName: string;
  givenName: string;
  familyName: string;
  otherName: string;
  email: string;
  institutionEmail: string;
  avatarUrl: string;
  availability: BlackboardCourseMembershipAvailability;
}

export interface BlackboardCourseMembership {
  id: string;
  userId: string;
  courseId: string;
  childCourseId: string;
  created: string;
  modified: string;
  availability: BlackboardCourseMembershipAvailability;
  courseRoleId: string;
  lastAccessed: string;
  dueDateExceptionType: string;
  timeLimitExceptionType: string;
  displayOrder?: number;
  user?: BlackboardCourseRosterUser;
}

export interface BlackboardCourseRosterPage {
  generatedAt: string;
  courseId: string;
  courseCode: string;
  courseName: string;
  role?: string;
  availability?: Exclude<BlackboardCourseMembershipAvailability, "">;
  sort?: string;
  page: number;
  pageSize: number;
  returned: number;
  hasMore: boolean;
  nextPage?: number;
  memberships: BlackboardCourseMembership[];
}

export interface BlackboardDeadlineReport {
  generatedAt: string;
  courseQuery?: string;
  days?: number;
  submissionState?: BlackboardAssignmentSubmissionState;
  coursesMatched: number;
  coursesScanned: number;
  partial: boolean;
  deadlines: BlackboardDeadline[];
  failures: BlackboardOperationFailure[];
}

export type BlackboardCalendarKind = "course" | "institution" | "personal" | "unknown";

export interface BlackboardCalendar {
  id: string;
  name: string;
  kind: BlackboardCalendarKind;
  courseId?: string;
}

export type BlackboardCalendarItemType =
  | "Course"
  | "GradebookColumn"
  | "Institution"
  | "OfficeHours"
  | "Personal";

export type BlackboardCalendarWeekDay =
  | "Sunday"
  | "Monday"
  | "Tuesday"
  | "Wednesday"
  | "Thursday"
  | "Friday"
  | "Saturday";

export interface BlackboardCalendarItemDynamicProps {
  attemptable: boolean;
  categoryId: string;
  dateRangeLimited: boolean;
  eventType: string;
  gradable: boolean;
}

export interface BlackboardCalendarItemRecurrence {
  count?: number;
  frequency: "Daily" | "Weekly" | "Monthly" | "";
  interval?: number;
  monthRepeatDay?: number;
  monthPosition?: number;
  originalStart?: string;
  originalEnd?: string;
  repeatBroken: boolean;
  repeatDay?: BlackboardCalendarWeekDay;
  until?: string;
  weekDays: BlackboardCalendarWeekDay[];
}

export interface BlackboardCalendarItem {
  id: string;
  type: BlackboardCalendarItemType | "";
  calendarId: string;
  calendarName: string;
  title: string;
  description: string;
  location: string;
  start: string;
  end: string;
  modified: string;
  color: string;
  disableResizing: boolean;
  courseId?: string;
  dynamicCalendarItemProps?: BlackboardCalendarItemDynamicProps;
  recurrence?: BlackboardCalendarItemRecurrence;
}

export interface BlackboardCalendarItemsReport {
  generatedAt: string;
  courseId?: string;
  type?: BlackboardCalendarItemType;
  since: string;
  until: string;
  requestedChunks: number;
  completedChunks: number;
  partial: boolean;
  totalItems: number;
  items: BlackboardCalendarItem[];
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

export interface BlackboardContentKindCount {
  kind: BlackboardContentItem["kind"];
  count: number;
}

export interface BlackboardContentHandlerCount {
  handler: string;
  count: number;
}

export interface BlackboardContentTypesCourse {
  courseId: string;
  courseCode: string;
  courseName: string;
  totalItems: number;
  kindCounts: BlackboardContentKindCount[];
  handlerCounts: BlackboardContentHandlerCount[];
}

export interface BlackboardContentTypesReport {
  generatedAt: string;
  courseQuery?: string;
  coursesMatched: number;
  coursesScanned: number;
  totalItems: number;
  partial: boolean;
  totals: BlackboardContentKindCount[];
  courses: BlackboardContentTypesCourse[];
  failures: BlackboardOperationFailure[];
}

export interface BlackboardContentTreeEntry {
  courseId: string;
  courseCode: string;
  courseName: string;
  contentId: string;
  parentId: string;
  title: string;
  kind: BlackboardContentItem["kind"];
  handler: string;
  hasChildren: boolean;
  depth: number;
  path: string;
  pathTitles: readonly string[];
}

export interface BlackboardContentTreeReport {
  generatedAt: string;
  courseId: string;
  courseCode: string;
  courseName: string;
  rootContentId?: string;
  maxItems: number;
  returnedItems: number;
  truncated: boolean;
  partial: boolean;
  entries: BlackboardContentTreeEntry[];
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

export async function listBlackboardCalendars(adapter: ServiceAdapter): Promise<BlackboardCalendar[]> {
  const page = await fetchBlackboardPage(adapter, "/learn/api/public/v1/calendars");
  return page.results.map((item) => normaliseBlackboardCalendar(item));
}

export async function listBlackboardCalendarItems(
  adapter: ServiceAdapter,
  options: {
    courseId?: string;
    type?: BlackboardCalendarItemType;
    since?: Date | string;
    until?: Date | string;
    now?: Date;
  } = {},
): Promise<BlackboardCalendarItemsReport> {
  const window = resolveBlackboardCalendarWindow(options);
  const chunks = buildBlackboardCalendarChunks(window.sinceDate, window.untilDate);
  const unique = new Map<string, BlackboardCalendarItem>();
  const failures: BlackboardOperationFailure[] = [];
  let completedChunks = 0;

  for (const chunk of chunks) {
    try {
      const items = await fetchBlackboardCalendarItemsChunk(adapter, {
        since: chunk.since,
        until: chunk.until,
        ...(options.courseId ? { courseId: options.courseId } : {}),
        ...(options.type ? { type: options.type } : {}),
      });
      completedChunks += 1;
      for (const item of items) unique.set(blackboardCalendarItemKey(item), item);
    } catch (error) {
      failures.push(blackboardOperationFailure(error, {
        stage: "calendar-items",
        ...(options.type ? { calendarItemType: options.type } : {}),
        ...(options.courseId ? { courseId: canonicalCourseId(options.courseId) } : {}),
        since: chunk.since,
        until: chunk.until,
      }));
    }
  }

  if (completedChunks === 0 && failures.length > 0) {
    const first = failures[0];
    throw new CliError(
      first?.message || "Blackboard calendar items could not be read.",
      first?.code || "BLACKBOARD_CALENDAR_READ_FAILED",
      1,
      {
        ...(first?.status !== undefined ? { status: first.status } : {}),
        ...(first?.calendarItemType ? { type: first.calendarItemType } : {}),
        ...(first?.since ? { since: first.since } : {}),
        ...(first?.until ? { until: first.until } : {}),
        ...(first?.courseId ? { courseId: first.courseId } : {}),
      },
    );
  }

  const items = [...unique.values()].sort((left, right) =>
    compareBlackboardCalendarDateTime(left.start, right.start)
    || compareBlackboardCalendarDateTime(left.end, right.end)
    || left.type.localeCompare(right.type)
    || left.title.localeCompare(right.title)
    || left.id.localeCompare(right.id),
  );
  return {
    generatedAt: new Date().toISOString(),
    ...(options.courseId ? { courseId: canonicalCourseId(options.courseId) } : {}),
    ...(options.type ? { type: options.type } : {}),
    since: window.since,
    until: window.until,
    requestedChunks: chunks.length,
    completedChunks,
    partial: failures.length > 0,
    totalItems: items.length,
    items,
    failures,
  };
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

async function listBlackboardSystemAnnouncements(adapter: ServiceAdapter): Promise<BlackboardAnnouncement[]> {
  const page = await fetchBlackboardPage(adapter, "/learn/api/public/v1/announcements");
  return page.results.map((item) => normaliseBlackboardAnnouncement(item, { source: "system" }));
}

async function listBlackboardCourseAnnouncements(
  adapter: ServiceAdapter,
  courseId: string,
): Promise<BlackboardAnnouncement[]> {
  const page = await fetchBlackboardPage(adapter, `/learn/api/public/v1/courses/${canonicalCourseId(courseId)}/announcements`);
  return page.results.map((item) => normaliseBlackboardAnnouncement(item, { source: "course" }));
}

export async function listBlackboardDiscussions(
  adapter: ServiceAdapter,
  options: {
    courseId: string;
    title?: string;
    gradable?: boolean;
    page?: number;
    pageSize?: number;
    sort?: string;
  },
): Promise<BlackboardDiscussionsPage> {
  const page = validatedBlackboardPage(options.page);
  const pageSize = validatedBlackboardPageSize(options.pageSize);
  const course = await resolveBlackboardCourseContext(adapter, options.courseId);
  const title = options.title?.trim() || undefined;
  const sort = options.sort?.trim() || undefined;
  const query: Record<string, string> = {
    offset: String((page - 1) * pageSize),
    limit: String(pageSize),
  };
  if (title) query.title = title;
  if (options.gradable !== undefined) query.gradable = options.gradable ? "true" : "false";
  if (sort) query.sort = sort;
  try {
    const response = await fetchBlackboardPageChunk(
      adapter,
      buildBlackboardUrl(`/learn/api/public/v1/courses/${course.id}/discussions`, query),
      { absolute: true },
    );
    const discussions = response.results.map((item) => normaliseBlackboardDiscussion(item));
    return {
      generatedAt: new Date().toISOString(),
      courseId: course.id,
      courseCode: course.courseCode,
      courseName: course.name,
      ...(title ? { title } : {}),
      ...(options.gradable !== undefined ? { gradable: options.gradable } : {}),
      ...(sort ? { sort } : {}),
      page,
      pageSize,
      returned: discussions.length,
      hasMore: Boolean(response.nextPage),
      ...(response.nextPage ? { nextPage: page + 1 } : {}),
      discussions,
    };
  } catch (error) {
    if (
      !isBlackboardOriginalDiscussionUnsupported(error)
      && !(sort && isBlackboardDiscussionSortRejected(error))
    ) {
      throw normalizeBlackboardDiscussionUnsupported(error, {
        operation: "list",
        courseId: options.courseId,
      });
    }
  }
  return listBlackboardOriginalDiscussions(adapter, course, {
    ...(title ? { title } : {}),
    ...(options.gradable !== undefined ? { gradable: options.gradable } : {}),
    ...(sort ? { sort } : {}),
    page,
    pageSize,
  });
}

const BLACKBOARD_ORIGINAL_DISCUSSION_MAX_ITEMS = 500;
const BLACKBOARD_ORIGINAL_DISCUSSION_MESSAGE_MAX_ITEMS = 500;
const BLACKBOARD_ORIGINAL_DISCUSSION_BODY_CONCURRENCY = 4;

async function listBlackboardOriginalDiscussions(
  adapter: ServiceAdapter,
  course: BlackboardCourse,
  options: {
    title?: string;
    gradable?: boolean;
    sort?: string;
    page: number;
    pageSize: number;
  },
): Promise<BlackboardDiscussionsPage> {
  if (options.gradable !== undefined) {
    throw new CliError(
      "Original Blackboard discussion forums do not expose a trustworthy gradable flag through the HTML fallback. Remove --gradable for this course.",
      "BLACKBOARD_DISCUSSIONS_FILTER_UNSUPPORTED",
      2,
      {
        courseId: course.id,
        filter: "gradable",
        source: "original-html",
        retryPolicy: "DO_NOT_RETRY_AUTOMATICALLY",
      },
    );
  }
  const catalog = await loadBlackboardOriginalDiscussionCatalog(adapter, course, {
    requireAll:
      options.title !== undefined
      || options.sort !== undefined
      || options.page !== 1,
  });
  const filtered = options.title
    ? catalog.items.filter((discussion) =>
      normaliseLookupTextForBlackboardFallback(discussion.title).includes(normaliseLookupTextForBlackboardFallback(options.title ?? ""))
    )
    : catalog.items;
  const sorted = sortBlackboardOriginalDiscussions(filtered, options.sort, course.id);
  const offset = (options.page - 1) * options.pageSize;
  const discussions = sorted.slice(offset, offset + options.pageSize);
  const hasMore = offset + discussions.length < sorted.length;
  return {
    generatedAt: new Date().toISOString(),
    courseId: course.id,
    courseCode: course.courseCode,
    courseName: course.name,
    ...(options.title ? { title: options.title } : {}),
    ...(options.sort ? { sort: options.sort } : {}),
    page: options.page,
    pageSize: options.pageSize,
    returned: discussions.length,
    hasMore,
    ...(hasMore ? { nextPage: options.page + 1 } : {}),
    discussions,
  };
}

async function loadBlackboardOriginalDiscussionCatalog(
  adapter: ServiceAdapter,
  course: BlackboardCourse,
  options: { requireAll?: boolean } = {},
): Promise<BlackboardOriginalDiscussionPage> {
  const launch = await fetchTextResponse(
    adapter,
    buildBlackboardUrl("/webapps/blackboard/content/launchLink.jsp", {
      course_id: course.id,
      tool_id: "_142_1",
      tool_type: "TOOL",
      mode: "reset",
    }),
    { headers: { accept: "text/html, */*;q=0.1" } },
  );
  const initialPage = parseBlackboardOriginalDiscussionPage(launch.text, launch.finalUrl);
  if (initialPage.total <= initialPage.items.length) return initialPage;
  if (!options.requireAll) return initialPage;
  if (!initialPage.confId) {
    throw new CliError(
      "Original Blackboard discussion fallback could not resolve the forum conference id needed to load the complete HTML forum list.",
      "BLACKBOARD_DISCUSSIONS_FALLBACK_UNAVAILABLE",
      1,
      {
        courseId: course.id,
        returned: initialPage.items.length,
        total: initialPage.total,
        source: "original-html",
      },
    );
  }
  if (initialPage.total > BLACKBOARD_ORIGINAL_DISCUSSION_MAX_ITEMS) {
    throw new CliError(
      "Original Blackboard discussion forum fallback would need to load too many HTML rows. Narrow the course or use the native Blackboard UI.",
      "BLACKBOARD_DISCUSSIONS_FALLBACK_LIMIT_EXCEEDED",
      1,
      {
        courseId: course.id,
        total: initialPage.total,
        limit: BLACKBOARD_ORIGINAL_DISCUSSION_MAX_ITEMS,
        source: "original-html",
      },
    );
  }
  const full = await fetchTextResponse(
    adapter,
    buildBlackboardUrl("/webapps/discussionboard/do/conference", {
      action: "list_forums",
      course_id: course.id,
      conf_id: initialPage.confId,
      nav: "discussion_board_entry",
      toggle_mode: "read",
      mode: "view",
      showAll: "true",
      startIndex: "0",
      sortCol: "position",
      sortDir: "ASCENDING",
    }),
    { headers: { accept: "text/html, */*;q=0.1" } },
  );
  const fullPage = parseBlackboardOriginalDiscussionPage(full.text, full.finalUrl);
  if (fullPage.total > fullPage.items.length) {
    throw new CliError(
      "Original Blackboard discussion forum fallback did not return a complete HTML forum list.",
      "BLACKBOARD_DISCUSSIONS_FALLBACK_UNAVAILABLE",
      1,
      {
        courseId: course.id,
        total: fullPage.total,
        returned: fullPage.items.length,
        source: "original-html",
      },
    );
  }
  return fullPage;
}

interface BlackboardOriginalDiscussionContext {
  confId: string;
  discussion: BlackboardDiscussion;
}

async function getBlackboardOriginalDiscussionContext(
  adapter: ServiceAdapter,
  course: BlackboardCourse,
  discussionId: string,
): Promise<BlackboardOriginalDiscussionContext> {
  const catalog = await loadBlackboardOriginalDiscussionCatalog(adapter, course, { requireAll: true });
  const canonicalDiscussionId = canonicalIdBody(discussionId);
  const discussion = catalog.items.find((item) => item.id === canonicalDiscussionId);
  if (!discussion) {
    throw new CliError(
      "The requested Blackboard Original discussion forum was not found in the HTML fallback catalog.",
      "BLACKBOARD_DISCUSSION_NOT_FOUND",
      1,
      {
        courseId: course.id,
        discussionId: canonicalCourseId(discussionId),
        source: "original-html",
      },
    );
  }
  if (!catalog.confId) {
    throw new CliError(
      "Original Blackboard discussion fallback could not resolve the forum conference id needed to open this discussion thread.",
      "BLACKBOARD_DISCUSSIONS_FALLBACK_UNAVAILABLE",
      1,
      {
        courseId: course.id,
        discussionId: canonicalCourseId(discussionId),
        source: "original-html",
      },
    );
  }
  return {
    confId: catalog.confId,
    discussion,
  };
}

interface BlackboardOriginalDiscussionMessagesParsedPage {
  total: number;
  items: BlackboardDiscussionMessage[];
}

interface BlackboardOriginalDiscussionRepliesParsedPage {
  total: number;
  items: BlackboardDiscussionMessage[];
}

async function listBlackboardOriginalDiscussionMessages(
  adapter: ServiceAdapter,
  course: BlackboardCourse,
  options: {
    discussionId: string;
    groupId?: string;
    userId?: string;
    status?: Exclude<BlackboardDiscussionMessageStatus, "">;
    isRead?: boolean;
    page: number;
    pageSize: number;
    sort?: string;
  },
): Promise<BlackboardDiscussionMessagesPage> {
  if (options.groupId) throw blackboardOriginalDiscussionUnsupportedFilter(course.id, "groupId");
  if (options.userId) throw blackboardOriginalDiscussionUnsupportedFilter(course.id, "userId");
  const discussionId = canonicalCourseId(options.discussionId);
  const context = await getBlackboardOriginalDiscussionContext(adapter, course, discussionId);
  const html = await fetchText(
    adapter,
    buildBlackboardUrl("/webapps/discussionboard/do/forum", {
      action: "list_threads",
      course_id: course.id,
      nav: "discussion_board_entry",
      conf_id: context.confId,
      forum_id: discussionId,
      forum_view: "list",
      showAll: "true",
    }),
    { headers: { accept: "text/html, */*;q=0.1" } },
  );
  const parsed = parseBlackboardOriginalDiscussionMessagesPage(html, {
    discussionId: context.discussion.id,
  });
  if (parsed.total > BLACKBOARD_ORIGINAL_DISCUSSION_MESSAGE_MAX_ITEMS) {
    throw new CliError(
      "Original Blackboard discussion thread fallback would need to load too many HTML rows. Narrow the discussion or use the native Blackboard UI.",
      "BLACKBOARD_DISCUSSIONS_FALLBACK_LIMIT_EXCEEDED",
      1,
      {
        courseId: course.id,
        discussionId,
        total: parsed.total,
        limit: BLACKBOARD_ORIGINAL_DISCUSSION_MESSAGE_MAX_ITEMS,
        source: "original-html",
      },
    );
  }
  if (parsed.total > parsed.items.length) {
    throw new CliError(
      "Original Blackboard discussion thread fallback did not return a complete HTML thread list.",
      "BLACKBOARD_DISCUSSIONS_FALLBACK_UNAVAILABLE",
      1,
      {
        courseId: course.id,
        discussionId,
        total: parsed.total,
        returned: parsed.items.length,
        source: "original-html",
      },
    );
  }
  let messages = parsed.items;
  if (options.status) messages = messages.filter((message) => message.status === options.status);
  if (options.isRead !== undefined) messages = messages.filter((message) => message.isRead === options.isRead);
  const sorted = sortBlackboardOriginalDiscussionMessages(messages, options.sort, course.id, context.discussion.id);
  const offset = (options.page - 1) * options.pageSize;
  const pageItems = sorted.slice(offset, offset + options.pageSize);
  const hydrated = await hydrateBlackboardOriginalDiscussionMessageBodies(
    adapter,
    course.id,
    context.confId,
    context.discussion.id,
    pageItems,
  );
  const hasMore = offset + hydrated.length < sorted.length;
  return {
    generatedAt: new Date().toISOString(),
    courseId: course.id,
    courseCode: course.courseCode,
    courseName: course.name,
    discussion: context.discussion,
    ...(options.status ? { status: options.status } : {}),
    ...(options.isRead !== undefined ? { isRead: options.isRead } : {}),
    ...(options.sort ? { sort: options.sort } : {}),
    page: options.page,
    pageSize: options.pageSize,
    returned: hydrated.length,
    hasMore,
    ...(hasMore ? { nextPage: options.page + 1 } : {}),
    messages: hydrated,
  };
}

function parseBlackboardOriginalDiscussionMessagesPage(
  html: string,
  context: { discussionId: string },
): BlackboardOriginalDiscussionMessagesParsedPage {
  const items = [...html.matchAll(/<tr id="listContainer_row:[^"]+"[\s\S]*?<\/tr>/giu)]
    .map((match) => parseBlackboardOriginalDiscussionMessageRow(match[0], context))
    .filter((message): message is BlackboardDiscussionMessage => message !== null);
  const count = parseBlackboardOriginalDiscussionCount(html);
  return {
    total: count?.total ?? items.length,
    items,
  };
}

function parseBlackboardOriginalDiscussionMessageRow(
  rowHtml: string,
  context: { discussionId: string },
): BlackboardDiscussionMessage | null {
  const subjectMatch = /<a\b[^>]*href="([^"]*action=list_messages[^"]*)"[^>]*>([\s\S]*?)<\/a>/iu.exec(rowHtml);
  if (!subjectMatch) return null;
  let href: URL;
  try {
    href = new URL((subjectMatch[1] ?? "").replace(/&amp;/giu, "&"), BLACKBOARD_BASE);
  } catch {
    return null;
  }
  const messageId = canonicalIdBody(href.searchParams.get("message_id"));
  if (!messageId) return null;
  const dateHtml = originalDiscussionCellHtml(rowHtml, ["Date", "日期"]);
  const dateText = cleanText(dateHtml);
  const postDate = normalizeBlackboardOriginalDiscussionDate(dateText);
  const author = originalDiscussionCellText(rowHtml, ["Author", "作者"]);
  return {
    id: messageId,
    discussionId: canonicalIdBody(href.searchParams.get("forum_id")) || context.discussionId,
    parentId: "",
    threadId: messageId,
    userId: "",
    groupId: "",
    givenName: "",
    familyName: "",
    author: author || "匿名",
    status: normaliseBlackboardOriginalDiscussionStatus(originalDiscussionCellText(rowHtml, ["Status", "状态"])),
    body: "",
    postDate,
    editDate: "",
    createdDate: postDate,
    modifiedDate: postDate,
    isRead: !/\bunreadmessage\b/iu.test(dateHtml),
    subject: cleanText(subjectMatch[2]),
    source: "original-html",
    metadataPartial: true,
    unreadPosts: originalDiscussionNumericCell(rowHtml, ["Unread Posts", "未读帖子"]),
    unreadRepliesToMe: originalDiscussionNumericCell(rowHtml, ["Unread Replies To Me", "未读对我的回复"]),
    totalPosts: originalDiscussionNumericCell(rowHtml, ["Total Posts", "帖子总数"]),
  };
}

async function hydrateBlackboardOriginalDiscussionMessageBodies(
  adapter: ServiceAdapter,
  courseId: string,
  confId: string,
  discussionId: string,
  messages: readonly BlackboardDiscussionMessage[],
): Promise<BlackboardDiscussionMessage[]> {
  const hydrated = messages.map((message) => ({ ...message }));
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(BLACKBOARD_ORIGINAL_DISCUSSION_BODY_CONCURRENCY, hydrated.length) }, async () => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= hydrated.length) return;
      const current = hydrated[index]!;
      const body = await fetchBlackboardOriginalDiscussionMessageBody(
        adapter,
        courseId,
        confId,
        discussionId,
        current.id,
        current.threadId,
      );
      hydrated[index] = {
        ...current,
        body,
      };
    }
  });
  await Promise.all(workers);
  return hydrated;
}

async function fetchBlackboardOriginalDiscussionMessageBody(
  adapter: ServiceAdapter,
  courseId: string,
  confId: string,
  discussionId: string,
  messageId: string,
  threadId: string,
): Promise<string> {
  try {
    const html = await fetchText(
      adapter,
      buildBlackboardUrl("/webapps/discussionboard/do/message", {
        action: "message_frame",
        course_id: canonicalCourseId(courseId),
        nav: "discussion_board_entry",
        conf_id: canonicalCourseId(confId),
        forum_id: canonicalCourseId(discussionId),
        message_id: canonicalCourseId(messageId),
        thread_id: canonicalCourseId(threadId || messageId),
      }),
      { headers: { accept: "text/html, */*;q=0.1" } },
    );
    const body = /<div class="vtbegenerated">([\s\S]*?)<\/div>/iu.exec(html)?.[1]
      ?? /<div class="dbThreadBody"[^>]*>([\s\S]*?)<div class="dbThreadFooter"/iu.exec(html)?.[1]
      ?? "";
    return cleanText(body);
  } catch {
    return "";
  }
}

function blackboardOriginalDiscussionUnsupportedFilter(courseId: string, filter: string): CliError {
  return new CliError(
    "Original Blackboard discussion thread fallback does not support this server-side filter through the HTML path.",
    "BLACKBOARD_DISCUSSIONS_FILTER_UNSUPPORTED",
    2,
    {
      courseId: canonicalCourseId(courseId),
      filter,
      source: "original-html",
      retryPolicy: "DO_NOT_RETRY_AUTOMATICALLY",
    },
  );
}

function originalDiscussionCellHtml(rowHtml: string, labels: readonly string[]): string {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const match = new RegExp(
      `<span class="mobile-table-label">${escaped}:\\s*<\\/span>([\\s\\S]*?)<\\/td>`,
      "iu",
    ).exec(rowHtml);
    if (match?.[1]) return match[1];
  }
  return "";
}

function originalDiscussionCellText(rowHtml: string, labels: readonly string[]): string {
  return cleanText(originalDiscussionCellHtml(rowHtml, labels));
}

function normalizeBlackboardOriginalDiscussionDate(value: string): string {
  const text = collapseWhitespace(value);
  if (!text) return "";
  const direct = Date.parse(text);
  if (Number.isFinite(direct)) return new Date(direct).toISOString();
  const match = /^(\d{2,4})-(\d{1,2})-(\d{1,2})\s+(.+)$/u.exec(text);
  if (!match) return "";
  const rawYear = numberValue(match[1]);
  const month = numberValue(match[2]);
  const day = numberValue(match[3]);
  const remainder = collapseWhitespace(match[4] ?? "");
  const timeMatch = /(\d{1,2})(?::(\d{2}))(?::(\d{2}))?/u.exec(remainder);
  if (!timeMatch) return "";
  let hour = numberValue(timeMatch[1]);
  const minute = numberValue(timeMatch[2]);
  const second = numberValue(timeMatch[3]);
  const normalizedRemainder = remainder.toLocaleLowerCase("en-US");
  const isPm = /下午|pm/u.test(normalizedRemainder);
  const isAm = /上午|am/u.test(normalizedRemainder);
  if (isPm && hour < 12) hour += 12;
  if (isAm && hour === 12) hour = 0;
  const year = match[1].length === 2 ? 2000 + rawYear : rawYear;
  if (!Number.isFinite(year) || year < 2000 || month < 1 || month > 12 || day < 1 || day > 31) return "";
  return new Date(Date.UTC(year, month - 1, day, hour - 8, minute, second)).toISOString();
}

function normaliseBlackboardOriginalDiscussionStatus(value: string): BlackboardDiscussionMessageStatus {
  const normalized = collapseWhitespace(value).toLocaleLowerCase("zh-Hans-CN");
  if (!normalized) return "";
  if (normalized === "published" || normalized === "已发布") return "Published";
  if (normalized === "draft" || normalized === "草稿") return "Draft";
  if (normalized === "deleted" || normalized === "已删除") return "Deleted";
  return "";
}

function sortBlackboardOriginalDiscussionMessages(
  items: readonly BlackboardDiscussionMessage[],
  sort: string | undefined,
  courseId: string,
  discussionId: string,
): BlackboardDiscussionMessage[] {
  if (!sort) return [...items];
  const match = /^([A-Za-z_][A-Za-z0-9_]*)(?:\((desc)\))?$/u.exec(sort.trim());
  if (!match) {
    throw new CliError("Original Blackboard discussion thread sort must use FIELD or FIELD(desc).", "USAGE", 2, {
      courseId,
      discussionId,
      sort,
      source: "original-html",
    });
  }
  const field = match[1];
  const descending = match[2] === "desc";
  const sorted = [...items];
  const direction = descending ? -1 : 1;
  const selector = originalDiscussionMessageSortSelector(field);
  if (!selector) {
    throw new CliError(
      "Original Blackboard discussion thread fallback supports only position, subject, title, author, status, postDate, createdDate, modifiedDate, totalPosts, unreadPosts, or unreadRepliesToMe sorting.",
      "BLACKBOARD_DISCUSSIONS_SORT_UNSUPPORTED",
      2,
      {
        courseId,
        discussionId,
        sort,
        source: "original-html",
        retryPolicy: "DO_NOT_RETRY_AUTOMATICALLY",
      },
    );
  }
  if (selector === "position") return descending ? [...sorted].reverse() : sorted;
  if (selector === "subject" || selector === "author" || selector === "status") {
    sorted.sort((left, right) =>
      direction * (
        (selector === "subject" ? (left.subject ?? "") : left[selector]).localeCompare(
          selector === "subject" ? (right.subject ?? "") : right[selector],
          "zh-Hans-CN",
        )
        || (left.author || left.id).localeCompare(right.author || right.id, "zh-Hans-CN")
      )
    );
    return sorted;
  }
  if (selector === "postDate" || selector === "createdDate" || selector === "modifiedDate") {
    sorted.sort((left, right) =>
      direction * (
        blackboardSortableTimestamp(left[selector]) - blackboardSortableTimestamp(right[selector])
        || (left.subject ?? left.author ?? left.id).localeCompare(right.subject ?? right.author ?? right.id, "zh-Hans-CN")
      )
    );
    return sorted;
  }
  sorted.sort((left, right) =>
    direction * (
      (left[selector] ?? 0) - (right[selector] ?? 0)
      || (left.subject ?? left.author ?? left.id).localeCompare(right.subject ?? right.author ?? right.id, "zh-Hans-CN")
    )
  );
  return sorted;
}

function blackboardSortableTimestamp(value: string): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

interface BlackboardOriginalDiscussionPage {
  confId: string;
  total: number;
  items: BlackboardDiscussion[];
}

function parseBlackboardOriginalDiscussionPage(html: string, responseUrl?: string): BlackboardOriginalDiscussionPage {
  const items = [...html.matchAll(/<tr id="listContainer_row:(_\d+_1)"[\s\S]*?<\/tr>/giu)]
    .map((match) => parseBlackboardOriginalDiscussionRow(match[0]))
    .filter((discussion): discussion is BlackboardDiscussion => discussion !== null);
  const count = parseBlackboardOriginalDiscussionCount(html);
  const confId = parseBlackboardOriginalDiscussionConfId(html, responseUrl);
  return {
    confId,
    total: count?.total ?? items.length,
    items,
  };
}

function parseBlackboardOriginalDiscussionConfId(html: string, responseUrl?: string): string {
  const hidden = /<input\b[^>]*type="hidden"[^>]*name="conf_id"[^>]*value="([^"]+)"[^>]*>/iu.exec(html)?.[1];
  const linked = /[?&]conf_id=(_\d+_1)\b/iu.exec(html)?.[1];
  let resolvedFromUrl = "";
  if (responseUrl) {
    try {
      resolvedFromUrl = new URL(responseUrl, BLACKBOARD_BASE).searchParams.get("conf_id") ?? "";
    } catch {
      resolvedFromUrl = "";
    }
  }
  const confId = hidden || linked || resolvedFromUrl || "";
  return canonicalCourseId(confId);
}

function parseBlackboardOriginalDiscussionCount(
  html: string,
): { start: number; end: number; total: number } | null {
  const match = /Displaying\s*<strong>(\d+)<\/strong>\s*to\s*<strong>(\d+)<\/strong>\s*of\s*<strong>(\d+)<\/strong>\s*items/iu.exec(html);
  if (!match) return null;
  return {
    start: numberValue(match[1]),
    end: numberValue(match[2]),
    total: numberValue(match[3]),
  };
}

function parseBlackboardOriginalDiscussionRow(rowHtml: string): BlackboardDiscussion | null {
  const hrefMatch = /<a\b[^>]*href="([^"]*action=list_threads[^"]*)"[^>]*>([\s\S]*?)<\/a>/iu.exec(rowHtml);
  let forumId = "";
  if (hrefMatch?.[1]) {
    try {
      forumId = canonicalIdBody(new URL((hrefMatch[1] ?? "").replace(/&amp;/giu, "&"), BLACKBOARD_BASE).searchParams.get("forum_id"));
    } catch {
      forumId = "";
    }
  }
  const rowId = /<tr id="listContainer_row:(_\d+_1)"/iu.exec(rowHtml)?.[1];
  const discussionId = forumId || canonicalIdBody(rowId);
  if (!discussionId) return null;
  const title = cleanText(hrefMatch?.[2] ?? /<span class="[^"]*\bdbheading\b[^"]*">\s*<a\b[^>]*>([\s\S]*?)<\/a>/iu.exec(rowHtml)?.[1]);
  if (!title) return null;
  const description = cleanText(/<div class="item-description">([\s\S]*?)<\/div>/iu.exec(rowHtml)?.[1]);
  return {
    id: discussionId,
    title,
    available: true,
    gradable: false,
    groupDiscussion: false,
    createdDate: "",
    modifiedDate: "",
    source: "original-html",
    metadataPartial: true,
    ...(description ? { description } : {}),
    totalPosts: originalDiscussionNumericCell(rowHtml, "Total Posts"),
    unreadPosts: originalDiscussionNumericCell(rowHtml, "Unread Posts"),
    unreadRepliesToMe: originalDiscussionNumericCell(rowHtml, "Unread Replies To Me"),
    totalParticipants: originalDiscussionNumericCell(rowHtml, "Total Participants"),
  };
}

function originalDiscussionNumericCell(rowHtml: string, label: string | readonly string[]): number {
  const labels = Array.isArray(label) ? label : [label];
  return numberValue(/\d+/u.exec(originalDiscussionCellText(rowHtml, labels))?.[0]);
}

function normaliseLookupTextForBlackboardFallback(value: string): string {
  return collapseWhitespace(value).toLocaleLowerCase("zh-Hans-CN");
}

function sortBlackboardOriginalDiscussions(
  items: readonly BlackboardDiscussion[],
  sort: string | undefined,
  courseId: string,
): BlackboardDiscussion[] {
  if (!sort) return [...items];
  const match = /^([A-Za-z_][A-Za-z0-9_]*)(?:\((desc)\))?$/u.exec(sort.trim());
  if (!match) {
    throw new CliError("Original Blackboard discussion forum sort must use FIELD or FIELD(desc).", "USAGE", 2, {
      courseId,
      sort,
      source: "original-html",
    });
  }
  const field = match[1];
  const descending = match[2] === "desc";
  const sorted = [...items];
  const direction = descending ? -1 : 1;
  const numericField = originalDiscussionSortSelector(field);
  if (numericField === "title") {
    sorted.sort((left, right) => direction * left.title.localeCompare(right.title, "zh-Hans-CN"));
    return sorted;
  }
  if (numericField === "position") return descending ? [...sorted].reverse() : sorted;
  if (!numericField) {
    throw new CliError(
      "Original Blackboard discussion forum fallback supports only title, totalPosts, unreadPosts, unreadRepliesToMe, totalParticipants, or position sorting.",
      "BLACKBOARD_DISCUSSIONS_SORT_UNSUPPORTED",
      2,
      {
        courseId,
        sort,
        source: "original-html",
        retryPolicy: "DO_NOT_RETRY_AUTOMATICALLY",
      },
    );
  }
  sorted.sort((left, right) =>
    direction * (
      (left[numericField] ?? 0) - (right[numericField] ?? 0)
      || left.title.localeCompare(right.title, "zh-Hans-CN")
    )
  );
  return sorted;
}

function originalDiscussionSortSelector(
  field: string,
): "title" | "position" | "totalPosts" | "unreadPosts" | "unreadRepliesToMe" | "totalParticipants" | null {
  if (field === "title") return "title";
  if (field === "position") return "position";
  if (field === "totalPosts" || field === "total_posts") return "totalPosts";
  if (field === "unreadPosts" || field === "unread_posts") return "unreadPosts";
  if (field === "unreadRepliesToMe" || field === "unread_replies_to_me_posts") return "unreadRepliesToMe";
  if (field === "totalParticipants" || field === "total_participants") return "totalParticipants";
  return null;
}

function originalDiscussionMessageSortSelector(
  field: string,
): "position" | "subject" | "author" | "status" | "postDate" | "createdDate" | "modifiedDate" | "totalPosts" | "unreadPosts" | "unreadRepliesToMe" | null {
  if (field === "position") return "position";
  if (field === "subject" || field === "title") return "subject";
  if (field === "author") return "author";
  if (field === "status") return "status";
  if (field === "date" || field === "postDate" || field === "post_date") return "postDate";
  if (field === "createdDate" || field === "created_date") return "createdDate";
  if (field === "modifiedDate" || field === "modified_date") return "modifiedDate";
  if (field === "totalPosts" || field === "total_posts") return "totalPosts";
  if (field === "unreadPosts" || field === "unread_posts") return "unreadPosts";
  if (field === "unreadRepliesToMe" || field === "unread_replies_to_me" || field === "unread_replies_to_me_posts") return "unreadRepliesToMe";
  return null;
}

export async function getBlackboardDiscussion(
  adapter: ServiceAdapter,
  courseId: string,
  discussionId: string,
): Promise<BlackboardDiscussion> {
  try {
    const raw = await fetchJson<unknown>(
      adapter,
      buildBlackboardUrl(
        `/learn/api/public/v1/courses/${canonicalCourseId(courseId)}/discussions/${canonicalCourseId(discussionId)}`,
      ),
    );
    return normaliseBlackboardDiscussion(raw);
  } catch (error) {
    throw normalizeBlackboardDiscussionUnsupported(error, {
      operation: "get",
      courseId,
      discussionId,
    });
  }
}

export async function listBlackboardDiscussionGroups(
  adapter: ServiceAdapter,
  options: {
    courseId: string;
    discussionId: string;
    page?: number;
    pageSize?: number;
    sort?: string;
  },
): Promise<BlackboardDiscussionGroupsPage> {
  try {
    const page = validatedBlackboardPage(options.page);
    const pageSize = validatedBlackboardPageSize(options.pageSize);
    const courseId = canonicalCourseId(options.courseId);
    const discussionId = canonicalCourseId(options.discussionId);
    const sort = options.sort?.trim() || undefined;
    const query: Record<string, string> = {
      offset: String((page - 1) * pageSize),
      limit: String(pageSize),
    };
    if (sort) query.sort = sort;
    const [course, discussion, response] = await Promise.all([
      resolveBlackboardCourseContext(adapter, courseId),
      getBlackboardDiscussion(adapter, courseId, discussionId),
      fetchBlackboardPageChunk(
        adapter,
        buildBlackboardUrl(`/learn/api/public/v1/courses/${courseId}/discussions/${discussionId}/groups`, query),
        { absolute: true },
      ),
    ]);
    const groups = response.results.map((item) => normaliseBlackboardDiscussionGroup(item));
    return {
      generatedAt: new Date().toISOString(),
      courseId: course.id,
      courseCode: course.courseCode,
      courseName: course.name,
      discussion,
      ...(sort ? { sort } : {}),
      page,
      pageSize,
      returned: groups.length,
      hasMore: Boolean(response.nextPage),
      ...(response.nextPage ? { nextPage: page + 1 } : {}),
      groups,
    };
  } catch (error) {
    throw normalizeBlackboardDiscussionUnsupported(error, {
      operation: "list-groups",
      courseId: options.courseId,
      discussionId: options.discussionId,
    });
  }
}

export async function getBlackboardDiscussionMessages(
  adapter: ServiceAdapter,
  options: {
    courseId: string;
    discussionId: string;
    groupId?: string;
    userId?: string;
    status?: Exclude<BlackboardDiscussionMessageStatus, "">;
    isRead?: boolean;
    page?: number;
    pageSize?: number;
    sort?: string;
  },
): Promise<BlackboardDiscussionMessagesPage> {
  const page = validatedBlackboardPage(options.page);
  const pageSize = validatedBlackboardPageSize(options.pageSize);
  const courseId = canonicalCourseId(options.courseId);
  const discussionId = canonicalCourseId(options.discussionId);
  const groupId = options.groupId ? canonicalCourseId(options.groupId) : undefined;
  const userId = options.userId ? canonicalCourseId(options.userId) : undefined;
  const sort = options.sort?.trim() || undefined;
  try {
    const query: Record<string, string> = {
      offset: String((page - 1) * pageSize),
      limit: String(pageSize),
    };
    if (groupId) query.groupId = groupId;
    if (userId) query.userId = userId;
    if (options.status) query.status = options.status;
    if (options.isRead !== undefined) query.isRead = options.isRead ? "true" : "false";
    if (sort) query.sort = sort;
    const course = await resolveBlackboardCourseContext(adapter, courseId);
    const [discussion, response] = await Promise.all([
      getBlackboardDiscussion(adapter, courseId, discussionId),
      fetchBlackboardPageChunk(
        adapter,
        buildBlackboardUrl(`/learn/api/public/v1/courses/${courseId}/discussions/${discussionId}/messages`, query),
        { absolute: true },
      ),
    ]);
    const messages = response.results.map((item) => normaliseBlackboardDiscussionMessage(item));
    return {
      generatedAt: new Date().toISOString(),
      courseId: course.id,
      courseCode: course.courseCode,
      courseName: course.name,
      discussion,
      ...(groupId ? { groupId } : {}),
      ...(userId ? { userId } : {}),
      ...(options.status ? { status: options.status } : {}),
      ...(options.isRead !== undefined ? { isRead: options.isRead } : {}),
      ...(sort ? { sort } : {}),
      page,
      pageSize,
      returned: messages.length,
      hasMore: Boolean(response.nextPage),
      ...(response.nextPage ? { nextPage: page + 1 } : {}),
      messages,
    };
  } catch (error) {
    if (
      isBlackboardOriginalDiscussionUnsupported(error)
      || (sort && isBlackboardDiscussionSortRejected(error))
    ) {
      try {
        const course = await resolveBlackboardCourseContext(adapter, courseId);
        return listBlackboardOriginalDiscussionMessages(adapter, course, {
          discussionId,
          ...(groupId ? { groupId } : {}),
          ...(userId ? { userId } : {}),
          ...(options.status ? { status: options.status } : {}),
          ...(options.isRead !== undefined ? { isRead: options.isRead } : {}),
          ...(sort ? { sort } : {}),
          page,
          pageSize,
        });
      } catch (fallbackError) {
        if (isBlackboardOriginalDiscussionUnsupported(error)) throw fallbackError;
      }
    }
    throw normalizeBlackboardDiscussionUnsupported(error, {
      operation: "list-messages",
      courseId: options.courseId,
      discussionId: options.discussionId,
    });
  }
}

export async function listBlackboardDiscussionReplies(
  adapter: ServiceAdapter,
  options: {
    courseId: string;
    discussionId: string;
    messageId: string;
    groupId?: string;
    userId?: string;
    status?: Exclude<BlackboardDiscussionMessageStatus, "">;
    isRead?: boolean;
    page?: number;
    pageSize?: number;
    sort?: string;
  },
): Promise<BlackboardDiscussionRepliesPage> {
  try {
    const page = validatedBlackboardPage(options.page);
    const pageSize = validatedBlackboardPageSize(options.pageSize);
    const course = await resolveBlackboardCourseContext(adapter, options.courseId);
    const discussionId = canonicalCourseId(options.discussionId);
    const messageId = canonicalCourseId(options.messageId);
    const groupId = options.groupId ? canonicalCourseId(options.groupId) : undefined;
    const userId = options.userId ? canonicalCourseId(options.userId) : undefined;
    const sort = options.sort?.trim() || undefined;
    const query: Record<string, string> = {
      offset: String((page - 1) * pageSize),
      limit: String(pageSize),
    };
    if (groupId) query.groupId = groupId;
    if (userId) query.userId = userId;
    if (options.status) query.status = options.status;
    if (options.isRead !== undefined) query.isRead = options.isRead ? "true" : "false";
    if (sort) query.sort = sort;
    const response = await fetchBlackboardPageChunk(
      adapter,
      buildBlackboardUrl(`/learn/api/public/v1/courses/${course.id}/discussions/${discussionId}/messages/${messageId}/replies`, query),
      { absolute: true },
    );
    const replies = response.results.map((item) => normaliseBlackboardDiscussionMessage(item));
    return {
      generatedAt: new Date().toISOString(),
      courseId: course.id,
      courseCode: course.courseCode,
      courseName: course.name,
      discussionId: canonicalIdBody(discussionId),
      messageId: canonicalIdBody(messageId),
      ...(groupId ? { groupId } : {}),
      ...(userId ? { userId } : {}),
      ...(options.status ? { status: options.status } : {}),
      ...(options.isRead !== undefined ? { isRead: options.isRead } : {}),
      ...(sort ? { sort } : {}),
      page,
      pageSize,
      returned: replies.length,
      hasMore: Boolean(response.nextPage),
      ...(response.nextPage ? { nextPage: page + 1 } : {}),
      replies,
    };
  } catch (error) {
    if (
      isBlackboardOriginalDiscussionUnsupported(error)
      || (options.sort?.trim() && isBlackboardDiscussionSortRejected(error))
    ) {
      try {
        const course = await resolveBlackboardCourseContext(adapter, options.courseId);
        return listBlackboardOriginalDiscussionReplies(adapter, course, {
          discussionId: options.discussionId,
          messageId: options.messageId,
          ...(options.groupId ? { groupId: options.groupId } : {}),
          ...(options.userId ? { userId: options.userId } : {}),
          ...(options.status ? { status: options.status } : {}),
          ...(options.isRead !== undefined ? { isRead: options.isRead } : {}),
          ...(options.sort?.trim() ? { sort: options.sort.trim() } : {}),
          page: validatedBlackboardPage(options.page),
          pageSize: validatedBlackboardPageSize(options.pageSize),
        });
      } catch (fallbackError) {
        throw fallbackError;
      }
    }
    throw normalizeBlackboardDiscussionUnsupported(error, {
      operation: "list-replies",
      courseId: options.courseId,
      discussionId: options.discussionId,
      messageId: options.messageId,
    });
  }
}

async function listBlackboardOriginalDiscussionReplies(
  adapter: ServiceAdapter,
  course: BlackboardCourse,
  options: {
    discussionId: string;
    messageId: string;
    groupId?: string;
    userId?: string;
    status?: Exclude<BlackboardDiscussionMessageStatus, "">;
    isRead?: boolean;
    page: number;
    pageSize: number;
    sort?: string;
  },
): Promise<BlackboardDiscussionRepliesPage> {
  if (options.groupId) throw blackboardOriginalDiscussionUnsupportedFilter(course.id, "groupId");
  if (options.userId) throw blackboardOriginalDiscussionUnsupportedFilter(course.id, "userId");
  const discussionId = canonicalCourseId(options.discussionId);
  const messageId = canonicalCourseId(options.messageId);
  const context = await getBlackboardOriginalDiscussionContext(adapter, course, discussionId);
  const rootMessageId = canonicalIdBody(messageId);
  const html = await fetchText(
    adapter,
    buildBlackboardUrl("/webapps/discussionboard/do/message", {
      action: "list_messages",
      course_id: course.id,
      nav: "discussion_board_entry",
      conf_id: context.confId,
      forum_id: discussionId,
      message_id: messageId,
      thread_id: messageId,
    }),
    { headers: { accept: "text/html, */*;q=0.1" } },
  );
  const parsed = parseBlackboardOriginalDiscussionRepliesPage(html, {
    discussionId: context.discussion.id,
    threadId: rootMessageId || canonicalIdBody(messageId),
    rootMessageId,
  });
  if (parsed.total > BLACKBOARD_ORIGINAL_DISCUSSION_MESSAGE_MAX_ITEMS) {
    throw new CliError(
      "Original Blackboard discussion reply fallback would need to load too many HTML rows. Narrow the thread or use the native Blackboard UI.",
      "BLACKBOARD_DISCUSSIONS_FALLBACK_LIMIT_EXCEEDED",
      1,
      {
        courseId: course.id,
        discussionId,
        messageId,
        total: parsed.total,
        limit: BLACKBOARD_ORIGINAL_DISCUSSION_MESSAGE_MAX_ITEMS,
        source: "original-html",
      },
    );
  }
  if (parsed.total > parsed.items.length) {
    throw new CliError(
      "Original Blackboard discussion reply fallback did not return a complete HTML reply list.",
      "BLACKBOARD_DISCUSSIONS_FALLBACK_UNAVAILABLE",
      1,
      {
        courseId: course.id,
        discussionId,
        messageId,
        total: parsed.total,
        returned: parsed.items.length,
        source: "original-html",
      },
    );
  }
  let replies = parsed.items.filter((item) => item.id !== rootMessageId);
  if (options.status) replies = replies.filter((reply) => reply.status === options.status);
  if (options.isRead !== undefined) replies = replies.filter((reply) => reply.isRead === options.isRead);
  const sorted = sortBlackboardOriginalDiscussionMessages(replies, options.sort, course.id, context.discussion.id);
  const offset = (options.page - 1) * options.pageSize;
  const pageItems = sorted.slice(offset, offset + options.pageSize);
  const hydrated = await hydrateBlackboardOriginalDiscussionMessageBodies(
    adapter,
    course.id,
    context.confId,
    context.discussion.id,
    pageItems,
  );
  const hasMore = offset + hydrated.length < sorted.length;
  return {
    generatedAt: new Date().toISOString(),
    courseId: course.id,
    courseCode: course.courseCode,
    courseName: course.name,
    discussionId: context.discussion.id,
    messageId: rootMessageId,
    ...(options.status ? { status: options.status } : {}),
    ...(options.isRead !== undefined ? { isRead: options.isRead } : {}),
    ...(options.sort ? { sort: options.sort } : {}),
    page: options.page,
    pageSize: options.pageSize,
    returned: hydrated.length,
    hasMore,
    ...(hasMore ? { nextPage: options.page + 1 } : {}),
    replies: hydrated,
  };
}

function parseBlackboardOriginalDiscussionRepliesPage(
  html: string,
  context: { discussionId: string; threadId: string; rootMessageId: string },
): BlackboardOriginalDiscussionRepliesParsedPage {
  const items = [...html.matchAll(/<tr id="listContainer_row:[^"]+"[\s\S]*?<\/tr>/giu)]
    .map((match) => parseBlackboardOriginalDiscussionReplyRow(match[0], context))
    .filter((message): message is BlackboardDiscussionMessage => message !== null);
  const count = parseBlackboardOriginalDiscussionCount(html);
  return {
    total: count?.total ?? items.length,
    items,
  };
}

function parseBlackboardOriginalDiscussionReplyRow(
  rowHtml: string,
  context: { discussionId: string; threadId: string; rootMessageId: string },
): BlackboardDiscussionMessage | null {
  const subjectMatch = /<a\b[^>]*href="([^"]*action=(?:list_messages|message_frame)[^"]*message_id=[^"]*)"[^>]*>([\s\S]*?)<\/a>/iu.exec(rowHtml);
  if (!subjectMatch) return null;
  let href: URL;
  try {
    href = new URL((subjectMatch[1] ?? "").replace(/&amp;/giu, "&"), BLACKBOARD_BASE);
  } catch {
    return null;
  }
  const messageId = canonicalIdBody(href.searchParams.get("message_id"));
  if (!messageId) return null;
  const dateHtml = originalDiscussionCellHtml(rowHtml, ["Date", "日期", "Posted Date", "发布日期"]);
  const dateText = cleanText(dateHtml);
  const postDate = normalizeBlackboardOriginalDiscussionDate(dateText);
  const author = originalDiscussionCellText(rowHtml, ["Author", "作者"]);
  const parentId = canonicalIdBody(href.searchParams.get("parent_id")) || (messageId === context.rootMessageId ? "" : context.rootMessageId);
  return {
    id: messageId,
    discussionId: canonicalIdBody(href.searchParams.get("forum_id")) || context.discussionId,
    parentId,
    threadId: canonicalIdBody(href.searchParams.get("thread_id")) || context.threadId || context.rootMessageId || messageId,
    userId: "",
    groupId: "",
    givenName: "",
    familyName: "",
    author: author || "匿名",
    status: normaliseBlackboardOriginalDiscussionStatus(originalDiscussionCellText(rowHtml, ["Status", "状态"])),
    body: "",
    postDate,
    editDate: "",
    createdDate: postDate,
    modifiedDate: postDate,
    isRead: !/\bunreadmessage\b/iu.test(dateHtml),
    subject: cleanText(subjectMatch[2]),
    source: "original-html",
    metadataPartial: true,
    unreadPosts: originalDiscussionNumericCell(rowHtml, ["Unread Posts", "未读帖子"]),
    unreadRepliesToMe: originalDiscussionNumericCell(rowHtml, ["Unread Replies To Me", "未读对我的回复"]),
    totalPosts: originalDiscussionNumericCell(rowHtml, ["Total Posts", "帖子总数"]),
  };
}

export async function createBlackboardDiscussionMessage(
  adapter: ServiceAdapter,
  courseId: string,
  discussionId: string,
  input: BlackboardDiscussionMessageWriteInput,
): Promise<BlackboardDiscussionMessage> {
  try {
    const raw = await fetchJson<unknown>(
      adapter,
      buildBlackboardUrl(
        `/learn/api/public/v1/courses/${canonicalCourseId(courseId)}/discussions/${canonicalCourseId(discussionId)}/messages`,
      ),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(blackboardDiscussionWritePayload(input)),
      },
    );
    return normaliseBlackboardDiscussionMessage(raw);
  } catch (error) {
    throw normalizeBlackboardDiscussionUnsupported(error, {
      operation: "create-message",
      courseId,
      discussionId,
    });
  }
}

export async function createBlackboardDiscussionReply(
  adapter: ServiceAdapter,
  courseId: string,
  discussionId: string,
  messageId: string,
  input: BlackboardDiscussionMessageWriteInput,
): Promise<BlackboardDiscussionMessage> {
  try {
    const raw = await fetchJson<unknown>(
      adapter,
      buildBlackboardUrl(
        `/learn/api/public/v1/courses/${canonicalCourseId(courseId)}/discussions/${canonicalCourseId(discussionId)}/messages/${canonicalCourseId(messageId)}/replies`,
      ),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(blackboardDiscussionWritePayload(input)),
      },
    );
    return normaliseBlackboardDiscussionMessage(raw);
  } catch (error) {
    throw normalizeBlackboardDiscussionUnsupported(error, {
      operation: "create-reply",
      courseId,
      discussionId,
      messageId,
    });
  }
}

export async function createBlackboardCourseMessage(
  adapter: ServiceAdapter,
  courseId: string,
  input: BlackboardCourseMessageWriteInput,
): Promise<BlackboardCourseMessage> {
  const raw = await fetchJson<unknown>(
    adapter,
    buildBlackboardUrl(`/learn/api/public/v1/courses/${canonicalCourseId(courseId)}/messages`),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(blackboardCourseMessageWritePayload(input)),
    },
  );
  return normaliseBlackboardCourseMessage(raw);
}

export async function listBlackboardCourseMessageFolders(
  adapter: ServiceAdapter,
  options: {
    courseId: string;
    page?: number;
    pageSize?: number;
  },
): Promise<BlackboardCourseMessageFoldersPage> {
  const page = validatedBlackboardPage(options.page);
  const pageSize = validatedBlackboardPageSize(options.pageSize);
  const course = await resolveBlackboardCourseContext(adapter, options.courseId);
  const response = await fetchBlackboardPageChunk(
    adapter,
    buildBlackboardUrl(`/learn/api/public/v1/courses/${course.id}/messages/folders`, {
      offset: String((page - 1) * pageSize),
      limit: String(pageSize),
    }),
    { absolute: true },
  );
  const folders = response.results.map((item) => normaliseBlackboardCourseMessageFolder(item));
  return {
    generatedAt: new Date().toISOString(),
    courseId: course.id,
    courseCode: course.courseCode,
    courseName: course.name,
    page,
    pageSize,
    returned: folders.length,
    hasMore: Boolean(response.nextPage),
    ...(response.nextPage ? { nextPage: page + 1 } : {}),
    folders,
  };
}

export async function listBlackboardCourseMessages(
  adapter: ServiceAdapter,
  options: {
    courseId: string;
    folderType?: Exclude<BlackboardCourseMessageFolderType, "">;
    folderName?: string;
    page?: number;
    pageSize?: number;
    sort?: string;
  },
): Promise<BlackboardCourseMessagesPage> {
  const page = validatedBlackboardPage(options.page);
  const pageSize = validatedBlackboardPageSize(options.pageSize);
  const course = await resolveBlackboardCourseContext(adapter, options.courseId);
  const folderName = options.folderName?.trim() || undefined;
  const sort = options.sort?.trim() || undefined;
  const query: Record<string, string> = {
    offset: String((page - 1) * pageSize),
    limit: String(pageSize),
  };
  if (options.folderType) query.folderType = options.folderType;
  if (folderName) query.folderName = folderName;
  if (sort) query.sort = sort;
  query.expand = "sender";
  const response = await fetchBlackboardPageChunk(
    adapter,
    buildBlackboardUrl(`/learn/api/public/v1/courses/${course.id}/messages`, query),
    { absolute: true },
  );
  const messages = response.results.map((item) => normaliseBlackboardCourseMessage(item));
  return {
    generatedAt: new Date().toISOString(),
    courseId: course.id,
    courseCode: course.courseCode,
    courseName: course.name,
    ...(options.folderType ? { folderType: options.folderType } : {}),
    ...(folderName ? { folderName } : {}),
    ...(sort ? { sort } : {}),
    page,
    pageSize,
    returned: messages.length,
    hasMore: Boolean(response.nextPage),
    ...(response.nextPage ? { nextPage: page + 1 } : {}),
    messages,
  };
}

export async function listBlackboardCourseMessageParticipants(
  adapter: ServiceAdapter,
  options: {
    courseId: string;
    messageId: string;
    participationType?: Exclude<BlackboardCourseMessageParticipationType, "">;
    page?: number;
    pageSize?: number;
    sort?: string;
  },
): Promise<BlackboardCourseMessageParticipantsPage> {
  const page = validatedBlackboardPage(options.page);
  const pageSize = validatedBlackboardPageSize(options.pageSize);
  const course = await resolveBlackboardCourseContext(adapter, options.courseId);
  const messageId = canonicalCourseId(options.messageId);
  const sort = options.sort?.trim() || undefined;
  const query: Record<string, string> = {
    offset: String((page - 1) * pageSize),
    limit: String(pageSize),
  };
  if (options.participationType) query.participationType = options.participationType;
  if (sort) query.sort = sort;
  query.expand = "user";
  const response = await fetchBlackboardPageChunk(
    adapter,
    buildBlackboardUrl(`/learn/api/public/v1/courses/${course.id}/messages/${messageId}/participants`, query),
    { absolute: true },
  );
  const participants = response.results.map((item) => normaliseBlackboardCourseMessageParticipant(item));
  return {
    generatedAt: new Date().toISOString(),
    courseId: course.id,
    courseCode: course.courseCode,
    courseName: course.name,
    messageId: canonicalIdBody(messageId),
    ...(options.participationType ? { participationType: options.participationType } : {}),
    ...(sort ? { sort } : {}),
    page,
    pageSize,
    returned: participants.length,
    hasMore: Boolean(response.nextPage),
    ...(response.nextPage ? { nextPage: page + 1 } : {}),
    participants,
  };
}

export async function listBlackboardCourseRoster(
  adapter: ServiceAdapter,
  options: {
    courseId: string;
    role?: string;
    availability?: Exclude<BlackboardCourseMembershipAvailability, "">;
    page?: number;
    pageSize?: number;
    sort?: string;
  },
): Promise<BlackboardCourseRosterPage> {
  const page = validatedBlackboardPage(options.page);
  const pageSize = validatedBlackboardPageSize(options.pageSize);
  const course = await resolveBlackboardCourseContext(adapter, options.courseId);
  const role = options.role?.trim() || undefined;
  const sort = options.sort?.trim() || undefined;
  const query: Record<string, string> = {
    offset: String((page - 1) * pageSize),
    limit: String(pageSize),
  };
  if (role) query.role = role;
  if (options.availability) query["availability.available"] = options.availability;
  if (sort) query.sort = sort;
  query.expand = "user";
  const response = await fetchBlackboardPageChunk(
    adapter,
    buildBlackboardUrl(`/learn/api/public/v1/courses/${course.id}/users`, query),
    { absolute: true },
  );
  const memberships = response.results.map((item) => normaliseBlackboardCourseMembership(item));
  return {
    generatedAt: new Date().toISOString(),
    courseId: course.id,
    courseCode: course.courseCode,
    courseName: course.name,
    ...(role ? { role } : {}),
    ...(options.availability ? { availability: options.availability } : {}),
    ...(sort ? { sort } : {}),
    page,
    pageSize,
    returned: memberships.length,
    hasMore: Boolean(response.nextPage),
    ...(response.nextPage ? { nextPage: page + 1 } : {}),
    memberships,
  };
}

export async function listBlackboardAttempts(
  adapter: ServiceAdapter,
  courseId: string,
  columnId: string,
  options: { status?: BlackboardAttemptStatus } = {},
): Promise<BlackboardAttempt[]> {
  const user = await getBlackboardUser(adapter);
  return listBlackboardAttemptsForUser(adapter, courseId, columnId, user.id, options);
}

async function listBlackboardAttemptsForUser(
  adapter: ServiceAdapter,
  courseId: string,
  columnId: string,
  userId: string,
  options: { status?: BlackboardAttemptStatus } = {},
): Promise<BlackboardAttempt[]> {
  const url = buildBlackboardUrl(`/learn/api/public/v2/courses/${canonicalCourseId(courseId)}/gradebook/columns/${canonicalCourseId(columnId)}/attempts`, {
    userId,
    ...(options.status ? { attemptStatuses: options.status } : {}),
  });
  const page = await fetchBlackboardPage(adapter, url, { absolute: true, onInitialNotFound: async () => {
    const assignment = await getBlackboardAssignment(adapter, courseId, columnId);
    if (assignment.id !== canonicalIdBody(columnId) || !assignment.contentId
      || assignment.availability !== "Yes" || assignment.grading.type !== "Attempts"
      || assignment.scoreProviderHandle !== "resource/x-bb-assignment") return false;
    const content = await getBlackboardContentItem(adapter, courseId, assignment.contentId);
    if (content.handler !== "resource/x-bb-assignment") return false;
    return confirmBlackboardNoAttempts(adapter, { courseId, contentId: assignment.contentId });
  } });
  return page.results.map((item) => normaliseBlackboardAttempt(item));
}

export async function listBlackboardAssignmentsWithAttempts(
  adapter: ServiceAdapter,
  courseId: string,
): Promise<BlackboardAssignmentsWithAttemptsReport> {
  const canonical = canonicalCourseId(courseId);
  const assignments = await listBlackboardAssignments(adapter, canonical);
  if (assignments.length === 0) {
    return {
      generatedAt: new Date().toISOString(),
      courseId: canonical,
      totalAssignments: 0,
      completedAttemptFetches: 0,
      attemptedAssignments: 0,
      partial: false,
      assignments: [],
      failures: [],
    };
  }

  const user = await getBlackboardUser(adapter);
  const items: BlackboardAssignmentWithAttempts[] = [];
  const failures: BlackboardOperationFailure[] = [];
  let completedAttemptFetches = 0;

  for (const assignment of assignments) {
    try {
      const attempts = await listBlackboardAttemptsForUser(adapter, canonical, assignment.id, user.id);
      const attemptSummary = summariseBlackboardAssignmentAttempts(attempts);
      completedAttemptFetches += 1;
      items.push({ assignment, attemptSummary });
    } catch (error) {
      items.push({ assignment });
      failures.push(blackboardOperationFailure(error, {
        stage: "attempts",
        courseId: canonical,
        contentId: assignment.contentId,
        columnId: assignment.id,
      }));
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    courseId: canonical,
    totalAssignments: assignments.length,
    completedAttemptFetches,
    attemptedAssignments: items.filter((item) => (item.attemptSummary?.totalAttempts ?? 0) > 0).length,
    partial: failures.length > 0,
    assignments: items,
    failures,
  };
}

export async function listBlackboardAssignmentsAcrossCourses(
  adapter: ServiceAdapter,
  options: {
    courseQuery?: string;
    withAttempts?: boolean;
    submissionState?: BlackboardAssignmentSubmissionState;
  } = {},
): Promise<BlackboardAssignmentsAggregateReport> {
  const withAttempts = options.withAttempts === true || options.submissionState !== undefined;
  const report: BlackboardAssignmentsAggregateReport = {
    generatedAt: new Date().toISOString(),
    ...(options.courseQuery ? { courseQuery: options.courseQuery } : {}),
    withAttempts,
    ...(options.submissionState ? { submissionState: options.submissionState } : {}),
    coursesMatched: 0,
    coursesScanned: 0,
    totalAssignments: 0,
    completedAttemptFetches: 0,
    attemptedAssignments: 0,
    partial: false,
    assignments: [],
    failures: [],
  };
  const courses = await listBlackboardCoursesForAggregation(adapter, report.failures, options.courseQuery);
  report.coursesMatched = courses.length;
  const user = withAttempts ? await getBlackboardUser(adapter) : undefined;
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
    report.totalAssignments += assignments.length;
    for (const assignment of assignments) {
      if (!user) {
        report.assignments.push({
          courseId: course.id,
          courseCode: course.courseCode,
          courseName: course.name,
          assignment,
        });
        continue;
      }
      try {
        const attempts = await listBlackboardAttemptsForUser(adapter, course.id, assignment.id, user.id);
        const attemptSummary = summariseBlackboardAssignmentAttempts(attempts);
        report.completedAttemptFetches += 1;
        if (options.submissionState && attemptSummary.state !== options.submissionState) continue;
        report.assignments.push({
          courseId: course.id,
          courseCode: course.courseCode,
          courseName: course.name,
          assignment,
          attemptSummary,
        });
      } catch (error) {
        report.failures.push(
          blackboardOperationFailure(error, {
            stage: "attempts",
            courseId: course.id,
            courseCode: course.courseCode,
            courseName: course.name,
            contentId: assignment.contentId,
            columnId: assignment.id,
          }),
        );
        if (options.submissionState) continue;
        report.assignments.push({
          courseId: course.id,
          courseCode: course.courseCode,
          courseName: course.name,
          assignment,
        });
      }
    }
  }
  report.partial = report.failures.length > 0;
  report.attemptedAssignments = report.assignments.filter((item) => (item.attemptSummary?.totalAttempts ?? 0) > 0).length;
  report.assignments.sort(compareBlackboardScopedAssignments);
  return report;
}

export async function listBlackboardGrades(
  adapter: ServiceAdapter,
  options: {
    courseQuery?: string;
    submissionState?: Exclude<BlackboardAssignmentSubmissionState, "not_attempted">;
    limit?: number;
  } = {},
): Promise<BlackboardGradesReport> {
  const aggregate = await listBlackboardAssignmentsAcrossCourses(adapter, {
    ...(options.courseQuery ? { courseQuery: options.courseQuery } : {}),
    withAttempts: true,
    ...(options.submissionState ? { submissionState: options.submissionState } : {}),
  });
  const grades = aggregate.assignments
    .filter((item): item is BlackboardGradeEntry => (item.attemptSummary?.totalAttempts ?? 0) > 0)
    .sort(compareBlackboardGradeEntries);
  const limited = options.limit === undefined ? grades : grades.slice(0, options.limit);
  return {
    generatedAt: aggregate.generatedAt,
    ...(aggregate.courseQuery ? { courseQuery: aggregate.courseQuery } : {}),
    ...(options.submissionState ? { submissionState: options.submissionState } : {}),
    ...(options.limit !== undefined ? { limit: options.limit } : {}),
    coursesMatched: aggregate.coursesMatched,
    coursesScanned: aggregate.coursesScanned,
    totalAssignments: aggregate.totalAssignments,
    completedAttemptFetches: aggregate.completedAttemptFetches,
    attemptedAssignments: aggregate.attemptedAssignments,
    partial: aggregate.partial,
    grades: limited,
    failures: aggregate.failures,
  };
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
  input: { studentComments?: string; studentSubmission?: string } = {},
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
  const canonicalCourse = canonicalCourseId(courseId);
  const canonicalAttempt = canonicalCourseId(attemptId);
  const page = await fetchBlackboardPage(
    adapter,
    `/learn/api/public/v1/courses/${canonicalCourse}/gradebook/attempts/${canonicalAttempt}/files`,
  );
  return page.results.map((item) => completeBlackboardAttemptFile(normaliseBlackboardAttemptFile(item), canonicalCourse, canonicalAttempt));
}

export async function downloadBlackboardAttemptFile(
  adapter: ServiceAdapter,
  courseId: string,
  attemptId: string,
  fileId: string,
  destination: string,
  options: { overwrite?: boolean } = {},
): Promise<BlackboardAttemptFileDownload> {
  const output = await inspectBlackboardDownloadDestination(destination, options.overwrite === true);
  const files = await listBlackboardAttemptFiles(adapter, courseId, attemptId);
  const requestedId = canonicalIdBody(fileId);
  const file = files.find((entry) => entry.id === requestedId);
  if (!file) {
    throw new CliError(
      "The requested Blackboard attempt file was not found.",
      "BLACKBOARD_ATTEMPT_FILE_NOT_FOUND",
      2,
      {
        courseId: canonicalCourseId(courseId),
        attemptId: canonicalCourseId(attemptId),
        fileId: requestedId,
        availableFiles: files.map((entry) => ({ id: entry.id, name: entry.name })),
      },
    );
  }
  if (!file.downloadUrl) {
    throw new CliError(
      "Blackboard did not expose a downloadable URL for the selected attempt file.",
      "BLACKBOARD_ATTEMPT_FILE_UNAVAILABLE",
      2,
      {
        courseId: canonicalCourseId(courseId),
        attemptId: canonicalCourseId(attemptId),
        fileId: requestedId,
      },
    );
  }

  let response: Response;
  try {
    response = await fetchBlackboardAttachmentResponse(adapter, file.downloadUrl);
  } catch (error) {
    const status = blackboardDownloadStatus(error);
    if (status === 404) {
      throw new CliError(
        "Blackboard did not expose a downloadable URL for the selected attempt file.",
        "BLACKBOARD_ATTEMPT_FILE_UNAVAILABLE",
        2,
        {
          courseId: canonicalCourseId(courseId),
          attemptId: canonicalCourseId(attemptId),
          fileId: requestedId,
        },
      );
    }
    throw error;
  }
  const tempPath = join(dirname(output.destination), `.${basename(output.destination)}.sustech-${randomUUID()}.tmp`);
  try {
    const streamed = await streamBlackboardAttachment(response, tempPath, "");
    await finishBlackboardDownload(tempPath, output.destination, options.overwrite === true);
    return {
      file,
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

export async function inspectBlackboardSubmissionTextFile(path: string): Promise<BlackboardSubmissionText> {
  return (await readBlackboardSubmissionTextPayload(path)).textFile;
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

export async function readBlackboardSubmissionTextPayload(path: string): Promise<BlackboardSubmissionTextPayload> {
  const absolutePath = resolvePath(path);
  let info;
  let buffer: Buffer;
  try {
    info = await stat(absolutePath);
    buffer = await readFile(absolutePath);
  } catch (error) {
    throw new CliError(
      "The Blackboard submission text file could not be read.",
      "BLACKBOARD_TEXT_FILE_NOT_READABLE",
      2,
      {
        file: absolutePath,
        cause: error instanceof Error ? error.message : String(error),
      },
    );
  }
  if (!info.isFile()) {
    throw new CliError(
      "The Blackboard submission text target must be a regular file.",
      "BLACKBOARD_TEXT_FILE_NOT_REGULAR",
      2,
      { file: absolutePath },
    );
  }
  let text = "";
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer);
  } catch (error) {
    throw new CliError(
      "The Blackboard submission text file must be valid UTF-8.",
      "BLACKBOARD_TEXT_FILE_NOT_UTF8",
      2,
      {
        file: absolutePath,
        cause: error instanceof Error ? error.message : String(error),
      },
    );
  }
  if (buffer.length === 0) {
    throw new CliError(
      "The Blackboard submission text file cannot be empty.",
      "BLACKBOARD_TEXT_FILE_EMPTY",
      2,
      { file: absolutePath },
    );
  }
  return {
    textFile: {
      path,
      absolutePath,
      size: info.size,
      sha256: createHash("sha256").update(buffer).digest("hex"),
      charCount: [...text].length,
    },
    text,
  };
}

export async function listBlackboardAnnouncements(
  adapter: ServiceAdapter,
  options: { now?: Date; days?: number; courseQuery?: string } = {},
): Promise<BlackboardAnnouncementsReport> {
  const now = options.now ?? new Date();
  const minimumTimestamp = options.days === undefined ? undefined : now.getTime() - options.days * 86_400_000;
  const report: BlackboardAnnouncementsReport = {
    generatedAt: now.toISOString(),
    ...(options.courseQuery ? { courseQuery: options.courseQuery } : {}),
    ...(options.days !== undefined ? { days: options.days } : {}),
    coursesMatched: 0,
    coursesScanned: 0,
    systemAnnouncements: 0,
    courseAnnouncements: 0,
    partial: false,
    announcements: [],
    failures: [],
  };

  if (!options.courseQuery) {
    try {
      const systemAnnouncements = await listBlackboardSystemAnnouncements(adapter);
      for (const announcement of systemAnnouncements) {
        if (!blackboardAnnouncementMatchesWindow(announcement, minimumTimestamp)) continue;
        report.announcements.push(announcement);
        report.systemAnnouncements += 1;
      }
    } catch (error) {
      report.failures.push(blackboardOperationFailure(error, { stage: "announcements" }));
    }
  }

  const courses = await listBlackboardCoursesForAggregation(adapter, report.failures, options.courseQuery);
  report.coursesMatched = courses.length;
  for (const course of courses) {
    report.coursesScanned += 1;
    let announcements: BlackboardAnnouncement[];
    try {
      announcements = await listBlackboardCourseAnnouncements(adapter, course.id);
    } catch (error) {
      if (shouldSkipBlackboardCourseAnnouncements(error)) continue;
      report.failures.push(
        blackboardOperationFailure(error, {
          stage: "announcements",
          courseId: course.id,
          courseCode: course.courseCode,
          courseName: course.name,
        }),
      );
      continue;
    }
    for (const announcement of announcements) {
      const scoped = {
        ...announcement,
        courseId: course.id,
        courseCode: course.courseCode,
        courseName: course.name,
      } satisfies BlackboardAnnouncement;
      if (!blackboardAnnouncementMatchesWindow(scoped, minimumTimestamp)) continue;
      report.announcements.push(scoped);
      report.courseAnnouncements += 1;
    }
  }

  report.announcements.sort(compareBlackboardAnnouncements);
  report.partial = report.failures.length > 0;
  return report;
}

export async function listBlackboardDeadlines(
  adapter: ServiceAdapter,
  options: {
    now?: Date;
    days?: number;
    courseQuery?: string;
    submissionState?: BlackboardAssignmentSubmissionState;
  } = {},
): Promise<BlackboardDeadlineReport> {
  const now = options.now ?? new Date();
  const report: BlackboardDeadlineReport = {
    generatedAt: now.toISOString(),
    ...(options.courseQuery ? { courseQuery: options.courseQuery } : {}),
    ...(options.days !== undefined ? { days: options.days } : {}),
    ...(options.submissionState ? { submissionState: options.submissionState } : {}),
    coursesMatched: 0,
    coursesScanned: 0,
    partial: false,
    deadlines: [],
    failures: [],
  };
  const courses = await listBlackboardCoursesForAggregation(adapter, report.failures, options.courseQuery);
  report.coursesMatched = courses.length;
  const user = options.submissionState ? await getBlackboardUser(adapter) : undefined;
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
      let attemptSummary: BlackboardAssignmentAttemptSummary | undefined;
      if (user && options.submissionState) {
        try {
          const attempts = await listBlackboardAttemptsForUser(adapter, course.id, assignment.id, user.id);
          attemptSummary = summariseBlackboardAssignmentAttempts(attempts);
        } catch (error) {
          report.failures.push(
            blackboardOperationFailure(error, {
              stage: "attempts",
              courseId: course.id,
              courseCode: course.courseCode,
              courseName: course.name,
              contentId: assignment.contentId,
              columnId: assignment.id,
            }),
          );
          continue;
        }
        if (attemptSummary.state !== options.submissionState) continue;
      }
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
        ...(attemptSummary ? { attemptSummary } : {}),
      });
    }
  }
  report.partial = report.failures.length > 0;
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

export function nextBlackboardAnnouncement(report: BlackboardAnnouncementsReport): BlackboardAnnouncement | null {
  return report.announcements[0] ?? null;
}

export async function listBlackboardContentTree(
  adapter: ServiceAdapter,
  options: {
    courseId: string;
    rootContentId?: string;
    maxItems?: number;
  },
): Promise<BlackboardContentTreeReport> {
  const maxItems = validatedBlackboardTreeMaxItems(options.maxItems ?? 500);
  const course = await resolveBlackboardCourseContext(adapter, options.courseId);
  const failures: BlackboardOperationFailure[] = [];
  const entries: BlackboardContentTreeEntry[] = [];
  const visited = new Set<string>();
  let truncated = false;

  const visit = async (item: BlackboardContentItem, ancestors: readonly string[]): Promise<void> => {
    if (truncated || visited.has(item.id)) return;
    visited.add(item.id);
    const pathTitles = [...ancestors, item.title || item.id];
    const path = blackboardContentPath(course, pathTitles);
    entries.push({
      courseId: course.id,
      courseCode: course.courseCode,
      courseName: course.name,
      contentId: item.id,
      parentId: item.parentId,
      title: item.title,
      kind: item.kind,
      handler: item.handler,
      hasChildren: item.hasChildren,
      depth: ancestors.length,
      path,
      pathTitles,
    });
    if (entries.length >= maxItems) {
      truncated = true;
      failures.push({
        stage: "content",
        courseId: course.id,
        courseCode: course.courseCode,
        courseName: course.name,
        contentId: item.id,
        path,
        message: `Blackboard tree stopped after ${maxItems} content items; narrow with --content-id or raise --max.`,
      });
      return;
    }
    if (!item.hasChildren) return;
    let children: BlackboardContentItem[];
    try {
      children = await listBlackboardContent(adapter, course.id, item.id);
    } catch (error) {
      failures.push(
        blackboardOperationFailure(error, {
          stage: "content",
          courseId: course.id,
          courseCode: course.courseCode,
          courseName: course.name,
          parentId: item.id,
          contentId: item.id,
          path,
        }),
      );
      return;
    }
    for (const child of children) {
      await visit(child, pathTitles);
      if (truncated) break;
    }
  };

  const roots = options.rootContentId
    ? [await getBlackboardContentItem(adapter, course.id, options.rootContentId)]
    : await listBlackboardContent(adapter, course.id);
  for (const item of roots) {
    await visit(item, []);
    if (truncated) break;
  }

  return {
    generatedAt: new Date().toISOString(),
    courseId: course.id,
    courseCode: course.courseCode,
    courseName: course.name,
    ...(options.rootContentId ? { rootContentId: canonicalIdBody(options.rootContentId) } : {}),
    maxItems,
    returnedItems: entries.length,
    truncated,
    partial: failures.length > 0,
    entries,
    failures,
  };
}

export async function summarizeBlackboardContentTypes(
  adapter: ServiceAdapter,
  options: {
    courseQuery?: string;
  } = {},
): Promise<BlackboardContentTypesReport> {
  const failures: BlackboardOperationFailure[] = [];
  const matchedCourses = await listBlackboardCoursesForAggregation(adapter, failures, options.courseQuery);
  const totals = new Map<BlackboardContentItem["kind"], number>();
  const courses: BlackboardContentTypesCourse[] = [];
  let coursesScanned = 0;
  let totalItems = 0;

  for (const course of matchedCourses) {
    coursesScanned += 1;
    const kindCounts = new Map<BlackboardContentItem["kind"], number>();
    const handlerCounts = new Map<string, number>();
    let courseItems = 0;
    await walkBlackboardCourseContents(adapter, course, {
      onFailure(failure): void {
        failures.push(failure);
      },
      async visit(entry): Promise<void> {
        courseItems += 1;
        totalItems += 1;
        incrementBlackboardCount(kindCounts, entry.item.kind);
        incrementBlackboardCount(totals, entry.item.kind);
        if (entry.item.handler) incrementBlackboardCount(handlerCounts, entry.item.handler);
      },
    });
    courses.push({
      courseId: course.id,
      courseCode: course.courseCode,
      courseName: course.name,
      totalItems: courseItems,
      kindCounts: blackboardKindCountEntries(kindCounts),
      handlerCounts: blackboardStringCountEntries(handlerCounts),
    });
  }

  courses.sort((left, right) =>
    right.totalItems - left.totalItems
    || left.courseCode.localeCompare(right.courseCode, "zh-Hans-CN")
    || left.courseName.localeCompare(right.courseName, "zh-Hans-CN")
    || left.courseId.localeCompare(right.courseId, "zh-Hans-CN")
  );

  return {
    generatedAt: new Date().toISOString(),
    ...(options.courseQuery ? { courseQuery: options.courseQuery } : {}),
    coursesMatched: matchedCourses.length,
    coursesScanned,
    totalItems,
    partial: failures.length > 0,
    totals: blackboardKindCountEntries(totals),
    courses,
    failures,
  };
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
  submission: BlackboardSubmissionMaterial;
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

  const contentHandler = input.content.handler || "";
  const scoreProviderHandle = input.assignment.scoreProviderHandle || "";
  const classicSubmission = input.content.kind === "assignment"
    && contentHandler === "resource/x-bb-assignment"
    && (!scoreProviderHandle || scoreProviderHandle === "resource/x-bb-assignment");
  if (!classicSubmission) {
    blockers.push({
      code: "UNSUPPORTED_CONTENT_TYPE",
      message: `Content handler ${contentHandler || "unknown"} does not support the Classic/Original assignment form submission flow.`,
    });
  }
  if (
    scoreProviderHandle && scoreProviderHandle !== "resource/x-bb-assignment"
  ) {
    blockers.push({
      code: "UNSUPPORTED_SCORE_PROVIDER",
      message: `Score provider ${scoreProviderHandle} does not support the Classic/Original assignment form submission flow.`,
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
    input.submission.kind === "file"
    && (
    input.uploadSettings?.maxUploadSizeInBytes !== undefined
      && input.submission.file.size > input.uploadSettings.maxUploadSizeInBytes
    )
  ) {
    blockers.push({
      code: "FILE_TOO_LARGE",
      message: `The file is ${input.submission.file.size} bytes; Blackboard's reported limit is ${input.uploadSettings.maxUploadSizeInBytes} bytes.`,
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
    displayName: normaliseBlackboardUserDisplayName(record),
  };
}

export function normaliseBlackboardCalendar(raw: unknown): BlackboardCalendar {
  const record = recordValue(raw);
  const id = stringValue(record.id);
  const kind = blackboardCalendarKind(id);
  return {
    id,
    name: cleanText(record.name),
    kind,
    ...(kind === "course" ? { courseId: canonicalCourseId(id) } : {}),
  };
}

export function normaliseBlackboardCourse(enrollment: unknown, detail?: unknown): BlackboardCourse {
  const enrollmentRecord = recordValue(enrollment);
  const detailRecord = recordValue(detail);
  const id = stringValue(detailRecord.id ?? enrollmentRecord.courseId ?? enrollmentRecord.id);
  const availabilityRecord = recordValue(detailRecord.availability);
  const externalId = stringValue(detailRecord.externalId ?? detailRecord.courseId);
  return {
    id,
    numericId: numericIdFromBlackboardId(id),
    name: cleanText(detailRecord.name ?? enrollmentRecord.courseName ?? enrollmentRecord.name),
    courseCode: resolveBlackboardCourseCode(detailRecord, externalId),
    externalId,
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

export function normaliseBlackboardAnnouncement(
  raw: unknown,
  context: {
    source: "system" | "course";
    courseId?: string;
    courseCode?: string;
    courseName?: string;
  },
): BlackboardAnnouncement {
  const record = recordValue(raw);
  const availability = recordValue(record.availability);
  const duration = recordValue(availability.duration);
  const availabilityType = stringValue(duration.type) as BlackboardAnnouncement["availabilityType"];
  return {
    id: canonicalIdBody(record.id),
    source: context.source,
    title: cleanText(record.title),
    body: cleanText(record.body),
    created: stringValue(record.created),
    modified: stringValue(record.modified),
    ...(record.creator !== undefined ? { creator: stringValue(record.creator) } : {}),
    ...(record.draft !== undefined ? { draft: booleanValue(record.draft) } : {}),
    ...(availabilityType ? { availabilityType } : {}),
    ...(duration.start !== undefined ? { availableFrom: stringValue(duration.start) } : {}),
    ...(duration.end !== undefined ? { availableUntil: stringValue(duration.end) } : {}),
    ...(record.showAtLogin !== undefined ? { showAtLogin: booleanValue(record.showAtLogin) } : {}),
    ...(record.showInCourses !== undefined ? { showInCourses: booleanValue(record.showInCourses) } : {}),
    ...(context.courseId ? { courseId: context.courseId } : {}),
    ...(context.courseCode ? { courseCode: context.courseCode } : {}),
    ...(context.courseName ? { courseName: context.courseName } : {}),
  };
}

export function normaliseBlackboardDiscussion(raw: unknown): BlackboardDiscussion {
  const record = recordValue(raw);
  const topic = record.topic ? normaliseBlackboardDiscussionMessage(record.topic) : undefined;
  return {
    id: canonicalIdBody(record.id),
    title: cleanText(record.title),
    available: booleanValue(record.available),
    gradable: booleanValue(record.gradable),
    groupDiscussion: booleanValue(record.groupDiscussion),
    createdDate: stringValue(record.createdDate),
    modifiedDate: stringValue(record.modifiedDate),
    ...(record.gradebookColumnId !== undefined ? { gradebookColumnId: canonicalIdBody(record.gradebookColumnId) } : {}),
    source: "learn-rest",
    ...(topic ? { topic } : {}),
  };
}

export function normaliseBlackboardDiscussionMessage(raw: unknown): BlackboardDiscussionMessage {
  const record = recordValue(raw);
  const givenName = cleanText(record.givenName);
  const familyName = cleanText(record.familyName);
  const userId = stringValue(record.userId);
  return {
    id: canonicalIdBody(record.id),
    discussionId: canonicalIdBody(record.discussionId),
    parentId: canonicalIdBody(record.parentId),
    threadId: canonicalIdBody(record.threadId),
    userId,
    groupId: canonicalIdBody(record.groupId),
    givenName,
    familyName,
    author: cleanText([givenName, familyName].filter(Boolean).join(" ")) || userId,
    status: stringValue(record.status) as BlackboardDiscussionMessageStatus,
    body: cleanText(record.body),
    postDate: stringValue(record.postDate),
    editDate: stringValue(record.editDate),
    createdDate: stringValue(record.createdDate),
    modifiedDate: stringValue(record.modifiedDate),
    isRead: booleanValue(record.isRead),
    source: "learn-rest",
  };
}

function blackboardDiscussionWritePayload(
  input: BlackboardDiscussionMessageWriteInput,
): BlackboardDiscussionMessageWriteInput {
  const body = input.body;
  if (!cleanText(body)) {
    throw new CliError(
      "Blackboard discussion messages cannot be blank after trimming whitespace.",
      "BLACKBOARD_DISCUSSION_TEXT_EMPTY",
      2,
    );
  }
  return {
    body,
    ...(input.groupId ? { groupId: canonicalCourseId(input.groupId) } : {}),
    ...(input.status ? { status: input.status } : {}),
  };
}

function blackboardCourseMessageWritePayload(
  input: BlackboardCourseMessageWriteInput,
): {
  subject?: string;
  body: string;
  toUsers?: Array<{ id: string }>;
  ccUsers?: Array<{ id: string }>;
  bccUsers?: Array<{ id: string }>;
} {
  const body = input.body;
  if (!cleanText(body)) {
    throw new CliError(
      "Blackboard course messages cannot be blank after trimming whitespace.",
      "BLACKBOARD_MESSAGE_TEXT_EMPTY",
      2,
    );
  }
  const subject = cleanText(input.subject);
  const toUsers = normaliseBlackboardMessageRecipientIds(input.toUsers);
  const ccUsers = normaliseBlackboardMessageRecipientIds(input.ccUsers);
  const bccUsers = normaliseBlackboardMessageRecipientIds(input.bccUsers);
  if (toUsers.length + ccUsers.length + bccUsers.length === 0) {
    throw new CliError(
      "Blackboard course messages require at least one recipient.",
      "BLACKBOARD_MESSAGE_RECIPIENTS_EMPTY",
      2,
    );
  }
  assertDistinctBlackboardMessageRecipients({ toUsers, ccUsers, bccUsers });
  return {
    ...(subject ? { subject } : {}),
    body,
    ...(toUsers.length > 0 ? { toUsers: toUsers.map((id) => ({ id })) } : {}),
    ...(ccUsers.length > 0 ? { ccUsers: ccUsers.map((id) => ({ id })) } : {}),
    ...(bccUsers.length > 0 ? { bccUsers: bccUsers.map((id) => ({ id })) } : {}),
  };
}

function normaliseBlackboardMessageRecipientIds(values: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const value of values ?? []) {
    const canonical = canonicalCourseId(value);
    if (!canonical || seen.has(canonical)) continue;
    seen.add(canonical);
    items.push(canonical);
  }
  return items;
}

function assertDistinctBlackboardMessageRecipients(input: {
  toUsers: readonly string[];
  ccUsers: readonly string[];
  bccUsers: readonly string[];
}): void {
  const seen = new Map<string, "toUsers" | "ccUsers" | "bccUsers">();
  for (const [bucket, values] of [
    ["toUsers", input.toUsers],
    ["ccUsers", input.ccUsers],
    ["bccUsers", input.bccUsers],
  ] as const) {
    for (const value of values) {
      const existing = seen.get(value);
      if (existing) {
        throw new CliError(
          "Blackboard course message recipients must not appear in multiple recipient groups.",
          "BLACKBOARD_MESSAGE_RECIPIENT_DUPLICATE",
          2,
          { userId: canonicalIdBody(value), firstGroup: existing, secondGroup: bucket },
        );
      }
      seen.set(value, bucket);
    }
  }
}

export function normaliseBlackboardDiscussionGroup(raw: unknown): BlackboardDiscussionGroup {
  const record = recordValue(raw);
  return {
    groupId: canonicalIdBody(record.groupId),
    discussionId: canonicalIdBody(record.discussionId),
    threadId: canonicalIdBody(record.threadId),
  };
}

export function normaliseBlackboardCourseMessageFolder(raw: unknown): BlackboardCourseMessageFolder {
  const record = recordValue(raw);
  const counts = recordValue(record.courseMessagesCounts);
  return {
    name: stringValue(record.name),
    label: cleanText(record.label),
    type: stringValue(record.type) as BlackboardCourseMessageFolderType,
    totalCount: numberValue(counts.totalCount),
    unreadCount: numberValue(counts.unreadCount),
  };
}

export function normaliseBlackboardParticipantUser(raw: unknown): BlackboardParticipantUser {
  const record = recordValue(raw);
  const user = {
    id: stringValue(record.id),
    userName: blackboardRawText(record.userName),
    otherName: blackboardRawText(record.otherName),
    givenName: blackboardRawText(record.givenName),
    familyName: blackboardRawText(record.familyName),
    middleName: blackboardRawText(record.middleName),
    suffix: blackboardRawText(record.suffix),
    title: blackboardRawText(record.title),
    preferredDisplayName: stringValue(record.preferredDisplayName) as BlackboardParticipantDisplayPreference,
  };
  return {
    ...user,
    displayName: blackboardParticipantDisplayName(user),
  };
}

export function normaliseBlackboardCourseMessageAttachment(raw: unknown): BlackboardCourseMessageAttachment {
  const record = recordValue(raw);
  return {
    id: stringValue(record.id),
    fileName: stringValue(record.fileName),
    mimeType: stringValue(record.mimeType),
    fileLocation: stringValue(record.fileLocation),
  };
}

export function normaliseBlackboardCourseMessage(raw: unknown): BlackboardCourseMessage {
  const record = recordValue(raw);
  const sender = record.sender ? normaliseBlackboardParticipantUser(record.sender) : undefined;
  const attachment = record.attachment ? normaliseBlackboardCourseMessageAttachment(record.attachment) : undefined;
  return {
    id: canonicalIdBody(record.id),
    subject: cleanText(record.subject),
    body: cleanText(record.body),
    postedDate: stringValue(record.postedDate),
    isRead: booleanValue(record.isRead),
    type: stringValue(record.type) as BlackboardCourseMessageType,
    senderId: stringValue(record.senderId),
    ...(sender ? { sender } : {}),
    ...(attachment ? { attachment } : {}),
    toUsers: arrayValue(record.toUsers).map((item) => stringValue(item)).filter(Boolean),
    ccUsers: arrayValue(record.ccUsers).map((item) => stringValue(item)).filter(Boolean),
    bccUsers: arrayValue(record.bccUsers).map((item) => stringValue(item)).filter(Boolean),
    isExistingAttachment: booleanValue(record.isExistingAttachment),
    isReply: booleanValue(record.isReply),
  };
}

export function normaliseBlackboardCourseMessageParticipant(raw: unknown): BlackboardCourseMessageParticipant {
  const record = recordValue(raw);
  const user = record.user ? normaliseBlackboardParticipantUser(record.user) : undefined;
  const userId = stringValue(record.userId);
  return {
    messageId: canonicalIdBody(record.messageId),
    userId,
    participationType: stringValue(record.participationType) as BlackboardCourseMessageParticipationType,
    displayName: user?.displayName || userId,
    ...(user ? { user } : {}),
  };
}

export function normaliseBlackboardCourseRosterUser(raw: unknown): BlackboardCourseRosterUser {
  const record = recordValue(raw);
  const name = recordValue(record.name);
  const contact = recordValue(record.contact);
  const availability = recordValue(record.availability);
  const base = {
    id: stringValue(record.id),
    userName: stringValue(record.userName),
    otherName: cleanText(name.other),
    givenName: cleanText(name.given),
    familyName: cleanText(name.family),
    middleName: cleanText(name.middle),
    suffix: cleanText(name.suffix),
    preferredDisplayName: stringValue(name.preferredDisplayName) as BlackboardParticipantDisplayPreference,
  };
  return {
    id: base.id,
    userName: base.userName,
    displayName: blackboardParticipantDisplayName(base),
    givenName: base.givenName,
    familyName: base.familyName,
    otherName: base.otherName,
    email: stringValue(contact.email),
    institutionEmail: stringValue(contact.institutionEmail),
    avatarUrl: stringValue(recordValue(record.avatar).viewUrl),
    availability: stringValue(availability.available) as BlackboardCourseMembershipAvailability,
  };
}

export function normaliseBlackboardCourseMembership(raw: unknown): BlackboardCourseMembership {
  const record = recordValue(raw);
  const availability = recordValue(record.availability);
  const user = record.user ? normaliseBlackboardCourseRosterUser(record.user) : undefined;
  return {
    id: canonicalIdBody(record.id),
    userId: stringValue(record.userId),
    courseId: canonicalCourseId(stringValue(record.courseId)),
    childCourseId: stringValue(record.childCourseId),
    created: stringValue(record.created),
    modified: stringValue(record.modified),
    availability: stringValue(availability.available ?? record.availability) as BlackboardCourseMembershipAvailability,
    courseRoleId: stringValue(record.courseRoleId),
    lastAccessed: stringValue(record.lastAccessed),
    dueDateExceptionType: stringValue(record.dueDateExceptionType),
    timeLimitExceptionType: stringValue(record.timeLimitExceptionType),
    ...(record.displayOrder === undefined ? {} : { displayOrder: numberValue(record.displayOrder) }),
    ...(user ? { user } : {}),
  };
}

export function normaliseBlackboardCalendarItem(raw: unknown): BlackboardCalendarItem {
  const record = recordValue(raw);
  const calendarId = stringValue(record.calendarId);
  const courseId = blackboardCalendarCourseId(calendarId);
  const dynamicCalendarItemProps = normaliseBlackboardCalendarItemDynamicProps(record.dynamicCalendarItemProps);
  const recurrence = normaliseBlackboardCalendarItemRecurrence(record.recurrence);
  return {
    id: canonicalIdBody(record.id),
    type: stringValue(record.type) as BlackboardCalendarItemType | "",
    calendarId,
    calendarName: cleanText(record.calendarName),
    title: cleanText(record.title),
    description: cleanText(record.description),
    location: cleanText(record.location),
    start: stringValue(record.start),
    end: stringValue(record.end),
    modified: stringValue(record.modified),
    color: stringValue(record.color),
    disableResizing: booleanValue(record.disableResizing),
    ...(courseId ? { courseId } : {}),
    ...(dynamicCalendarItemProps ? { dynamicCalendarItemProps } : {}),
    ...(recurrence ? { recurrence } : {}),
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
    studentComments: normaliseBlackboardSubmissionText(record.studentComments),
    studentSubmission: normaliseBlackboardSubmissionText(record.studentSubmission),
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

function normaliseBlackboardSubmissionText(value: unknown): string {
  return cleanText(stringValue(value).replace(/<br\b[^>]*>|<\/(?:p|div|li|pre|h[1-6])\s*>/giu, "\n"));
}

export function normaliseBlackboardAttemptFile(raw: unknown): BlackboardAttemptFile {
  const record = recordValue(raw);
  const rawViewUrl = stringValue(record.viewUrl);
  const rawDownloadUrl = stringValue(record.downloadUrl);
  return {
    id: canonicalIdBody(record.id),
    name: stringValue(record.name),
    viewUrl: rawViewUrl ? safeBlackboardDownloadUrl(rawViewUrl).toString() : "",
    downloadUrl: rawDownloadUrl ? safeBlackboardDownloadUrl(rawDownloadUrl).toString() : "",
  };
}

function completeBlackboardAttemptFile(
  file: BlackboardAttemptFile,
  courseId: string,
  attemptId: string,
): BlackboardAttemptFile {
  if (file.downloadUrl) return file;
  return {
    ...file,
    downloadUrl: buildBlackboardUrl(`/learn/api/public/v1/courses/${courseId}/gradebook/attempts/${attemptId}/files/${canonicalCourseId(file.id)}/download`),
  };
}

function blackboardDownloadStatus(error: unknown): number | undefined {
  if (!(error instanceof CliError)) return undefined;
  if (typeof error.details !== "object" || error.details === null) return undefined;
  const details = error.details as { status?: unknown };
  return typeof details.status === "number" ? details.status : undefined;
}

export function normaliseBlackboardUploadSettings(raw: unknown): BlackboardUploadSettings {
  const record = recordValue(raw);
  return {
    ...(record.maxUploadSizeInBytes !== undefined ? { maxUploadSizeInBytes: numberValue(record.maxUploadSizeInBytes) } : {}),
    supportsInlineRender: booleanValue(record.supportsInlineRender),
  };
}

export function normaliseBlackboardCalendarItemDynamicProps(
  raw: unknown,
): BlackboardCalendarItemDynamicProps | undefined {
  const record = recordValue(raw);
  if (Object.keys(record).length === 0) return undefined;
  return {
    attemptable: booleanValue(record.attemptable),
    categoryId: stringValue(record.categoryId),
    dateRangeLimited: booleanValue(record.dateRangeLimited),
    eventType: stringValue(record.eventType),
    gradable: booleanValue(record.gradable),
  };
}

export function normaliseBlackboardCalendarItemRecurrence(
  raw: unknown,
): BlackboardCalendarItemRecurrence | undefined {
  const record = recordValue(raw);
  if (Object.keys(record).length === 0) return undefined;
  return {
    ...(record.count !== undefined ? { count: numberValue(record.count) } : {}),
    frequency: stringValue(record.frequency) as BlackboardCalendarItemRecurrence["frequency"],
    ...(record.interval !== undefined ? { interval: numberValue(record.interval) } : {}),
    ...(record.monthRepeatDay !== undefined ? { monthRepeatDay: numberValue(record.monthRepeatDay) } : {}),
    ...(record.monthPosition !== undefined ? { monthPosition: numberValue(record.monthPosition) } : {}),
    ...(record.originalStart !== undefined ? { originalStart: stringValue(record.originalStart) } : {}),
    ...(record.originalEnd !== undefined ? { originalEnd: stringValue(record.originalEnd) } : {}),
    repeatBroken: booleanValue(record.repeatBroken),
    ...(record.repeatDay !== undefined ? { repeatDay: stringValue(record.repeatDay) as BlackboardCalendarWeekDay } : {}),
    ...(record.until !== undefined ? { until: stringValue(record.until) } : {}),
    weekDays: arrayValue(record.weekDays)
      .map((value) => stringValue(value) as BlackboardCalendarWeekDay)
      .filter(Boolean),
  };
}

export function classifyBlackboardHandler(handler: string): BlackboardContentItem["kind"] {
  switch (handler) {
    case "resource/x-bb-file":
      return "file";
    case "resource/x-bb-folder":
      return "folder";
    case "resource/x-bb-assignment":
    case "resource/x-bb-asmt-test-link":
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

const BLACKBOARD_CALENDAR_DEFAULT_WINDOW_MS = 14 * 86_400_000;
const BLACKBOARD_CALENDAR_MAX_WINDOW_MS = 16 * 7 * 86_400_000;

async function fetchBlackboardPageChunk(
  adapter: ServiceAdapter,
  pathOrUrl: string,
  options: { absolute?: boolean } = {},
): Promise<{ results: unknown[]; nextPage?: string }> {
  const rawUrl = options.absolute ? pathOrUrl : buildBlackboardUrl(pathOrUrl);
  const parsedUrl = new URL(rawUrl, BLACKBOARD_BASE);
  if (parsedUrl.origin !== BLACKBOARD_BASE) {
    throw new ServiceError("Blackboard pagination attempted to leave its configured origin.", { url: parsedUrl.toString() });
  }
  const url = parsedUrl.toString();
  const raw = await fetchJson<unknown>(adapter, url);
  const record = recordValue(raw);
  const nextPage = stringValue(recordValue(record.paging).nextPage);
  return {
    results: arrayValue(record.results),
    ...(nextPage ? { nextPage } : {}),
  };
}

async function fetchBlackboardPage(
  adapter: ServiceAdapter,
  pathOrUrl: string,
  options: { absolute?: boolean; onInitialNotFound?: () => Promise<boolean> } = {},
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
    let pageChunk: Awaited<ReturnType<typeof fetchBlackboardPageChunk>>;
    try {
      pageChunk = await fetchBlackboardPageChunk(adapter, url, { absolute: true });
    } catch (error) {
      // Never replace a later-page failure or an uncorroborated 404 with an empty history.
      if (page === 1 && error instanceof CliError && error.details?.status === 404
        && await options.onInitialNotFound?.().catch(() => false)) return { results: [] };
      throw error;
    }
    results.push(...pageChunk.results);
    if (!pageChunk.nextPage) return { results };
    url = new URL(pageChunk.nextPage, url).toString();
  }
  throw new ServiceError("Blackboard pagination exceeded the safe page limit.", { url });
}

async function fetchBlackboardCalendarItemsChunk(
  adapter: ServiceAdapter,
  options: {
    courseId?: string;
    type?: BlackboardCalendarItemType;
    since: string;
    until: string;
  },
): Promise<BlackboardCalendarItem[]> {
  const query: Record<string, string> = {
    since: options.since,
    until: options.until,
  };
  if (options.courseId) query.courseId = canonicalCourseId(options.courseId);
  if (options.type) query.type = options.type;
  const url = buildBlackboardUrl("/learn/api/public/v1/calendars/items", query);
  const page = await fetchBlackboardPage(adapter, url, { absolute: true });
  return page.results.map((item) => normaliseBlackboardCalendarItem(item));
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

export function publicBlackboardAttemptFile(
  file: BlackboardAttemptFile,
): BlackboardAttemptFileReference {
  return {
    id: file.id,
    name: file.name,
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
  await assertPathAndParentsAreNotSymlinks(parent);
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

async function resolveBlackboardCourseContext(adapter: ServiceAdapter, courseId: string): Promise<BlackboardCourse> {
  const canonical = canonicalCourseId(courseId);
  try {
    const detail = await fetchJson<unknown>(adapter, buildBlackboardUrl(`/learn/api/public/v1/courses/${canonical}`));
    return normaliseBlackboardCourse({ courseId: canonical }, detail);
  } catch {
    return {
      id: canonical,
      numericId: numericIdFromBlackboardId(canonical),
      name: canonical,
      courseCode: canonical,
      externalId: "",
      roleId: "",
      availability: "",
    };
  }
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

function blackboardAnnouncementMatchesWindow(
  announcement: BlackboardAnnouncement,
  minimumTimestamp: number | undefined,
): boolean {
  if (minimumTimestamp === undefined) return true;
  const activityTimestamp = blackboardAnnouncementActivityTimestamp(announcement);
  return activityTimestamp !== undefined && activityTimestamp >= minimumTimestamp;
}

function blackboardAnnouncementActivityTimestamp(announcement: BlackboardAnnouncement): number | undefined {
  const candidates = [announcement.modified, announcement.created];
  for (const value of candidates) {
    if (!value) continue;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function shouldSkipBlackboardCourseAnnouncements(error: unknown): boolean {
  const status = error instanceof CliError && Number.isFinite(Number(error.details?.status))
    ? Number(error.details?.status)
    : error instanceof ServiceError && Number.isFinite(Number(error.details?.status))
      ? Number(error.details?.status)
      : undefined;
  if (status !== 400 && status !== 403) return false;
  const bodySample = error instanceof CliError
    ? stringValue(error.details?.bodySample).toLowerCase()
    : error instanceof ServiceError
      ? stringValue(error.details?.bodySample).toLowerCase()
      : "";
  return bodySample.includes("announcement tool for current course is not available")
    || bodySample.includes("course.announcements.view");
}

function normalizeBlackboardDiscussionUnsupported(
  error: unknown,
  options: {
    operation: string;
    courseId: string;
    discussionId?: string;
    messageId?: string;
  },
): Error {
  const status = error instanceof CliError && Number.isFinite(Number(error.details?.status))
    ? Number(error.details?.status)
    : error instanceof ServiceError && Number.isFinite(Number(error.details?.status))
      ? Number(error.details?.status)
      : undefined;
  const bodySample = error instanceof CliError
    ? stringValue(error.details?.bodySample).toLowerCase()
    : error instanceof ServiceError
      ? stringValue(error.details?.bodySample).toLowerCase()
      : "";
  if (status !== 400 || !bodySample.includes("original courses are not supported by this api")) {
    return error instanceof Error ? error : new Error(String(error));
  }
  return new CliError(
    "Blackboard's public discussion REST API does not support this Original course. Forum listing may still work through the CLI's Original-course HTML fallback, but this operation is unavailable through the current REST path.",
    "BLACKBOARD_DISCUSSIONS_UNSUPPORTED",
    1,
    {
      operation: options.operation,
      courseId: canonicalCourseId(options.courseId),
      ...(options.discussionId ? { discussionId: canonicalCourseId(options.discussionId) } : {}),
      ...(options.messageId ? { messageId: canonicalCourseId(options.messageId) } : {}),
      status,
      bodySample,
      retryPolicy: "DO_NOT_RETRY_AUTOMATICALLY",
    },
  );
}

function isBlackboardOriginalDiscussionUnsupported(error: unknown): boolean {
  const status = error instanceof CliError && Number.isFinite(Number(error.details?.status))
    ? Number(error.details?.status)
    : error instanceof ServiceError && Number.isFinite(Number(error.details?.status))
      ? Number(error.details?.status)
      : undefined;
  const bodySample = error instanceof CliError
    ? stringValue(error.details?.bodySample).toLowerCase()
    : error instanceof ServiceError
      ? stringValue(error.details?.bodySample).toLowerCase()
      : "";
  return status === 400 && bodySample.includes("original courses are not supported by this api");
}

function isBlackboardDiscussionSortRejected(error: unknown): boolean {
  const status = error instanceof CliError && Number.isFinite(Number(error.details?.status))
    ? Number(error.details?.status)
    : error instanceof ServiceError && Number.isFinite(Number(error.details?.status))
      ? Number(error.details?.status)
      : undefined;
  const bodySample = error instanceof CliError
    ? stringValue(error.details?.bodySample).toLowerCase()
    : error instanceof ServiceError
      ? stringValue(error.details?.bodySample).toLowerCase()
      : "";
  return status === 400
    && bodySample.includes("field error")
    && bodySample.includes("field 'sort'");
}

function compareBlackboardAnnouncements(left: BlackboardAnnouncement, right: BlackboardAnnouncement): number {
  const leftTimestamp = blackboardAnnouncementActivityTimestamp(left) ?? Number.NEGATIVE_INFINITY;
  const rightTimestamp = blackboardAnnouncementActivityTimestamp(right) ?? Number.NEGATIVE_INFINITY;
  if (leftTimestamp !== rightTimestamp) return rightTimestamp - leftTimestamp;
  if ((left.courseCode ?? "") !== (right.courseCode ?? "")) {
    return (left.courseCode ?? "").localeCompare(right.courseCode ?? "", "zh-Hans-CN");
  }
  if (left.title !== right.title) return left.title.localeCompare(right.title, "zh-Hans-CN");
  return left.id.localeCompare(right.id, "zh-Hans-CN");
}

function compareBlackboardScopedAssignments(left: BlackboardScopedAssignment, right: BlackboardScopedAssignment): number {
  const leftDue = left.assignment.grading.due;
  const rightDue = right.assignment.grading.due;
  if (leftDue && rightDue) {
    const diff = compareBlackboardCalendarDateTime(leftDue, rightDue);
    if (diff !== 0) return diff;
  } else if (leftDue || rightDue) {
    return leftDue ? -1 : 1;
  }
  if (left.courseCode !== right.courseCode) return left.courseCode.localeCompare(right.courseCode, "zh-Hans-CN");
  if (left.courseName !== right.courseName) return left.courseName.localeCompare(right.courseName, "zh-Hans-CN");
  if (left.assignment.title !== right.assignment.title) return left.assignment.title.localeCompare(right.assignment.title, "zh-Hans-CN");
  return left.assignment.id.localeCompare(right.assignment.id, "zh-Hans-CN");
}

function compareBlackboardGradeEntries(left: BlackboardGradeEntry, right: BlackboardGradeEntry): number {
  const leftTimestamp = blackboardGradeActivityTimestamp(left.attemptSummary);
  const rightTimestamp = blackboardGradeActivityTimestamp(right.attemptSummary);
  if (leftTimestamp !== rightTimestamp) return rightTimestamp - leftTimestamp;
  if (left.courseCode !== right.courseCode) return left.courseCode.localeCompare(right.courseCode, "zh-Hans-CN");
  if (left.assignment.title !== right.assignment.title) return left.assignment.title.localeCompare(right.assignment.title, "zh-Hans-CN");
  return left.assignment.id.localeCompare(right.assignment.id, "zh-Hans-CN");
}

function blackboardGradeActivityTimestamp(summary: BlackboardAssignmentAttemptSummary): number {
  const value = summary.latestSubmissionDate || summary.latestAttemptDate;
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function incrementBlackboardCount<T extends string>(target: Map<T, number>, key: T): void {
  target.set(key, (target.get(key) ?? 0) + 1);
}

function validatedBlackboardTreeMaxItems(maxItems: number): number {
  if (!Number.isSafeInteger(maxItems) || maxItems < 1 || maxItems > 5_000) {
    throw new CliError("Blackboard tree limits must be integers from 1 to 5000.", "USAGE", 2);
  }
  return maxItems;
}

function validatedBlackboardPage(page = 1): number {
  if (!Number.isSafeInteger(page) || page < 1 || page > 10_000) {
    throw new CliError("Blackboard page numbers must be integers from 1 to 10000.", "USAGE", 2);
  }
  return page;
}

function validatedBlackboardPageSize(pageSize = 25): number {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new CliError("Blackboard page sizes must be integers from 1 to 100.", "USAGE", 2);
  }
  return pageSize;
}

function blackboardKindCountEntries(
  counts: ReadonlyMap<BlackboardContentItem["kind"], number>,
): BlackboardContentKindCount[] {
  return [...counts.entries()]
    .sort((left, right) =>
      right[1] - left[1]
      || compareBlackboardContentKind(left[0], right[0])
    )
    .map(([kind, count]) => ({ kind, count }));
}

function blackboardStringCountEntries(
  counts: ReadonlyMap<string, number>,
): BlackboardContentHandlerCount[] {
  return [...counts.entries()]
    .sort((left, right) =>
      right[1] - left[1]
      || left[0].localeCompare(right[0], "zh-Hans-CN")
    )
    .map(([handler, count]) => ({ handler, count }));
}

function compareBlackboardContentKind(left: BlackboardContentItem["kind"], right: BlackboardContentItem["kind"]): number {
  const order: readonly BlackboardContentItem["kind"][] = ["document", "assignment", "file", "folder", "unknown"];
  return order.indexOf(left) - order.indexOf(right) || left.localeCompare(right, "zh-Hans-CN");
}

function summariseBlackboardAssignmentAttempts(
  attempts: readonly BlackboardAttempt[],
): BlackboardAssignmentAttemptSummary {
  const ordered = [...attempts].sort((left, right) =>
    compareBlackboardCalendarDateTime(right.attemptReceipt?.submissionDate || right.attemptDate || right.modified || right.created, left.attemptReceipt?.submissionDate || left.attemptDate || left.modified || left.created)
    || compareBlackboardCalendarDateTime(right.modified || right.created, left.modified || left.created)
    || right.id.localeCompare(left.id, "zh-Hans-CN")
  );
  const latest = ordered[0];
  const inProgressAttempts = attempts.filter((attempt) => blackboardAttemptIsInProgress(attempt.status)).length;
  const completedAttempts = attempts.filter((attempt) => attempt.status === "Completed").length;
  const submittedAttempts = attempts.filter((attempt) => blackboardAttemptIsSubmitted(attempt.status)).length;
  return {
    state: blackboardAssignmentSubmissionState({ totalAttempts: attempts.length, inProgressAttempts, completedAttempts, submittedAttempts, latestStatus: latest?.status }),
    totalAttempts: attempts.length,
    submittedAttempts,
    completedAttempts,
    inProgressAttempts,
    ...(latest ? {
      latestAttemptId: latest.id,
      latestStatus: latest.status,
      latestAttemptDate: latest.attemptDate || latest.modified || latest.created,
      latestSubmissionDate: latest.attemptReceipt?.submissionDate,
      latestDisplayGradeText: latest.displayGradeText,
    } : {}),
  };
}

function blackboardAssignmentSubmissionState(input: {
  totalAttempts: number;
  inProgressAttempts: number;
  completedAttempts: number;
  submittedAttempts: number;
  latestStatus?: BlackboardAttemptStatus | "";
}): BlackboardAssignmentSubmissionState {
  if (input.totalAttempts === 0) return "not_attempted";
  if (input.latestStatus === "Completed") return input.inProgressAttempts > 0 ? "mixed" : "completed";
  if (input.latestStatus === "NeedsGrading" || input.latestStatus === "NeedsGradingAgain") {
    return input.inProgressAttempts > 0 ? "mixed" : "submitted";
  }
  if (input.latestStatus && blackboardAttemptIsInProgress(input.latestStatus)) {
    return input.submittedAttempts > 0 || input.completedAttempts > 0 ? "mixed" : "in_progress";
  }
  if (input.inProgressAttempts > 0 && (input.submittedAttempts > 0 || input.completedAttempts > 0)) return "mixed";
  if (input.completedAttempts > 0) return "completed";
  if (input.submittedAttempts > 0) return "submitted";
  if (input.inProgressAttempts > 0) return "in_progress";
  return "other";
}

function blackboardAttemptIsInProgress(status: BlackboardAttemptStatus | ""): boolean {
  return status === "InProgress" || status === "InProgressAgain" || status === "Suspended";
}

function blackboardAttemptIsSubmitted(status: BlackboardAttemptStatus | ""): boolean {
  return status === "NeedsGrading" || status === "NeedsGradingAgain" || status === "Completed";
}

function blackboardCalendarKind(value: string): BlackboardCalendarKind {
  if (value === "PERSONAL") return "personal";
  if (value === "INSTITUTION") return "institution";
  if (/^_.+_1$/.test(value)) return "course";
  return "unknown";
}

function blackboardCalendarCourseId(value: string): string | undefined {
  return blackboardCalendarKind(value) === "course" ? canonicalCourseId(value) : undefined;
}

function resolveBlackboardCalendarWindow(options: {
  since?: Date | string;
  until?: Date | string;
  now?: Date;
}): { since: string; until: string; sinceDate: Date; untilDate: Date } {
  const now = options.now ?? new Date();
  const sinceDate = options.since !== undefined
    ? parseBlackboardCalendarDateTime(options.since, "since")
    : undefined;
  const untilDate = options.until !== undefined
    ? parseBlackboardCalendarDateTime(options.until, "until")
    : undefined;
  const resolvedSince = sinceDate
    ?? (untilDate
      ? new Date(untilDate.getTime() - BLACKBOARD_CALENDAR_DEFAULT_WINDOW_MS)
      : new Date(now));
  const resolvedUntil = untilDate
    ?? (sinceDate
      ? new Date(sinceDate.getTime() + BLACKBOARD_CALENDAR_DEFAULT_WINDOW_MS)
      : new Date(now.getTime() + BLACKBOARD_CALENDAR_DEFAULT_WINDOW_MS));
  if (resolvedSince.getTime() > resolvedUntil.getTime()) {
    throw new CliError(
      "Blackboard calendar queries require since to be earlier than or equal to until.",
      "BLACKBOARD_CALENDAR_WINDOW_INVALID",
      2,
      {
        since: resolvedSince.toISOString(),
        until: resolvedUntil.toISOString(),
      },
    );
  }
  return {
    since: resolvedSince.toISOString(),
    until: resolvedUntil.toISOString(),
    sinceDate: resolvedSince,
    untilDate: resolvedUntil,
  };
}

function parseBlackboardCalendarDateTime(value: Date | string, label: "since" | "until"): Date {
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new CliError(
      `Blackboard calendar ${label} must be a valid date-time.`,
      "BLACKBOARD_CALENDAR_TIME_INVALID",
      2,
      { field: label, value: String(value) },
    );
  }
  return parsed;
}

function buildBlackboardCalendarChunks(
  since: Date,
  until: Date,
): Array<{ since: string; until: string }> {
  const start = since.getTime();
  const finish = until.getTime();
  if (finish - start <= BLACKBOARD_CALENDAR_MAX_WINDOW_MS) {
    return [{ since: since.toISOString(), until: until.toISOString() }];
  }
  const chunks: Array<{ since: string; until: string }> = [];
  let cursor = start;
  while (cursor < finish) {
    const boundary = Math.min(cursor + BLACKBOARD_CALENDAR_MAX_WINDOW_MS, finish);
    chunks.push({
      since: new Date(cursor).toISOString(),
      until: new Date(boundary).toISOString(),
    });
    if (boundary >= finish) break;
    cursor = boundary;
  }
  return chunks;
}

function blackboardCalendarItemKey(item: BlackboardCalendarItem): string {
  return [
    item.type,
    item.id,
    item.calendarId,
    item.start,
    item.end,
    item.title,
  ].join("\u001F");
}

function compareBlackboardCalendarDateTime(left: string, right: string): number {
  const leftValue = Date.parse(left);
  const rightValue = Date.parse(right);
  const normalizedLeft = Number.isFinite(leftValue) ? leftValue : Number.MAX_SAFE_INTEGER;
  const normalizedRight = Number.isFinite(rightValue) ? rightValue : Number.MAX_SAFE_INTEGER;
  return normalizedLeft - normalizedRight;
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

function blackboardRawText(value: unknown): string {
  if (typeof value === "string") return cleanText(value);
  const record = recordValue(value);
  return cleanText(
    stringValue(record.value)
    || stringValue(record.text)
    || stringValue(record.rawText)
    || stringValue(record.formattedText)
    || stringValue(record.displayText)
    || stringValue(record.plainText)
    || stringValue(record.html),
  );
}

function normaliseBlackboardUserDisplayName(record: Record<string, unknown>): string {
  const explicit = cleanText(record.displayName ?? (typeof record.name === "string" ? record.name : undefined));
  if (explicit) return explicit;
  const name = recordValue(record.name);
  const structuredExplicit = blackboardRawText(
    name.displayName
    ?? name.formattedName
    ?? name.fullName
    ?? name.formattedText,
  );
  if (structuredExplicit) return structuredExplicit;
  const givenName = blackboardRawText(name.given ?? name.givenName);
  const otherName = blackboardRawText(name.other ?? name.otherName);
  const candidate = blackboardParticipantDisplayName({
    id: stringValue(record.id),
    userName: stringValue(record.userName ?? record.userNameOrId),
    otherName,
    givenName,
    familyName: blackboardRawText(name.family ?? name.familyName),
    middleName: blackboardRawText(name.middle ?? name.middleName),
    suffix: blackboardRawText(name.suffix),
    preferredDisplayName: stringValue(name.preferredDisplayName) as BlackboardParticipantDisplayPreference,
  });
  return givenName || otherName || candidate;
}

function blackboardParticipantDisplayName(
  user: Pick<BlackboardParticipantUser, "id" | "userName" | "otherName" | "givenName" | "familyName" | "middleName" | "suffix" | "preferredDisplayName">,
): string {
  const givenFamily = cleanText([user.givenName, user.middleName, user.familyName, user.suffix].filter(Boolean).join(" "));
  const otherFamily = cleanText([user.otherName, user.familyName, user.suffix].filter(Boolean).join(" "));
  const both = cleanText([
    user.otherName,
    user.givenName && user.givenName !== user.otherName ? user.givenName : "",
    user.middleName,
    user.familyName,
    user.suffix,
  ].filter(Boolean).join(" "));
  if (user.preferredDisplayName === "OtherName" && otherFamily) return otherFamily;
  if (user.preferredDisplayName === "Both" && both) return both;
  return givenFamily || otherFamily || both || user.userName || user.id;
}

function resolveBlackboardCourseCode(detailRecord: Record<string, unknown>, externalId: string): string {
  const explicit = stringValue(detailRecord.courseCode);
  if (explicit) return explicit;
  const derived = deriveBlackboardCourseCode(externalId || stringValue(detailRecord.courseId));
  return derived || externalId;
}

function deriveBlackboardCourseCode(value: string): string {
  const candidate = value.trim().split("-", 1)[0]?.trim().toUpperCase() ?? "";
  return /^[A-Z]{2,}\d{2,}[A-Z0-9]*$/u.test(candidate) ? candidate : "";
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
