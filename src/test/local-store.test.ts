import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { join, posix, win32 } from "node:path";
import test from "node:test";
import { CliError } from "../core/errors.js";
import { assertPathAndParentsAreNotSymlinks, defaultConfigDirectory, pathChainForSymlinkGuard, writeJsonAtomically } from "../core/local-store.js";

test("local artifacts use platform-aligned config directories", () => {
  assert.equal(
    defaultConfigDirectory({
      env: { XDG_CONFIG_HOME: "/xdg/config" },
      platform: "linux",
      homeDirectory: "/home/student",
    }),
    join("/xdg/config", "sustech-cli"),
  );
  assert.equal(
    defaultConfigDirectory({
      env: { APPDATA: "/windows/appdata" },
      platform: "win32",
      homeDirectory: "/home/student",
    }),
    join("/windows/appdata", "sustech-cli"),
  );
  assert.equal(
    defaultConfigDirectory({ env: {}, platform: "darwin", homeDirectory: "/Users/student" }),
    join("/Users/student", "Library", "Application Support", "sustech-cli"),
  );
  assert.equal(
    defaultConfigDirectory({ env: {}, platform: "linux", homeDirectory: "/home/student" }),
    join("/home/student", ".config", "sustech-cli"),
  );
});

test("local symlink guard enumerates every parent under posix and win32 path semantics", () => {
  assert.deepEqual(
    pathChainForSymlinkGuard("/tmp/sustech-cli/state.json", posix),
    ["/", "/tmp", "/tmp/sustech-cli", "/tmp/sustech-cli/state.json"],
  );
  assert.deepEqual(
    pathChainForSymlinkGuard("C:\\Users\\student\\AppData\\Roaming\\sustech-cli\\state.json", win32),
    [
      "C:\\",
      "C:\\Users",
      "C:\\Users\\student",
      "C:\\Users\\student\\AppData",
      "C:\\Users\\student\\AppData\\Roaming",
      "C:\\Users\\student\\AppData\\Roaming\\sustech-cli",
      "C:\\Users\\student\\AppData\\Roaming\\sustech-cli\\state.json",
    ],
  );
});

test("atomic local writes reject symbolic-link parents before creating directories", {
  skip: process.platform === "win32",
}, async () => {
  const tempDir = mkdtempSync(join(process.cwd(), ".tmp-sustech-cli-local-store-link-"));
  const realDir = join(tempDir, "real");
  const linkedDir = join(tempDir, "linked");

  try {
    mkdirSync(realDir);
    symlinkSync(realDir, linkedDir);
    await assert.rejects(
      () => writeJsonAtomically(join(linkedDir, "nested", "state.json"), { ok: true }),
      (error: unknown) => error instanceof CliError && error.code === "UNSAFE_LOCAL_PATH",
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("direct symlink guard rejects a symbolic-link parent even when the final path is missing", {
  skip: process.platform === "win32",
}, async () => {
  const tempDir = mkdtempSync(join(process.cwd(), ".tmp-sustech-cli-local-store-assert-"));
  const realDir = join(tempDir, "real");
  const linkedDir = join(tempDir, "linked");

  try {
    mkdirSync(realDir);
    symlinkSync(realDir, linkedDir);
    await assert.rejects(
      () => assertPathAndParentsAreNotSymlinks(join(linkedDir, "nested", "state.json")),
      (error: unknown) =>
        error instanceof CliError
        && error.code === "UNSAFE_LOCAL_PATH"
        && error.details?.symlink === linkedDir,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
