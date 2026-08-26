import assert from "node:assert/strict";
import test from "node:test";
import type { Semester } from "../core/semester.js";
import {
  buildClassroomDirectory,
  classroomLiveEntryOutput,
  fetchLiveRoomCatalog,
  fetchLiveRoomSchedule,
  normaliseRoomName,
  parseLiveScheduleText,
  resolveLiveRoom,
  summariseLiveOccupancy,
} from "../tis/remaining-classroom.js";
import type { Course } from "../tis/types.js";

const SEMESTER: Semester = { xn: "2025-2026", xq: "1", value: "2025-2026-1" };

function course(input: Partial<Course> & Pick<Course, "code" | "name" | "sectionName" | "classGroup" | "rwh">): Course {
  return {
    code: input.code,
    name: input.name,
    sectionName: input.sectionName,
    classGroup: input.classGroup,
    rwh: input.rwh,
    id: input.id,
    college: input.college ?? "工学院",
    category: input.category ?? "专业",
    nature: input.nature ?? "必修",
    campus: input.campus ?? "南科大",
    credits: input.credits ?? 3,
    totalHours: input.totalHours ?? 48,
    capacity: input.capacity,
    enrolled: input.enrolled,
    cultivation: input.cultivation ?? "本科",
    taskType: input.taskType ?? "课程",
    language: input.language ?? "中文",
    teachers: input.teachers ?? ["张三"],
    schedule: input.schedule ?? [],
  };
}

test("classroom directory normalises building aliases and answers occupancy/free-room queries", async () => {
  const directory = buildClassroomDirectory([
    course({
      code: "CS101",
      name: "程序设计",
      sectionName: "CS101-001",
      classGroup: "001",
      rwh: "R1",
      capacity: 80,
      schedule: [{ weeks: [1, 2, 3], day: 1, dayName: "周一", periodStart: 3, periodEnd: 4, room: "三教102" }],
    }),
    course({
      code: "MA102",
      name: "高等数学",
      sectionName: "MA102-001",
      classGroup: "001",
      rwh: "R2",
      capacity: 60,
      schedule: [{ weeks: [1, 2, 3], day: 1, dayName: "周一", periodStart: 5, periodEnd: 6, room: "一教101" }],
    }),
  ]);

  assert.equal(normaliseRoomName("三教102"), "智华楼102");
  assert.equal(directory.roomByName("智华102")?.name, "智华楼102");
  assert.equal(directory.occupancy("智华楼102", { week: 2, day: 1 }).length, 1);
  assert.deepEqual(
    directory.freeRooms({ week: 2, day: 1, periodStart: 3, periodEnd: 4 }).map((room) => room.name),
    ["一教101"],
  );
});

test("live classroom rows are parsed into borrowings and can be filtered by active slot", async () => {
  const session = {
    async postForm(): Promise<unknown> {
      return [
        {
          KEY: "xq1_jc3",
          SKSJ: "【借用】[2周]\n使用人:李四\n联系电话:13800000000",
          SKSJ_EN: "Study group",
          KCDM: "jy",
        },
        {
          KEY: "xq1_jc5",
          SKSJ: "【本】程序设计[张三][001][2周][J5-J6节]",
          SKSJ_EN: "Programming",
          KCDM: "CS101",
        },
      ];
    },
  };

  const parsedBorrowing = parseLiveScheduleText("【借用】[2周]\n使用人:李四\n联系电话:13800000000");
  assert.equal(parsedBorrowing?.kind, "borrowing");
  assert.equal(parsedBorrowing?.borrower, "李四");

  const entries = await fetchLiveRoomSchedule(session, SEMESTER, "ROOM-101");
  assert.equal(entries.length, 2);
  const output = classroomLiveEntryOutput(entries[0]);
  assert.equal("phone" in output, false);
  assert.equal("rawText" in output, false);
  assert.equal("source" in output, false);
  assert.deepEqual(
    summariseLiveOccupancy(entries, { week: 2, day: 1, periodStart: 3, periodEnd: 3 }).map((entry) => entry.kind),
    ["borrowing"],
  );
});

test("live classroom catalog resolution keeps ambiguous fuzzy matches unresolved", async () => {
  const session = {
    async postForm(path: string, data: Record<string, string | number | string[]>): Promise<unknown> {
      assert.equal(path, "/component/queryDiDian");
      if (String(data.pageNum) === "1") {
        return {
          total: 2,
          list: [
            { dm: "ROOM-A", mc: "智华楼101", zws: "80" },
            { dm: "ROOM-B", mc: "智华楼102", zws: "90" },
          ],
        };
      }
      return { total: 2, list: [] };
    },
  };

  const rooms = await fetchLiveRoomCatalog(session, SEMESTER);
  assert.equal(rooms.length, 2);
  assert.equal(resolveLiveRoom(rooms, "ROOM-A").status, "resolved");
  const ambiguous = resolveLiveRoom(rooms, "智华");
  assert.equal(ambiguous.status, "ambiguous");
  assert.equal(ambiguous.matches.length, 2);
});
