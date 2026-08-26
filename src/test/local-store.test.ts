import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { defaultConfigDirectory } from "../core/local-store.js";

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
