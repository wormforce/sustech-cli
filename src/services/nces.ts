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
  summary: "NCES exposes public JSON APIs for exact by-code lookup, course search, browse, detail, reviews, stats, and teacher profiles.",
  notes: [
    "The API is public but rate-limited; callers should avoid aggressive polling.",
    "Ratings, reviews, teacher associations, and NCES AI summaries are community references, not official academic records.",
  ],
  endpoints: [
    "/api/v1/search",
    "/api/v1/course",
    "/api/v1/course/filter-options",
    "/api/v1/stats",
    "/api/v1/stats/rankings",
    "/api/v1/course/by-code/{code}",
    "/api/v1/course/{id}",
    "/api/v1/course/{id}/reviews",
    "/api/v1/course/{id}/stats",
    "/api/v1/teacher/{id}",
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
  rating: number | null;
  reviewCount: number;
  difficulty: NcesDimension | null;
  workload: NcesDimension | null;
  grading: NcesDimension | null;
  takeaways: NcesDimension | null;
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

export type NcesReviewSort =
  | "helpful"
  | "newest"
  | "oldest"
  | "rating-high"
  | "rating-low";

export type NcesSearchType =
  | "all"
  | "course"
  | "teacher"
  | "review";

export interface NcesReviewPage {
  courseId: number;
  items: NcesReview[];
  total: number;
  page: number;
  perPage: number;
  pages: number;
  sort: NcesReviewSort;
  term?: string;
  rating?: number;
}

export interface NcesCourseFilterOptions {
  offeringUnits: string[];
}

export interface NcesTeacherSummary {
  teacherId: number;
  name: string;
  email: string;
  title: string;
  image: string;
  directUrl: string;
}

export interface NcesTeacherDetail extends NcesTeacherSummary {
  accessCount: number;
  reviewCount: number;
  averageRate: number | null;
  normalizedRate: number | null;
  gender: string;
  description: string;
  homepage: string;
  researchInterest: string;
  officePhone: string;
  courses: NcesCourseSummary[];
}

export interface NcesCourseTerm {
  id: number;
  termId: string;
  term: string;
  courseries: string;
  kcid: string;
  courseMajor: string;
  courseType: string;
  courseLevel: string;
  joinType: string;
  teachingType: string;
  gradingType: string;
  credit?: number;
  hours?: number;
  hoursPerWeek?: number;
  campus: string;
  startWeek?: number;
  endWeek?: number;
}

export interface NcesCourseStatsTerm {
  term: string;
  reviewCount: number;
  ratingAverage?: number;
}

export interface NcesCourseStats {
  reviewCount: number;
  ratingDistribution: Record<string, number>;
  termDistribution: Record<string, number>;
  termStats: NcesCourseStatsTerm[];
}

export interface NcesDistributionPoint {
  label: string;
  value: number;
  cumulative?: number;
}

export interface NcesGlobalStats {
  userCount: number;
  courseCount: number;
  reviewCount: number;
  teacherCount: number;
  registeredTeacherCount: number;
  runningDays: number;
  courseAverageRating: number;
  averageReviewsPerCourse: number;
  reviewRateDistribution: NcesDistributionPoint[];
  courseRateDistribution: NcesDistributionPoint[];
  courseReviewCountDistribution: NcesDistributionPoint[];
  userReviewCountDistribution: NcesDistributionPoint[];
  reviewMonthlyDistribution: NcesDistributionPoint[];
  userMonthlyDistribution: NcesDistributionPoint[];
}

export interface NcesAiSummary {
  overview: string;
  strengths: string[];
  caveats: string[];
  assessment: string[];
  sourceReviewCount: number;
  generatedAt: string;
  authority: "community";
  generatedBy: "NCES";
  advisory: string;
}

export interface NcesTeacherCourseGroup {
  teacher: NcesTeacherSummary;
  courses: NcesCourseSummary[];
}

export type NcesRankingCategory =
  | "top-teachers"
  | "top-rated-courses"
  | "popular-courses"
  | "top-reviews"
  | "long-reviews"
  | "top-users";

export interface NcesTeacherRanking extends NcesTeacherSummary {
  department: string;
  courseCount: number;
  reviewCount: number;
  normalizedRating: number;
}

export interface NcesRankedCourse extends NcesCourseSummary {
  normalizedRating: number;
}

export interface NcesReviewRanking {
  courseId: number;
  courseName: string;
  reviewId: number;
  author: string;
  anonymous: boolean;
  upvotes: number;
  contentLength: number;
  courseUrl: string;
}

export interface NcesUserRanking {
  userId: number;
  username: string;
  identity: string;
  avatar: string;
  reviewCount: number;
  reviewUpvotes: number;
  reviewLength: number;
  score: number;
}

export interface NcesRankingStats {
  averageRating: number;
  averageReviewCount: number;
  averageReviewUpvotes: number;
  averageReviewLength: number;
}

export interface NcesRankings {
  stats: NcesRankingStats;
  topTeachers: NcesTeacherRanking[];
  topRatedCourses: NcesRankedCourse[];
  popularCourses: NcesRankedCourse[];
  topReviews: NcesReviewRanking[];
  longReviews: NcesReviewRanking[];
  topUsers: NcesUserRanking[];
}

export interface NcesCourseDetail extends NcesCourseSummary {
  department: string;
  courseries: string;
  courseMaterialCode: string;
  introduction: string;
  homepage: string;
  adminAnnouncement: string;
  accessCount: number;
  credit?: number;
  hours?: number;
  hoursPerWeek?: number;
  description: string;
  descriptionEng: string;
  teachingMaterial: string;
  referenceMaterial: string;
  studentRequirements: string;
  campus: string;
  courseMajor: string;
  courseType: string;
  gradingType: string;
  reviewTerms: string[];
  reviewResultsTotal: number;
  reviewResultsPages: number;
  reviewResultsPerPage: number;
  reviewFilterTerm?: string;
  teachers: NcesTeacherSummary[];
  terms: NcesCourseTerm[];
  relatedCourses: NcesCourseSummary[];
  sameTeacherCourses: NcesTeacherCourseGroup[];
  aiSummary?: NcesAiSummary;
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

export type NcesSearchAggregateItem =
  | { kind: "course"; item: NcesCourseSummary }
  | { kind: "teacher"; item: NcesTeacherSummary }
  | { kind: "review"; item: NcesReview };

interface NcesSearchResultBase {
  total: number;
  pages: number;
  aggregateTotal: number;
  aggregateItems: NcesSearchAggregateItem[];
  aggregateShown: number;
  courseItems: NcesCourseSummary[];
  courseTotal: number;
  coursePages: number;
  sampleReviews: NcesReview[];
  reviewTotal: number;
  reviewPages: number;
  teachers: NcesTeacherSummary[];
  teacherTotal: number;
  teacherPages: number;
  page: number;
  perPage: number;
}

export interface NcesCourseSearchResult extends NcesSearchResultBase {
  items: NcesCourseSummary[];
  type: "all" | "course";
  selectedBucket: "course";
  selectedItems: NcesCourseSummary[];
}

export interface NcesTeacherSearchResult extends NcesSearchResultBase {
  items: NcesTeacherSummary[];
  type: "teacher";
  selectedBucket: "teacher";
  selectedItems: NcesTeacherSummary[];
}

export interface NcesReviewSearchResult extends NcesSearchResultBase {
  items: NcesReview[];
  type: "review";
  selectedBucket: "review";
  selectedItems: NcesReview[];
}

export type NcesSearchResult =
  | NcesCourseSearchResult
  | NcesTeacherSearchResult
  | NcesReviewSearchResult;

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
  options: {
    page?: number;
    perPage?: number;
    sort?: "rating" | "reviews" | "name";
    offeringUnit?: string;
    adapter?: ServiceAdapter;
  } = {},
): Promise<{
  items: NcesCourseSummary[];
  total: number;
  page: number;
  perPage: number;
  pages: number;
  offeringUnit?: string;
}> {
  const adapter = options.adapter ?? createFetchAdapter();
  const page = options.page ?? 1;
  const perPage = Math.max(1, Math.min(options.perPage ?? 30, 50));
  const offeringUnit = cleanLookupText(options.offeringUnit);
  const raw = await fetchJson<unknown>(adapter, requestUrl(NCES_BASE, "/api/v1/course", {
    page,
    per_page: perPage,
    sort_by: browseSortParameter(options.sort ?? "rating"),
    ...(offeringUnit ? { offering_unit: offeringUnit } : {}),
  }));
  const record = recordValue(raw);
  const items = arrayValue(record.items).map((item) => normaliseNcesCourse(item));
  return {
    items,
    total: numberValue(record.total),
    page: numberValue(record.page) || page,
    perPage: numberValue(record.per_page) || perPage,
    pages: numberValue(record.pages),
    ...(offeringUnit ? { offeringUnit } : {}),
  };
}

export async function getNcesCourseFilterOptions(
  options: { adapter?: ServiceAdapter } = {},
): Promise<NcesCourseFilterOptions> {
  const adapter = options.adapter ?? createFetchAdapter();
  const raw = await fetchJson<unknown>(adapter, requestUrl(NCES_BASE, "/api/v1/course/filter-options"));
  const record = recordValue(raw);
  return {
    offeringUnits: arrayValue(record.offering_units)
      .map((item) => cleanText(item))
      .filter(Boolean),
  };
}

export async function getNcesGlobalStats(
  options: { adapter?: ServiceAdapter } = {},
): Promise<NcesGlobalStats> {
  const adapter = options.adapter ?? createFetchAdapter();
  const raw = await fetchJson<unknown>(adapter, requestUrl(NCES_BASE, "/api/v1/stats"));
  return normaliseNcesGlobalStats(raw);
}

export async function getNcesRankings(
  options: { adapter?: ServiceAdapter } = {},
): Promise<NcesRankings> {
  const adapter = options.adapter ?? createFetchAdapter();
  const raw = await fetchJson<unknown>(adapter, requestUrl(NCES_BASE, "/api/v1/stats/rankings"));
  return normaliseNcesRankings(raw);
}

export async function searchNces(
  query: string,
  options?: {
    page?: number;
    perPage?: number;
    type?: "all" | "course";
    adapter?: ServiceAdapter;
  },
): Promise<NcesCourseSearchResult>;
export async function searchNces(
  query: string,
  options: {
    page?: number;
    perPage?: number;
    type: "teacher";
    adapter?: ServiceAdapter;
  },
): Promise<NcesTeacherSearchResult>;
export async function searchNces(
  query: string,
  options: {
    page?: number;
    perPage?: number;
    type: "review";
    adapter?: ServiceAdapter;
  },
): Promise<NcesReviewSearchResult>;
export async function searchNces(
  query: string,
  options: {
    page?: number;
    perPage?: number;
    type?: NcesSearchType;
    adapter?: ServiceAdapter;
  } = {},
): Promise<NcesSearchResult> {
  const adapter = options.adapter ?? createFetchAdapter();
  const page = options.page ?? 1;
  const perPage = Math.max(1, Math.min(options.perPage ?? 20, 50));
  const type = options.type ?? "all";
  const raw = await fetchJson<unknown>(adapter, requestUrl(NCES_BASE, "/api/v1/search", {
    q: query,
    ...(options.type !== undefined ? { type } : {}),
    ...(options.page !== undefined ? { page } : {}),
    ...(options.perPage !== undefined ? { per_page: perPage } : {}),
  }));
  const record = recordValue(raw);
  const courses = recordValue(record.courses);
  const reviews = recordValue(record.reviews);
  const teachers = recordValue(record.teachers);
  const courseTotal = numberValue(courses.total);
  const coursePages = numberValue(courses.pages);
  const coursePage = numberValue(courses.page) || page;
  const coursePerPage = numberValue(courses.per_page) || perPage;
  const teacherTotal = numberValue(teachers.total);
  const teacherPages = numberValue(teachers.pages);
  const teacherPage = numberValue(teachers.page) || page;
  const teacherPerPage = numberValue(teachers.per_page) || perPage;
  const reviewTotal = numberValue(reviews.total);
  const reviewPages = numberValue(reviews.pages);
  const reviewPage = numberValue(reviews.page) || page;
  const reviewPerPage = numberValue(reviews.per_page) || perPage;
  const courseItems = arrayValue(courses.items).map((item) => normaliseNcesCourse(item));
  const reviewItems = arrayValue(reviews.items).map((item) => normaliseNcesReview(item));
  const teacherItems = arrayValue(teachers.items).map((item) => normaliseNcesTeacherSummary(item));
  const aggregateItems: NcesSearchAggregateItem[] = [
    ...courseItems.map((item) => ({ kind: "course" as const, item })),
    ...teacherItems.map((item) => ({ kind: "teacher" as const, item })),
    ...reviewItems.map((item) => ({ kind: "review" as const, item })),
  ];
  const common = {
    aggregateTotal: courseTotal + teacherTotal + reviewTotal,
    aggregateItems,
    aggregateShown: aggregateItems.length,
    courseItems,
    courseTotal,
    coursePages,
    sampleReviews: reviewItems,
    reviewTotal,
    reviewPages,
    teachers: teacherItems,
    teacherTotal,
    teacherPages,
    page,
    perPage,
  };
    if (type === "teacher") {
      return {
        ...common,
        items: teacherItems,
        total: teacherTotal,
        pages: teacherPages,
        page: teacherPage,
        perPage: teacherPerPage,
        type,
        selectedBucket: "teacher",
        selectedItems: teacherItems,
    };
  }
    if (type === "review") {
      return {
        ...common,
        items: reviewItems,
        total: reviewTotal,
        pages: reviewPages,
        page: reviewPage,
        perPage: reviewPerPage,
        type,
        selectedBucket: "review",
        selectedItems: reviewItems,
    };
  }
  return {
    ...common,
    items: courseItems,
    total: courseTotal,
    pages: coursePages,
    page: coursePage,
    perPage: coursePerPage,
    type,
    selectedBucket: "course",
    selectedItems: courseItems,
  };
}

export async function getNcesCourseDetail(
  id: number,
  options: { adapter?: ServiceAdapter; reviewTerm?: string; preferredTerm?: string; allReviews?: boolean } = {},
): Promise<NcesCourseDetail | null> {
  const adapter = options.adapter ?? createFetchAdapter();
  const courseResponse = await fetchOptionalJson(adapter, requestUrl(NCES_BASE, `/api/v1/course/${id}`));
  if (courseResponse === null) return null;
  const course = recordValue(courseResponse);
  const reviewPage = options.allReviews
    ? await loadCompleteNcesCourseReviews(id, adapter, options.reviewTerm)
    : await loadInitialNcesCourseReviews(id, adapter, options.reviewTerm);
  const rate = recordValue(course.rate);
  const preferredTerm = options.preferredTerm ?? options.reviewTerm;
  const rawTerms = preferMatchingCourseTerms(arrayValue(course.terms), preferredTerm);
  const offeringTermIds = preferMatchingTermIds([...new Set(rawTerms
    .map((item) => {
      const term = recordValue(item);
      return stringValue(term.term ?? term.term_id);
    })
    .filter(Boolean))], preferredTerm);
  const explicitTermIds = preferMatchingTermIds(arrayValue(course.term_ids).map((item) => stringValue(item)).filter(Boolean), preferredTerm);
  const reviewTermIds = preferMatchingTermIds(arrayValue(course.review_term_list).map((item) => stringValue(item)).filter(Boolean), preferredTerm);
  const summaryTermIds = preferMatchingTermIds(offeringTermIds.length > 0
    ? offeringTermIds
    : explicitTermIds.length > 0
      ? explicitTermIds
      : reviewTermIds, preferredTerm);
  const base = normaliseNcesCourse({
    id,
    course_code: course.course_code ?? course.courseries,
    name: course.name,
    teacher_names: course.teacher_names ?? arrayValue(course.teachers).map((item) => stringValue(recordValue(item).name)).join(", "),
    term_ids: summaryTermIds,
    rate_average: rate.rate_average ?? rate.average_rate,
    review_count: rate.review_count,
    difficulty_score: rate.difficulty_score,
    homework_score: rate.homework_score,
    grading_score: rate.grading_score,
    gain_score: rate.gain_score,
  });
  const aiSummary = normaliseNcesAiSummary(course.ai_summary);
  return {
    ...base,
    department: stringValue(course.dept),
    courseries: stringValue(course.courseries),
    courseMaterialCode: stringValue(course.course_material_code),
    introduction: cleanText(course.introduction),
    homepage: stringValue(course.homepage),
    adminAnnouncement: cleanText(course.admin_announcement),
    accessCount: numberValue(course.access_count),
    ...(course.credit !== undefined ? { credit: numberValue(course.credit) } : {}),
    ...(course.hours !== undefined ? { hours: numberValue(course.hours) } : {}),
    ...(course.hours_per_week !== undefined ? { hoursPerWeek: numberValue(course.hours_per_week) } : {}),
    description: cleanText(course.description),
    descriptionEng: cleanText(course.description_eng),
    teachingMaterial: cleanText(course.teaching_material),
    referenceMaterial: cleanText(course.reference_material),
    studentRequirements: cleanText(course.student_requirements),
    campus: stringValue(course.campus),
    courseMajor: stringValue(course.course_major),
    courseType: stringValue(course.course_type),
    gradingType: stringValue(course.grading_type),
    reviewTerms: reviewTermIds,
    reviewResultsTotal: reviewPage.total,
    reviewResultsPages: reviewPage.pages,
    reviewResultsPerPage: reviewPage.perPage,
    ...(options.reviewTerm ? { reviewFilterTerm: options.reviewTerm } : {}),
    teachers: arrayValue(course.teachers).map((item) => normaliseNcesTeacherSummary(item)),
    terms: rawTerms.map((item) => normaliseNcesCourseTerm(item)),
    relatedCourses: arrayValue(course.related_courses).map((item) => normaliseNcesCourse(item)),
    sameTeacherCourses: arrayValue(course.same_teacher_courses).map((item) => normaliseNcesTeacherCourseGroup(item)),
    ...(aiSummary ? { aiSummary } : {}),
    reviews: reviewPage.items,
  };
}

export async function listNcesCourseReviews(
  id: number,
  options: {
    page?: number;
    perPage?: number;
    sort?: NcesReviewSort;
    term?: string;
    rating?: number;
    adapter?: ServiceAdapter;
  } = {},
): Promise<NcesReviewPage> {
  const adapter = options.adapter ?? createFetchAdapter();
  const page = options.page ?? 1;
  const perPage = Math.max(1, Math.min(options.perPage ?? 20, 50));
  const sort = options.sort ?? "helpful";
  const raw = await fetchJson<unknown>(adapter, requestUrl(NCES_BASE, `/api/v1/course/${id}/reviews`, {
    page,
    per_page: perPage,
    sort_by: reviewSortParameter(sort),
    ...(options.term ? { term: options.term } : {}),
    ...(options.rating !== undefined ? { rating: options.rating } : {}),
  }));
  const record = recordValue(raw);
  return {
    courseId: id,
    items: arrayValue(record.items).map((item) => normaliseNcesReview(item)),
    total: numberValue(record.total),
    page: numberValue(record.page) || page,
    perPage: numberValue(record.per_page) || perPage,
    pages: numberValue(record.pages),
    sort,
    ...(options.term ? { term: options.term } : {}),
    ...(options.rating !== undefined ? { rating: options.rating } : {}),
  };
}

export async function getNcesCourseStats(
  id: number,
  options: { adapter?: ServiceAdapter } = {},
): Promise<NcesCourseStats | null> {
  const adapter = options.adapter ?? createFetchAdapter();
  const statsResponse = await fetchOptionalJson(adapter, requestUrl(NCES_BASE, `/api/v1/course/${id}/stats`));
  return statsResponse === null ? null : normaliseNcesCourseStats(statsResponse);
}

export async function getNcesTeacherDetail(
  id: number,
  options: { adapter?: ServiceAdapter } = {},
): Promise<NcesTeacherDetail | null> {
  const adapter = options.adapter ?? createFetchAdapter();
  const teacherResponse = await fetchOptionalJson(adapter, requestUrl(NCES_BASE, `/api/v1/teacher/${id}`));
  return teacherResponse === null ? null : normaliseNcesTeacherDetail(teacherResponse);
}

export async function getNcesCourseByCode(
  code: string,
  options: { term?: string; adapter?: ServiceAdapter; allReviews?: boolean } = {},
): Promise<NcesCourseDetail | null> {
  const adapter = options.adapter ?? createFetchAdapter();
  const courseId = await lookupNcesCourseIdByCode(code, { ...options, adapter });
  if (courseId === null) return null;
  return getNcesCourseDetail(courseId, {
    adapter,
    ...(options.allReviews ? { allReviews: true } : {}),
    ...(options.term ? { reviewTerm: options.term, preferredTerm: options.term } : {}),
  });
}

export async function resolveNcesCourseLookup(
  lookup: NcesCourseLookup,
  options: { termId?: string; includeDetail?: boolean; adapter?: ServiceAdapter } = {},
): Promise<NcesResolvedCourse> {
  const adapter = options.adapter ?? createFetchAdapter();
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

  let exactCandidate: NcesCourseSummary | undefined;
  let exactDetail: NcesCourseDetail | undefined;
  let exactLookupFailed = false;
  if (code && options.termId) {
    try {
      if (options.includeDetail) {
        exactDetail = (await getNcesCourseByCode(code, { term: options.termId, adapter })) ?? undefined;
        exactCandidate = exactDetail;
      } else {
        exactCandidate = (await getNcesCourseByCodeSummary(code, { term: options.termId, adapter })) ?? undefined;
      }
    } catch {
      exactLookupFailed = true;
    }
  }

  let search: NcesCourseSearchResult;
  try {
    search = await searchNces(query, {
      adapter,
      type: "course",
      perPage: 50,
    });
  } catch (error) {
    if (!exactCandidate) throw error;
    const signals = candidateSignals(exactCandidate, { code, name, teachers: lookup.teachers ?? [] }, options.termId);
    return {
      query,
      queryKind,
      ...(options.termId ? { termId: options.termId } : {}),
      searchTotal: 0,
      items: [],
      matchedCandidates: [exactCandidate],
      picked: exactCandidate,
      ...(options.includeDetail ? { detail: exactDetail } : {}),
      status: "matched",
      confidence: resolveExactLookupConfidence(signals, { name, teachers: lookup.teachers ?? [] }),
      signals,
      notes: [
        "NCES exact code lookup resolved the requested semester directly after search was unavailable.",
        ...lookupNotes("matched", 1, signals),
      ],
    };
  }
  const matchedCandidates = sortLookupCandidates(
    mergeExactLookupCandidate(
      search.items.filter((item) => lookupMatchesCandidate({ code, name }, item)),
      exactCandidate,
    ),
    lookup.teachers ?? [],
    options.termId,
    { code, name },
  );
  if (matchedCandidates.length === 0 && !exactCandidate) {
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
      notes: [
        "NCES search returned results, but none matched the course code or exact course name.",
        ...(exactLookupFailed ? ["NCES exact code lookup was unavailable, so the resolver fell back to search candidates only."] : []),
      ],
    };
  }

  const teacherMatchedCandidates = matchedCandidates.filter((candidate) =>
    candidateSignals(candidate, { code, name, teachers: lookup.teachers ?? [] }, options.termId).teacherMatches.length > 0
  );
  const picked = teacherMatchedCandidates[0] ?? exactCandidate ?? matchedCandidates[0];
  const signals = picked
    ? candidateSignals(picked, { code, name, teachers: lookup.teachers ?? [] }, options.termId)
    : {
      exactCode: false,
      baseCode: false,
      name: false,
      teacherMatches: [],
      termMatched: false,
    };
  const usedExactCandidate = Boolean(exactCandidate && picked && exactCandidate.ncesId === picked.ncesId);
  const confidence = usedExactCandidate
    ? resolveExactLookupConfidence(signals, { name, teachers: lookup.teachers ?? [] })
    : resolveLookupConfidence(signals, matchedCandidates.length);
  const status = usedExactCandidate
    ? "matched"
    : confidence === "low" && matchedCandidates.length > 1 ? "ambiguous" : "matched";
  const detail = options.includeDetail && picked
    ? exactDetail && exactDetail.ncesId === picked.ncesId
      ? exactDetail
      : await getNcesCourseDetail(picked.ncesId, {
        adapter,
        ...(options.termId ? { reviewTerm: options.termId, preferredTerm: options.termId } : {}),
      })
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
    notes: [
      ...(usedExactCandidate
        ? ["NCES exact code lookup matched the requested semester directly."]
        : exactCandidate
          ? ["NCES exact code lookup returned a same-semester candidate, but teacher-aware ranking selected a different section."]
          : []),
      ...lookupNotes(status, matchedCandidates.length, signals),
      ...(exactLookupFailed ? ["NCES exact code lookup was unavailable, so the resolver fell back to search candidates only."] : []),
    ],
  };
}

export async function resolveNcesCourseLookups(
  lookups: readonly NcesCourseLookupRequest[],
  options: { termId?: string; includeDetail?: boolean; adapter?: ServiceAdapter } = {},
): Promise<NcesCourseLookupBatch> {
  const items: Record<string, NcesResolvedCourse> = {};
  const failures: Array<{ key: string; message: string }> = [];
  const cache = new Map<string, Promise<NcesResolvedCourse>>();

  for (const lookup of lookups) {
    try {
      const cacheKey = ncesLookupCacheKey(lookup, options);
      const pending = cache.get(cacheKey) ?? resolveNcesCourseLookup(lookup, options);
      if (!cache.has(cacheKey)) cache.set(cacheKey, pending);
      items[lookup.key] = await pending;
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

function ncesLookupCacheKey(
  lookup: Pick<NcesCourseLookup, "code" | "name" | "teachers">,
  options: { termId?: string; includeDetail?: boolean },
): string {
  const teachers = [...new Set((lookup.teachers ?? [])
    .map((teacher) => cleanLookupText(teacher))
    .filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
  return JSON.stringify({
    code: normaliseLookupCode(lookup.code),
    name: cleanLookupText(lookup.name),
    teachers,
    termId: options.termId ?? "",
    includeDetail: Boolean(options.includeDetail),
  });
}

export function normaliseNcesCourse(raw: unknown): NcesCourseSummary {
  const record = recordValue(raw);
  const termIds = arrayValue(record.term_ids).map((item) => stringValue(item)).filter(Boolean);
  const code = stringValue(record.course_code ?? record.courseries).toUpperCase();
  return {
    ncesId: numberValue(record.id),
    code,
    name: cleanText(record.name),
    teacher: cleanText(record.teacher_names),
    semester: termIdToDisplay(termIds[0] ?? ""),
    semesters: termIds.map((termId) => termIdToDisplay(termId)),
    rating: nullableNumberValue(record.rate_average),
    reviewCount: numberValue(record.review_count),
    difficulty: scoreToLabelOrNull("difficulty", record.difficulty_score),
    workload: scoreToLabelOrNull("workload", record.homework_score),
    grading: scoreToLabelOrNull("grading", record.grading_score),
    takeaways: scoreToLabelOrNull("takeaways", record.gain_score),
    directUrl: `${NCES_BASE}/course/${numberValue(record.id)}/`,
  };
}

export function normaliseNcesReview(raw: unknown): NcesReview {
  const record = recordValue(raw);
  const rawAuthor = record.author;
  const author = typeof rawAuthor === "object" && rawAuthor !== null ? recordValue(rawAuthor) : {};
  return {
    id: numberValue(record.id),
    author: stringValue(record.author_name ?? record.user_name ?? (typeof rawAuthor === "string" ? rawAuthor : undefined) ?? author.username) || "匿名用户",
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

export function normaliseNcesTeacherSummary(raw: unknown): NcesTeacherSummary {
  const record = recordValue(raw);
  const teacherId = numberValue(record.id);
  return {
    teacherId,
    name: cleanText(record.name),
    email: stringValue(record.email),
    title: cleanText(record.title),
    image: normaliseNcesAssetUrl(stringValue(record.image)),
    directUrl: `${NCES_BASE}/teacher/${teacherId}`,
  };
}

export function normaliseNcesTeacherDetail(raw: unknown): NcesTeacherDetail {
  const record = recordValue(raw);
  const base = normaliseNcesTeacherSummary(record);
  return {
    ...base,
    accessCount: numberValue(record.access_count),
    reviewCount: numberValue(record.review_count),
    averageRate: nullableNumberValue(record.average_rate),
    normalizedRate: nullableNumberValue(record.normalized_rate),
    gender: stringValue(record.gender),
    description: cleanText(record.description),
    homepage: stringValue(record.homepage),
    researchInterest: cleanText(record.research_interest),
    officePhone: stringValue(record.office_phone),
    courses: arrayValue(record.courses).map((item) => normaliseNcesCourse(item)),
  };
}

export function normaliseNcesCourseTerm(raw: unknown): NcesCourseTerm {
  const record = recordValue(raw);
  const termId = stringValue(record.term ?? record.term_id);
  return {
    id: numberValue(record.id),
    termId,
    term: termIdToDisplay(termId),
    courseries: stringValue(record.courseries),
    kcid: stringValue(record.kcid),
    courseMajor: stringValue(record.course_major),
    courseType: stringValue(record.course_type),
    courseLevel: stringValue(record.course_level),
    joinType: stringValue(record.join_type),
    teachingType: stringValue(record.teaching_type),
    gradingType: stringValue(record.grading_type),
    ...(record.credit !== undefined ? { credit: numberValue(record.credit) } : {}),
    ...(record.hours !== undefined ? { hours: numberValue(record.hours) } : {}),
    ...(record.hours_per_week !== undefined ? { hoursPerWeek: numberValue(record.hours_per_week) } : {}),
    campus: stringValue(record.campus),
    ...(record.start_week !== undefined ? { startWeek: numberValue(record.start_week) } : {}),
    ...(record.end_week !== undefined ? { endWeek: numberValue(record.end_week) } : {}),
  };
}

export function normaliseNcesCourseStats(raw: unknown): NcesCourseStats {
  const record = recordValue(raw);
  return {
    reviewCount: numberValue(record.review_count),
    ratingDistribution: numberRecord(record.rating_distribution),
    termDistribution: numberRecord(record.term_distribution),
    termStats: arrayValue(record.term_stats).map((item) => {
      const term = recordValue(item);
      const ratingAverage = nullableNumberValue(term.rate_average);
      return {
        term: termIdToDisplay(stringValue(term.term)),
        reviewCount: numberValue(term.review_count),
        ...(ratingAverage === null ? {} : { ratingAverage }),
      };
    }),
  };
}

export function normaliseNcesGlobalStats(raw: unknown): NcesGlobalStats {
  const record = recordValue(raw);
  return {
    userCount: numberValue(record.user_count),
    courseCount: numberValue(record.course_count),
    reviewCount: numberValue(record.review_count),
    teacherCount: numberValue(record.teacher_count),
    registeredTeacherCount: numberValue(record.registered_teacher_count),
    runningDays: numberValue(record.running_days),
    courseAverageRating: numberValue(record.course_avg_rate),
    averageReviewsPerCourse: numberValue(record.course_avg_rate_count),
    reviewRateDistribution: normaliseNcesDistributionSeries(record.review_rate_distribution),
    courseRateDistribution: normaliseNcesDistributionSeries(record.course_rate_distribution),
    courseReviewCountDistribution: normaliseNcesDistributionSeries(record.course_review_count_distribution),
    userReviewCountDistribution: normaliseNcesDistributionSeries(record.user_review_count_distribution),
    reviewMonthlyDistribution: normaliseNcesDistributionSeries(record.review_monthly_distribution),
    userMonthlyDistribution: normaliseNcesDistributionSeries(record.user_monthly_distribution),
  };
}

export function normaliseNcesRankings(raw: unknown): NcesRankings {
  const record = recordValue(raw);
  const stats = recordValue(record.stats);
  return {
    stats: {
      averageRating: numberValue(stats.avg_rate),
      averageReviewCount: numberValue(stats.avg_rate_count),
      averageReviewUpvotes: numberValue(stats.avg_review_upvotes),
      averageReviewLength: numberValue(stats.avg_review_length),
    },
    topTeachers: arrayValue(record.top_teachers).map((item) => normaliseNcesTeacherRanking(item)),
    topRatedCourses: arrayValue(record.top_rated_courses).map((item) => normaliseNcesRankedCourse(item)),
    popularCourses: arrayValue(record.popular_courses).map((item) => normaliseNcesRankedCourse(item)),
    topReviews: arrayValue(record.top_reviews).map((item) => normaliseNcesReviewRanking(item)),
    longReviews: arrayValue(record.long_reviews).map((item) => normaliseNcesReviewRanking(item)),
    topUsers: arrayValue(record.top_users).map((item) => normaliseNcesUserRanking(item)),
  };
}

export function normaliseNcesAiSummary(raw: unknown): NcesAiSummary | undefined {
  const record = recordValue(raw);
  const overview = cleanText(record.overview);
  const strengths = arrayValue(record.strengths).map((item) => cleanText(item)).filter(Boolean);
  const caveats = arrayValue(record.caveats).map((item) => cleanText(item)).filter(Boolean);
  const assessment = arrayValue(record.assessment).map((item) => cleanText(item)).filter(Boolean);
  if (!overview && strengths.length === 0 && caveats.length === 0 && assessment.length === 0) return undefined;
  return {
    overview,
    strengths,
    caveats,
    assessment,
    sourceReviewCount: numberValue(record.source_review_count),
    generatedAt: stringValue(record.generated_at),
    authority: "community",
    generatedBy: "NCES",
    advisory: "AI-generated summary of community reviews; verify important claims against the underlying reviews and official course information.",
  };
}

export function normaliseNcesTeacherCourseGroup(raw: unknown): NcesTeacherCourseGroup {
  const record = recordValue(raw);
  return {
    teacher: normaliseNcesTeacherSummary(record.teacher),
    courses: arrayValue(record.courses).map((item) => normaliseNcesCourse(item)),
  };
}

export function normaliseNcesTeacherRanking(raw: unknown): NcesTeacherRanking {
  const record = recordValue(raw);
  const base = normaliseNcesTeacherSummary(record);
  return {
    ...base,
    department: cleanText(record.dept),
    courseCount: numberValue(record.course_count),
    reviewCount: numberValue(record.review_count),
    normalizedRating: numberValue(record.normalized_rate),
  };
}

export function normaliseNcesRankedCourse(raw: unknown): NcesRankedCourse {
  const record = recordValue(raw);
  return {
    ...normaliseNcesCourse(record),
    normalizedRating: numberValue(record.normalized_rate),
  };
}

export function normaliseNcesReviewRanking(raw: unknown): NcesReviewRanking {
  const record = recordValue(raw);
  const rawAuthor = record.author;
  const author = typeof rawAuthor === "object" && rawAuthor !== null ? recordValue(rawAuthor) : {};
  const courseId = numberValue(record.course_id);
  return {
    courseId,
    courseName: cleanText(record.course_name),
    reviewId: numberValue(record.review_id),
    author: stringValue(record.author_name ?? (typeof rawAuthor === "string" ? rawAuthor : undefined) ?? author.username) || "匿名用户",
    anonymous: Boolean(record.is_anonymous),
    upvotes: numberValue(record.upvote_count),
    contentLength: numberValue(record.content_length),
    courseUrl: `${NCES_BASE}/course/${courseId}/`,
  };
}

export function normaliseNcesUserRanking(raw: unknown): NcesUserRanking {
  const record = recordValue(raw);
  const user = recordValue(record.user);
  return {
    userId: numberValue(user.id),
    username: stringValue(user.username),
    identity: stringValue(user.identity),
    avatar: normaliseNcesAssetUrl(stringValue(user.avatar)),
    reviewCount: numberValue(record.reviews_count),
    reviewUpvotes: numberValue(record.review_upvotes_count),
    reviewLength: numberValue(record.review_length),
    score: numberValue(record.score),
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

export function scoreToLabelOrNull(
  dimension: keyof typeof DIMENSION_LABELS,
  value: unknown,
): NcesDimension | null {
  const pct = nullableNumberValue(value);
  return pct === null ? null : scoreToLabel(dimension, pct);
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
    [sortableNullableNumber(left.rating), sortableNullableNumber(right.rating)],
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

function resolveExactLookupConfidence(
  signals: NcesResolvedCourse["signals"],
  lookup: { name: string; teachers: readonly string[] },
): NcesResolvedCourse["confidence"] {
  if (!signals.exactCode || !signals.termMatched) return resolveLookupConfidence(signals, 1);
  if (lookup.name && !signals.name) {
    return signals.teacherMatches.length > 0 || lookup.teachers.length === 0 ? "medium" : "low";
  }
  if (lookup.teachers.length > 0 && signals.teacherMatches.length === 0) return "medium";
  return "high";
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

function nullableNumberValue(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const parsed = numberValue(value, Number.NaN);
  return Number.isFinite(parsed) ? parsed : null;
}

function sortableNullableNumber(value: number | null): number {
  return value ?? -1;
}

function normaliseName(value: string): string {
  return value.replaceAll(/[\s·•（）()\-—_/]+/g, "").trim().toLowerCase();
}

function baseCodeMatches(left: string, right: string): boolean {
  if (!left || !right || left === right) return false;
  if (!left.startsWith(right)) return false;
  const suffix = left.slice(right.length);
  return /^[A-Z][A-Z0-9]*$/u.test(suffix);
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

const NCES_DETAIL_REVIEW_PAGE_LIMIT = 200;
const NCES_DETAIL_REVIEW_PAGE_CONCURRENCY = 5;

async function loadInitialNcesCourseReviews(
  id: number,
  adapter: ServiceAdapter,
  term: string | undefined,
): Promise<{ items: NcesReview[]; total: number; pages: number; perPage: number }> {
  const raw = await fetchJson<unknown>(adapter, requestUrl(NCES_BASE, `/api/v1/course/${id}/reviews`, {
    ...(term ? { term } : {}),
  }));
  const record = recordValue(raw);
  const items = arrayValue(record.items).map((item) => normaliseNcesReview(item));
  const total = numberValue(record.total);
  const pages = numberValue(record.pages);
  const reportedPerPage = numberValue(record.per_page);
  return {
    items,
    total,
    pages,
    perPage: reportedPerPage > 0 ? reportedPerPage : items.length > 0 ? items.length : 20,
  };
}

async function loadCompleteNcesCourseReviews(
  id: number,
  adapter: ServiceAdapter,
  term: string | undefined,
): Promise<{ items: NcesReview[]; total: number; pages: number; perPage: number }> {
  const baseUrl = requestUrl(NCES_BASE, `/api/v1/course/${id}/reviews`, {
    ...(term ? { term } : {}),
  });
  const firstPageRaw = await fetchJson<unknown>(adapter, baseUrl);
  const firstPage = recordValue(firstPageRaw);
  const initialItems = arrayValue(firstPage.items).map((item) => normaliseNcesReview(item));
  const total = numberValue(firstPage.total);
  const pages = numberValue(firstPage.pages);
  const reportedPerPage = numberValue(firstPage.per_page);
  const perPage = reportedPerPage > 0
    ? reportedPerPage
    : initialItems.length > 0
      ? initialItems.length
      : 20;
  const effectivePages = pages > 0
    ? pages
    : total > perPage && perPage > 0
      ? Math.ceil(total / perPage)
      : initialItems.length > 0
        ? 1
        : 0;
  if (effectivePages > NCES_DETAIL_REVIEW_PAGE_LIMIT) {
    throw new ServiceError("NCES course detail review pagination exceeded the safety limit.", {
      url: baseUrl,
      cause: `total=${total}; pages=${effectivePages}; limit=${NCES_DETAIL_REVIEW_PAGE_LIMIT}`,
    });
  }
  if (effectivePages <= 1) {
    return {
      items: dedupeNcesReviews(initialItems),
      total: total > 0 ? total : initialItems.length,
      pages: effectivePages,
      perPage,
    };
  }
  const remainingPages = await fetchNcesReviewPagesInBatches(
    Array.from({ length: effectivePages - 1 }, (_, index) => index + 2),
    async (page) => {
      const raw = await fetchJson<unknown>(adapter, requestUrl(NCES_BASE, `/api/v1/course/${id}/reviews`, {
        page,
        per_page: perPage,
        ...(term ? { term } : {}),
      }));
      return arrayValue(recordValue(raw).items).map((item) => normaliseNcesReview(item));
    },
  );
  const items = dedupeNcesReviews([...initialItems, ...remainingPages.flat()]);
  return {
    items,
    total: total > 0 ? total : items.length,
    pages: effectivePages,
    perPage,
  };
}

async function fetchNcesReviewPagesInBatches<T>(
  pages: readonly number[],
  loadPage: (page: number) => Promise<T>,
): Promise<T[]> {
  const results: T[] = [];
  for (let start = 0; start < pages.length; start += NCES_DETAIL_REVIEW_PAGE_CONCURRENCY) {
    const batch = pages.slice(start, start + NCES_DETAIL_REVIEW_PAGE_CONCURRENCY);
    results.push(...await Promise.all(batch.map((page) => loadPage(page))));
  }
  return results;
}

function dedupeNcesReviews(reviews: readonly NcesReview[]): NcesReview[] {
  const seen = new Set<number>();
  const items: NcesReview[] = [];
  for (const review of reviews) {
    if (seen.has(review.id)) continue;
    seen.add(review.id);
    items.push(review);
  }
  return items;
}

function mergeExactLookupCandidate(
  items: readonly NcesCourseSummary[],
  exactDetail: NcesCourseSummary | null | undefined,
): NcesCourseSummary[] {
  if (!exactDetail) return [...items];
  const merged: NcesCourseSummary[] = [exactDetail];
  const seen = new Set<number>([exactDetail.ncesId]);
  for (const item of items) {
    if (seen.has(item.ncesId)) continue;
    seen.add(item.ncesId);
    merged.push(item);
  }
  return merged;
}

async function lookupNcesCourseIdByCode(
  code: string,
  options: { term?: string; adapter?: ServiceAdapter } = {},
): Promise<number | null> {
  const adapter = options.adapter ?? createFetchAdapter();
  const normalizedCode = cleanLookupText(code).toUpperCase();
  if (!normalizedCode) return null;
  const lookupUrl = requestUrl(
    NCES_BASE,
    `/api/v1/course/by-code/${encodeURIComponent(normalizedCode)}`,
    options.term ? { term: options.term } : {},
  );
  const lookupResponse = await fetchOptionalJson(adapter, lookupUrl);
  if (lookupResponse === null) return null;
  const courseId = numberValue(recordValue(lookupResponse).course_id);
  if (!Number.isSafeInteger(courseId) || courseId < 1) {
    throw new ServiceError("NCES exact code lookup did not return a valid course ID.", { url: lookupUrl });
  }
  return courseId;
}

async function getNcesCourseByCodeSummary(
  code: string,
  options: { term?: string; adapter?: ServiceAdapter } = {},
): Promise<NcesCourseSummary | null> {
  const adapter = options.adapter ?? createFetchAdapter();
  const courseId = await lookupNcesCourseIdByCode(code, { ...options, adapter });
  if (courseId === null) return null;
  const courseResponse = await fetchOptionalJson(adapter, requestUrl(NCES_BASE, `/api/v1/course/${courseId}`));
  if (courseResponse === null) return null;
  return normaliseNcesCourseSummaryFromDetailRecord(courseId, recordValue(courseResponse), options.term);
}

function normaliseNcesCourseSummaryFromDetailRecord(
  id: number,
  course: Record<string, unknown>,
  preferredTerm: string | undefined,
): NcesCourseSummary {
  const rate = recordValue(course.rate);
  const rawTerms = preferMatchingCourseTerms(arrayValue(course.terms), preferredTerm);
  const offeringTermIds = preferMatchingTermIds([...new Set(rawTerms
    .map((item) => {
      const term = recordValue(item);
      return stringValue(term.term ?? term.term_id);
    })
    .filter(Boolean))], preferredTerm);
  const explicitTermIds = preferMatchingTermIds(arrayValue(course.term_ids).map((item) => stringValue(item)).filter(Boolean), preferredTerm);
  const reviewTermIds = preferMatchingTermIds(arrayValue(course.review_term_list).map((item) => stringValue(item)).filter(Boolean), preferredTerm);
  const summaryTermIds = preferMatchingTermIds(offeringTermIds.length > 0
    ? offeringTermIds
    : explicitTermIds.length > 0
      ? explicitTermIds
      : reviewTermIds, preferredTerm);
  return normaliseNcesCourse({
    id,
    course_code: course.course_code ?? course.courseries,
    name: course.name,
    teacher_names: course.teacher_names ?? arrayValue(course.teachers).map((item) => stringValue(recordValue(item).name)).join(", "),
    term_ids: summaryTermIds,
    rate_average: rate.rate_average ?? rate.average_rate,
    review_count: rate.review_count,
    difficulty_score: rate.difficulty_score,
    homework_score: rate.homework_score,
    grading_score: rate.grading_score,
    gain_score: rate.gain_score,
  });
}

function compareTuple(a: [number, number, number], b: [number, number, number]): number {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  return a[2] - b[2];
}

function numberRecord(raw: unknown): Record<string, number> {
  const record = recordValue(raw);
  return Object.fromEntries(
    Object.entries(record)
      .map(([key, value]) => [key, numberValue(value)] as const)
      .filter(([, value]) => Number.isFinite(value)),
  );
}

function normaliseNcesDistributionSeries(raw: unknown): NcesDistributionPoint[] {
  return arrayValue(raw).map((item) => {
    const record = recordValue(item);
    return {
      label: stringValue(record.label),
      value: numberValue(record.value),
      ...(record.cumulative === undefined ? {} : { cumulative: numberValue(record.cumulative) }),
    };
  });
}

function normaliseNcesAssetUrl(value: string): string {
  if (!value) return "";
  try {
    const url = new URL(value, NCES_BASE);
    if (url.protocol === "http:" || url.protocol === "https:") return url.toString();
  } catch {
    // ignore invalid URLs and return an empty string below
  }
  return "";
}

function preferMatchingCourseTerms(rawTerms: readonly unknown[], preferredTerm: string | undefined): unknown[] {
  if (!preferredTerm) return [...rawTerms];
  return [...rawTerms].sort((left, right) => {
    const leftTerm = stringValue(recordValue(left).term ?? recordValue(left).term_id);
    const rightTerm = stringValue(recordValue(right).term ?? recordValue(right).term_id);
    const leftMatch = leftTerm === preferredTerm ? 1 : 0;
    const rightMatch = rightTerm === preferredTerm ? 1 : 0;
    if (leftMatch !== rightMatch) return rightMatch - leftMatch;
    return 0;
  });
}

function preferMatchingTermIds(termIds: readonly string[], preferredTerm: string | undefined): string[] {
  if (!preferredTerm) return [...termIds];
  const normalized = termIds.filter(Boolean);
  const matches = normalized.filter((termId) => termId === preferredTerm);
  const rest = normalized.filter((termId) => termId !== preferredTerm);
  return [...matches, ...rest];
}

function browseSortParameter(sort: "rating" | "reviews" | "name"): string {
  if (sort === "reviews") return "review_count";
  if (sort === "name") return "name";
  return "rate";
}

function reviewSortParameter(sort: NcesReviewSort): string {
  if (sort === "newest") return "pubtime_desc";
  if (sort === "oldest") return "pubtime";
  if (sort === "rating-high") return "score_desc";
  if (sort === "rating-low") return "score";
  return "upvote";
}
