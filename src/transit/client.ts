import { CliError } from "../core/errors.js";
import { fetchJson } from "../core/http.js";
import type { BusLine, BusSchedule, BusSubRoute, Facility, FacilityKind, LiveBus } from "./types.js";

const LIVE_BASE = "https://bus.sustcra.com";
const SCHEDULE_BASE = "https://sustech.online";

export class TransitClient {
  public async facilities(): Promise<Facility[]> {
    const [buildings, gates] = await Promise.all([
      this.geoJsonFacilities(`${LIVE_BASE}/geojson/sustech_bldg.json`, "building"),
      this.geoJsonFacilities(`${LIVE_BASE}/geojson/sustech_gate.json`, "gate"),
    ]);
    return deduplicate([...buildings, ...gates]);
  }

  public async find(query: string, limit: number): Promise<Facility[]> {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    const routePairs = await this.routePairs();
    const stopResults = await Promise.all(
      routePairs.map(({ line, direction }) => this.stops(line, direction).catch(() => [])),
    );
    const candidates = deduplicate([...await this.facilities(), ...stopResults.flat()]);
    return candidates
      .map((facility) => ({ facility, score: matchScore(facility, needle) }))
      .filter((entry): entry is { facility: Facility; score: number } => entry.score !== undefined)
      .sort((left, right) => left.score - right.score || left.facility.name.localeCompare(right.facility.name))
      .slice(0, limit)
      .map((entry) => entry.facility);
  }

  public async lines(dayType: "workday" | "holiday"): Promise<BusLine[]> {
    const config = asRecord(await fetchJson(`${SCHEDULE_BASE}/bus_config.json`));
    return asRecords(config[dayType]).map((raw) => ({
      id: stringValue(raw.id),
      title: stringValue(raw.title),
      routes: asRecords(raw.routes).map((route, index) => normaliseSubRoute(route, index)),
    }));
  }

  public async schedule(
    lineId: string,
    routeIndex: number,
    dayType: "workday" | "holiday",
  ): Promise<BusSchedule> {
    const line = (await this.lines(dayType)).find((candidate) => candidate.id === lineId);
    if (!line) {
      throw new CliError("Unknown bus line.", "TRANSIT_LINE_NOT_FOUND", 2, { lineId, dayType });
    }
    const route = line.routes[routeIndex];
    if (!route) {
      throw new CliError("Bus route index is out of range.", "TRANSIT_ROUTE_NOT_FOUND", 2, {
        lineId,
        routeIndex,
        available: line.routes.length,
      });
    }
    const source = route.sources.find((candidate) => candidate.type === "bus") ?? route.sources[0];
    if (!source?.url) {
      throw new CliError("The bus route has no schedule source.", "TRANSIT_SCHEDULE_UNAVAILABLE", 1, {
        lineId,
        routeIndex,
      });
    }
    const sourceUrl = new URL(source.url, SCHEDULE_BASE).toString();
    const data = asRecord(await fetchJson(sourceUrl));
    const minuteOnRoad = numberValue(data.minuteOnRoad);
    return {
      lineId,
      title: line.title,
      dayType,
      routeIndex,
      routeName: route.name,
      routeDescription: route.description,
      color: route.color,
      times: asStrings(data.times),
      ...(minuteOnRoad !== undefined ? { minuteOnRoad } : {}),
    };
  }

  public async stops(line: string, direction: number): Promise<Facility[]> {
    if (!Number.isInteger(direction) || direction < 0 || direction > 1) {
      throw new CliError("--direction must be 0 or 1.", "INVALID_DIRECTION", 2, { direction });
    }
    const data = asRecord(await fetchJson(
      `${LIVE_BASE}/api/v3/${encodeURIComponent(line)}/${direction}/stations`,
    ));
    return asRecords(data.features).map((feature) => normaliseGeoJsonFacility(feature, "bus_stop", line, direction));
  }

  public async live(): Promise<LiveBus[]> {
    const sources = [
      { url: `${LIVE_BASE}/api/v2/monitor_osm/`, source: "bus" as const },
      { url: `${LIVE_BASE}/api/v2/monitor_sev_osm/`, source: "shuttle" as const },
    ];
    const results = await Promise.allSettled(sources.map(async ({ url, source }) => ({
      source,
      rows: asRecords(await fetchJson(url)),
    })));
    const succeeded = results.filter((result): result is PromiseFulfilledResult<{ source: "bus" | "shuttle"; rows: Record<string, unknown>[] }> => result.status === "fulfilled");
    if (succeeded.length === 0) {
      throw new CliError("All live-bus feeds are unavailable.", "TRANSIT_LIVE_UNAVAILABLE", 1);
    }
    return succeeded.flatMap(({ value }) => value.rows.map((row) => normaliseLiveBus(row, value.source)));
  }

  private async routePairs(): Promise<Array<{ line: string; direction: number }>> {
    const data = asRecord(await fetchJson(`${LIVE_BASE}/api/v3/avail_route`));
    const seen = new Set<string>();
    const pairs: Array<{ line: string; direction: number }> = [];
    for (const route of asRecords(data.routes)) {
      const line = stringValue(route.name);
      const direction = numberValue(route.direction);
      const key = `${line}/${direction}`;
      if (!line || direction === undefined || seen.has(key)) continue;
      seen.add(key);
      pairs.push({ line, direction });
    }
    return pairs;
  }

  private async geoJsonFacilities(url: string, kind: "building" | "gate"): Promise<Facility[]> {
    const data = asRecord(await fetchJson(url));
    return asRecords(data.features).map((feature) => normaliseGeoJsonFacility(feature, kind));
  }
}

function normaliseGeoJsonFacility(
  feature: Record<string, unknown>,
  kind: FacilityKind,
  line = "",
  direction = 0,
): Facility {
  const properties = asRecord(feature.properties);
  const geometry = asRecord(feature.geometry);
  const coordinates = Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
  const [rawName, nameEn] = splitBilingual(stringValue(properties.name));
  const name = kind === "building" ? uniqueBuildingName(rawName, nameEn) : rawName;
  const stationId = stringValue(properties.station_id);
  const slug = kind === "bus_stop" ? stationId || name : name || nameEn || "unknown";
  return {
    id: `${kind}:${slug}`,
    name,
    nameEn,
    kind,
    lat: numberValue(coordinates[1]) ?? 0,
    lng: numberValue(coordinates[0]) ?? 0,
    routes: kind === "bus_stop" ? [`${line}/${direction}`] : [],
  };
}

function normaliseSubRoute(raw: Record<string, unknown>, index: number): BusSubRoute {
  const sources = asRecords(raw.sources).map((source) => ({
    url: stringValue(source.url),
    type: stringValue(source.type),
  }));
  let lineCode = "";
  let direction = 0;
  for (const source of sources) {
    if (source.url.includes("one_") || source.url.includes("short_down")) {
      lineCode = "XYBS1";
      direction = 0;
    } else if (source.url.includes("two_") || source.url.includes("short_up")) {
      lineCode = "XYBS2";
      direction = 1;
    }
  }
  return {
    index,
    name: stringValue(raw.name),
    description: stringValue(raw.description),
    kind: stringValue(raw.type) || "loop",
    color: stringValue(raw.color) || "#888",
    lineCode,
    direction,
    sources,
  };
}

function normaliseLiveBus(raw: Record<string, unknown>, source: "bus" | "shuttle"): LiveBus {
  return {
    id: stringValue(raw.id),
    lat: numberValue(raw.lat) ?? 0,
    lng: numberValue(raw.lng) ?? 0,
    speedKmh: numberValue(raw.speed) ?? 0,
    bearing: numberValue(raw.course) ?? 0,
    operating: Boolean(numberValue(raw.is_operating) ?? 0),
    routeCode: stringValue(raw.route_code),
    nextStation: stringValue(raw.next_station_string),
    previousStationId: stringValue(raw.prev_station_id),
    timestamp: numberValue(raw.time_mt) ?? 0,
    source,
  };
}

function splitBilingual(value: string): [string, string] {
  if (value.includes("\n")) {
    const [name, ...rest] = value.split("\n");
    return [name.trim(), rest.join(" ").trim()];
  }
  const match = /^(.*?[\u3400-\u9fff])\s+([A-Za-z].*)$/.exec(value);
  return match ? [match[1].trim(), match[2].trim()] : [value.trim(), ""];
}

function uniqueBuildingName(name: string, nameEn: string): string {
  if (!GENERIC_BUILDING_NAMES.has(name)) return name;
  const suffix = /(\d+)\s*$/.exec(nameEn)?.[1];
  return suffix ? `${name}${suffix}栋` : name;
}

function deduplicate(facilities: Facility[]): Facility[] {
  const records = new Map<string, Facility>();
  for (const facility of facilities) {
    const previous = records.get(facility.id);
    if (!previous) records.set(facility.id, facility);
    else previous.routes = [...new Set([...previous.routes, ...facility.routes])];
  }
  return [...records.values()];
}

function matchScore(facility: Facility, query: string): number | undefined {
  const aliases = [facility.id, facility.name, facility.nameEn].filter(Boolean).map((value) => value.toLowerCase());
  if (aliases.includes(query)) return -100;
  const matches = aliases.filter((alias) => alias.includes(query));
  return matches.length > 0 ? Math.min(...matches.map((alias) => alias.length - query.length)) : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> => entry !== null && typeof entry === "object" && !Array.isArray(entry))
    : [];
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(stringValue).filter(Boolean) : [];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function numberValue(value: unknown): number | undefined {
  if (value === "" || value === null || value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

const GENERIC_BUILDING_NAMES = new Set(["宿舍", "教师公寓", "创园", "荔园", "慧园", "欣园", "荔园南站"]);
