export type DegreeProgressSourceName =
  | "graduationRequirements"
  | "requirementSummary"
  | "creditCategories"
  | "moduleRequirements"
  | "courses";

export interface DegreeProgressSourceStatus {
  state: "available" | "empty" | "error" | "not_requested";
  count?: number;
  message?: string;
}

export interface DegreeProgressWarning {
  code: "SOURCE_DISAGREEMENT" | "OVERLAPPING_CATEGORIES";
  message: string;
}

export interface DegreeProgressContext {
  cohort?: string;
  cultivationType?: string;
  planType?: string;
  planCode?: string;
  college?: string;
  major?: string;
}

export interface DegreeProgressSummary {
  requiredCredits?: number;
  completedCredits?: number;
  remainingCredits?: number;
  requiredCourses?: number;
  completedCourses?: number;
  remainingCourses?: number;
  majorTrack?: string;
  totalCreditsScope?: number;
}

export interface DegreeCreditCategory {
  name: string;
  majorTrack?: string;
  instructionLanguage?: string;
  courseNature?: string;
  requiredCredits?: number;
  completedCredits?: number;
  remainingCredits?: number;
  requiredHours?: number;
  completedHours?: number;
  remainingHours?: number;
  requiredCourses?: number;
  completedCourses?: number;
  remainingCourses?: number;
  note?: string;
}

export interface DegreeModuleRequirement {
  name: string;
  nameEn?: string;
  passed?: boolean;
  remainingCredits?: number;
  remainingCourses?: number;
}

export interface DegreeProgressCourse {
  code?: string;
  name?: string;
  group?: string;
  college?: string;
  semester?: string;
  letterGrade?: string;
  numericScore?: number;
  required?: boolean;
  credits?: number;
  hours?: number;
  courseNature?: string;
  category?: string;
  majorTrack?: string;
}

export interface TisDegreeProgress {
  schemaVersion: "1";
  kind: "tis-degree-progress";
  reportedAt: string;
  context: DegreeProgressContext;
  summary: DegreeProgressSummary;
  creditCategories: DegreeCreditCategory[];
  moduleRequirements: DegreeModuleRequirement[];
  moduleGaps: DegreeModuleRequirement[];
  dataAvailable: boolean;
  detailsRequested: boolean;
  detailsIncluded: boolean;
  courses?: DegreeProgressCourse[];
  courseCount?: number;
  sourceStatuses: Record<DegreeProgressSourceName, DegreeProgressSourceStatus>;
  warnings: DegreeProgressWarning[];
}

export interface DegreeProgressPayloads {
  context: Record<string, unknown>;
  graduationRequirements?: unknown;
  requirementSummary?: unknown;
  creditCategories?: unknown;
  moduleRequirements?: unknown;
  courses?: unknown;
  detailsIncluded: boolean;
  reportedAt?: Date;
  sourceStatuses: Record<DegreeProgressSourceName, DegreeProgressSourceStatus>;
}

export function normaliseTisDegreeProgress(payloads: DegreeProgressPayloads): TisDegreeProgress {
  const overviewRow = records(payloads.graduationRequirements)[0] ?? {};
  const requirementSummary = record(payloads.requirementSummary);
  const nestedRequirements = record(pick(requirementSummary, "yqmsxf", "YQMSXF"));
  const creditCategories = records(payloads.creditCategories)
    .map(normaliseCreditCategory)
    .filter((entry) => entry.name);
  const moduleRequirements = records(payloads.moduleRequirements)
    .map(normaliseModuleRequirement)
    .filter((entry) => entry.name);
  const courseSource = payloads.sourceStatuses.courses;
  const detailsIncluded = payloads.detailsIncluded
    && (courseSource.state === "available" || courseSource.state === "empty");
  const courses = detailsIncluded
    ? records(payloads.courses).map(normaliseDegreeCourse).filter(hasCourseIdentity)
    : undefined;

  const overviewRequired = numeric(pick(overviewRow, "YQXDXF", "yqxdxf"));
  const overviewCompleted = numeric(pick(overviewRow, "XF", "xf"));
  const summaryRequired = numeric(pick(nestedRequirements, "YQXF", "yqxf"));
  const summaryCompleted = numeric(pick(requirementSummary, "ywcxf", "YWCXF"));
  const summaryRemaining = numeric(pick(requirementSummary, "wwcxf", "WWCXF"));

  const requiredCredits = overviewRequired ?? summaryRequired;
  const completedCredits = overviewCompleted ?? summaryCompleted;
  const remainingCredits = requiredCredits !== undefined && completedCredits !== undefined
    ? Math.max(requiredCredits - completedCredits, 0)
    : summaryRemaining;

  const completedCourses = numeric(pick(requirementSummary, "ywcms", "YWCMS"));
  const remainingCourses = numeric(pick(requirementSummary, "wwcms", "WWCMS"));
  const overviewRequiredCourses = numeric(pick(overviewRow, "MS", "ms"));
  const summaryRequiredCourses = numeric(pick(nestedRequirements, "YQMS", "yqms"));
  const requiredCourses = overviewRequiredCourses
    ?? summaryRequiredCourses
    ?? (completedCourses !== undefined && remainingCourses !== undefined
      ? completedCourses + remainingCourses
      : undefined);

  const summary: DegreeProgressSummary = compact({
    requiredCredits,
    completedCredits,
    remainingCredits,
    requiredCourses,
    completedCourses,
    remainingCourses,
    majorTrack: text(pick(overviewRow, "ZYFXMC", "zyfxmc")),
    totalCreditsScope: numeric(pick(overviewRow, "YQXDQTXF", "yqxdqtxf")),
  });

  const warnings: DegreeProgressWarning[] = [];
  addDisagreement(warnings, "required credits", overviewRequired, summaryRequired);
  addDisagreement(warnings, "completed credits", overviewCompleted, summaryCompleted);
  if (creditCategories.length > 1) {
    warnings.push({
      code: "OVERLAPPING_CATEGORIES",
      message: "TIS credit categories can contain overlapping or combined constraints; do not sum category rows as independent totals.",
    });
  }

  const moduleGaps = moduleRequirements.filter((entry) =>
    entry.passed !== true
    || (entry.remainingCredits ?? 0) > 0
    || (entry.remainingCourses ?? 0) > 0,
  );
  const context = normaliseContext(payloads.context);
  const dataAvailable = Object.values(summary).some((value) => value !== undefined && value !== "")
    || creditCategories.length > 0
    || moduleRequirements.length > 0
    || (courses?.length ?? 0) > 0;

  return {
    schemaVersion: "1",
    kind: "tis-degree-progress",
    reportedAt: (payloads.reportedAt ?? new Date()).toISOString(),
    context,
    summary,
    creditCategories,
    moduleRequirements,
    moduleGaps,
    dataAvailable,
    detailsRequested: payloads.detailsIncluded,
    detailsIncluded,
    ...(courses ? { courses, courseCount: courses.length } : {}),
    sourceStatuses: payloads.sourceStatuses,
    warnings,
  };
}

export function progressRows(value: unknown): Record<string, unknown>[] {
  return records(value);
}

export function degreeProgressPage(value: unknown): {
  rows: Record<string, unknown>[];
  total?: number;
} {
  const unwrapped = unwrapDegreeProgressPayload(value);
  const outer = record(unwrapped);
  return {
    rows: records(unwrapped),
    total: numeric(pick(outer, "total", "TOTAL")),
  };
}

export function unwrapDegreeProgressPayload(value: unknown): unknown {
  const outer = record(value);
  if (!("code" in outer) || !("content" in outer)) return value;
  const code = text(outer.code);
  if (code && code !== "0" && code !== "200") {
    const error = new Error(text(pick(outer, "msg", "msg_en")) || `TIS progress API returned code ${code}.`);
    (error as Error & { code?: string }).code = "TIS_DEGREE_PROGRESS_API_ERROR";
    throw error;
  }
  return outer.content;
}

export function degreeProgressErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message.slice(0, 240);
  }
  return "TIS degree-progress source failed.";
}

function normaliseContext(raw: Record<string, unknown>): DegreeProgressContext {
  return compact({
    cohort: text(pick(raw, "nj", "NJ")),
    cultivationType: text(pick(raw, "pylx", "PYLX")),
    planType: text(pick(raw, "falxdm", "FALXDM")),
    planCode: text(pick(raw, "fah", "FAH")),
    college: text(pick(raw, "yxmc", "YXMC", "xymc", "XYMC")),
    major: text(pick(raw, "zymc", "ZYMC")),
  });
}

function normaliseCreditCategory(raw: Record<string, unknown>): DegreeCreditCategory {
  const requiredCredits = numeric(pick(raw, "YQWCXF", "yqwcxf", "YQXF", "yqxf", "YQZXF", "yqzxf", "ZXF", "zxf"));
  const completedCredits = numeric(pick(raw, "YWCXF", "ywcxf", "YWXF", "ywxf", "YHXF", "yhxf", "YIXF", "yixf", "HDXF", "hdxf"));
  const reportedRemaining = numeric(pick(raw, "WWCXF", "wwcxf", "WWXF", "wwxf", "SYXF", "syxf", "QXF", "qxf"));
  return compact({
    name: text(pick(raw, "XFLBMC", "xflbmc", "XFLB", "xflb", "KCLBMC", "kclbmc", "KCLB", "kclb", "LBMC", "lbmc", "MKMC", "mkmc", "MC", "mc")) || "Uncategorised",
    majorTrack: text(pick(raw, "ZYFXMC", "zyfxmc")),
    instructionLanguage: text(pick(raw, "SKYYMC", "skyymc", "SKYY", "skyy")),
    courseNature: text(pick(raw, "KCXZMC", "kcxzmc", "KCXZ", "kcxz")),
    requiredCredits,
    completedCredits,
    remainingCredits: reportedRemaining ?? (requiredCredits !== undefined && completedCredits !== undefined
      ? Math.max(requiredCredits - completedCredits, 0)
      : undefined),
    requiredHours: numeric(pick(raw, "YQXS", "yqxs", "YQWCXS", "yqwcxs", "ZXS", "zxs")),
    completedHours: numeric(pick(raw, "YWCXS", "ywcxs", "YWXS", "ywxs")),
    remainingHours: numeric(pick(raw, "WWCXS", "wwcxs", "WWXS", "wwxs")),
    requiredCourses: numeric(pick(raw, "YQMS", "yqms", "YQMSL", "yqmsl")),
    completedCourses: numeric(pick(raw, "YHMS", "yhms", "YWMS", "ywms")),
    remainingCourses: numeric(pick(raw, "WWMS", "wwms", "SYMS", "syms")),
    note: text(pick(raw, "BZ", "bz", "BZSM", "bzsm")),
  });
}

function normaliseModuleRequirement(raw: Record<string, unknown>): DegreeModuleRequirement {
  return compact({
    name: text(pick(raw, "kzmc", "KZMC", "mkmc", "MKMC")) || "",
    nameEn: text(pick(raw, "kzmc_en", "KZMC_EN", "mkmc_en", "MKMC_EN")),
    passed: boolean(pick(raw, "sftg", "SFTG")),
    remainingCredits: numeric(pick(raw, "wc_xf", "WC_XF", "wwcxf", "WWCXF")),
    remainingCourses: numeric(pick(raw, "wc_ms", "WC_MS", "wwcms", "WWCMS")),
  });
}

function normaliseDegreeCourse(raw: Record<string, unknown>): DegreeProgressCourse {
  return compact({
    code: text(pick(raw, "kcdm", "KCDM", "kcbh", "KCBH")),
    name: text(pick(raw, "kcmc", "KCMC")),
    group: text(pick(raw, "kzmc", "KZMC", "kzmc_en", "KZMC_EN")),
    college: text(pick(raw, "kkyxmc", "KKYXMC", "yxmc", "YXMC")),
    semester: text(pick(raw, "xnxq", "XNXQ", "xnxqmc", "XNXQMC")),
    letterGrade: text(pick(raw, "xscj", "XSCJ")),
    numericScore: numeric(pick(raw, "zzcj", "ZZCJ")),
    required: boolean(pick(raw, "sfbx", "SFBX")),
    credits: numeric(pick(raw, "xf", "XF")),
    hours: numeric(pick(raw, "zxs", "ZXS", "xs", "XS")),
    courseNature: text(pick(raw, "kcxzmc", "KCXZMC", "kcxz", "KCXZ")),
    category: text(pick(raw, "kclbmc", "KCLBMC", "kclb", "KCLB")),
    majorTrack: text(pick(raw, "zyfxmc", "ZYFXMC")),
  });
}

function hasCourseIdentity(course: DegreeProgressCourse): boolean {
  return Boolean(course.code || course.name);
}

function addDisagreement(
  warnings: DegreeProgressWarning[],
  label: string,
  first: number | undefined,
  second: number | undefined,
): void {
  if (first === undefined || second === undefined || Math.abs(first - second) < 0.000_001) return;
  warnings.push({
    code: "SOURCE_DISAGREEMENT",
    message: `TIS sources disagree on ${label} (${first} versus ${second}); the graduation-requirements overview was retained.`,
  });
}

function records(value: unknown): Record<string, unknown>[] {
  const unwrapped = unwrapDegreeProgressPayload(value);
  if (Array.isArray(unwrapped)) return unwrapped.map(record).filter((entry) => Object.keys(entry).length > 0);
  const outer = record(unwrapped);
  for (const key of ["list", "rows", "data", "content"] as const) {
    const nested = outer[key];
    if (Array.isArray(nested)) return nested.map(record).filter((entry) => Object.keys(entry).length > 0);
  }
  return [];
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function pick(raw: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (raw[key] !== undefined && raw[key] !== null && raw[key] !== "") return raw[key];
    const matching = Object.keys(raw).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
    if (matching && raw[matching] !== undefined && raw[matching] !== null && raw[matching] !== "") return raw[matching];
  }
  return undefined;
}

function text(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const output = String(value).trim();
  return output || undefined;
}

function numeric(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const output = Number(value);
  return Number.isFinite(output) ? output : undefined;
}

function boolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "y", "是", "通过"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "否", "未通过"].includes(normalized)) return false;
  return undefined;
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== "")) as T;
}
