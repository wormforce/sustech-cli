import { CliError } from "./errors.js";

export interface Semester {
  xn: string;
  xq: "1" | "2" | "3";
  value: string;
}

export function currentSemester(today = new Date()): Semester {
  const year = today.getFullYear();
  const month = today.getMonth() + 1;

  if (month >= 9) {
    return makeSemester(year, year + 1, "1");
  }
  if (month <= 6) {
    return makeSemester(year - 1, year, "2");
  }
  return makeSemester(year - 1, year, "3");
}

export function parseSemester(value: string | undefined): Semester {
  if (!value) return currentSemester();
  const match = /^(\d{4})-(\d{4})-([123])$/.exec(value);
  if (!match) {
    throw new CliError(
      "--semester must be YYYY-YYYY-N, for example 2025-2026-3.",
      "INVALID_SEMESTER",
      2,
      { received: value },
    );
  }
  return makeSemester(Number(match[1]), Number(match[2]), match[3] as Semester["xq"]);
}

export function semesterFromCurrentTerm(value: Record<string, unknown>): Semester {
  const xn = firstText(value, "p_dqxn", "P_DQXN", "dqxn", "DQXN", "xn", "XN");
  const xq = firstText(value, "p_dqxq", "P_DQXQ", "dqxq", "DQXQ", "xq", "XQ");
  if (!/^\d{4}-\d{4}$/.test(xn) || !["1", "2", "3"].includes(xq)) {
    throw new CliError(
      "TIS current-term metadata did not contain a usable semester.",
      "TIS_CURRENT_TERM_INVALID",
      1,
      {
        p_dqxn: xn || undefined,
        p_dqxq: xq || undefined,
      },
    );
  }
  return makeSemester(Number(xn.slice(0, 4)), Number(xn.slice(5)), xq as Semester["xq"]);
}

function makeSemester(startYear: number, endYear: number, xq: Semester["xq"]): Semester {
  const xn = `${startYear}-${endYear}`;
  return { xn, xq, value: `${xn}-${xq}` };
}

function firstText(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = typeof record[key] === "string" ? record[key].trim() : "";
    if (value) return value;
  }
  return "";
}
