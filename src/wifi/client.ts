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
    try {
      const { stdout } = await execFileAsync("/usr/sbin/system_profiler", ["SPAirPortDataType", "-json"], {
        encoding: "utf8",
        timeout: 15_000,
        maxBuffer: 4 * 1024 * 1024,
      });
      return parseCurrentNetworkJson(stdout);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new CliError("macOS returned invalid Wi-Fi profile JSON.", "WIFI_PROTOCOL_ERROR", 1);
      }
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

export function parseCurrentNetworkJson(text: string): WifiAssociation | null {
  const root = recordValue(JSON.parse(text));
  const profiles = arrayValue(root.SPAirPortDataType);
  for (const profile of profiles) {
    const interfaces = arrayValue(recordValue(profile).spairport_airport_interfaces);
    for (const rawInterface of interfaces) {
      const interfaceRecord = recordValue(rawInterface);
      const network = recordValue(interfaceRecord.spairport_current_network_information);
      const ssid = stringValue(network._name);
      if (!ssid) continue;

      const association: WifiAssociation = {
        interface: stringValue(interfaceRecord._name) || "en0",
        ssid,
      };
      const phyMode = stringValue(network.spairport_network_phymode);
      const security = normaliseSecurity(stringValue(network.spairport_security_mode));
      const channelValue = stringValue(network.spairport_network_channel);
      const signalValue = stringValue(network.spairport_signal_noise);
      const bssidValue = stringValue(network.spairport_network_bssid ?? network.BSSID);
      const channel = /^(\d+)/.exec(channelValue)?.[1];
      const band = /\(([^)]+)\)/.exec(channelValue)?.[1];
      const signal = /(-?\d+)\s*dBm/i.exec(signalValue)?.[1];
      const bssid = bssidValue.match(BSSID_PATTERN)?.[0]?.toUpperCase();
      if (phyMode) association.phyMode = phyMode;
      if (security) association.security = security;
      if (channel) association.channel = Number(channel);
      if (band) association.band = band;
      if (signal) association.signalDbm = Number(signal);
      if (bssid) association.bssid = bssid;
      return association;
    }
  }
  return null;
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

function recordValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normaliseSecurity(value: string): string {
  const normalized = value.replace(/^spairport_security_mode_/, "");
  return normalized
    .split("_")
    .filter(Boolean)
    .map((part) => /^wpa\d?$/i.test(part) ? part.toUpperCase() : `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}
