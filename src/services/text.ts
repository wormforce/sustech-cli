import type {
  BlackboardAssignment,
  BlackboardAttempt,
  BlackboardAttemptFile,
  BlackboardCourse,
  BlackboardDeadline,
  BlackboardDeadlineReport,
  BlackboardContentAttachment,
  BlackboardContentAttachmentDownload,
  BlackboardContentItem,
  BlackboardSearchMatch,
  BlackboardSearchReport,
  BlackboardSubmissionFile,
  BlackboardSyncReport,
  BlackboardUser,
} from "./blackboard.js";
import type { BookingUserProfile } from "./booking-auth.js";
import type {
  BookingCancelPreview,
  BookingCancelSuccess,
  BookingCreatePreview,
  BookingCreateSuccess,
  BookingMeeting,
  BookingRoom,
} from "./booking.js";
import type {
  LibraryBookingCancelPreview,
  LibraryBookingCancelSuccess,
  LibraryBookingCreatePreview,
  LibraryBookingCreateSuccess,
  LibraryBookingUser,
  LibraryCampusGroup,
  LibraryIdleCategory,
  LibraryLab,
  LibraryReservation,
} from "./library.js";
import type { NcesCourseDetail, NcesCourseSummary } from "./nces.js";
import type { OpenAccessPdfDownload, PaperSummary } from "./papers.js";
import type {
  PmsPrintDeletePreview,
  PmsPrintJob,
  PmsPrintUploadPreview,
  PmsScanJob,
  PmsServerGroup,
  PmsStation,
  PmsUsageRecord,
} from "./pms.js";
import type { WsProgramDetail, WsProgramSummary } from "./ws.js";

export function formatBookingProfile(profile: BookingUserProfile): string {
  return [
    "E-Hall booking user",
    profile.name || profile.sid || "Authenticated user",
    ...(profile.sid && profile.sid !== profile.name ? [`ID ${profile.sid}`] : []),
    ...(profile.department ? [`Department ${profile.department}`] : []),
  ].join("\n");
}

export function formatBookingRooms(rooms: readonly BookingRoom[]): string {
  if (rooms.length === 0) return "E-Hall booking rooms\nNo matching rooms.";
  return [
    `E-Hall booking rooms · ${rooms.length}`,
    ...rooms.map((room) => [
      `${room.id.padEnd(12)} ${room.name} · capacity ${room.capacity} · ${room.available ? "available" : "unavailable"}`,
      `  ${room.location || room.department || "Location unavailable"}${room.bookStart && room.bookEnd ? ` · ${room.bookStart.slice(0, 5)}-${room.bookEnd.slice(0, 5)}` : ""}`,
    ].join("\n")),
  ].join("\n");
}

export function formatBookingMeetings(meetings: readonly BookingMeeting[]): string {
  if (meetings.length === 0) return "My E-Hall bookings\nNo current meetings.";
  return [
    `My E-Hall bookings · ${meetings.length}`,
    ...meetings.map((meeting) => [
      `${meeting.id.padEnd(12)} ${meeting.title || "Untitled meeting"} · ${meeting.status || "status unavailable"}`,
      `  ${meeting.roomName || meeting.roomId} · ${meeting.startAt || "?"} to ${meeting.endAt || "?"}`,
    ].join("\n")),
  ].join("\n");
}

export function formatBookingCreatePreview(preview: BookingCreatePreview, applyCommand?: string): string {
  const lines = [
    "E-Hall booking create preview",
    "Inventory/policy preflight only; exact slot availability is not verified.",
    `${preview.target.roomId} · ${preview.target.start} to ${preview.target.end}`,
    `Title ${preview.target.title || "(missing)"} · participants ${preview.target.participants}`,
  ];
  if (preview.room) {
    lines.push(`Room ${preview.room.name} · capacity ${preview.room.capacity} · ${preview.room.location || preview.room.department || "location unavailable"}`);
  }
  if (preview.blockers.length > 0) {
    lines.push("Blockers:");
    lines.push(...preview.blockers.map((item) => `  - ${item.message}`));
  }
  if (preview.warnings.length > 0) {
    lines.push("Warnings:");
    lines.push(...preview.warnings.map((item) => `  - ${item.message}`));
  }
  if (preview.applyAllowed && applyCommand) {
    lines.push(`Apply: ${applyCommand}`);
  }
  if (!preview.applyAllowed) {
    lines.push("Apply command not generated because the live preflight is blocked.");
  }
  return lines.join("\n");
}

export function formatBookingCancelPreview(preview: BookingCancelPreview, applyCommand?: string): string {
  const lines = [
    "E-Hall booking cancel preview",
    `Meeting ${preview.target.meetingId}`,
  ];
  if (preview.meeting) {
    lines.push(`${preview.meeting.roomName || preview.meeting.roomId} · ${preview.meeting.startAt || "?"} to ${preview.meeting.endAt || "?"}`);
  }
  if (preview.blockers.length > 0) {
    lines.push("Blockers:");
    lines.push(...preview.blockers.map((item) => `  - ${item.message}`));
  }
  if (preview.applyAllowed && applyCommand) {
    lines.push(`Apply: ${applyCommand}`);
  }
  if (!preview.applyAllowed) {
    lines.push("Apply command not generated because the live preflight is blocked.");
  }
  return lines.join("\n");
}

export function formatBookingCreateSuccess(result: BookingCreateSuccess): string {
  return [
    "E-Hall booking created.",
    `${result.meeting.id} · ${result.meeting.roomName || result.meeting.roomId}`,
    `${result.meeting.startAt || result.target.start} to ${result.meeting.endAt || result.target.end}`,
    result.verification.message,
  ].join("\n");
}

export function formatBookingCancelSuccess(result: BookingCancelSuccess): string {
  return [
    "E-Hall booking cancelled.",
    `${result.target.meetingId} · ${result.meeting.roomName || result.meeting.roomId}`,
    result.verification.message,
  ].join("\n");
}

export function formatLibraryBookingUser(user: LibraryBookingUser): string {
  return [
    "Library booking user",
    user.trueName || user.logonName || user.pid || "Authenticated user",
    ...(user.logonName ? [`ID ${user.logonName}`] : []),
    ...([user.deptName, user.className].filter(Boolean).length > 0
      ? [[user.deptName, user.className].filter(Boolean).join(" · ")]
      : []),
  ].join("\n");
}

export function formatLibraryIdleSummary(items: readonly LibraryIdleCategory[]): string {
  if (items.length === 0) return "Library room availability\nNo categories returned.";
  return [
    `Library room availability · ${items.length}`,
    ...items.map((item) => `${item.name.padEnd(18)} ${item.idleQuantity}/${item.totalQuantity} idle`),
  ].join("\n");
}

export function formatLibraryLabs(labs: readonly LibraryLab[]): string {
  if (labs.length === 0) return "Library booking labs\nNo labs returned.";
  return [
    `Library booking labs · ${labs.length}`,
    ...labs.map((lab) => `${String(lab.labId).padEnd(8)} ${lab.labName}`),
  ].join("\n");
}

export function formatLibraryRooms(groups: readonly LibraryCampusGroup[]): string {
  const lines = groups.flatMap((group) => group.labs.flatMap((lab) => lab.rooms.map((room) => [
    `${String(room.devId).padEnd(8)} ${room.devName} · ${room.reserved ? "reserved" : "available"}`,
    `  ${group.campusName} / ${lab.labName} · minimum ${room.minReservationMinutes} min`,
  ].join("\n"))));
  return lines.length === 0
    ? "Library booking rooms\nNo rooms returned."
    : [`Library booking rooms · ${lines.length}`, ...lines].join("\n");
}

export function formatLibraryReservations(items: readonly LibraryReservation[]): string {
  if (items.length === 0) return "Library reservations\nNo reservations in the selected range.";
  return [
    `Library reservations · ${items.length}`,
    ...items.map((item) => [
      `${String(item.reservationId).padEnd(10)} ${item.title || item.roomName} · status ${item.status}`,
      `  ${item.labName} / ${item.roomName} · ${item.beginTime} to ${item.endTime}`,
    ].join("\n")),
  ].join("\n");
}

export function formatLibraryBookingCreatePreview(preview: LibraryBookingCreatePreview, applyCommand?: string): string {
  const lines = [
    "Library booking create preview",
    "Inventory/policy preflight only; exact slot availability is not verified.",
    `${preview.target.devId} · ${preview.target.start} to ${preview.target.end}`,
    `Title ${preview.target.title || "(missing)"} · memberKind ${preview.target.memberKind} · members ${preview.target.members.join(", ")}`,
  ];
  if (preview.room) {
    lines.push(`Room ${preview.room.devName} · minimum ${preview.room.minReservationMinutes} min`);
  }
  if (preview.blockers.length > 0) {
    lines.push("Blockers:");
    lines.push(...preview.blockers.map((item) => `  - ${item.message}`));
  }
  if (preview.warnings.length > 0) {
    lines.push("Warnings:");
    lines.push(...preview.warnings.map((item) => `  - ${item.message}`));
  }
  if (preview.applyAllowed && applyCommand) {
    lines.push(`Apply: ${applyCommand}`);
  }
  if (!preview.applyAllowed) {
    lines.push("Apply command not generated because the live preflight is blocked.");
  }
  return lines.join("\n");
}

export function formatLibraryBookingCancelPreview(preview: LibraryBookingCancelPreview, applyCommand?: string): string {
  const lines = [
    "Library booking cancel preview",
    `Reservation ${preview.target.reservationId}`,
  ];
  if (preview.reservation) {
    lines.push(`${preview.reservation.roomName} · ${preview.reservation.beginTime} to ${preview.reservation.endTime}`);
  }
  if (preview.blockers.length > 0) {
    lines.push("Blockers:");
    lines.push(...preview.blockers.map((item) => `  - ${item.message}`));
  }
  if (preview.applyAllowed && applyCommand) {
    lines.push(`Apply: ${applyCommand}`);
  }
  if (!preview.applyAllowed) {
    lines.push("Apply command not generated because the live preflight is blocked.");
  }
  return lines.join("\n");
}

export function formatLibraryBookingCreateSuccess(result: LibraryBookingCreateSuccess): string {
  return [
    "Library booking created.",
    `${result.reservation.reservationId} · ${result.reservation.roomName}`,
    `${result.reservation.beginTime} to ${result.reservation.endTime}`,
    result.verification.message,
  ].join("\n");
}

export function formatLibraryBookingCancelSuccess(result: LibraryBookingCancelSuccess): string {
  return [
    "Library booking cancelled.",
    `${result.target.reservationId} · ${result.reservation.roomName}`,
    result.verification.message,
  ].join("\n");
}

export function formatPmsServerGroups(groups: readonly PmsServerGroup[]): string {
  if (groups.length === 0) return "PMS printer groups\nNo server groups returned.";
  return [`PMS printer groups · ${groups.length}`, ...groups.map((group) => `${String(group.serverGroup).padEnd(8)} ${group.name}`)].join("\n");
}

export function formatPmsStations(stations: readonly PmsStation[]): string {
  if (stations.length === 0) return "PMS printers\nNo matching printers.";
  return [
    `PMS printers · ${stations.length}`,
    ...stations.map((station) => [
      `${String(station.deviceSn).padEnd(10)} ${station.name} · ${station.statusText}`,
      `  ${station.papers.join(", ") || "paper unavailable"} · ${[station.canPrint && "print", station.canCopy && "copy", station.canScan && "scan", station.canColor && "color"].filter(Boolean).join("/")}`,
    ].join("\n")),
  ].join("\n");
}

export function formatPmsPrintJobs(jobs: readonly PmsPrintJob[]): string {
  if (jobs.length === 0) return "PMS print jobs\nNo pending print jobs.";
  return [
    `PMS print jobs · ${jobs.length}`,
    ...jobs.map((job) => `${String(job.jobId).padEnd(10)} ${job.fileName} · ${job.totalPages} pages × ${job.copies} · ${job.paper} · ${job.duplexLabel}`),
  ].join("\n");
}

export function formatPmsScanJobs(jobs: readonly PmsScanJob[]): string {
  if (jobs.length === 0) return "PMS scan jobs\nNo pending scan jobs.";
  return [
    `PMS scan jobs · ${jobs.length}`,
    ...jobs.map((job) => `${String(job.jobId).padEnd(10)} ${job.fileName} · ${job.fileSize} bytes · ${job.submittedAt}`),
  ].join("\n");
}

export function formatPmsUsage(records: readonly PmsUsageRecord[]): string {
  if (records.length === 0) return "PMS usage history\nNo usage records in the selected range.";
  return [
    `PMS usage history · ${records.length}`,
    ...records.map((record) => `${String(record.id).padEnd(10)} ${record.occurredAt} · ${record.pages} ${record.paper} pages · ¥${record.totalCost.toFixed(2)} · device ${record.deviceSn}`),
  ].join("\n");
}

export function formatPmsUploadPreview(input: PmsPrintUploadPreview): string {
  return [
    "PMS print upload preview — authenticated read-only checks completed; no mutation was performed.",
    "",
    `Checked: ${input.checkedAt}`,
    `File: ${input.file.absolutePath}`,
    `Filename: ${input.file.name}`,
    `Size: ${input.file.size} bytes`,
    `SHA-256: ${input.file.sha256}`,
    `Options: ${input.options.color} · ${input.options.paper} · ${input.options.duplex} · ${input.options.pageFrom === 0 ? "all pages" : `pages ${input.options.pageFrom}-${input.options.pageTo}`} · ${input.options.copies} copy/copies`,
    `Current queue: ${input.existingJobs.length} job(s)`,
    ...(input.warnings.length > 0 ? ["", "Warnings:", ...input.warnings.map((warning) => `- [${warning.code}] ${warning.message}`)] : []),
    "",
    ...(input.confirmation.available && input.confirmation.command
      ? ["Apply command after reviewing the exact file hash and queue state:", input.confirmation.command]
      : ["No apply command was generated."]),
  ].join("\n");
}

export function formatPmsDeletePreview(input: PmsPrintDeletePreview): string {
  return [
    "PMS print-job deletion preview — authenticated read-only checks completed; no mutation was performed.",
    "",
    `Checked: ${input.checkedAt}`,
    `Queue size: ${input.totalJobs} job(s)`,
    `Job: ${input.job.jobId}`,
    `Filename: ${input.job.fileName}`,
    `Created: ${input.job.createdAt || "unknown"}`,
    `Options: ${input.job.paper || "paper unavailable"} · ${input.job.duplexLabel} · ${input.job.copies} copy/copies`,
    "",
    ...(input.confirmation.available && input.confirmation.command
      ? ["Apply command after reviewing the exact job ID:", input.confirmation.command]
      : ["No apply command was generated."]),
  ].join("\n");
}

export function formatPmsUploadSuccess(input: {
  job?: PmsPrintJob;
  verification: { status: "confirmed" | "not_observed" | "unavailable" | "ambiguous"; message: string };
}): string {
  return [
    input.verification.status === "confirmed"
      ? "PMS print upload confirmed by read-back."
      : "PMS print upload request accepted, but verification is incomplete.",
    ...(input.job ? [`Job: ${input.job.jobId} · ${input.job.fileName}`] : []),
    `Verification: ${input.verification.status} — ${input.verification.message}`,
    ...(input.verification.status === "confirmed" ? [] : ["Do not retry automatically; inspect the PMS queue before another write."]),
  ].join("\n");
}

export function formatPmsDeleteSuccess(input: {
  job: PmsPrintJob;
  verification: { status: "confirmed" | "not_observed" | "unavailable" | "ambiguous"; message: string };
}): string {
  return [
    input.verification.status === "confirmed"
      ? "PMS print-job deletion confirmed by read-back."
      : "PMS print-job deletion request accepted, but verification is incomplete.",
    `Job: ${input.job.jobId} · ${input.job.fileName}`,
    `Verification: ${input.verification.status} — ${input.verification.message}`,
    ...(input.verification.status === "confirmed" ? [] : ["Do not retry automatically; inspect the PMS queue before another write."]),
  ].join("\n");
}

export function formatPapers(papers: readonly PaperSummary[], query: string): string {
  if (papers.length === 0) return `Papers · ${query}\nNo matching papers.`;
  return [
    `Papers · ${query} · ${papers.length}`,
    ...papers.map((paper, index) => [
      `${index + 1}. ${paper.title}`,
      `   ${paper.authors.join(", ") || "Authors unavailable"} · ${paper.journal || "Venue unavailable"}${paper.year ? ` · ${paper.year}` : ""}`,
      `   DOI ${paper.doi || "unavailable"} · citations ${paper.citations} · OA ${paper.oa ? "yes" : "no"}`,
      ...(paper.pdfUrl ? [`   ${paper.pdfUrl}`] : []),
    ].join("\n")),
  ].join("\n");
}

export function formatPaperDownload(result: OpenAccessPdfDownload): string {
  return [
    "Open-access PDF downloaded.",
    `DOI: ${result.doi}`,
    `Destination: ${result.destination}`,
    `Source host: ${result.sourceHost}`,
    `Size: ${result.size} bytes`,
    `SHA-256: ${result.sha256}`,
    `Content type: ${result.contentType}`,
    `Overwritten: ${result.overwritten}`,
  ].join("\n");
}

export function formatNcesCourses(courses: readonly NcesCourseSummary[], title: string): string {
  if (courses.length === 0) return `${title}\nNo matching course evaluations.`;
  return [
    `${title} · ${courses.length}`,
    ...courses.map((course) => [
      `${course.code.padEnd(10)} ${course.name} · ${course.teacher || "teacher unavailable"}`,
      `  rating ${course.rating} / reviews ${course.reviewCount} · ${course.semester}`,
      `  difficulty ${course.difficulty.label} · workload ${course.workload.label} · grading ${course.grading.label} · takeaways ${course.takeaways.label}`,
      `  ${course.directUrl}`,
    ].join("\n")),
  ].join("\n");
}

export function formatNcesDetail(course: NcesCourseDetail | null): string {
  if (!course) return "NCES course\nCourse not found.";
  return [
    formatNcesCourses([course], "NCES course"),
    `Reviews · ${course.reviews.length}`,
    ...course.reviews.map((review) => `  ${review.rating}★ · ${review.term} · +${review.upvotes}\n  ${review.content}`),
  ].join("\n\n");
}

export function formatBlackboardUser(user: BlackboardUser): string {
  return `Blackboard user\n${user.displayName || user.userName}\nID ${user.id}`;
}

export function formatBlackboardCourses(courses: readonly BlackboardCourse[]): string {
  if (courses.length === 0) return "Blackboard courses\nNo enrolled courses.";
  return [
    `Blackboard courses · ${courses.length}`,
    ...courses.map((course) => `${course.id.padEnd(12)} ${course.courseCode.padEnd(12)} ${course.name}`),
  ].join("\n");
}

export function formatBlackboardContent(items: readonly BlackboardContentItem[], title: string): string {
  if (items.length === 0) return `${title}\nNo content items.`;
  return [
    `${title} · ${items.length}`,
    ...items.map((item) => `${item.id.padEnd(12)} ${item.kind.padEnd(11)} ${item.title}${item.hasChildren ? " /" : ""}`),
  ].join("\n");
}

export function formatBlackboardAttachments(
  attachments: readonly BlackboardContentAttachment[],
  contentId: string,
): string {
  if (attachments.length === 0) {
    return `Blackboard attachments · content ${contentId}\nNo downloadable attachments.`;
  }
  return [
    `Blackboard attachments · content ${contentId} · ${attachments.length}`,
    ...attachments.map((attachment) => [
      `${attachment.id.padEnd(26)} ${attachment.fileName}`,
      `  ${attachment.mimeType || "type unavailable"} · ${attachment.source}`,
    ].join("\n")),
  ].join("\n");
}

export function formatBlackboardAttachmentDownload(
  result: BlackboardContentAttachmentDownload,
  contentId: string,
): string {
  return [
    "Blackboard attachment downloaded.",
    `Content: ${contentId}`,
    `Attachment: ${result.attachment.fileName} · ${result.attachment.id}`,
    `Saved to: ${result.destination}`,
    `Size: ${result.size} bytes`,
    `SHA-256: ${result.sha256}`,
    `Content type: ${result.contentType || result.attachment.mimeType || "unavailable"}`,
    `Overwritten: ${result.overwritten ? "yes" : "no"}`,
  ].join("\n");
}

export function formatBlackboardAssignments(items: readonly BlackboardAssignment[]): string {
  if (items.length === 0) return "Blackboard assignments\nNo assignment columns.";
  return [
    `Blackboard assignments · ${items.length}`,
    ...items.map((item) => [
      `${item.contentId.padEnd(12)} column ${item.id.padEnd(8)} ${item.title}${item.scorePossible === undefined ? "" : ` · ${item.scorePossible} points`}`,
      `  ${item.grading.due ? `due ${item.grading.due}` : "no due date returned"}${item.grading.attemptsAllowed === undefined || item.grading.attemptsAllowed === 0 ? "" : ` · ${item.grading.attemptsAllowed} attempt(s)`}`,
    ].join("\n")),
  ].join("\n");
}

export function formatBlackboardDeadlines(report: BlackboardDeadlineReport): string {
  if (report.deadlines.length === 0) {
    const partial = report.failures.length > 0 ? ` (${report.failures.length} failure${report.failures.length === 1 ? "" : "s"})` : "";
    return `Blackboard deadlines${partial}\nNo upcoming assignment deadlines.`;
  }
  return [
    `Blackboard deadlines · ${report.deadlines.length}${report.days !== undefined ? ` within ${report.days} day(s)` : ""}${report.failures.length > 0 ? ` · ${report.failures.length} failure(s)` : ""}`,
    ...report.deadlines.map((item) => formatBlackboardDeadlineLine(item)),
  ].join("\n");
}

export function formatBlackboardSearch(report: BlackboardSearchReport): string {
  if (report.results.length === 0) {
    return `Blackboard search · ${report.query}\nNo matching content.${report.failures.length > 0 ? ` ${report.failures.length} failure(s) recorded.` : ""}`;
  }
  return [
    `Blackboard search · ${report.query} · ${report.returned}/${report.totalMatches}${report.failures.length > 0 ? ` · ${report.failures.length} failure(s)` : ""}`,
    ...report.results.map((result) => [
      `${result.courseCode.padEnd(12)} ${result.kind.padEnd(11)} ${result.title}`,
      `  ${result.path}`,
      `  matched ${result.matchReasons.join("+")}${result.attachmentMatches.length > 0 ? ` · attachments: ${result.attachmentMatches.map((attachment) => attachment.fileName).join(", ")}` : ""}`,
    ].join("\n")),
    ...(report.hasMore ? [`Next page: ${report.nextPage}`] : []),
  ].join("\n");
}

export function formatBlackboardSync(report: BlackboardSyncReport): string {
  const header = report.partial
    ? `Blackboard sync partial · ${report.downloadedFiles}/${report.plannedFiles} downloaded`
    : `Blackboard sync complete · ${report.downloadedFiles}/${report.plannedFiles} downloaded`;
  if (report.files.length === 0) {
    return `${header}${report.failures.length > 0 ? ` · ${report.failures.length} failure(s)` : ""}\nNo files were written.`;
  }
  return [
    `${header}${report.failures.length > 0 ? ` · ${report.failures.length} failure(s)` : ""}`,
    `Destination: ${report.destination}`,
    ...report.files.map((file) => `${file.relativePath}\n  ${file.size} bytes · sha256 ${file.sha256}${file.overwritten ? " · overwritten" : ""}`),
  ].join("\n");
}

export function formatBlackboardAttempts(
  assignment: BlackboardAssignment,
  attempts: readonly BlackboardAttempt[],
): string {
  if (attempts.length === 0) {
    return `Blackboard attempts · ${assignment.title}\nNo attempts returned.`;
  }
  return [
    `Blackboard attempts · ${assignment.title} · ${attempts.length}`,
    ...attempts.map((attempt) => [
      `${attempt.id.padEnd(10)} ${attempt.status || "status unavailable"}${attempt.displayGradeText ? ` · ${attempt.displayGradeText}` : ""}`,
      `  created ${attempt.created || "unknown"}${attempt.attemptReceipt?.submissionDate ? ` · submitted ${attempt.attemptReceipt.submissionDate}` : ""}`,
    ].join("\n")),
  ].join("\n");
}

export function formatBlackboardSubmitPreview(input: {
  target: { courseId: string; contentId?: string; columnId?: string };
  assignment: BlackboardAssignment;
  content: BlackboardContentItem;
  attemptsUsed: number;
  remainingAttempts?: number;
  inProgressAttempts: number;
  file: BlackboardSubmissionFile;
  commentSummary: { present: boolean; length: number };
  blockers: readonly { code: string; message: string }[];
  warnings: readonly { code: string; message: string }[];
  late: boolean;
  applyAllowed: boolean;
  confirmation: { available: boolean; command?: string };
}): string {
  const attemptsSummary = input.assignment.grading.attemptsAllowed !== undefined && input.assignment.grading.attemptsAllowed > 0
    ? `${input.attemptsUsed}/${input.assignment.grading.attemptsAllowed}`
    : `${input.attemptsUsed}`;
  return [
    "Blackboard submission preview — authenticated read-only checks completed; no mutation was performed.",
    "",
    `Course: ${input.target.courseId}`,
    `Assignment: ${input.assignment.title}`,
    `Content: ${input.assignment.contentId} · column ${input.assignment.id}`,
    `Handler: ${input.content.handler || "unknown"} · kind ${input.content.kind}`,
    `Availability: ${input.assignment.availability || "unknown"} · grading ${input.assignment.grading.type || "unknown"}`,
    ...(input.assignment.grading.due ? [`Due: ${input.assignment.grading.due}${input.late ? " (past due)" : ""}`] : []),
    `Attempts used: ${attemptsSummary}${input.remainingAttempts !== undefined ? ` · remaining ${input.remainingAttempts}` : ""}`,
    `In-progress attempts: ${input.inProgressAttempts}`,
    `File: ${input.file.absolutePath}`,
    `Filename: ${input.file.name}`,
    `Size: ${input.file.size} bytes`,
    `SHA-256: ${input.file.sha256}`,
    ...(input.commentSummary.present ? [`Comment: present (${input.commentSummary.length} chars)`] : []),
    ...(input.blockers.length > 0 ? ["", "Blockers:", ...input.blockers.map((issue) => `- [${issue.code}] ${issue.message}`)] : []),
    ...(input.warnings.length > 0 ? ["", "Warnings:", ...input.warnings.map((issue) => `- [${issue.code}] ${issue.message}`)] : []),
    "",
    ...(input.confirmation.available && input.confirmation.command
      ? ["Apply command after reviewing the exact target, file hash, and warnings:", input.confirmation.command]
      : ["No apply command was generated because the live preflight is blocked."]),
  ].join("\n");
}

export function formatBlackboardSubmissionSuccess(input: {
  assignment: BlackboardAssignment;
  attempt: BlackboardAttempt;
  files: readonly BlackboardAttemptFile[];
  verification: { status: "confirmed" | "not_observed" | "unavailable"; message: string };
}): string {
  const fileLine = input.files.length > 0
    ? input.files.map((file) => file.name).join(", ")
    : "No files were read back.";
  return [
    input.verification.status === "confirmed"
      ? "Blackboard submission confirmed by read-back."
      : "Blackboard submission request accepted, but verification is incomplete.",
    `Assignment: ${input.assignment.title}`,
    `Attempt: ${input.attempt.id}`,
    `Status: ${input.attempt.status || "unknown"}`,
    `Files: ${fileLine}`,
    ...(input.attempt.attemptReceipt
      ? [`Receipt: ${input.attempt.attemptReceipt.receiptId} · ${input.attempt.attemptReceipt.submissionDate}`]
      : []),
    `Verification: ${input.verification.status} — ${input.verification.message}`,
    ...(input.verification.status === "confirmed" ? [] : ["Do not retry automatically; inspect Blackboard before another write."]),
  ].join("\n");
}

function formatBlackboardDeadlineLine(item: BlackboardDeadline): string {
  return [
    `${item.courseCode.padEnd(12)} ${item.title}`,
    `  due ${item.dueAt} · in ${item.daysLeft} day(s) · content ${item.contentId} · column ${item.columnId}`,
  ].join("\n");
}

export function formatWsPrograms(programs: readonly WsProgramSummary[]): string {
  if (programs.length === 0) return "SUSTech Global programs\nNo matching programs.";
  return [
    `SUSTech Global programs · ${programs.length}`,
    ...programs.map((program) => [
      `${program.id.padEnd(8)} ${program.name || program.nameEn}`,
      `  ${program.schoolName} · ${program.regionName} · ${program.projectType}`,
      `  apply ${program.applyBeginDate || "?"} to ${program.applyEndDate || "?"} · ${program.status}`,
    ].join("\n")),
  ].join("\n");
}

export function formatWsDetail(detail: WsProgramDetail): string {
  const lines = ["SUSTech Global program detail"];
  for (const [section, values] of Object.entries(detail.sections)) {
    lines.push(section);
    for (const [key, value] of Object.entries(values)) lines.push(`  ${key}: ${value}`);
  }
  if (detail.tables.length > 0) lines.push(`Tables: ${detail.tables.length}`);
  return lines.join("\n");
}
