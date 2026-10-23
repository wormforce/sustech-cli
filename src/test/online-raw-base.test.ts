import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { CliError } from "../core/errors.js";
import {
  ONLINE_RAW_BASE,
  ONLINE_RAW_BASE_PATH,
  ONLINE_RAW_ORIGIN,
  onlineRawBase,
  onlineRawUrl,
} from "../online/index.js";

const DEFAULT_BASE = "https://raw.githubusercontent.com/SUSTech-CRA/sustech-online-ng/master";
const MIRROR_BASE = "https://ghfast.top/https://raw.githubusercontent.com/SUSTech-CRA/sustech-online-ng/master";
const CONTACT_PATH = "docs/contact/README.md";

test("defaults to the public GitHub raw base", () => {
  assert.equal(onlineRawBase({}), DEFAULT_BASE);
  assert.equal(onlineRawUrl(CONTACT_PATH), `${DEFAULT_BASE}/${CONTACT_PATH}`);
});

test("accepts an HTTPS mirror override and trims surrounding slashes and spaces", () => {
  assert.equal(onlineRawBase({ SUSTECH_ONLINE_RAW_BASE: MIRROR_BASE }), MIRROR_BASE);
  assert.equal(onlineRawBase({ SUSTECH_ONLINE_RAW_BASE: `${MIRROR_BASE}/` }), MIRROR_BASE);
  assert.equal(onlineRawBase({ SUSTECH_ONLINE_RAW_BASE: `  ${MIRROR_BASE}  ` }), MIRROR_BASE);
});

test("rejects unsafe or malformed overrides", () => {
  const values = [
    "http://mirror.example/repo",
    "https://mirror.example/repo?token=1",
    "https://mirror.example/repo#fragment",
    "not a url",
  ];
  for (const value of values) {
    assert.throws(
      () => onlineRawBase({ SUSTECH_ONLINE_RAW_BASE: value }),
      (error: unknown) => error instanceof CliError && error.code === "ONLINE_RAW_BASE_INVALID",
    );
  }
});

test(
  "import-time allowlist derives from the default base",
  { skip: process.env.SUSTECH_ONLINE_RAW_BASE ? "SUSTECH_ONLINE_RAW_BASE is set in this environment" : false },
  () => {
    assert.equal(ONLINE_RAW_BASE, DEFAULT_BASE);
    assert.equal(ONLINE_RAW_ORIGIN, "https://raw.githubusercontent.com");
    assert.equal(ONLINE_RAW_BASE_PATH, "/SUSTech-CRA/sustech-online-ng/master/");
  },
);

test("mirror override is applied when the module loads", () => {
  const sharedModule = pathToFileURL(resolve("dist", "online", "shared.js")).href;
  const script = [
    `const m = await import(${JSON.stringify(sharedModule)});`,
    `console.log(m.onlineRawUrl(${JSON.stringify(CONTACT_PATH)}));`,
    "console.log(m.ONLINE_RAW_BASE_PATH);",
  ].join("");
  const [builtUrl, basePath] = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    env: { ...process.env, SUSTECH_ONLINE_RAW_BASE: MIRROR_BASE },
  })
    .trim()
    .split(/\r?\n/);
  assert.equal(builtUrl, `${MIRROR_BASE}/${CONTACT_PATH}`);
  assert.equal(basePath, "/https://raw.githubusercontent.com/SUSTech-CRA/sustech-online-ng/master/");
});
