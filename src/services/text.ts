import type {
  BlackboardAssignment,
  BlackboardAssignmentsAggregateReport,
  BlackboardAssignmentsWithAttemptsReport,
  BlackboardGradesReport,
  BlackboardAnnouncement,
  BlackboardAnnouncementsReport,
  BlackboardAttempt,
  BlackboardAttemptFile,
  BlackboardAttemptFileDownload,
  BlackboardCourseMembership,
  BlackboardCourseMessageFoldersPage,
  BlackboardCourseMessageParticipantsPage,
  BlackboardCourseMessagesPage,
  BlackboardCourseRosterPage,
  BlackboardCourse,
  BlackboardDiscussion,
  BlackboardDiscussionGroup,
  BlackboardDiscussionMessage,
  BlackboardDiscussionGroupsPage,
  BlackboardDiscussionMessagesPage,
  BlackboardDiscussionRepliesPage,
  BlackboardDiscussionsPage,
  BlackboardDeadline,
  BlackboardDeadlineReport,
  BlackboardCalendarItemsReport,
  BlackboardContentAttachment,
  BlackboardContentAttachmentDownload,
  BlackboardContentTreeReport,
  BlackboardContentTypesReport,
  BlackboardContentItem,
  BlackboardSearchMatch,
  BlackboardSearchReport,
  BlackboardSubmissionFile,
  BlackboardSubmissionText,
  BlackboardSyncReport,
  BlackboardUser,
} from "./blackboard.js";
import { sampleText } from "./base.js";
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
  LibraryCatalogDetail,
  LibraryBookingCancelPreview,
  LibraryBookingCancelSuccess,
  LibraryBookingCreatePreview,
  LibraryBookingCreateSuccess,
  LibraryBookingUser,
  LibraryCampusGroup,
  LibraryIdleCategory,
  LibraryLab,
  PrimoCatalogSearchPage,
  LibraryReservation,
} from "./library.js";
import {
  termIdToDisplay,
  type NcesCourseDetail,
  type NcesCourseFilterOptions,
  type NcesGlobalStats,
  type NcesRankedCourse,
  type NcesRankings,
  type NcesRankingCategory,
  type NcesCourseStats,
  type NcesCourseSummary,
  type NcesDistributionPoint,
  type NcesReview,
  type NcesReviewPage,
  type NcesReviewRanking,
  type NcesTeacherDetail,
  type NcesTeacherRanking,
  type NcesTeacherSummary,
  type NcesUserRanking,
} from "./nces.js";
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
  const exactSlotLine = preview.slotCheck?.status === "available"
    ? `Exact slot check: available on ${preview.slotCheck.date}.`
    : preview.slotCheck?.status === "occupied"
      ? `Exact slot check: occupied on ${preview.slotCheck.date} (${preview.slotCheck.overlaps.length} overlap).`
      : preview.slotCheck?.status === "unavailable"
        ? "Exact slot check: unavailable; apply is blocked because overlap could not be ruled out."
        : "Inventory/policy preflight only; exact slot availability is not verified.";
  const lines = [
    "E-Hall booking create preview",
    exactSlotLine,
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

export function formatLibraryCatalogSearch(page: PrimoCatalogSearchPage): string {
  if (page.items.length === 0) {
    return [
      "Library catalog search",
      `Query ${page.query}`,
      "No matching catalog records.",
    ].join("\n");
  }
  return [
    `Library catalog search · ${page.items.length}/${page.total}`,
    `Query ${page.query}`,
    ...page.items.map((item) => {
      const tags = [
        item.format || "format unavailable",
        item.reference,
        ...(item.fullText ? ["full text"] : []),
        ...(item.peerReviewed ? ["peer reviewed"] : []),
      ];
      return [
        `${String(item.rank).padStart(2, " ")}. ${item.title}`,
        `  ${tags.join(" · ")}`,
        ...(item.snippet ? [`  ${item.snippet}`] : []),
        ...(item.detailUrl ? [`  ${item.detailUrl}`] : []),
      ].join("\n");
    }),
  ].join("\n");
}

export function formatLibraryCatalogDetail(detail: LibraryCatalogDetail): string {
  const lines = [
    "Library catalog detail",
    `${detail.reference} · ${detail.title}`,
    ...(detail.format ? [`Format ${detail.format}`] : []),
    ...(detail.creators.length > 0 ? [`Creators ${detail.creators.join("; ")}`] : []),
    ...(detail.publisher ? [`Publisher ${detail.publisher}`] : []),
    ...(detail.isPartOf ? [`Part of ${detail.isPartOf}`] : []),
    ...(detail.date ? [`Date ${detail.date}`] : []),
    ...(detail.language ? [`Language ${detail.language}`] : []),
    ...(detail.subjects.length > 0 ? [`Subjects ${detail.subjects.join("; ")}`] : []),
    ...(detail.identifiers.length > 0 ? [`Identifiers ${detail.identifiers.join("; ")}`] : []),
    ...(detail.availability.length > 0 ? [`Availability ${detail.availability.join("; ")}`] : []),
    ...(detail.links.length > 0 ? [`Links ${detail.links.join(" ")}`] : []),
    ...(detail.description ? [`Description ${detail.description}`] : []),
  ];
  return lines.join("\n");
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
  const exactSlotLine = preview.slotCheck?.status === "available"
    ? "Exact slot check: available."
    : preview.slotCheck?.status === "occupied"
      ? `Exact slot check: occupied (${preview.slotCheck.overlaps.length} overlap).`
      : preview.slotCheck?.status === "unavailable"
        ? "Exact slot check: unavailable; apply is blocked because overlap could not be ruled out."
        : "Inventory/policy preflight only; exact slot availability is not verified.";
  const lines = [
    "Library booking create preview",
    exactSlotLine,
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
      `  rating ${formatNullableNcesRating(course.rating)} / reviews ${course.reviewCount} · ${course.semester}`,
      `  difficulty ${formatNullableNcesDimension(course.difficulty)} · workload ${formatNullableNcesDimension(course.workload)} · grading ${formatNullableNcesDimension(course.grading)} · takeaways ${formatNullableNcesDimension(course.takeaways)}`,
      `  ${course.directUrl}`,
    ].join("\n")),
  ].join("\n");
}

export function formatNcesFilterOptions(options: NcesCourseFilterOptions): string {
  if (options.offeringUnits.length === 0) return "NCES browse filters\nNo live offering-unit filters were returned.";
  return [
    `NCES browse filters · ${options.offeringUnits.length} offering unit(s)`,
    ...options.offeringUnits.map((unit) => `- ${unit}`),
  ].join("\n");
}

export function formatNcesGlobalStats(stats: NcesGlobalStats): string {
  return [
    `NCES global stats · ${stats.courseCount} course(s) · ${stats.reviewCount} review(s)`,
    `${stats.userCount} user(s) · ${stats.teacherCount} teacher(s) · ${stats.registeredTeacherCount} registered teacher(s) · running ${stats.runningDays} day(s)`,
    `Average course rating ${stats.courseAverageRating} · average reviews per course ${stats.averageReviewsPerCourse}`,
    `Review scores · ${formatDistributionPreview(stats.reviewRateDistribution)}`,
    `Course rating buckets · ${formatDistributionPreview(stats.courseRateDistribution)}`,
    `Recent review months · ${formatDistributionTail(stats.reviewMonthlyDistribution, 3)}`,
    `Recent new-user months · ${formatDistributionTail(stats.userMonthlyDistribution, 3)}`,
    "Community-maintained evaluation data; not an official academic record.",
  ].join("\n");
}

export function formatNcesDetail(course: NcesCourseDetail | null): string {
  if (!course) return "NCES course\nCourse not found.";
  const lines = [
    formatNcesCourses([course], "NCES course"),
    ...([course.department, course.courseType, course.credit === undefined ? "" : `${course.credit} credits`].filter(Boolean).length > 0
      ? [[course.department, course.courseType, course.credit === undefined ? "" : `${course.credit} credits`].filter(Boolean).join(" · ")]
      : []),
    ...(course.teachers.length > 0 ? [`Teachers · ${course.teachers.map((teacher) => teacher.name).join(", ")}`] : []),
    ...(course.description ? [`Description · ${course.description}`] : []),
    formatNcesDetailReviewSummary(course),
    ...course.reviews.map((review) => `  ${review.rating}★ · ${review.term} · +${review.upvotes}\n  ${review.content}`),
  ];
  if (course.aiSummary) {
    lines.push(
      `NCES AI summary · ${course.aiSummary.sourceReviewCount} source review(s) · ${course.aiSummary.generatedAt || "generation time unavailable"}`,
      course.aiSummary.overview,
      `Advisory · ${course.aiSummary.advisory}`,
    );
  }
  return lines.join("\n\n");
}

export function formatNcesSearch(
  query: string,
  courses: readonly NcesCourseSummary[],
  teachers: readonly NcesTeacherSummary[],
  reviews: readonly NcesReview[],
  options: {
    type?: "all" | "course" | "teacher" | "review";
    courseTotal?: number;
    teacherTotal?: number;
    reviewTotal?: number;
    page?: number;
    perPage?: number;
  } = {},
): string {
  const blocks: string[] = [];
  const header = options.type === "all"
    ? `NCES search · ${query}\nBucket totals · courses ${options.courseTotal ?? courses.length} · teachers ${options.teacherTotal ?? teachers.length} · reviews ${options.reviewTotal ?? reviews.length}${options.page !== undefined && options.perPage !== undefined ? ` · page ${options.page} · page size ${options.perPage}` : ""}`
    : "";
  if (courses.length > 0) blocks.push(formatNcesCourses(courses, `NCES courses · ${query}`));
  if (teachers.length > 0) {
    blocks.push([
      `NCES teachers · ${teachers.length}`,
      ...teachers.map((teacher) => `${teacher.teacherId} · ${teacher.name}${teacher.title ? ` · ${teacher.title}` : ""}\n  ${teacher.directUrl}`),
    ].join("\n"));
  }
  if (reviews.length > 0) {
    blocks.push([
      `NCES review matches · ${reviews.length}`,
      ...reviews.map((review) => `${review.rating}★ · ${review.author} · ${review.term}\n  ${review.content}`),
    ].join("\n"));
  }
  if (blocks.length === 0) return `${header || `NCES search · ${query}`}\n${header ? "" : ""}${header ? "\n\n" : "\n"}No matching public community records.`;
  return header ? `${header}\n\n${blocks.join("\n\n")}` : blocks.join("\n\n");
}

export function formatNcesTeacher(teacher: NcesTeacherDetail | null): string {
  if (!teacher) return "NCES teacher\nTeacher not found.";
  return [
    `NCES teacher · ${teacher.name}`,
    [teacher.title, teacher.email, teacher.officePhone].filter(Boolean).join(" · ") || "Public profile details unavailable.",
    `Community rating ${formatNullableNcesRating(teacher.reviewCount > 0 ? teacher.averageRate : null)} · ${teacher.reviewCount} review(s)`,
    ...(teacher.researchInterest ? [`Research · ${teacher.researchInterest}`] : []),
    ...(teacher.description ? [`Profile · ${teacher.description}`] : []),
    formatNcesCourses(teacher.courses, "Courses"),
    teacher.directUrl,
  ].join("\n");
}

export function formatNcesStats(courseId: number, stats: NcesCourseStats | null): string {
  if (!stats) return `NCES course stats · ${courseId}\nCourse stats not found.`;
  return [
    `NCES course stats · ${courseId} · ${stats.reviewCount} review(s)`,
    `Ratings · ${Object.entries(stats.ratingDistribution).map(([rating, count]) => `${rating}★:${count}`).join(" · ") || "unavailable"}`,
    ...stats.termStats.map((term) => `${term.term} · ${term.reviewCount} review(s)${term.ratingAverage === undefined ? "" : ` · ${term.ratingAverage}★`}`),
    "Community-maintained evaluation data; not an official academic record.",
  ].join("\n");
}

export function formatNcesRankings(
  rankings: NcesRankings,
  category: NcesRankingCategory,
  items: readonly NcesTeacherRanking[] | readonly NcesRankedCourse[] | readonly NcesReviewRanking[] | readonly NcesUserRanking[],
): string {
  return [
    `NCES rankings · ${category} · ${items.length}`,
    `Community averages · rating ${rankings.stats.averageRating} · reviews/course ${rankings.stats.averageReviewCount} · upvotes/review ${rankings.stats.averageReviewUpvotes} · chars/review ${rankings.stats.averageReviewLength}`,
    ...formatRankingItems(category, items),
    "Community-maintained evaluation data; not an official academic record.",
  ].join("\n");
}

export function formatNcesReviews(page: NcesReviewPage): string {
  return [
    `NCES reviews · course ${page.courseId} · ${page.items.length}/${page.total} · page ${page.page}/${page.pages || "?"}`,
    ...page.items.map((review) => `${review.rating}★ · ${review.author} · ${review.term} · +${review.upvotes}\n  ${review.content}`),
    "Community-maintained reviews; verify important course facts against official sources.",
  ].join("\n");
}

export function formatNcesCourseByCode(
  code: string,
  term: string | undefined,
  course: NcesCourseDetail | null,
): string {
  if (!course) {
    return `NCES by code\n${code}${term ? ` · ${term}` : ""}\nCourse not found.`;
  }
  const availableTerms = [...new Set([
    ...course.terms.map((item) => item.termId).filter(Boolean),
    ...course.reviewTerms.filter(Boolean),
  ])];
  const termMatched = term === undefined
    ? undefined
    : availableTerms.includes(term) || course.semesters.includes(termIdToDisplay(term));
  return [
    `NCES by code · ${code}${term ? ` · requested ${termIdToDisplay(term)}` : ""}`,
    `${course.code.padEnd(10)} ${course.name} · ${course.teacher || "teacher unavailable"}`,
    `Department ${course.department || "unavailable"}${course.courseType ? ` · ${course.courseType}` : ""}`,
    `Community rating ${formatNullableNcesRating(course.rating)} / reviews ${course.reviewCount}`,
    `Available terms · ${availableTerms.length > 0 ? availableTerms.map((termId) => termIdToDisplay(termId)).join(", ") : "unavailable"}`,
    ...(term ? [`Requested term match · ${termMatched ? "yes" : "not confirmed in course offerings"}`] : []),
    course.directUrl,
    formatNcesDetailReviewSummary(course),
    ...course.reviews.map((review) => `  ${review.rating}★ · ${review.term} · +${review.upvotes}\n  ${review.content}`),
    ...(course.aiSummary
      ? [
          `NCES AI summary · ${course.aiSummary.sourceReviewCount} source review(s) · ${course.aiSummary.generatedAt || "generation time unavailable"}`,
          course.aiSummary.overview,
          `Advisory · ${course.aiSummary.advisory}`,
        ]
      : []),
  ].join("\n\n");
}

function formatNcesDetailReviewSummary(course: NcesCourseDetail): string {
  const reviewWindow = `${course.reviews.length}/${course.reviewResultsTotal || course.reviews.length}`;
  const reviewPages = course.reviewResultsPages > 0 ? course.reviewResultsPages : 0;
  if (course.reviewFilterTerm) {
    return `Reviews loaded · ${reviewWindow} for ${termIdToDisplay(course.reviewFilterTerm)} across ${reviewPages} page(s) · course total ${course.reviewCount}; use \`nces reviews ${course.ncesId} --term ${course.reviewFilterTerm}\` for paginated inspection.`;
  }
  if (course.reviews.length < course.reviewResultsTotal) {
    return `Reviews loaded · ${reviewWindow} across ${reviewPages} page(s) from NCES · course total ${course.reviewCount}; use \`nces reviews ${course.ncesId}\` for paginated inspection or rerun with \`--all-reviews\` to load every current page.`;
  }
  if (course.reviewCount !== course.reviewResultsTotal) {
    return `Reviews loaded · ${reviewWindow} across ${reviewPages} page(s) from NCES · course total ${course.reviewCount}.`;
  }
  return `Reviews loaded · ${reviewWindow} across ${reviewPages} page(s) from NCES.`;
}

function formatDistributionPreview(points: readonly NcesDistributionPoint[]): string {
  if (points.length === 0) return "unavailable";
  return points.map((point) => `${point.label}:${point.value}`).join(" · ");
}

function formatDistributionTail(points: readonly NcesDistributionPoint[], count: number): string {
  if (points.length === 0) return "unavailable";
  return points.slice(-count).map((point) => `${point.label}:${point.value}`).join(" · ");
}

function formatRankingItems(
  category: NcesRankingCategory,
  items: readonly NcesTeacherRanking[] | readonly NcesRankedCourse[] | readonly NcesReviewRanking[] | readonly NcesUserRanking[],
): string[] {
  if (category === "top-teachers") {
    return (items as readonly NcesTeacherRanking[]).map((teacher, index) => [
      `${index + 1}. ${teacher.name}${teacher.department ? ` · ${teacher.department}` : ""}`,
      `   normalized ${teacher.normalizedRating} · courses ${teacher.courseCount} · reviews ${teacher.reviewCount}`,
      `   ${teacher.directUrl}`,
    ].join("\n"));
  }
  if (category === "top-rated-courses" || category === "popular-courses") {
    return (items as readonly NcesRankedCourse[]).map((course, index) => [
      `${index + 1}. ${course.code} ${course.name} · ${course.teacher || "teacher unavailable"}`,
      `   normalized ${course.normalizedRating} · rating ${formatNullableNcesRating(course.rating)} · reviews ${course.reviewCount} · ${course.semester}`,
      `   ${course.directUrl}`,
    ].join("\n"));
  }
  if (category === "top-reviews" || category === "long-reviews") {
    return (items as readonly NcesReviewRanking[]).map((review, index) => [
      `${index + 1}. ${review.courseName} · review ${review.reviewId}`,
      `   ${review.author} · anonymous ${review.anonymous ? "yes" : "no"} · upvotes ${review.upvotes} · length ${review.contentLength}`,
      `   ${review.courseUrl}`,
    ].join("\n"));
  }
  return (items as readonly NcesUserRanking[]).map((user, index) => [
    `${index + 1}. ${user.username}${user.identity ? ` · ${user.identity}` : ""}`,
    `   reviews ${user.reviewCount} · upvotes ${user.reviewUpvotes} · length ${user.reviewLength} · score ${user.score}`,
    ...(user.avatar ? [`   avatar ${user.avatar}`] : []),
  ].join("\n"));
}

function formatNullableNcesRating(value: number | null): string {
  return value === null ? "unavailable" : String(value);
}

function formatNullableNcesDimension(value: NcesCourseSummary["difficulty"]): string {
  return value?.label ?? "unavailable";
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

export function formatBlackboardAssignmentsWithAttempts(
  report: BlackboardAssignmentsWithAttemptsReport,
  options: {
    assignments?: readonly BlackboardAssignmentsWithAttemptsReport["assignments"][number][];
    submissionState?: string;
  } = {},
): string {
  const assignments = options.assignments ?? report.assignments;
  if (assignments.length === 0) {
    return options.submissionState
      ? `Blackboard assignments\nNo assignment columns matched submission state ${options.submissionState}.`
      : "Blackboard assignments\nNo assignment columns.";
  }
  const attemptedShown = assignments.filter((item) => (item.attemptSummary?.totalAttempts ?? 0) > 0).length;
  return [
    `Blackboard assignments · ${assignments.length}/${report.totalAssignments}${options.submissionState ? ` · state ${options.submissionState}` : ""} · ${attemptedShown} with attempt(s)${report.failures.length > 0 ? ` · ${report.failures.length} failure(s)` : ""}`,
    ...assignments.map(({ assignment, attemptSummary }) => [
      `${assignment.contentId.padEnd(12)} column ${assignment.id.padEnd(8)} ${assignment.title}${assignment.scorePossible === undefined ? "" : ` · ${assignment.scorePossible} points`}`,
      `  ${assignment.grading.due ? `due ${assignment.grading.due}` : "no due date returned"}${assignment.grading.attemptsAllowed === undefined || assignment.grading.attemptsAllowed === 0 ? "" : ` · ${assignment.grading.attemptsAllowed} attempt(s)`}`,
      attemptSummary
        ? `  ${formatBlackboardAssignmentAttemptSummary(attemptSummary)}`
        : "  attempt summary unavailable",
    ].join("\n")),
  ].join("\n");
}

export function formatBlackboardAssignmentsAcrossCourses(
  report: BlackboardAssignmentsAggregateReport,
): string {
  const header = `Blackboard assignments · ${report.assignments.length}/${report.totalAssignments} across ${report.coursesMatched} course(s)`
    + `${report.courseQuery ? ` · query ${report.courseQuery}` : ""}`
    + `${report.withAttempts ? " · attempts included" : ""}`
    + `${report.submissionState ? ` · state ${report.submissionState}` : ""}`
    + `${report.failures.length > 0 ? ` · ${report.failures.length} failure(s)` : ""}`;
  if (report.assignments.length === 0) {
    return report.submissionState
      ? `${header}\nNo assignment columns matched submission state ${report.submissionState}.`
      : `${header}\nNo assignment columns returned.`;
  }
  return [
    header,
    ...report.assignments.map(({ courseId, courseCode, courseName, assignment, attemptSummary }) => [
      `${courseCode || courseId} · ${courseName || courseId}`,
      `  ${assignment.contentId.padEnd(12)} column ${assignment.id.padEnd(8)} ${assignment.title}${assignment.scorePossible === undefined ? "" : ` · ${assignment.scorePossible} points`}`,
      `  ${assignment.grading.due ? `due ${assignment.grading.due}` : "no due date returned"}${assignment.grading.attemptsAllowed === undefined || assignment.grading.attemptsAllowed === 0 ? "" : ` · ${assignment.grading.attemptsAllowed} attempt(s)`}`,
      ...(report.withAttempts ? [attemptSummary ? `  ${formatBlackboardAssignmentAttemptSummary(attemptSummary)}` : "  attempt summary unavailable"] : []),
    ].join("\n")),
  ].join("\n");
}

export function formatBlackboardGrades(report: BlackboardGradesReport): string {
  const header = `Blackboard grades · ${report.grades.length}/${report.attemptedAssignments} attempted item(s)`
    + `${report.courseQuery ? ` · query ${report.courseQuery}` : ""}`
    + `${report.submissionState ? ` · state ${report.submissionState}` : ""}`
    + `${report.limit !== undefined ? ` · limit ${report.limit}` : ""}`
    + `${report.failures.length > 0 ? ` · ${report.failures.length} failure(s)` : ""}`;
  if (report.grades.length === 0) {
    return report.submissionState
      ? `${header}\nNo attempted Blackboard items matched submission state ${report.submissionState}.`
      : `${header}\nNo attempted Blackboard items returned.`;
  }
  return [
    header,
    ...report.grades.map(({ courseId, courseCode, courseName, assignment, attemptSummary }) => [
      `${courseCode || courseId} · ${courseName || courseId}`,
      `  ${assignment.title}${assignment.scorePossible === undefined ? "" : ` · ${assignment.scorePossible} points`}`,
      `  ${formatBlackboardAssignmentAttemptSummary(attemptSummary)}`,
      ...(assignment.grading.due ? [`  due ${assignment.grading.due} · content ${assignment.contentId} · column ${assignment.id}`] : [`  content ${assignment.contentId} · column ${assignment.id}`]),
    ].join("\n")),
  ].join("\n");
}

export function formatBlackboardAnnouncements(report: BlackboardAnnouncementsReport): string {
  const header = `Blackboard announcements · ${report.announcements.length}`
    + `${report.days !== undefined ? ` within ${report.days} day(s)` : ""}`
    + `${report.failures.length > 0 ? ` · ${report.failures.length} failure(s)` : ""}`;
  if (report.announcements.length === 0) {
    return `${header}\nNo announcements returned.`;
  }
  return [
    header,
    ...report.announcements.map((announcement) => formatBlackboardAnnouncement(announcement)),
  ].join("\n");
}

export function formatBlackboardDiscussions(report: BlackboardDiscussionsPage): string {
  const originalFallback = report.discussions.some((discussion) => discussion.source === "original-html");
  const header = `Blackboard discussions · ${report.courseCode || report.courseId}`
    + `${report.title ? ` · title ${report.title}` : ""}`
    + `${report.gradable !== undefined ? ` · gradable ${report.gradable ? "true" : "false"}` : ""}`
    + `${report.sort ? ` · sort ${report.sort}` : ""}`
    + ` · page ${report.page}`
    + `${originalFallback ? " · Original HTML fallback" : ""}`
    + `${report.hasMore ? " · more available" : ""}`;
  if (report.discussions.length === 0) {
    return `${header}\nNo discussion forums returned.`;
  }
  return [
    header,
    ...report.discussions.map((discussion) => [
      `${discussion.id.padEnd(10)} ${discussion.title || "Untitled discussion"}`
        + `${discussion.gradable ? " · gradable" : ""}`
        + `${discussion.groupDiscussion ? " · group" : ""}`
        + `${discussion.source === "original-html" ? " · original-html" : ""}`
        + `${discussion.available ? "" : " · unavailable"}`,
      `  created ${discussion.createdDate || "unknown"} · updated ${discussion.modifiedDate || "unknown"}`
        + `${discussion.gradebookColumnId ? ` · column ${discussion.gradebookColumnId}` : ""}`,
      ...(
        discussion.totalPosts !== undefined
          ? [
            `  posts ${discussion.totalPosts} · unread ${discussion.unreadPosts ?? 0} · unread replies to me ${discussion.unreadRepliesToMe ?? 0} · participants ${discussion.totalParticipants ?? 0}`
              + `${discussion.metadataPartial ? " · metadata partial" : ""}`,
          ]
          : discussion.metadataPartial
            ? ["  metadata partial"]
            : []
      ),
      ...(discussion.description ? [`  description ${sampleText(discussion.description, 180)}`] : []),
      ...(discussion.topic?.body ? [`  topic ${sampleText(discussion.topic.body, 180)}`] : []),
    ].join("\n")),
    ...(report.hasMore ? [`Next page: ${report.nextPage}`] : []),
  ].join("\n");
}

export function formatBlackboardDiscussionGroups(report: BlackboardDiscussionGroupsPage): string {
  const discussion = report.discussion;
  const header = `Blackboard discussion groups · ${report.courseCode || report.courseId} · ${discussion.title || discussion.id}`
    + `${discussion.groupDiscussion ? " · group" : ""}`
    + `${report.sort ? ` · sort ${report.sort}` : ""}`
    + ` · page ${report.page}`
    + `${report.hasMore ? " · more available" : ""}`;
  if (report.groups.length === 0) {
    return `${header}\nNo discussion groups returned.`;
  }
  return [
    header,
    ...report.groups.map(formatBlackboardDiscussionGroupLine),
    ...(report.hasMore ? [`Next page: ${report.nextPage}`] : []),
  ].join("\n");
}

export function formatBlackboardDiscussion(report: BlackboardDiscussionMessagesPage): string {
  const discussion = report.discussion;
  const originalFallback = discussion.source === "original-html" || report.messages.some((message) => message.source === "original-html");
  const header = `Blackboard discussion · ${report.courseCode || report.courseId} · ${discussion.title || discussion.id}`
    + `${discussion.gradable ? " · gradable" : ""}`
    + `${discussion.groupDiscussion ? " · group" : ""}`
    + `${report.status ? ` · status ${report.status}` : ""}`
    + `${report.userId ? ` · user ${report.userId}` : ""}`
    + `${report.groupId ? ` · groupId ${report.groupId}` : ""}`
    + `${report.isRead !== undefined ? ` · isRead ${report.isRead ? "true" : "false"}` : ""}`
    + `${report.sort ? ` · sort ${report.sort}` : ""}`
    + ` · page ${report.page}`
    + `${originalFallback ? " · Original HTML fallback" : ""}`
    + `${report.hasMore ? " · more available" : ""}`;
  const lines = [
    header,
    `Discussion ID ${discussion.id} · available ${discussion.available ? "yes" : "no"} · created ${discussion.createdDate || "unknown"} · updated ${discussion.modifiedDate || "unknown"}`
      + `${discussion.gradebookColumnId ? ` · column ${discussion.gradebookColumnId}` : ""}`
      + `${discussion.metadataPartial ? " · metadata partial" : ""}`,
  ];
  if (discussion.totalPosts !== undefined) {
    lines.push(
      `Discussion stats · posts ${discussion.totalPosts} · unread ${discussion.unreadPosts ?? 0} · unread replies to me ${discussion.unreadRepliesToMe ?? 0} · participants ${discussion.totalParticipants ?? 0}`,
    );
  }
  if (discussion.topic?.body) {
    lines.push(`Topic ${sampleText(discussion.topic.body, 240)}`);
  }
  if (report.messages.length === 0) {
    lines.push("No discussion messages returned.");
    return lines.join("\n");
  }
  lines.push(...report.messages.map((message) => [
    `${message.id.padEnd(10)} ${message.subject ? `${message.subject} · ` : ""}${message.author || message.userId || "Unknown author"} · ${message.status || "status unavailable"}${message.isRead ? " · read" : " · unread"}${message.source === "original-html" ? " · original-html" : ""}`,
    `  posted ${message.postDate || message.createdDate || "unknown"}${message.groupId ? ` · group ${message.groupId}` : ""}${message.parentId ? ` · parent ${message.parentId}` : ""}`,
    ...(
      message.totalPosts !== undefined
        ? [`  posts ${message.totalPosts} · unread ${message.unreadPosts ?? 0} · unread replies to me ${message.unreadRepliesToMe ?? 0}${message.metadataPartial ? " · metadata partial" : ""}`]
        : message.metadataPartial
          ? ["  metadata partial"]
          : []
    ),
    `  ${sampleText(message.body, 240) || "(empty)"}`,
  ].join("\n")));
  if (report.hasMore) lines.push(`Next page: ${report.nextPage}`);
  return lines.join("\n");
}

function formatBlackboardDiscussionGroupLine(group: BlackboardDiscussionGroup): string {
  return `${group.groupId.padEnd(10)} thread ${group.threadId || "unavailable"} · discussion ${group.discussionId}`;
}

export function formatBlackboardDiscussionReplies(report: BlackboardDiscussionRepliesPage): string {
  const originalFallback = report.replies.some((reply) => reply.source === "original-html");
  const header = `Blackboard discussion replies · ${report.courseCode || report.courseId} · discussion ${report.discussionId} · message ${report.messageId}`
    + `${report.status ? ` · status ${report.status}` : ""}`
    + `${report.userId ? ` · user ${report.userId}` : ""}`
    + `${report.groupId ? ` · groupId ${report.groupId}` : ""}`
    + `${report.isRead !== undefined ? ` · isRead ${report.isRead ? "true" : "false"}` : ""}`
    + `${report.sort ? ` · sort ${report.sort}` : ""}`
    + ` · page ${report.page}`
    + `${originalFallback ? " · Original HTML fallback" : ""}`
    + `${report.hasMore ? " · more available" : ""}`;
  if (report.replies.length === 0) {
    return `${header}\nNo discussion replies returned.`;
  }
  return [
    header,
    ...report.replies.map((reply) => [
      `${reply.id.padEnd(10)} ${reply.author || reply.userId || "Unknown author"} · ${reply.status || "status unavailable"}${reply.isRead ? " · read" : " · unread"}${reply.source === "original-html" ? " · original-html" : ""}`,
      `  posted ${reply.postDate || reply.createdDate || "unknown"}${reply.parentId ? ` · parent ${reply.parentId}` : ""}`,
      ...(reply.totalPosts !== undefined
        ? [`  posts ${reply.totalPosts} · unread ${reply.unreadPosts ?? 0} · unread replies to me ${reply.unreadRepliesToMe ?? 0}${reply.metadataPartial ? " · metadata partial" : ""}`]
        : reply.metadataPartial
          ? ["  metadata partial"]
          : []),
      `  ${sampleText(reply.body, 240) || "(empty)"}`,
    ].join("\n")),
    ...(report.hasMore ? [`Next page: ${report.nextPage}`] : []),
  ].join("\n");
}

export function formatBlackboardDiscussionWritePreview(input: {
  target: { mode: "post" | "reply"; courseId: string; discussionId: string; messageId?: string; groupId?: string; status: string };
  courseCode: string;
  discussion: BlackboardDiscussion;
  group?: BlackboardDiscussionGroup;
  parentMessage?: BlackboardDiscussionMessage;
  body: { textFile: BlackboardSubmissionText; preview: string };
  blockers: readonly { code: string; message: string }[];
  warnings: readonly { code: string; message: string }[];
  applyAllowed: boolean;
  confirmation: { available: boolean; command?: string };
}): string {
  const header = `Blackboard discussion ${input.target.mode === "reply" ? "reply" : "post"} preview · ${input.courseCode || input.target.courseId} · ${input.discussion.title || input.discussion.id}`;
  const lines = [
    header,
    `Discussion ID ${input.discussion.id} · status ${input.target.status}${input.target.groupId ? ` · group ${input.target.groupId}` : ""}${input.target.messageId ? ` · parent ${input.target.messageId}` : ""}`,
    `Text file: ${input.body.textFile.absolutePath}`,
    `SHA-256: ${input.body.textFile.sha256} · chars ${input.body.textFile.charCount}`,
    `Body preview: ${input.body.preview || "(empty)"}`,
  ];
  if (input.group) lines.push(`Resolved group thread: ${input.group.threadId || "unavailable"}`);
  if (input.parentMessage) lines.push(`Parent message: ${input.parentMessage.id} · ${input.parentMessage.author || input.parentMessage.userId || "unknown author"}`);
  if (input.blockers.length > 0) {
    lines.push(...input.blockers.map((entry) => `Blocker ${entry.code}: ${entry.message}`));
  }
  if (input.warnings.length > 0) {
    lines.push(...input.warnings.map((entry) => `Warning ${entry.code}: ${entry.message}`));
  }
  lines.push(
    input.applyAllowed && input.confirmation.available
      ? `Apply command: ${input.confirmation.command}`
      : "Apply command unavailable until blockers are resolved.",
  );
  return lines.join("\n");
}

export function formatBlackboardDiscussionWriteSuccess(input: {
  target: { mode: "post" | "reply"; groupId?: string; messageId?: string };
  courseCode: string;
  discussion: BlackboardDiscussion;
  group?: BlackboardDiscussionGroup;
  parentMessage?: BlackboardDiscussionMessage;
  body: { textFile: BlackboardSubmissionText; preview: string };
  message: BlackboardDiscussionMessage;
  verification: { status: string; message: string };
}): string {
  const header = `Blackboard discussion ${input.target.mode === "reply" ? "reply" : "post"} applied · ${input.courseCode} · ${input.discussion.title || input.discussion.id}`;
  return [
    header,
    `Message ID ${input.message.id} · status ${input.message.status || "unknown"}${input.target.groupId ? ` · group ${input.target.groupId}` : ""}${input.target.messageId ? ` · parent ${input.target.messageId}` : ""}`,
    `Text file: ${input.body.textFile.absolutePath}`,
    `Body preview: ${input.body.preview || "(empty)"}`,
    ...(input.group ? [`Resolved group thread: ${input.group.threadId || "unavailable"}`] : []),
    ...(input.parentMessage ? [`Parent message: ${input.parentMessage.id} · ${input.parentMessage.author || input.parentMessage.userId || "unknown author"}`] : []),
    `Verification: ${input.verification.status} · ${input.verification.message}`,
  ].join("\n");
}

export function formatBlackboardMessageFolders(report: BlackboardCourseMessageFoldersPage): string {
  const header = `Blackboard message folders · ${report.courseCode || report.courseId} · page ${report.page}`
    + `${report.hasMore ? " · more available" : ""}`;
  if (report.folders.length === 0) {
    return `${header}\nNo message folders returned.`;
  }
  return [
    header,
    ...report.folders.map((folder) =>
      `${(folder.label || folder.name || "Unnamed folder").padEnd(20)} ${folder.type || "type unavailable"} · unread ${folder.unreadCount} / total ${folder.totalCount}`
      + `${folder.name && folder.label !== folder.name ? ` · name ${folder.name}` : ""}`),
    ...(report.hasMore ? [`Next page: ${report.nextPage}`] : []),
  ].join("\n");
}

export function formatBlackboardMessages(report: BlackboardCourseMessagesPage): string {
  const header = `Blackboard messages · ${report.courseCode || report.courseId}`
    + `${report.folderType ? ` · folder ${report.folderType}` : ""}`
    + `${report.folderName ? `/${report.folderName}` : ""}`
    + `${report.sort ? ` · sort ${report.sort}` : ""}`
    + ` · page ${report.page}`
    + `${report.hasMore ? " · more available" : ""}`;
  if (report.messages.length === 0) {
    return `${header}\nNo course messages returned.`;
  }
  return [
    header,
    ...report.messages.map((message) => [
      `${message.id.padEnd(10)} ${message.subject || "(no subject)"} · ${message.type || "type unavailable"}${message.isRead ? " · read" : " · unread"}${message.isReply ? " · reply" : ""}`,
      `  posted ${message.postedDate || "unknown"} · sender ${message.sender?.displayName || message.senderId || "unknown"}`
        + `${message.toUsers.length > 0 ? ` · to ${message.toUsers.length}` : ""}`
        + `${message.ccUsers.length > 0 ? ` · cc ${message.ccUsers.length}` : ""}`
        + `${message.bccUsers.length > 0 ? ` · bcc ${message.bccUsers.length}` : ""}`,
      ...(message.attachment?.fileName ? [`  attachment ${message.attachment.fileName}${message.attachment.mimeType ? ` · ${message.attachment.mimeType}` : ""}`] : []),
      `  ${sampleText(message.body, 240) || "(empty)"}`,
    ].join("\n")),
    ...(report.hasMore ? [`Next page: ${report.nextPage}`] : []),
  ].join("\n");
}

export function formatBlackboardMessageParticipants(report: BlackboardCourseMessageParticipantsPage): string {
  const header = `Blackboard message participants · ${report.courseCode || report.courseId} · message ${report.messageId}`
    + `${report.participationType ? ` · type ${report.participationType}` : ""}`
    + `${report.sort ? ` · sort ${report.sort}` : ""}`
    + ` · page ${report.page}`
    + `${report.hasMore ? " · more available" : ""}`;
  if (report.participants.length === 0) {
    return `${header}\nNo message participants returned.`;
  }
  return [
    header,
    ...report.participants.map((participant) =>
      `${participant.userId.padEnd(10)} ${participant.displayName || participant.userId || "Unknown participant"} · ${participant.participationType || "type unavailable"}`
      + `${participant.user?.userName ? ` · username ${participant.user.userName}` : ""}`),
    ...(report.hasMore ? [`Next page: ${report.nextPage}`] : []),
  ].join("\n");
}

export function formatBlackboardMessageWritePreview(input: {
  target: { courseId: string; subject?: string; toUsers: string[]; ccUsers: string[]; bccUsers: string[] };
  courseCode: string;
  courseName: string;
  recipients: {
    toUsers: Array<{ userId: string; displayName: string; courseRoleId: string }>;
    ccUsers: Array<{ userId: string; displayName: string; courseRoleId: string }>;
    bccUsers: Array<{ userId: string; displayName: string; courseRoleId: string }>;
  };
  body: { textFile: BlackboardSubmissionText; preview: string };
  blockers: readonly { code: string; message: string }[];
  warnings: readonly { code: string; message: string }[];
  applyAllowed: boolean;
  confirmation: { available: boolean; command?: string };
}): string {
  const header = `Blackboard message-send preview · ${input.courseCode || input.target.courseId} · ${input.courseName || input.courseCode || input.target.courseId}`;
  const lines = [
    header,
    `Subject: ${input.target.subject || "(no subject)"}`,
    `Text file: ${input.body.textFile.absolutePath}`,
    `SHA-256: ${input.body.textFile.sha256} · chars ${input.body.textFile.charCount}`,
    `Recipients: to ${input.recipients.toUsers.length} · cc ${input.recipients.ccUsers.length} · bcc ${input.recipients.bccUsers.length}`,
    `Body preview: ${input.body.preview || "(empty)"}`,
  ];
  for (const [label, recipients] of [
    ["To", input.recipients.toUsers],
    ["Cc", input.recipients.ccUsers],
    ["Bcc", input.recipients.bccUsers],
  ] as const) {
    if (recipients.length === 0) continue;
    lines.push(`${label}: ${recipients.map((entry) => `${entry.userId} ${entry.displayName} (${entry.courseRoleId || "role unavailable"})`).join(" | ")}`);
  }
  if (input.blockers.length > 0) {
    lines.push(...input.blockers.map((entry) => `Blocker ${entry.code}: ${entry.message}`));
  }
  if (input.warnings.length > 0) {
    lines.push(...input.warnings.map((entry) => `Warning ${entry.code}: ${entry.message}`));
  }
  lines.push(
    input.applyAllowed && input.confirmation.available
      ? `Apply command: ${input.confirmation.command}`
      : "Apply command unavailable until blockers are resolved.",
  );
  return lines.join("\n");
}

export function formatBlackboardMessageWriteSuccess(input: {
  target: { subject?: string };
  courseCode: string;
  courseName: string;
  body: { textFile: BlackboardSubmissionText; preview: string };
  message: BlackboardCourseMessagesPage["messages"][number];
  verification: { status: string; message: string };
}): string {
  const header = `Blackboard message-send applied · ${input.courseCode} · ${input.courseName || input.courseCode}`;
  return [
    header,
    `Message ID ${input.message.id} · subject ${input.message.subject || "(no subject)"}`,
    `Text file: ${input.body.textFile.absolutePath}`,
    `Recipients: to ${input.message.toUsers.length} · cc ${input.message.ccUsers.length} · bcc ${input.message.bccUsers.length}`,
    `Body preview: ${input.body.preview || "(empty)"}`,
    `Verification: ${input.verification.status} · ${input.verification.message}`,
  ].join("\n");
}

export function formatBlackboardRoster(report: BlackboardCourseRosterPage): string {
  const header = `Blackboard roster · ${report.courseCode || report.courseId}`
    + `${report.role ? ` · role ${report.role}` : ""}`
    + `${report.availability ? ` · availability ${report.availability}` : ""}`
    + `${report.sort ? ` · sort ${report.sort}` : ""}`
    + ` · page ${report.page}`
    + `${report.hasMore ? " · more available" : ""}`;
  if (report.memberships.length === 0) {
    return `${header}\nNo course memberships returned.`;
  }
  return [
    header,
    ...report.memberships.map(formatBlackboardMembershipLine),
    ...(report.hasMore ? [`Next page: ${report.nextPage}`] : []),
  ].join("\n");
}

function formatBlackboardMembershipLine(membership: BlackboardCourseMembership): string {
  const user = membership.user;
  const email = user?.institutionEmail || user?.email;
  return `${membership.userId.padEnd(10)} ${(user?.displayName || membership.userId || "Unknown user").padEnd(24)} ${membership.courseRoleId || "role unavailable"}`
    + `${membership.availability ? ` · ${membership.availability}` : ""}`
    + `${email ? ` · ${email}` : ""}`
    + `${membership.lastAccessed ? ` · last accessed ${membership.lastAccessed}` : ""}`;
}

export function formatBlackboardDeadlines(report: BlackboardDeadlineReport): string {
  if (report.deadlines.length === 0) {
    const partial = report.failures.length > 0 ? ` (${report.failures.length} failure${report.failures.length === 1 ? "" : "s"})` : "";
    return report.submissionState
      ? `Blackboard deadlines${partial}\nNo upcoming assignment deadlines matched submission state ${report.submissionState}.`
      : `Blackboard deadlines${partial}\nNo upcoming assignment deadlines.`;
  }
  return [
    `Blackboard deadlines · ${report.deadlines.length}${report.days !== undefined ? ` within ${report.days} day(s)` : ""}${report.submissionState ? ` · state ${report.submissionState}` : ""}${report.failures.length > 0 ? ` · ${report.failures.length} failure(s)` : ""}`,
    ...report.deadlines.map((item) => formatBlackboardDeadlineLine(item)),
  ].join("\n");
}

export function formatBlackboardCalendar(report: BlackboardCalendarItemsReport): string {
  const suffix = [
    report.type,
    report.courseId,
    report.partial ? `${report.failures.length} failure(s)` : undefined,
  ].filter(Boolean).join(" · ");
  if (report.items.length === 0) {
    return [
      `Blackboard calendar · ${report.since} to ${report.until}${suffix ? ` · ${suffix}` : ""}`,
      "No calendar items returned.",
    ].join("\n");
  }
  return [
    `Blackboard calendar · ${report.items.length} · ${report.since} to ${report.until}${suffix ? ` · ${suffix}` : ""}`,
    ...report.items.map((item) => [
      `${item.start || "?"} to ${item.end || "?"} · ${item.type || "unknown"} · ${item.title || "Untitled"}`,
      `  ${item.calendarName || item.calendarId}${item.location ? ` · ${item.location}` : ""}`,
    ].join("\n")),
  ].join("\n");
}

export function formatBlackboardTypes(report: BlackboardContentTypesReport): string {
  if (report.courses.length === 0) return "Blackboard content types\nNo matching courses.";
  return [
    `Blackboard content types · ${report.coursesMatched} course(s) · ${report.totalItems} item(s)`,
    `Totals · ${formatBlackboardKindCounts(report.totals)}`,
    ...(report.partial ? [`Partial failures · ${report.failures.length}`] : []),
    ...report.courses.map((course) => [
      `${course.courseCode || course.courseId} · ${course.courseName || course.courseId}`,
      `  ${course.totalItems} item(s) · ${formatBlackboardKindCounts(course.kindCounts)}`,
    ].join("\n")),
  ].join("\n");
}

export function formatBlackboardTree(report: BlackboardContentTreeReport): string {
  const header = `Blackboard tree · ${report.courseCode || report.courseId} · ${report.returnedItems} item(s)`
    + `${report.rootContentId ? ` · root ${report.rootContentId}` : ""}`
    + `${report.truncated ? ` · truncated at ${report.maxItems}` : ""}`
    + `${report.failures.length > 0 ? ` · ${report.failures.length} failure(s)` : ""}`;
  if (report.entries.length === 0) return `${header}\nNo content returned.`;
  return [
    header,
    ...report.entries.map((entry) => `${"  ".repeat(entry.depth)}- ${entry.kind} · ${entry.title || entry.contentId}${entry.hasChildren ? " [+]" : ""}`),
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

function formatBlackboardAssignmentAttemptSummary(
  summary: BlackboardAssignmentsWithAttemptsReport["assignments"][number]["attemptSummary"],
): string {
  if (!summary) return "attempt summary unavailable";
  const labels = [
    `state ${summary.state}`,
    `attempts ${summary.totalAttempts}`,
    summary.submittedAttempts > 0 ? `submitted ${summary.submittedAttempts}` : "",
    summary.inProgressAttempts > 0 ? `in-progress ${summary.inProgressAttempts}` : "",
    summary.completedAttempts > 0 ? `completed ${summary.completedAttempts}` : "",
    summary.latestStatus ? `latest ${summary.latestStatus}` : "",
    summary.latestDisplayGradeText ? `grade ${summary.latestDisplayGradeText}` : "",
    summary.latestSubmissionDate
      ? `submitted at ${summary.latestSubmissionDate}`
      : summary.latestAttemptDate
        ? `latest activity ${summary.latestAttemptDate}`
        : "",
  ].filter(Boolean);
  return labels.join(" · ");
}

export function formatBlackboardAttemptFiles(
  attemptId: string,
  files: readonly BlackboardAttemptFile[],
): string {
  if (files.length === 0) {
    return `Blackboard attempt files · attempt ${attemptId}\nNo submitted files returned.`;
  }
  return [
    `Blackboard attempt files · attempt ${attemptId} · ${files.length}`,
    ...files.map((file) => `${file.id.padEnd(10)} ${file.name}`),
  ].join("\n");
}

export function formatBlackboardAttemptFileDownload(
  result: BlackboardAttemptFileDownload,
  attemptId: string,
): string {
  return [
    `Blackboard attempt file downloaded · attempt ${attemptId}`,
    `File: ${result.file.name} · ${result.file.id}`,
    `Saved to: ${result.destination}`,
    `Size: ${result.size} bytes`,
    `SHA-256: ${result.sha256}`,
    `Content type: ${result.contentType || "unavailable"}`,
    `Overwritten: ${result.overwritten ? "yes" : "no"}`,
  ].join("\n");
}

export function formatBlackboardSubmitPreview(input: {
  target: { courseId: string; contentId?: string; columnId?: string };
  assignment: BlackboardAssignment;
  content: BlackboardContentItem;
  attemptsUsed: number;
  remainingAttempts?: number;
  inProgressAttempts: number;
  submission:
    | { kind: "file"; file: BlackboardSubmissionFile }
    | { kind: "text"; textFile: BlackboardSubmissionText };
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
  const submissionLines = input.submission.kind === "file"
    ? [
      `File: ${input.submission.file.absolutePath}`,
      `Filename: ${input.submission.file.name}`,
      `Size: ${input.submission.file.size} bytes`,
      `SHA-256: ${input.submission.file.sha256}`,
    ]
    : [
      `Text file: ${input.submission.textFile.absolutePath}`,
      `Size: ${input.submission.textFile.size} bytes`,
      `Characters: ${input.submission.textFile.charCount}`,
      `SHA-256: ${input.submission.textFile.sha256}`,
    ];
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
    ...submissionLines,
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
  submission:
    | { kind: "file"; file: BlackboardSubmissionFile }
    | { kind: "text"; textFile: BlackboardSubmissionText };
  attempt: BlackboardAttempt;
  files: readonly BlackboardAttemptFile[];
  verification: { status: "confirmed" | "not_observed" | "unavailable"; message: string };
}): string {
  const submissionLine = input.submission.kind === "file"
    ? input.files.length > 0
      ? `Files: ${input.files.map((file) => file.name).join(", ")}`
      : "Files: No files were read back."
    : `Text file: ${input.submission.textFile.absolutePath} · ${input.submission.textFile.charCount} chars`;
  return [
    input.verification.status === "confirmed"
      ? "Blackboard submission confirmed by read-back."
      : "Blackboard submission request accepted, but verification is incomplete.",
    `Assignment: ${input.assignment.title}`,
    `Attempt: ${input.attempt.id}`,
    `Status: ${input.attempt.status || "unknown"}`,
    submissionLine,
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
    ...(item.attemptSummary ? [`  ${formatBlackboardAssignmentAttemptSummary(item.attemptSummary)}`] : []),
  ].join("\n");
}

function formatBlackboardAnnouncement(item: BlackboardAnnouncement): string {
  const owner = item.source === "system"
    ? `system${item.showAtLogin ? " · login" : ""}${item.showInCourses ? " · courses" : ""}`
    : [item.courseCode, item.courseName].filter(Boolean).join(" · ") || item.courseId || "course";
  const timing = item.modified || item.created || "time unavailable";
  const snippet = item.body.length <= 160 ? item.body : `${item.body.slice(0, 157)}...`;
  return [
    `${timing} · ${owner} · ${item.title || "Untitled announcement"}`,
    `  ${snippet || "No body returned."}`,
  ].join("\n");
}

function formatBlackboardKindCounts(
  counts: readonly { kind: string; count: number }[],
): string {
  if (counts.length === 0) return "no content";
  return counts.map((entry) => `${entry.kind} ${entry.count}`).join(" · ");
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
