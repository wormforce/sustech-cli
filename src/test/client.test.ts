import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Semester } from "../core/semester.js";
import type { TisSession } from "../tis/auth.js";
import { TisClient } from "../tis/client.js";

const SEMESTER: Semester = { xn: "2025-2026", xq: "1", value: "2025-2026-1" };

test("catalog pagination follows the declared total instead of assuming one page is complete", async () => {
  const cacheRoot = await mkdtemp(join(tmpdir(), "sustech-cli-test-"));
  const previousCache = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = cacheRoot;
  let calls = 0;
  const session = {
    async postForm(): Promise<unknown> {
      calls += 1;
      const count = calls === 1 ? 500 : 1;
      return {
        rwList: {
          total: 501,
          list: Array.from({ length: count }, (_, index) => ({
            kcdm: `C${calls}-${index}`,
            kcmc: "Fixture",
            rwh: `R${calls}-${index}`,
          })),
        },
      };
    },
  } as unknown as TisSession;

  try {
    const result = await new TisClient(session).searchCatalog(SEMESTER, { limit: 1000, refresh: true });
    assert.equal(result.total, 501);
    assert.equal(result.courses.length, 501);
    assert.equal(calls, 2);
  } finally {
    if (previousCache === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = previousCache;
    await rm(cacheRoot, { recursive: true, force: true });
  }
});

test("available-course parsing preserves nested round metadata", async () => {
  let calls = 0;
  const session = {
    async postForm(): Promise<unknown> {
      calls += 1;
      if (calls === 1) return { p_dqxn: "2025-2026", p_dqxq: "1", p_dqxnxq: "2025-20261", cxsfmt: "0" };
      return {
        jg: "1",
        kxrwList: { total: 0, list: [] },
        xsxkPage: { xkgzszOne: { xkfsdm: "bxxk", lcmc: "通识必修" } },
      };
    },
  } as unknown as TisSession;
  const result = await new TisClient(session).searchAvailable(SEMESTER, { round: "bxxk", limit: 20 });
  assert.deepEqual(result.round, { xkfsdm: "bxxk", lcmc: "通识必修" });
});

test("grade filtering accepts both compact and descriptive TIS semester labels", async () => {
  const session = {
    async postJson(): Promise<unknown> {
      return {
        content: {
          list: [
            { kcdm: "A", xnxqmc: "2025春季", xf: 3, xscj: "A" },
            { kcdm: "B", xnxqmc: "2025-2026学年春季学期", xf: 3, xscj: "B" },
            { kcdm: "C", xnxqmc: "2025秋季", xf: 3, xscj: "C" },
          ],
        },
      };
    },
  } as unknown as TisSession;
  const spring: Semester = { xn: "2025-2026", xq: "2", value: "2025-2026-2" };
  const grades = await new TisClient(session).grades(spring);
  assert.deepEqual(grades.map((grade) => grade.code), ["A", "B"]);
});
