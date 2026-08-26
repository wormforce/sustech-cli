import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CliError } from "../core/errors.js";
import type { WifiAssociation, WifiEvent } from "./types.js";

const execFileAsync = promisify(execFile);
const DEFAULT_SSIDS = ["SUSTC-Wifi", "SUSTC-Wifi-5G"] as const;
const BSSID_PATTERN = /\b(?:[0-9a-f]{2}:){5}[0-9a-f]{2}\b/i;

export class WifiClient {
  public async currentAssociation(): Promise<WifiAssociation | null> {
    ensureMacOS();
    const interfaceName = await wifiInterface();
    try {
      const { stdout } = await execFileAsync("/usr/sbin/system_profiler", ["SPAirPortDataType"], {
        encoding: "utf8",
        timeout: 15_000,
        maxBuffer: 4 * 1024 * 1024,
      });
      const parsed = parseCurrentNetwork(stdout, interfaceName);
      if (parsed) return parsed;
    } catch (error) {
      if (!isExpectedCommandFailure(error)) throw error;
    }
    return null;
  }

  public async recentEvents(
    minutes = 60,
    ssids: readonly string[] = DEFAULT_SSIDS,
  ): Promise<WifiEvent[]> {
    ensureMacOS();
    if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > 1440) {
      throw new CliError("Wi-Fi event window must be between 1 and 1440 minutes.", "USAGE", 2);
    }
    const since = new Date(Date.now() - minutes * 60_000);
    const sinceText = formatLocalTimestamp(since);
    let stdout: string;
    try {
      ({ stdout } = await execFileAsync("/usr/bin/log", [
        "show",
        "--predicate",
        'subsystem == "com.apple.wifi" OR subsystem == "com.apple.wifid"',
        "--start",
        sinceText,
        "--style",
        "compact",
      ], {
        encoding: "utf8",
        timeout: 30_000,
        maxBuffer: 16 * 1024 * 1024,
      }));
    } catch (error) {
      throw new CliError("Could not read the macOS Wi-Fi event log.", "WIFI_LOG_ERROR", 1, {
        cause: error instanceof Error ? error.message : String(error),
      });
    }
    return parseWifiEvents(stdout, ssids);
  }
}

export function parseCurrentNetwork(text: string, interfaceName = "en0"): WifiAssociation | null {
  const lines = text.split(/\r?\n/);
  const marker = lines.findIndex((line) => line.includes("Current Network Information") && line.includes(":"));
  if (marker < 0) return null;
  let index = marker + 1;
  while (index < lines.length && !lines[index]?.trim()) index += 1;
  const ssidLine = lines[index];
  if (!ssidLine) return null;
  const ssidIndent = leadingWhitespace(ssidLine);
  const ssid = ssidLine.trim().replace(/:$/, "");
  if (!ssid) return null;

  const association: WifiAssociation = { interface: interfaceName, ssid };
  for (index += 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!line.trim()) continue;
    if (leadingWhitespace(line) < ssidIndent) break;
    const [rawKey, ...rest] = line.trim().split(":");
    const key = rawKey?.trim() ?? "";
    const value = rest.join(":").trim();
    if (key === "PHY Mode" && value) association.phyMode = value;
    if (key === "Security" && value) association.security = value;
    if (key === "Channel") {
      const channel = /^(\d+)/.exec(value)?.[1];
      const band = /\(([^)]+)\)/.exec(value)?.[1];
      if (channel) association.channel = Number(channel);
      if (band) association.band = band;
    }
    if (key.startsWith("Signal")) {
      const signal = /(-?\d+)\s*dBm/i.exec(value)?.[1];
      if (signal) association.signalDbm = Number(signal);
    }
    if (key.toLowerCase() === "bssid" && BSSID_PATTERN.test(value)) {
      association.bssid = value.match(BSSID_PATTERN)?.[0]?.toUpperCase();
    }
  }
  return association;
}

export function parseWifiEvents(text: string, ssids: readonly string[] = DEFAULT_SSIDS): WifiEvent[] {
  const result: WifiEvent[] = [];
  const timestampPattern = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+(?:[+-]\d{4})?)\s+\S+\s+(.*)$/;
  for (const line of text.split(/\r?\n/)) {
    const ssid = ssids.find((candidate) => line.includes(candidate));
    if (!ssid) continue;
    const matched = timestampPattern.exec(line);
    if (!matched) continue;
    const message = matched[2]?.trim() ?? "";
    const bssid = message.match(BSSID_PATTERN)?.[0]?.toUpperCase();
    result.push({
      timestamp: matched[1] ?? "",
      category: classifyEvent(message),
      ssid,
      ...(bssid ? { bssid } : {}),
      message,
    });
  }
  return result;
}

async function wifiInterface(): Promise<string> {
  try {
    const { stdout } = await execFileAsync("/usr/sbin/networksetup", ["-listallhardwareports"], {
      encoding: "utf8",
      timeout: 5_000,
    });
    const lines = stdout.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      if (!lines[index]?.includes("Hardware Port: Wi-Fi")) continue;
      for (const line of lines.slice(index + 1, index + 3)) {
        if (line.trim().startsWith("Device:")) return line.split(":", 2)[1]?.trim() || "en0";
      }
    }
  } catch {
    // Fall through to the conventional interface name.
  }
  return "en0";
}

function classifyEvent(message: string): WifiEvent["category"] {
  const lower = message.toLowerCase();
  if (lower.includes("disassoc") || lower.includes("link down") || lower.includes("deauth")) return "disassociate";
  if (lower.includes("roam")) return "roam";
  if (lower.includes("associate") || lower.includes("joined") || lower.includes("connected to")) return "associate";
  if (lower.includes("eapol") || lower.includes("auth") || lower.includes("802.1x")) return "auth";
  return "other";
}

function ensureMacOS(): void {
  if (process.platform !== "darwin") {
    throw new CliError("Wi-Fi diagnostics are available only on macOS.", "UNSUPPORTED_PLATFORM", 1, {
      platform: process.platform,
    });
  }
}

function formatLocalTimestamp(value: Date): string {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? "00";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}:${part("second")}`;
}

function leadingWhitespace(value: string): number {
  return value.length - value.trimStart().length;
}

function isExpectedCommandFailure(error: unknown): boolean {
  return error instanceof Error;
}
