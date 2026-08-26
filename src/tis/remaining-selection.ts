import type { Semester } from "../core/semester.js";
import { CliError } from "../core/errors.js";
import { asRecord, stringValue } from "./remaining-shared.js";

export type SelectionOperation = "enroll" | "drop" | "cart.add" | "cart.remove" | "bid.update";
export type SelectionBidWhere = "cart" | "enrolled";

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
  where: SelectionBidWhere;
  totalBid: number;
  overLimit: boolean;
  limit?: number;
  previews: SelectionPreview[];
  errors: string[];
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
  picks: Record<string, number>,
  options: { where: SelectionBidWhere; round: string; limit?: number },
): BidPlan {
  const errors: string[] = [];
  const sanitized: Record<string, number> = {};
  for (const [courseId, rawBid] of Object.entries(picks)) {
    const bid = Number(rawBid);
    if (!Number.isInteger(bid)) {
      errors.push(`${courseId}: bid must be an integer`);
      continue;
    }
    if (bid < 1) {
      errors.push(`${courseId}: bid must be >= 1`);
      continue;
    }
    sanitized[courseId] = bid;
  }

  const totalBid = Object.values(sanitized).reduce((total, value) => total + value, 0);
  const overLimit = options.limit !== undefined && totalBid > options.limit;
  const previews = overLimit
    ? []
    : Object.entries(sanitized)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([courseId, bid]) => buildSelectionPreview(context, {
        operation: "bid.update",
        courseId,
        round: options.round,
        bid,
        where: options.where,
      }));

  return {
    picks: sanitized,
    where: options.where,
    totalBid,
    overLimit,
    limit: options.limit,
    previews,
    errors,
  };
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
