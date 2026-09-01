import assert from "node:assert/strict";
import test from "node:test";
import type { Semester } from "../core/semester.js";
import { CliError } from "../core/errors.js";
import {
  buildSelectionPreview,
  ensureSelectionVerified,
  planBidUpdates,
  projectBidTotal,
  reconcileSelectionSnapshots,
  revalidateSelectionWrite,
  selectionEndpoint,
  verifySelectionWrite,
} from "../tis/remaining-selection.js";

const SEMESTER: Semester = { xn: "2025-2026", xq: "1", value: "2025-2026-1" };
const CONTEXT = {
  semester: SEMESTER,
  cultivation: "1" as const,
  currentTerm: { p_dqxn: "2025-2026", p_dqxq: "1", p_dqxnxq: "2025-20261", cxsfmt: "0" },
};

test("selection previews keep write payloads typed and operation-specific", () => {
  const enroll = buildSelectionPreview(CONTEXT, {
    operation: "enroll",
    courseId: "hex-id",
    round: "yixuan",
    bid: 3,
  });
  assert.equal(enroll.endpoint, "/Xsxk/addXuanke");
  assert.equal(enroll.payload.p_xktjz, "gwctjzyx");
  assert.equal(enroll.payload.p_xkxs, "3");
  assert.match(enroll.clientRequestId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(enroll.identifierContract.readbackIdentity, ["courseId", "rwh"]);
  assert.equal(enroll.idempotency.upstreamKeySupported, false);
  assert.equal(enroll.idempotency.automaticRetry, "forbidden");

  const cartAdd = buildSelectionPreview(CONTEXT, {
    operation: "cart.add",
    courseId: "hex-id",
    bid: 1,
  });
  assert.equal(cartAdd.payload.p_xkfsdm, "bxxk");

  const cartBid = buildSelectionPreview(CONTEXT, {
    operation: "bid.update",
    courseId: "hex-id",
    round: "yixuan",
    bid: 5,
    where: "cart",
  });
  assert.equal(cartBid.endpoint, "/Xsxk/addGouwuche");
  assert.match(cartBid.successHeuristic, /cart bid value/i);
});

test("bounded reconciliation handles delayed visibility without repeating a mutation", () => {
  const target = {
    operation: "cart.add" as const,
    courseId: "hex-id",
    rwh: "RWH-1",
    round: "bxxk",
    bid: 1,
    where: "cart" as const,
  };
  const absent = { courses:[{ id:"hex-id", rwh:"RWH-1" }], cart:[], enrolled:[], round:{ xkfsdm:"bxxk" } };
  const present = { courses:[{ id:"hex-id", rwh:"RWH-1" }], cart:[{ id:"hex-id", rwh:"RWH-1", xkxs:"1" }], enrolled:[], round:{ xkfsdm:"bxxk" } };
  const result = reconcileSelectionSnapshots([absent, absent, present], target);
  assert.equal(result.status, "applied");
  assert.equal(result.automaticRetryAllowed, false);
});

test("bounded reconciliation distinguishes stable not-applied from conflicting readback", () => {
  const target = {
    operation: "bid.update" as const,
    courseId: "hex-id",
    rwh: "RWH-1",
    round: "yixuan",
    bid: 5,
    where: "cart" as const,
  };
  const unchanged = { courses:[{ id:"hex-id", rwh:"RWH-1" }], cart:[{ id:"hex-id", rwh:"RWH-1", xkxs:"2" }], enrolled:[], round:{ xkfsdm:"yixuan" } };
  assert.equal(reconcileSelectionSnapshots([unchanged, structuredClone(unchanged)], target).status, "not_applied");

  const conflicting = { courses:[{ id:"hex-id", rwh:"RWH-1" }], cart:[{ id:"other-id", rwh:"RWH-1", xkxs:"5" }], enrolled:[], round:{ xkfsdm:"yixuan" } };
  assert.equal(reconcileSelectionSnapshots([unchanged, conflicting], target).status, "still_uncertain");
});

test("bid planning short-circuits when the round budget would be exceeded", () => {
  const plan = planBidUpdates(CONTEXT, { A: 5, B: 4 }, { where: "cart", round: "yixuan", limit: 8 });
  assert.equal(plan.overLimit, true);
  assert.equal(plan.totalBid, 9);
  assert.equal(plan.previews.length, 0);
});

test("bid planning validates per-course bids before generating previews", () => {
  const plan = planBidUpdates(CONTEXT, { A: 0, B: 2 }, { where: "enrolled", round: "yixuan" });
  assert.deepEqual(plan.errors, ["A: bid must be >= 1"]);
  assert.equal(plan.previews.length, 1);
  assert.equal(selectionEndpoint("drop"), "/Xsxk/tuike");
});

test("selection apply precheck requires exact live course binding for create-like writes", () => {
  const precheck = revalidateSelectionWrite({
    courses: [{ id: "other-id", rwh: "OTHER-RWH" }],
    cart: [],
    enrolled: [],
    round: { xkfsdm: "bxxk" },
  }, {
    operation: "cart.add",
    courseId: "hex-id",
    rwh: "RWH-1",
    round: "bxxk",
    bid: 1,
    where: "cart",
  });
  assert.equal(precheck.ok, false);
  assert.match(precheck.message, /live selectable-course state/i);
});

test("selection apply rejects observed targets whose course id is missing", () => {
  const precheck = revalidateSelectionWrite({
    courses: [{ id: "hex-id", rwh: "RWH-1" }],
    cart: [{ rwh: "RWH-1", xkxs: "2" }],
    enrolled: [],
    round: { xkfsdm: "yixuan" },
  }, {
    operation: "cart.remove",
    courseId: "hex-id",
    rwh: "RWH-1",
    round: "yixuan",
    bid: 1,
    where: "cart",
  });
  assert.equal(precheck.ok, false);
  assert.match(precheck.message, /did not expose its course ID/i);
});

test("selection verification confirms exact read-back and exit-5 guard marks ambiguous outcomes non-retriable", () => {
  const confirmed = verifySelectionWrite({
    courses: [{ id: "hex-id", rwh: "RWH-1" }],
    cart: [{ rwh: "RWH-1", id: "hex-id", xkxs: "5" }],
    enrolled: [],
    round: { xkfsdm: "yixuan", jffs: "8" },
  }, {
    operation: "bid.update",
    courseId: "hex-id",
    rwh: "RWH-1",
    round: "yixuan",
    bid: 5,
    where: "cart",
  });
  assert.equal(confirmed.status, "confirmed");
  assert.doesNotThrow(() => ensureSelectionVerified(confirmed, {
    message: "should not throw",
    code: "TEST",
  }));

  const ambiguous = verifySelectionWrite({
    courses: [{ id: "hex-id", rwh: "RWH-1" }],
    cart: [{ rwh: "RWH-1", id: "hex-id", xkxs: "3" }],
    enrolled: [],
    round: { xkfsdm: "yixuan", jffs: "8" },
  }, {
    operation: "bid.update",
    courseId: "hex-id",
    rwh: "RWH-1",
    round: "yixuan",
    bid: 5,
    where: "cart",
  });
  assert.equal(ambiguous.status, "not_observed");
  assert.throws(
    () => ensureSelectionVerified(ambiguous, {
      message: "ambiguous",
      code: "TIS_BID_NOT_CONFIRMED",
      details: { target: "RWH-1" },
    }),
    (error: unknown) => error instanceof CliError
      && error.code === "TIS_BID_NOT_CONFIRMED"
      && error.exitCode === 5
      && error.details?.warning === "DO_NOT_RETRY_AUTOMATICALLY",
  );
});

test("batch bid projection keys on exact RWH, not only course id", () => {
  const projection = projectBidTotal({
    courses: [
      { id: "same-id", rwh: "RWH-1" },
      { id: "same-id", rwh: "RWH-2" },
    ],
    cart: [
      { rwh: "RWH-1", id: "same-id", xkxs: "1" },
      { rwh: "RWH-2", id: "same-id", xkxs: "1" },
    ],
    enrolled: [],
    round: { xkfsdm: "yixuan", jffs: "8" },
  }, [
    { rwh: "RWH-1", courseId: "same-id", bid: 2 },
    { rwh: "RWH-2", courseId: "same-id", bid: 3 },
  ], "cart");
  assert.equal(projection.previousTotalBid, 2);
  assert.equal(projection.totalBid, 5);
  assert.deepEqual(projection.missingTargets, []);
});
