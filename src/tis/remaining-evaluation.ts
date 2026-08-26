import { CliError } from "../core/errors.js";
import { asRecord, asRecords, asStringArray, compactSemester, stringValue } from "./remaining-shared.js";

export type EvaluationStatusFilter = "all" | "pending" | "draft" | "submitted";
export type EvaluationQuestionKind = "rating" | "text" | "choice" | "unknown";

export interface EvaluationRequester {
  getJson(path: string, params: Record<string, string>): Promise<unknown>;
}

export interface EvaluationTaskCategory {
  taskId: string;
  firstQuestionnaireId: string;
  title: string;
  taskType: string;
}

export interface EvaluationCourseStatus {
  taskId: string;
  taskType: string;
  semester: string;
  questionnaireId: string;
  relationId: string;
  courseCode: string;
  courseName: string;
  classInfo: string;
  department: string;
  teacherDepartmentCode: string;
  rawStatus: string;
  statusText: string;
  submitted: boolean;
  deadline?: string;
  rwh: string;
  questionnaireUuid?: string;
}

export interface EvaluationSummary {
  total: number;
  pending: number;
  draft: number;
  submitted: number;
}

export interface EvaluationQuestionBlock {
  title: string;
  order?: number;
  questions: EvaluationQuestion[];
}

export interface EvaluationQuestion {
  id: string;
  text: string;
  kind: EvaluationQuestionKind;
  maxScore?: number;
  options: string[];
  rawType: string;
}

export class EvaluationStatusClient {
  public constructor(
    private readonly requester: EvaluationRequester,
    private readonly userId: string,
  ) {}

  public async categories(): Promise<EvaluationTaskCategory[]> {
    const response = asRecord(await this.requester.getJson("/personnelEvaluation/listObtainPersonnelEvaluationTasks", {
      yhdm: this.userId,
      rwmc: "",
      sfyp: "0",
      pageNum: "1",
      pageSize: "20",
    }));
    const list = asRecords(asRecord(response.result).list);
    return list.map(normaliseCategory);
  }

  public async listCourses(semester: string, status: EvaluationStatusFilter = "all"): Promise<EvaluationCourseStatus[]> {
    const compact = compactSemester(semester);
    const categories = await this.categories();
    const results: EvaluationCourseStatus[] = [];
    for (const category of categories) {
      const response = asRecord(await this.requester.getJson("/personnelEvaluation/listEcaluationRalationshipEnriry", {
        pjrdm: this.userId,
        wjid: category.firstQuestionnaireId,
        bpmc: "",
        sfyp: "0",
        xnxq: compact,
        pageNum: "1",
        pageSize: "50",
        zc: "",
        xqj: "",
        jc: "",
        skdd: "",
        kkyxdm: "",
        bpssyxdm: "",
        kcmc: "",
        sfcxqbwj: "0",
        rwid: category.taskId,
        lsjgzt: "",
      }));
      const code = stringValue(response.code);
      if (code && code !== "200") continue;
      const rows = asRecords(asRecord(response.result).list);
      for (const row of rows) results.push(normaliseCourseStatus(row, category, semester));
    }
    return results.filter((row) => matchesStatus(row, status));
  }
}

export function summariseEvaluationStatuses(rows: readonly EvaluationCourseStatus[]): EvaluationSummary {
  let pending = 0;
  let draft = 0;
  let submitted = 0;
  for (const row of rows) {
    if (row.rawStatus === "0" || row.rawStatus === "4") pending += 1;
    else if (row.rawStatus === "3") draft += 1;
    else if (row.submitted) submitted += 1;
  }
  return { total: rows.length, pending, draft, submitted };
}

export function parseEvaluationQuestionBlocks(snapshot: Record<string, unknown>): EvaluationQuestionBlock[] {
  const wjlist = asRecords(snapshot.wjlist);
  const entity = asRecord(asRecord(wjlist[0]).pjxtWjWjbReturnEntity);
  const blocks = asRecords(entity.wjzblist);
  return blocks.map((block) => ({
    title: stringValue(block.zmc) || "Untitled Block",
    order: numericOrder(block.zxssx),
    questions: asRecords(block.tklist).map(normaliseQuestion),
  }));
}

function normaliseCategory(value: Record<string, unknown>): EvaluationTaskCategory {
  const title = stringValue(value.rwmc);
  return {
    taskId: stringValue(value.rwid),
    firstQuestionnaireId: stringValue(value.firstwjid),
    title,
    taskType: inferTaskType(title),
  };
}

function normaliseCourseStatus(
  value: Record<string, unknown>,
  category: EvaluationTaskCategory,
  semester: string,
): EvaluationCourseStatus {
  const rawStatus = stringValue(value.lsjgzt) || "0";
  return {
    taskId: category.taskId,
    taskType: category.taskType,
    semester,
    questionnaireId: stringValue(value.wjid),
    relationId: stringValue(value.jgwid),
    courseCode: stringValue(value.kcdm),
    courseName: stringValue(value.kcmc) || stringValue(value.kcmc_en),
    classInfo: stringValue(value.bj),
    department: stringValue(value.yxmc),
    teacherDepartmentCode: stringValue(value.bpdm),
    rawStatus,
    statusText: statusText(rawStatus),
    submitted: rawStatus === "2" || rawStatus === "5",
    deadline: stringValue(value.jzsj) || undefined,
    rwh: stringValue(value.rwh),
    questionnaireUuid: stringValue(value.sxz) || undefined,
  };
}

function matchesStatus(row: EvaluationCourseStatus, status: EvaluationStatusFilter): boolean {
  switch (status) {
    case "all":
      return true;
    case "pending":
      return row.rawStatus === "0" || row.rawStatus === "4";
    case "draft":
      return row.rawStatus === "3";
    case "submitted":
      return row.submitted;
    default:
      throw new CliError("Unsupported evaluation status filter.", "UNSUPPORTED_EVALUATION_STATUS", 2, { status });
  }
}

function statusText(rawStatus: string): string {
  switch (rawStatus) {
    case "0":
      return "待评价";
    case "1":
      return "已放弃";
    case "2":
    case "5":
      return "已评价";
    case "3":
      return "已保存";
    case "4":
      return "未结课";
    default:
      return `未知(${rawStatus})`;
  }
}

function inferTaskType(title: string): string {
  if (title.includes("理论")) return "理论类";
  if (title.includes("体育")) return "体育类";
  if (title.includes("实验") || title.includes("实践")) return "实验实践类";
  return title || "未知类别";
}

function normaliseQuestion(value: Record<string, unknown>): EvaluationQuestion {
  const options = extractQuestionOptions(value.jsonContent);
  const kind = inferQuestionKind(value.tmlx, options);
  return {
    id: stringValue(value.tmid),
    text: stringValue(value.tgmc),
    kind,
    maxScore: optionalNumber(value.tmfz),
    options,
    rawType: stringValue(value.tmlx),
  };
}

function extractQuestionOptions(jsonContent: unknown): string[] {
  const source = stringValue(jsonContent);
  if (!source) return [];
  try {
    const parsed = JSON.parse(source) as unknown;
    if (Array.isArray(parsed)) return toOptionLabels(parsed);
    return toOptionLabels(asRecord(parsed).options);
  } catch {
    return [];
  }
}

function toOptionLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((option) => {
    if (typeof option === "string") return option;
    if (typeof option === "number") return String(option);
    const record = asRecord(option);
    return stringValue(record.label) || stringValue(record.text) || stringValue(record.value);
  }).filter(Boolean);
}

function inferQuestionKind(rawType: unknown, options: readonly string[]): EvaluationQuestionKind {
  const type = stringValue(rawType);
  if (options.length > 0 && options.every((option) => /^\d+$/.test(option))) return "rating";
  if (options.length > 0) return "choice";
  if (type === "textarea" || type === "text" || type === "6") return "text";
  return options.length === 0 ? "text" : "unknown";
}

function optionalNumber(value: unknown): number | undefined {
  const parsed = Number(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function numericOrder(value: unknown): number | undefined {
  const parsed = Number(stringValue(value));
  return Number.isFinite(parsed) ? parsed : undefined;
}
