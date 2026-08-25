#!/usr/bin/env node
import { parseArgs } from "node:util";
import { inferCommandName } from "./core/argv.js";
import { CAPABILITIES, formatCapabilities } from "./core/capabilities.js";
import { resolveCredentials } from "./core/credentials.js";
import { CliError, ConfirmationRequiredError } from "./core/errors.js";
import {
  inferOutputOptions,
  resolveOutputOptions,
  writeError,
  writeSuccess,
  type OutputFlags,
} from "./core/output.js";
import { parseSemester } from "./core/semester.js";
import {
  formatAuthCheck,
  formatAvailableCourses,
  formatCourseSearch,
  formatEnrolledCourses,
  formatEnrollPreview,
  formatEnrollSuccess,
  formatExams,
  formatGrades,
  formatScheduleEntries,
  formatTimetables,
  formatVersion,
} from "./core/text.js";
import { gradesBySemester, summariseGrades } from "./tis/academics.js";
import { TisSession } from "./tis/auth.js";
import { TisClient } from "./tis/client.js";
import { parseBlockedTime, solveTimetables } from "./tis/planner.js";
import { TransitClient } from "./transit/client.js";
import { formatBusLines, formatBusSchedule, formatFacilities, formatLiveBuses } from "./transit/text.js";

const VERSION = "0.2.0";

const HELP = `sustech — SUSTech services for humans and agents

Usage:
  sustech version [--json|--jsonl]
  sustech capabilities [--json|--jsonl]
  sustech auth check [--credentials-file PATH] [--json|--jsonl]
  sustech tis courses search [KEYWORD] [--semester YYYY-YYYY-N] [--limit N] [--refresh]
  sustech tis courses available [KEYWORD] --round ROUND [--semester YYYY-YYYY-N] [--limit N]
  sustech tis enrolled [--semester YYYY-YYYY-N]
  sustech tis schedule [--semester YYYY-YYYY-N] [--week N|--all]
  sustech tis grades [--semester YYYY-YYYY-N]
  sustech tis exams
  sustech tis timetable CODE... [--semester YYYY-YYYY-N] [--block MON:1-4] [--max N]
  sustech tis enroll preview --course-id TIS_ID --rwh TASK_ID [--round ROUND] [--bid N]
  sustech tis enroll apply --course-id TIS_ID --rwh TASK_ID [--round ROUND] [--bid N] --confirm
  sustech transit facilities
  sustech transit find QUERY [--limit N]
  sustech transit lines [--day workday|holiday]
  sustech transit schedule LINE [--route-index N] [--day workday|holiday]
  sustech transit stops LINE [--direction 0|1]
  sustech transit live

Output:
  Text is the default for people. Agents should pass --json; bulk consumers can pass --jsonl.
  --output text|json|jsonl is the long form. --pretty formats JSON for review.

Credentials:
  Set SUSTECH_SID and SUSTECH_PASSWORD, or use SUSTECH_CREDENTIALS_FILE / --credentials-file.
  A credentials file is exactly one sid:password line. The CLI never writes a password to disk.

Safety:
  "preview" performs no network request. "apply" changes enrollment only with --confirm.
`;

type Values = OutputFlags & {
  semester?: string;
  limit?: string;
  refresh?: boolean;
  round?: string;
  "credentials-file"?: string;
  "course-id"?: string;
  rwh?: string;
  bid?: string;
  confirm?: boolean;
  week?: string;
  all?: boolean;
  max?: string;
  block?: string[];
  day?: string;
  direction?: string;
  "route-index"?: string;
  help?: boolean;
};

async function main(argv: string[]): Promise<void> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        semester: { type: "string" },
        limit: { type: "string" },
        refresh: { type: "boolean", default: false },
        round: { type: "string" },
        "credentials-file": { type: "string" },
        "course-id": { type: "string" },
        rwh: { type: "string" },
        bid: { type: "string" },
        confirm: { type: "boolean", default: false },
        week: { type: "string" },
        all: { type: "boolean", default: false },
        max: { type: "string" },
        block: { type: "string", multiple: true },
        day: { type: "string" },
        direction: { type: "string" },
        "route-index": { type: "string" },
        output: { type: "string" },
        json: { type: "boolean", default: false },
        jsonl: { type: "boolean", default: false },
        pretty: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
    });
  } catch (error) {
    throw new CliError(error instanceof Error ? error.message : String(error), "USAGE", 2, {
      help: "Run `sustech --help` for usage.",
    });
  }
  const values = parsed.values as Values;
  if (values.help || parsed.positionals.length === 0) {
    process.stdout.write(HELP);
    return;
  }
  const output = resolveOutputOptions(values);
  const [group, command, operation] = parsed.positionals;

  if (group === "version" && command === undefined) {
    const data = { version: VERSION, runtime: `node ${process.version}` };
    writeSuccess({ command: "version", data, text: formatVersion(VERSION, data.runtime) }, output);
    return;
  }
  if (group === "capabilities" && command === undefined) {
    const capabilities = [...CAPABILITIES];
    const data = { schemaVersion: "1", outputModes: ["text", "json", "jsonl"], capabilities };
    writeSuccess({
      command: "capabilities",
      data,
      text: formatCapabilities(capabilities),
      items: capabilities,
      summary: { total: capabilities.length, schemaVersion: "1" },
    }, output);
    return;
  }
  if (group === "auth" && command === "check" && operation === undefined) {
    const { session, credentialSource } = await authenticatedSession(values);
    await session.login();
    const data = { authenticated: true, service: "tis", credentialSource, credentialsStored: false };
    writeSuccess({ command: "auth check", data, text: formatAuthCheck(credentialSource) }, output);
    return;
  }
  if (group === "transit") {
    await runTransit(parsed.positionals, values, output);
    return;
  }
  if (group !== "tis") throw usageError(`Unknown command: ${parsed.positionals.join(" ")}`);

  if (command === "courses" && operation === "search") {
    const semester = parseSemester(values.semester);
    const client = await tisClient(values);
    const limit = parsePositiveInteger(values.limit, 50, "--limit");
    if (limit > 1000) throw usageError("--limit cannot exceed 1000.");
    const keyword = parsed.positionals.slice(3).join(" ") || undefined;
    const result = await client.searchCatalog(semester, { keyword, limit, refresh: values.refresh });
    const data = { semester, ...result };
    writeSuccess({
      command: "tis courses search",
      data,
      text: formatCourseSearch({ title: "Course catalog", semester, ...result }),
      items: result.courses,
      summary: { semester: semester.value, total: result.total, shown: result.courses.length, source: result.source },
    }, output);
    return;
  }
  if (command === "courses" && operation === "available") {
    const semester = parseSemester(values.semester);
    const round = required(values.round, "--round");
    const client = await tisClient(values);
    const limit = parsePositiveInteger(values.limit, 50, "--limit");
    if (limit > 500) throw usageError("--limit cannot exceed 500 for selectable-course queries.");
    const keyword = parsed.positionals.slice(3).join(" ") || undefined;
    const result = await client.searchAvailable(semester, { keyword, round, limit });
    const data = { semester, ...result };
    writeSuccess({
      command: "tis courses available",
      data,
      text: formatAvailableCourses({ semester, courses: result.courses, total: result.total, round }),
      items: result.courses,
      summary: { semester: semester.value, round, total: result.total, shown: result.courses.length },
      meta: { enrolledCount: result.enrolled.length, cartCount: result.cart.length },
    }, output);
    return;
  }
  if (command === "enrolled" && operation === undefined) {
    const semester = parseSemester(values.semester);
    const client = await tisClient(values);
    const courses = await client.enrolled(semester);
    const data = { semester, courses, total: courses.length };
    writeSuccess({
      command: "tis enrolled",
      data,
      text: formatEnrolledCourses(semester, courses),
      items: courses,
      summary: { semester: semester.value, total: courses.length },
    }, output);
    return;
  }
  if (command === "schedule" && operation === undefined) {
    if (values.all && values.week !== undefined) throw usageError("Choose either --week or --all, not both.");
    const semester = parseSemester(values.semester);
    const client = await tisClient(values);
    const week = values.all
      ? undefined
      : values.week === undefined
        ? await client.currentWeek()
        : parsePositiveInteger(values.week, 1, "--week");
    if (week !== undefined && week > 36) throw usageError("--week must be between 1 and 36.");
    const entries = await client.schedule(semester, week);
    const data = { semester, ...(week !== undefined ? { week } : {}), entries, total: entries.length };
    writeSuccess({
      command: "tis schedule",
      data,
      text: formatScheduleEntries(semester, entries, week),
      items: entries,
      summary: { semester: semester.value, ...(week !== undefined ? { week } : {}), total: entries.length },
    }, output);
    return;
  }
  if (command === "grades" && operation === undefined) {
    const semester = values.semester ? parseSemester(values.semester) : undefined;
    const client = await tisClient(values);
    const grades = await client.grades(semester);
    const summary = summariseGrades(grades);
    const data = { ...(semester ? { semester } : {}), grades, summary, bySemester: gradesBySemester(grades) };
    writeSuccess({
      command: "tis grades",
      data,
      text: formatGrades(grades, summary),
      items: grades,
      summary: { ...(semester ? { semester: semester.value } : {}), total: grades.length, ...summary },
    }, output);
    return;
  }
  if (command === "exams" && operation === undefined) {
    const client = await tisClient(values);
    const exams = await client.exams();
    writeSuccess({
      command: "tis exams",
      data: { exams, total: exams.length },
      text: formatExams(exams),
      items: exams,
      summary: { total: exams.length },
    }, output);
    return;
  }
  if (command === "timetable") {
    const codes = parsed.positionals.slice(2);
    const semester = parseSemester(values.semester);
    const maxResults = parsePositiveInteger(values.max, 20, "--max");
    if (maxResults > 100) throw usageError("--max cannot exceed 100.");
    const blocked = (values.block ?? []).map(parseBlockedTime);
    const client = await tisClient(values);
    const catalog = await client.catalog(semester, values.refresh);
    const result = solveTimetables(catalog.courses, codes, { maxResults, blocked });
    const data = { semester, source: catalog.source, ...result };
    writeSuccess({
      command: "tis timetable",
      data,
      text: formatTimetables(result),
      items: result.solutions,
      summary: {
        semester: semester.value,
        source: catalog.source,
        requestedCodes: result.requestedCodes,
        missingCodes: result.missingCodes,
        total: result.solutions.length,
        truncated: result.truncated,
      },
    }, output);
    return;
  }
  if (command === "enroll" && operation === "preview" && parsed.positionals.length === 3) {
    const semester = parseSemester(values.semester);
    const target = enrollTarget(values, semester);
    const applyCommand = `sustech tis enroll apply --course-id ${target.courseId} --rwh ${target.rwh} --round ${target.round} --bid ${target.bid} --confirm`;
    const data = {
      mode: "preview",
      mutation: false,
      action: "enroll",
      target,
      confirmation: { required: true, command: applyCommand },
    };
    writeSuccess({
      command: "tis enroll preview",
      data,
      text: formatEnrollPreview(target, applyCommand),
    }, output);
    return;
  }
  if (command === "enroll" && operation === "apply" && parsed.positionals.length === 3) {
    if (!values.confirm) throw new ConfirmationRequiredError("Enrollment");
    const semester = parseSemester(values.semester);
    const target = enrollTarget(values, semester);
    const client = await tisClient(values);
    const result = await client.addCourse(target);
    if (result.jg !== "1") {
      throw new CliError(result.message || "TIS did not enroll the course.", "TIS_WRITE_REJECTED", 4, {
        action: "enroll",
        rwh: target.rwh,
        tisCode: result.jg,
      });
    }
    let verification: { status: "confirmed" | "not_observed" | "unavailable"; message: string };
    try {
      const enrolled = await client.enrolled(semester);
      verification = enrolled.some((entry) => entry.rwh === target.rwh)
        ? { status: "confirmed", message: "The exact RWH was observed in the enrolled schedule." }
        : { status: "not_observed", message: "TIS accepted the request, but the exact RWH was not yet visible." };
    } catch (error) {
      verification = {
        status: "unavailable",
        message: `TIS accepted the request, but verification could not run: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    const data = { mutation: true, action: "enroll", target, result, verification };
    writeSuccess({
      command: "tis enroll apply",
      data,
      text: formatEnrollSuccess(target.rwh, result.message, verification),
      meta: verification.status === "confirmed" ? undefined : { warning: "DO_NOT_RETRY_AUTOMATICALLY" },
    }, output);
    return;
  }

  throw usageError(`Unknown command: ${parsed.positionals.join(" ")}`);
}

async function authenticatedSession(values: Values): Promise<{ session: TisSession; credentialSource: string }> {
  const credentials = await resolveCredentials(values["credentials-file"]);
  return { session: new TisSession(credentials), credentialSource: credentials.source };
}

async function tisClient(values: Values): Promise<TisClient> {
  const { session } = await authenticatedSession(values);
  return new TisClient(session);
}

async function runTransit(
  positionals: string[],
  values: Values,
  output: ReturnType<typeof resolveOutputOptions>,
): Promise<void> {
  const command = positionals[1];
  const client = new TransitClient();

  if (command === "facilities" && positionals.length === 2) {
    const facilities = await client.facilities();
    writeSuccess({
      command: "transit facilities",
      data: { facilities, total: facilities.length },
      text: formatFacilities("Campus facilities", facilities),
      items: facilities,
      summary: { total: facilities.length },
    }, output);
    return;
  }
  if (command === "find") {
    const query = positionals.slice(2).join(" ").trim();
    if (!query) throw usageError("A facility search query is required.");
    const limit = parsePositiveInteger(values.limit, 10, "--limit");
    if (limit > 100) throw usageError("--limit cannot exceed 100.");
    const facilities = await client.find(query, limit);
    writeSuccess({
      command: "transit find",
      data: { query, facilities, total: facilities.length },
      text: formatFacilities(`Facility search · ${query}`, facilities),
      items: facilities,
      summary: { query, total: facilities.length },
    }, output);
    return;
  }
  if (command === "lines" && positionals.length === 2) {
    const dayType = parseDayType(values.day);
    const lines = await client.lines(dayType);
    writeSuccess({
      command: "transit lines",
      data: { dayType, lines, total: lines.length },
      text: formatBusLines(dayType, lines),
      items: lines,
      summary: { dayType, total: lines.length },
    }, output);
    return;
  }
  if (command === "schedule" && positionals.length === 3) {
    const lineId = positionals[2]?.trim();
    if (!lineId) throw usageError("A bus line ID is required.");
    const dayType = parseDayType(values.day);
    const routeIndex = parseNonNegativeInteger(values["route-index"], 0, "--route-index");
    const schedule = await client.schedule(lineId, routeIndex, dayType);
    writeSuccess({
      command: "transit schedule",
      data: schedule,
      text: formatBusSchedule(schedule),
    }, output);
    return;
  }
  if (command === "stops" && positionals.length === 3) {
    const line = positionals[2]?.trim();
    if (!line) throw usageError("A live route code such as XYBS1 is required.");
    const direction = parseNonNegativeInteger(values.direction, 0, "--direction");
    if (direction > 1) throw usageError("--direction must be 0 or 1.");
    const stops = await client.stops(line, direction);
    writeSuccess({
      command: "transit stops",
      data: { line, direction, stops, total: stops.length },
      text: formatFacilities(`Bus stops · ${line}/${direction}`, stops),
      items: stops,
      summary: { line, direction, total: stops.length },
    }, output);
    return;
  }
  if (command === "live" && positionals.length === 2) {
    const buses = await client.live();
    writeSuccess({
      command: "transit live",
      data: { buses, total: buses.length },
      text: formatLiveBuses(buses),
      items: buses,
      summary: { total: buses.length },
    }, output);
    return;
  }
  throw usageError(`Unknown command: ${positionals.join(" ")}`);
}

function enrollTarget(values: Values, semester: ReturnType<typeof parseSemester>) {
  const courseId = opaqueToken(required(values["course-id"], "--course-id"), "--course-id");
  const rwh = opaqueToken(required(values.rwh, "--rwh"), "--rwh");
  const bid = parsePositiveInteger(values.bid, 1, "--bid");
  const round = opaqueToken(values.round ?? "yixuan", "--round");
  return { semester, courseId, rwh, bid, round, cultivation: "1" as const };
}

function required(value: string | undefined, option: string): string {
  if (!value?.trim()) throw usageError(`${option} is required.`);
  return value.trim();
}

function opaqueToken(value: string, option: string): string {
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(value)) {
    throw usageError(`${option} contains unsupported characters.`);
  }
  return value;
}

function parsePositiveInteger(value: string | undefined, fallback: number, option: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw usageError(`${option} must be a positive integer.`);
  return parsed;
}

function parseNonNegativeInteger(value: string | undefined, fallback: number, option: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw usageError(`${option} must be a non-negative integer.`);
  return parsed;
}

function parseDayType(value: string | undefined): "workday" | "holiday" {
  if (value === undefined || value === "workday") return "workday";
  if (value === "holiday") return "holiday";
  throw usageError("--day must be workday or holiday.");
}

function usageError(message: string): CliError {
  return new CliError(message, "USAGE", 2, { help: "Run `sustech --help` for usage." });
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const argv = process.argv.slice(2);
  const command = inferCommandName(argv);
  process.exitCode = writeError(error, command, inferOutputOptions(argv));
});
