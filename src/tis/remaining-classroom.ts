import type { Semester } from "../core/semester.js";
import type { Course, ScheduleSlot } from "./types.js";
import { asRecord, asRecords, numberValue, stringValue, uniqueNumbers } from "./remaining-shared.js";

export interface ClassroomRoom {
  name: string;
  canonicalName: string;
  capacity?: number;
  slotCount: number;
  sectionCount: number;
}

export interface ClassroomOccupancyEntry {
  room: string;
  code: string;
  name: string;
  sectionName: string;
  classGroup: string;
  teachers: string[];
  credits: number;
  capacity?: number;
  slot: ScheduleSlot;
}

export interface ClassroomAvailabilityQuery {
  week: number;
  day: number;
  periodStart: number;
  periodEnd: number;
}

export interface ClassroomLiveEntry {
  roomCode: string;
  weekday: number;
  periodStart: number;
  periodEnd: number;
  weeks: number[];
  kind: "course" | "borrowing" | "unknown";
  borrower?: string;
  phone?: string;
  courseCode?: string;
  courseName?: string;
  purpose?: string;
  rawText: string;
  source: Record<string, unknown>;
}

export interface ClassroomLiveSession {
  postForm(path: string, data: Record<string, string | number | string[]>): Promise<unknown>;
}

interface ParsedLiveScheduleText {
  periodStart?: number;
  periodEnd?: number;
  weeks: number[];
  kind: "course" | "borrowing" | "unknown";
  borrower?: string;
  phone?: string;
  courseName?: string;
  rawText: string;
}

const DAY_NAMES = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"] as const;
const BUILDING_ALIASES: Readonly<Record<string, string>> = {
  "三教": "智华楼",
  "智华": "智华楼",
  "智华楼": "智华楼",
};

const LIVE_KEY_RE = /^xq(\d+)_jc(\d+)$/;
const LIVE_WEEK_RE = /\[([0-9,\-]+)周\]/;
const LIVE_PERIOD_RE = /(?:第|\[J)(\d+)(?:-(\d+))?(?:节|\])/;
const LIVE_TYPE_RE = /^【(借用|本|研|研本|本研|其他)】/;
const LIVE_BORROWER_RE = /使用人[:：]([^\n]+)/;
const LIVE_PHONE_RE = /联系电话[:：]([0-9\-\s]+)/;
const LIVE_COURSE_NAME_RE = /^【[^】]+】([^\[\n]+)/;

export class ClassroomDirectory {
  private readonly roomEntries = new Map<string, ClassroomOccupancyEntry[]>();
  private readonly roomsByCanonical = new Map<string, ClassroomRoom>();

  public constructor(courses: readonly Course[]) {
    const sectionKeysByRoom = new Map<string, Set<string>>();
    for (const course of courses) {
      for (const slot of course.schedule) {
        const room = normaliseRoomName(slot.room);
        if (!room) continue;
        const entry: ClassroomOccupancyEntry = {
          room,
          code: course.code,
          name: course.name,
          sectionName: course.sectionName,
          classGroup: course.classGroup,
          teachers: [...course.teachers],
          credits: course.credits,
          capacity: course.capacity,
          slot: { ...slot, room },
        };
        const canonical = canonicalRoomKey(room);
        const roomEntries = this.roomEntries.get(canonical) ?? [];
        roomEntries.push(entry);
        this.roomEntries.set(canonical, roomEntries);

        const sectionKeys = sectionKeysByRoom.get(canonical) ?? new Set<string>();
        sectionKeys.add(sectionIdentity(course));
        sectionKeysByRoom.set(canonical, sectionKeys);

        const previous = this.roomsByCanonical.get(canonical);
        const capacity = maxNumber(previous?.capacity, course.capacity);
        this.roomsByCanonical.set(canonical, {
          name: room,
          canonicalName: canonical,
          capacity,
          slotCount: (previous?.slotCount ?? 0) + 1,
          sectionCount: sectionKeys.size,
        });
      }
    }

    for (const [canonical, entries] of this.roomEntries.entries()) {
      this.roomEntries.set(
        canonical,
        [...entries].sort((left, right) => compareSlots(left.slot, right.slot) || left.code.localeCompare(right.code)),
      );
    }
  }

  public rooms(): ClassroomRoom[] {
    return [...this.roomsByCanonical.values()].sort((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN"));
  }

  public roomByName(name: string): ClassroomRoom | undefined {
    return this.roomsByCanonical.get(canonicalRoomKey(name));
  }

  public searchRooms(keyword: string): ClassroomRoom[] {
    const needle = keyword.trim().toLowerCase();
    if (!needle) return this.rooms();
    return this.rooms().filter((room) => room.name.toLowerCase().includes(needle));
  }

  public occupancy(roomName: string, options: { week: number; day: number; periodStart?: number; periodEnd?: number }): ClassroomOccupancyEntry[] {
    const entries = this.roomEntries.get(canonicalRoomKey(roomName)) ?? [];
    return entries.filter((entry) => slotMatches(entry.slot, options.week, options.day, options.periodStart, options.periodEnd));
  }

  public freeRooms(query: ClassroomAvailabilityQuery): ClassroomRoom[] {
    return this.rooms().filter((room) => this.occupancy(room.name, query).length === 0);
  }
}

export function buildClassroomDirectory(courses: readonly Course[]): ClassroomDirectory {
  return new ClassroomDirectory(courses);
}

export function normaliseRoomName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, "");
  if (!trimmed) return "";
  for (const alias of Object.keys(BUILDING_ALIASES).sort((left, right) => right.length - left.length)) {
    if (trimmed.startsWith(alias)) return `${BUILDING_ALIASES[alias]}${trimmed.slice(alias.length)}`;
  }
  return trimmed;
}

export function expandWeekPattern(pattern: string): number[] {
  const values: number[] = [];
  for (const chunk of pattern.split(",")) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    if (trimmed.includes("-")) {
      const [left, right] = trimmed.split("-", 2).map((entry) => Number(entry));
      if (Number.isFinite(left) && Number.isFinite(right)) {
        const start = Math.min(left, right);
        const end = Math.max(left, right);
        for (let value = start; value <= end; value += 1) values.push(value);
      }
      continue;
    }
    const value = Number(trimmed);
    if (Number.isFinite(value)) values.push(value);
  }
  return uniqueNumbers(values);
}

export function parseLiveRoomEntry(raw: Record<string, unknown>, roomCode: string): ClassroomLiveEntry | undefined {
  const key = stringValue(raw.KEY);
  const match = LIVE_KEY_RE.exec(key);
  if (!match) return undefined;
  const parsed = parseLiveScheduleText(stringValue(raw.SKSJ));
  if (!parsed) return undefined;
  const periodStart = parsed.periodStart ?? Number(match[2]);
  const periodEnd = parsed.periodEnd ?? periodStart;
  return {
    roomCode,
    weekday: Number(match[1]),
    periodStart,
    periodEnd,
    weeks: parsed.weeks,
    kind: parsed.kind,
    borrower: parsed.borrower,
    phone: parsed.phone,
    courseCode: stringValue(raw.KCDM) || undefined,
    courseName: parsed.courseName,
    purpose: stringValue(raw.SKSJ_EN) || undefined,
    rawText: parsed.rawText,
    source: raw,
  };
}

export function parseLiveScheduleText(value: string): ParsedLiveScheduleText | undefined {
  const rawText = value.trim();
  if (!rawText) return undefined;
  const type = LIVE_TYPE_RE.exec(rawText)?.[1] ?? "";
  const kind = type === "借用"
    ? "borrowing"
    : type === "本" || type === "研" || type === "研本" || type === "本研"
      ? "course"
      : "unknown";
  const weeks = expandWeekPattern(LIVE_WEEK_RE.exec(rawText)?.[1] ?? "");
  const periodMatch = LIVE_PERIOD_RE.exec(rawText);
  return {
    periodStart: periodMatch ? Number(periodMatch[1]) : undefined,
    periodEnd: periodMatch?.[2] ? Number(periodMatch[2]) : periodMatch ? Number(periodMatch[1]) : undefined,
    weeks,
    kind,
    borrower: stringValue(LIVE_BORROWER_RE.exec(rawText)?.[1]) || undefined,
    phone: stringValue(LIVE_PHONE_RE.exec(rawText)?.[1]) || undefined,
    courseName: stringValue(LIVE_COURSE_NAME_RE.exec(rawText)?.[1]) || undefined,
    rawText,
  };
}

export async function fetchLiveRoomSchedule(
  session: ClassroomLiveSession,
  semester: Semester,
  roomCode: string,
): Promise<ClassroomLiveEntry[]> {
  const response = await session.postForm("/cdkb/querycdkbList", {
    cddm: roomCode,
    xn: semester.xn,
    xq: semester.xq,
  });
  return asRecords(response)
    .map((entry) => parseLiveRoomEntry(entry, roomCode))
    .filter((entry): entry is ClassroomLiveEntry => entry !== undefined)
    .sort((left, right) => left.weekday - right.weekday || left.periodStart - right.periodStart || left.rawText.localeCompare(right.rawText));
}

export function summariseLiveOccupancy(
  entries: readonly ClassroomLiveEntry[],
  query: ClassroomAvailabilityQuery,
): ClassroomLiveEntry[] {
  return entries.filter((entry) => {
    if (entry.weekday !== query.day) return false;
    if (!entry.weeks.includes(query.week)) return false;
    return entry.periodEnd >= query.periodStart && query.periodEnd >= entry.periodStart;
  });
}

export function roomCodesFromLiveRows(rows: readonly Record<string, unknown>[]): string[] {
  return [...new Set(rows.map((row) => stringValue(row.CDDM)).filter(Boolean))].sort();
}

export function roomLabelFromLiveRows(rows: readonly Record<string, unknown>[]): string | undefined {
  const labels = rows
    .map((row) => stringValue(row.CDMC) || stringValue(row.CDMC_EN))
    .filter(Boolean);
  return labels[0];
}

export function liveRoomMetadata(rows: readonly Record<string, unknown>[]): { roomCode?: string; roomLabel?: string; declaredCapacity?: number } {
  const first = rows[0] ? asRecord(rows[0]) : {};
  return {
    roomCode: stringValue(first.CDDM) || undefined,
    roomLabel: roomLabelFromLiveRows(rows),
    declaredCapacity: numberValue(first.ZWS) ?? numberValue(first.JSZW),
  };
}

export function dayName(day: number): string {
  return DAY_NAMES[day] ?? `星期${day}`;
}

function sectionIdentity(course: Course): string {
  return course.rwh || `${course.code}/${course.classGroup}/${course.sectionName}`;
}

function canonicalRoomKey(name: string): string {
  return normaliseRoomName(name).toLowerCase();
}

function slotMatches(
  slot: ScheduleSlot,
  week: number,
  day: number,
  periodStart?: number,
  periodEnd?: number,
): boolean {
  if (slot.day !== day) return false;
  if (!slot.weeks.includes(week)) return false;
  if (periodStart === undefined || periodEnd === undefined) return true;
  return slot.periodEnd >= periodStart && periodEnd >= slot.periodStart;
}

function compareSlots(left: ScheduleSlot, right: ScheduleSlot): number {
  return left.day - right.day
    || left.periodStart - right.periodStart
    || left.periodEnd - right.periodEnd
    || left.room.localeCompare(right.room, "zh-Hans-CN");
}

function maxNumber(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return Math.max(left, right);
}
