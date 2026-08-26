import type { WifiAssociation, WifiEvent } from "./types.js";

export function formatAssociation(association: WifiAssociation | null): string {
  if (!association) return "Wi-Fi · not associated";
  const rows = [
    `Wi-Fi · ${association.ssid}`,
    `Interface  ${association.interface}`,
    association.bssid ? `BSSID      ${association.bssid}` : "",
    association.signalDbm !== undefined ? `Signal     ${association.signalDbm} dBm` : "",
    association.channel !== undefined ? `Channel    ${association.channel}${association.band ? ` (${association.band})` : ""}` : "",
    association.security ? `Security   ${association.security}` : "",
    association.phyMode ? `PHY mode   ${association.phyMode}` : "",
  ].filter(Boolean);
  return rows.join("\n");
}

export function formatWifiEvents(events: readonly WifiEvent[], minutes: number): string {
  if (events.length === 0) return `Wi-Fi events · last ${minutes} minutes\nNo matching SUSTC Wi-Fi events.`;
  return [
    `Wi-Fi events · last ${minutes} minutes · ${events.length}`,
    ...events.map((event) => `${event.timestamp}  ${event.category.padEnd(12)} ${event.ssid ?? "-"}  ${event.message}`),
  ].join("\n");
}
