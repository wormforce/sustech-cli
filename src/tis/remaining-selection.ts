import type { Semester } from "../core/semester.js";
import { CliError } from "../core/errors.js";
import { asRecord, numberValue, stringValue } from "./remaining-shared.js";
import type { Course } from "./types.js";

export type SelectionOperation = "enroll" | "drop" | "cart.add" | "cart.remove" | "bid.update";
export type SelectionBidWhere = "cart" | "enrolled";

export interface SelectionExactTarget {
  courseId: string;
  rwh: string;
}

export interface SelectionApplyTarget extends SelectionExactTarget {
  operation: SelectionOperation;
  round: string;
  bid: number;
  where: SelectionBidWhere;
}

export interface BidPick {
  courseId: string;
  bid: number;
  rwh?: string;
}

export interface SelectionContext {
  semester: Semester;
  currentTerm: Record<string, unknown>;
  cultivation: "1" | "2";
}

export interface SelectionPreviewInput {
  operation: SelectionOperation;
  courseId: string;
  round?: string;
  bid?: number;
  where?: SelectionBidWhere;
  ignoreConflicts?: boolean;
  ignoreZeroCapacity?: boolean;
}

export interface SelectionVerificationStep {
  kind: "requery-cart" | "requery-enrolled" | "requery-round" | "inspect-message";
  description: string;
}

export interface SelectionPreview {
  operation: SelectionOperation;
  endpoint: string;
  payload: Record<string, string | number | string[]>;
  requiresExplicitConfirm: true;
  successHeuristic: string;
  verification: SelectionVerificationStep[];
}

export interface BidPlan {
  picks: Record<string, number>;
  pickDetails: BidPick[];
  where: SelectionBidWhere;
  totalBid: number;
  overLimit: boolean;
  limit?: number;
  previews: SelectionPreview[];
  errors: string[];
}

export interface SelectionStateSnapshot {
  cart: readonly Record<string, unknown>[];
  enrolled: readonly Record<string, unknown>[];
  round: Record<string, unknown>;
  courses?: readonly Pick<Course, "id" | "rwh">[];
}

export interface SelectionObservedEntry {
  where: SelectionBidWhere;
  rwh: string;
  courseId?: string;
  bid?: number;
  courseIdObserved: boolean;
  courseIdMatches: boolean;
  raw: Record<string, unknown>;
}

export interface SelectionStateObservation {
  cart?: SelectionObservedEntry;
  enrolled?: SelectionObservedEntry;
  roundCode?: string;
  roundLimit?: number;
  catalogCourseBound?: boolean;
  totalBid: number;
}

export interface SelectionRevalidation {
  ok: boolean;
  code: string;
  message: string;
  observation: SelectionStateObservation;
}

export interface SelectionVerificationResult {
  status: "confirmed" | "not_observed";
  message: string;
  observation: SelectionStateObservation;
}

export interface BidProjection {
  previousTotalBid: number;
  totalBid: number;
  limit?: number;
  overLimit: boolean;
  missingTargets: string[];
}

const ENDPOINTS = {
  enroll: "/Xsxk/addXuanke",
  drop: "/Xsxk/tuike",
  cartAdd: "/Xsxk/addGouwuche",
  cartRemove: "/Xsxk/delGouwuche",
  bidEnrolled: "/Xsxk/updXkxsByyx",
  bidCart: "/Xsxk/addGouwuche",
} as const;

const XKTJZ_CART_TO_ENROLLED = "gwctjzyx";
const XKTJZ_TASK_TO_ENROLLED = "rwtjzyx";

export function buildSelectionPreview(context: SelectionContext, input: SelectionPreviewInput): SelectionPreview {
  if (!input.courseId.trim()) {
    throw new CliError("A TIS course id is required for write previews.", "COURSE_ID_REQUIRED", 2);
  }
  if (input.operation === "bid.update") {
    const bid = Number(input.bid);
    if (!Number.isInteger(bid) || bid < 1) {
      throw new CliError("Bid previews require a positive integer bid.", "INVALID_BID", 2, { received: input.bid });
    }
  }

  const endpoint = selectionEndpoint(input.operation, input.where);
  const payload = buildSelectionPayload(context, input);
  return {
    operation: input.operation,
    endpoint,
    payload,
    requiresExplicitConfirm: true,
    successHeuristic: successHeuristic(input.operation, input.where),
    verification: verificationSteps(input.operation, input.where),
  };
}

export function buildSelectionPayload(
  context: SelectionContext,
  input: SelectionPreviewInput,
): Record<string, string | number | string[]> {
  const xktjz = input.operation === "enroll" ? XKTJZ_CART_TO_ENROLLED : XKTJZ_TASK_TO_ENROLLED;
  const bid = input.operation === "drop" || input.operation === "cart.remove" ? "" : String(input.bid ?? 1);
  const xkfsdm = input.round || (input.operation === "cart.add" ? "bxxk" : "yixuan");
  const dq = asRecord(context.currentTerm);
  return {
    cxsfmt: stringValue(dq.cxsfmt) || "0",
    mxpylx: context.cultivation,
    p_pylx: context.cultivation,
    p_sfgldjr: "0",
    p_sfredis: "0",
    p_sfsyxkgwc: "0",
    p_xktjz: xktjz,
    p_chaxunxh: "",
    p_chaxunxkfsdm: "",
    p_gjz: "",
    p_skjs: "",
    p_xn: context.semester.xn,
    p_xq: context.semester.xq,
    p_xnxq: `${context.semester.xn}${context.semester.xq}`,
    p_dqxn: stringValue(dq.p_dqxn),
    p_dqxq: stringValue(dq.p_dqxq),
    p_dqxnxq: stringValue(dq.p_dqxnxq),
    p_xkfsdm: xkfsdm,
    p_xiaoqu: "",
    p_kkyx: "",
    p_kclb: "",
    p_xkxs: bid,
    p_dyc: "",
    p_kkxnxq: "",
    p_id: input.courseId,
    p_ids: [],
    p_sfhlctkc: input.ignoreConflicts ? "1" : "0",
    p_sfhllrlkc: input.ignoreZeroCapacity ? "1" : "0",
    p_kxsj_xqj: "",
    p_kxsj_ksjc: "",
    p_kxsj_jsjc: "",
    p_kcdm_js: "",
    p_kcdm_cxrw: "",
    p_kcdm_cxrw_zckc: "",
    p_kc_gjz: "",
    p_xzcxtjz_nj: "",
    p_xzcxtjz_yx: "",
    p_xzcxtjz_zy: "",
    p_xzcxtjz_zyfx: "",
    p_xzcxtjz_bj: "",
    p_sfxsgwckb: "1",
    p_skyy: "",
    p_sfmxzj: "",
    pageNum: "1",
    pageSize: "19",
  };
}

export function planBidUpdates(
  context: SelectionContext,
  picks: Record<string, number> | readonly BidPick[],
  options: { where: SelectionBidWhere; round: string; limit?: number },
): BidPlan {
  const errors: string[] = [];
  const sanitized: Record<string, number> = {};
  const pickDetails = Array.isArray(picks)
    ? picks
    : Object.entries(picks).map(([courseId, bid]) => ({ courseId, bid }));
  const sanitizedPickDetails: BidPick[] = [];
  for (const pick of pickDetails) {
    const courseId = pick.courseId;
    const rawBid = pick.bid;
    const bid = Number(rawBid);
    if (!Number.isInteger(bid)) {
      errors.push(`${courseId}: bid must be an integer`);
      continue;
    }
    if (bid < 1) {
      errors.push(`${courseId}: bid must be >= 1`);
      continue;
    }
    sanitized[bidPickIdentity(pick)] = bid;
    sanitizedPickDetails.push({ courseId, bid, ...(pick.rwh ? { rwh: pick.rwh } : {}) });
  }

  const totalBid = sanitizedPickDetails.reduce((total, pick) => total + pick.bid, 0);
  const overLimit = options.limit !== undefined && totalBid > options.limit;
  const previews = overLimit
    ? []
    : [...sanitizedPickDetails]
      .sort((left, right) => left.courseId.localeCompare(right.courseId))
      .map((pick) => buildSelectionPreview(context, {
        operation: "bid.update",
        courseId: pick.courseId,
        round: options.round,
        bid: pick.bid,
        where: options.where,
      }));

  return {
    picks: sanitized,
    pickDetails: sanitizedPickDetails,
    where: options.where,
    totalBid,
    overLimit,
    limit: options.limit,
    previews,
    errors,
  };
}

export function observeSelectionState(
  state: SelectionStateSnapshot,
  target: SelectionExactTarget,
): SelectionStateObservation {
  return {
    cart: observedEntry(state.cart, "cart", target),
    enrolled: observedEntry(state.enrolled, "enrolled", target),
    roundCode: stringValue(state.round.xkfsdm),
    roundLimit: numberValue(state.round.jffs),
    catalogCourseBound: state.courses ? state.courses.some((course) => course.id === target.courseId && course.rwh === target.rwh) : undefined,
    totalBid: totalObservedBid(state),
  };
}

export function revalidateSelectionWrite(
  state: SelectionStateSnapshot,
  target: SelectionApplyTarget,
): SelectionRevalidation {
  const observation = observeSelectionState(state, target);
  if (observation.roundCode && observation.roundCode !== target.round) {
    return {
      ok: false,
      code: "TIS_SELECTION_PRECHECK_FAILED",
      message: `Live round ${observation.roundCode} does not match requested round ${target.round}.`,
      observation,
    };
  }
  if (target.operation === "cart.add") {
    if (observation.catalogCourseBound !== true) {
      return {
        ok: false,
        code: "TIS_SELECTION_PRECHECK_FAILED",
        message: "The exact {courseId, rwh} target was not observed in the live selectable-course state.",
        observation,
      };
    }
    if (observation.cart) {
      return {
        ok: false,
        code: "TIS_SELECTION_PRECHECK_FAILED",
        message: "The exact RWH is already present in the cart.",
        observation,
      };
    }
    if (observation.enrolled) {
      return {
        ok: false,
        code: "TIS_SELECTION_PRECHECK_FAILED",
        message: "The exact RWH is already enrolled; cart.add would be stale.",
        observation,
      };
    }
    return { ok: true, code: "OK", message: "Target is absent from both cart and enrolled state.", observation };
  }

  if (target.operation === "cart.remove") {
    return requireObservedTarget(observation.cart, "cart", observation, "TIS_SELECTION_PRECHECK_FAILED");
  }
  if (target.operation === "drop") {
    return requireObservedTarget(observation.enrolled, "enrolled", observation, "TIS_SELECTION_PRECHECK_FAILED");
  }
  if (target.operation === "bid.update") {
    return requireObservedTarget(
      target.where === "cart" ? observation.cart : observation.enrolled,
      target.where,
      observation,
      "TIS_SELECTION_PRECHECK_FAILED",
    );
  }
  if (target.operation === "enroll") {
    if (observation.catalogCourseBound !== true) {
      return {
        ok: false,
        code: "TIS_SELECTION_PRECHECK_FAILED",
        message: "The exact {courseId, rwh} target was not observed in the live selectable-course state.",
        observation,
      };
    }
    if (observation.enrolled) {
      return {
        ok: false,
        code: "TIS_SELECTION_PRECHECK_FAILED",
        message: "The exact RWH is already enrolled.",
        observation,
      };
    }
    return { ok: true, code: "OK", message: "Target is not yet enrolled.", observation };
  }
  return { ok: false, code: "UNSUPPORTED_SELECTION_OPERATION", message: "Unsupported selection operation.", observation };
}

export function verifySelectionWrite(
  state: SelectionStateSnapshot,
  target: SelectionApplyTarget,
): SelectionVerificationResult {
  const observation = observeSelectionState(state, target);
  if (target.operation === "cart.add") {
    const cart = observation.cart;
    if (!cart) return { status: "not_observed", message: "The exact RWH was not observed in cart after the write.", observation };
    if (!cart.courseIdObserved) return { status: "not_observed", message: "A cart entry appeared, but TIS did not return its course ID for exact binding.", observation };
    if (!cart.courseIdMatches) return { status: "not_observed", message: "A cart entry with the same RWH appeared, but its TIS ID does not match.", observation };
    if (cart.bid !== undefined && cart.bid !== target.bid) {
      return { status: "not_observed", message: `Cart bid read back as ${cart.bid}, expected ${target.bid}.`, observation };
    }
    return { status: "confirmed", message: "The exact RWH was observed in cart with the expected bid state.", observation };
  }
  if (target.operation === "cart.remove") {
    return observation.cart
      ? { status: "not_observed", message: "The exact RWH is still present in cart after the write.", observation }
      : { status: "confirmed", message: "The exact RWH is absent from cart after the write.", observation };
  }
  if (target.operation === "drop") {
    return observation.enrolled
      ? { status: "not_observed", message: "The exact RWH is still present in enrolled state after the drop.", observation }
      : { status: "confirmed", message: "The exact RWH is absent from enrolled state after the drop.", observation };
  }
  if (target.operation === "bid.update") {
    const observed = target.where === "cart" ? observation.cart : observation.enrolled;
    if (!observed) {
      return { status: "not_observed", message: `The exact RWH was not observed in ${target.where} after the bid update.`, observation };
    }
    if (!observed.courseIdObserved) {
      return { status: "not_observed", message: `TIS returned the ${target.where} entry, but omitted its course ID so exact binding could not be verified.`, observation };
    }
    if (!observed.courseIdMatches) {
      return { status: "not_observed", message: `A ${target.where} entry with the same RWH was observed, but its TIS ID does not match.`, observation };
    }
    if (observed.bid !== target.bid) {
      return { status: "not_observed", message: `Bid read back as ${observed.bid ?? "missing"}, expected ${target.bid}.`, observation };
    }
    if (!observation.roundCode) {
      return { status: "not_observed", message: "The bid value was observed, but round metadata was not returned by TIS.", observation };
    }
    return { status: "confirmed", message: "The exact RWH and bid value were read back from TIS together with round metadata.", observation };
  }
  if (target.operation === "enroll") {
    return observation.enrolled?.courseIdObserved && observation.enrolled.courseIdMatches
      ? { status: "confirmed", message: "The exact RWH and course ID were observed in enrolled state.", observation }
      : { status: "not_observed", message: "The exact RWH was not yet visible in enrolled state.", observation };
  }
  return { status: "not_observed", message: "Unsupported selection operation.", observation };
}

export function projectBidTotal(
  state: SelectionStateSnapshot,
  picks: readonly BidPick[],
  where: SelectionBidWhere,
): BidProjection {
  let totalBid = totalObservedBid(state);
  const missingTargets: string[] = [];
  for (const pick of picks) {
    if (!pick.rwh) {
      missingTargets.push(`${pick.courseId}: missing RWH`);
      continue;
    }
    const observed = observeSelectionState(state, { courseId: pick.courseId, rwh: pick.rwh });
    const target = where === "cart" ? observed.cart : observed.enrolled;
    if (!target) {
      missingTargets.push(pick.rwh);
      continue;
    }
    if (!target.courseIdMatches) {
      missingTargets.push(`${pick.rwh}: TIS ID mismatch`);
      continue;
    }
    totalBid = totalBid - (target.bid ?? 0) + pick.bid;
  }
  const limit = numberValue(state.round.jffs);
  return {
    previousTotalBid: totalObservedBid(state),
    totalBid,
    limit,
    overLimit: limit !== undefined && totalBid > limit,
    missingTargets,
  };
}

export function ensureSelectionVerified(
  verification: SelectionVerificationResult,
  options: { message: string; code: string; details?: Record<string, unknown> },
): void {
  if (verification.status === "confirmed") return;
  throw new CliError(options.message, options.code, 5, {
    ...(options.details ?? {}),
    verification,
    warning: "DO_NOT_RETRY_AUTOMATICALLY",
  });
}

export function selectionEndpoint(operation: SelectionOperation, where: SelectionBidWhere = "enrolled"): string {
  switch (operation) {
    case "enroll":
      return ENDPOINTS.enroll;
    case "drop":
      return ENDPOINTS.drop;
    case "cart.add":
      return ENDPOINTS.cartAdd;
    case "cart.remove":
      return ENDPOINTS.cartRemove;
    case "bid.update":
      return where === "cart" ? ENDPOINTS.bidCart : ENDPOINTS.bidEnrolled;
    default:
      throw new CliError("Unsupported selection operation.", "UNSUPPORTED_SELECTION_OPERATION", 2, { operation });
  }
}

function successHeuristic(operation: SelectionOperation, where: SelectionBidWhere = "enrolled"): string {
  switch (operation) {
    case "enroll":
      return "TIS returns jg=1 and the section appears in the enrolled schedule.";
    case "drop":
      return "TIS returns jg=1 and the section disappears from the enrolled schedule.";
    case "cart.add":
      return "TIS returns jg=1 and the section appears in the cart/personal query view.";
    case "cart.remove":
      return "TIS returns jg=1 and the section disappears from the cart/personal query view.";
    case "bid.update":
      return where === "cart"
        ? "TIS returns jg=1 and a follow-up personal query shows the cart bid value changed."
        : "TIS returns jg=1 and a follow-up personal query shows the enrolled bid value changed.";
    default:
      return "TIS returns jg=1.";
  }
}

function verificationSteps(operation: SelectionOperation, where: SelectionBidWhere = "enrolled"): SelectionVerificationStep[] {
  switch (operation) {
    case "enroll":
      return [
        { kind: "inspect-message", description: "Check the write response message and TIS code." },
        { kind: "requery-enrolled", description: "Re-read the enrolled schedule for the semester and confirm the section exists." },
      ];
    case "drop":
      return [
        { kind: "inspect-message", description: "Check the write response message and TIS code." },
        { kind: "requery-enrolled", description: "Re-read the enrolled schedule and confirm the section is gone." },
      ];
    case "cart.add":
      return [
        { kind: "inspect-message", description: "Check the write response message and TIS code." },
        { kind: "requery-cart", description: "Re-run the personal selection query and confirm the section is in cart state." },
      ];
    case "cart.remove":
      return [
        { kind: "inspect-message", description: "Check the write response message and TIS code." },
        { kind: "requery-cart", description: "Re-run the personal selection query and confirm the section is absent from cart state." },
      ];
    case "bid.update":
      return [
        { kind: "inspect-message", description: "Check the write response message and TIS code." },
        {
          kind: where === "cart" ? "requery-cart" : "requery-enrolled",
          description: "Re-read the personal selection view and confirm the bid value persisted on the matching section.",
        },
        { kind: "requery-round", description: "Re-check the current round metadata to ensure the bid budget still balances." },
      ];
    default:
      return [{ kind: "inspect-message", description: "Check the write response message and TIS code." }];
  }
}

function observedEntry(
  items: readonly Record<string, unknown>[],
  where: SelectionBidWhere,
  target: SelectionExactTarget,
): SelectionObservedEntry | undefined {
  for (const item of items) {
    const rwh = stringValue(item.rwh ?? item.RWH);
    if (!rwh || rwh !== target.rwh) continue;
    const courseId = stringValue(item.id ?? item.ID ?? item.p_id ?? item.P_ID) || undefined;
    return {
      where,
      rwh,
      courseId,
      bid: numberValue(item.xkxs ?? item.XKXS),
      courseIdObserved: courseId !== undefined,
      courseIdMatches: courseId !== undefined && courseId === target.courseId,
      raw: item,
    };
  }
  return undefined;
}

function requireObservedTarget(
  observed: SelectionObservedEntry | undefined,
  where: SelectionBidWhere,
  observation: SelectionStateObservation,
  code: string,
): SelectionRevalidation {
  if (!observed) {
    return {
      ok: false,
      code,
      message: `The exact RWH was not observed in ${where} state during revalidation.`,
      observation,
    };
  }
  if (!observed.courseIdObserved) {
    return {
      ok: false,
      code,
      message: `The exact RWH exists in ${where}, but TIS did not expose its course ID for exact binding.`,
      observation,
    };
  }
  if (!observed.courseIdMatches) {
    return {
      ok: false,
      code,
      message: `The exact RWH exists in ${where}, but its TIS ID does not match the requested target.`,
      observation,
    };
  }
  return {
    ok: true,
    code: "OK",
    message: `The exact RWH is present in ${where} state.`,
    observation,
  };
}

function totalObservedBid(state: SelectionStateSnapshot): number {
  const byTarget = new Map<string, number>();
  for (const item of [...state.enrolled, ...state.cart]) {
    const rwh = stringValue(item.rwh ?? item.RWH);
    const courseId = stringValue(item.id ?? item.ID ?? item.p_id ?? item.P_ID);
    const key = rwh || courseId;
    if (!key) continue;
    byTarget.set(key, numberValue(item.xkxs ?? item.XKXS) ?? 0);
  }
  return [...byTarget.values()].reduce((total, value) => total + value, 0);
}

function bidPickIdentity(pick: BidPick): string {
  return pick.rwh ? `${pick.rwh}#${pick.courseId}` : pick.courseId;
}
