import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { CliError } from "../core/errors.js";
import type { Semester } from "../core/semester.js";
import { TisSession } from "./auth.js";
import {
  degreeProgressErrorMessage,
  degreeProgressPage,
  normaliseTisDegreeProgress,
  progressRows,
  unwrapDegreeProgressPayload,
  type DegreeProgressSourceName,
  type DegreeProgressSourceStatus,
  type TisDegreeProgress,
} from "./degree-progress.js";
import {
  normaliseCourse,
  normaliseExam,
  normaliseGrade,
  normalisePersonalScheduleEntry,
} from "./normalise.js";
import type { SelectionPreview } from "./remaining-selection.js";
import type {
  Course,
  ExamRecord,
  GradeRecord,
  PersonalScheduleEntry,
  TisWriteResult,
} from "./types.js";

const CATALOG_TTL_MS = 60 * 60 * 1000;
const DEGREE_PROGRESS_PAGE = "/cjgl/grcjcx/cjxqList";
const DEGREE_PROGRESS_API = "/cjgl/cjzhtjcx/cjcx";

interface CatalogCache {
  savedAt: number;
  courses: Course[];
}

export interface TisSelectionState {
  currentTerm: Record<string, unknown>;
  courses: Course[];
  total: number;
  enrolled: Record<string, unknown>[];
  cart: Record<string, unknown>[];
  round: Record<string, unknown>;
}

export class TisClient {
  public constructor(private readonly session: TisSession) {}

  public async searchCatalog(
    semester: Semester,
    options: { keyword?: string; limit: number; refresh?: boolean },
  ): Promise<{ courses: Course[]; total: number; source: "cache" | "live" }> {
    const { courses: allCourses, source } = await this.catalog(semester, options.refresh);

    const keyword = options.keyword?.trim().toLowerCase() ?? "";
    const matches = keyword
      ? allCourses.filter((course) => searchable(course).includes(keyword))
      : allCourses;
    return { courses: matches.slice(0, options.limit), total: matches.length, source };
  }

  public async catalog(
    semester: Semester,
    refresh = false,
  ): Promise<{ courses: Course[]; source: "cache" | "live" }> {
    const cache = refresh ? undefined : await readCatalogCache(semester);
    if (cache) return { courses: cache, source: "cache" };
    const courses = await this.fetchCatalog(semester);
    await writeCatalogCache(semester, courses);
    return { courses, source: "live" };
  }

  public async searchAvailable(
    semester: Semester,
    options: { keyword?: string; round: string; limit: number },
  ): Promise<{ courses: Course[]; total: number; enrolled: unknown[]; cart: unknown[]; round: Record<string, unknown> }> {
    const state = await this.selectionState(semester, options);
    return {
      courses: state.courses,
      total: state.total,
      enrolled: state.enrolled,
      cart: state.cart,
      round: state.round,
    };
  }

  public async currentTerm(): Promise<Record<string, unknown>> {
    return asRecord(await this.session.postForm("/Xsxk/queryXkdqXnxq", {}));
  }

  public async selectionState(
    semester: Semester,
    options: { keyword?: string; round: string; limit: number; cultivation?: "1" | "2" } ,
  ): Promise<TisSelectionState> {
    const dq = await this.currentTerm();
    const raw = asRecord(
      await this.session.postForm("/Xsxk/queryKxrw", {
        p_pylx: options.cultivation ?? "1",
        p_sfgldjr: "",
        p_sfredis: "",
        p_sfsyxkgwc: "1",
        p_chaxunxh: "",
        p_gjz: options.keyword ?? "",
        p_skjs: "",
        p_xn: semester.xn,
        p_xq: semester.xq,
        p_xnxq: "",
        p_dqxn: stringValue(dq.p_dqxn),
        p_dqxq: stringValue(dq.p_dqxq),
        p_dqxnxq: stringValue(dq.p_dqxnxq),
        p_xkfsdm: options.round,
        p_xiaoqu: "",
        p_kkyx: "",
        p_kclb: "",
        p_sfhlctkc: "0",
        p_sfhllrlkc: "0",
        p_kxsj_xqj: "",
        p_kxsj_ksjc: "",
        p_kxsj_jsjc: "",
        p_skyy: "",
        p_sfmxzj: "0",
        cxsfmt: stringValue(dq.cxsfmt) || "0",
        mxpylx: options.cultivation ?? "1",
        pageNum: "1",
        pageSize: String(options.limit),
      }),
    );
    if (stringValue(raw.jg) !== "1") {
      throw new CliError(
        stringValue(raw.message) || "TIS course selection is unavailable.",
        "SELECTION_UNAVAILABLE",
        1,
        { round: options.round, tisCode: stringValue(raw.jg) },
      );
    }
    const list = asRecord(raw.kxrwList);
    const directRound = asRecord(raw.xkgzszOne);
    const currentRound = Object.keys(directRound).length > 0
      ? directRound
      : asRecord(asRecord(raw.xsxkPage).xkgzszOne);
    return {
      currentTerm: dq,
      courses: asRecords(list.list).map(normaliseCourse),
      total: numberValue(list.total) ?? 0,
      enrolled: asRecords(raw.yxkcList),
      cart: asRecords(raw.xkgwcList),
      round: currentRound,
    };
  }

  public async enrolled(semester: Semester): Promise<PersonalScheduleEntry[]> {
    const response = await this.session.postForm("/xszykb/queryxszykbzong", { xn: semester.xn, xq: semester.xq });
    return asRecords(response).map(normalisePersonalScheduleEntry);
  }

  public async schedule(semester: Semester, week?: number): Promise<PersonalScheduleEntry[]> {
    const response = week === undefined
      ? await this.session.postForm("/xszykb/queryxszykbzong", { xn: semester.xn, xq: semester.xq })
      : await this.session.postForm("/xszykb/queryxszykbzhou", { xn: semester.xn, xq: semester.xq, zc: week });
    return asRecords(response).map(normalisePersonalScheduleEntry);
  }

  public async currentWeek(): Promise<number> {
    const raw = (await this.session.postText("/component/querydangqianzc")).trim();
    const week = Number(raw);
    if (!Number.isSafeInteger(week) || week < 1 || week > 36) {
      throw new CliError("TIS returned an invalid current week.", "TIS_PROTOCOL_ERROR", 1, { received: raw });
    }
    return week;
  }

  public async grades(semester?: Semester): Promise<GradeRecord[]> {
    const response = asRecord(await this.session.postJson("/cjgl/grcjcx/grcjcx", {
      xn: null,
      xq: null,
      kcmc: null,
      cxbj: "-1",
      pylx: "1",
      current: 1,
      pageSize: 500,
    }));
    const grades = asRecords(asRecord(response.content).list).map(normaliseGrade);
    return semester ? grades.filter((grade) => semesterMatches(grade.semester, semester)) : grades;
  }

  public async exams(): Promise<ExamRecord[]> {
    const response = await this.session.postJson("/component/queryKsxxByXs", {});
    return asRecords(response)
      .map(normaliseExam)
      .sort((left, right) => `${left.date} ${left.time}`.localeCompare(`${right.date} ${right.time}`));
  }

  public async degreeProgress(options: { details?: boolean } = {}): Promise<TisDegreeProgress> {
    await this.session.getText(DEGREE_PROGRESS_PAGE);

    let pylx = "1";
    try {
      const me = asRecord(await this.session.getJson("/user/me"));
      pylx = firstString(me, "pylx", "PYLX", "pylxdm", "PYLXDM")
        || (firstString(me, "pyccm", "PYCCM") === "2" ? "2" : "1");
    } catch {
      // The progress context endpoint can still resolve an undergraduate plan without /user/me.
    }

    const contextPayload = unwrapDegreeProgressPayload(
      await this.session.postJson(`${DEGREE_PROGRESS_API}/getXss`, { pylx }),
    );
    const contextRows = progressRows(contextPayload);
    const selected = contextRows.find((row) => firstString(row, "fah", "FAH", "xjid", "XJID"))
      ?? contextRows[0];
    if (!selected) {
      throw new CliError(
        "TIS did not return a cultivation-plan context for this account.",
        "TIS_DEGREE_PROGRESS_CONTEXT_UNAVAILABLE",
        1,
      );
    }
    const context = lowerCaseKeys(selected);
    if (!firstString(context, "pylx")) context.pylx = pylx;

    const sourceStatuses = initialDegreeProgressStatuses(options.details === true);
    const read = async (
      source: DegreeProgressSourceName,
      operation: () => Promise<unknown>,
    ): Promise<unknown> => {
      try {
        const payload = unwrapDegreeProgressPayload(await operation());
        const count = degreeProgressPayloadCount(payload);
        sourceStatuses[source] = {
          state: count > 0 ? "available" : "empty",
          count,
        };
        return payload;
      } catch (error) {
        sourceStatuses[source] = {
          state: "error",
          message: degreeProgressErrorMessage(error),
        };
        return undefined;
      }
    };

    const [graduationRequirements, requirementSummary, creditCategories, moduleRequirements] = await Promise.all([
      read("graduationRequirements", () => this.session.postJson(`${DEGREE_PROGRESS_API}/querybyyq`, { ...context })),
      read("requirementSummary", () => this.session.postJson(`${DEGREE_PROGRESS_API}/queryBxkqk`, { ...context })),
      read("creditCategories", () => this.fetchDegreeProgressPages(`${DEGREE_PROGRESS_API}/queryXflbyq`, context, 200)),
      read("moduleRequirements", () => this.session.postJson(`${DEGREE_PROGRESS_API}/queryMkyq`, { ...context })),
    ]);
    const courses = options.details
      ? await read("courses", () => this.fetchDegreeProgressPages(`${DEGREE_PROGRESS_API}/queryFaKzkc`, context, 500))
      : undefined;

    const progress = normaliseTisDegreeProgress({
      context,
      graduationRequirements,
      requirementSummary,
      creditCategories,
      moduleRequirements,
      courses,
      detailsIncluded: options.details === true,
      sourceStatuses,
    });
    const availableSources = Object.values(sourceStatuses)
      .filter((status) => status.state === "available" || status.state === "empty").length;
    if (!progress.dataAvailable) {
      const unavailable = availableSources === 0;
      throw new CliError(
        unavailable
          ? "TIS degree-progress sources could not be read."
          : "TIS degree-progress sources returned no usable plan data for this account.",
        unavailable ? "TIS_DEGREE_PROGRESS_UNAVAILABLE" : "TIS_DEGREE_PROGRESS_NO_DATA",
        1,
        { sourceStatuses },
      );
    }
    return progress;
  }

  public async addCourse(input: {
    semester: Semester;
    courseId: string;
    round: string;
    bid: number;
    cultivation: "1" | "2";
  }): Promise<TisWriteResult> {
    const dq = asRecord(await this.session.postForm("/Xsxk/queryXkdqXnxq", {}));
    const response = asRecord(
      await this.session.postForm(
        "/Xsxk/addXuanke",
        buildWritePayload(input, dq),
      ),
    );
    return { jg: stringValue(response.jg), message: stringValue(response.message), raw: response };
  }

  public async selectionWrite(preview: SelectionPreview): Promise<TisWriteResult> {
    if (!selectionWriteAllowed(preview)) {
      throw new CliError("Unsupported TIS selection mutation endpoint.", "UNSUPPORTED_SELECTION_OPERATION", 2, {
        operation: preview.operation,
        endpoint: preview.endpoint,
      });
    }
    const response = asRecord(await this.session.postForm(preview.endpoint, preview.payload));
    return { jg: stringValue(response.jg), message: stringValue(response.message), raw: response };
  }

  private async fetchCatalog(semester: Semester): Promise<Course[]> {
    const courses: Course[] = [];
    const pageSize = 500;
    for (let page = 1; page <= 100; page += 1) {
      const response = asRecord(
        await this.session.postForm("/Xsxktz/queryRwxxcxList", {
          p_xn: semester.xn,
          p_xq: semester.xq,
          p_xnxq: "",
          p_gjz: "",
          p_xiaoqu: "",
          p_kkyx: "",
          p_rwlx: "",
          p_kclb: "",
          p_kcxz: "",
          p_chaxunpylx: "3",
          pageNum: String(page),
          pageSize: String(pageSize),
        }),
      );
      const list = asRecord(response.rwList);
      const rows = asRecords(list.list);
      courses.push(...rows.map(normaliseCourse));
      const declaredTotal = numberValue(list.total) ?? numberValue(response.total);
      if (rows.length < pageSize || (declaredTotal !== undefined && courses.length >= declaredTotal)) return courses;
      if (page === 100) {
        throw new CliError(
          "TIS catalog exceeded the safe pagination limit.",
          "TIS_PAGINATION_LIMIT",
          1,
          { fetched: courses.length, declaredTotal },
        );
      }
      await delay(550);
    }
    return courses;
  }

  private async fetchDegreeProgressPages(
    path: string,
    context: Record<string, unknown>,
    pageSize: number,
  ): Promise<Record<string, unknown>[]> {
    const rows: Record<string, unknown>[] = [];
    for (let page = 1; page <= 20; page += 1) {
      const payload = await this.session.postJson(path, {
        ...context,
        pageNum: page,
        pageSize,
      });
      const result = degreeProgressPage(payload);
      rows.push(...result.rows);
      if (
        result.rows.length < pageSize
        || (result.total !== undefined && rows.length >= result.total)
      ) return rows;
      if (page === 20) {
        throw new CliError(
          "TIS degree-progress data exceeded the safe pagination limit.",
          "TIS_PAGINATION_LIMIT",
          1,
          { path, fetched: rows.length, declaredTotal: result.total },
        );
      }
      await delay(250);
    }
    return rows;
  }
}

export function buildWritePayload(
  input: {
    semester: Semester;
    courseId: string;
    round: string;
    bid: number;
    cultivation: "1" | "2";
  },
  dq: Record<string, unknown>,
): Record<string, string | number | string[]> {
  const { semester, courseId, round, bid, cultivation } = input;
  return {
    cxsfmt: stringValue(dq.cxsfmt) || "0",
    mxpylx: cultivation,
    p_pylx: cultivation,
    p_sfgldjr: "0",
    p_sfredis: "0",
    p_sfsyxkgwc: "0",
    p_xktjz: "gwctjzyx",
    p_chaxunxh: "",
    p_chaxunxkfsdm: "",
    p_gjz: "",
    p_skjs: "",
    p_xn: semester.xn,
    p_xq: semester.xq,
    p_xnxq: `${semester.xn}${semester.xq}`,
    p_dqxn: stringValue(dq.p_dqxn),
    p_dqxq: stringValue(dq.p_dqxq),
    p_dqxnxq: stringValue(dq.p_dqxnxq),
    p_xkfsdm: round,
    p_xiaoqu: "",
    p_kkyx: "",
    p_kclb: "",
    p_xkxs: bid,
    p_dyc: "",
    p_kkxnxq: "",
    p_id: courseId,
    p_ids: [],
    p_sfhlctkc: "0",
    p_sfhllrlkc: "0",
    p_kxsj_xqj: "",
    p_kxsj_ksjc: "",
    p_kxsj_jsjc: "",
    p_kcdm_js: "",
    p_kcdm_cxrw: "",
    p_kcdm_cxrw_zckc: "",
    p_kc_gjz: "",
    p_xzcxtjz_nj: "",
    p_xzcxtjz_yx: "",
    p_xzcxtjz_zy: "",
    p_xzcxtjz_zyfx: "",
    p_xzcxtjz_bj: "",
    p_sfxsgwckb: "1",
    p_skyy: "",
    p_sfmxzj: "",
    pageNum: "1",
    pageSize: "19",
  };
}

function searchable(course: Course): string {
  return [course.code, course.name, course.sectionName, course.rwh, course.college, course.category, course.teachers.join(" ")]
    .join(" ")
    .toLowerCase();
}

async function readCatalogCache(semester: Semester): Promise<Course[] | undefined> {
  const path = cachePath(semester);
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as CatalogCache;
    if (!Array.isArray(parsed.courses) || Date.now() - parsed.savedAt > CATALOG_TTL_MS) return undefined;
    return parsed.courses;
  } catch {
    return undefined;
  }
}

async function writeCatalogCache(semester: Semester, courses: Course[]): Promise<void> {
  const path = cachePath(semester);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify({ savedAt: Date.now(), courses }), "utf8");
  await rename(temporary, path);
}

function cachePath(semester: Semester): string {
  const base = process.env.XDG_CACHE_HOME || join(homedir(), "Library", "Caches");
  return join(base, "sustech-cli", `catalog-${semester.value}.json`);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => item !== null && typeof item === "object") : [];
}

function asUnknownArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function numberValue(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function firstString(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const direct = stringValue(record[key]).trim();
    if (direct) return direct;
    const candidate = Object.keys(record).find((entry) => entry.toLowerCase() === key.toLowerCase());
    const matched = candidate ? stringValue(record[candidate]).trim() : "";
    if (matched) return matched;
  }
  return "";
}

function lowerCaseKeys(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key.toLowerCase(), value]),
  );
}

function initialDegreeProgressStatuses(
  detailsIncluded: boolean,
): Record<DegreeProgressSourceName, DegreeProgressSourceStatus> {
  return {
    graduationRequirements: { state: "not_requested" },
    requirementSummary: { state: "not_requested" },
    creditCategories: { state: "not_requested" },
    moduleRequirements: { state: "not_requested" },
    courses: { state: detailsIncluded ? "not_requested" : "not_requested" },
  };
}

function degreeProgressPayloadCount(payload: unknown): number {
  const rows = progressRows(payload);
  if (rows.length > 0) return rows.length;
  const value = asRecord(payload);
  return Object.keys(value).length > 0 ? 1 : 0;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function semesterMatches(label: string, semester: Semester): boolean {
  const season = semester.xq === "1" ? "秋季" : semester.xq === "2" ? "春季" : "夏季";
  const startYear = semester.xn.slice(0, 4);
  const endYear = semester.xn.slice(5);
  return [semester.value, `${semester.xn}${semester.xq}`, `${startYear}${season}`, `${endYear}${season}`]
    .some((candidate) => label.includes(candidate))
    || (label.includes(semester.xn) && label.includes(season));
}

function selectionWriteAllowed(preview: SelectionPreview): boolean {
  if (preview.operation === "enroll") return preview.endpoint === "/Xsxk/addXuanke";
  if (preview.operation === "drop") return preview.endpoint === "/Xsxk/tuike";
  if (preview.operation === "cart.add") return preview.endpoint === "/Xsxk/addGouwuche";
  if (preview.operation === "cart.remove") return preview.endpoint === "/Xsxk/delGouwuche";
  if (preview.operation === "bid.update") {
    return preview.endpoint === "/Xsxk/addGouwuche" || preview.endpoint === "/Xsxk/updXkxsByyx";
  }
  return false;
}
