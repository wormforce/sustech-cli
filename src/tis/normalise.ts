import type { Course, ExamRecord, GradeRecord, PersonalScheduleEntry, ScheduleSlot } from "./types.js";

const DAY_CHARS = "一二三四五六日";
const DAY_NAMES = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const SLOT_PATTERN = /^(?<weeks>[\d,-]+)(?<parity>单|双)?周,星期(?<day>[一二三四五六日])第(?<start>\d+)(?:-(?<end>\d+))?节\s+(?<room>.+)$/;

export function normaliseCourse(raw: Record<string, unknown>): Course {
  const schedule = parseSchedule(stringValue(raw.kcxx));
  const rwh = stringValue(raw.rwh);
  const classGroup = stringValue(raw.kxh) || rwh.split("-").at(-1) || "";
  const teachers = splitTeachers(stringValue(raw.dgjsmc));

  return {
    code: stringValue(raw.kcdm),
    name: stringValue(raw.kcmc),
    sectionName: stringValue(raw.rwmc),
    classGroup,
    rwh,
    ...(stringValue(raw.id) ? { id: stringValue(raw.id) } : {}),
    college: stringValue(raw.kkyxmc),
    category: stringValue(raw.kclbmc),
    nature: stringValue(raw.kcxzmc),
    campus: stringValue(raw.xiaoqumc),
    credits: numberValue(raw.xf) ?? 0,
    totalHours: numberValue(raw.zxs) ?? 0,
    ...(numberValue(raw.zrl) !== undefined ? { capacity: numberValue(raw.zrl) } : {}),
    ...(enrolledValue(raw) !== undefined ? { enrolled: enrolledValue(raw) } : {}),
    cultivation: cultivationValue(raw),
    taskType: stringValue(raw.rwlxmc) || stringValue(raw.rwlx),
    language: stringValue(raw.skyymc),
    teachers,
    schedule,
  };
}

export function parseSchedule(kcxx: string): ScheduleSlot[] {
  const slots: ScheduleSlot[] = [];
  const spans = kcxx.matchAll(/<span class="ivu-tag-text">([\s\S]*?)<\/span>/g);
  for (const span of spans) {
    const paragraphs = span[1].matchAll(/<p>([^<]*)<\/p>/g);
    for (const paragraph of paragraphs) {
      const slot = parseScheduleLine(decodeEntities(paragraph[1]).trim());
      if (slot) slots.push(slot);
    }
  }
  return slots;
}

export function parseScheduleLine(line: string): ScheduleSlot | undefined {
  const match = SLOT_PATTERN.exec(line);
  if (!match?.groups) return undefined;

  let weeks = expandWeeks(match.groups.weeks);
  if (match.groups.parity === "单") weeks = weeks.filter((week) => week % 2 === 1);
  if (match.groups.parity === "双") weeks = weeks.filter((week) => week % 2 === 0);
  const day = DAY_CHARS.indexOf(match.groups.day) + 1;
  const periodStart = Number(match.groups.start);
  return {
    weeks,
    day,
    dayName: DAY_NAMES[day] ?? `day${day}`,
    periodStart,
    periodEnd: Number(match.groups.end ?? match.groups.start),
    room: match.groups.room.trim(),
  };
}

export function normalisePersonalScheduleEntry(raw: Record<string, unknown>): PersonalScheduleEntry {
  const key = firstString(raw, ["KEY", "key"]);
  const keyMatch = /^xq(\d+)_jc(\d+)/i.exec(key);
  const weekBitmap = firstString(raw, ["ZC", "zc"]);
  const description = firstString(raw, ["SKSJ", "sksj"]);
  const periodStart = numberValue(raw.KSJC ?? raw.ksjc) ?? (keyMatch ? Number(keyMatch[2]) : undefined);
  const periodEnd = numberValue(raw.JSJC ?? raw.jsjc) ?? periodStart;
  return {
    rwh: firstString(raw, ["RWH", "rwh"]),
    key,
    courseCode: firstString(raw, ["KCDM", "kcdm", "code"]),
    courseName: firstString(raw, ["KCMC", "kcmc", "KCWZSM", "kcwzsm", "name"])
      || description.split("\n")[0]?.trim()
      || "",
    teacher: firstString(raw, ["SKJS", "DGJSMC", "dgjsmc", "teacher"]),
    room: firstString(raw, ["SKDD", "JXDD", "JXCDMC", "room"]),
    description,
    descriptionEn: firstString(raw, ["SKSJ_EN", "sksj_en"]),
    ...(keyMatch ? { day: Number(keyMatch[1]) } : {}),
    ...(periodStart !== undefined ? { periodStart } : {}),
    ...(periodEnd !== undefined ? { periodEnd } : {}),
    weeks: bitmapWeeks(weekBitmap),
  };
}

export function normaliseGrade(raw: Record<string, unknown>): GradeRecord {
  const letterGrade = firstString(raw, ["xscj", "XSCJ"]);
  const numericScore = numberValue(raw.zzcj ?? raw.ZZCJ);
  return {
    code: firstString(raw, ["kcdm", "KCDM"]),
    name: firstString(raw, ["kcmc", "KCMC"]),
    nameEn: firstString(raw, ["kcmc_en", "KCMC_EN"]),
    semester: firstString(raw, ["xnxqmc", "XNXQMC"]),
    credits: numberValue(raw.xf ?? raw.XF) ?? 0,
    letterGrade,
    ...(numericScore !== undefined ? { numericScore } : {}),
    nature: firstString(raw, ["kcxz", "KCXZ"]),
    department: firstString(raw, ["yxmc", "YXMC"]),
    ...(gradePoints(letterGrade, numericScore) !== undefined
      ? { gpaPoints: gradePoints(letterGrade, numericScore) }
      : {}),
  };
}

export function normaliseExam(raw: Record<string, unknown>): ExamRecord {
  return {
    code: firstString(raw, ["KCDM", "kcdm"]),
    name: firstString(raw, ["KCMC", "kcmc"]),
    date: firstString(raw, ["KSRQ", "ksrq"]),
    weekday: firstString(raw, ["XQJMC", "xqjmc"]),
    weekdayEn: firstString(raw, ["XQJMC_EN", "xqjmc_en"]),
    time: firstString(raw, ["KSJTSJ", "ksjtsj"]),
    ...(numberValue(raw.KSJC ?? raw.ksjc) !== undefined ? { periodStart: numberValue(raw.KSJC ?? raw.ksjc) } : {}),
    ...(numberValue(raw.JSJC ?? raw.jsjc) !== undefined ? { periodEnd: numberValue(raw.JSJC ?? raw.jsjc) } : {}),
    building: firstString(raw, ["JXLMC", "jxlmc"]),
    room: firstString(raw, ["JXCDMC", "jxcdmc"]),
    campus: firstString(raw, ["XIAOQUBMC", "xiaoqubmc"]),
    type: firstString(raw, ["KSSJDMC", "kssjdmc"]),
    semester: firstString(raw, ["XNXQMC", "xnxqmc"]),
  };
}

export function gradePoints(letterGrade: string, numericScore?: number): number | undefined {
  const letter = GPA_POINTS[letterGrade.toUpperCase()];
  if (letter !== undefined) return letter;
  if (numericScore === undefined || numericScore < 60 || numericScore > 100) return undefined;
  if (numericScore >= 90) return 4;
  if (numericScore >= 85) return 3.7;
  if (numericScore >= 80) return 3.3;
  if (numericScore >= 77) return 3;
  if (numericScore >= 73) return 2.7;
  if (numericScore >= 70) return 2.3;
  if (numericScore >= 67) return 2;
  if (numericScore >= 63) return 1.7;
  if (numericScore >= 62) return 1;
  return 1;
}

function expandWeeks(value: string): number[] {
  const weeks = new Set<number>();
  for (const part of value.split(",")) {
    const [first, last] = part.split("-").map(Number);
    if (!Number.isInteger(first)) continue;
    if (!Number.isInteger(last)) {
      weeks.add(first);
      continue;
    }
    for (let week = Math.min(first, last); week <= Math.max(first, last); week += 1) {
      weeks.add(week);
    }
  }
  return [...weeks].sort((left, right) => left - right);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function numberValue(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function enrolledValue(raw: Record<string, unknown>): number | undefined {
  for (const key of ["bkrs", "yxrs", "xkrs", "kchsrl", "bkylrs", "yxzrs"]) {
    const value = numberValue(raw[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function cultivationValue(raw: Record<string, unknown>): string {
  const label = stringValue(raw.pylx_label);
  if (label) return label;
  const value = stringValue(raw.pylx);
  return value === "1" ? "本科" : value === "2" ? "研究生" : value;
}

function splitTeachers(value: string): string[] {
  return [...new Set(value.split(/[,，、]/).map((teacher) => teacher.trim()).filter(Boolean))];
}

function firstString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function bitmapWeeks(bitmap: string): number[] {
  return [...bitmap]
    .map((enabled, index) => enabled === "1" && index > 0 ? index : undefined)
    .filter((week): week is number => week !== undefined);
}

const GPA_POINTS: Readonly<Record<string, number>> = {
  "A+": 4,
  A: 3.94,
  "A-": 3.85,
  "B+": 3.73,
  B: 3.55,
  "B-": 3.32,
  "C+": 3.09,
  C: 2.78,
  "C-": 2.42,
  "D+": 2.08,
  D: 1.63,
  "D-": 1.15,
  F: 0,
};

function decodeEntities(value: string): string {
  return value.replaceAll("&nbsp;", " ").replaceAll("&amp;", "&");
}
