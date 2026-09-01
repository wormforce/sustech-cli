import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPlanningProjection,
  projectDegreeMissingForPlanning,
  projectDegreeProgressForPlanning,
  projectEnrollmentForPlanning,
  projectSelectionRoundForPlanning,
} from "../tis/planning-projection.js";
import type { TisDegreeMissing } from "../tis/degree-missing.js";
import type { TisDegreeProgress } from "../tis/degree-progress.js";

test("planning degree projections are grade-free unless details were explicit", () => {
  const progress = {
    schemaVersion:"1", kind:"tis-degree-progress", reportedAt:"2026-09-02T00:00:00.000Z",
    context:{ major:"Synthetic" }, summary:{ remainingCredits:3 }, creditCategories:[], moduleRequirements:[], moduleGaps:[],
    dataAvailable:true, detailsRequested:true, detailsIncluded:true,
    courses:[{ code:"CS101", name:"Synthetic", credits:3, letterGrade:"A", numericScore:95 }], courseCount:1,
    sourceStatuses:{
      graduationRequirements:{ state:"available", count:1 }, requirementSummary:{ state:"available", count:1 },
      creditCategories:{ state:"empty", count:0 }, moduleRequirements:{ state:"empty", count:0 }, courses:{ state:"available", count:1 },
    }, warnings:[],
  } satisfies TisDegreeProgress;
  const safe = projectDegreeProgressForPlanning(progress);
  assert.equal("letterGrade" in safe.courses![0]!, false);
  assert.equal("numericScore" in safe.courses![0]!, false);
  const explicit = projectDegreeProgressForPlanning(progress, { includeGrades:true });
  assert.equal(explicit.courses![0]!.numericScore, 95);
});

test("degree-missing and enrollment projections expose planning fields without raw grades or descriptions", () => {
  const report = {
    schemaVersion:"1", kind:"tis-degree-missing", generatedAt:"2026-09-02T00:00:00.000Z", reportedAt:"2026-09-02T00:00:00.000Z",
    context:{}, officialSummary:{}, summary:{},
    advisory:{ primaryReference:"applicable-official-cultivation-plan", message:"Synthetic", contact:"Synthetic" },
    definiteMissingRequiredCourses:[{
      code:"CS101", name:"Synthetic", groups:[], categories:[], reason:"not complete",
      latestAttempt:{ semester:"2025-2026-1", letterGrade:"F", numericScore:40, completion:"failed" },
    }],
    inProgressRequiredCourses:[], choiceGaps:[], manualReview:[],
    counts:{ definiteMissingRequiredCourses:1, inProgressRequiredCourses:0, choiceGaps:0, manualReview:0 },
    sourceStatuses:{
      progressDetails:{ state:"available", count:1 },
      progress:{ graduationRequirements:{state:"available"}, requirementSummary:{state:"available"}, creditCategories:{state:"empty"}, moduleRequirements:{state:"empty"}, courses:{state:"available"} },
      grades:{ state:"available", count:1 }, enrolled:{ state:"available", count:1 },
    }, warnings:[],
  } as TisDegreeMissing;
  const projected = projectDegreeMissingForPlanning(report);
  assert.deepEqual(projected.definiteMissingRequiredCourses[0]?.latestAttempt, {
    semester:"2025-2026-1", completion:"failed",
  });

  const enrollment = projectEnrollmentForPlanning([{
    rwh:"task-1", key:"xq1_jc1", courseCode:"CS101", courseName:"Synthetic", teacher:"Example Teacher", room:"Room 1",
    description:"unrelated broad text", descriptionEn:"unrelated broad text", day:1, periodStart:1, periodEnd:2, weeks:[1, 2],
  }]);
  assert.deepEqual(Object.keys(enrollment[0]!).sort(), ["courseCode", "courseName", "meetings", "rwh", "teachingTeam"]);
  assert.equal(JSON.stringify(enrollment).includes("unrelated broad text"), false);
});

test("planning projection guard rejects secret and unrelated identity fields", () => {
  assert.throws(() => assertPlanningProjection({ courseCode:"CS101", token:"secret" }), /forbidden field/);
  assert.throws(() => assertPlanningProjection({ studentId:"123" }), /forbidden field/);
});

test("selection-round projection keeps only planning metadata", () => {
  assert.deepEqual(projectSelectionRoundForPlanning({
    xkfsdm:"bxxk", lcmc:"Synthetic round", jffs:"20", studentId:"not-for-output", unrelated:"drop",
  }), { code:"bxxk", name:"Synthetic round", bidLimit:20 });
});
