import type { Course, ScheduleSlot } from "./types.js";

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

function decodeEntities(value: string): string {
  return value.replaceAll("&nbsp;", " ").replaceAll("&amp;", "&");
}
