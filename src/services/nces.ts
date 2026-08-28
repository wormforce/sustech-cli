import {
  arrayValue,
  cleanText,
  createFetchAdapter,
  fetchJson,
  numberValue,
  parseJson,
  recordValue,
  requestUrl,
  sampleText,
  ServiceError,
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

export interface NcesCourseLookup {
  code?: string;
  name?: string;
  teachers?: readonly string[];
}

export interface NcesResolvedCourse {
  query: string;
  queryKind: "code" | "name";
  termId?: string;
  searchTotal: number;
  items: NcesCourseSummary[];
  matchedCandidates: NcesCourseSummary[];
  picked?: NcesCourseSummary;
  detail?: NcesCourseDetail | null;
  status: "matched" | "not_found" | "ambiguous" | "insufficient_query" | "error";
  confidence: "none" | "low" | "medium" | "high";
  signals: {
    exactCode: boolean;
    baseCode: boolean;
    name: boolean;
    teacherMatches: string[];
    termMatched: boolean;
  };
  notes: string[];
  errorMessage?: string;
}

export interface NcesCourseLookupRequest extends NcesCourseLookup {
  key: string;
}

export interface NcesCourseLookupBatch {
  items: Record<string, NcesResolvedCourse>;
  partial: boolean;
  failures: Array<{ key: string; message: string }>;
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
  const courseResponse = await fetchOptionalJson(adapter, requestUrl(NCES_BASE, `/api/v1/course/${id}`));
  if (courseResponse === null) return null;
  const course = recordValue(courseResponse);
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

export async function resolveNcesCourseLookup(
  lookup: NcesCourseLookup,
  options: { termId?: string; includeDetail?: boolean; adapter?: ServiceAdapter } = {},
): Promise<NcesResolvedCourse> {
  const code = normaliseLookupCode(lookup.code);
  const name = cleanLookupText(lookup.name);
  const query = code || name;
  const queryKind: NcesResolvedCourse["queryKind"] = code ? "code" : "name";
  if (!query) {
    return {
      query: "",
      queryKind,
      ...(options.termId ? { termId: options.termId } : {}),
      searchTotal: 0,
      items: [],
      matchedCandidates: [],
      status: "insufficient_query",
      confidence: "none",
      signals: {
        exactCode: false,
        baseCode: false,
        name: false,
        teacherMatches: [],
        termMatched: false,
      },
      notes: ["No usable NCES lookup query was available."],
    };
  }

  const search = await searchNces(query, options.adapter ? { adapter: options.adapter } : {});
  const matchedCandidates = sortLookupCandidates(
    search.items.filter((item) => lookupMatchesCandidate({ code, name }, item)),
    lookup.teachers ?? [],
    options.termId,
    { code, name },
  );
  if (matchedCandidates.length === 0) {
    return {
      query,
      queryKind,
      ...(options.termId ? { termId: options.termId } : {}),
      searchTotal: search.total,
      items: search.items,
      matchedCandidates,
      status: "not_found",
      confidence: "none",
      signals: {
        exactCode: false,
        baseCode: false,
        name: false,
        teacherMatches: [],
        termMatched: false,
      },
      notes: ["NCES search returned results, but none matched the course code or exact course name."],
    };
  }

  const picked = matchedCandidates[0];
  const signals = picked
    ? candidateSignals(picked, { code, name, teachers: lookup.teachers ?? [] }, options.termId)
    : {
      exactCode: false,
      baseCode: false,
      name: false,
      teacherMatches: [],
      termMatched: false,
    };
  const confidence = resolveLookupConfidence(signals, matchedCandidates.length);
  const status = confidence === "low" && matchedCandidates.length > 1 ? "ambiguous" : "matched";
  const detail = options.includeDetail && picked
    ? await getNcesCourseDetail(picked.ncesId, options.adapter ? { adapter: options.adapter } : {})
    : undefined;

  return {
    query,
    queryKind,
    ...(options.termId ? { termId: options.termId } : {}),
    searchTotal: search.total,
    items: search.items,
    matchedCandidates,
    ...(picked ? { picked } : {}),
    ...(detail !== undefined ? { detail } : {}),
    status,
    confidence,
    signals,
    notes: lookupNotes(status, matchedCandidates.length, signals),
  };
}

export async function resolveNcesCourseLookups(
  lookups: readonly NcesCourseLookupRequest[],
  options: { termId?: string; includeDetail?: boolean; adapter?: ServiceAdapter } = {},
): Promise<NcesCourseLookupBatch> {
  const items: Record<string, NcesResolvedCourse> = {};
  const failures: Array<{ key: string; message: string }> = [];

  for (const lookup of lookups) {
    try {
      items[lookup.key] = await resolveNcesCourseLookup(lookup, options);
    } catch (error) {
      const message = safeErrorMessage(error);
      failures.push({ key: lookup.key, message });
      items[lookup.key] = {
        query: normaliseLookupCode(lookup.code) || cleanLookupText(lookup.name),
        queryKind: normaliseLookupCode(lookup.code) ? "code" : "name",
        ...(options.termId ? { termId: options.termId } : {}),
        searchTotal: 0,
        items: [],
        matchedCandidates: [],
        status: "error",
        confidence: "none",
        signals: {
          exactCode: false,
          baseCode: false,
          name: false,
          teacherMatches: [],
          termMatched: false,
        },
        notes: ["NCES lookup failed for this course; the error was isolated to this item."],
        errorMessage: message,
      };
    }
  }

  return {
    items,
    partial: failures.length > 0,
    failures,
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

function cleanLookupText(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function normaliseLookupCode(value: string | undefined): string {
  return cleanLookupText(value).toUpperCase();
}

function lookupMatchesCandidate(
  lookup: { code: string; name: string },
  candidate: NcesCourseSummary,
): boolean {
  const candidateCode = normaliseCode(candidate.code);
  const lookupCode = normaliseCode(lookup.code);
  const candidateName = normaliseName(candidate.name);
  const lookupName = normaliseName(lookup.name);
  return Boolean(
    (lookupCode && (candidateCode === lookupCode || baseCodeMatches(candidateCode, lookupCode)))
    || (lookupName && candidateName === lookupName),
  );
}

function sortLookupCandidates(
  items: readonly NcesCourseSummary[],
  teachers: readonly string[],
  termId: string | undefined,
  lookup: { code: string; name: string },
): NcesCourseSummary[] {
  return [...items].sort((left, right) => {
    const leftSignals = candidateSignals(left, { ...lookup, teachers }, termId);
    const rightSignals = candidateSignals(right, { ...lookup, teachers }, termId);
    return compareLookupCandidate(left, leftSignals, right, rightSignals);
  });
}

function compareLookupCandidate(
  left: NcesCourseSummary,
  leftSignals: NcesResolvedCourse["signals"],
  right: NcesCourseSummary,
  rightSignals: NcesResolvedCourse["signals"],
): number {
  const numericComparisons: Array<[number, number]> = [
    [leftSignals.exactCode ? 1 : 0, rightSignals.exactCode ? 1 : 0],
    [leftSignals.baseCode ? 1 : 0, rightSignals.baseCode ? 1 : 0],
    [leftSignals.name ? 1 : 0, rightSignals.name ? 1 : 0],
    [leftSignals.teacherMatches.length, rightSignals.teacherMatches.length],
    [leftSignals.termMatched ? 1 : 0, rightSignals.termMatched ? 1 : 0],
    [left.reviewCount, right.reviewCount],
    [left.rating, right.rating],
  ];
  for (const [leftValue, rightValue] of numericComparisons) {
    if (leftValue !== rightValue) return rightValue - leftValue;
  }
  if (left.ncesId !== right.ncesId) return left.ncesId - right.ncesId;
  return left.directUrl.localeCompare(right.directUrl, "zh-Hans-CN");
}

function candidateSignals(
  candidate: NcesCourseSummary,
  lookup: { code: string; name: string; teachers: readonly string[] },
  termId: string | undefined,
): NcesResolvedCourse["signals"] {
  const candidateCode = normaliseCode(candidate.code);
  const lookupCode = normaliseCode(lookup.code);
  const candidateTeachers = splitTeachers(candidate.teacher);
  return {
    exactCode: Boolean(lookupCode && candidateCode === lookupCode),
    baseCode: Boolean(lookupCode && baseCodeMatches(candidateCode, lookupCode)),
    name: Boolean(lookup.name && normaliseName(candidate.name) === normaliseName(lookup.name)),
    teacherMatches: lookup.teachers.filter((teacher) =>
      candidateTeachers.some((candidateTeacher) =>
        teacher === candidateTeacher || teacher.includes(candidateTeacher) || candidateTeacher.includes(teacher)
      )
    ),
    termMatched: Boolean(termId && candidate.semesters.includes(termIdToDisplay(termId))),
  };
}

function resolveLookupConfidence(
  signals: NcesResolvedCourse["signals"],
  matchedCount: number,
): NcesResolvedCourse["confidence"] {
  if (!signals.exactCode && !signals.baseCode && !signals.name) return "none";
  if (signals.exactCode && (signals.teacherMatches.length > 0 || signals.termMatched || matchedCount === 1)) return "high";
  if (
    (signals.exactCode && matchedCount <= 3)
    || (signals.baseCode && signals.teacherMatches.length > 0)
    || (signals.name && signals.teacherMatches.length > 0)
  ) return "medium";
  return "low";
}

function lookupNotes(
  status: NcesResolvedCourse["status"],
  matchedCount: number,
  signals: NcesResolvedCourse["signals"],
): string[] {
  const notes: string[] = [];
  if (status === "ambiguous") {
    notes.push(`Multiple NCES sections (${matchedCount}) matched; verify the teacher and semester before relying on the score.`);
  }
  if (signals.teacherMatches.length === 0) {
    notes.push("No teacher name matched exactly; the lookup fell back to course code/name only.");
  }
  if (!signals.termMatched) {
    notes.push("The selected NCES entry was not confirmed against the target semester.");
  }
  return notes;
}

function normaliseCode(value: string): string {
  return value.replaceAll(/[\s_-]+/g, "").toUpperCase();
}

function normaliseName(value: string): string {
  return value.replaceAll(/[\s·•（）()\-—_/]+/g, "").trim().toLowerCase();
}

function baseCodeMatches(left: string, right: string): boolean {
  if (!left || !right || left === right) return false;
  return left.startsWith(right) || right.startsWith(left);
}

function safeErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message
      .replace(/(password|authorization|cookie|token|sid|secret)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
      .replace(/\b(bearer\s+)[a-z0-9._~-]+\b/gi, "$1[redacted]")
      .slice(0, 240);
  }
  return "NCES lookup failed.";
}

async function fetchOptionalJson(adapter: ServiceAdapter, url: string): Promise<unknown | null> {
  let response: Response;
  try {
    response = await adapter.fetch(url);
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw new ServiceError("Could not reach the upstream service.", {
      url,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  const text = await response.text();
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new ServiceError("Upstream service returned an HTTP error.", {
      url,
      status: response.status,
      bodySample: sampleText(text),
    });
  }
  return parseJson<unknown>(text, url);
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
