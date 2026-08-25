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

export interface PersonalScheduleEntry {
  rwh: string;
  key: string;
  courseCode: string;
  courseName: string;
  teacher: string;
  room: string;
  description: string;
  descriptionEn: string;
  day?: number;
  periodStart?: number;
  periodEnd?: number;
  weeks: number[];
}

export interface GradeRecord {
  code: string;
  name: string;
  nameEn: string;
  semester: string;
  credits: number;
  letterGrade: string;
  numericScore?: number;
  nature: string;
  department: string;
  gpaPoints?: number;
}

export interface GpaSummary {
  gpa: number;
  credits: number;
  courseCount: number;
}

export interface ExamRecord {
  code: string;
  name: string;
  date: string;
  weekday: string;
  weekdayEn: string;
  time: string;
  periodStart?: number;
  periodEnd?: number;
  building: string;
  room: string;
  campus: string;
  type: string;
  semester: string;
}
