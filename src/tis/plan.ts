import type { Semester } from "../core/semester.js";
import { CliError } from "../core/errors.js";
import { readJsonFile, resolveLocalDataPath, writeJsonAtomically } from "../core/local-store.js";
import {
  DEFAULT_TIMETABLE_PREFERENCES,
  normaliseTimetablePreferences,
  parseBlockedTime,
  type BlockedTime,
  type TimetablePreferenceInput,
  type TimetablePreferences,
} from "./planner.js";

const PLAN_SCHEMA_VERSION = "1";
const PLAN_KIND = "tis-plan";
const DEFAULT_PLAN_FILE = "tis-plan.json";

export interface TisPlanDocument {
  schemaVersion: "1";
  kind: "tis-plan";
  savedAt: string;
  semester?: string;
  requestedCodes: string[];
  blocked: BlockedTime[];
  preferences: TimetablePreferences;
}

export interface TisPlanView {
  path: string;
  plan: TisPlanDocument;
}

export function resolvePlanPath(path: string | undefined): string {
  return resolveLocalDataPath(path, DEFAULT_PLAN_FILE);
}

export function createPlanDocument(input: {
  savedAt?: string;
  semester?: Semester;
  requestedCodes?: readonly string[];
  blocked?: readonly BlockedTime[];
  preferences?: TimetablePreferenceInput;
}): TisPlanDocument {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: PLAN_KIND,
    savedAt: input.savedAt ?? new Date().toISOString(),
    ...(input.semester ? { semester: input.semester.value } : {}),
    requestedCodes: normaliseCodes(input.requestedCodes ?? []),
    blocked: normaliseBlocked(input.blocked ?? []),
    preferences: normaliseTimetablePreferences(input.preferences ?? DEFAULT_TIMETABLE_PREFERENCES),
  };
}

export async function loadPlan(path: string | undefined): Promise<TisPlanView> {
  const resolvedPath = resolvePlanPath(path);
  return {
    path: resolvedPath,
    plan: parsePlanDocument(await readJsonFile(resolvedPath, "TIS_PLAN_NOT_FOUND", "TIS_PLAN_INVALID"), resolvedPath),
  };
}

export async function savePlan(path: string | undefined, plan: TisPlanDocument): Promise<TisPlanView> {
  const resolvedPath = resolvePlanPath(path);
  const normalised = createPlanDocument({
    savedAt: plan.savedAt,
    ...(plan.semester ? { semester: parseStoredSemester(plan.semester) } : {}),
    requestedCodes: plan.requestedCodes,
    blocked: plan.blocked,
    preferences: plan.preferences,
  });
  await writeJsonAtomically(resolvedPath, normalised);
  return { path: resolvedPath, plan: normalised };
}

export function addPlanEntries(plan: TisPlanDocument, update: {
  semester?: Semester;
  requestedCodes?: readonly string[];
  blocked?: readonly BlockedTime[];
}): TisPlanDocument {
  return createPlanDocument({
    semester: update.semester ?? (plan.semester ? parseStoredSemester(plan.semester) : undefined),
    requestedCodes: [...plan.requestedCodes, ...(update.requestedCodes ?? [])],
    blocked: [...plan.blocked, ...(update.blocked ?? [])],
    preferences: plan.preferences,
  });
}

export function removePlanEntries(plan: TisPlanDocument, update: {
  requestedCodes?: readonly string[];
  blocked?: readonly BlockedTime[];
}): TisPlanDocument {
  const removeCodes = new Set(normaliseCodes(update.requestedCodes ?? []));
  const removeBlocked = new Set(normaliseBlocked(update.blocked ?? []).map(blockedIdentity));
  return createPlanDocument({
    ...(plan.semester ? { semester: parseStoredSemester(plan.semester) } : {}),
    requestedCodes: plan.requestedCodes.filter((code) => !removeCodes.has(code)),
    blocked: plan.blocked.filter((blocked) => !removeBlocked.has(blockedIdentity(blocked))),
    preferences: plan.preferences,
  });
}

function parsePlanDocument(value: unknown, path: string): TisPlanDocument {
  const record = asRecord(value);
  if (record.schemaVersion !== PLAN_SCHEMA_VERSION || record.kind !== PLAN_KIND) {
    throw new CliError(
      `Unsupported TIS plan schema in ${path}.`,
      "TIS_PLAN_SCHEMA_UNSUPPORTED",
      2,
      {
        path,
        schemaVersion: record.schemaVersion,
        kind: record.kind,
      },
    );
  }
  const requestedCodes = Array.isArray(record.requestedCodes)
    ? record.requestedCodes.map((code) => {
      if (typeof code !== "string") {
        throw new CliError(`TIS plan contains a non-string course code: ${path}`, "TIS_PLAN_INVALID", 2, { path });
      }
      return code;
    })
    : [];
  const blocked = Array.isArray(record.blocked)
    ? record.blocked.map((entry) => parseBlockedRecord(entry, path))
    : [];
  const semester = typeof record.semester === "string" && record.semester.trim() ? record.semester.trim() : undefined;
  return createPlanDocument({
    savedAt: stringField(record.savedAt) || new Date().toISOString(),
    ...(semester ? { semester: parseStoredSemester(semester) } : {}),
    requestedCodes,
    blocked,
    preferences: asPreferences(record.preferences),
  });
}

function parseStoredSemester(value: string): Semester {
  const match = /^(\d{4})-(\d{4})-([123])$/.exec(value);
  if (!match) {
    throw new CliError(
      `Stored semester is invalid: ${value}`,
      "TIS_PLAN_INVALID",
      2,
      { semester: value },
    );
  }
  return { xn: `${match[1]}-${match[2]}`, xq: match[3] as Semester["xq"], value };
}

function parseBlockedRecord(value: unknown, path: string): BlockedTime {
  const record = asRecord(value);
  const day = Number(record.day);
  const periodStart = Number(record.periodStart);
  const periodEnd = Number(record.periodEnd);
  if (!Number.isSafeInteger(day) || !Number.isSafeInteger(periodStart) || !Number.isSafeInteger(periodEnd)) {
    throw new CliError(`TIS plan blocked period is invalid: ${path}`, "TIS_PLAN_INVALID", 2, { path, blocked: value });
  }
  return parseBlockedTime(`${day}:${periodStart}-${periodEnd}`);
}

function asPreferences(value: unknown): TimetablePreferenceInput {
  const record = asRecord(value);
  return {
    earlyPeriodThreshold: numberOrUndefined(record.earlyPeriodThreshold),
    weights: {
      earlySession: numberOrUndefined(asRecord(record.weights).earlySession),
      gapSegment: numberOrUndefined(asRecord(record.weights).gapSegment),
      gapPeriod: numberOrUndefined(asRecord(record.weights).gapPeriod),
      distinctWeekday: numberOrUndefined(asRecord(record.weights).distinctWeekday)
        ?? numberOrUndefined(asRecord(record.weights).activeDay),
      campusSwitch: numberOrUndefined(asRecord(record.weights).campusSwitch),
    },
  };
}

function normaliseCodes(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalised = value.trim().toUpperCase();
    if (!normalised || seen.has(normalised)) continue;
    seen.add(normalised);
    output.push(normalised);
  }
  return output;
}

function normaliseBlocked(values: readonly BlockedTime[]): BlockedTime[] {
  const seen = new Set<string>();
  const output: BlockedTime[] = [];
  for (const blocked of values) {
    const normalised = parseBlockedTime(`${blocked.day}:${blocked.periodStart}-${blocked.periodEnd}`);
    const key = blockedIdentity(normalised);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalised);
  }
  return output.sort((left, right) => left.day - right.day || left.periodStart - right.periodStart || left.periodEnd - right.periodEnd);
}

function blockedIdentity(value: BlockedTime): string {
  return `${value.day}:${value.periodStart}-${value.periodEnd}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberOrUndefined(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
