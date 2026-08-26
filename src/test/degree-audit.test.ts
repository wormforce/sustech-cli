import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CliError } from "../core/errors.js";
import { auditDegreeRequirements, loadDegreeRequirements } from "../tis/degree-audit.js";
import type { GradeRecord } from "../tis/types.js";
import type { DegreeRequirementsDocument } from "../tis/degree-audit.js";

const FIXTURE_PATH = fileURLToPath(new URL("../../src/test/fixtures/degree-requirements.json", import.meta.url));

test("degree audit keeps ambiguous matches and duplicate retakes out of satisfied requirements", async () => {
  const requirements = await loadDegreeRequirements(FIXTURE_PATH);
  const grades: GradeRecord[] = [
    grade({
      code: "CS101",
      name: "程序设计基础",
      nameEn: "Intro to Programming",
      semester: "2025秋季",
      credits: 3,
      letterGrade: "A",
      numericScore: 93,
      nature: "必修",
      department: "计算机科学与工程系",
      gpaPoints: 4,
    }),
    grade({
      code: "CS101",
      name: "程序设计基础",
      nameEn: "Intro to Programming",
      semester: "2026春季",
      credits: 3,
      letterGrade: "B+",
      numericScore: 88,
      nature: "必修",
      department: "计算机科学与工程系",
      gpaPoints: 3.5,
    }),
    grade({
      code: "MA101",
      name: "高等数学",
      nameEn: "Calculus",
      semester: "2025秋季",
      credits: 4,
      letterGrade: "B+",
      numericScore: 88,
      nature: "必修",
      department: "数学系",
      gpaPoints: 3.5,
    }),
    grade({
      code: "CS102",
      name: "数据结构",
      nameEn: "Data Structures",
      semester: "2025秋季",
      credits: 3,
      letterGrade: "F",
      numericScore: 58,
      nature: "必修",
      department: "计算机科学与工程系",
      gpaPoints: 0,
    }),
    grade({
      code: "CS103",
      name: "离散数学",
      nameEn: "Discrete Math",
      semester: "2025秋季",
      credits: 3,
      letterGrade: "W",
      nature: "必修",
      department: "计算机科学与工程系",
    }),
    grade({
      code: "PE101",
      name: "体育",
      nameEn: "PE",
      semester: "2025秋季",
      credits: 1,
      letterGrade: "P",
      nature: "任选",
      department: "体育中心",
    }),
  ];

  const audit = auditDegreeRequirements(grades, requirements);
  assert.deepEqual(audit.satisfied.map((entry) => entry.id), ["math"]);
  assert.deepEqual(audit.remaining.map((entry) => entry.id), ["cs-core", "cs-elective"]);
  assert.equal(audit.ambiguous.length, 1);
  assert.deepEqual(audit.ambiguous[0].requirementIds, ["cs-core", "cs-elective"]);
  assert.deepEqual(audit.unmatched.map((grade) => grade.code), ["PE101"]);
  assert.equal(audit.excluded.length, 2);
  assert.deepEqual(audit.excluded.map((entry) => entry.completion), ["failed", "non-completed"]);
  assert.equal(audit.unresolved.length, 0);
  assert.equal(audit.duplicateCourses.length, 1);
  assert.deepEqual(audit.duplicateCourses[0].excludedPassedRetakes.map((entry) => entry.semester), ["2026春季"]);
  assert.equal(audit.summary.duplicatePassedRetakes, 1);
  const csElective = audit.remaining.find((entry) => entry.id === "cs-elective");
  assert.equal(csElective?.duplicateExcludedMatches.length, 1);
  assert.equal(csElective?.excludedByCompletion.length, 2);
});

test("degree audit treats unknown completion statuses as unresolved and does not count them", () => {
  const requirements: DegreeRequirementsDocument = {
    schemaVersion: "1",
    kind: "tis-degree-requirements",
    requirements: [
      {
        id: "humanities",
        title: "Humanities",
        minCourses: 1,
        match: { prefixes: ["HUM"] },
      },
    ],
  };
  const audit = auditDegreeRequirements([
    grade({
      code: "HUM101",
      name: "哲学导论",
      semester: "2025秋季",
      credits: 2,
      letterGrade: "Pending Review",
      nature: "选修",
      department: "人文中心",
    }),
  ], requirements);

  assert.equal(audit.satisfied.length, 0);
  assert.equal(audit.remaining.length, 1);
  assert.equal(audit.unresolved.length, 1);
  assert.equal(audit.unresolved[0].completion, "unknown");
  assert.deepEqual(audit.unresolved[0].requirementIds, ["humanities"]);
  assert.equal(audit.summary.countedGrades, 0);
});

test("degree audit rejects requirements without a positive target", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "sustech-cli-degree-invalid-"));
  const jsonPath = join(tempDir, "requirements.json");
  writeFileSync(jsonPath, JSON.stringify({
    schemaVersion: "1",
    kind: "tis-degree-requirements",
    requirements: [
      {
        id: "bad",
        title: "Bad Requirement",
        match: { prefixes: ["CS"] },
      },
    ],
  }), "utf8");

  try {
    await assert.rejects(
      () => loadDegreeRequirements(jsonPath),
      (error: unknown) => error instanceof CliError && error.code === "DEGREE_REQUIREMENTS_INVALID",
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("degree audit rejects YAML requirement files in this build", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "sustech-cli-degree-"));
  const yamlPath = join(tempDir, "requirements.yaml");
  writeFileSync(yamlPath, "kind: tis-degree-requirements\n", "utf8");

  try {
    await assert.rejects(
      () => loadDegreeRequirements(yamlPath),
      (error: unknown) => error instanceof CliError && error.code === "DEGREE_REQUIREMENTS_UNSUPPORTED_FORMAT",
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function grade(value: Partial<GradeRecord> & Pick<GradeRecord, "code" | "semester" | "credits" | "letterGrade">): GradeRecord {
  return {
    code: value.code,
    name: value.name ?? value.code,
    nameEn: value.nameEn ?? "",
    semester: value.semester,
    credits: value.credits,
    letterGrade: value.letterGrade,
    ...(value.numericScore !== undefined ? { numericScore: value.numericScore } : {}),
    nature: value.nature ?? "",
    department: value.department ?? "",
    ...(value.gpaPoints !== undefined ? { gpaPoints: value.gpaPoints } : {}),
  };
}
