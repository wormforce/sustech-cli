import type { Course, CourseComponentType, ScheduleSlot } from "./types.js";

export interface SelectionIdentifierTarget {
  componentId: string;
  taskId: string;
  mutationCourseId?: string;
  mutationPayloadField: "p_id";
  readbackIdentity: readonly ["courseId", "rwh"];
}

export interface SelectionCourseComponent {
  componentId: string;
  type: CourseComponentType;
  required: boolean;
  creditBearing: boolean;
  taskId: string;
  mutationCourseId?: string;
  sectionName: string;
  capacity?: number;
  enrolled?: number;
  teachingTeam: string[];
  meetings: ScheduleSlot[];
}

export interface SelectionCourseBundle {
  schemaVersion: "1";
  bundleId: string;
  courseCode: string;
  courseName: string;
  classGroup: string;
  credits?: number;
  creditStatus: "explicit" | "deduplicated" | "ambiguous";
  components: SelectionCourseComponent[];
  requiredComponentIds: string[];
  teachingTeam: string[];
  meetings: Array<ScheduleSlot & { componentId: string; componentType: CourseComponentType }>;
  operationTargets: SelectionIdentifierTarget[];
  selectableWithoutGuessing: boolean;
  warnings: string[];
}

export interface CourseDiagnosticRecord {
  schemaVersion: "1";
  kind: "tis-selection-source-record";
  raw: Readonly<Record<string, unknown>>;
}

/** Explicit diagnostics-only escape hatch. This envelope is never returned by a CLI command. */
export function retainCourseSourceRecord(raw: Record<string, unknown>): CourseDiagnosticRecord {
  return {
    schemaVersion: "1",
    kind: "tis-selection-source-record",
    raw: structuredClone(raw),
  };
}

export function bundleSelectionCourses(courses: readonly Course[]): SelectionCourseBundle[] {
  const groups = new Map<string, Course[]>();
  for (const course of courses) {
    const bundleId = course.selection?.bundleId ?? `tis-task:${course.rwh}`;
    const group = groups.get(bundleId) ?? [];
    group.push(course);
    groups.set(bundleId, group);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([bundleId, rows]) => buildBundle(bundleId, rows));
}

function buildBundle(bundleId: string, rows: readonly Course[]): SelectionCourseBundle {
  const warnings: string[] = [];
  const byComponent = new Map<string, Course>();
  for (const course of [...rows].sort(componentOrder)) {
    const componentId = course.selection?.componentId ?? course.rwh;
    const existing = byComponent.get(componentId);
    if (existing) {
      warnings.push(`Duplicate source row for component ${componentId} was merged.`);
      byComponent.set(componentId, {
        ...existing,
        teachers: unique([...existing.teachers, ...course.teachers]),
        schedule: uniqueMeetings([...existing.schedule, ...course.schedule]),
      });
      continue;
    }
    byComponent.set(componentId, course);
  }
  const ordered = [...byComponent.values()].sort(componentOrder);
  const identities = new Set(ordered.map((course) => `${course.code.trim().toUpperCase()}\u0000${course.name.trim()}`));
  if (identities.size > 1) warnings.push("Bundle source rows disagree on course identity; manual review is required.");

  const credit = resolveCreditCarrier(ordered);
  if (credit.status === "ambiguous") warnings.push("Bundle source rows disagree on credits; no credit value was projected.");
  const components = ordered.map((course, index): SelectionCourseComponent => ({
    componentId: course.selection?.componentId ?? course.rwh,
    type: course.selection?.componentType ?? "unknown",
    required: course.selection?.required ?? true,
    creditBearing: credit.index === index,
    taskId: course.rwh,
    ...(course.selection?.identifiers.mutation?.value
      ? { mutationCourseId: course.selection.identifiers.mutation.value }
      : course.id
        ? { mutationCourseId: course.id }
        : {}),
    sectionName: course.sectionName,
    ...(course.capacity !== undefined ? { capacity:course.capacity } : {}),
    ...(course.enrolled !== undefined ? { enrolled:course.enrolled } : {}),
    teachingTeam: [...course.teachers],
    meetings: [...course.schedule],
  }));
  const operationTargets = components.map((component): SelectionIdentifierTarget => ({
    componentId: component.componentId,
    taskId: component.taskId,
    ...(component.mutationCourseId ? { mutationCourseId: component.mutationCourseId } : {}),
    mutationPayloadField: "p_id",
    readbackIdentity: ["courseId", "rwh"],
  }));
  const requiredComponents = components.filter((component) => component.required);
  const selectableWithoutGuessing = requiredComponents.length > 0
    && requiredComponents.every((component) => Boolean(component.mutationCourseId && component.taskId));
  if (!selectableWithoutGuessing) warnings.push("At least one required component lacks an explicit mutation courseId/task rwh pair.");

  return {
    schemaVersion: "1",
    bundleId,
    courseCode: ordered[0]?.code ?? "",
    courseName: ordered[0]?.name ?? "",
    classGroup: ordered[0]?.classGroup ?? "",
    ...(credit.credits !== undefined ? { credits: credit.credits } : {}),
    creditStatus: credit.status,
    components,
    requiredComponentIds: requiredComponents.map((component) => component.componentId),
    teachingTeam: unique(components.flatMap((component) => component.teachingTeam)),
    meetings: components.flatMap((component) => component.meetings.map((meeting) => ({
      ...meeting,
      componentId: component.componentId,
      componentType: component.type,
    }))),
    operationTargets,
    selectableWithoutGuessing,
    warnings,
  };
}

function resolveCreditCarrier(courses: readonly Course[]): {
  index?: number;
  credits?: number;
  status: SelectionCourseBundle["creditStatus"];
} {
  const explicit = courses
    .map((course, index) => course.selection?.creditBearing === true ? index : undefined)
    .filter((index): index is number => index !== undefined);
  if (explicit.length === 1) return { index: explicit[0], credits: courses[explicit[0]]?.credits ?? 0, status: "explicit" };
  if (explicit.length > 1) return { status: "ambiguous" };

  const positiveValues = uniqueNumbers(courses.map((course) => course.credits).filter((credits) => credits > 0));
  if (positiveValues.length > 1) return { status: "ambiguous" };
  const index = courses.findIndex((course) => course.credits === (positiveValues[0] ?? 0));
  return {
    index: index >= 0 ? index : 0,
    credits: positiveValues[0] ?? 0,
    status: "deduplicated",
  };
}

function componentOrder(left: Course, right: Course): number {
  return componentRank(left.selection?.componentType ?? "unknown")
    - componentRank(right.selection?.componentType ?? "unknown")
    || left.rwh.localeCompare(right.rwh);
}

function componentRank(type: CourseComponentType): number {
  return ({ lecture: 0, lab: 1, tutorial: 2, other: 3, unknown: 4 })[type];
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function uniqueNumbers(values: readonly number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function uniqueMeetings(values: readonly ScheduleSlot[]): ScheduleSlot[] {
  const seen = new Set<string>();
  return values.filter((meeting) => {
    const key = JSON.stringify([
      meeting.weeks,
      meeting.day,
      meeting.periodStart,
      meeting.periodEnd,
      meeting.room,
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
