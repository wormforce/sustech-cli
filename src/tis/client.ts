import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { CliError } from "../core/errors.js";
import type { Semester } from "../core/semester.js";
import { TisSession } from "./auth.js";
import {
  normaliseCourse,
  normaliseExam,
  normaliseGrade,
  normalisePersonalScheduleEntry,
} from "./normalise.js";
import type {
  Course,
  ExamRecord,
  GradeRecord,
  PersonalScheduleEntry,
  TisWriteResult,
} from "./types.js";

const CATALOG_TTL_MS = 60 * 60 * 1000;

interface CatalogCache {
  savedAt: number;
  courses: Course[];
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
    const dq = asRecord(await this.session.postForm("/Xsxk/queryXkdqXnxq", {}));
    const raw = asRecord(
      await this.session.postForm("/Xsxk/queryKxrw", {
        p_pylx: "1",
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
        mxpylx: "1",
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
      courses: asRecords(list.list).map(normaliseCourse),
      total: numberValue(list.total) ?? 0,
      enrolled: asUnknownArray(raw.yxkcList),
      cart: asUnknownArray(raw.xkgwcList),
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
