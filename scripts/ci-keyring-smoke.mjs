import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deleteStoredCredentials,
  loadStoredCredentials,
  saveStoredCredentials,
} from "../dist/core/keyring.js";

if (process.platform !== "darwin" && process.platform !== "win32") {
  throw new Error(`Native keyring smoke is unsupported on ${process.platform}.`);
}
if (process.env.CI !== "true") {
  throw new Error("This synthetic credential smoke is CI-only and refuses to modify a developer's local keyring.");
}

const configDir = await mkdtemp(join(tmpdir(), "sustech-cli-native-keyring-"));
const suffix = randomUUID();
const profile = `ci-${suffix.slice(0, 8)}`;
const sid = `ci-${suffix.slice(9, 17)}`;
const password = `ci-secret-${randomUUID()}`;
let stored = false;

try {
  await saveStoredCredentials({ profile, sid, password }, { configDir });
  stored = true;
  const loaded = await loadStoredCredentials(profile, { configDir });
  assert.equal(loaded.password, password);
  assert.equal(loaded.profile, profile);
  assert.equal((await deleteStoredCredentials(profile, { configDir })).removed, true);
  stored = false;
} finally {
  if (stored) {
    await deleteStoredCredentials(profile, { configDir }).catch(() => undefined);
  }
  await rm(configDir, { recursive: true, force: true });
}
