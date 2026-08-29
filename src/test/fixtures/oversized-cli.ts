#!/usr/bin/env node

process.stdout.write(JSON.stringify({
  schemaVersion: "1",
  ok: true,
  command: "version",
  data: { payload: "x".repeat(2 * 1024 * 1024) },
}));
