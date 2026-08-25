import type { BusLine, BusSchedule, Facility, LiveBus } from "./types.js";

export function formatFacilities(title: string, facilities: Facility[]): string {
  if (facilities.length === 0) return `${title}\n\nNo facilities found.`;
  const rows = facilities.map((facility, index) => [
    `${index + 1}. ${facility.name}${facility.nameEn ? ` / ${facility.nameEn}` : ""}`,
    `   ${facility.id} · ${facility.kind} · ${facility.lat.toFixed(6)}, ${facility.lng.toFixed(6)}`,
    facility.routes.length > 0 ? `   Routes: ${facility.routes.join(", ")}` : "",
  ].filter(Boolean).join("\n"));
  return `${title}\n\n${rows.join("\n\n")}\n\n${facilities.length} result(s).`;
}

export function formatBusLines(dayType: string, lines: BusLine[]): string {
  if (lines.length === 0) return `Bus lines · ${dayType}\n\nNo lines returned.`;
  const blocks = lines.map((line) => {
    const routes = line.routes.map((route) =>
      `   [${route.index}] ${route.name} · ${route.lineCode || "schedule only"}/${route.direction}\n       ${route.description}`,
    );
    return [`${line.id} — ${line.title}`, ...routes].join("\n");
  });
  return `Bus lines · ${dayType}\n\n${blocks.join("\n\n")}\n\n${lines.length} line(s).`;
}

export function formatBusSchedule(schedule: BusSchedule): string {
  return [
    `${schedule.routeName} — ${schedule.title}`,
    `${schedule.dayType} · route index ${schedule.routeIndex}${schedule.minuteOnRoad === undefined ? "" : ` · ~${schedule.minuteOnRoad} min`}`,
    schedule.routeDescription,
    "",
    schedule.times.length > 0 ? schedule.times.join("  ") : "No departure times returned.",
    "",
    `${schedule.times.length} departure(s).`,
  ].join("\n");
}

export function formatLiveBuses(buses: LiveBus[]): string {
  if (buses.length === 0) return "Live buses\n\nNo active vehicles right now.";
  const rows = buses.map((bus, index) => [
    `${index + 1}. ${bus.routeCode || bus.source} · ${bus.id || "unknown vehicle"}`,
    `   ${bus.lat.toFixed(6)}, ${bus.lng.toFixed(6)} · ${bus.speedKmh.toFixed(1)} km/h · bearing ${bus.bearing}`,
    bus.nextStation ? `   Next: ${bus.nextStation}` : "",
  ].filter(Boolean).join("\n"));
  return `Live buses\n\n${rows.join("\n\n")}\n\n${buses.length} active vehicle(s).`;
}
