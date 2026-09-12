import { load } from "cheerio";
import { CliError } from "../core/errors.js";
import type { Semester } from "../core/semester.js";
import type { TisSession } from "./auth.js";
import { normaliseCourse } from "./normalise.js";
import { assertPlanningProjection } from "./planning-projection.js";
import type { Course } from "./types.js";

type RecordValue = Record<string, unknown>;
type SourceStatus = { state: "available" | "empty" | "unavailable" | "not-requested"; errorCode?: string };
export interface CourseDetailOptions { code: string; rwh?: string; round?: string }
export interface PopulationCounts {
  total?: number;
  undergraduate?: number;
  graduate?: number;
  male?: number;
  female?: number;
  internal?: number;
  external?: number;
}
export interface TisCourseDetail {
  semester: Semester;
  course: Course;
  catalog: {
    nameEn?: string;
    credits?: number;
    hours: { total?: number; lecture?: number; laboratory?: number };
    language?: string;
    category?: string;
    assessmentMethod?: string;
    teachingMethod?: string;
  };
  content: Partial<Record<"introduction" | "introductionEn" | "objectives" | "objectivesEn" | "outcomes" | "outcomesEn" | "outline" | "outlineEn" | "readings" | "readingsEn", string>>;
  prerequisites: {
    enabled?: boolean;
    description?: string;
    courses: Array<{ code: string; name: string; credits?: number }>;
  };
  enrollment: {
    source: "available" | "enrolled" | "cart" | "catalog";
    counts: PopulationCounts;
    quotas: PopulationCounts;
    quotaCounts: PopulationCounts;
    undergraduatePercentage?: number;
    status?: { code: string; label: string };
  };
  selection?: { typeCode?: string; typeName?: string; period?: string; startsAt?: string; endsAt?: string };
  attachments: Array<{ kind: "syllabus-zh" | "syllabus-en"; filename: string; url: string; authentication: "tis" }>;
  teachingTeam: Array<{ name: string; role?: string }>;
  notices: Array<{ kind: string; message: string }>;
  sources: Record<"catalog" | "detail" | "enrollment" | "availability" | "prerequisites" | "prerequisiteDescription", SourceStatus>;
  reportedAt: string;
}

type SelectionReader = (options: { keyword: string; round: string; limit: number }) => Promise<RecordValue>;

export function validateCourseDetailOptions(options: CourseDetailOptions): CourseDetailOptions {
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(options.code)) {
    throw new CliError("Supply one exact course code, for example BMEB316.", "USAGE", 2);
  }
  for (const value of [options.rwh, options.round]) {
    if (value !== undefined && (!value.trim() || value.length > 200 || /[\s\x00-\x1f\x7f]/.test(value))) {
      throw new CliError("--rwh and --round must be single identifiers.", "USAGE", 2);
    }
  }
  return { ...options, code: options.code.toUpperCase() };
}

export async function readCourseDetail(
  session: Pick<TisSession, "postForm" | "postJson">,
  semester: Semester,
  input: CourseDetailOptions,
  selectionReader: SelectionReader,
): Promise<TisCourseDetail> {
  const options = validateCourseDetailOptions(input);
  const catalogResponse = record(await session.postForm("/Xsxktz/queryRwxxcxList", {
    p_xn: semester.xn, p_xq: semester.xq, p_xnxq: "", p_gjz: options.code,
    p_xiaoqu: "", p_kkyx: "", p_rwlx: "", p_kclb: "", p_kcxz: "", p_chaxunpylx: "3",
    pageNum: "1", pageSize: "100",
  }));
  const page = record(catalogResponse.rwList);
  if (!Array.isArray(page.list)) throw protocolError();
  const allRows = records(page.list);
  if ((number(page.total) ?? allRows.length) > allRows.length || page.hasNextPage === true) {
    throw new CliError("The catalog result is incomplete; narrow the course query before requesting detail.", "TIS_COURSE_DETAIL_INCOMPLETE");
  }
  const matches = allRows.filter(row => scalar(row.kcdm).toUpperCase() === options.code
    && (!options.rwh || scalar(row.rwh) === options.rwh));
  const tasks = [...new Map(matches.map(row => [scalar(row.rwh), row])).values()];
  if (!tasks.length) throw new CliError("No matching teaching task was returned for this course and semester.", "TIS_COURSE_NOT_FOUND", 1);
  if (tasks.length > 1) {
    const candidates = tasks.map(row => ({ rwh: scalar(row.rwh), name: text(row.rwmc), teachers: text(row.dgjsmc) }));
    throw new CliError(`This course has multiple teaching tasks. Select one with --rwh: ${candidates.map(row => row.rwh).join(", ")}`,
      "TIS_COURSE_AMBIGUOUS", 2, { candidates });
  }
  const task = tasks[0];
  const kcid = scalar(task.kcid);
  const rwh = scalar(task.rwh);
  if (!kcid || !rwh) throw protocolError();
  const detailResponse = record(await session.postForm("/kck/kcxxwh/xsckViewByxk", { kcid, rwh }));
  const detail = record(detailResponse.content);
  const basic = record(detail.kcxxbgbEntity);
  if (String(detailResponse.code) !== "200" || scalar(basic.kcdm).toUpperCase() !== options.code) throw protocolError();
  const syllabus = record(detail.kcdgbentity);
  const sources: TisCourseDetail["sources"] = {
    catalog: { state: "available" }, detail: { state: "available" },
    enrollment: { state: "not-requested" }, availability: { state: "not-requested" },
    prerequisites: { state: "not-requested" }, prerequisiteDescription: { state: "not-requested" },
  };
  async function optional(name: keyof typeof sources, fetch: () => Promise<unknown>): Promise<RecordValue> {
    try {
      const result = record(await fetch());
      // Keep upstream bodies and authentication details out of partial-error output.
      if (result.code !== undefined && String(result.code) !== "200") throw protocolError();
      sources[name] = { state: "available" };
      return result;
    } catch (error) {
      sources[name] = { state: "unavailable", errorCode: error instanceof CliError ? error.code : "TIS_READ_FAILED" };
      return {};
    }
  }
  const sameTask = (row: RecordValue) => scalar(row.rwh) === rwh && scalar(row.kcdm).toUpperCase() === options.code;
  const personal = await optional("enrollment", () => session.postForm("/Xsxk/queryYxkc", { p_xn: semester.xn, p_xq: semester.xq }));
  if (sources.enrollment.state === "available" && !Array.isArray(personal.yxkcList)) {
    sources.enrollment = { state: "unavailable", errorCode: "TIS_COURSE_DETAIL_PROTOCOL_ERROR" };
  }
  const enrolled = records(personal.yxkcList).find(sameTask);
  const cart = records(personal.xkgwcList).find(sameTask);
  if (sources.enrollment.state === "available" && !enrolled && !cart) sources.enrollment = { state: "empty" };
  let available: RecordValue | undefined;
  let round: RecordValue = {};
  if (options.round) {
    const response = await optional("availability", () => selectionReader({ keyword: options.code, round: options.round!, limit: 100 }));
    available = records(record(response.kxrwList).list).find(sameTask);
    round = Object.keys(record(response.xkgzszOne)).length ? record(response.xkgzszOne) : record(record(response.xsxkPage).xkgzszOne);
    if (sources.availability.state === "available" && !available) sources.availability = { state: "empty" };
  }
  const prerequisiteResponse = await optional("prerequisites", () => session.postJson("/kck/xxxxkzkc/queryXxkc", { kcid }));
  const descriptionResponse = await optional("prerequisiteDescription", () => session.postJson("/kck/xxxxkzkc/queryXxkcBySq", { kcdm: options.code }));
  if (sources.prerequisites.state === "available" && !Array.isArray(prerequisiteResponse.list)) {
    sources.prerequisites = { state: "unavailable", errorCode: "TIS_COURSE_DETAIL_PROTOCOL_ERROR" };
  }
  const prerequisites = records(prerequisiteResponse.list).map(row => ({
    code: scalar(row.kcdm), name: text(row.kcmc), ...numericProperty("credits", row.xf),
  })).filter(row => row.code);
  const uniquePrerequisites = [...new Map(prerequisites.map(row => [row.code, row])).values()];
  if (sources.prerequisites.state === "available" && !uniquePrerequisites.length) sources.prerequisites = { state: "empty" };
  const description = text(descriptionResponse.xxkcms) || text(basic.xxkcms);
  if (sources.prerequisiteDescription.state === "available" && !text(descriptionResponse.xxkcms)) sources.prerequisiteDescription = { state: "empty" };

  const live = available ?? enrolled ?? cart;
  const course = normaliseCourse(task);
  // A live teaching task can differ from the course-library description.
  if (live) {
    const normalized = normaliseCourse(live);
    for (const field of ["language", "category", "nature"] as const) if (normalized[field]) course[field] = normalized[field];
  }
  const population = live ?? task;
  const counts = populationCounts(population, ["yxzrs", "bksyxrs", "yjsyxrs", "nansyxrs", "nvsyxrs", "dnyxrs", "dwyxrs"]);
  const quotas = populationCounts(population, ["zrl", "bksrl", "yjsrl", "nansrl", "nvsrl", "dnrl", "dwrl"]);
  const quotaCounts = populationCounts(population, ["yxzrlrs", "bksyxrlrs", "yjsyxrlrs", "nansyxrlrs", "nvsyxrlrs", "dnyxrlrs", "dwyxrlrs"]);
  const notices: TisCourseDetail["notices"] = [];
  for (const [field, kind] of [["xkyq", "selection-note"], ["ctkcxx", "time-conflict"], ["zyslxzqk", "preference-summary"]]) {
    const message = text(population[field]);
    if (message) notices.push({ kind, message });
  }
  if (course.language && text(basic.skyymc) && course.language !== text(basic.skyymc)) {
    notices.push({ kind: "source-difference", message: `Teaching-task language: ${course.language}; course-library language: ${text(basic.skyymc)}.` });
  }
  if (course.category && text(basic.kclbmc) && course.category !== text(basic.kclbmc)) {
    notices.push({ kind: "source-difference", message: `Teaching-task category: ${course.category}; course-library category: ${text(basic.kclbmc)}.` });
  }
  if (counts.total === undefined) notices.push({ kind: "population-unavailable", message: "Live enrollment counts were not returned. Use --round with the relevant selection type to query availability." });
  if (counts.total !== undefined && quotas.total !== undefined && counts.total > quotas.total) notices.push({ kind: "quota-context", message: "Reported enrollment exceeds nominal capacity; the difference is not a personal remaining-seat count." });
  for (const [source, status] of Object.entries(sources)) {
    if (status.state === "unavailable") notices.push({ kind: "source-unavailable", message: `${source}: unavailable (${status.errorCode}).` });
  }
  const attachments: TisCourseDetail["attachments"] = [];
  for (const [field, kind, flag] of [["kczwdgwjm", "syllabus-zh", "zwfj"], ["kcywdgwjm", "syllabus-en", "ywfj"]] as const) {
    const filename = text(syllabus[field]);
    if (filename) attachments.push({ kind, filename, url: `https://tis.sustech.edu.cn/kck/kcxxwh/downFj?${new URLSearchParams({ kcid, fjflag: flag, downFlag: "" })}`, authentication: "tis" });
  }
  if (attachments.length) notices.push({ kind: "syllabus-version", message: "Syllabus attachments are course-library documents; their applicability to this semester has not been verified." });
  const report: TisCourseDetail = {
    semester, course,
    catalog: {
      ...textProperty("nameEn", basic.kcywmc), ...numericProperty("credits", basic.xf),
      hours: { ...numericProperty("total", basic.sjzxs), ...numericProperty("lecture", basic.sjllxs), ...numericProperty("laboratory", basic.sjsyxs) },
      ...textProperty("language", basic.skyymc), ...textProperty("category", basic.kclbmc),
      ...textProperty("assessmentMethod", basic.khfsmc), ...textProperty("teachingMethod", basic.skfsmc),
    },
    content: {
      ...textProperty("introduction", syllabus.kczwjj ?? basic.kczwjj), ...textProperty("introductionEn", syllabus.kcywjj ?? basic.kcywjj),
      ...textProperty("objectives", basic.jxmb), ...textProperty("objectivesEn", basic.jxmb_en),
      ...textProperty("outcomes", basic.ydxxcg), ...textProperty("outcomesEn", basic.ydxxcg_en),
      ...textProperty("outline", basic.kcnr), ...textProperty("outlineEn", basic.kcnr_en),
      ...textProperty("readings", basic.jcjqtzl), ...textProperty("readingsEn", basic.jcjqtzl_en),
    },
    prerequisites: { ...(basic.sfyxxk === "0" || basic.sfyxxk === "1" ? { enabled: basic.sfyxxk === "1" } : {}), ...(description ? { description } : {}), courses: uniquePrerequisites },
    enrollment: {
      source: available ? "available" : enrolled ? "enrolled" : cart ? "cart" : "catalog",
      counts, quotas, quotaCounts,
      ...percentage("undergraduatePercentage", counts.undergraduate, counts.graduate, counts.total),
      ...(enrolled && scalar(enrolled.sxbj) ? { status: enrollmentStatus(scalar(enrolled.sxbj)) } : {}),
    },
    ...(Object.keys(round).length ? { selection: {
      ...textProperty("typeCode", round.xkfsdm), ...textProperty("typeName", round.xkfsmc),
      ...textProperty("period", round.lcmc), ...textProperty("startsAt", round.ksrq), ...textProperty("endsAt", round.jsrq),
    } } : {}),
    attachments,
    teachingTeam: records(detail.kctdwhEntityList).map(row => ({ name: text(row.jsxm), ...textProperty("role", row.sffzrmc) })).filter(row => row.name),
    notices, sources, reportedAt: new Date().toISOString(),
  };
  assertPlanningProjection(report);
  return report;
}

function populationCounts(row: RecordValue, fields: string[]): PopulationCounts {
  const names = ["total", "undergraduate", "graduate", "male", "female", "internal", "external"] as const;
  return Object.fromEntries(names.flatMap((name, i) => {
    const n = number(row[fields[i]]);
    return n !== undefined && Number.isInteger(n) && n >= 0 ? [[name, n]] : [];
  }));
}
function percentage<K extends string>(key: K, part?: number, other?: number, total?: number): Partial<Record<K, number>> {
  return total !== undefined && total > 0 && part !== undefined && other !== undefined && part + other === total
    ? { [key]: Math.round(part / total * 1000) / 10 } as Record<K, number> : {};
}
function enrollmentStatus(code: string): { code: string; label: string } {
  return { code, label: ({ "0": "待生效", "1": "已生效", A: "候补", "-1": "作废" } as Record<string, string>)[code] ?? "未知" };
}
function number(value: unknown): number | undefined {
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  if (typeof value === "string" && !value.trim()) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}
function scalar(value: unknown): string { return typeof value === "string" || typeof value === "number" ? String(value).trim() : ""; }
function record(value: unknown): RecordValue { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {}; }
function records(value: unknown): RecordValue[] { return Array.isArray(value) ? value.filter(row => row && typeof row === "object" && !Array.isArray(row)) : []; }
function text(value: unknown): string {
  const source = scalar(value);
  if (!source) return "";
  const $ = load(source);
  $("script,style,iframe,object").remove();
  $("br").replaceWith("\n");
  $("p,div,li,tr,h1,h2,h3,h4").append("\n");
  return $.root().text().replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, "").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
function textProperty<K extends string>(key: K, value: unknown): Partial<Record<K, string>> { const result = text(value); return result ? { [key]: result } as Record<K, string> : {}; }
function numericProperty<K extends string>(key: K, value: unknown): Partial<Record<K, number>> { const result = number(value); return result !== undefined ? { [key]: result } as Record<K, number> : {}; }
function protocolError(): CliError { return new CliError("TIS did not return the expected course-detail data.", "TIS_COURSE_DETAIL_PROTOCOL_ERROR"); }
