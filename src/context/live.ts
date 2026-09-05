import type { ServiceAdapter } from "../services/base.js";
import { createFetchAdapter, fetchJson, fetchText, numberValue, recordValue, requestUrl, stringValue } from "../services/base.js";
import type { LibraryIdleCategory } from "../services/library.js";
import type { EvaluationCourseStatus } from "../tis/remaining-evaluation.js";
import type { AirQualitySummary, EvaluationSummary, WeatherSummary } from "./types.js";

const SUSTECH_COORDINATES = {
  latitude: 22.6027,
  longitude: 113.9994,
} as const;

export async function loadWeatherSummary(
  adapter: ServiceAdapter = createFetchAdapter(),
): Promise<WeatherSummary> {
  const raw = await fetchJson<unknown>(adapter, requestUrl("https://api.open-meteo.com", "/v1/forecast", {
    latitude: SUSTECH_COORDINATES.latitude,
    longitude: SUSTECH_COORDINATES.longitude,
    current: [
      "temperature_2m",
      "apparent_temperature",
      "relative_humidity_2m",
      "precipitation",
      "weather_code",
      "wind_speed_10m",
    ],
    timezone: "Asia/Shanghai",
  }));
  const current = recordValue(recordValue(raw).current);
  return {
    condition: weatherCodeLabel(optionalNumber(current.weather_code) ?? -1),
    tempC: optionalNumber(current.temperature_2m),
    feelsLikeC: optionalNumber(current.apparent_temperature),
    humidity: optionalNumber(current.relative_humidity_2m),
    windKmh: optionalNumber(current.wind_speed_10m),
    precipitationMm: optionalNumber(current.precipitation),
  };
}

export async function fetchContextWeather(
  adapter: ServiceAdapter = createFetchAdapter(),
): Promise<WeatherSummary | null> {
  const raw = await fetchJson<unknown>(adapter, "https://api.sustech.online/weather", { signal: AbortSignal.timeout(8000) });
  return normaliseContextWeather(raw);
}

export async function loadAirQualitySummary(
  adapter: ServiceAdapter = createFetchAdapter(),
): Promise<AirQualitySummary> {
  const raw = await fetchJson<unknown>(adapter, requestUrl("https://air-quality-api.open-meteo.com", "/v1/air-quality", {
    latitude: SUSTECH_COORDINATES.latitude,
    longitude: SUSTECH_COORDINATES.longitude,
    current: [
      "us_aqi",
      "pm2_5",
      "pm10",
      "ozone",
    ],
    timezone: "Asia/Shanghai",
  }));
  const current = recordValue(recordValue(raw).current);
  const aqi = optionalNumber(current.us_aqi);
  if (aqi === undefined) throw new Error("AQI response did not include us_aqi.");
  return {
    aqi,
    level: aqiLevel(aqi),
    pm25: optionalNumber(current.pm2_5),
    pm10: optionalNumber(current.pm10),
    ozone: optionalNumber(current.ozone),
  };
}

export async function fetchContextAirQuality(
  adapter: ServiceAdapter = createFetchAdapter(),
): Promise<AirQualitySummary | null> {
  const raw = await fetchJson<unknown>(adapter, requestUrl("https://air-quality-api.open-meteo.com", "/v1/air-quality", {
    latitude: SUSTECH_COORDINATES.latitude,
    longitude: SUSTECH_COORDINATES.longitude,
    current: [
      "us_aqi",
      "pm2_5",
      "pm10",
      "ozone",
    ],
    timezone: "Asia/Shanghai",
  }), { signal: AbortSignal.timeout(8000) });
  return normaliseContextAirQuality(raw);
}

export async function fetchContextLibraryStatus(
  adapter: ServiceAdapter = createFetchAdapter(),
): Promise<string | null> {
  const html = await fetchText(adapter, "https://lib.sustech.edu.cn/", { signal: AbortSignal.timeout(8000) });
  return parseContextLibraryStatus(html);
}

export function summariseLibraryIdleStatus(items: readonly LibraryIdleCategory[]): string | undefined {
  if (items.length === 0) return undefined;
  const idle = items.reduce((sum, item) => sum + item.idleQuantity, 0);
  const total = items.reduce((sum, item) => sum + item.totalQuantity, 0);
  const highlights = items
    .filter((item) => item.totalQuantity > 0)
    .sort((left, right) => right.idleQuantity - left.idleQuantity || right.totalQuantity - left.totalQuantity)
    .slice(0, 2)
    .map((item) => `${compactCategoryName(item.name)} ${item.idleQuantity}/${item.totalQuantity}`);
  return [
    `${idle}/${total} idle`,
    ...highlights,
  ].join(" · ");
}

export function selectNextEvaluation(
  rows: readonly EvaluationCourseStatus[],
  now: Date | string = new Date(),
): EvaluationSummary | undefined {
  const reference = normaliseNow(now);
  const candidates = rows
    .filter((row) => !row.submitted)
    .map((row) => ({
      row,
      deadline: parseShanghaiDateTime(row.deadline),
    }))
    .sort((left, right) => {
      if (left.deadline && right.deadline) return left.deadline.epochMs - right.deadline.epochMs;
      if (left.deadline) return -1;
      if (right.deadline) return 1;
      return `${left.row.courseCode} ${left.row.courseName}`.localeCompare(`${right.row.courseCode} ${right.row.courseName}`, "zh-Hans-CN");
    });
  const picked = candidates[0];
  if (!picked) return undefined;
  return {
    course: [picked.row.courseCode, picked.row.courseName].filter(Boolean).join(" · ") || picked.row.courseName || picked.row.courseCode,
    name: [picked.row.taskType, picked.row.classInfo].filter(Boolean).join(" · ") || picked.row.statusText,
    ...(picked.deadline ? {
      dueAt: `${picked.deadline.date} ${picked.deadline.time}`,
      daysLeft: daysUntilShanghai(reference, picked.deadline.date),
    } : {}),
  };
}

interface ParsedShanghaiDateTime {
  epochMs: number;
  date: string;
  time: string;
}

function parseShanghaiDateTime(value: string | undefined): ParsedShanghaiDateTime | undefined {
  const text = stringValue(value).trim();
  if (!text) return undefined;
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2}))?/.exec(text);
  if (!match) return undefined;
  const date = new Date(`${match[1]}T${match[2]}:${match[3] ?? "00"}+08:00`);
  if (Number.isNaN(date.getTime())) return undefined;
  return {
    epochMs: date.getTime(),
    date: match[1],
    time: match[2],
  };
}

function daysUntilShanghai(now: Date, dueDate: string): number {
  const current = shanghaiDate(now);
  const start = new Date(`${current}T00:00:00+08:00`).getTime();
  const end = new Date(`${dueDate}T00:00:00+08:00`).getTime();
  return Math.floor((end - start) / (24 * 60 * 60 * 1000));
}

function shanghaiDate(now: Date): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function compactCategoryName(value: string): string {
  return value.split(/\s{2,}| {2,}|\s+\(/, 1)[0]?.trim() || value.trim();
}

export function normaliseContextWeather(raw: unknown): WeatherSummary | null {
  const text = stringValue(recordValue(raw).msg).trim();
  if (!text) return null;
  const condition = text.replace(/^南科大天气[:：]?\s*/, "").trim() || text;
  const temp = /气温\s*(-?\d+(?:\.\d+)?)\s*℃/.exec(text);
  const feelsLike = /体感\s*(-?\d+(?:\.\d+)?)\s*℃/.exec(text);
  return {
    source: "https://api.sustech.online/weather",
    ...observationTime(recordValue(raw).update_time),
    condition,
    ...(temp ? { tempC: Math.round(Number(temp[1])) } : {}),
    ...(feelsLike ? { feelsLikeC: Math.round(Number(feelsLike[1])) } : {}),
  };
}

export function normaliseContextAirQuality(raw: unknown): AirQualitySummary | null {
  const current = recordValue(recordValue(raw).current);
  const aqi = optionalNumber(current.us_aqi);
  if (aqi === undefined) return null;
  return {
    standard: "US EPA",
    source: "https://air-quality-api.open-meteo.com",
    ...observationTime(current.time),
    aqi,
    level: aqiLevel(aqi),
    pm25: optionalNumber(current.pm2_5),
    pm10: optionalNumber(current.pm10),
    ozone: optionalNumber(current.ozone),
  };
}

function observationTime(value: unknown): { observedAt?: string } {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(value)) return {};
  const normalized = value.replace(" ", "T");
  const timestamp = new Date(/[zZ]|[+-]\d{2}:\d{2}$/.test(normalized) ? normalized : `${normalized}+08:00`);
  return Number.isNaN(timestamp.getTime()) ? {} : { observedAt: timestamp.toISOString() };
}

export function parseContextLibraryStatus(html: string): string | null {
  const spanBody = String.raw`((?:(?!<\/span>)[\s\S])*)`;
  const matches = [...html.matchAll(new RegExp(
    String.raw`<span[^>]*class=["'][^"']*\bname\b[^"']*["'][^>]*>${spanBody}<\/span>\s*<span[^>]*class=["'][^"']*\bnow\b[^"']*["'][^>]*>${spanBody}<\/span>`,
    "gi",
  ))];
  const items = matches
    .map((match) => `${collapseHtmlText(match[1])}: ${collapseHtmlText(match[2])}`)
    .filter(Boolean);
  return items.length > 0 ? items.join(", ") : null;
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = numberValue(value, Number.NaN);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function weatherCodeLabel(code: number): string {
  switch (code) {
    case 0: return "Clear";
    case 1:
    case 2:
    case 3: return "Partly cloudy";
    case 45:
    case 48: return "Fog";
    case 51:
    case 53:
    case 55: return "Drizzle";
    case 56:
    case 57: return "Freezing drizzle";
    case 61:
    case 63:
    case 65: return "Rain";
    case 66:
    case 67: return "Freezing rain";
    case 71:
    case 73:
    case 75:
    case 77: return "Snow";
    case 80:
    case 81:
    case 82: return "Rain showers";
    case 85:
    case 86: return "Snow showers";
    case 95: return "Thunderstorm";
    case 96:
    case 99: return "Thunderstorm with hail";
    default: return code >= 0 ? `Weather code ${code}` : "Unknown";
  }
}

export function aqiLevel(aqi: number): string {
  if (aqi <= 50) return "Good";
  if (aqi <= 100) return "Moderate";
  if (aqi <= 150) return "Unhealthy for Sensitive Groups";
  if (aqi <= 200) return "Unhealthy";
  if (aqi <= 300) return "Very Unhealthy";
  return "Hazardous";
}

function normaliseNow(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function collapseHtmlText(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}
