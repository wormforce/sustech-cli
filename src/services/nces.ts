import {
  arrayValue,
  cleanText,
  createFetchAdapter,
  fetchJson,
  numberValue,
  recordValue,
  requestUrl,
  stringValue,
} from "./base.js";
import type { ServiceAdapter, ServiceStatus } from "./base.js";

export const NCES_BASE = "https://ncesnext.com";

export const NCES_STATUS: ServiceStatus = {
  service: "nces",
  availability: "implemented",
  auth: "none",
  campusNetwork: false,
  browser: false,
  summary: "NCES exposes public JSON APIs for course search, browse, detail, and reviews.",
  notes: [
    "The API is public but rate-limited; callers should avoid aggressive polling.",
  ],
  endpoints: [
    "/api/v1/search",
    "/api/v1/course",
    "/api/v1/course/{id}",
    "/api/v1/course/{id}/reviews",
  ],
};

export interface NcesDimension {
  label: string;
  pct: number;
}

export interface NcesCourseSummary {
  ncesId: number;
  code: string;
  name: string;
  teacher: string;
  semester: string;
  semesters: string[];
  rating: number;
  reviewCount: number;
  difficulty: NcesDimension;
  workload: NcesDimension;
  grading: NcesDimension;
  takeaways: NcesDimension;
  directUrl: string;
}

export interface NcesReview {
  id: number;
  author: string;
  term: string;
  rating: number;
  upvotes: number;
  content: string;
  difficulty?: string;
  workload?: string;
  grading?: string;
  takeaways?: string;
}

export interface NcesCourseDetail extends NcesCourseSummary {
  department: string;
  reviews: NcesReview[];
}

const DIMENSION_LABELS = {
  difficulty: [
    [33, "Hard"],
    [67, "Average"],
    [100, "Easy"],
  ],
  workload: [
    [33, "Heavy"],
    [67, "Average"],
    [100, "Light"],
  ],
  grading: [
    [33, "Poor"],
    [67, "Average"],
    [100, "Excellent"],
  ],
  takeaways: [
    [33, "Low"],
    [67, "Average"],
    [100, "High"],
  ],
} as const;

export async function browseNces(
  options: { page?: number; perPage?: number; sort?: "rating" | "reviews" | "name"; adapter?: ServiceAdapter } = {},
): Promise<{ items: NcesCourseSummary[]; total: number; page: number; perPage: number; pages: number }> {
  const adapter = options.adapter ?? createFetchAdapter();
  const page = options.page ?? 1;
  const perPage = Math.max(1, Math.min(options.perPage ?? 30, 50));
  const raw = await fetchJson<unknown>(adapter, requestUrl(NCES_BASE, "/api/v1/course", { page, per_page: perPage }));
  const record = recordValue(raw);
  const items = arrayValue(record.items).map((item) => normaliseNcesCourse(item));
  items.sort(compareNcesCourses(options.sort ?? "rating"));
  return {
    items,
    total: numberValue(record.total),
    page,
    perPage,
    pages: numberValue(record.pages),
  };
}

export async function searchNces(
  query: string,
  options: { adapter?: ServiceAdapter } = {},
): Promise<{ items: NcesCourseSummary[]; total: number; sampleReviews: NcesReview[] }> {
  const adapter = options.adapter ?? createFetchAdapter();
  const raw = await fetchJson<unknown>(adapter, requestUrl(NCES_BASE, "/api/v1/search", { q: query }));
  const record = recordValue(raw);
  const courses = recordValue(record.courses);
  const reviews = recordValue(record.reviews);
  return {
    items: arrayValue(courses.items).map((item) => normaliseNcesCourse(item)),
    total: numberValue(courses.total),
    sampleReviews: arrayValue(reviews.items).map((item) => normaliseNcesReview(item)),
  };
}

export async function getNcesCourseDetail(
  id: number,
  options: { adapter?: ServiceAdapter } = {},
): Promise<NcesCourseDetail | null> {
  const adapter = options.adapter ?? createFetchAdapter();
  const courseResponse = await adapter.fetch(requestUrl(NCES_BASE, `/api/v1/course/${id}`));
  if (courseResponse.status === 404) return null;
  const course = recordValue(await courseResponse.json());
  const reviewResponse = await fetchJson<unknown>(adapter, requestUrl(NCES_BASE, `/api/v1/course/${id}/reviews`));
  const rate = recordValue(course.rate);
  const base = normaliseNcesCourse({
    id,
    course_code: course.course_code ?? course.courseries,
    name: course.name,
    teacher_names: course.teacher_names ?? arrayValue(course.teachers).map((item) => stringValue(recordValue(item).name)).join(", "),
    term_ids: course.term_ids ?? course.review_term_list,
    rate_average: rate.rate_average ?? rate.average_rate,
    review_count: rate.review_count,
    difficulty_score: rate.difficulty_score,
    homework_score: rate.homework_score,
    grading_score: rate.grading_score,
    gain_score: rate.gain_score,
  });
  return {
    ...base,
    department: stringValue(course.dept),
    reviews: arrayValue(recordValue(reviewResponse).items).map((item) => normaliseNcesReview(item)),
  };
}

export function normaliseNcesCourse(raw: unknown): NcesCourseSummary {
  const record = recordValue(raw);
  const termIds = arrayValue(record.term_ids).map((item) => stringValue(item)).filter(Boolean);
  const code = stringValue(record.course_code ?? record.courseries).toUpperCase();
  return {
    ncesId: numberValue(record.id),
    code,
    name: stringValue(record.name),
    teacher: stringValue(record.teacher_names),
    semester: termIdToDisplay(termIds[0] ?? ""),
    semesters: termIds.map((termId) => termIdToDisplay(termId)),
    rating: numberValue(record.rate_average),
    reviewCount: numberValue(record.review_count),
    difficulty: scoreToLabel("difficulty", record.difficulty_score),
    workload: scoreToLabel("workload", record.homework_score),
    grading: scoreToLabel("grading", record.grading_score),
    takeaways: scoreToLabel("takeaways", record.gain_score),
    directUrl: `${NCES_BASE}/course/${numberValue(record.id)}/`,
  };
}

export function normaliseNcesReview(raw: unknown): NcesReview {
  const record = recordValue(raw);
  return {
    id: numberValue(record.id),
    author: stringValue(record.author ?? record.user_name),
    term: termIdToDisplay(stringValue(record.term)),
    rating: numberValue(record.rate),
    upvotes: numberValue(record.upvote_count),
    content: cleanText(record.content),
    ...(record.difficulty_display ? { difficulty: stringValue(record.difficulty_display) } : {}),
    ...(record.homework_display ? { workload: stringValue(record.homework_display) } : {}),
    ...(record.grading_display ? { grading: stringValue(record.grading_display) } : {}),
    ...(record.gain_display ? { takeaways: stringValue(record.gain_display) } : {}),
  };
}

export function scoreToLabel(
  dimension: keyof typeof DIMENSION_LABELS,
  value: unknown,
): NcesDimension {
  const pct = Math.max(0, Math.min(100, numberValue(value)));
  for (const [threshold, label] of DIMENSION_LABELS[dimension]) {
    if (pct <= threshold) return { label, pct };
  }
  return { label: DIMENSION_LABELS[dimension][DIMENSION_LABELS[dimension].length - 1][1], pct };
}

export function termIdToDisplay(termId: string): string {
  if (!termId || termId.length < 5) return termId;
  const season = { "1": "秋", "2": "春", "3": "夏" }[termId[4]] ?? "";
  return `${termId.slice(0, 4)}${season}`;
}

export function tisToNcesTerm(xn: string, xq: string): string {
  return xq === "1" ? `${xn.slice(0, 4)}1` : `${xn.slice(5, 9)}${xq}`;
}

export function pickBestNcesSection(
  courses: readonly NcesCourseSummary[],
  tisTeachers: readonly string[],
  termId = "",
): NcesCourseSummary | undefined {
  if (courses.length === 0) return undefined;
  let best: NcesCourseSummary | undefined;
  let bestScore: [number, number, number] = [-1, -1, -1];
  for (const course of courses) {
    const ncesTeachers = splitTeachers(course.teacher);
    const matched = tisTeachers.length === 0
      ? 0
      : tisTeachers.filter((teacher) => ncesTeachers.some((candidate) => candidate === teacher || candidate.includes(teacher) || teacher.includes(candidate))).length;
    const subset = tisTeachers.length === 0 || ncesTeachers.every((candidate) => tisTeachers.some((teacher) => teacher === candidate || teacher.includes(candidate) || candidate.includes(teacher)));
    const termMatch = termId && course.semesters.includes(termIdToDisplay(termId)) ? 1 : 0;
    const score: [number, number, number] = [matched, subset ? 1 : 0, termMatch];
    if (!best || compareTuple(score, bestScore) > 0) {
      best = course;
      bestScore = score;
    }
  }
  return best ?? courses[0];
}

function splitTeachers(value: string): string[] {
  return value.split(/[,，、]/).map((item) => item.trim()).filter(Boolean);
}

function compareTuple(a: [number, number, number], b: [number, number, number]): number {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  return a[2] - b[2];
}

function compareNcesCourses(sort: "rating" | "reviews" | "name") {
  return (left: NcesCourseSummary, right: NcesCourseSummary): number => {
    if (sort === "name") return left.name.localeCompare(right.name, "zh-Hans-CN");
    if (sort === "reviews") return right.reviewCount - left.reviewCount;
    return right.rating - left.rating;
  };
}
