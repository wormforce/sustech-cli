import type { BlackboardAssignment, BlackboardContentItem, BlackboardCourse, BlackboardUser } from "./blackboard.js";
import type { NcesCourseDetail, NcesCourseSummary } from "./nces.js";
import type { PaperSummary } from "./papers.js";
import type { WsProgramDetail, WsProgramSummary } from "./ws.js";

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
