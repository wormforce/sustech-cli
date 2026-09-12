import type { PopulationCounts, TisCourseDetail } from "./course-detail.js";

export function formatCourseDetail(report: TisCourseDetail): string {
  const { course, catalog, enrollment } = report;
  const lines = [
    `${course.code} — ${course.name} · ${report.semester.value}`,
    `Section: ${course.classGroup || "-"} · RWH: ${course.rwh}`,
    `Teacher: ${course.teachers.join(", ") || "-"}`,
    `Teaching task: ${course.credits} credits · ${course.language || "language not returned"} · ${course.category || "-"} / ${course.nature || "-"}`,
  ];
  for (const meeting of course.schedule) {
    lines.push(`  ${meeting.dayName} ${meeting.periodStart}-${meeting.periodEnd} · weeks ${meeting.weeks.join(",")} · ${meeting.room}`);
  }
  lines.push("", `Enrollment (${enrollment.source})`,
    `  ${counts(enrollment.counts)}`,
    `  Quotas: ${counts(enrollment.quotas)}`,
    `  Counts paired with quotas: ${counts(enrollment.quotaCounts)}`);
  if (enrollment.undergraduatePercentage !== undefined) lines.push(`  Undergraduate: ${enrollment.undergraduatePercentage}%`);
  if (enrollment.status) lines.push(`  My selection status: ${enrollment.status.label} (${enrollment.status.code})`);
  if (report.selection) {
    const selection = report.selection;
    lines.push("", `Selection: ${selection.typeName || selection.typeCode || "-"} · ${selection.period || "-"}`,
      `  ${selection.startsAt || "?"} — ${selection.endsAt || "?"} (TIS local time)`);
  }
  lines.push("", "Course-library details",
    `  ${catalog.nameEn || course.name}`,
    `  Credits: ${catalog.credits ?? "?"} · Hours: ${catalog.hours.total ?? "?"} (lecture ${catalog.hours.lecture ?? "?"}, laboratory ${catalog.hours.laboratory ?? "?"})`,
    `  ${catalog.teachingMethod || "-"} · ${catalog.assessmentMethod || "-"} · ${catalog.language || "-"} · ${catalog.category || "-"}`);
  if (report.teachingTeam.length) lines.push(`  Course team: ${report.teachingTeam.map(member => `${member.name}${member.role ? ` (${member.role})` : ""}`).join(", ")}`);
  lines.push("", "Prerequisites", report.prerequisites.description || "Description not returned by TIS.");
  if (report.prerequisites.courses.length) {
    lines.push("Listed courses (the description determines the relationship):",
      ...report.prerequisites.courses.map(row => `  ${row.code} — ${row.name}${row.credits !== undefined ? ` · ${row.credits} credits` : ""}`));
  }
  const sections = [
    ["Introduction", report.content.introduction || report.content.introductionEn],
    ["Objectives", report.content.objectives || report.content.objectivesEn],
    ["Learning outcomes", report.content.outcomes || report.content.outcomesEn],
    ["Course outline", report.content.outline || report.content.outlineEn],
    ["Readings", report.content.readings || report.content.readingsEn],
  ];
  for (const [heading, body] of sections) if (body) lines.push("", heading!, body);
  if (report.attachments.length) lines.push("", "Syllabus attachments (TIS login required)",
    ...report.attachments.map(attachment => `  ${attachment.filename}\n  ${attachment.url}`));
  if (report.notices.length) lines.push("", "Notes", ...report.notices.map(notice => `- ${notice.message}`));
  lines.push("", `Read at: ${report.reportedAt}`);
  return lines.join("\n");
}

function counts(value: PopulationCounts): string {
  const labels: Record<keyof PopulationCounts, string> = {
    total: "total", undergraduate: "undergraduate", graduate: "graduate", male: "male", female: "female", internal: "对内", external: "对外",
  };
  const entries = (Object.keys(labels) as Array<keyof PopulationCounts>).filter(key => value[key] !== undefined);
  return entries.length ? entries.map(key => `${labels[key]} ${value[key]}`).join(" · ") : "not returned";
}
