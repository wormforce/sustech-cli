import { classifyGradeCompletion, type DegreeGradeCompletion } from "./degree-audit.js";
import type {
  TisDegreeMissing,
  DegreeMissingChoiceGap,
  DegreeMissingManualReview,
  DegreeMissingRequiredCourse,
} from "./degree-missing.js";
import type { DegreeProgressCourse, TisDegreeProgress } from "./degree-progress.js";
import { coursesConflict, solveTimetables, type TimetableScoreBreakdown } from "./planner.js";
import type { TisPlanDocument } from "./plan.js";
import type { Course } from "./types.js";
import type { NcesCourseDetail, NcesCourseLookupRequest, NcesResolvedCourse } from "../services/nces.js";

export type CourseDecisionVerdict = "strong_recommend" | "recommend" | "consider" | "avoid";
export type CourseDecisionReasonKind = "plan" | "schedule" | "degree" | "capacity" | "nces" | "data";
export type CourseDecisionReasonImpact = "positive" | "negative" | "caution";
export type CourseDecisionSourceState = "available" | "empty" | "partial" | "unavailable";
export type CourseDecisionDegreeState =
  | "required-gap"
  | "choice-gap"
  | "already-completed"
  | "already-in-progress"
  | "optional"
  | "unknown"
  | "unavailable";

export interface CourseDecisionReason {
  kind: CourseDecisionReasonKind;
  impact: CourseDecisionReasonImpact;
  message: string;
}

export interface CourseDecisionSourceStatus {
  state: CourseDecisionSourceState;
  message?: string;
}

export interface CourseDecisionScoreBreakdown {
  plan: number;
  schedule: number;
  degree: number;
  capacity: number;
  nces: number;
  total: number;
}

export interface CourseDecisionPlanFit {
  requested: boolean;
  blockedConflict: boolean;
  compatibleWithPlan?: boolean;
  conflictingRequestedCodes: string[];
  plannedSelectableCodes: string[];
  uncheckedRequestedCodes: string[];
  bestSolutionScore?: TimetableScoreBreakdown;
}

export interface CourseDecisionGapMatch {
  scope: "credit-category" | "module";
  name: string;
  matchedBy: "category" | "nature" | "section";
  note?: string;
}

export interface CourseDecisionRequiredCourseMatch {
  source: "degree-missing-definite" | "degree-missing-in-progress" | "degree-progress";
  code?: string;
  name: string;
  completion?: DegreeGradeCompletion;
  reason?: string;
}

export interface CourseDecisionDegreeFit {
  state: CourseDecisionDegreeState;
  matchedRequiredCourse?: CourseDecisionRequiredCourseMatch;
  matchedChoiceGaps: CourseDecisionGapMatch[];
  manualReview: string[];
}

export interface CourseDecisionCapacityFit {
  status: "available" | "unavailable";
  capacity?: number;
  enrolled?: number;
  remainingSeats?: number;
  fullnessPct?: number;
}

export interface CourseDecisionNcesFit {
  status: "not_provided" | NcesResolvedCourse["status"];
  confidence: NcesResolvedCourse["confidence"] | "none";
  picked?: NcesResolvedCourse["picked"];
  detail?: NcesCourseDetail | null;
  signals?: NcesResolvedCourse["signals"];
  notes: string[];
}

export interface CourseDecision {
  key: string;
  course: Course;
  verdict: CourseDecisionVerdict;
  partial: boolean;
  warnings: string[];
  score: CourseDecisionScoreBreakdown;
  reasons: CourseDecisionReason[];
  plan: CourseDecisionPlanFit;
  degree: CourseDecisionDegreeFit;
  capacity: CourseDecisionCapacityFit;
  nces: CourseDecisionNcesFit;
}

export interface ExplainCourseDecisionInput {
  course: Course;
  selectableCourses: readonly Course[];
  plan?: TisPlanDocument;
  degreeProgress?: TisDegreeProgress;
  degreeMissing?: TisDegreeMissing;
  nces?: NcesResolvedCourse | null;
  maxSearchCandidates?: number;
}

export interface RecommendCourseSectionsInput {
  selectableCourses: readonly Course[];
  candidates?: readonly Course[];
  plan?: TisPlanDocument;
  degreeProgress?: TisDegreeProgress;
  degreeMissing?: TisDegreeMissing;
  ncesByKey?: Readonly<Record<string, NcesResolvedCourse | null | undefined>>;
  maxResults?: number;
  maxSearchCandidates?: number;
}

export interface CourseRecommendationReport {
  items: CourseDecision[];
  partial: boolean;
  sourceStatuses: {
    selectable: CourseDecisionSourceStatus;
    plan: CourseDecisionSourceStatus;
    degree: CourseDecisionSourceStatus;
    nces: CourseDecisionSourceStatus;
  };
  advisory: {
    officialReference: string;
    derivedReference: string;
    communityReference: string;
  };
  warnings: string[];
}

export interface SelectCourseDecisionCandidatesResult {
  matched: Course[];
  missingSelectors: string[];
}

export function courseDecisionKey(course: Pick<Course, "code" | "classGroup" | "rwh">): string {
  return course.rwh || `${course.code.toUpperCase()}::${course.classGroup || "section"}`;
}

export function selectCourseDecisionCandidates(
  selectableCourses: readonly Course[],
  selectors: readonly string[],
): SelectCourseDecisionCandidatesResult {
  if (selectors.length === 0) {
    return {
      matched: [...selectableCourses],
      missingSelectors: [],
    };
  }

  const matchedByKey = new Map<string, { course: Course; selectorIndex: number; courseIndex: number }>();
  const missingSelectors: string[] = [];

  for (const [selectorIndex, selector] of selectors.entries()) {
    const matches = selectableCourses
      .map((course, courseIndex) => ({ course, courseIndex }))
      .filter(({ course }) => matchesCourseDecisionSelector(course, selector));
    if (matches.length === 0) {
      missingSelectors.push(selector);
      continue;
    }
    for (const { course, courseIndex } of matches) {
      const key = courseDecisionKey(course);
      const existing = matchedByKey.get(key);
      if (!existing || selectorIndex < existing.selectorIndex || (
        selectorIndex === existing.selectorIndex && courseIndex < existing.courseIndex
      )) {
        matchedByKey.set(key, { course, selectorIndex, courseIndex });
      }
    }
  }

  return {
    matched: [...matchedByKey.values()]
      .sort((left, right) => left.selectorIndex - right.selectorIndex || left.courseIndex - right.courseIndex)
      .map((entry) => entry.course),
    missingSelectors,
  };
}

export function buildCourseDecisionNcesLookupRequests(
  candidates: readonly Course[],
): NcesCourseLookupRequest[] {
  const requests: NcesCourseLookupRequest[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const key = courseDecisionKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    requests.push({
      key,
      code: candidate.code,
      name: candidate.name,
      teachers: [...candidate.teachers],
    });
  }
  return requests;
}

export function explainCourseDecision(input: ExplainCourseDecisionInput): CourseDecision {
  const plan = analysePlanFit(input.course, input.selectableCourses, input.plan, input.maxSearchCandidates);
  const degree = analyseDegreeFit(input.course, input.degreeMissing, input.degreeProgress);
  const capacity = analyseCapacityFit(input.course);
  const nces = analyseNcesFit(input.nces);
  const warnings = [
    ...plan.warnings,
    ...degree.warnings,
    ...nces.warnings,
  ];
  const score: CourseDecisionScoreBreakdown = {
    plan: round(plan.planScore),
    schedule: round(plan.scheduleScore),
    degree: round(degree.score),
    capacity: round(capacity.score),
    nces: round(nces.score),
    total: 0,
  };
  score.total = round(score.plan + score.schedule + score.degree + score.capacity + score.nces);
  const partial = warnings.length > 0;
  return {
    key: courseDecisionKey(input.course),
    course: input.course,
    verdict: decideVerdict(score.total, plan.blockedConflict, plan.compatibleWithPlan),
    partial,
    warnings,
    score,
    reasons: sortReasons([
      ...plan.reasons,
      ...degree.reasons,
      ...capacity.reasons,
      ...nces.reasons,
    ]),
    plan: {
      requested: plan.requested,
      blockedConflict: plan.blockedConflict,
      ...(plan.compatibleWithPlan !== undefined ? { compatibleWithPlan: plan.compatibleWithPlan } : {}),
      conflictingRequestedCodes: plan.conflictingRequestedCodes,
      plannedSelectableCodes: plan.plannedSelectableCodes,
      uncheckedRequestedCodes: plan.uncheckedRequestedCodes,
      ...(plan.bestSolutionScore ? { bestSolutionScore: plan.bestSolutionScore } : {}),
    },
    degree: degree.fit,
    capacity: capacity.fit,
    nces: nces.fit,
  };
}

export function recommendCourseSections(input: RecommendCourseSectionsInput): CourseRecommendationReport {
  const candidates = input.candidates ?? input.selectableCourses;
  const items = candidates
    .map((course) => explainCourseDecision({
      course,
      selectableCourses: input.selectableCourses,
      ...(input.plan ? { plan: input.plan } : {}),
      ...(input.degreeProgress ? { degreeProgress: input.degreeProgress } : {}),
      ...(input.degreeMissing ? { degreeMissing: input.degreeMissing } : {}),
      ...(input.ncesByKey ? { nces: input.ncesByKey[courseDecisionKey(course)] ?? null } : {}),
      maxSearchCandidates: input.maxSearchCandidates,
    }))
    .sort(compareCourseDecisions);
  const limited = input.maxResults === undefined ? items : items.slice(0, Math.max(0, input.maxResults));
  const selectableStatus = selectableSourceStatus(input.selectableCourses);
  const planStatus = planSourceStatus(input.plan);
  const degreeStatus = degreeSourceStatus(input.degreeMissing, input.degreeProgress, limited);
  const ncesStatus = ncesSourceStatus(limited, input.ncesByKey);
  const warnings = [
    ...collectUniqueWarnings(limited.flatMap((item) => item.warnings)),
    ...(ncesStatus.message ? [ncesStatus.message] : []),
  ];
  return {
    items: limited,
    partial: warnings.length > 0
      || selectableStatus.state !== "available"
      || degreeStatus.state !== "available"
      || ncesStatus.state !== "available",
    sourceStatuses: {
      selectable: selectableStatus,
      plan: planStatus,
      degree: degreeStatus,
      nces: ncesStatus,
    },
    advisory: {
      officialReference: "TIS selectable data and degree-progress remain the official live/plan sources.",
      derivedReference: "degree-missing is a conservative derived view built from TIS progress, grade history, and current enrollment when available.",
      communityReference: "NCES ratings and reviews are community-contributed references and are never treated as official degree rules.",
    },
    warnings,
  };
}

interface PlanAnalysis {
  requested: boolean;
  blockedConflict: boolean;
  compatibleWithPlan?: boolean;
  conflictingRequestedCodes: string[];
  plannedSelectableCodes: string[];
  uncheckedRequestedCodes: string[];
  bestSolutionScore?: TimetableScoreBreakdown;
  planScore: number;
  scheduleScore: number;
  reasons: CourseDecisionReason[];
  warnings: string[];
}

function analysePlanFit(
  course: Course,
  selectableCourses: readonly Course[],
  plan: TisPlanDocument | undefined,
  maxSearchCandidates = 5000,
): PlanAnalysis {
  if (!plan) {
    return {
      requested: false,
      blockedConflict: false,
      conflictingRequestedCodes: [],
      plannedSelectableCodes: [],
      uncheckedRequestedCodes: [],
      planScore: 0,
      scheduleScore: 0,
      reasons: [],
      warnings: [],
    };
  }

  const courseCode = normaliseCode(course.code);
  const requested = plan.requestedCodes.some((code) => normaliseCode(code) === courseCode);
  const blockedConflict = course.schedule.some((slot) =>
    plan.blocked.some((blocked) =>
      slot.day === blocked.day && slot.periodEnd >= blocked.periodStart && blocked.periodEnd >= slot.periodStart
    )
  );
  const plannedSelectableCodes = uniqueCodes(
    plan.requestedCodes.filter((code) => selectableCourses.some((candidate) => normaliseCode(candidate.code) === normaliseCode(code))),
  );
  const uncheckedRequestedCodes = uniqueCodes(
    plan.requestedCodes.filter((code) =>
      !plannedSelectableCodes.some((candidate) => candidate === normaliseCode(code)) && normaliseCode(code) !== courseCode
    ),
  );
  const conflictingRequestedCodes = plannedSelectableCodes.filter((code) => {
    if (code === courseCode) return false;
    const sections = selectableCourses.filter((candidate) => normaliseCode(candidate.code) === code);
    return sections.length > 0 && sections.every((section) => coursesConflict(course, section));
  });

  const reasons: CourseDecisionReason[] = [];
  const warnings: string[] = [];
  let planScore = 0;
  let scheduleScore = 0;
  let compatibleWithPlan: boolean | undefined;
  let bestSolutionScore: TimetableScoreBreakdown | undefined;

  if (requested) {
    planScore += 18;
    reasons.push({
      kind: "plan",
      impact: "positive",
      message: "This section belongs to a course already requested in the saved TIS plan.",
    });
  }
  if (blockedConflict) {
    scheduleScore -= 35;
    reasons.push({
      kind: "schedule",
      impact: "negative",
      message: "The section overlaps a blocked time saved in the TIS plan.",
    });
  }
  if (conflictingRequestedCodes.length > 0) {
    scheduleScore -= Math.min(24, conflictingRequestedCodes.length * 8);
    reasons.push({
      kind: "schedule",
      impact: "negative",
      message: `It conflicts with every currently selectable section for ${conflictingRequestedCodes.join(", ")}.`,
    });
  }
  if (uncheckedRequestedCodes.length > 0) {
    const message = `Current selectable data does not include ${uncheckedRequestedCodes.length} planned course code(s), so compatibility was only checked against the visible subset.`;
    warnings.push(message);
    reasons.push({
      kind: "data",
      impact: "caution",
      message,
    });
  }

  if (!blockedConflict) {
    const solveCodes = uniqueCodes([...plannedSelectableCodes, course.code]);
    if (solveCodes.length > 1) {
      const restrictedCatalog = selectableCourses.filter((candidate) => {
        const candidateCode = normaliseCode(candidate.code);
        if (!solveCodes.includes(candidateCode)) return false;
        return candidateCode !== courseCode || sameSection(candidate, course);
      });
      const result = solveTimetables(restrictedCatalog, solveCodes, {
        maxResults: 1,
        blocked: plan.blocked,
        preferences: plan.preferences,
        maxSearchCandidates,
      });
      const candidateMissing = result.missingCodes.some((code) => normaliseCode(code) === courseCode);
      if (candidateMissing) {
        compatibleWithPlan = false;
      } else if (result.missingCodes.length > 0) {
        const message = `Some planned course codes had no remaining selectable sections after block filtering (${result.missingCodes.join(", ")}).`;
        warnings.push(message);
        reasons.push({
          kind: "data",
          impact: "caution",
          message,
        });
      } else {
        compatibleWithPlan = result.solutions.length > 0;
        bestSolutionScore = result.solutions[0]?.score;
      }
      if (compatibleWithPlan === true) {
        scheduleScore += 12;
        reasons.push({
          kind: "schedule",
          impact: "positive",
          message: "Anchoring this section still leaves at least one conflict-free timetable across the currently selectable planned courses.",
        });
      } else if (compatibleWithPlan === false) {
        scheduleScore -= 18;
        reasons.push({
          kind: "schedule",
          impact: "negative",
          message: "Once this section is anchored, the currently selectable planned courses no longer form a conflict-free timetable.",
        });
      }
    }
  }

  return {
    requested,
    blockedConflict,
    ...(compatibleWithPlan !== undefined ? { compatibleWithPlan } : {}),
    conflictingRequestedCodes,
    plannedSelectableCodes,
    uncheckedRequestedCodes,
    ...(bestSolutionScore ? { bestSolutionScore } : {}),
    planScore,
    scheduleScore,
    reasons,
    warnings: collectUniqueWarnings(warnings),
  };
}

interface DegreeAnalysis {
  fit: CourseDecisionDegreeFit;
  score: number;
  reasons: CourseDecisionReason[];
  warnings: string[];
}

function analyseDegreeFit(
  course: Course,
  degreeMissing: TisDegreeMissing | undefined,
  degreeProgress: TisDegreeProgress | undefined,
): DegreeAnalysis {
  const reasons: CourseDecisionReason[] = [];
  const warnings: string[] = [];
  const manualReview: string[] = [];
  const matchedChoiceGaps = new Map<string, CourseDecisionGapMatch>();
  let score = 0;
  let state: CourseDecisionDegreeState = "unknown";
  let matchedRequiredCourse: CourseDecisionRequiredCourseMatch | undefined;
  let degreeManualReviewLocked = false;

  const definiteMissing = degreeMissing?.definiteMissingRequiredCourses.find((entry) => requiredCourseMatchesByCode(course, entry));
  const inProgress = degreeMissing?.inProgressRequiredCourses.find((entry) => requiredCourseMatchesByCode(course, entry));
  const ambiguousByName = degreeMissing
    ? [...degreeMissing.definiteMissingRequiredCourses, ...degreeMissing.inProgressRequiredCourses]
      .find((entry) => !entry.code && normaliseLabel(course.name) === normaliseLabel(entry.name))
    : undefined;
  const explicitManualReview = degreeMissing
    ? collectRelevantDegreeManualReview(course, degreeMissing.manualReview)
    : [];
  if (definiteMissing) {
    state = "required-gap";
    matchedRequiredCourse = {
      source: "degree-missing-definite",
      ...(definiteMissing.code ? { code: definiteMissing.code } : {}),
      name: definiteMissing.name,
      reason: definiteMissing.reason,
    };
    score += 28;
    reasons.push({
      kind: "degree",
      impact: "positive",
      message: "The TIS-derived degree-missing report marks this as a definite missing required course.",
    });
  } else if (inProgress) {
    state = "already-in-progress";
    matchedRequiredCourse = {
      source: "degree-missing-in-progress",
      ...(inProgress.code ? { code: inProgress.code } : {}),
      name: inProgress.name,
      reason: inProgress.reason,
    };
    score -= 8;
    reasons.push({
      kind: "degree",
      impact: "caution",
      message: "The TIS-derived degree-missing report already places this requirement in current enrollment; another section only makes sense for a swap.",
    });
  } else if (ambiguousByName) {
    state = "unknown";
    const message = "degree-missing contains a same-name required course without a reliable code, so this match was left as manual review.";
    degreeManualReviewLocked = true;
    manualReview.push(message);
    warnings.push(message);
    reasons.push({
      kind: "data",
      impact: "caution",
      message,
    });
  }
  if (explicitManualReview.length > 0) {
    degreeManualReviewLocked = true;
    state = "unknown";
    for (const review of explicitManualReview) {
      const message = review.message || "TIS degree-missing marked this course for manual review.";
      manualReview.push(message);
      warnings.push(message);
      reasons.push({
        kind: "data",
        impact: "caution",
        message,
      });
    }
  }

  if (degreeMissing) {
    for (const gap of degreeMissing.choiceGaps) {
      const match = matchChoiceGap(course, gap);
      if (!match) continue;
      matchedChoiceGaps.set(`${match.scope}:${match.name}`, match);
    }
  }

  if (degreeProgress) {
    const progressMatches = (degreeProgress.courses ?? []).filter((entry) => progressCourseMatches(course, entry));
    const requiredMatches = progressMatches.filter((entry) => entry.required === true);
    const completion = summariseProgressCompletion(progressMatches);
    if (!matchedRequiredCourse && completion === "passed") {
      state = "already-completed";
      matchedRequiredCourse = {
        source: "degree-progress",
        code: progressMatches[0]?.code,
        name: progressMatches[0]?.name || course.name,
        completion,
      };
      score -= 16;
      reasons.push({
        kind: "degree",
        impact: "negative",
        message: "Degree-progress details already show a passing result for this course.",
      });
    } else if (!matchedRequiredCourse && requiredMatches.length > 0) {
      state = "required-gap";
      matchedRequiredCourse = {
        source: "degree-progress",
        code: requiredMatches[0]?.code,
        name: requiredMatches[0]?.name || course.name,
        completion,
      };
      score += completion === "failed" || completion === "non-completed" ? 22 : 18;
      reasons.push({
        kind: "degree",
        impact: "positive",
        message: completion === "failed" || completion === "non-completed"
          ? "Degree-progress details show this required course without a passing result."
          : "Degree-progress details mark this as a required course.",
      });
    } else if (!degreeManualReviewLocked && state === "unknown" && degreeProgress.dataAvailable) {
      state = "optional";
    }

    for (const category of degreeProgress.creditCategories.filter(hasRemainingGap)) {
      const match = matchChoiceGap(course, {
        scope: "credit-category",
        name: category.name,
        remainingCredits: category.remainingCredits,
        remainingCourses: category.remainingCourses,
        remainingHours: category.remainingHours,
        note: category.note,
      });
      if (!match) continue;
      matchedChoiceGaps.set(`${match.scope}:${match.name}`, match);
    }
    for (const module of degreeProgress.moduleGaps.filter(hasRemainingGap)) {
      const match = matchChoiceGap(course, {
        scope: "module",
        name: module.name,
        remainingCredits: module.remainingCredits,
        remainingCourses: module.remainingCourses,
      });
      if (!match) continue;
      matchedChoiceGaps.set(`${match.scope}:${match.name}`, match);
    }

    if (!degreeProgress.detailsIncluded) {
      const message = "Degree-progress course details were unavailable, so direct required-course matching may be incomplete.";
      warnings.push(message);
      reasons.push({
        kind: "data",
        impact: "caution",
        message,
      });
    }
  }

  const gapMatches = [...matchedChoiceGaps.values()].sort((left, right) =>
    `${left.scope}:${left.name}`.localeCompare(`${right.scope}:${right.name}`, "zh-Hans-CN")
  );
  if (gapMatches.length > 0 && !degreeManualReviewLocked) {
    if (state === "unknown" || state === "optional") {
      state = "choice-gap";
      score += 12;
    } else if (state === "required-gap") {
      score += 4;
    }
    reasons.push({
      kind: "degree",
      impact: "positive",
      message: `Course metadata lines up with remaining degree gaps: ${gapMatches.map((gap) => gap.name).join(", ")}.`,
    });
  }

  if (!degreeMissing && !degreeProgress) {
    state = "unavailable";
    const message = "No degree-progress or degree-missing data was attached to this recommendation run.";
    warnings.push(message);
    reasons.push({
      kind: "data",
      impact: "caution",
      message,
    });
  }

  return {
    fit: {
      state,
      ...(matchedRequiredCourse ? { matchedRequiredCourse } : {}),
      matchedChoiceGaps: gapMatches,
      manualReview: collectUniqueWarnings(manualReview),
    },
    score,
    reasons,
    warnings: collectUniqueWarnings(warnings),
  };
}

interface CapacityAnalysis {
  fit: CourseDecisionCapacityFit;
  score: number;
  reasons: CourseDecisionReason[];
}

function analyseCapacityFit(course: Course): CapacityAnalysis {
  if (course.capacity === undefined || course.enrolled === undefined || course.capacity <= 0) {
    return {
      fit: { status: "unavailable" },
      score: 0,
      reasons: [],
    };
  }
  const remainingSeats = course.capacity - course.enrolled;
  const fullnessPct = round((course.enrolled / course.capacity) * 100);
  const fit: CourseDecisionCapacityFit = {
    status: "available",
    capacity: course.capacity,
    enrolled: course.enrolled,
    remainingSeats,
    fullnessPct,
  };
  let score = 0;
  const reasons: CourseDecisionReason[] = [];
  if (remainingSeats <= 0) {
    score -= 18;
    reasons.push({
      kind: "capacity",
      impact: "negative",
      message: "The latest selectable snapshot shows the section full.",
    });
  } else if (remainingSeats <= 2) {
    score -= 6;
    reasons.push({
      kind: "capacity",
      impact: "caution",
      message: `Only ${remainingSeats} seat(s) remained in the latest selectable snapshot.`,
    });
  } else if (remainingSeats / course.capacity >= 0.25) {
    score += 4;
    reasons.push({
      kind: "capacity",
      impact: "positive",
      message: `The latest selectable snapshot still showed ${remainingSeats} open seat(s).`,
    });
  }
  return { fit, score, reasons };
}

interface NcesAnalysis {
  fit: CourseDecisionNcesFit;
  score: number;
  reasons: CourseDecisionReason[];
  warnings: string[];
}

function analyseNcesFit(nces: NcesResolvedCourse | null | undefined): NcesAnalysis {
  if (!nces) {
    return {
      fit: {
        status: "not_provided",
        confidence: "none",
        notes: [],
      },
      score: 0,
      reasons: [],
      warnings: [],
    };
  }

  const fit: CourseDecisionNcesFit = {
    status: nces.status,
    confidence: nces.confidence,
    ...(nces.picked ? { picked: nces.picked } : {}),
    ...(nces.detail !== undefined ? { detail: nces.detail } : {}),
    signals: nces.signals,
    notes: nces.notes,
  };
  const reasons: CourseDecisionReason[] = [];
  const warnings: string[] = [];

  if (nces.status === "error") {
    const message = nces.errorMessage || "NCES lookup failed for this course.";
    warnings.push(message);
    reasons.push({
      kind: "data",
      impact: "caution",
      message: `NCES lookup failed for this course and was isolated: ${message}`,
    });
    return { fit, score: 0, reasons, warnings };
  }
  if (nces.status === "insufficient_query" || nces.status === "not_found") {
    reasons.push({
      kind: "data",
      impact: "caution",
      message: "No reliable NCES evaluation match was available for this course.",
    });
    return { fit, score: 0, reasons, warnings };
  }
  if (!nces.picked) {
    return { fit, score: 0, reasons, warnings };
  }

  const detail = nces.detail ?? undefined;
  const target = detail ?? nces.picked;
  const reviewCount = Math.max(target.reviewCount, 0);
  const evidenceWeight = ncesEvidenceWeight(nces.confidence, reviewCount);
  const ratingScore = round((target.rating - 7) * 4 * evidenceWeight);
  const takeawaysScore = round(((target.takeaways.pct - 50) / 25) * evidenceWeight);
  const score = round(ratingScore + takeawaysScore);
  reasons.push({
    kind: "nces",
    impact: score >= 0 ? "positive" : "negative",
    message: `NCES shows ${target.rating}/10 from ${reviewCount} review(s) with ${target.takeaways.label.toLowerCase()} takeaways.`,
  });
  if (nces.status === "ambiguous" || nces.confidence === "low") {
    const message = "The NCES match is low-confidence, so its score was down-weighted.";
    warnings.push(message);
    reasons.push({
      kind: "data",
      impact: "caution",
      message,
    });
  }
  if (reviewCount < 3) {
    const message = "NCES review volume is thin for this course, so the evaluation signal is weak.";
    warnings.push(message);
    reasons.push({
      kind: "data",
      impact: "caution",
      message,
    });
  }
  return { fit, score, reasons, warnings: collectUniqueWarnings(warnings) };
}

function planSourceStatus(plan: TisPlanDocument | undefined): CourseDecisionSourceStatus {
  return plan
    ? { state: "available" }
    : { state: "unavailable", message: "No saved TIS plan was attached." };
}

function selectableSourceStatus(selectableCourses: readonly Course[]): CourseDecisionSourceStatus {
  return selectableCourses.length > 0
    ? { state: "available" }
    : { state: "empty", message: "The selectable-course snapshot contained no candidate sections." };
}

function degreeSourceStatus(
  degreeMissing: TisDegreeMissing | undefined,
  degreeProgress: TisDegreeProgress | undefined,
  items: readonly CourseDecision[],
): CourseDecisionSourceStatus {
  const manualReviewCount = items.filter((item) => item.degree.manualReview.length > 0).length;
  if (manualReviewCount > 0) {
    return {
      state: "partial",
      message: `${manualReviewCount} candidate(s) still need manual degree review before treating them as cultivation-plan relevant.`,
    };
  }
  if (degreeMissing) {
    return degreeMissing.manualReview.length > 0
      ? { state: "partial", message: `Degree-missing reported ${degreeMissing.manualReview.length} manual-review item(s).` }
      : { state: "available" };
  }
  if (!degreeProgress) return { state: "unavailable", message: "No degree-progress data was attached." };
  if (!degreeProgress.dataAvailable) return { state: "unavailable", message: "Degree-progress returned no usable plan data." };
  return degreeProgress.detailsIncluded
    ? { state: "available" }
    : { state: "partial", message: "Degree-progress category/module data is available, but course-level details are incomplete." };
}

function ncesSourceStatus(
  items: readonly CourseDecision[],
  ncesByKey: Readonly<Record<string, NcesResolvedCourse | null | undefined>> | undefined,
): CourseDecisionSourceStatus {
  if (!ncesByKey) return { state: "unavailable", message: "No NCES lookup map was attached." };
  const keys = new Set(items.map((item) => item.key));
  const missingKeys = [...keys].filter((key) => !(key in ncesByKey));
  if (missingKeys.length > 0) {
    return {
      state: "partial",
      message: `NCES lookups were missing for ${missingKeys.length} candidate(s).`,
    };
  }
  const errored = items.filter((item) => item.nces.status === "error");
  if (errored.length > 0) {
    return {
      state: "partial",
      message: `NCES lookups failed for ${errored.length} candidate(s), but the rest were kept.`,
    };
  }
  const ambiguousCount = items.filter((item) => item.nces.status === "ambiguous").length;
  if (ambiguousCount > 0) {
    return {
      state: "partial",
      message: `NCES lookups remained ambiguous for ${ambiguousCount} candidate(s).`,
    };
  }
  const noMatchCount = items.filter((item) =>
    item.nces.status === "not_found" || item.nces.status === "insufficient_query" || item.nces.status === "not_provided"
  ).length;
  if (noMatchCount === items.length && items.length > 0) {
    return {
      state: "empty",
      message: "No candidate had a reliable NCES match.",
    };
  }
  if (noMatchCount > 0) {
    return {
      state: "partial",
      message: `NCES had no reliable match for ${noMatchCount} candidate(s).`,
    };
  }
  return { state: "available" };
}

function compareCourseDecisions(left: CourseDecision, right: CourseDecision): number {
  if (left.score.total !== right.score.total) return right.score.total - left.score.total;
  if (left.plan.requested !== right.plan.requested) return Number(right.plan.requested) - Number(left.plan.requested);
  const degreePriority = degreeStatePriority(right.degree.state) - degreeStatePriority(left.degree.state);
  if (degreePriority !== 0) return degreePriority;
  const rightSeats = right.capacity.remainingSeats ?? -1;
  const leftSeats = left.capacity.remainingSeats ?? -1;
  if (leftSeats !== rightSeats) return rightSeats - leftSeats;
  const rightRating = right.nces.picked?.rating ?? -1;
  const leftRating = left.nces.picked?.rating ?? -1;
  if (leftRating !== rightRating) return rightRating - leftRating;
  return decisionIdentity(left).localeCompare(decisionIdentity(right), "zh-Hans-CN");
}

function degreeStatePriority(state: CourseDecisionDegreeState): number {
  if (state === "required-gap") return 4;
  if (state === "choice-gap") return 3;
  if (state === "optional") return 2;
  if (state === "unknown") return 1;
  return 0;
}

function decisionIdentity(value: CourseDecision): string {
  return `${value.course.code}\u0000${value.course.classGroup}\u0000${value.course.rwh}`;
}

function decideVerdict(
  total: number,
  blockedConflict: boolean,
  compatibleWithPlan: boolean | undefined,
): CourseDecisionVerdict {
  if (blockedConflict || compatibleWithPlan === false || total < 0) return "avoid";
  if (total >= 34) return "strong_recommend";
  if (total >= 18) return "recommend";
  return "consider";
}

function sortReasons(reasons: readonly CourseDecisionReason[]): CourseDecisionReason[] {
  const priority = (reason: CourseDecisionReason): number => {
    if (reason.impact === "negative") return 0;
    if (reason.impact === "positive") return 1;
    return 2;
  };
  return [...reasons].sort((left, right) =>
    priority(left) - priority(right) || `${left.kind}:${left.message}`.localeCompare(`${right.kind}:${right.message}`, "zh-Hans-CN")
  );
}

function requiredCourseMatchesByCode(course: Course, entry: Pick<DegreeMissingRequiredCourse, "code" | "name">): boolean {
  const courseCode = normaliseCode(course.code);
  const entryCode = normaliseCode(entry.code || "");
  return Boolean(courseCode && entryCode && courseCode === entryCode);
}

function collectRelevantDegreeManualReview(
  course: Course,
  reviews: readonly DegreeMissingManualReview[],
): DegreeMissingManualReview[] {
  return reviews.filter((review) => {
    if (review.code !== "REQUIRED_COURSE_STATUS_UNCLEAR" && review.code !== "REQUIRED_COURSE_IDENTITY_UNCLEAR") return false;
    if (!review.course) return false;
    const courseCode = normaliseCode(course.code);
    const reviewCode = normaliseCode(review.course.code || "");
    if (courseCode && reviewCode) return courseCode === reviewCode;
    return normaliseLabel(course.name) === normaliseLabel(review.course.name || "");
  });
}

function progressCourseMatches(course: Course, entry: DegreeProgressCourse): boolean {
  const courseCode = normaliseCode(course.code);
  const entryCode = normaliseCode(entry.code || "");
  if (courseCode && entryCode) return courseCode === entryCode;
  return normaliseLabel(course.name) === normaliseLabel(entry.name || "");
}

function summariseProgressCompletion(entries: readonly DegreeProgressCourse[]): DegreeGradeCompletion | undefined {
  const completions = entries
    .map((entry) => {
      if (!entry.letterGrade && entry.numericScore === undefined) return undefined;
      return classifyGradeCompletion({
        code: entry.code || "",
        name: entry.name || "",
        nameEn: entry.name || "",
        semester: entry.semester || "",
        credits: entry.credits ?? 0,
        letterGrade: entry.letterGrade || "",
        ...(entry.numericScore !== undefined ? { numericScore: entry.numericScore } : {}),
        nature: entry.courseNature || "",
        department: entry.college || "",
      }).completion;
    })
    .filter((entry): entry is DegreeGradeCompletion => entry !== undefined);
  if (completions.includes("passed")) return "passed";
  if (completions.includes("failed")) return "failed";
  if (completions.includes("non-completed")) return "non-completed";
  if (completions.includes("unknown")) return "unknown";
  return undefined;
}

function hasRemainingGap(
  value: Pick<DegreeMissingChoiceGap, "remainingCredits" | "remainingCourses" | "remainingHours">,
): boolean {
  return positive(value.remainingCredits) || positive(value.remainingCourses) || positive(value.remainingHours);
}

function matchChoiceGap(
  course: Course,
  gap: Pick<DegreeMissingChoiceGap, "scope" | "name" | "note" | "remainingCredits" | "remainingCourses" | "remainingHours">,
): CourseDecisionGapMatch | undefined {
  if (!hasRemainingGap(gap)) return undefined;
  const labels: Array<[Exclude<CourseDecisionGapMatch["matchedBy"], "section">, string]> = [
    ["category", course.category],
    ["nature", course.nature],
  ];
  for (const [matchedBy, value] of labels) {
    if (!labelMatchesGap(value, gap.name)) continue;
    return {
      scope: gap.scope,
      name: gap.name,
      matchedBy,
      ...(gap.note ? { note: gap.note } : {}),
    };
  }
  return undefined;
}

function labelMatchesGap(value: string, gapName: string): boolean {
  const left = normaliseLabel(value);
  const right = normaliseLabel(gapName);
  if (!left || !right) return false;
  if (left === right) return true;
  const leftCanonical = canonicalGapLabel(left);
  const rightCanonical = canonicalGapLabel(right);
  return Boolean(leftCanonical && rightCanonical && leftCanonical === rightCanonical);
}

function ncesEvidenceWeight(
  confidence: NcesResolvedCourse["confidence"],
  reviewCount: number,
): number {
  const confidenceWeight = confidence === "high" ? 1 : confidence === "medium" ? 0.75 : confidence === "low" ? 0.45 : 0;
  const reviewWeight = reviewCount <= 0 ? 0 : Math.max(0.25, Math.min(reviewCount, 20) / 20);
  return confidenceWeight * reviewWeight;
}

function sameSection(left: Course, right: Course): boolean {
  return courseDecisionKey(left) === courseDecisionKey(right);
}

function matchesCourseDecisionSelector(course: Course, selector: string): boolean {
  const trimmed = selector.trim();
  if (!trimmed) return false;
  if (trimmed === course.rwh) return true;
  return normaliseCode(trimmed) === normaliseCode(course.code);
}

function normaliseCode(value: string): string {
  return value.replaceAll(/[\s_-]+/g, "").toUpperCase();
}

function normaliseLabel(value: string): string {
  return value.replaceAll(/[\s·•（）()\-—_/]+/g, "").trim().toLowerCase();
}

function canonicalGapLabel(value: string): string {
  return value.replaceAll(/课程群|课程|模块|方向|类别/g, "");
}

function uniqueCodes(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => normaliseCode(value)).filter(Boolean))];
}

function positive(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function collectUniqueWarnings(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
