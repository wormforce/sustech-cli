import type { BlackboardAssignment, BlackboardContentItem, BlackboardCourse, BlackboardUser } from "./blackboard.js";
import type { BookingUserProfile } from "./booking-auth.js";
import type { BookingMeeting, BookingRoom } from "./booking.js";
import type {
  LibraryBookingUser,
  LibraryCampusGroup,
  LibraryIdleCategory,
  LibraryLab,
  LibraryReservation,
} from "./library.js";
import type { NcesCourseDetail, NcesCourseSummary } from "./nces.js";
import type { PaperSummary } from "./papers.js";
import type { PmsPrintJob, PmsScanJob, PmsServerGroup, PmsStation, PmsUsageRecord } from "./pms.js";
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

export function formatBlackboardAssignments(items: readonly BlackboardAssignment[]): string {
  if (items.length === 0) return "Blackboard assignments\nNo assignment columns.";
  return [
    `Blackboard assignments · ${items.length}`,
    ...items.map((item) => `${item.contentId.padEnd(12)} ${item.title}${item.scorePossible === undefined ? "" : ` · ${item.scorePossible} points`}`),
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
