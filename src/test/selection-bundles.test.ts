import assert from "node:assert/strict";
import test from "node:test";
import { normaliseCourse } from "../tis/normalise.js";
import { bundleSelectionCourses, retainCourseSourceRecord } from "../tis/selection-bundles.js";

test("lecture/lab rows become one selectable bundle with credits counted once", () => {
  const lecture = normaliseCourse({
    bundleId: "CS101-A",
    componentType: "lecture",
    componentRequired: true,
    id: "selection-lecture",
    rwh: "task-lecture",
    kcdm: "CS101",
    kcmc: "Synthetic Systems",
    kxh: "A",
    rwmc: "Lecture A",
    xf: 3,
    dgjsmc: "Example Lecturer",
    kcxx: '<span class="ivu-tag-text"><p>1-16周,星期一第1-2节 Room 101</p></span>',
  });
  const lab = normaliseCourse({
    bundleId: "CS101-A",
    componentType: "lab",
    componentRequired: true,
    id: "selection-lab",
    rwh: "task-lab",
    kcdm: "CS101",
    kcmc: "Synthetic Systems",
    kxh: "A",
    rwmc: "Lab A",
    xf: 3,
    dgjsmc: "Example Lab Teacher",
    kcxx: '<span class="ivu-tag-text"><p>1-16双周,星期三第5-6节 Lab 201</p></span>',
  });

  const bundles = bundleSelectionCourses([lab, lecture, structuredClone(lab)]);
  assert.equal(bundles.length, 1);
  const bundle = bundles[0]!;
  assert.equal(bundle.credits, 3);
  assert.equal(bundle.components.length, 2);
  assert.equal(bundle.components.filter((component) => component.creditBearing).length, 1);
  assert.deepEqual(bundle.requiredComponentIds, ["task-lecture", "task-lab"]);
  assert.deepEqual(bundle.teachingTeam, ["Example Lab Teacher", "Example Lecturer"]);
  assert.deepEqual(bundle.meetings.find((meeting) => meeting.componentType === "lab")?.weeks, [2, 4, 6, 8, 10, 12, 14, 16]);
  assert.deepEqual(bundle.operationTargets.map((target) => ({
    componentId: target.componentId,
    courseId: target.mutationCourseId,
    rwh: target.taskId,
    payload: target.mutationPayloadField,
  })), [
    { componentId: "task-lecture", courseId: "selection-lecture", rwh: "task-lecture", payload: "p_id" },
    { componentId: "task-lab", courseId: "selection-lab", rwh: "task-lab", payload: "p_id" },
  ]);
  assert.equal(bundle.selectableWithoutGuessing, true);
  assert.ok(bundle.warnings.some((warning) => /Duplicate source row/.test(warning)));
});

test("conflicting component credits fail closed instead of being summed or guessed", () => {
  const first = normaliseCourse({ bundleId:"X", id:"id-a", rwh:"task-a", kcdm:"X", kcmc:"X", xf:2 });
  const second = normaliseCourse({ bundleId:"X", id:"id-b", rwh:"task-b", kcdm:"X", kcmc:"X", xf:3 });
  const bundle = bundleSelectionCourses([first, second])[0]!;
  assert.equal(bundle.credits, undefined);
  assert.equal(bundle.creditStatus, "ambiguous");
  assert.equal(bundle.components.some((component) => component.creditBearing), false);
});

test("raw selection records require the diagnostics-only envelope", () => {
  const source = { id:"selection-id", rwh:"task-id", unknownPersonalField:"not-for-default-json" };
  const diagnostic = retainCourseSourceRecord(source);
  source.unknownPersonalField = "changed";
  assert.equal(diagnostic.kind, "tis-selection-source-record");
  assert.equal(diagnostic.raw.unknownPersonalField, "not-for-default-json");
});
