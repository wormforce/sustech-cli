export interface ScheduleSlot {
  weeks: number[];
  day: number;
  dayName: string;
  periodStart: number;
  periodEnd: number;
  room: string;
}

export interface Course {
  code: string;
  name: string;
  sectionName: string;
  classGroup: string;
  rwh: string;
  id?: string;
  college: string;
  category: string;
  nature: string;
  campus: string;
  credits: number;
  totalHours: number;
  capacity?: number;
  enrolled?: number;
  cultivation: string;
  taskType: string;
  language: string;
  teachers: string[];
  schedule: ScheduleSlot[];
}

export interface TisWriteResult {
  jg: string;
  message: string;
  raw: Record<string, unknown>;
}
