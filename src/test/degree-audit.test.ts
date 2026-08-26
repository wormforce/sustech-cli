import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CliError } from "../core/errors.js";
import { auditDegreeRequirements, loadDegreeRequirements } from "../tis/degree-audit.js";
import type { GradeRecord } from "../tis/types.js";

const FIXTURE_PATH = fileURLToPath(new URL("../../src/test/fixtures/degree-requirements.json", import.meta.url));

test("degree audit keeps ambiguous matches out of satisfied requirements", async () => {
  const requirements = await loadDegreeRequirements(FIXTURE_PATH);
  const grades: GradeRecord[] = [
    {
      code: "CS101",
      name: "程序设计基础",
      nameEn: "Intro to Programming",
      semester: "2025秋季",
      credits: 3,
      letterGrade: "A",
      nature: "必修",
      department: "计算机科学与工程系",
      numericScore: 93,
      gpaPoints: 4,
    },
    {
      code: "MA101",
      name: "高等数学",
      nameEn: "Calculus",
      semester: "2025秋季",
      credits: 4,
      letterGrade: "B+",
      nature: "必修",
      department: "数学系",
      numericScore: 88,
      gpaPoints: 3.5,
    },
    {
      code: "PE101",
      name: "体育",
      nameEn: "PE",
      semester: "2025秋季",
      credits: 1,
      letterGrade: "P",
      nature: "任选",
      department: "体育中心",
    },
  ];

  const audit = auditDegreeRequirements(grades, requirements);
  assert.deepEqual(audit.satisfied.map((entry) => entry.id), ["math"]);
  assert.deepEqual(audit.remaining.map((entry) => entry.id), ["cs-core", "cs-elective"]);
  assert.equal(audit.ambiguous.length, 1);
  assert.deepEqual(audit.ambiguous[0].requirementIds, ["cs-core", "cs-elective"]);
  assert.deepEqual(audit.unmatched.map((grade) => grade.code), ["PE101"]);
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
