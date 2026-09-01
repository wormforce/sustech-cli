import type {
  BidPick,
  ClassroomOccupancyEntry,
  ClassroomLiveEntry,
  ClassroomLiveRoom,
  ClassroomRoom,
  BidPlan,
  EvaluationCourseStatus,
  EvaluationSummary,
  SelectionApplyTarget,
  SelectionPreview,
  SelectionStateObservation,
  SelectionVerificationResult,
} from "./remaining.js";

export function formatClassrooms(rooms: readonly ClassroomRoom[], title: string): string {
  if (rooms.length === 0) return `${title}\nNo matching rooms.`;
  return [
    `${title} · ${rooms.length}`,
    ...rooms.map((room) => {
      const capacity = room.capacity === undefined ? "? seats" : `${room.capacity} seats`;
      return `${room.name.padEnd(18)} ${capacity.padEnd(10)} ${room.sectionCount} sections / ${room.slotCount} slots`;
    }),
  ].join("\n");
}

export function formatClassroomOccupancy(
  room: string,
  entries: readonly ClassroomOccupancyEntry[],
  query: { week: number; day: number; periodStart?: number; periodEnd?: number },
): string {
  const period = query.periodStart === undefined
    ? "all periods"
    : `period ${query.periodStart}${query.periodEnd !== query.periodStart ? `-${query.periodEnd}` : ""}`;
  const title = `${room} · week ${query.week}, day ${query.day}, ${period}`;
  if (entries.length === 0) return `${title}\nNo catalogued classes occupy this room.`;
  return [
    `${title} · ${entries.length}`,
    ...entries.map((entry) => `${entry.code.padEnd(10)} P${entry.slot.periodStart}-${entry.slot.periodEnd}  ${entry.name}  ${entry.teachers.join(", ")}`),
  ].join("\n");
}

export function formatClassroomLive(
  room: ClassroomLiveRoom,
  entries: readonly ClassroomLiveEntry[],
  options: { title: string },
): string {
  const capacity = room.declaredCapacity === undefined ? "" : ` · ${room.declaredCapacity} seats`;
  if (entries.length === 0) {
    return `${options.title}\n${room.roomLabel} · ${room.roomCode}${capacity}\nNo live classroom entries returned by TIS.`;
  }
  return [
    options.title,
    `${room.roomLabel} · ${room.roomCode}${capacity} · ${entries.length}`,
    ...entries.map(formatLiveEntry),
  ].join("\n");
}

export function formatClassroomNow(
  room: ClassroomLiveRoom,
  entries: readonly ClassroomLiveEntry[],
  options: { date: string; time: string; week: number; weekday: number; periodLabel?: string },
): string {
  const capacity = room.declaredCapacity === undefined ? "" : ` · ${room.declaredCapacity} seats`;
  const title = `Live classroom now · ${options.date} ${options.time} · week ${options.week}, day ${options.weekday}${options.periodLabel ? `, ${options.periodLabel}` : ""}`;
  if (!options.periodLabel) {
    return `${title}\n${room.roomLabel} · ${room.roomCode}${capacity}\nCurrent time is outside the configured teaching periods.`;
  }
  if (entries.length === 0) {
    return `${title}\n${room.roomLabel} · ${room.roomCode}${capacity}\nNo active live classroom entry overlaps the current period.`;
  }
  return [
    title,
    `${room.roomLabel} · ${room.roomCode}${capacity} · ${entries.length}`,
    ...entries.map(formatLiveEntry),
  ].join("\n");
}

export function formatEvaluationStatuses(
  rows: readonly EvaluationCourseStatus[],
  summary: EvaluationSummary,
): string {
  if (rows.length === 0) return "Teaching evaluations\nNo matching evaluation tasks.";
  return [
    `Teaching evaluations · ${summary.total} · pending ${summary.pending} · draft ${summary.draft} · submitted ${summary.submitted}`,
    ...rows.map((row) => `${row.statusText.padEnd(8)} ${row.courseCode.padEnd(10)} ${row.courseName}${row.deadline ? ` · ${row.deadline}` : ""}`),
  ].join("\n");
}

export function formatSelectionPreview(
  preview: SelectionPreview,
  options: { applyCommand?: string; exactTarget?: { courseId: string; rwh?: string } } = {},
): string {
  const payload = Object.entries(preview.payload)
    .filter(([, value]) => value !== "" && (!Array.isArray(value) || value.length > 0))
    .map(([key, value]) => `  ${key}=${Array.isArray(value) ? value.join(",") : value}`);
  return [
    `TIS selection preview · ${preview.operation}`,
    "No network request or mutation was performed.",
    `Client request ID: ${preview.clientRequestId}`,
    "Upstream idempotency key: unsupported; automatic retry forbidden.",
    ...(options.exactTarget
      ? [
          "Exact target",
          `  courseId=${options.exactTarget.courseId}`,
          ...(options.exactTarget.rwh ? [`  rwh=${options.exactTarget.rwh}`] : ["  rwh=(required for apply)"]),
        ]
      : []),
    `Endpoint  ${preview.endpoint}`,
    "Payload",
    ...payload,
    `Success   ${preview.successHeuristic}`,
    "Verification",
    ...preview.verification.map((step) => `  - ${step.description}`),
    ...(options.applyCommand
      ? ["Apply", options.applyCommand]
      : ["Apply remains unavailable until an exact RWH binding is provided."]),
  ].join("\n");
}

export function formatBidPlan(plan: BidPlan, options: { applyCommand?: string } = {}): string {
  return [
    `TIS bid plan · ${plan.where}`,
    `Total bid  ${plan.totalBid}${plan.limit === undefined ? "" : ` / ${plan.limit}`}`,
    `Over limit ${plan.overLimit ? "yes" : "no"}`,
    ...plan.pickDetails.map((pick: BidPick) => `  ${pick.courseId}  ${pick.bid}${pick.rwh ? `  (${pick.rwh})` : ""}`),
    ...(plan.errors.length > 0 ? ["Errors", ...plan.errors.map((error) => `  - ${error}`)] : []),
    ...(options.applyCommand ? ["Apply", options.applyCommand] : []),
    `${plan.previews.length} write previews generated; no network request or mutation was performed.`,
  ].join("\n");
}

export function formatSelectionApplySuccess(
  target: SelectionApplyTarget,
  message: string,
  verification: SelectionVerificationResult,
): string {
  return [
    `TIS selection request confirmed · ${target.operation}`,
    `RWH: ${target.rwh}`,
    `TIS ID: ${target.courseId}`,
    `Round: ${target.round}`,
    ...(target.operation === "bid.update" || target.operation === "cart.add" ? [`Bid: ${target.bid}`] : []),
    `TIS: ${message || "success"}`,
    `Verification: ${verification.status} — ${verification.message}`,
    formatSelectionObservation(verification.observation),
  ].join("\n");
}

export function formatBidApplySuccess(
  picks: readonly BidPick[],
  where: string,
  round: string,
  verification: SelectionStateObservation,
): string {
  return [
    `TIS bid apply confirmed · ${where}`,
    `Round: ${round}`,
    `Updated: ${picks.length}`,
    ...picks.map((pick) => `  ${pick.courseId} ${pick.bid}${pick.rwh ? ` (${pick.rwh})` : ""}`),
    formatSelectionObservation(verification),
  ].join("\n");
}

function formatLiveEntry(entry: ClassroomLiveEntry): string {
  const safeRawText = entry.rawText
    .replace(/(?:联系电话|contact(?: phone)?)[：:]?\s*[0-9+()\-\s]+/gi, "")
    .replace(/\n+/g, " ")
    .trim();
  const label = entry.kind === "borrowing"
    ? `borrow ${(entry.borrower ?? entry.purpose ?? safeRawText) || "occupied"}`
    : `${entry.courseCode ?? "-"} ${(entry.courseName ?? safeRawText) || "occupied"}`;
  const weeks = entry.weeks.length > 0 ? `[${entry.weeks.join(",")}]` : "[?]";
  const extra = entry.purpose && entry.purpose !== label ? ` · ${entry.purpose}` : "";
  return `${entry.weekday} P${entry.periodStart}-${entry.periodEnd} ${weeks} ${label}${extra}`;
}

function formatSelectionObservation(observation: SelectionStateObservation): string {
  const round = observation.roundCode ? `round=${observation.roundCode}` : "round=(missing)";
  const limit = observation.roundLimit === undefined ? "" : ` limit=${observation.roundLimit}`;
  return `Observed state: totalBid=${observation.totalBid} ${round}${limit}`.trim();
}
