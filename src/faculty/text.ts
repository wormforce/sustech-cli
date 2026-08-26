import type { FacultyProfile } from "./types.js";

export function formatDepartments(departments: readonly string[]): string {
  return [`Faculty departments · ${departments.length}`, ...departments.map((name, index) => `${String(index + 1).padStart(2)}  ${name}`)].join("\n");
}

export function formatFaculty(profiles: readonly FacultyProfile[], title: string): string {
  if (profiles.length === 0) return `${title}\nNo matching faculty profiles.`;
  return [
    `${title} · ${profiles.length}`,
    ...profiles.map((profile) => [
      `${profile.name} (${profile.slug})${profile.title ? ` · ${profile.title}` : ""}`,
      `  ${profile.department ?? "Department unavailable"}${profile.email ? ` · ${profile.email}` : ""}`,
      ...(profile.researchInterests.length > 0 ? [`  ${profile.researchInterests.join("; ")}`] : []),
      `  ${profile.profileUrl}`,
    ].join("\n")),
  ].join("\n");
}
