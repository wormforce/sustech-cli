import { fetchText } from "../core/http.js";
import type { FacultyIndexCard, FacultyProfile } from "./types.js";

const BASE_URL = "https://faculty.sustech.edu.cn";
const PROFILE_URL_TEMPLATE = `${BASE_URL}/?tagid={slug}&lang=zh&go=2`;
const EDU_HEADER = "教育经历";
const WORK_HEADER = "工作经历";
const INTEREST_HEADER = "目前研究兴趣";
const SECTION_RE = /<p>\s*<strong>\s*([^：:]+?)\s*[：:]\s*<\/strong>\s*<\/p>([\s\S]*?)(?=<p>\s*<strong>\s*[^<]+[：:]\s*<\/strong>\s*<\/p>|$)/g;
const CONTACT_PAIR_RE = /<p>\s*(联系地址|办公电话|电子邮箱|Email|Phone|Office|Tel|Fax)\s*<\/p>\s*<p[^>]*>\s*([^<]+?)\s*<\/p>/gi;
const FIELD_WEIGHT: Record<string, number> = {
  name: 10,
  title: 6,
  department: 4,
  researchInterests: 8,
  biography: 3,
  email: 1,
  education: 1,
  workHistory: 1,
  slug: 2,
};

export const DEPARTMENTS = [
  "数学系", "物理系", "化学系", "地球与空间科学系", "统计与数据科学系",
  "先进光源科学中心", "力学与航空航天工程系", "机械与能源工程系",
  "材料科学与工程系", "电子与电气工程系", "计算机科学与工程系",
  "海洋科学与工程系", "生物医学工程系", "环境科学与工程学院",
  "深港微电子学院", "自动化与智能制造学院", "精密光学工程中心",
  "生物系", "基础免疫与微生物学系", "系统生物学系", "化学生物学系",
  "神经生物学系", "医学院", "医学神经科学系", "药理学系", "生物化学系",
  "人类细胞生物和遗传学系", "公共卫生及应急管理学院", "商学院",
  "金融系", "信息系统与管理工程系", "人文科学中心",
  "社会科学中心", "高等教育研究中心", "语言中心", "艺术中心",
  "创新创业学院", "创新创意设计学院", "半导体学院（国家卓越工程师学院）",
  "马克思主义学院", "体育中心", "海洋高等研究院", "杰曼诺夫数学中心",
  "格拉布斯研究院", "量子研究院", "前沿与交叉科学研究院",
  "未来网络研究院", "前沿生物技术研究院", "纳米科学与应用研究院",
  "分析测试中心",
] as const;

export class FacultyClient {
  public listDepartments(): string[] {
    return [...DEPARTMENTS];
  }

  public async list(
    department: string,
    options: { full?: boolean; limit?: number } = {},
  ): Promise<FacultyProfile[]> {
    const cards = await this.listCards(department, options.limit);
    if (!options.full) return cards.map(promoteCard);
    const results = await Promise.allSettled(cards.map(async (card) => this.get(card.slug, { card })));
    return results
      .filter((result): result is PromiseFulfilledResult<FacultyProfile> => result.status === "fulfilled")
      .map((result) => result.value)
      .slice(0, options.limit);
  }

  public async get(slug: string, options: { card?: FacultyIndexCard } = {}): Promise<FacultyProfile> {
    const html = await fetchText(profileUrl(slug), {
      headers: facultyHeaders(),
    });
    return parseFacultyProfile(html, {
      slug,
      name: options.card?.name,
      title: options.card?.title,
      department: options.card?.department,
      photoUrl: options.card?.photoUrl,
      profileUrl: options.card?.profileUrl,
    });
  }

  public async search(
    query: string,
    options: { dept?: string; limit?: number } = {},
  ): Promise<FacultyProfile[]> {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];

    const limit = options.limit ?? 20;
    const candidates = options.dept
      ? await this.list(options.dept, { full: true })
      : await this.crossDepartmentCandidates(terms, limit * 3);

    return candidates
      .map((profile) => scoreProfile(profile, terms))
      .filter((profile): profile is FacultyProfile => profile !== undefined)
      .sort((left, right) => (right.relevanceScore ?? 0) - (left.relevanceScore ?? 0) || left.name.localeCompare(right.name))
      .slice(0, limit);
  }

  public async render(slug: string): Promise<string> {
    return facultyToMarkdown(await this.get(slug));
  }

  private async listCards(department: string, limit?: number): Promise<FacultyIndexCard[]> {
    const cards: FacultyIndexCard[] = [];
    for (let page = 1; page <= 99; page += 1) {
      const html = await this.fetchIndexPage(department, page);
      if (html.trim() === "0" || html.trim() === "") break;
      const batch = parseFacultyCards(html, department);
      if (batch.length === 0) break;
      cards.push(...batch);
      if (limit !== undefined && cards.length >= limit) return cards.slice(0, limit);
    }
    return cards;
  }

  private async fetchIndexPage(department: string, page: number): Promise<string> {
    const url = new URL("/index.php", BASE_URL);
    url.searchParams.set("ajax", "users");
    url.searchParams.set("page", String(page));
    url.searchParams.set("field", department);
    url.searchParams.set("lang", "zh");
    return fetchText(url.toString(), {
      headers: facultyHeaders(),
    });
  }

  private async crossDepartmentCandidates(terms: string[], cap: number): Promise<FacultyProfile[]> {
    const matches: FacultyProfile[] = [];
    for (const department of DEPARTMENTS) {
      let cards: FacultyIndexCard[];
      try {
        cards = await this.listCards(department);
      } catch {
        continue;
      }
      const matchedCards = cards.filter((card) => terms.some((term) => cardHaystack(card).includes(term)));
      if (matchedCards.length === 0) continue;
      const profiles = await Promise.allSettled(matchedCards.map(async (card) => this.get(card.slug, { card })));
      for (const profile of profiles) {
        if (profile.status !== "fulfilled") continue;
        matches.push(profile.value);
        if (matches.length >= cap) return matches;
      }
    }
    return matches;
  }
}

export function parseFacultyCards(html: string, defaultDepartment?: string): FacultyIndexCard[] {
  const cards: FacultyIndexCard[] = [];
  const anchorPattern = /<a\b[^>]*href="\/([^"\/?#]+)\/?"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorPattern)) {
    const slug = match[1]?.trim();
    const block = match[2] ?? "";
    if (!slug || !block.includes("teacher_iteam")) continue;
    const name = textContent(firstMatch(/<h2[^>]*>([\s\S]*?)<\/h2>/i, block));
    if (!name) continue;
    const title = textContent(firstMatch(/<h3[^>]*>([\s\S]*?)<\/h3>/i, block)) || undefined;
    const department = cleanDepartment(textContent(firstMatch(/<p[^>]*>([\s\S]*?)<\/p>/i, block)) || defaultDepartment || "");
    const style = firstMatch(/class="[^"]*\bteacher_tx\b[^"]*"[^>]*style="([^"]+)"/i, block);
    const photoUrl = absoluteUrl(extractCssUrl(style ?? "")) ?? undefined;
    cards.push({
      slug,
      name,
      ...(title ? { title } : {}),
      ...(department ? { department } : {}),
      ...(photoUrl ? { photoUrl } : {}),
      profileUrl: profileUrl(slug),
    });
  }
  return cards;
}

export function parseFacultyProfile(
  html: string,
  fallback: {
    slug: string;
    name?: string;
    title?: string;
    department?: string;
    photoUrl?: string;
    profileUrl?: string;
  },
): FacultyProfile {
  const name = textContent(firstMatch(/<h2[^>]*class="[^"]*\bt_name\b[^"]*"[^>]*>([\s\S]*?)<\/h2>/i, html)) || fallback.name || "";
  const title = textContent(firstMatch(/<em[^>]*class="[^"]*\bt_zw\b[^"]*"[^>]*>([\s\S]*?)<\/em>/i, html)) || fallback.title;
  const department = cleanDepartment(
    textContent(firstMatch(/<span[^>]*class="[^"]*\bt_xy\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i, html)) || fallback.department || "",
  ) || undefined;
  const biographyHtml = firstMatch(/<div[^>]*class="[^"]*\bt_descs\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i, html);
  const biography = normaliseSectionBody(biographyHtml ?? "");
  const jsjjHtml = firstMatch(/<div[^>]*class="[^"]*\bjsjj_ct\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i, html) ?? "";
  const education: string[] = [];
  const workHistory: string[] = [];
  const researchInterests: string[] = [];
  const extraSections: Record<string, string[]> = {};
  for (const match of jsjjHtml.matchAll(SECTION_RE)) {
    const header = textContent(match[1]);
    const lines = normaliseSectionLines(match[2] ?? "");
    if (lines.length === 0) continue;
    if (header === EDU_HEADER) education.push(...lines);
    else if (header === WORK_HEADER) workHistory.push(...lines);
    else if (header === INTEREST_HEADER) researchInterests.push(...lines);
    else extraSections[header] = lines;
  }

  let email: string | undefined;
  let phone: string | undefined;
  let office: string | undefined;
  for (const match of html.matchAll(CONTACT_PAIR_RE)) {
    const label = (match[1] ?? "").toLowerCase();
    const value = compactSpaces(match[2] ?? "");
    if (!value) continue;
    if (label.includes("电话") || label.includes("phone") || label.includes("tel")) phone = value.replace(/\s+/g, "");
    else if (label.includes("邮箱") || label.includes("email")) email = value;
    else if (label.includes("地址") || label.includes("office") || label.includes("fax")) office = value;
  }

  const backgroundStyle = firstMatch(/<dt[^>]*class="[^"]*\bbgimgdt\b[^"]*"[^>]*style="([^"]+)"/i, html);
  const imageSource = firstMatch(/<img[^>]*class="[^"]*\bopavatarimg\b[^"]*"[^>]*src="([^"]+)"/i, html);
  const photoUrl = absoluteUrl(extractCssUrl(backgroundStyle ?? "") ?? imageSource ?? fallback.photoUrl) ?? undefined;
  const researcherId = absoluteUrl(firstMatch(/<a[^>]*href="([^"]*researcherid\.com\/rid\/[^"]+)"/i, html) ?? "");
  const googleScholar = absoluteUrl(firstMatch(/<a[^>]*href="([^"]*scholar\.google\.com[^"]+)"/i, html) ?? "");

  return {
    slug: fallback.slug,
    name,
    ...(title ? { title } : {}),
    ...(department ? { department } : {}),
    ...(photoUrl ? { photoUrl } : {}),
    profileUrl: fallback.profileUrl ?? profileUrl(fallback.slug),
    source: "profile",
    ...(email ? { email } : {}),
    ...(phone ? { phone } : {}),
    ...(office ? { office } : {}),
    ...(biography ? { biography } : {}),
    education,
    workHistory,
    researchInterests,
    extraSections,
    links: {
      ...(researcherId ? { researcherId } : {}),
      ...(googleScholar ? { googleScholar } : {}),
    },
    matchedFields: [],
  };
}

export function promoteCard(card: FacultyIndexCard): FacultyProfile {
  return {
    ...card,
    source: "index",
    education: [],
    workHistory: [],
    researchInterests: [],
    extraSections: {},
    links: {},
    matchedFields: [],
  };
}

export function facultyToMarkdown(profile: FacultyProfile): string {
  const lines = [
    "---",
    `slug: ${profile.slug}`,
    `name: ${profile.name}`,
    ...(profile.title ? [`title: ${profile.title}`] : []),
    ...(profile.department ? [`department: ${profile.department}`] : []),
    ...(profile.email ? [`email: ${profile.email}`] : []),
    ...(profile.phone ? [`phone: ${profile.phone}`] : []),
    ...(profile.office ? [`office: ${profile.office}`] : []),
    ...(profile.photoUrl ? [`photo: ${profile.photoUrl}`] : []),
    `profile: ${profile.profileUrl}`,
    ...(profile.researchInterests.length > 0 ? [`tags: ${profile.researchInterests.join(", ")}`] : []),
    ...(profile.relevanceScore !== undefined ? [`relevance_score: ${profile.relevanceScore}`] : []),
    ...(profile.matchedFields.length > 0 ? [`matched_fields: ${profile.matchedFields.join(", ")}`] : []),
    "---",
    "",
    `# ${profile.name}`,
    ...(profile.title ? [`**${profile.title}**${profile.department ? ` — ${profile.department}` : ""}`] : []),
    "",
    ...(profile.biography ? ["## Biography", profile.biography, ""] : []),
    ...(profile.education.length > 0 ? ["## Education", ...profile.education.map((entry) => `- ${entry}`), ""] : []),
    ...(profile.workHistory.length > 0 ? ["## Work History", ...profile.workHistory.map((entry) => `- ${entry}`), ""] : []),
    ...(profile.researchInterests.length > 0 ? ["## Research Interests", ...profile.researchInterests.map((entry) => `- ${entry}`), ""] : []),
  ];
  return lines.join("\n").trim();
}

function scoreProfile(profile: FacultyProfile, terms: string[]): FacultyProfile | undefined {
  let score = 0;
  const matchedFields: string[] = [];
  for (const [field, weight] of Object.entries(FIELD_WEIGHT)) {
    const haystack = scoreHaystack(profile, field);
    if (!haystack) continue;
    let hits = 0;
    for (const term of terms) hits += countMatches(haystack, term);
    if (hits === 0) continue;
    score += hits * weight;
    matchedFields.push(field);
  }
  if (score === 0) return undefined;
  return { ...profile, relevanceScore: score, matchedFields };
}

function scoreHaystack(profile: FacultyProfile, field: string): string {
  switch (field) {
    case "name":
      return profile.name.toLowerCase();
    case "title":
      return (profile.title ?? "").toLowerCase();
    case "department":
      return (profile.department ?? "").toLowerCase();
    case "researchInterests":
      return profile.researchInterests.join(" ").toLowerCase();
    case "biography":
      return (profile.biography ?? "").toLowerCase();
    case "email":
      return (profile.email ?? "").toLowerCase();
    case "education":
      return profile.education.join(" ").toLowerCase();
    case "workHistory":
      return profile.workHistory.join(" ").toLowerCase();
    case "slug":
      return profile.slug.toLowerCase();
    default:
      return "";
  }
}

function cardHaystack(card: FacultyIndexCard): string {
  return [card.slug, card.name, card.title ?? "", card.department ?? ""].join(" ").toLowerCase();
}

function profileUrl(slug: string): string {
  return PROFILE_URL_TEMPLATE.replace("{slug}", encodeURIComponent(slug));
}

function facultyHeaders(): Record<string, string> {
  return {
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
    cookie: "qtrans_front_language=zh",
  };
}

function absoluteUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value, BASE_URL).toString();
  } catch {
    return undefined;
  }
}

function extractCssUrl(style: string): string | undefined {
  const match = /url\(([^)]+)\)/i.exec(style);
  return match?.[1]?.trim().replace(/^['"]|['"]$/g, "");
}

function firstMatch(pattern: RegExp, value: string): string | undefined {
  const match = pattern.exec(value);
  return match?.[1];
}

function textContent(value: string | undefined): string {
  return compactSpaces(stripHtml(value ?? ""));
}

function cleanDepartment(value: string): string {
  const compact = compactSpaces(
    value
      .replace(/课题组网站/g, "")
      .replace(/^[|｜]+\s*/g, "")
      .replace(/\s*[|｜]\s*/g, " "),
  );
  const known = DEPARTMENTS.find((department) => compact.includes(department));
  return known ?? compact;
}

function normaliseSectionBody(html: string): string {
  const text = stripHtml(html)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.startsWith(EDU_HEADER) ? "" : text;
}

function normaliseSectionLines(html: string): string[] {
  return stripHtml(html)
    .split("\n")
    .map(compactSpaces)
    .filter(Boolean);
}

function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function compactSpaces(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function countMatches(haystack: string, term: string): number {
  if (!term) return 0;
  let count = 0;
  let index = 0;
  while (true) {
    const next = haystack.indexOf(term, index);
    if (next === -1) return count;
    count += 1;
    index = next + term.length;
  }
}
