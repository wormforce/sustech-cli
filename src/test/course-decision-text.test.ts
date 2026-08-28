import assert from "node:assert/strict";
import test from "node:test";
import { formatCourseRecommendationReport } from "../tis/course-decision-text.js";
import type { CourseRecommendationReport } from "../tis/course-decision.js";

test("formats source truth, section identity, reasons, and advisory boundaries", () => {
  const report: CourseRecommendationReport = {
    items: [{
      key: "RWH-1",
      course: {
        code: "CS101",
        name: "Introduction to Computing",
        sectionName: "Section 1",
        classGroup: "01",
        rwh: "RWH-1",
        college: "CSE",
        category: "Major Core",
        nature: "Required",
        campus: "Main",
        credits: 3,
        totalHours: 48,
        capacity: 30,
        enrolled: 20,
        cultivation: "1",
        taskType: "normal",
        language: "English",
        teachers: ["Teacher A"],
        schedule: [],
      },
      verdict: "recommend",
      partial: true,
      warnings: ["Degree classification needs manual review."],
      score: { plan: 10, schedule: 5, degree: 0, capacity: 4, nces: 0, total: 19 },
      reasons: [{ kind: "plan", impact: "positive", message: "Requested by the saved plan." }],
      plan: {
        requested: true,
        blockedConflict: false,
        compatibleWithPlan: true,
        conflictingRequestedCodes: [],
        plannedSelectableCodes: ["CS101"],
        uncheckedRequestedCodes: [],
      },
      degree: { state: "unknown", matchedChoiceGaps: [], manualReview: ["Manual identity check"] },
      capacity: { status: "available", capacity: 30, enrolled: 20, remainingSeats: 10, fullnessPct: 66.67 },
      nces: { status: "not_provided", confidence: "none", notes: [] },
    }],
    partial: true,
    sourceStatuses: {
      selectable: { state: "available" },
      plan: { state: "available" },
      degree: { state: "partial" },
      nces: { state: "unavailable" },
    },
    advisory: {
      officialReference: "TIS is official.",
      derivedReference: "Degree matching is derived.",
      communityReference: "NCES is community-contributed.",
    },
    warnings: ["Degree classification needs manual review."],
  };

  const text = formatCourseRecommendationReport(report, "Course explanation");
  assert.match(text, /Course explanation · 1/);
  assert.match(text, /degree=partial · nces=unavailable/);
  assert.match(text, /CS101 Introduction to Computing · Section 1 · 01/);
  assert.match(text, /RWH: RWH-1/);
  assert.match(text, /manual review required/);
  assert.match(text, /Official: TIS is official\./);
  assert.match(text, /Community: NCES is community-contributed\./);
});
