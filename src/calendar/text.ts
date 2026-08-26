import type { CalendarDayInfo, CalendarTermSnapshot } from "./types.js";

export function formatCalendarTerms(terms: readonly CalendarTermSnapshot[], year: number, level: string): string {
  return [
    `Academic calendar · ${year} · ${level}`,
    ...terms.map((term) => [
      `${term.humanName} (${term.semester.value})`,
      `  sign-in ${term.signIn} · teaching ${term.teachingStart} to ${term.teachingEnd} · ${term.totalTeachingWeeks} weeks`,
      `  midterm ${term.midterm.start} to ${term.midterm.end} · finals ${term.final.start} to ${term.final.end}`,
    ].join("\n")),
  ].join("\n\n");
}

export function formatCalendarDay(day: CalendarDayInfo): string {
  const flags = Object.entries(day.flags).filter(([, enabled]) => enabled).map(([name]) => name).join(", ");
  return [
    `Academic day · ${day.date} · ${day.weekday}`,
    day.label,
    day.semester ? `Semester  ${day.semester.semester.value} (${day.semester.level})` : "Semester  none",
    day.week > 0 ? `Week      ${day.week}` : "Week      outside teaching term",
    day.holiday ? `Holiday   ${day.holiday.name} (${day.holiday.start} to ${day.holiday.end})` : "",
    day.compensatory ? `Makeup    ${day.compensatory.workday} classes (${day.compensatory.weekType} week)` : "",
    `Flags     ${flags || "none"}`,
  ].filter(Boolean).join("\n");
}
