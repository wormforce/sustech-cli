#!/usr/bin/env node

import { writeFileSync } from "node:fs";

process.on("SIGTERM", () => {
  const marker = process.env.SUSTECH_MCP_TEST_CANCEL_MARKER;
  if (marker) writeFileSync(marker, "cancelled\n", "utf8");
  process.exit(0);
});

const readyMarker = process.env.SUSTECH_MCP_TEST_READY_MARKER;
if (readyMarker) writeFileSync(readyMarker, "ready\n", "utf8");

setTimeout(() => {
  process.stdout.write(JSON.stringify({ schemaVersion: "1", ok: true, command: "version", data: {} }));
}, 30_000);
