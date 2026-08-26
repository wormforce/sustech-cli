import { extname } from "node:path";
import { CliError } from "../core/errors.js";
import { readJsonFile } from "../core/local-store.js";
import type { GradeRecord } from "./types.js";

const REQUIREMENTS_SCHEMA_VERSION = "1";
const REQUIREMENTS_KIND = "tis-degree-requirements";

export interface DegreeRequirementMatch {
  codes?: string[];
  prefixes?: string[];
  departments?: string[];
  natures?: string[];
  nameIncludes?: string[];
  letterGrades?: string[];
  minScore?: number;
}

export interface DegreeRequirement {
  id: string;
  title: string;
  minCredits?: number;
  minCourses?: number;
  match: DegreeRequirementMatch;
}

export interface DegreeRequirementsDocument {
  schemaVersion: "1";
  kind: "tis-degree-requirements";
  title?: string;
  requirements: DegreeRequirement[];
}

export interface DegreeAuditEntry {
  id: string;
  title: string;
  requiredCredits: number;
  requiredCourses: number;
  matchedCredits: number;
  matchedCourses: number;
  remainingCredits: number;
  remainingCourses: number;
  matched: GradeRecord[];
  ambiguousMatches: GradeRecord[];
  selector: DegreeRequirementMatch;
}

export interface DegreeAuditAmbiguousGrade {
  grade: GradeRecord;
  requirementIds: string[];
}

export interface DegreeAuditResult {
  requirements: DegreeRequirementsDocument;
  satisfied: DegreeAuditEntry[];
  remaining: DegreeAuditEntry[];
  ambiguous: DegreeAuditAmbiguousGrade[];
  unmatched: GradeRecord[];
  summary: {
    totalRequirements: number;
    satisfiedRequirements: number;
    remainingRequirements: number;
    ambiguousGrades: number;
    unmatchedGrades: number;
  };
}

export async function loadDegreeRequirements(path: string): Promise<DegreeRequirementsDocument> {
  const extension = extname(path).toLowerCase();
  if ((extension === ".yaml" || extension === ".yml")) {
    throw new CliError(
      "YAML requirements are not supported in this build. Please provide JSON.",
      "DEGREE_REQUIREMENTS_UNSUPPORTED_FORMAT",
      2,
      { path },
    );
  }
  const parsed = await readJsonFile(path, "DEGREE_REQUIREMENTS_NOT_FOUND", "DEGREE_REQUIREMENTS_INVALID");
  return parseRequirements(parsed, path);
}

export function auditDegreeRequirements(
  grades: readonly GradeRecord[],
  requirements: DegreeRequirementsDocument,
): DegreeAuditResult {
  const matches = grades.map((grade) => ({
    grade,
    requirementIds: requirements.requirements
      .filter((requirement) => gradeMatchesRequirement(grade, requirement.match))
      .map((requirement) => requirement.id),
  }));

  const ambiguous = matches
    .filter((entry) => entry.requirementIds.length > 1)
    .map((entry) => ({ grade: entry.grade, requirementIds: entry.requirementIds }));
  const ambiguousCodes = new Set(ambiguous.map((entry) => ambiguousIdentity(entry.grade)));
  const uniqueMatches = new Map<string, GradeRecord[]>();
  for (const entry of matches) {
    if (entry.requirementIds.length !== 1 || ambiguousCodes.has(ambiguousIdentity(entry.grade))) continue;
    const requirementId = entry.requirementIds[0];
    uniqueMatches.set(requirementId, [...(uniqueMatches.get(requirementId) ?? []), entry.grade]);
  }

  const satisfied: DegreeAuditEntry[] = [];
  const remaining: DegreeAuditEntry[] = [];
  for (const requirement of requirements.requirements) {
    const matched = uniqueMatches.get(requirement.id) ?? [];
    const ambiguousMatches = ambiguous
      .filter((entry) => entry.requirementIds.includes(requirement.id))
      .map((entry) => entry.grade);
    const matchedCredits = round(matched.reduce((total, grade) => total + grade.credits, 0), 2);
    const matchedCourses = matched.length;
    const requiredCredits = requirement.minCredits ?? 0;
    const requiredCourses = requirement.minCourses ?? 0;
    const entry: DegreeAuditEntry = {
      id: requirement.id,
      title: requirement.title,
      requiredCredits,
      requiredCourses,
      matchedCredits,
      matchedCourses,
      remainingCredits: Math.max(0, round(requiredCredits - matchedCredits, 2)),
      remainingCourses: Math.max(0, requiredCourses - matchedCourses),
      matched,
      ambiguousMatches,
      selector: requirement.match,
    };
    if (entry.remainingCredits === 0 && entry.remainingCourses === 0) {
      satisfied.push(entry);
    } else {
      remaining.push(entry);
    }
  }

  const unmatched = matches
    .filter((entry) => entry.requirementIds.length === 0)
    .map((entry) => entry.grade);
  return {
    requirements,
    satisfied,
    remaining,
    ambiguous,
    unmatched,
    summary: {
      totalRequirements: requirements.requirements.length,
      satisfiedRequirements: satisfied.length,
      remainingRequirements: remaining.length,
      ambiguousGrades: ambiguous.length,
      unmatchedGrades: unmatched.length,
    },
  };
}

function parseRequirements(value: unknown, path: string): DegreeRequirementsDocument {
  const record = asRecord(value);
  if (record.schemaVersion !== REQUIREMENTS_SCHEMA_VERSION || record.kind !== REQUIREMENTS_KIND) {
    throw new CliError(
      `Unsupported degree-requirements schema in ${path}.`,
      "DEGREE_REQUIREMENTS_SCHEMA_UNSUPPORTED",
      2,
      {
        path,
        schemaVersion: record.schemaVersion,
        kind: record.kind,
      },
    );
  }
  const requirements = Array.isArray(record.requirements)
    ? record.requirements.map((entry, index) => parseRequirement(entry, path, index))
    : [];
  if (requirements.length === 0) {
    throw new CliError("Degree requirements file must contain at least one requirement.", "DEGREE_REQUIREMENTS_INVALID", 2, { path });
  }
  const ids = new Set<string>();
  for (const requirement of requirements) {
    if (ids.has(requirement.id)) {
      throw new CliError(`Duplicate degree-requirement id: ${requirement.id}`, "DEGREE_REQUIREMENTS_INVALID", 2, {
        path,
        id: requirement.id,
      });
    }
    ids.add(requirement.id);
  }
  return {
    schemaVersion: REQUIREMENTS_SCHEMA_VERSION,
    kind: REQUIREMENTS_KIND,
    ...(typeof record.title === "string" && record.title.trim() ? { title: record.title.trim() } : {}),
    requirements,
  };
}

function parseRequirement(value: unknown, path: string, index: number): DegreeRequirement {
  const record = asRecord(value);
  const id = stringField(record.id);
  const title = stringField(record.title);
  const match = parseRequirementMatch(record.match, path, index);
  return {
    id: id || `requirement-${index + 1}`,
    title: title || `Requirement ${index + 1}`,
    ...(numberField(record.minCredits) !== undefined ? { minCredits: numberField(record.minCredits) } : {}),
    ...(numberField(record.minCourses) !== undefined ? { minCourses: numberField(record.minCourses) } : {}),
    match,
  };
}

function parseRequirementMatch(value: unknown, path: string, index: number): DegreeRequirementMatch {
  const record = asRecord(value);
  const match: DegreeRequirementMatch = {
    ...(stringArray(record.codes)?.length ? { codes: upperCaseArray(stringArray(record.codes) ?? []) } : {}),
    ...(stringArray(record.prefixes)?.length ? { prefixes: upperCaseArray(stringArray(record.prefixes) ?? []) } : {}),
    ...(stringArray(record.departments)?.length ? { departments: stringArray(record.departments) } : {}),
    ...(stringArray(record.natures)?.length ? { natures: stringArray(record.natures) } : {}),
    ...(stringArray(record.nameIncludes)?.length ? { nameIncludes: stringArray(record.nameIncludes)?.map((entry) => entry.toLowerCase()) } : {}),
    ...(stringArray(record.letterGrades)?.length ? { letterGrades: upperCaseArray(stringArray(record.letterGrades) ?? []) } : {}),
    ...(numberField(record.minScore) !== undefined ? { minScore: numberField(record.minScore) } : {}),
  };
  if (Object.keys(match).length === 0) {
    throw new CliError(
      `Degree requirement ${index + 1} in ${path} has an empty match selector.`,
      "DEGREE_REQUIREMENTS_INVALID",
      2,
      { path, index: index + 1 },
    );
  }
  return match;
}

function gradeMatchesRequirement(grade: GradeRecord, match: DegreeRequirementMatch): boolean {
  if (match.codes && !match.codes.includes(grade.code.trim().toUpperCase())) return false;
  if (match.prefixes && !match.prefixes.some((prefix) => grade.code.trim().toUpperCase().startsWith(prefix))) return false;
  if (match.departments && !match.departments.includes(grade.department)) return false;
  if (match.natures && !match.natures.includes(grade.nature)) return false;
  if (match.letterGrades && !match.letterGrades.includes(grade.letterGrade.trim().toUpperCase())) return false;
  if (match.minScore !== undefined && (grade.numericScore ?? Number.NEGATIVE_INFINITY) < match.minScore) return false;
  if (match.nameIncludes) {
    const haystack = `${grade.name} ${grade.nameEn}`.toLowerCase();
    if (!match.nameIncludes.some((token) => haystack.includes(token))) return false;
  }
  return true;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean)
    : undefined;
}

function upperCaseArray(values: readonly string[]): string[] {
  return values.map((value) => value.trim().toUpperCase());
}

function numberField(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return round(parsed, 2);
}

function ambiguousIdentity(grade: GradeRecord): string {
  return `${grade.semester}|${grade.code}|${grade.name}|${grade.letterGrade}|${grade.numericScore ?? ""}`;
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
