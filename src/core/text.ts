import type { Semester } from "./semester.js";
import type { Course } from "../tis/types.js";

interface Column<T> {
  heading: string;
  width: number;
  value: (row: T) => string;
}

export function formatVersion(version: string, runtime: string): string {
  return `sustech-cli ${version} (${runtime})`;
}

export function formatAuthCheck(source: string): string {
  return `Authenticated with TIS\nCredentials: ${source} (not stored by sustech-cli)`;
}

export function formatCourseSearch(input: {
  title: string;
  semester: Semester;
  courses: Course[];
  total: number;
  source?: string;
}): string {
  const columns: Column<Course>[] = [
    { heading: "CODE", width: 12, value: (course) => course.code },
    { heading: "COURSE", width: 28, value: (course) => course.name || course.sectionName },
    { heading: "TEACHER", width: 18, value: (course) => course.teachers.join(", ") || "-" },
    { heading: "TIME", width: 34, value: formatSchedule },
    { heading: "SEATS", width: 10, value: formatSeats },
  ];
  const heading = `${input.title} · ${input.semester.value}${input.source ? ` · ${input.source}` : ""}`;
  const summary = `${input.total} match(es); showing ${input.courses.length}.`;
  if (input.courses.length === 0) return `${heading}\n\nNo courses found.\n\n${summary}`;
  return `${heading}\n\n${formatTable(columns, input.courses)}\n\n${summary}`;
}

export function formatAvailableCourses(input: {
  semester: Semester;
  courses: Course[];
  total: number;
  round: string;
}): string {
  const blocks = input.courses.map((course, index) => {
    const id = course.id || "(not returned by TIS)";
    return [
      `${index + 1}. ${course.code} — ${course.name || course.sectionName}`,
      `   Section: ${course.classGroup || "-"} · Teacher: ${course.teachers.join(", ") || "-"}`,
      `   Time: ${formatSchedule(course)}`,
      `   RWH: ${course.rwh}`,
      `   TIS ID: ${id}`,
    ].join("\n");
  });
  const header = `Available courses · ${input.semester.value} · round ${input.round}`;
  const body = blocks.length > 0 ? blocks.join("\n\n") : "No selectable courses found.";
  return `${header}\n\n${body}\n\n${input.total} match(es); showing ${input.courses.length}.`;
}

export function formatEnrolledCourses(semester: Semester, courses: unknown[]): string {
  const header = `Enrolled courses · ${semester.value}`;
  if (courses.length === 0) return `${header}\n\nNo enrolled courses returned by TIS.`;
  const blocks = courses.map((value, index) => {
    const course = asRecord(value);
    const name = firstString(course, ["KCMC", "KCWZSM", "kcmc", "name"]) || "Unnamed course";
    const code = firstString(course, ["KCDM", "kcdm", "code"]);
    const teacher = firstString(course, ["SKJS", "DGJSMC", "teacher"]);
    const place = firstString(course, ["SKDD", "JXDD", "room"]);
    const time = firstString(course, ["SKSJ", "SKSJ_EN", "time"]);
    const details = [
      teacher && `Teacher: ${teacher}`,
      time && `Time: ${time}`,
      place && `Room: ${place}`,
    ].filter(Boolean).join(" · ");
    return `${index + 1}. ${code ? `${code} — ` : ""}${name}${details ? `\n   ${details}` : ""}`;
  });
  return `${header}\n\n${blocks.join("\n\n")}\n\n${courses.length} course record(s).`;
}

export function formatEnrollPreview(target: {
  semester: Semester;
  courseId: string;
  rwh: string;
  bid: number;
  round: string;
}, command: string): string {
  return [
    "Enrollment preview — no network request or mutation was performed.",
    "",
    `Semester: ${target.semester.value}`,
    `RWH: ${target.rwh}`,
    `TIS ID: ${target.courseId}`,
    `Round: ${target.round}`,
    `Bid: ${target.bid}`,
    "",
    "After reviewing the exact target, run:",
    command,
  ].join("\n");
}

export function formatEnrollSuccess(rwh: string, message: string): string {
  return `Enrollment submitted successfully.\nRWH: ${rwh}\nTIS: ${message || "success"}`;
}

function formatTable<T>(columns: Column<T>[], rows: T[]): string {
  const separator = columns.map((column) => "-".repeat(column.width)).join("  ");
  const header = columns.map((column) => padCell(column.heading, column.width)).join("  ");
  const body = rows.map((row) => columns.map((column) => padCell(column.value(row), column.width)).join("  "));
  return [header, separator, ...body].join("\n");
}

function formatSchedule(course: Course): string {
  if (course.schedule.length === 0) return "-";
  const visible = course.schedule.slice(0, 2).map((slot) =>
    `${slot.dayName} ${slot.periodStart}-${slot.periodEnd} ${slot.room}`,
  );
  if (course.schedule.length > 2) visible.push(`+${course.schedule.length - 2} more`);
  return visible.join("; ");
}

function formatSeats(course: Course): string {
  if (course.enrolled !== undefined && course.capacity !== undefined) return `${course.enrolled}/${course.capacity}`;
  if (course.capacity !== undefined) return String(course.capacity);
  return "-";
}

function padCell(value: string, width: number): string {
  const truncated = truncateDisplay(value.replaceAll(/\s+/g, " ").trim(), width);
  return `${truncated}${" ".repeat(Math.max(0, width - displayWidth(truncated)))}`;
}

function truncateDisplay(value: string, width: number): string {
  if (displayWidth(value) <= width) return value;
  let output = "";
  for (const character of value) {
    if (displayWidth(`${output}${character}…`) > width) break;
    output += character;
  }
  return `${output}…`;
}

function displayWidth(value: string): number {
  return [...value].reduce((width, character) => width + (/[^\u0000-\u00ff]/.test(character) ? 2 : 1), 0);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function firstString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}
