import { extname } from "node:path";
import { CliError } from "../core/errors.js";
import { readJsonFile } from "../core/local-store.js";
import type { GradeRecord } from "./types.js";

const REQUIREMENTS_SCHEMA_VERSION = "1";
const REQUIREMENTS_KIND = "tis-degree-requirements";

const PASSING_GRADE_TOKENS = new Set([
  "A+",
  "A",
  "A-",
  "B+",
  "B",
  "B-",
  "C+",
  "C",
  "C-",
  "D+",
  "D",
  "D-",
  "P",
  "PASS",
  "PASSED",
  "S",
  "SATISFACTORY",
  "通过",
  "合格",
  "及格",
  "优秀",
  "良好",
  "中等",
]);
const FAILING_GRADE_TOKENS = new Set([
  "F",
  "FAIL",
  "FAILED",
  "NP",
  "N",
  "UNSATISFACTORY",
  "不及格",
  "不合格",
  "未通过",
  "不通过",
]);
const NON_COMPLETED_GRADE_TOKENS = new Set([
  "W",
  "WITHDRAW",
  "WITHDRAWN",
  "I",
  "IP",
  "INC",
  "INCOMPLETE",
  "AU",
  "AUDIT",
  "DROP",
  "DROPPED",
  "PENDING",
  "缺考",
  "缓考",
  "退课",
  "撤课",
  "未完成",
]);

export type DegreeGradeCompletion = "passed" | "failed" | "non-completed" | "unknown";

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

export interface DegreeAuditExcludedGrade {
  grade: GradeRecord;
  completion: Exclude<DegreeGradeCompletion, "passed">;
  detail: string;
  requirementIds: string[];
}

export interface DegreeAuditDuplicateCourse {
  code: string;
  counted?: GradeRecord;
  excludedPassedRetakes: GradeRecord[];
  unresolvedAttempts: GradeRecord[];
  failedOrNonCompletedAttempts: GradeRecord[];
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
  unresolvedMatches: GradeRecord[];
  excludedByCompletion: DegreeAuditExcludedGrade[];
  duplicateExcludedMatches: GradeRecord[];
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
  unresolved: DegreeAuditExcludedGrade[];
  excluded: DegreeAuditExcludedGrade[];
  unmatched: GradeRecord[];
  duplicateCourses: DegreeAuditDuplicateCourse[];
  summary: {
    totalRequirements: number;
    satisfiedRequirements: number;
    remainingRequirements: number;
    ambiguousGrades: number;
    unresolvedGrades: number;
    excludedGrades: number;
    unmatchedGrades: number;
    duplicateCourseCodes: number;
    duplicatePassedRetakes: number;
    countedGrades: number;
  };
}

interface EvaluatedGrade {
  code: string;
  grade: GradeRecord;
  requirementIds: string[];
  completion: DegreeGradeCompletion;
  detail: string;
}

interface DuplicateCourseEvaluation {
  code: string;
  attemptCount: number;
  counted?: EvaluatedGrade;
  excludedPassedRetakes: EvaluatedGrade[];
  unresolvedAttempts: EvaluatedGrade[];
  failedOrNonCompletedAttempts: EvaluatedGrade[];
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
  const evaluated = grades.map((grade) => evaluateGrade(grade, requirements.requirements));
  const duplicateEvaluations = deduplicateEvaluatedGrades(evaluated);
  const countable = duplicateEvaluations
    .map((entry) => entry.counted)
    .filter((entry): entry is EvaluatedGrade => entry !== undefined);
  const unresolved = duplicateEvaluations.flatMap((entry) => entry.unresolvedAttempts.map(toExcludedGrade));
  const excluded = duplicateEvaluations.flatMap((entry) => entry.failedOrNonCompletedAttempts.map(toExcludedGrade));
  const duplicateCourses = duplicateEvaluations
    .filter((entry) => entry.attemptCount > 1)
    .map((entry) => ({
      code: entry.code,
      ...(entry.counted ? { counted: entry.counted.grade } : {}),
      excludedPassedRetakes: entry.excludedPassedRetakes.map((item) => item.grade),
      unresolvedAttempts: entry.unresolvedAttempts.map((item) => item.grade),
      failedOrNonCompletedAttempts: entry.failedOrNonCompletedAttempts.map((item) => item.grade),
    }));

  const ambiguous = countable
    .filter((entry) => entry.requirementIds.length > 1)
    .map((entry) => ({ grade: entry.grade, requirementIds: entry.requirementIds }));
  const uniqueMatches = new Map<string, GradeRecord[]>();
  for (const entry of countable) {
    if (entry.requirementIds.length !== 1) continue;
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
    const unresolvedMatches = unresolved
      .filter((entry) => entry.requirementIds.includes(requirement.id))
      .map((entry) => entry.grade);
    const excludedByCompletion = excluded.filter((entry) => entry.requirementIds.includes(requirement.id));
    const duplicateExcludedMatches = duplicateEvaluations
      .flatMap((entry) => entry.excludedPassedRetakes)
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
      unresolvedMatches,
      excludedByCompletion,
      duplicateExcludedMatches,
      selector: requirement.match,
    };
    if (entry.remainingCredits === 0 && entry.remainingCourses === 0) {
      satisfied.push(entry);
    } else {
      remaining.push(entry);
    }
  }

  const unmatched = countable
    .filter((entry) => entry.requirementIds.length === 0)
    .map((entry) => entry.grade);
  return {
    requirements,
    satisfied,
    remaining,
    ambiguous,
    unresolved,
    excluded,
    unmatched,
    duplicateCourses,
    summary: {
      totalRequirements: requirements.requirements.length,
      satisfiedRequirements: satisfied.length,
      remainingRequirements: remaining.length,
      ambiguousGrades: ambiguous.length,
      unresolvedGrades: unresolved.length,
      excludedGrades: excluded.length,
      unmatchedGrades: unmatched.length,
      duplicateCourseCodes: duplicateCourses.length,
      duplicatePassedRetakes: duplicateCourses.reduce((total, entry) => total + entry.excludedPassedRetakes.length, 0),
      countedGrades: countable.length,
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
  const minCredits = positiveNumberField(record.minCredits, `${path} requirement ${index + 1} minCredits`);
  const minCourses = positiveIntegerField(record.minCourses, `${path} requirement ${index + 1} minCourses`);
  if (minCredits === undefined && minCourses === undefined) {
    throw new CliError(
      `Degree requirement ${index + 1} in ${path} must declare a positive minCredits or minCourses target.`,
      "DEGREE_REQUIREMENTS_INVALID",
      2,
      { path, index: index + 1 },
    );
  }
  const match = parseRequirementMatch(record.match, path, index);
  return {
    id: id || `requirement-${index + 1}`,
    title: title || `Requirement ${index + 1}`,
    ...(minCredits !== undefined ? { minCredits } : {}),
    ...(minCourses !== undefined ? { minCourses } : {}),
    match,
  };
}

function parseRequirementMatch(value: unknown, path: string, index: number): DegreeRequirementMatch {
  const record = asRecord(value);
  const codes = strictStringArrayField(record.codes, `${path} requirement ${index + 1} match.codes`);
  const prefixes = strictStringArrayField(record.prefixes, `${path} requirement ${index + 1} match.prefixes`);
  const departments = strictStringArrayField(record.departments, `${path} requirement ${index + 1} match.departments`);
  const natures = strictStringArrayField(record.natures, `${path} requirement ${index + 1} match.natures`);
  const nameIncludes = strictStringArrayField(record.nameIncludes, `${path} requirement ${index + 1} match.nameIncludes`);
  const letterGrades = strictStringArrayField(record.letterGrades, `${path} requirement ${index + 1} match.letterGrades`);
  const minScore = strictNonNegativeNumberField(record.minScore, `${path} requirement ${index + 1} match.minScore`);
  const match: DegreeRequirementMatch = {
    ...(codes?.length ? { codes: upperCaseArray(codes) } : {}),
    ...(prefixes?.length ? { prefixes: upperCaseArray(prefixes) } : {}),
    ...(departments?.length ? { departments } : {}),
    ...(natures?.length ? { natures } : {}),
    ...(nameIncludes?.length ? { nameIncludes: nameIncludes.map((entry) => entry.toLowerCase()) } : {}),
    ...(letterGrades?.length ? { letterGrades: upperCaseArray(letterGrades) } : {}),
    ...(minScore !== undefined ? { minScore } : {}),
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

function evaluateGrade(grade: GradeRecord, requirements: readonly DegreeRequirement[]): EvaluatedGrade {
  const { completion, detail } = classifyGradeCompletion(grade);
  return {
    code: grade.code.trim().toUpperCase() || ambiguousIdentity(grade),
    grade,
    requirementIds: requirements
      .filter((requirement) => gradeMatchesRequirement(grade, requirement.match))
      .map((requirement) => requirement.id),
    completion,
    detail,
  };
}

function classifyGradeCompletion(grade: GradeRecord): { completion: DegreeGradeCompletion; detail: string } {
  if (grade.numericScore !== undefined) {
    return grade.numericScore >= 60
      ? { completion: "passed", detail: `numeric score ${grade.numericScore} indicates pass` }
      : { completion: "failed", detail: `numeric score ${grade.numericScore} is below 60` };
  }
  const token = normaliseGradeToken(grade.letterGrade);
  if (!token) {
    return { completion: "unknown", detail: "no numeric score or recognizable completion grade was returned by TIS" };
  }
  if (PASSING_GRADE_TOKENS.has(token)) {
    return { completion: "passed", detail: `letter grade ${grade.letterGrade} indicates pass` };
  }
  if (FAILING_GRADE_TOKENS.has(token)) {
    return { completion: "failed", detail: `letter grade ${grade.letterGrade} indicates fail` };
  }
  if (NON_COMPLETED_GRADE_TOKENS.has(token)) {
    return { completion: "non-completed", detail: `letter grade ${grade.letterGrade} indicates the course is not completed` };
  }
  return {
    completion: "unknown",
    detail: `letter grade ${grade.letterGrade} is not recognized as pass/fail/completion status`,
  };
}

function deduplicateEvaluatedGrades(grades: readonly EvaluatedGrade[]): DuplicateCourseEvaluation[] {
  const groups = new Map<string, EvaluatedGrade[]>();
  for (const grade of grades) {
    groups.set(grade.code, [...(groups.get(grade.code) ?? []), grade]);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([code, attempts]) => {
      const passed = attempts.filter((entry) => entry.completion === "passed").sort(comparePassedAttempts);
      const counted = passed[0];
      return {
        code,
        attemptCount: attempts.length,
        ...(counted ? { counted } : {}),
        excludedPassedRetakes: passed.slice(1),
        unresolvedAttempts: attempts.filter((entry) => entry.completion === "unknown"),
        failedOrNonCompletedAttempts: attempts.filter(
          (entry) => entry.completion === "failed" || entry.completion === "non-completed",
        ),
      };
    });
}

function comparePassedAttempts(left: EvaluatedGrade, right: EvaluatedGrade): number {
  const leftScore = left.grade.numericScore ?? Number.NEGATIVE_INFINITY;
  const rightScore = right.grade.numericScore ?? Number.NEGATIVE_INFINITY;
  if (rightScore !== leftScore) return rightScore - leftScore;
  const leftPoints = left.grade.gpaPoints ?? Number.NEGATIVE_INFINITY;
  const rightPoints = right.grade.gpaPoints ?? Number.NEGATIVE_INFINITY;
  if (rightPoints !== leftPoints) return rightPoints - leftPoints;
  const semesterOrder = right.grade.semester.localeCompare(left.grade.semester);
  if (semesterOrder !== 0) return semesterOrder;
  const letterOrder = right.grade.letterGrade.localeCompare(left.grade.letterGrade);
  if (letterOrder !== 0) return letterOrder;
  return ambiguousIdentity(right.grade).localeCompare(ambiguousIdentity(left.grade));
}

function toExcludedGrade(entry: EvaluatedGrade): DegreeAuditExcludedGrade {
  if (entry.completion === "passed") {
    throw new CliError("Internal error: passed grades cannot be rendered as excluded.", "DEGREE_AUDIT_INTERNAL_ERROR", 1);
  }
  return {
    grade: entry.grade,
    completion: entry.completion,
    detail: entry.detail,
    requirementIds: entry.requirementIds,
  };
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

function strictStringArrayField(value: unknown, label: string): string[] | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (!Array.isArray(value)) {
    throw new CliError(`${label} must be an array of non-empty strings.`, "DEGREE_REQUIREMENTS_INVALID", 2, {
      field: label,
      received: value,
    });
  }
  const parsed: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !entry.trim()) {
      throw new CliError(`${label} must contain only non-empty strings.`, "DEGREE_REQUIREMENTS_INVALID", 2, {
        field: label,
        received: entry,
      });
    }
    parsed.push(entry.trim());
  }
  return parsed;
}

function upperCaseArray(values: readonly string[]): string[] {
  return values.map((value) => value.trim().toUpperCase());
}

function strictNonNegativeNumberField(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new CliError(`${label} must be a non-negative number.`, "DEGREE_REQUIREMENTS_INVALID", 2, {
      field: label,
      received: value,
    });
  }
  return round(value, 2);
}

function positiveNumberField(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new CliError(`${label} must be a positive number.`, "DEGREE_REQUIREMENTS_INVALID", 2, { field: label, received: value });
  }
  return round(parsed, 2);
}

function positiveIntegerField(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new CliError(`${label} must be a positive integer.`, "DEGREE_REQUIREMENTS_INVALID", 2, { field: label, received: value });
  }
  return parsed;
}

function normaliseGradeToken(value: string): string {
  return value.trim().replaceAll(/\s+/g, " ").toUpperCase();
}

function ambiguousIdentity(grade: GradeRecord): string {
  return `${grade.semester}|${grade.code}|${grade.name}|${grade.letterGrade}|${grade.numericScore ?? ""}`;
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
