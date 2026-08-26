import type {
  ClassroomOccupancyEntry,
  ClassroomRoom,
  BidPlan,
  EvaluationCourseStatus,
  EvaluationSummary,
  SelectionPreview,
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

export function formatSelectionPreview(preview: SelectionPreview): string {
  const payload = Object.entries(preview.payload)
    .filter(([, value]) => value !== "" && (!Array.isArray(value) || value.length > 0))
    .map(([key, value]) => `  ${key}=${Array.isArray(value) ? value.join(",") : value}`);
  return [
    `TIS selection preview · ${preview.operation}`,
    "No network request or mutation was performed.",
    `Endpoint  ${preview.endpoint}`,
    "Payload",
    ...payload,
    `Success   ${preview.successHeuristic}`,
    "Verification",
    ...preview.verification.map((step) => `  - ${step.description}`),
    "Apply is unavailable until exact read-back verification is implemented.",
  ].join("\n");
}

export function formatBidPlan(plan: BidPlan): string {
  return [
    `TIS bid plan · ${plan.where}`,
    `Total bid  ${plan.totalBid}${plan.limit === undefined ? "" : ` / ${plan.limit}`}`,
    `Over limit ${plan.overLimit ? "yes" : "no"}`,
    ...Object.entries(plan.picks).map(([courseId, bid]) => `  ${courseId}  ${bid}`),
    ...(plan.errors.length > 0 ? ["Errors", ...plan.errors.map((error) => `  - ${error}`)] : []),
    `${plan.previews.length} write previews generated; no network request or mutation was performed.`,
  ].join("\n");
}
