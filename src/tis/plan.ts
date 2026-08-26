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
  preferences?: TimetablePreferenceInput;
}): TisPlanDocument {
  return createPlanDocument({
    semester: update.semester ?? (plan.semester ? parseStoredSemester(plan.semester) : undefined),
    requestedCodes: [...plan.requestedCodes, ...(update.requestedCodes ?? [])],
    blocked: [...plan.blocked, ...(update.blocked ?? [])],
    preferences: mergePreferences(plan.preferences, update.preferences),
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
    preferences: parsePlanPreferences(record.preferences, path),
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

function parsePlanPreferences(value: unknown, path: string): TimetablePreferenceInput | undefined {
  if (value === undefined || value === null) return undefined;
  const record = strictRecord(value, `${path} preferences`);
  assertAllowedKeys(record, ["earlyPeriodThreshold", "weights"], `${path} preferences`);
  const weightsRecord = record.weights === undefined ? undefined : strictRecord(record.weights, `${path} preferences.weights`);
  if (weightsRecord) {
    assertAllowedKeys(
      weightsRecord,
      ["earlySession", "gapSegment", "gapPeriod", "distinctWeekday", "activeDay", "campusSwitch"],
      `${path} preferences.weights`,
    );
  }
  const distinctWeekday = strictIntegerOrUndefined(
    weightsRecord?.distinctWeekday,
    `${path} preferences.weights.distinctWeekday`,
    0,
    100,
  );
  const activeDay = strictIntegerOrUndefined(
    weightsRecord?.activeDay,
    `${path} preferences.weights.activeDay`,
    0,
    100,
  );
  if (distinctWeekday !== undefined && activeDay !== undefined && distinctWeekday !== activeDay) {
    throw new CliError(
      `TIS plan preferences contain conflicting weekday weights: ${path}`,
      "TIS_PLAN_INVALID",
      2,
      { path, distinctWeekday, activeDay },
    );
  }
  return {
    earlyPeriodThreshold: strictIntegerOrUndefined(record.earlyPeriodThreshold, `${path} preferences.earlyPeriodThreshold`, 1, 13),
    weights: {
      earlySession: strictIntegerOrUndefined(weightsRecord?.earlySession, `${path} preferences.weights.earlySession`, 0, 100),
      gapSegment: strictIntegerOrUndefined(weightsRecord?.gapSegment, `${path} preferences.weights.gapSegment`, 0, 100),
      gapPeriod: strictIntegerOrUndefined(weightsRecord?.gapPeriod, `${path} preferences.weights.gapPeriod`, 0, 100),
      distinctWeekday: distinctWeekday ?? activeDay,
      campusSwitch: strictIntegerOrUndefined(weightsRecord?.campusSwitch, `${path} preferences.weights.campusSwitch`, 0, 100),
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

function mergePreferences(
  current: TimetablePreferences,
  update: TimetablePreferenceInput | undefined,
): TimetablePreferenceInput {
  if (!update) return current;
  return {
    earlyPeriodThreshold: update.earlyPeriodThreshold ?? current.earlyPeriodThreshold,
    weights: {
      earlySession: update.weights?.earlySession ?? current.weights.earlySession,
      gapSegment: update.weights?.gapSegment ?? current.weights.gapSegment,
      gapPeriod: update.weights?.gapPeriod ?? current.weights.gapPeriod,
      distinctWeekday: update.weights?.distinctWeekday ?? current.weights.distinctWeekday,
      campusSwitch: update.weights?.campusSwitch ?? current.weights.campusSwitch,
    },
  };
}

function blockedIdentity(value: BlockedTime): string {
  return `${value.day}:${value.periodStart}-${value.periodEnd}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function strictRecord(value: unknown, label: string): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  throw new CliError(`${label} must be an object.`, "TIS_PLAN_INVALID", 2, { field: label, received: value });
}

function assertAllowedKeys(record: Record<string, unknown>, allowedKeys: readonly string[], label: string): void {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(record)) {
    if (allowed.has(key)) continue;
    throw new CliError(`${label} contains an unknown field: ${key}`, "TIS_PLAN_INVALID", 2, {
      field: label,
      key,
    });
  }
}

function strictIntegerOrUndefined(value: unknown, label: string, minimum: number, maximum: number): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new CliError(`${label} must be an integer between ${minimum} and ${maximum}.`, "TIS_PLAN_INVALID", 2, {
      field: label,
      received: value,
      minimum,
      maximum,
    });
  }
  return value;
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
