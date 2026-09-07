import assert from "node:assert/strict";
import test from "node:test";
import { formatGrades } from "../core/text.js";

function gradeRow(name: string): string {
  const output = formatGrades([{
    code: "TEST101",
    name,
    nameEn: "",
    semester: "2026秋季",
    credits: 3,
    letterGrade: "B",
    numericScore: 80,
    nature: "",
    department: "",
  }], { gpa: 0, credits: 0, courseCount: 0 });
  return output.split("\n").find((line) => line.includes("TEST101"))!;
}

// Expected padding uses known terminal-cell widths, independent of the renderer.
function expectedRow(name: string, nameWidth: number): string {
  return `2026秋季${" ".repeat(8)}TEST101${" ".repeat(7)}${name}${" ".repeat(32 - nameWidth)}B${" ".repeat(8)}80${" ".repeat(7)}3${" ".repeat(7)}`;
}

test("grade columns align for ASCII and Unicode Roman numerals", () => {
  assert.equal(gradeRow("体育V"), expectedRow("体育V", 5));
  assert.equal(gradeRow("体育Ⅴ"), expectedRow("体育Ⅴ", 5));
  assert.equal(gradeRow("体育Ⅳ"), expectedRow("体育Ⅳ", 5));
});

test("truncated grade names reserve one cell for the ellipsis", () => {
  assert.equal(gradeRow("中".repeat(16)), expectedRow(`${"中".repeat(14)}…`, 29));
  assert.equal(gradeRow("A".repeat(31)), expectedRow(`${"A".repeat(29)}…`, 30));
  assert.equal(gradeRow("中".repeat(15)), expectedRow("中".repeat(15), 30));
});

test("grade names preserve combining and emoji graphemes when truncating", () => {
  assert.equal(gradeRow("Cafe\u0301"), expectedRow("Cafe\u0301", 4));
  assert.equal(gradeRow("ＡＢ"), expectedRow("ＡＢ", 4));
  assert.equal(gradeRow(`${"A".repeat(28)}👩‍💻BC`), expectedRow(`${"A".repeat(28)}…`, 29));
  assert.equal(gradeRow(`${"A".repeat(27)}👩‍💻BC`), expectedRow(`${"A".repeat(27)}👩‍💻…`, 30));
});
