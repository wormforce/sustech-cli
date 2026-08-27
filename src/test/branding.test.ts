import assert from "node:assert/strict";
import test from "node:test";
import { formatBrandArt, shouldUseBrandColor } from "../core/branding.js";

test("brand art has stable plain and colored renderings", () => {
  const plain = formatBrandArt(false);
  assert.match(plain, /:\*##: :#######:/);
  assert.match(plain, /#########:########:/);
  assert.doesNotMatch(plain, /\u001b\[/);

  const colored = formatBrandArt(true);
  assert.match(colored, /\u001b\[38;2;237;108;0m/);
  assert.ok(colored.split("\n").every((line) => (
    line.startsWith("\u001b[38;2;237;108;0m") && line.endsWith("\u001b[0m")
  )));
  assert.equal(colored.replaceAll(/\u001b\[[0-9;]*m/g, ""), plain);
});

test("brand color is limited to color-capable interactive terminals", () => {
  assert.equal(shouldUseBrandColor(true, {}), true);
  assert.equal(shouldUseBrandColor(false, {}), false);
  assert.equal(shouldUseBrandColor(true, { NO_COLOR: "1" }), false);
  assert.equal(shouldUseBrandColor(true, { TERM: "dumb" }), false);
});
