import { load } from "cheerio";
import { CliError } from "../core/errors.js";
import { USER_AGENT } from "../core/version.js";
import { createFetchAdapter, type ServiceAdapter } from "../services/base.js";

export const OFFICIAL_TALKS_URL = "https://www.sustech.edu.cn/zh/home-events.html";
const MAX_BYTES = 2 * 1024 * 1024;

export interface OfficialTalk {
  id: string;
  title: string;
  speaker?: string;
  venue?: string;
  timeText: string;
  date?: string;
  startAt?: string;
  detailUrl: string;
  timing: "upcoming" | "started" | "unknown";
}

export interface OfficialTalksResult {
  talks: OfficialTalk[];
  total: number;
  sourceTotal: number;
  provenance: {
    authority: "official";
    sourceUrl: string;
    fetchedAt: string;
    coverage: "homepage";
  };
  scope: "upcoming" | "all";
  referenceTime: string;
  unknownTimeCount: number;
  warnings: string[];
}

export interface OfficialTalksOptions {
  query?: string;
  all?: boolean;
  now?: Date;
}

export class OfficialTalksClient {
  constructor(private readonly adapter: ServiceAdapter = createFetchAdapter()) {}

  async list(options: OfficialTalksOptions = {}): Promise<OfficialTalksResult> {
    validateOptions(options);
    let html: string;
    try {
      const response = await this.adapter.fetch(OFFICIAL_TALKS_URL, {
        headers: { "user-agent": USER_AGENT, accept: "text/html" },
        signal: AbortSignal.timeout(15_000),
        redirect: "error",
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new CliError("The official talks page returned an HTTP error.", "UPSTREAM_HTTP_ERROR", 1, { status: response.status });
      }
      const type = response.headers.get("content-type");
      if (type && !/\b(?:text\/html|application\/xhtml\+xml)\b/i.test(type)) {
        await response.body?.cancel();
        throw protocolError("The official talks page did not return HTML.");
      }
      const reader = response.body?.getReader();
      if (!reader) throw protocolError("The official talks page returned an empty body.");
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_BYTES) {
            await reader.cancel();
            throw protocolError("The official talks page exceeds the 2 MiB limit.");
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      html = Buffer.concat(chunks).toString("utf8");
    } catch (error) {
      if (error instanceof CliError) throw error;
      throw new CliError("Could not fetch the official talks page.", "NETWORK_ERROR", 1, { sourceUrl: OFFICIAL_TALKS_URL });
    }
    const now = options.now ?? new Date();
    return queryOfficialTalks(parseOfficialTalks(html, now.toISOString()), { ...options, now });
  }
}

export function parseOfficialTalks(html: string, fetchedAt: string): OfficialTalksResult {
  const $ = load(html);
  const section = $(".item6_slider > ul > li.one");
  if (section.length !== 1 || section.find(".swiper-wrapper").length !== 1) {
    throw protocolError("The official talks section was not found; the page structure may have changed.");
  }
  const talks = new Map<string, OfficialTalk>();
  const warnings: string[] = [];
  section.find(".swiper-slide").each((_, element) => {
    const card = $(element);
    const href = card.find("a[href]").first().attr("href");
    let url: URL;
    try {
      url = new URL(href ?? "", OFFICIAL_TALKS_URL);
    } catch {
      throw protocolError("A lecture card has an invalid detail URL.");
    }
    const id = /^\/zh\/events\/(\d+)\.html$/.exec(url.pathname)?.[1];
    if (url.origin !== "https://www.sustech.edu.cn" || url.username || url.password || url.search || url.hash || !id) {
      throw protocolError("A lecture card has an unsupported detail URL.");
    }
    const text = (selector: string) => card.find(selector).first().text().replace(/\s+/gu, " ").trim();
    const title = text(".evt_ext p");
    if (!title) throw protocolError("A lecture card is missing its title.");
    const timeText = text(".evt_time");
    const match = /^(\d{4})年(\d{1,2})月(\d{1,2})日\s+(\d{1,2}):(\d{2})$/.exec(timeText);
    const date = match ? `${match[1]}-${match[2]!.padStart(2, "0")}-${match[3]!.padStart(2, "0")}` : undefined;
    const validTime = match && date && validDate(date) && Number(match[4]) < 24 && Number(match[5]) < 60;
    if (!validTime) warnings.push(timeWarning(id));
    const talk: OfficialTalk = {
      id, title,
      speaker: text(".evt_peo") || undefined,
      venue: text(".evt_adrr") || undefined,
      timeText,
      ...(validTime ? { date, startAt: `${date}T${match[4]!.padStart(2, "0")}:${match[5]}:00+08:00` } : {}),
      detailUrl: url.href,
      timing: "unknown",
    };
    if (!talks.has(id)) talks.set(id, talk);
  });
  return {
    talks: [...talks.values()], total: talks.size, sourceTotal: talks.size,
    provenance: { authority: "official", sourceUrl: OFFICIAL_TALKS_URL, fetchedAt, coverage: "homepage" },
    scope: "all",
    referenceTime: fetchedAt,
    unknownTimeCount: warnings.length,
    warnings: [...new Set(warnings)],
  };
}

export function queryOfficialTalks(result: OfficialTalksResult, options: OfficialTalksOptions): OfficialTalksResult {
  validateOptions(options);
  const now = options.now ?? new Date(result.provenance.fetchedAt);
  if (!Number.isFinite(now.getTime())) throw new CliError("The lecture reference time is invalid.", "USAGE", 2);
  const referenceTime = now.toISOString();
  const needle = options.query?.trim().toLocaleLowerCase("en-US");
  const classified = result.talks.map((talk) => ({
    ...talk,
    timing: talk.startAt === undefined ? "unknown" as const : Date.parse(talk.startAt) > now.getTime() ? "upcoming" as const : "started" as const,
  }));
  const matches = classified
    .filter((talk) => (options.all || talk.timing !== "started")
      && (!needle || [talk.title, talk.speaker, talk.venue, talk.timeText].some((field) => field?.toLocaleLowerCase("en-US").includes(needle))))
    .sort((a, b) => compareTalks(a, b, Boolean(options.all)));
  return {
    ...result,
    talks: matches,
    total: matches.length,
    scope: options.all ? "all" : "upcoming",
    referenceTime,
    unknownTimeCount: matches.filter((talk) => talk.timing === "unknown").length,
    warnings: matches
      .filter((talk) => talk.timing === "unknown")
      .map((talk) => timeWarning(talk.id)),
  };
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function validateOptions(options: OfficialTalksOptions): void {
  if (options.query !== undefined && !options.query.trim()) throw new CliError("A talk search query is required.", "USAGE", 2);
}

function compareTalks(a: OfficialTalk, b: OfficialTalk, all: boolean): number {
  const rank = (talk: OfficialTalk) => talk.timing === "upcoming" ? 0 : talk.timing === "unknown" ? 1 : 2;
  const rankDifference = rank(a) - rank(b);
  if (rankDifference !== 0) return rankDifference;
  if (!a.startAt || !b.startAt) return a.id.localeCompare(b.id, "en");
  const difference = Date.parse(a.startAt) - Date.parse(b.startAt);
  if (difference !== 0) {
    return all && a.timing === "started" ? -difference : difference;
  }
  return a.id.localeCompare(b.id, "en");
}

function protocolError(message: string): CliError {
  return new CliError(message, "UPSTREAM_PROTOCOL_ERROR", 1, { sourceUrl: OFFICIAL_TALKS_URL });
}

function timeWarning(id: string): string {
  return `Talk ${id}: date/time could not be normalized; see timeText and the source page.`;
}
