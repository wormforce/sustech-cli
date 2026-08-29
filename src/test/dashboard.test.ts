import assert from "node:assert/strict";
import test from "node:test";
import { formatDashboard } from "../core/dashboard.js";
import type { CredentialProfileStatus } from "../core/keyring.js";

const loggedOut: CredentialProfileStatus = {
  profile: "default",
  configured: false,
  credentialAvailable: false,
  backend: "macos-keychain",
  backendAvailable: true,
  persistent: true,
  profiles: [],
};

test("dashboard guides an unconfigured profile to login without expanding full help", () => {
  const output = formatDashboard({
    version: "0.10.0",
    runtime: "node v22.0.0",
    credentials: loggedOut,
    brandArt: "ART",
  });

  assert.match(output, /^ART\n/);
  assert.match(output, /Profile      default/);
  assert.match(output, /Credentials  not configured/);
  assert.match(output, /sustech auth login/);
  assert.match(output, /sustech calendar day/);
  assert.doesNotMatch(output, /Usage:/);
});

test("dashboard shows the masked active account and authenticated quick actions", () => {
  const output = formatDashboard({
    version: "0.10.0",
    runtime: "node v22.0.0",
    credentials: {
      ...loggedOut,
      profile: "personal",
      configured: true,
      credentialAvailable: true,
      maskedSid: "12****00",
      profiles: ["default", "personal"],
    },
    brandArt: "ART",
  });

  assert.match(output, /Profile      personal/);
  assert.match(output, /SID          12\*\*\*\*00/);
  assert.match(output, /Credentials  ready/);
  assert.match(output, /Profiles     default, personal/);
  assert.match(output, /sustech context --live/);
  assert.doesNotMatch(output, /sustech auth login/);
});

test("dashboard uses a fastfetch-style side-by-side layout only when it fits", () => {
  const wide = formatDashboard({
    version: "0.10.0",
    runtime: "node v22.0.0",
    credentials: loggedOut,
    brandArt: "AAAA\nBBBB",
    terminalColumns: 80,
  });
  assert.match(wide, /^AAAA {4}sustech-cli 0\.10\.0/);
  assert.match(wide, /^BBBB {4}$/m);

  const narrow = formatDashboard({
    version: "0.10.0",
    runtime: "node v22.0.0",
    credentials: loggedOut,
    brandArt: "AAAA\nBBBB",
    terminalColumns: 30,
  });
  assert.match(narrow, /^AAAA\nBBBB\n\nsustech-cli/);
});
