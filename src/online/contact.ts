import { CliError } from "../core/errors.js";
import { collapseWhitespace } from "../services/base.js";
import {
  buildOnlineProvenance,
  extractEmails,
  extractMarkdownLink,
  extractPhones,
  fetchOnlineMarkdownDocument,
  formatOnlineAdvisories,
  makeOnlineId,
  ONLINE_CONTACT_REPO_PATH,
  ONLINE_CONTACT_SITE_PATH,
  onlineSiteUrl,
  scoreSearchMatch,
  stripMarkdown,
  uniqueStrings,
  type OnlineFetchOptions,
} from "./shared.js";
import type { OnlineContactRecord } from "./types.js";

export interface OnlineContactQueryOptions extends OnlineFetchOptions {
  limit?: number;
}

interface RankedContact {
  score: number;
  record: OnlineContactRecord;
}

export async function listOnlineContacts(options: OnlineContactQueryOptions = {}): Promise<OnlineContactRecord[]> {
  const document = await fetchOnlineMarkdownDocument(ONLINE_CONTACT_REPO_PATH, ONLINE_CONTACT_SITE_PATH, options);
  const contacts = parseOnlineContactsMarkdown(document.markdown, {
    fetchedAt: document.fetchedAt,
    sourceUpdatedAt: document.pageUpdatedAt,
    sourceMetadataAvailable: document.pageMetadataAvailable,
    staleAfterDays: options.staleAfterDays,
  });
  return applyLimit(contacts, options.limit);
}

export async function searchOnlineContacts(query: string, options: OnlineContactQueryOptions = {}): Promise<OnlineContactRecord[]> {
  const needle = query.trim();
  if (!needle) throw new CliError("A search query is required.", "USAGE", 2);
  const contacts = await listOnlineContacts({ ...options, limit: undefined });
  const ranked = contacts
    .map((record) => ({
      record,
      score: scoreSearchMatch(needle, [
        { value: record.id, weight: 8 },
        { value: record.name, weight: 10 },
        { value: record.category, weight: 5 },
        { value: record.address, weight: 4 },
        { value: record.phones.join(" "), weight: 4 },
        { value: record.emails.join(" "), weight: 4 },
        { value: record.notes.join(" "), weight: 2 },
      ]),
    }))
    .filter((entry) => entry.score > 0)
    .sort(compareRankedContacts)
    .map((entry) => entry.record);
  return applyLimit(ranked, options.limit);
}

export async function getOnlineContact(identifier: string, options: OnlineFetchOptions = {}): Promise<OnlineContactRecord> {
  const needle = identifier.trim();
  if (!needle) throw new CliError("A contact name or id is required.", "USAGE", 2);
  const contacts = await listOnlineContacts(options);
  const exact = contacts.find((record) => record.id === needle || record.name === needle);
  if (exact) return exact;
  throw new CliError("No public institutional contact matched that exact id or name.", "ONLINE_CONTACT_NOT_FOUND", 1, {
    query: needle,
  });
}

export function parseOnlineContactsMarkdown(
  markdown: string,
  options: {
    fetchedAt: string;
    sourceUpdatedAt?: string;
    sourceMetadataAvailable?: boolean;
    staleAfterDays?: number;
  },
): OnlineContactRecord[] {
  const sourceUrl = onlineSiteUrl(ONLINE_CONTACT_SITE_PATH);
  const provenance = buildOnlineProvenance(
    sourceUrl,
    ONLINE_CONTACT_REPO_PATH,
    options.fetchedAt,
    options.sourceUpdatedAt,
    options.staleAfterDays,
    { aiProcessed: false, sourceMetadataAvailable: options.sourceMetadataAvailable },
  );
  const officeHours = extractGeneralOfficeHours(markdown);
  const records = [
    ...parseGeneralSection(markdown, provenance),
    ...parseTeachingSection(sectionBody(markdown, "教学"), officeHours, provenance),
    ...parseLogisticsTable(sectionBody(markdown, "物流、餐饮、康体、后勤"), provenance),
    ...parseSimpleBullets(sectionBody(markdown, "行政"), "行政", "administration", provenance),
    ...parseSimpleBullets(sectionBody(markdown, "更多官方部门的联系方式"), "官方链接", "official-links", provenance),
  ];
  return records.sort((left, right) => left.category.localeCompare(right.category, "zh-Hans-CN") || left.name.localeCompare(right.name, "zh-Hans-CN"));
}

export function contactSearchSnippet(record: OnlineContactRecord): string {
  return uniqueStrings([
    record.address ?? "",
    record.phones.join(" "),
    record.emails.join(" "),
    record.hours?.join("; ") ?? "",
    record.notes.join(" "),
    formatOnlineAdvisories(record.provenance.advisories),
  ]).join(" · ");
}

function parseGeneralSection(markdown: string, provenance: OnlineContactRecord["provenance"]): OnlineContactRecord[] {
  const body = betweenHeadings(markdown, "## 电话与邮件", "### 教学");
  if (!body) return [];
  const hotlineMatch = /\*\*24h 校内服务热线[^:：]*[:：]\s*([0-9-]+)\*\*/u.exec(body);
  if (!hotlineMatch) return [];
  const notes = uniqueStrings([
    "物业热线，报修用，查号用",
    /\*\*座机默认区号([0-9]+)\*\*/u.exec(body)?.[1] ? `座机默认区号 ${/\*\*座机默认区号([0-9]+)\*\*/u.exec(body)?.[1]}` : "",
  ]);
  return [{
    kind: "contact",
    id: makeOnlineId("general", "24h 校内服务热线"),
    name: "24h 校内服务热线",
    category: "通用服务",
    categoryKey: "general",
    phones: [hotlineMatch[1]],
    emails: [],
    hours: ["24小时"],
    notes,
    provenance,
  }];
}

function parseTeachingSection(
  section: string,
  defaultHours: readonly string[],
  provenance: OnlineContactRecord["provenance"],
): OnlineContactRecord[] {
  return bulletBlocks(section)
    .map((block) => parseStructuredBullet(block, "教学", "teaching", provenance, defaultHours))
    .filter((record): record is OnlineContactRecord => record !== undefined);
}

function parseLogisticsTable(section: string, provenance: OnlineContactRecord["provenance"]): OnlineContactRecord[] {
  const table = markdownTable(section);
  if (!table) return [];
  return table.rows
    .map<OnlineContactRecord | undefined>(([name, address, phone, hours]) => {
      const cleanName = collapseWhitespace(name);
      if (!cleanName || /(?:餐饮|食堂|美食)/u.test(cleanName)) return undefined;
      return {
        kind: "contact" as const,
        id: makeOnlineId("logistics", cleanName),
        name: cleanName,
        category: "后勤服务",
        categoryKey: "logistics",
        phones: uniqueStrings(phone ? [phone] : []),
        emails: [] as string[],
        ...(address ? { address: collapseWhitespace(address) } : {}),
        ...(hours ? { hours: [collapseWhitespace(hours)] } : {}),
        notes: [] as string[],
        provenance,
      };
    })
    .filter((record): record is OnlineContactRecord => record !== undefined);
}

function parseSimpleBullets(
  section: string,
  category: string,
  categoryKey: string,
  provenance: OnlineContactRecord["provenance"],
): OnlineContactRecord[] {
  return bulletBlocks(section)
    .map((block) => parseStructuredBullet(block, category, categoryKey, provenance))
    .filter((record): record is OnlineContactRecord => record !== undefined);
}

function parseStructuredBullet(
  block: string,
  category: string,
  categoryKey: string,
  provenance: OnlineContactRecord["provenance"],
  defaultHours: readonly string[] = [],
): OnlineContactRecord | undefined {
  if (!block.trim() || block.includes("./professor-emails")) return undefined;
  const lines = block.split("\n").map((line) => line.trimEnd());
  const normalizedLines = lines.map(stripLeadingBullet).map(collapseWhitespace).filter(Boolean);
  if (normalizedLines.length === 0) return undefined;
  const firstLine = normalizedLines[0];
  const link = extractMarkdownLink(firstLine);
  const rawName = link ? link.text : firstLine.split(/[：:]/u, 1)[0] ?? firstLine;
  const name = collapseWhitespace(rawName.split("|")[0] ?? rawName);
  const phones = extractPhones(block);
  const emails = extractEmails(block);
  const address = firstAddress(normalizedLines.slice(1));
  const hours = normalizedLines
    .filter((line) => /^[^：:]+[：:]/u.test(line) && /(?:工作时间|服务时间)/u.test(line))
    .map((line) => collapseWhitespace(line.split(/[：:]/u).slice(1).join(":")));
  const resolvedHours = hours.length > 0 ? hours : [...defaultHours];
  const websiteUrl = safeInstitutionalUrl(link?.url);
  if (link && !websiteUrl) return undefined;
  const notes = normalizedLines
    .slice(1)
    .map((line) => line.replace(/^(?:电话|公共邮箱[^：:]*|学生学习服务邮箱|邮箱|办公地点|地址|地点|选课咨询电话|工作时间|服务时间)[：:]\s*/u, "").trim())
    .filter((line) => Boolean(line))
    .filter((line) => !phones.includes(line))
    .filter((line) => !emails.includes(line))
    .filter((line) => line !== address)
    .filter((line) => !resolvedHours.includes(line));
  return {
    kind: "contact",
    id: makeOnlineId(categoryKey, name),
    name,
    category,
    categoryKey,
    phones,
    emails,
    ...(address ? { address } : {}),
    ...(resolvedHours.length > 0 ? { hours: resolvedHours } : {}),
    ...(websiteUrl ? { websiteUrl } : {}),
    notes: uniqueStrings(notes),
    provenance,
  };
}

function sectionBody(markdown: string, title: string): string {
  const match = new RegExp(`^###\\s+${escapeRegExp(title)}\\s*\\n([\\s\\S]*?)(?=^###\\s+|^##\\s+|(?![\\s\\S]))`, "mu").exec(markdown);
  return match?.[1] ?? "";
}

function betweenHeadings(markdown: string, startHeading: string, endHeading: string): string {
  const start = markdown.indexOf(startHeading);
  if (start < 0) return "";
  const from = start + startHeading.length;
  const end = markdown.indexOf(endHeading, from);
  return markdown.slice(from, end >= 0 ? end : undefined);
}

function bulletBlocks(section: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  for (const line of section.split("\n")) {
    if (/^-\s+/u.test(line)) {
      if (current.length > 0) blocks.push(current.join("\n"));
      current = [line];
      continue;
    }
    if (current.length > 0) current.push(line);
  }
  if (current.length > 0) blocks.push(current.join("\n"));
  return blocks;
}

function markdownTable(section: string): { headers: string[]; rows: string[][] } | undefined {
  const lines = section.split("\n").map((line) => line.trim()).filter((line) => line.startsWith("|"));
  if (lines.length < 3) return undefined;
  const headers = splitTableRow(lines[0]);
  const rows = lines.slice(2).map(splitTableRow).filter((row) => row.length === headers.length);
  return { headers, rows };
}

function splitTableRow(line: string): string[] {
  return line
    .replace(/^\|/u, "")
    .replace(/\|$/u, "")
    .split("|")
    .map((entry) => collapseWhitespace(entry));
}

function firstAddress(lines: readonly string[]): string | undefined {
  for (const line of lines) {
    if (/^(?:办公地点|地址|地点)[：:]/u.test(line)) {
      return collapseWhitespace(line.split(/[：:]/u).slice(1).join(":"));
    }
  }
  return lines.find((line) =>
    line
    && !/[：:]/u.test(line)
    && extractPhones(line).length === 0
    && extractEmails(line).length === 0,
  );
}

function extractGeneralOfficeHours(body: string): string[] {
  const lines = body.split("\n");
  const start = lines.findIndex((line) => line.includes("**一般办公时间**"));
  if (start < 0) return [];
  const result: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = collapseWhitespace(stripLeadingBullet(lines[index]));
    if (!line) {
      if (result.length > 0) break;
      continue;
    }
    if (!/^(?:周|上午|下午)/u.test(line)) break;
    result.push(line);
  }
  return result;
}

function applyLimit<T>(items: readonly T[], limit?: number): T[] {
  if (limit === undefined) return [...items];
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
    throw new CliError("Online contact limits must be integers from 1 to 200.", "USAGE", 2);
  }
  return items.slice(0, limit);
}

function safeInstitutionalUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, "https://sustech.online");
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    return isSustechHostname(url.hostname) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function isSustechHostname(hostname: string): boolean {
  const normalized = hostname.toLocaleLowerCase("en-US");
  return normalized === "sustech.online"
    || normalized === "sustech.edu.cn"
    || normalized.endsWith(".sustech.edu.cn");
}

function compareRankedContacts(left: RankedContact, right: RankedContact): number {
  return right.score - left.score
    || left.record.category.localeCompare(right.record.category, "zh-Hans-CN")
    || left.record.name.localeCompare(right.record.name, "zh-Hans-CN");
}

function stripLeadingBullet(value: string): string {
  return value.replace(/^\s*[-*+]\s+/u, "").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
