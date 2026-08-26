import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, lstat, readFile, stat, unlink } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { CliError } from "../core/errors.js";
import { writeJsonAtomically } from "../core/local-store.js";

export const ACADEMIC_SNAPSHOT_SCHEMA_VERSION = "1";
export const ACADEMIC_SNAPSHOT_KIND = "sustech-academic-snapshot";
const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024;
const MAX_SOURCE_ITEMS = 50_000;

export type AcademicSnapshotSourceName = "schedule" | "grades" | "exams" | "blackboardDeadlines";
export type AcademicSnapshotSourceStatus = "ok" | "partial" | "error";

export interface AcademicSnapshotFailure {
  code: string;
  message: string;
}

export interface AcademicSnapshotSource {
  status: AcademicSnapshotSourceStatus;
  items: unknown[];
  failures: AcademicSnapshotFailure[];
}

export interface AcademicSnapshot {
  schemaVersion: typeof ACADEMIC_SNAPSHOT_SCHEMA_VERSION;
  kind: typeof ACADEMIC_SNAPSHOT_KIND;
  generatedAt: string;
  semester: string;
  sources: Partial<Record<AcademicSnapshotSourceName, AcademicSnapshotSource>>;
  digest: string;
}

export interface AcademicSnapshotSourceDiff {
  comparable: boolean;
  beforeStatus?: AcademicSnapshotSourceStatus;
  afterStatus?: AcademicSnapshotSourceStatus;
  reason?: string;
  added: Array<{ key: string; value: unknown }>;
  removed: Array<{ key: string; value: unknown }>;
  changed: Array<{ key: string; before: unknown; after: unknown }>;
  unchanged: number;
}

export interface AcademicSnapshotDiff {
  schemaVersion: "1";
  kind: "sustech-academic-snapshot-diff";
  before: Pick<AcademicSnapshot, "generatedAt" | "semester" | "digest">;
  after: Pick<AcademicSnapshot, "generatedAt" | "semester" | "digest">;
  sameSemester: boolean;
  sources: Partial<Record<AcademicSnapshotSourceName, AcademicSnapshotSourceDiff>>;
  summary: {
    comparableSources: number;
    unavailableSources: number;
    added: number;
    removed: number;
    changed: number;
    unchanged: number;
    hasChanges: boolean;
  };
}

export function academicSnapshotSource(
  items: readonly unknown[],
  options: { status?: AcademicSnapshotSourceStatus; failures?: readonly AcademicSnapshotFailure[] } = {},
): AcademicSnapshotSource {
  if (items.length > MAX_SOURCE_ITEMS) {
    throw new CliError("Academic snapshot source exceeds the supported item limit.", "ACADEMIC_SNAPSHOT_TOO_LARGE", 2, {
      itemCount: items.length,
      maxItems: MAX_SOURCE_ITEMS,
    });
  }
  const failures = [...(options.failures ?? [])].map(normaliseFailure);
  return {
    status: options.status ?? (failures.length > 0 ? "partial" : "ok"),
    items: [...items],
    failures,
  };
}

export function academicSnapshotError(error: unknown): AcademicSnapshotSource {
  const failure = failureFromUnknown(error);
  return { status: "error", items: [], failures: [failure] };
}

export function buildAcademicSnapshot(input: {
  semester: string;
  sources: Partial<Record<AcademicSnapshotSourceName, AcademicSnapshotSource>>;
  generatedAt?: Date | string;
}): AcademicSnapshot {
  const semester = input.semester.trim();
  if (!/^\d{4}-\d{4}-[123]$/.test(semester)) {
    throw new CliError("Academic snapshot semester must be YYYY-YYYY-N.", "ACADEMIC_SNAPSHOT_INVALID", 2, { semester });
  }
  const generatedAt = normaliseIsoTimestamp(input.generatedAt ?? new Date());
  const sources = normaliseSources(input.sources);
  if (Object.keys(sources).length === 0) {
    throw new CliError("Academic snapshot must include at least one source.", "ACADEMIC_SNAPSHOT_INVALID", 2);
  }
  const unsigned = {
    schemaVersion: ACADEMIC_SNAPSHOT_SCHEMA_VERSION,
    kind: ACADEMIC_SNAPSHOT_KIND,
    generatedAt,
    semester,
    sources,
  } as const;
  return { ...unsigned, digest: digestSnapshot(unsigned) };
}

export async function saveAcademicSnapshot(
  destination: string,
  snapshot: AcademicSnapshot,
  options: { overwrite?: boolean } = {},
): Promise<string> {
  const absolutePath = resolveRequiredPath(destination, "Academic snapshot destination");
  await assertSnapshot(snapshot);
  if (options.overwrite) {
    await writeJsonAtomically(absolutePath, snapshot);
    return absolutePath;
  }

  await rejectExistingDestination(absolutePath);
  const temporary = resolve(dirname(absolutePath), `.${basename(absolutePath)}.${process.pid}.${randomUUID()}.snapshot-tmp`);
  let temporaryWritten = false;
  try {
    await writeJsonAtomically(temporary, snapshot);
    temporaryWritten = true;
    await copyFile(temporary, absolutePath, constants.COPYFILE_EXCL);
  } catch (error) {
    if (isNodeError(error, "EEXIST")) {
      throw new CliError(
        `Refusing to replace an existing academic snapshot: ${absolutePath}`,
        "ACADEMIC_SNAPSHOT_EXISTS",
        2,
        { path: absolutePath },
      );
    }
    throw error;
  } finally {
    if (temporaryWritten) await unlink(temporary).catch(() => undefined);
  }
  return absolutePath;
}

export async function loadAcademicSnapshot(path: string): Promise<AcademicSnapshot> {
  const absolutePath = resolveRequiredPath(path, "Academic snapshot path");
  let metadata: Awaited<ReturnType<typeof stat>>;
  try {
    metadata = await stat(absolutePath);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      throw new CliError(`Academic snapshot not found: ${absolutePath}`, "ACADEMIC_SNAPSHOT_NOT_FOUND", 2, { path: absolutePath });
    }
    throw error;
  }
  if (!metadata.isFile()) {
    throw new CliError("Academic snapshot path must be a regular file.", "ACADEMIC_SNAPSHOT_INVALID", 2, { path: absolutePath });
  }
  if (metadata.size > MAX_SNAPSHOT_BYTES) {
    throw new CliError("Academic snapshot file exceeds the supported size limit.", "ACADEMIC_SNAPSHOT_TOO_LARGE", 2, {
      path: absolutePath,
      size: metadata.size,
      maxBytes: MAX_SNAPSHOT_BYTES,
    });
  }
  let value: unknown;
  try {
    value = JSON.parse(await readFile(absolutePath, "utf8")) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new CliError("Academic snapshot is not valid JSON.", "ACADEMIC_SNAPSHOT_INVALID", 2, { path: absolutePath });
    }
    throw error;
  }
  return assertSnapshot(value, absolutePath);
}

export function diffAcademicSnapshots(before: AcademicSnapshot, after: AcademicSnapshot): AcademicSnapshotDiff {
  assertSnapshotSync(before);
  assertSnapshotSync(after);
  const sourceNames = new Set<AcademicSnapshotSourceName>([
    ...(Object.keys(before.sources) as AcademicSnapshotSourceName[]),
    ...(Object.keys(after.sources) as AcademicSnapshotSourceName[]),
  ]);
  const sources: Partial<Record<AcademicSnapshotSourceName, AcademicSnapshotSourceDiff>> = {};
  let comparableSources = 0;
  let unavailableSources = 0;
  let added = 0;
  let removed = 0;
  let changed = 0;
  let unchanged = 0;

  for (const sourceName of [...sourceNames].sort()) {
    const beforeSource = before.sources[sourceName];
    const afterSource = after.sources[sourceName];
    if (!beforeSource || !afterSource || beforeSource.status !== "ok" || afterSource.status !== "ok") {
      unavailableSources += 1;
      sources[sourceName] = {
        comparable: false,
        ...(beforeSource ? { beforeStatus: beforeSource.status } : {}),
        ...(afterSource ? { afterStatus: afterSource.status } : {}),
        reason: !beforeSource || !afterSource
          ? "Source is absent from one snapshot."
          : "Only complete sources with status 'ok' are compared.",
        added: [],
        removed: [],
        changed: [],
        unchanged: 0,
      };
      continue;
    }
    comparableSources += 1;
    const sourceDiff = diffSource(sourceName, beforeSource.items, afterSource.items);
    sources[sourceName] = sourceDiff;
    added += sourceDiff.added.length;
    removed += sourceDiff.removed.length;
    changed += sourceDiff.changed.length;
    unchanged += sourceDiff.unchanged;
  }

  return {
    schemaVersion: "1",
    kind: "sustech-academic-snapshot-diff",
    before: snapshotReference(before),
    after: snapshotReference(after),
    sameSemester: before.semester === after.semester,
    sources,
    summary: {
      comparableSources,
      unavailableSources,
      added,
      removed,
      changed,
      unchanged,
      hasChanges: added + removed + changed > 0,
    },
  };
}

export function formatAcademicSnapshot(snapshot: AcademicSnapshot, path: string): string {
  const lines = [
    `Academic snapshot · ${snapshot.semester}`,
    `Saved to ${path}`,
    `Digest ${snapshot.digest}`,
  ];
  for (const [name, source] of Object.entries(snapshot.sources).sort(([left], [right]) => left.localeCompare(right))) {
    if (!source) continue;
    lines.push(`  ${name}: ${source.status} · ${source.items.length} item(s)${source.failures.length ? ` · ${source.failures.length} failure(s)` : ""}`);
  }
  return lines.join("\n");
}

export function formatAcademicSnapshotDiff(diff: AcademicSnapshotDiff): string {
  const lines = [
    `Academic snapshot diff · ${diff.before.semester} → ${diff.after.semester}`,
    `Comparable sources: ${diff.summary.comparableSources} · unavailable: ${diff.summary.unavailableSources}`,
    `Added ${diff.summary.added} · removed ${diff.summary.removed} · changed ${diff.summary.changed} · unchanged ${diff.summary.unchanged}`,
  ];
  for (const [name, source] of Object.entries(diff.sources).sort(([left], [right]) => left.localeCompare(right))) {
    if (!source) continue;
    lines.push(source.comparable
      ? `  ${name}: +${source.added.length} -${source.removed.length} ~${source.changed.length} =${source.unchanged}`
      : `  ${name}: not comparable · ${source.reason ?? "source unavailable"}`);
  }
  return lines.join("\n");
}

function diffSource(
  sourceName: AcademicSnapshotSourceName,
  beforeItems: readonly unknown[],
  afterItems: readonly unknown[],
): AcademicSnapshotSourceDiff {
  const beforeGroups = groupItems(sourceName, beforeItems);
  const afterGroups = groupItems(sourceName, afterItems);
  const added: AcademicSnapshotSourceDiff["added"] = [];
  const removed: AcademicSnapshotSourceDiff["removed"] = [];
  const changed: AcademicSnapshotSourceDiff["changed"] = [];
  let unchanged = 0;
  const keys = new Set([...beforeGroups.keys(), ...afterGroups.keys()]);

  for (const key of [...keys].sort()) {
    const beforeGroup = [...(beforeGroups.get(key) ?? [])];
    const afterGroup = [...(afterGroups.get(key) ?? [])];
    const unmatchedAfter = new Map<string, unknown[]>();
    for (const value of afterGroup) {
      const canonical = stableStringify(value);
      unmatchedAfter.set(canonical, [...(unmatchedAfter.get(canonical) ?? []), value]);
    }
    const unmatchedBefore: unknown[] = [];
    for (const value of beforeGroup) {
      const canonical = stableStringify(value);
      const matches = unmatchedAfter.get(canonical);
      if (matches?.length) {
        matches.pop();
        unchanged += 1;
      } else {
        unmatchedBefore.push(value);
      }
    }
    const remainingAfter = [...unmatchedAfter.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .flatMap(([, values]) => values);
    unmatchedBefore.sort((left, right) => stableStringify(left).localeCompare(stableStringify(right)));
    const paired = Math.min(unmatchedBefore.length, remainingAfter.length);
    for (let index = 0; index < paired; index += 1) {
      changed.push({ key: indexedKey(key, index, Math.max(unmatchedBefore.length, remainingAfter.length)), before: unmatchedBefore[index], after: remainingAfter[index] });
    }
    for (let index = paired; index < unmatchedBefore.length; index += 1) {
      removed.push({ key: indexedKey(key, index, unmatchedBefore.length), value: unmatchedBefore[index] });
    }
    for (let index = paired; index < remainingAfter.length; index += 1) {
      added.push({ key: indexedKey(key, index, remainingAfter.length), value: remainingAfter[index] });
    }
  }

  return { comparable: true, beforeStatus: "ok", afterStatus: "ok", added, removed, changed, unchanged };
}

function groupItems(sourceName: AcademicSnapshotSourceName, items: readonly unknown[]): Map<string, unknown[]> {
  const groups = new Map<string, unknown[]>();
  for (const value of items) {
    const key = sourceIdentity(sourceName, value);
    groups.set(key, [...(groups.get(key) ?? []), value]);
  }
  return groups;
}

function sourceIdentity(sourceName: AcademicSnapshotSourceName, value: unknown): string {
  const record = asRecord(value);
  if (sourceName === "schedule") return firstIdentity(record, ["rwh", "key", "courseCode"], value);
  if (sourceName === "grades") return joinedIdentity(record, ["semester", "code"], value);
  if (sourceName === "exams") return joinedIdentity(record, ["semester", "code", "type"], value);
  return joinedIdentity(record, ["courseId", "columnId"], value);
}

function firstIdentity(record: Record<string, unknown>, fields: readonly string[], fallback: unknown): string {
  for (const field of fields) {
    const value = scalarText(record[field]);
    if (value) return `${field}:${value}`;
  }
  return `digest:${digestValue(fallback)}`;
}

function joinedIdentity(record: Record<string, unknown>, fields: readonly string[], fallback: unknown): string {
  const values = fields.map((field) => scalarText(record[field]));
  return values.some(Boolean) ? fields.map((field, index) => `${field}:${values[index] || "?"}`).join("|") : `digest:${digestValue(fallback)}`;
}

function indexedKey(key: string, index: number, total: number): string {
  return total > 1 ? `${key}#${index + 1}` : key;
}

async function assertSnapshot(value: unknown, path?: string): Promise<AcademicSnapshot> {
  return assertSnapshotSync(value, path);
}

function assertSnapshotSync(value: unknown, path?: string): AcademicSnapshot {
  const record = asRecord(value);
  if (record.schemaVersion !== ACADEMIC_SNAPSHOT_SCHEMA_VERSION || record.kind !== ACADEMIC_SNAPSHOT_KIND) {
    throw invalidSnapshot("Academic snapshot has an unsupported kind or schema version.", path);
  }
  const generatedAt = scalarText(record.generatedAt);
  const semester = scalarText(record.semester);
  const digest = scalarText(record.digest);
  if (!generatedAt || !semester || !digest || !/^[a-f0-9]{64}$/.test(digest)) {
    throw invalidSnapshot("Academic snapshot metadata is incomplete.", path);
  }
  normaliseIsoTimestamp(generatedAt);
  if (!/^\d{4}-\d{4}-[123]$/.test(semester)) throw invalidSnapshot("Academic snapshot semester is invalid.", path);
  const sources = normaliseSources(asRecord(record.sources));
  if (Object.keys(sources).length === 0) throw invalidSnapshot("Academic snapshot has no sources.", path);
  const snapshot: AcademicSnapshot = {
    schemaVersion: ACADEMIC_SNAPSHOT_SCHEMA_VERSION,
    kind: ACADEMIC_SNAPSHOT_KIND,
    generatedAt,
    semester,
    sources,
    digest,
  };
  const expected = digestSnapshot({
    schemaVersion: snapshot.schemaVersion,
    kind: snapshot.kind,
    generatedAt: snapshot.generatedAt,
    semester: snapshot.semester,
    sources: snapshot.sources,
  });
  if (expected !== snapshot.digest) {
    throw invalidSnapshot("Academic snapshot digest does not match its contents.", path, {
      expectedDigest: expected,
      actualDigest: snapshot.digest,
    });
  }
  return snapshot;
}

function normaliseSources(value: unknown): Partial<Record<AcademicSnapshotSourceName, AcademicSnapshotSource>> {
  const record = asRecord(value);
  const sources: Partial<Record<AcademicSnapshotSourceName, AcademicSnapshotSource>> = {};
  for (const name of ["schedule", "grades", "exams", "blackboardDeadlines"] as const) {
    if (record[name] === undefined) continue;
    const source = asRecord(record[name]);
    const status = source.status;
    if (status !== "ok" && status !== "partial" && status !== "error") {
      throw invalidSnapshot(`Academic snapshot source '${name}' has an invalid status.`);
    }
    if (!Array.isArray(source.items) || source.items.length > MAX_SOURCE_ITEMS || !Array.isArray(source.failures)) {
      throw invalidSnapshot(`Academic snapshot source '${name}' has invalid items or failures.`);
    }
    const failures = source.failures.map((failure) => normaliseFailure(asRecord(failure)));
    if (status === "ok" && failures.length > 0) throw invalidSnapshot(`Academic snapshot source '${name}' cannot be ok with failures.`);
    if (status === "error" && source.items.length > 0) throw invalidSnapshot(`Academic snapshot source '${name}' cannot contain items after an error.`);
    sources[name] = { status, items: [...source.items], failures };
  }
  return sources;
}

function normaliseFailure(value: AcademicSnapshotFailure | Record<string, unknown>): AcademicSnapshotFailure {
  const record = asRecord(value);
  const code = scalarText(record.code);
  const message = scalarText(record.message);
  if (!code || !message || code.length > 160) {
    throw invalidSnapshot("Academic snapshot contains an invalid failure record.");
  }
  return { code, message: safeFailureMessage(message) };
}

function failureFromUnknown(error: unknown): AcademicSnapshotFailure {
  if (error instanceof CliError) return { code: error.code, message: safeFailureMessage(error.message) };
  if (error instanceof Error) return { code: "SOURCE_ERROR", message: safeFailureMessage(error.message) };
  return { code: "SOURCE_ERROR", message: safeFailureMessage(String(error)) };
}

function digestSnapshot(value: Omit<AcademicSnapshot, "digest">): string {
  return digestValue(value);
}

function digestValue(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value)) ?? "null";
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, stableValue(record[key])]));
}

function snapshotReference(snapshot: AcademicSnapshot): Pick<AcademicSnapshot, "generatedAt" | "semester" | "digest"> {
  return { generatedAt: snapshot.generatedAt, semester: snapshot.semester, digest: snapshot.digest };
}

function normaliseIsoTimestamp(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw invalidSnapshot("Academic snapshot timestamp is invalid.");
  return date.toISOString();
}

function resolveRequiredPath(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("\u0000")) throw new CliError(`${label} is required.`, "USAGE", 2);
  return resolve(trimmed);
}

async function rejectExistingDestination(path: string): Promise<void> {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) {
      throw new CliError("Refusing to replace a symbolic-link academic snapshot destination.", "UNSAFE_LOCAL_PATH", 2, { path });
    }
    throw new CliError(`Refusing to replace an existing academic snapshot: ${path}`, "ACADEMIC_SNAPSHOT_EXISTS", 2, { path });
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return;
    throw error;
  }
}

function invalidSnapshot(message: string, path?: string, details: Record<string, unknown> = {}): CliError {
  return new CliError(message, "ACADEMIC_SNAPSHOT_INVALID", 2, { ...(path ? { path } : {}), ...details });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function scalarText(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function safeFailureMessage(value: string): string {
  return value
    .replace(/\b(authorization|cookie|password|token)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .slice(0, 2_000) || "Source failed without an error message.";
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
