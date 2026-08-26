import assert from "node:assert/strict";
import test from "node:test";
import type { Semester } from "../core/semester.js";
import {
  buildSelectionPreview,
  planBidUpdates,
  selectionEndpoint,
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
