import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { CliError } from "../core/errors.js";
import type { Semester } from "../core/semester.js";
import { TisSession } from "./auth.js";
import { normaliseCourse } from "./normalise.js";
import type { Course, TisWriteResult } from "./types.js";

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
    const cache = options.refresh ? undefined : await readCatalogCache(semester);
    const source: "cache" | "live" = cache ? "cache" : "live";
    const allCourses = cache ?? (await this.fetchCatalog(semester));
    if (!cache) await writeCatalogCache(semester, allCourses);

    const keyword = options.keyword?.trim().toLowerCase() ?? "";
    const matches = keyword
      ? allCourses.filter((course) => searchable(course).includes(keyword))
      : allCourses;
    return { courses: matches.slice(0, options.limit), total: matches.length, source };
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
    const currentRound = asRecord(raw.xkgzszOne) || asRecord(asRecord(raw.xsxkPage).xkgzszOne);
    return {
      courses: asRecords(list.list).map(normaliseCourse),
      total: numberValue(list.total) ?? 0,
      enrolled: asUnknownArray(raw.yxkcList),
      cart: asUnknownArray(raw.xkgwcList),
      round: currentRound,
    };
  }

  public async enrolled(semester: Semester): Promise<unknown[]> {
    const response = await this.session.postForm("/xszykb/queryxszykbzong", { xn: semester.xn, xq: semester.xq });
    return Array.isArray(response) ? response : [];
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
    for (let page = 1; page <= 9; page += 1) {
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
      const rows = asRecords(asRecord(response.rwList).list);
      courses.push(...rows.map(normaliseCourse));
      if (rows.length < pageSize) break;
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
  return join(base, "sustech-survival", `catalog-${semester.value}.json`);
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
