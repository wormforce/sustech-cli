import {
  diffAcademicSnapshots,
  type AcademicSnapshot,
  type AcademicSnapshotDiff,
  type AcademicSnapshotSourceName,
  type AcademicSnapshotSourceStatus,
} from "./snapshot.js";

const SOURCE_NAMES = ["schedule", "grades", "exams", "blackboardDeadlines"] as const;

export type AcademicSnapshotChangeType = "added" | "removed" | "changed";
export type AcademicSnapshotSourceChangeState = "changed" | "unchanged" | "unavailable";
export type AcademicSnapshotChangeState = "changed" | "unchanged" | "partial";
export type AcademicSnapshotWatchState = "baseline-created" | "baseline-reset" | AcademicSnapshotChangeState;

export interface AcademicSnapshotChange {
  source: AcademicSnapshotSourceName;
  type: AcademicSnapshotChangeType;
  key: string;
  title: string;
  description: string;
  before?: unknown;
  after?: unknown;
}

export interface AcademicSnapshotSourceChangeSummary {
  state: AcademicSnapshotSourceChangeState;
  comparable: boolean;
  beforeStatus?: AcademicSnapshotSourceStatus;
  afterStatus?: AcademicSnapshotSourceStatus;
  reason?: string;
  counts: {
    added: number;
    removed: number;
    changed: number;
    unchanged: number;
  };
  changes: AcademicSnapshotChange[];
}

/**
 * JSON-safe semantic change feed for local `changes` and future `watch`
 * commands. `hasChanges: false` confirms stability only when
 * `noChangesConfirmed` is also true.
 */
export interface AcademicSnapshotChangeSummary {
  schemaVersion: "1";
  kind: "sustech-academic-snapshot-change-summary";
  before: Pick<AcademicSnapshot, "generatedAt" | "semester" | "digest">;
  after: Pick<AcademicSnapshot, "generatedAt" | "semester" | "digest">;
  sameSemester: boolean;
  state: AcademicSnapshotChangeState;
  sources: Partial<Record<AcademicSnapshotSourceName, AcademicSnapshotSourceChangeSummary>>;
  changes: AcademicSnapshotChange[];
  summary: {
    comparableSources: number;
    unavailableSources: number;
    changedSources: number;
    added: number;
    removed: number;
    changed: number;
    unchanged: number;
    totalChanges: number;
    hasChanges: boolean;
    complete: boolean;
    noChangesConfirmed: boolean;
  };
}

export interface AcademicSnapshotWatchResult {
  schemaVersion: "1";
  kind: "sustech-academic-watch-result";
  state: AcademicSnapshotWatchState;
  noComparison: boolean;
  comparisonAvailable: boolean;
  baselineUpdated: boolean;
  previous?: Pick<AcademicSnapshot, "generatedAt" | "semester" | "digest">;
  current: Pick<AcademicSnapshot, "generatedAt" | "semester" | "digest">;
  changes?: AcademicSnapshotChangeSummary;
}

export function diffAcademicSnapshotChanges(
  before: AcademicSnapshot,
  after: AcademicSnapshot,
): AcademicSnapshotChangeSummary {
  return summarizeAcademicSnapshotDiff(diffAcademicSnapshots(before, after));
}

export function comparableAcademicSnapshotSourceCount(snapshot: AcademicSnapshot): number {
  return Object.values(snapshot.sources).filter((source) => source?.status === "ok").length;
}

export function summarizeAcademicSnapshotDiff(diff: AcademicSnapshotDiff): AcademicSnapshotChangeSummary {
  const sources: Partial<Record<AcademicSnapshotSourceName, AcademicSnapshotSourceChangeSummary>> = {};
  const changes: AcademicSnapshotChange[] = [];
  let comparableSources = 0;
  let unavailableSources = 0;
  let changedSources = 0;
  let added = 0;
  let removed = 0;
  let changed = 0;
  let unchanged = 0;

  for (const sourceName of SOURCE_NAMES) {
    const source = diff.sources[sourceName];
    if (!source) continue;
    if (!diff.sameSemester || !source.comparable) {
      unavailableSources += 1;
      sources[sourceName] = {
        state: "unavailable",
        comparable: false,
        ...(source.beforeStatus ? { beforeStatus: source.beforeStatus } : {}),
        ...(source.afterStatus ? { afterStatus: source.afterStatus } : {}),
        reason: !diff.sameSemester
          ? "Snapshots from different semesters are not treated as a change-tracking pair."
          : source.reason ?? "Source is not comparable.",
        counts: { added: 0, removed: 0, changed: 0, unchanged: 0 },
        changes: [],
      };
      continue;
    }

    comparableSources += 1;
    const sourceChanges = [
      ...source.added.map((entry) => readableChange(sourceName, "added", entry.key, undefined, entry.value)),
      ...source.removed.map((entry) => readableChange(sourceName, "removed", entry.key, entry.value, undefined)),
      ...source.changed.map((entry) => readableChange(sourceName, "changed", entry.key, entry.before, entry.after)),
    ];
    if (sourceChanges.length > 0) changedSources += 1;
    added += source.added.length;
    removed += source.removed.length;
    changed += source.changed.length;
    unchanged += source.unchanged;
    changes.push(...sourceChanges);
    sources[sourceName] = {
      state: sourceChanges.length > 0 ? "changed" : "unchanged",
      comparable: true,
      beforeStatus: source.beforeStatus,
      afterStatus: source.afterStatus,
      counts: {
        added: source.added.length,
        removed: source.removed.length,
        changed: source.changed.length,
        unchanged: source.unchanged,
      },
      changes: sourceChanges,
    };
  }

  const totalChanges = added + removed + changed;
  const complete = diff.sameSemester && unavailableSources === 0;
  const hasChanges = totalChanges > 0;
  return {
    schemaVersion: "1",
    kind: "sustech-academic-snapshot-change-summary",
    before: diff.before,
    after: diff.after,
    sameSemester: diff.sameSemester,
    state: complete ? (hasChanges ? "changed" : "unchanged") : "partial",
    sources,
    changes,
    summary: {
      comparableSources,
      unavailableSources,
      changedSources,
      added,
      removed,
      changed,
      unchanged,
      totalChanges,
      hasChanges,
      complete,
      noChangesConfirmed: complete && !hasChanges,
    },
  };
}

export function formatAcademicSnapshotChanges(
  changes: AcademicSnapshotChangeSummary,
  options: { maxChanges?: number } = {},
): string {
  const lines = [
    `Academic changes · ${changes.before.semester} · ${changes.before.generatedAt} → ${changes.after.generatedAt}`,
    `State: ${changes.state} · ${changes.summary.totalChanges} verified change(s) · ${changes.summary.unavailableSources} unavailable source(s)`,
  ];
  if (!changes.sameSemester) lines.push("Comparison is partial: snapshots belong to different semesters.");
  appendChangeLines(lines, changes, options.maxChanges);
  if (changes.summary.noChangesConfirmed) lines.push("No academic changes detected across all included sources.");
  else if (!changes.summary.hasChanges && !changes.summary.complete) {
    lines.push("No changes were reported, but the comparison is incomplete.");
  }
  return lines.join("\n");
}

export function evaluateAcademicSnapshotWatch(
  previous: AcademicSnapshot | undefined,
  current: AcademicSnapshot,
  options: { overwrite?: boolean } = {},
): AcademicSnapshotWatchResult {
  const currentReference = snapshotReference(current);
  if (!previous) {
    return {
      schemaVersion: "1",
      kind: "sustech-academic-watch-result",
      state: "baseline-created",
      noComparison: true,
      comparisonAvailable: false,
      baselineUpdated: true,
      current: currentReference,
    };
  }

  const previousReference = snapshotReference(previous);
  if (options.overwrite) {
    return {
      schemaVersion: "1",
      kind: "sustech-academic-watch-result",
      state: "baseline-reset",
      noComparison: true,
      comparisonAvailable: false,
      baselineUpdated: true,
      previous: previousReference,
      current: currentReference,
    };
  }

  const changes = diffAcademicSnapshotChanges(previous, current);
  const comparisonAvailable = changes.summary.comparableSources > 0;
  return {
    schemaVersion: "1",
    kind: "sustech-academic-watch-result",
    state: comparisonAvailable ? changes.state : "partial",
    noComparison: false,
    comparisonAvailable,
    baselineUpdated: comparisonAvailable,
    previous: previousReference,
    current: currentReference,
    changes,
  };
}

export function formatAcademicSnapshotWatch(
  result: AcademicSnapshotWatchResult,
  statePath: string,
  options: { maxChanges?: number } = {},
): string {
  const lines = [
    `Academic watch · ${result.current.semester}`,
    `State file ${statePath}`,
    `State: ${result.state} · baseline ${result.baselineUpdated ? "updated" : "unchanged"} locally`,
  ];

  if (result.noComparison) {
    lines.push(result.state === "baseline-reset"
      ? "Comparison skipped because the baseline was explicitly reset."
      : "Baseline created; no comparison was available yet.");
    lines.push(`Current digest ${result.current.digest}`);
    return lines.join("\n");
  }

  const changes = result.changes;
  if (!changes) return lines.join("\n");
  lines.push(`Comparison: ${changes.before.generatedAt} → ${changes.after.generatedAt}`);
  lines.push(`Comparable sources: ${changes.summary.comparableSources} · unavailable: ${changes.summary.unavailableSources} · verified changes: ${changes.summary.totalChanges}`);
  appendChangeLines(lines, changes, options.maxChanges);
  if (!result.comparisonAvailable) {
    lines.push("Baseline was left unchanged because no complete source was comparable.");
  } else if (changes.summary.noChangesConfirmed) {
    lines.push("No academic changes detected across all included sources.");
  } else if (!changes.summary.hasChanges && !changes.summary.complete) {
    lines.push("No changes were reported, but the comparison is incomplete.");
  }
  return lines.join("\n");
}

function readableChange(
  source: AcademicSnapshotSourceName,
  type: AcademicSnapshotChangeType,
  key: string,
  before: unknown,
  after: unknown,
): AcademicSnapshotChange {
  const representative = type === "removed" ? before : after;
  const title = itemTitle(source, representative, key);
  const noun = source === "schedule"
    ? "Timetable entry"
    : source === "grades"
      ? "Grade record"
      : source === "exams"
        ? "Exam"
        : "Deadline";
  const description = type === "changed"
    ? `${noun} changed: ${title} · ${describeFieldChanges(source, before, after)}`
    : `${noun} ${type}: ${title}${describeItem(source, representative)}`;
  return {
    source,
    type,
    key,
    title,
    description,
    ...(type !== "added" ? { before } : {}),
    ...(type !== "removed" ? { after } : {}),
  };
}

function itemTitle(source: AcademicSnapshotSourceName, value: unknown, fallback: string): string {
  const record = asRecord(value);
  if (source === "blackboardDeadlines") {
    return compactParts([compactParts([record.courseCode, record.courseName]), record.title]) || compactText(fallback);
  }
  const course = compactParts([record.code ?? record.courseCode, record.name ?? record.courseName]);
  if (course) return course;
  if (source === "schedule") return compactParts([record.description, record.rwh, record.key]) || compactText(fallback);
  return compactText(fallback);
}

function describeItem(source: AcademicSnapshotSourceName, value: unknown): string {
  const record = asRecord(value);
  const details: string[] = [];
  if (source === "schedule") {
    const day = scalarText(record.day);
    const start = scalarText(record.periodStart);
    const end = scalarText(record.periodEnd);
    if (day) details.push(`day ${day}`);
    if (start) details.push(`period ${start}${end && end !== start ? `-${end}` : ""}`);
    if (scalarText(record.room)) details.push(`room ${compactText(record.room)}`);
    if (scalarText(record.teacher)) details.push(`teacher ${compactText(record.teacher)}`);
    if (Array.isArray(record.weeks) && record.weeks.length > 0) details.push(`weeks ${formatList(record.weeks)}`);
  } else if (source === "grades") {
    if (scalarText(record.letterGrade)) details.push(`grade ${compactText(record.letterGrade)}`);
    if (scalarText(record.numericScore)) details.push(`score ${compactText(record.numericScore)}`);
    if (scalarText(record.credits)) details.push(`${compactText(record.credits)} credit(s)`);
  } else if (source === "exams") {
    if (scalarText(record.date)) details.push(compactText(record.date));
    if (scalarText(record.time)) details.push(compactText(record.time));
    const place = compactParts([record.building, record.room]);
    if (place) details.push(place);
    if (scalarText(record.type)) details.push(compactText(record.type));
  } else {
    if (scalarText(record.dueAt)) details.push(`due ${compactText(record.dueAt)}`);
    if (scalarText(record.availability)) details.push(compactText(record.availability));
    if (scalarText(record.scorePossible)) details.push(`${compactText(record.scorePossible)} point(s)`);
  }
  return details.length > 0 ? ` · ${details.join(" · ")}` : "";
}

function describeFieldChanges(source: AcademicSnapshotSourceName, before: unknown, after: unknown): string {
  const beforeRecord = asRecord(before);
  const afterRecord = asRecord(after);
  const details = changeFields(source)
    .filter(([field]) => !sameValue(beforeRecord[field], afterRecord[field]))
    .map(([field, label]) => `${label} ${formatValue(beforeRecord[field])} → ${formatValue(afterRecord[field])}`);
  if (details.length > 0) return details.join("; ");
  return sameValue(before, after) ? "no semantic field change" : "record details changed";
}

function changeFields(source: AcademicSnapshotSourceName): ReadonlyArray<readonly [string, string]> {
  if (source === "schedule") return [
    ["courseCode", "course"], ["courseName", "course name"], ["teacher", "teacher"], ["room", "room"],
    ["day", "day"], ["periodStart", "start period"], ["periodEnd", "end period"], ["weeks", "weeks"],
    ["description", "schedule"], ["descriptionEn", "English schedule"],
  ];
  if (source === "grades") return [
    ["code", "course"], ["name", "course name"], ["letterGrade", "grade"], ["numericScore", "score"],
    ["credits", "credits"], ["nature", "nature"], ["department", "department"],
  ];
  if (source === "exams") return [
    ["code", "course"], ["name", "course name"], ["date", "date"], ["time", "time"],
    ["periodStart", "start period"], ["periodEnd", "end period"], ["building", "building"],
    ["room", "room"], ["campus", "campus"], ["type", "type"],
  ];
  return [
    ["courseCode", "course"], ["courseName", "course name"], ["title", "title"], ["dueAt", "due"],
    ["availability", "availability"], ["scorePossible", "score"], ["attemptsAllowed", "attempts"],
  ];
}

function appendChangeLines(lines: string[], changes: AcademicSnapshotChangeSummary, requestedMax: number | undefined): void {
  const max = Number.isFinite(requestedMax) ? Math.max(0, Math.floor(requestedMax as number)) : 50;
  let rendered = 0;
  for (const sourceName of SOURCE_NAMES) {
    const source = changes.sources[sourceName];
    if (!source) continue;
    const label = sourceLabel(sourceName);
    if (!source.comparable) {
      lines.push(`  ${label}: not comparable · ${source.reason ?? "source unavailable"}`);
      continue;
    }
    lines.push(`  ${label}: +${source.counts.added} -${source.counts.removed} ~${source.counts.changed} =${source.counts.unchanged}`);
    for (const change of source.changes) {
      if (rendered >= max) continue;
      const marker = change.type === "added" ? "+" : change.type === "removed" ? "-" : "~";
      lines.push(`    ${marker} ${change.description}`);
      rendered += 1;
    }
  }
  const omitted = changes.summary.totalChanges - rendered;
  if (omitted > 0) lines.push(`  … ${omitted} additional change(s) omitted from text output.`);
}

function sourceLabel(source: AcademicSnapshotSourceName): string {
  if (source === "schedule") return "Timetable";
  if (source === "grades") return "Grades";
  if (source === "exams") return "Exams";
  return "Blackboard deadlines";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function compactParts(values: readonly unknown[]): string {
  const parts = values.map(compactText).filter(Boolean);
  return [...new Set(parts)].join(" · ").slice(0, 240);
}

function compactText(value: unknown): string {
  const text = typeof value === "boolean" ? String(value) : scalarText(value);
  return text.replace(/\s+/g, " ").slice(0, 160);
}

function scalarText(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "(none)";
  if (Array.isArray(value)) return formatList(value);
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return compactText(value) || "(none)";
  }
  return "(details)";
}

function formatList(values: readonly unknown[]): string {
  const rendered = values.slice(0, 12).map(compactText).filter(Boolean);
  return `${rendered.join(", ")}${values.length > rendered.length ? ", …" : ""}` || "(none)";
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, stableValue(record[key])]));
}

function snapshotReference(snapshot: AcademicSnapshot): Pick<AcademicSnapshot, "generatedAt" | "semester" | "digest"> {
  return {
    generatedAt: snapshot.generatedAt,
    semester: snapshot.semester,
    digest: snapshot.digest,
  };
}
