import type {
  CourseDecision,
  CourseDecisionReason,
  CourseRecommendationReport,
} from "./course-decision.js";

export function formatCourseRecommendationReport(
  report: CourseRecommendationReport,
  title = "Course recommendations",
): string {
  const lines = [
    `${title} · ${report.items.length}`,
    `State: ${report.partial ? "partial" : "complete"}`,
    `Sources: selectable=${report.sourceStatuses.selectable.state} · plan=${report.sourceStatuses.plan.state} · degree=${report.sourceStatuses.degree.state} · nces=${report.sourceStatuses.nces.state}`,
  ];

  for (const item of report.items) {
    lines.push("", ...formatDecisionLines(item));
  }

  if (report.items.length === 0) lines.push("", "No matching selectable course sections were found.");
  if (report.warnings.length > 0) {
    lines.push("", "Warnings:", ...report.warnings.map((warning) => `  - ${warning}`));
  }
  lines.push(
    "",
    `Official: ${report.advisory.officialReference}`,
    `Derived: ${report.advisory.derivedReference}`,
    `Community: ${report.advisory.communityReference}`,
  );
  return lines.join("\n");
}

function formatDecisionLines(item: CourseDecision): string[] {
  const course = item.course;
  const section = [course.sectionName, course.classGroup].filter(Boolean).join(" · ");
  const teachers = course.teachers.length > 0 ? course.teachers.join(", ") : "teacher unavailable";
  const seats = item.capacity.status === "available"
    ? `${item.capacity.remainingSeats ?? "?"}/${item.capacity.capacity ?? "?"} seat(s) remaining`
    : "seat data unavailable";
  return [
    `${course.code} ${course.name}${section ? ` · ${section}` : ""}`,
    `  ${verdictLabel(item.verdict)} · score=${item.score.total} · ${teachers} · ${seats}`,
    `  RWH: ${course.rwh || "unavailable"}`,
    `  Degree: ${item.degree.state}${item.degree.manualReview.length > 0 ? " · manual review required" : ""}`,
    ...item.reasons.map((reason) => `  ${reasonMarker(reason)} ${reason.message}`),
    ...item.warnings.map((warning) => `  ! ${warning}`),
  ];
}

function reasonMarker(reason: CourseDecisionReason): string {
  if (reason.impact === "positive") return "+";
  if (reason.impact === "negative") return "-";
  return "?";
}

function verdictLabel(verdict: CourseDecision["verdict"]): string {
  if (verdict === "strong_recommend") return "strong recommend";
  return verdict;
}
