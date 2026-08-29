import { CliError } from "../core/errors.js";
import { collapseWhitespace } from "../services/base.js";
import {
  buildOnlineProvenance,
  fetchOnlineMarkdownDocument,
  normaliseTalkSlug,
  onlineSiteUrl,
  ONLINE_TALKS_INDEX_REPO_PATH,
  ONLINE_TALKS_INDEX_SITE_PATH,
  parseTalkLabel,
  scoreSearchMatch,
  splitSpeakerLine,
  stripMarkdown,
  talkRepoPathFromSlug,
  talkSitePathFromSlug,
  uniqueStrings,
  type OnlineFetchOptions,
} from "./shared.js";
import type { OnlineTalk, OnlineTalkSummary } from "./types.js";

export interface OnlineTalkQueryOptions extends OnlineFetchOptions {
  limit?: number;
  since?: string;
  until?: string;
}

interface RankedTalk {
  score: number;
  talk: OnlineTalkSummary;
}

export async function listOnlineTalks(options: OnlineTalkQueryOptions = {}): Promise<OnlineTalkSummary[]> {
  const range = normaliseDateRange(options.since, options.until);
  const document = await fetchOnlineMarkdownDocument(ONLINE_TALKS_INDEX_REPO_PATH, ONLINE_TALKS_INDEX_SITE_PATH, options);
  const talks = parseOnlineTalksIndexMarkdown(document.markdown, {
    fetchedAt: document.fetchedAt,
    sourceUpdatedAt: document.pageUpdatedAt,
    sourceMetadataAvailable: document.pageMetadataAvailable,
    staleAfterDays: options.staleAfterDays,
  });
  return applyLimit(talks.filter((talk) => inDateRange(talk.date, range)), options.limit);
}

export async function searchOnlineTalks(query: string, options: OnlineTalkQueryOptions = {}): Promise<OnlineTalkSummary[]> {
  const needle = query.trim();
  if (!needle) throw new CliError("A search query is required.", "USAGE", 2);
  const talks = await listOnlineTalks({ ...options, limit: undefined });
  const ranked = talks
    .map((talk) => ({
      talk,
      score: scoreSearchMatch(needle, [
        { value: talk.id, weight: 8 },
        { value: talk.title, weight: 10 },
        { value: talk.label, weight: 7 },
        { value: talk.series, weight: 6 },
        { value: talk.speakerLine, weight: 8 },
        { value: talk.date, weight: 3 },
      ]),
    }))
    .filter((entry) => entry.score > 0)
    .sort(compareRankedTalks)
    .map((entry) => entry.talk);
  return applyLimit(ranked, options.limit);
}

export async function getOnlineTalk(identifier: string, options: OnlineFetchOptions = {}): Promise<OnlineTalk> {
  const slug = normaliseTalkSlug(identifier);
  const repoPath = talkRepoPathFromSlug(slug);
  const sitePath = talkSitePathFromSlug(slug);
  const document = await fetchOnlineMarkdownDocument(repoPath, sitePath, options);
  return parseOnlineTalkDetailMarkdown(slug, document.markdown, {
    fetchedAt: document.fetchedAt,
    sourceUpdatedAt: document.pageUpdatedAt,
    sourceMetadataAvailable: document.pageMetadataAvailable,
    staleAfterDays: options.staleAfterDays,
  });
}

export function parseOnlineTalksIndexMarkdown(
  markdown: string,
  options: {
    fetchedAt: string;
    sourceUpdatedAt?: string;
    sourceMetadataAvailable?: boolean;
    staleAfterDays?: number;
  },
): OnlineTalkSummary[] {
  const lines = markdown.replace(/\r\n?/gu, "\n").split("\n");
  const sourceUrl = onlineSiteUrl(ONLINE_TALKS_INDEX_SITE_PATH);
  const provenance = buildOnlineProvenance(
    sourceUrl,
    ONLINE_TALKS_INDEX_REPO_PATH,
    options.fetchedAt,
    options.sourceUpdatedAt,
    options.staleAfterDays,
    { aiProcessed: true, sourceMetadataAvailable: options.sourceMetadataAvailable },
  );
  const talks: OnlineTalkSummary[] = [];
  let currentDate = "";
  let currentWeekday: string | undefined;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const heading = /^##\s+(\d{4}-\d{2}-\d{2})(?:\s+(.+))?$/u.exec(line);
    if (heading) {
      currentDate = isIsoDate(heading[1]) ? heading[1] : "";
      currentWeekday = currentDate && heading[2] ? collapseWhitespace(heading[2]) : undefined;
      continue;
    }
    const entry = /^-\s+(\d{1,2}:\d{2})\s+-\s+\[(.+)\]\((.+\.md)\)$/u.exec(line);
    if (!entry || !currentDate) continue;
    const [, rawTimeText, label, target] = entry;
    const timeText = padTime(rawTimeText);
    if (!isClockTime(timeText)) continue;
    const slug = relativeTalkTargetToSlug(target);
    const detailRepoPath = talkRepoPathFromSlug(slug);
    const detailUrl = onlineSiteUrl(talkSitePathFromSlug(slug));
    const parsed = parseTalkLabel(label);
    talks.push({
      kind: "talk",
      id: slug,
      slug,
      label: collapseWhitespace(stripMarkdown(label)),
      title: parsed.title,
      ...(parsed.series ? { series: parsed.series } : {}),
      ...(parsed.speakerLine ? { speakerLine: parsed.speakerLine } : {}),
      ...(parsed.speakerName ? { speakerName: parsed.speakerName } : {}),
      ...(parsed.speakerAffiliation ? { speakerAffiliation: parsed.speakerAffiliation } : {}),
      date: currentDate,
      ...(currentWeekday ? { weekday: currentWeekday } : {}),
      timeText,
      startAt: `${currentDate}T${timeText.padStart(5, "0")}:00+08:00`,
      detailUrl,
      detailRepoPath,
      provenance,
    });
  }
  return talks;
}

export function parseOnlineTalkDetailMarkdown(
  slug: string,
  markdown: string,
  options: {
    fetchedAt: string;
    sourceUpdatedAt?: string;
    sourceMetadataAvailable?: boolean;
    staleAfterDays?: number;
  },
): OnlineTalk {
  const repoPath = talkRepoPathFromSlug(slug);
  const sitePath = talkSitePathFromSlug(slug);
  const sourceUrl = onlineSiteUrl(sitePath);
  const provenance = buildOnlineProvenance(
    sourceUrl,
    repoPath,
    options.fetchedAt,
    options.sourceUpdatedAt,
    options.staleAfterDays,
    { aiProcessed: true, sourceMetadataAvailable: options.sourceMetadataAvailable },
  );
  const normalised = markdown.replace(/\r\n?/gu, "\n").replace(/^\uFEFF/u, "");
  const titleLine = /^#\s+(.+)$/mu.exec(normalised)?.[1];
  if (!titleLine) {
    throw new CliError("The SUSTech Online talk detail is missing its title heading.", "UPSTREAM_PROTOCOL_ERROR", 1, {
      sourceRepoPath: repoPath,
    });
  }
  const parsedTitle = parseTalkLabel(titleLine);
  const timeRangeText = bulletField(normalised, "时间");
  const speakerLine = bulletField(normalised, "主讲人") ?? parsedTitle.speakerLine;
  const speakerParts = splitSpeakerLine(speakerLine);
  const venue = bulletField(normalised, "地点");
  const title = bulletField(normalised, "题目") ?? parsedTitle.title;
  const rawPosterUrl = /!\[[^\x5d]*\x5d\(([^)]+)\)/u.exec(rawSectionBody(normalised, "海报链接"))?.[1]?.trim();
  const posterUrl = safePosterUrl(rawPosterUrl, sourceUrl);
  const dateRange = parseTalkTimeRange(timeRangeText, slug);
  return {
    kind: "talk",
    id: slug,
    slug,
    label: collapseWhitespace(stripMarkdown(titleLine)),
    title,
    ...(parsedTitle.series ? { series: parsedTitle.series } : {}),
    ...(speakerLine ? { speakerLine } : {}),
    ...(speakerParts.name ? { speakerName: speakerParts.name } : {}),
    ...(speakerParts.affiliation ? { speakerAffiliation: speakerParts.affiliation } : {}),
    date: dateRange.startDate,
    ...(dateRange.weekday ? { weekday: dateRange.weekday } : {}),
    timeText: dateRange.startTime,
    ...(dateRange.startAt ? { startAt: dateRange.startAt } : {}),
    detailUrl: sourceUrl,
    detailRepoPath: repoPath,
    provenance,
    ...(timeRangeText ? { timeRangeText } : {}),
    ...(dateRange.endAt ? { endAt: dateRange.endAt } : {}),
    ...(venue ? { venue } : {}),
    ...(sectionBody(normalised, "主讲人简介") ? { speakerBio: sectionBody(normalised, "主讲人简介") } : {}),
    ...(sectionBody(normalised, "讲座简介") ? { abstract: sectionBody(normalised, "讲座简介") } : {}),
    ...(posterUrl ? { posterUrl } : {}),
  };
}

export function talkSearchSnippet(talk: OnlineTalkSummary): string {
  return uniqueStrings([
    [talk.date, talk.weekday, talk.timeText].filter(Boolean).join(" "),
    talk.series ?? "",
    talk.speakerLine ?? "",
    talk.label,
  ]).join(" · ");
}

function sectionBody(markdown: string, heading: string): string {
  return collapseWhitespace(stripMarkdown(rawSectionBody(markdown, heading)));
}

function rawSectionBody(markdown: string, heading: string): string {
  return new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*\\n([\\s\\S]*?)(?=^##\\s+|(?![\\s\\S]))`, "mu")
    .exec(markdown)?.[1] ?? "";
}

function bulletField(markdown: string, label: string): string | undefined {
  const match = new RegExp(`^\\*\\s+${escapeRegExp(label)}[：:]\\s*(.+)$`, "mu").exec(markdown);
  return match ? collapseWhitespace(stripMarkdown(match[1])) : undefined;
}

function relativeTalkTargetToSlug(target: string): string {
  return normaliseTalkSlug(target.replace(/^\.?\//u, ""));
}

function parseTalkTimeRange(value: string | undefined, slug: string): {
  startDate: string;
  startTime: string;
  startAt?: string;
  endAt?: string;
  weekday?: string;
} {
  const slugStart = talkStartFromSlug(slug);
  if (!value) {
    if (slugStart.startDate && slugStart.startTime) return slugStart;
    throw new CliError("The SUSTech Online talk has no valid source date and time.", "UPSTREAM_PROTOCOL_ERROR", 1, {
      slug,
    });
  }
  const singleDay = /^(\d{4})年(\d{1,2})月(\d{1,2})日\s+(\d{1,2}:\d{2})(?:-(\d{1,2}:\d{2}))?$/u.exec(value);
  if (singleDay) {
    const startDate = isoDate(singleDay[1], singleDay[2], singleDay[3]);
    const startTime = padTime(singleDay[4]);
    const endTime = singleDay[5] ? padTime(singleDay[5]) : undefined;
    if (isIsoDate(startDate) && isClockTime(startTime) && (!endTime || isClockTime(endTime))) {
      return {
        startDate,
        startTime,
        startAt: `${startDate}T${startTime}:00+08:00`,
        ...(endTime ? { endAt: `${startDate}T${endTime}:00+08:00` } : {}),
      };
    }
  }
  const multiDay = /^(\d{4})年(\d{1,2})月(\d{1,2})日\s*-\s*(\d{4})年(\d{1,2})月(\d{1,2})日\s+(\d{1,2}:\d{2})(?:-(\d{1,2}:\d{2}))?$/u.exec(value);
  if (multiDay) {
    const startDate = isoDate(multiDay[1], multiDay[2], multiDay[3]);
    const endDate = isoDate(multiDay[4], multiDay[5], multiDay[6]);
    const startTime = padTime(multiDay[7]);
    const endTime = multiDay[8] ? padTime(multiDay[8]) : undefined;
    if (
      isIsoDate(startDate)
      && isIsoDate(endDate)
      && startDate <= endDate
      && isClockTime(startTime)
      && (!endTime || isClockTime(endTime))
    ) {
      return {
        startDate,
        startTime,
        startAt: `${startDate}T${startTime}:00+08:00`,
        ...(endTime ? { endAt: `${endDate}T${endTime}:00+08:00` } : {}),
      };
    }
  }
  const fallbackDate = /(\d{4})-(\d{2})-(\d{2})/u.exec(value)?.slice(1) ?? [];
  const fallbackCandidateDate = fallbackDate.length === 3
    ? `${fallbackDate[0]}-${fallbackDate[1]}-${fallbackDate[2]}`
    : "";
  const fallbackStartDate = isIsoDate(fallbackCandidateDate) ? fallbackCandidateDate : slugStart.startDate;
  const fallbackCandidateTime = /(\d{1,2}:\d{2})/u.exec(value)?.[1]
    ? padTime(/(\d{1,2}:\d{2})/u.exec(value)?.[1] ?? "")
    : "";
  const fallbackStartTime = isClockTime(fallbackCandidateTime) ? fallbackCandidateTime : slugStart.startTime;
  if (!fallbackStartDate || !fallbackStartTime) {
    throw new CliError("The SUSTech Online talk has no valid source date and time.", "UPSTREAM_PROTOCOL_ERROR", 1, {
      slug,
    });
  }
  return {
    startDate: fallbackStartDate,
    startTime: fallbackStartTime,
    ...(fallbackStartDate && fallbackStartTime ? { startAt: `${fallbackStartDate}T${fallbackStartTime}:00+08:00` } : {}),
  };
}

function talkStartFromSlug(slug: string): { startDate: string; startTime: string; startAt?: string } {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})/u.exec(slug);
  if (!match) return { startDate: "", startTime: "" };
  const startDate = match[1];
  const startTime = `${match[2]}:${match[3]}`;
  if (!isIsoDate(startDate) || !isClockTime(startTime)) return { startDate: "", startTime: "" };
  return { startDate, startTime, startAt: `${startDate}T${startTime}:00+08:00` };
}

function isoDate(year: string, month: string, day: string): string {
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function padTime(value: string): string {
  return value.length === 4 ? `0${value}` : value;
}

function compareRankedTalks(left: RankedTalk, right: RankedTalk): number {
  return right.score - left.score
    || right.talk.date.localeCompare(left.talk.date)
    || right.talk.timeText.localeCompare(left.talk.timeText)
    || left.talk.title.localeCompare(right.talk.title, "zh-Hans-CN");
}

function applyLimit<T>(items: readonly T[], limit?: number): T[] {
  if (limit === undefined) return [...items];
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
    throw new CliError("Online talk limits must be integers from 1 to 200.", "USAGE", 2);
  }
  return items.slice(0, limit);
}

function normaliseDateRange(since?: string, until?: string): { since?: string; until?: string } {
  for (const [name, value] of [["--since", since], ["--until", until]] as const) {
    if (value !== undefined && !isIsoDate(value)) {
      throw new CliError(`${name} must be a real date using YYYY-MM-DD.`, "USAGE", 2);
    }
  }
  if (since && until && since > until) {
    throw new CliError("--since cannot be later than --until.", "USAGE", 2);
  }
  return { ...(since ? { since } : {}), ...(until ? { until } : {}) };
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function safePosterUrl(value: string | undefined, baseUrl: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, baseUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    const hostname = url.hostname.toLocaleLowerCase("en-US");
    const allowed = hostname === "gtimg.liziwl.cn"
      || hostname === "sustech.online"
      || hostname === "sustech.edu.cn"
      || hostname.endsWith(".sustech.edu.cn");
    return allowed ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function isClockTime(value: string): boolean {
  const match = /^(\d{2}):(\d{2})$/u.exec(value);
  return Boolean(match && Number(match[1]) <= 23 && Number(match[2]) <= 59);
}

function inDateRange(date: string, range: { since?: string; until?: string }): boolean {
  if (range.since && date < range.since) return false;
  if (range.until && date > range.until) return false;
  return true;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
