#!/usr/bin/env node
import { parseArgs } from "node:util";
import { inferCommandName } from "./core/argv.js";
import { CAPABILITIES, formatCapabilities } from "./core/capabilities.js";
import { CONSEQUENCES, consequenceByOperation, formatConsequences } from "./core/consequences.js";
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
import { CLI_VERSION } from "./core/version.js";
import { CalendarClient } from "./calendar/client.js";
import { formatCalendarDay, formatCalendarTerms } from "./calendar/text.js";
import type { CalendarLevel } from "./calendar/types.js";
import { ContextService } from "./context/service.js";
import type { ContextLevel } from "./context/types.js";
import { FacultyClient } from "./faculty/client.js";
import { formatDepartments, formatFaculty } from "./faculty/text.js";
import { searchResources, type ResourceCategory } from "./resources/catalog.js";
import { formatResources } from "./resources/text.js";
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
import {
  buildClassroomDirectory,
  buildScheduleIcs,
  buildSelectionPreview,
  EvaluationStatusClient,
  inferWeekOneMonday,
  planBidUpdates,
  scheduleOccurrences,
  summariseEvaluationStatuses,
  type EvaluationStatusFilter,
  type SelectionBidWhere,
  type SelectionOperation,
} from "./tis/remaining.js";
import {
  formatBidPlan,
  formatClassroomOccupancy,
  formatClassrooms,
  formatEvaluationStatuses,
  formatSelectionPreview,
} from "./tis/remaining-text.js";
import { TransitClient } from "./transit/client.js";
import { formatBusLines, formatBusSchedule, formatFacilities, formatLiveBuses } from "./transit/text.js";
import { WifiClient } from "./wifi/client.js";
import { formatAssociation, formatWifiEvents } from "./wifi/text.js";
import { CasSession, type CasServiceConfig } from "./sso/cas.js";
import {
  SERVICE_STATUSES,
  browseNces,
  buildPrimoSearchUrl,
  formatServiceStatuses,
  getBlackboardUser,
  getNcesCourseDetail,
  getWsProgramDetail,
  getWsToken,
  listBlackboardAssignments,
  listBlackboardContent,
  listBlackboardCourses,
  listWsPrograms,
  searchCrossref,
  searchNces,
  serviceStatus,
  type ServiceAdapter,
} from "./services/index.js";
import {
  formatBlackboardAssignments,
  formatBlackboardContent,
  formatBlackboardCourses,
  formatBlackboardUser,
  formatNcesCourses,
  formatNcesDetail,
  formatPapers,
  formatWsDetail,
  formatWsPrograms,
} from "./services/text.js";

const VERSION = CLI_VERSION;

const HELP = `sustech — SUSTech services for humans and agents

Usage:
  sustech version [--json|--jsonl]
  sustech capabilities [--json|--jsonl]
  sustech consequences [OPERATION] [--json|--jsonl]
  sustech auth check [--service tis|bb|ws] [--credentials-file PATH] [--json|--jsonl]
  sustech calendar terms [--year YYYY] [--calendar-level undergraduate|graduate]
  sustech calendar day [YYYY-MM-DD|--date YYYY-MM-DD] [--calendar-level undergraduate|graduate]
  sustech faculty departments
  sustech faculty list DEPARTMENT [--full] [--limit N]
  sustech faculty get SLUG
  sustech faculty search QUERY [--department DEPARTMENT] [--limit N]
  sustech faculty render SLUG
  sustech context [--date YYYY-MM-DD] [--level terse|normal|verbose]
  sustech resources list [--category CATEGORY]
  sustech resources search QUERY [--category CATEGORY]
  sustech wifi status
  sustech wifi events [--minutes N]
  sustech services status [SERVICE]
  sustech papers search QUERY [--max N] [--min-year YYYY] [--open-access|--resolve-oa]
  sustech nces browse [--page N] [--page-size N] [--sort rating|reviews|name]
  sustech nces search QUERY
  sustech nces course ID
  sustech bb user
  sustech bb courses [QUERY]
  sustech bb content COURSE_ID [--parent-id CONTENT_ID]
  sustech bb assignments COURSE_ID
  sustech ws programs [KEYWORD] [--page N] [--page-size N]
  sustech ws detail ID [--program-code CODE] [--program-token TOKEN]
  sustech library search-url QUERY [--limit N]
  sustech tis courses search [KEYWORD] [--semester YYYY-YYYY-N] [--limit N] [--refresh]
  sustech tis courses available [KEYWORD] --round ROUND [--semester YYYY-YYYY-N] [--limit N]
  sustech tis enrolled [--semester YYYY-YYYY-N]
  sustech tis schedule [--semester YYYY-YYYY-N] [--week N|--all]
  sustech tis grades [--semester YYYY-YYYY-N]
  sustech tis exams
  sustech tis timetable CODE... [--semester YYYY-YYYY-N] [--block MON:1-4] [--max N] [--refresh]
  sustech tis classroom rooms [KEYWORD] [--semester YYYY-YYYY-N] [--refresh]
  sustech tis classroom occupancy ROOM --week N --day N [--period-start N --period-end N] [--semester YYYY-YYYY-N] [--refresh]
  sustech tis classroom free --week N --day N [--period-start N --period-end N] [--semester YYYY-YYYY-N] [--refresh]
  sustech tis evals [--semester YYYY-YYYY-N] [--status all|pending|draft|submitted]
  sustech tis ical [--semester YYYY-YYYY-N] [--week-one-monday YYYY-MM-DD|--teaching-start YYYY-MM-DD] [--calendar-name NAME]
  sustech tis selection preview OP --course-id ID [--semester YYYY-YYYY-N] [--round ROUND] [--bid N] [--where cart|enrolled] [--cultivation 1|2]
  sustech tis bid plan --pick COURSE_ID:BID [--pick ...] [--semester YYYY-YYYY-N] [--bid-limit N] [--where cart|enrolled] [--round ROUND] [--cultivation 1|2]
  sustech tis enroll preview --course-id TIS_ID --rwh TASK_ID [--semester YYYY-YYYY-N] [--round ROUND] [--bid N]
  sustech tis enroll apply --course-id TIS_ID --rwh TASK_ID [--semester YYYY-YYYY-N] [--round ROUND] [--bid N] --confirm
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
  status?: string;
  "period-start"?: string;
  "period-end"?: string;
  "week-one-monday"?: string;
  "teaching-start"?: string;
  "calendar-name"?: string;
  where?: string;
  pick?: string[];
  "bid-limit"?: string;
  cultivation?: string;
  year?: string;
  "calendar-level"?: string;
  date?: string;
  level?: string;
  department?: string;
  full?: boolean;
  minutes?: string;
  category?: string;
  page?: string;
  "page-size"?: string;
  sort?: string;
  "min-year"?: string;
  "open-access"?: boolean;
  "resolve-oa"?: boolean;
  "parent-id"?: string;
  "program-code"?: string;
  "program-token"?: string;
  service?: string;
  help?: boolean;
};

const SHARED_OUTPUT_OPTIONS = new Set(["output", "json", "jsonl", "pretty"]);
const COMMAND_OPTIONS: Readonly<Record<string, readonly string[]>> = {
  "auth check": ["service", "credentials-file"],
  "calendar terms": ["year", "calendar-level"],
  "calendar day": ["date", "calendar-level"],
  "faculty list": ["full", "limit"],
  "faculty search": ["department", "limit"],
  context: ["date", "level"],
  "resources list": ["category"],
  "resources search": ["category"],
  "wifi events": ["minutes"],
  "papers search": ["max", "min-year", "open-access", "resolve-oa"],
  "nces browse": ["page", "page-size", "sort"],
  "bb user": ["credentials-file"],
  "bb courses": ["credentials-file"],
  "bb content": ["credentials-file", "parent-id"],
  "bb assignments": ["credentials-file"],
  "ws programs": ["credentials-file", "page", "page-size"],
  "ws detail": ["credentials-file", "program-code", "program-token"],
  "library search-url": ["limit"],
  "tis courses search": ["credentials-file", "semester", "limit", "refresh"],
  "tis courses available": ["credentials-file", "semester", "limit", "round"],
  "tis enrolled": ["credentials-file", "semester"],
  "tis schedule": ["credentials-file", "semester", "week", "all"],
  "tis grades": ["credentials-file", "semester"],
  "tis exams": ["credentials-file"],
  "tis classroom rooms": ["credentials-file", "semester", "refresh"],
  "tis classroom occupancy": ["credentials-file", "semester", "refresh", "week", "day", "period-start", "period-end"],
  "tis classroom free": ["credentials-file", "semester", "refresh", "week", "day", "period-start", "period-end"],
  "tis evals": ["credentials-file", "semester", "status"],
  "tis ical": ["credentials-file", "semester", "week-one-monday", "teaching-start", "calendar-name"],
  "tis timetable": ["credentials-file", "semester", "refresh", "max", "block"],
  "tis enroll preview": ["semester", "course-id", "rwh", "round", "bid"],
  "tis selection preview": ["semester", "course-id", "round", "bid", "where", "cultivation"],
  "tis bid plan": ["semester", "pick", "bid-limit", "where", "round", "cultivation"],
  "tis enroll apply": ["credentials-file", "semester", "course-id", "rwh", "round", "bid", "confirm"],
  "transit find": ["limit"],
  "transit lines": ["day"],
  "transit schedule": ["route-index", "day"],
  "transit stops": ["direction"],
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
        status: { type: "string" },
        "period-start": { type: "string" },
        "period-end": { type: "string" },
        "week-one-monday": { type: "string" },
        "teaching-start": { type: "string" },
        "calendar-name": { type: "string" },
        where: { type: "string" },
        pick: { type: "string", multiple: true },
        "bid-limit": { type: "string" },
        cultivation: { type: "string" },
        year: { type: "string" },
        "calendar-level": { type: "string" },
        date: { type: "string" },
        level: { type: "string" },
        department: { type: "string" },
        full: { type: "boolean", default: false },
        minutes: { type: "string" },
        category: { type: "string" },
        page: { type: "string" },
        "page-size": { type: "string" },
        sort: { type: "string" },
        "min-year": { type: "string" },
        "open-access": { type: "boolean", default: false },
        "resolve-oa": { type: "boolean", default: false },
        "parent-id": { type: "string" },
        "program-code": { type: "string" },
        "program-token": { type: "string" },
        service: { type: "string" },
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
  validateCommandOptions(inferCommandName(argv), argv);

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
  if (group === "consequences") {
    const operationName = parsed.positionals[1];
    if (parsed.positionals.length > 2) throw usageError(`Unknown command: ${parsed.positionals.join(" ")}`);
    const consequences = operationName
      ? [consequenceByOperation(operationName)].filter((entry): entry is NonNullable<typeof entry> => entry !== undefined)
      : [...CONSEQUENCES];
    if (operationName && consequences.length === 0) throw usageError(`Unknown consequence-rich operation: ${operationName}`);
    writeSuccess({
      command: "consequences",
      data: { consequences, total: consequences.length },
      text: formatConsequences(consequences),
      items: consequences,
      summary: { total: consequences.length },
    }, output);
    return;
  }
  if (group === "auth" && command === "check" && operation === undefined) {
    const service = values.service ?? "tis";
    const { session, credentialSource } = service === "tis"
      ? await authenticatedSession(values)
      : await authenticatedCasService(values, casServiceConfig(service));
    await session.login();
    const data = { authenticated: true, service, credentialSource, credentialsStored: false };
    writeSuccess({ command: "auth check", data, text: `${service.toUpperCase()} ${formatAuthCheck(credentialSource)}` }, output);
    return;
  }
  if (group === "transit") {
    await runTransit(parsed.positionals, values, output);
    return;
  }
  if (group === "calendar") {
    await runCalendar(parsed.positionals, values, output);
    return;
  }
  if (group === "faculty") {
    await runFaculty(parsed.positionals, values, output);
    return;
  }
  if (group === "context") {
    await runContext(parsed.positionals, values, output);
    return;
  }
  if (group === "resources") {
    runResources(parsed.positionals, values, output);
    return;
  }
  if (group === "wifi") {
    await runWifi(parsed.positionals, values, output);
    return;
  }
  if (group === "services") {
    runServiceStatus(parsed.positionals, output);
    return;
  }
  if (group === "papers") {
    await runPapers(parsed.positionals, values, output);
    return;
  }
  if (group === "nces") {
    await runNces(parsed.positionals, values, output);
    return;
  }
  if (group === "bb") {
    await runBlackboard(parsed.positionals, values, output);
    return;
  }
  if (group === "ws") {
    await runWs(parsed.positionals, values, output);
    return;
  }
  if (group === "library") {
    runLibrary(parsed.positionals, values, output);
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
  if (command === "classroom" && operation === "rooms") {
    const semester = parseSemester(values.semester);
    const client = await tisClient(values);
    const catalog = await client.catalog(semester, values.refresh);
    const directory = buildClassroomDirectory(catalog.courses);
    const keyword = parsed.positionals.slice(3).join(" ").trim();
    const rooms = keyword ? directory.searchRooms(keyword) : directory.rooms();
    writeSuccess({
      command: "tis classroom rooms",
      data: { semester, keyword: keyword || undefined, source: catalog.source, rooms, total: rooms.length },
      text: formatClassrooms(rooms, keyword ? `Classrooms matching ${keyword}` : "Classrooms"),
      items: rooms,
      summary: { semester: semester.value, keyword: keyword || undefined, source: catalog.source, total: rooms.length },
    }, output);
    return;
  }
  if (command === "classroom" && operation === "occupancy") {
    const room = parsed.positionals.slice(3).join(" ").trim();
    if (!room) throw usageError("A classroom name is required.");
    const semester = parseSemester(values.semester);
    const query = classroomQuery(values);
    const client = await tisClient(values);
    const catalog = await client.catalog(semester, values.refresh);
    const entries = buildClassroomDirectory(catalog.courses).occupancy(room, query);
    writeSuccess({
      command: "tis classroom occupancy",
      data: { semester, room, query, source: catalog.source, entries, total: entries.length },
      text: formatClassroomOccupancy(room, entries, query),
      items: entries,
      summary: { semester: semester.value, room, ...query, source: catalog.source, total: entries.length },
    }, output);
    return;
  }
  if (command === "classroom" && operation === "free" && parsed.positionals.length === 3) {
    const semester = parseSemester(values.semester);
    const query = classroomQuery(values);
    const client = await tisClient(values);
    const catalog = await client.catalog(semester, values.refresh);
    const rooms = buildClassroomDirectory(catalog.courses).freeRooms(query);
    writeSuccess({
      command: "tis classroom free",
      data: { semester, query, source: catalog.source, rooms, total: rooms.length },
      text: formatClassrooms(rooms, `Free classrooms · week ${query.week}, day ${query.day}, P${query.periodStart}-${query.periodEnd}`),
      items: rooms,
      summary: { semester: semester.value, ...query, source: catalog.source, total: rooms.length },
    }, output);
    return;
  }
  if (command === "evals" && operation === undefined) {
    const semester = parseSemester(values.semester);
    const status = evaluationStatus(values.status);
    const { session } = await authenticatedSession(values);
    const me = objectValue(await session.getJson("/user/me"));
    const userId = firstValue(me, "yhdm", "studentId", "sid", "id");
    if (!userId) throw new CliError("TIS user profile did not include an evaluation user ID.", "TIS_PROTOCOL_ERROR", 1);
    const client = new EvaluationStatusClient(session, userId);
    const evaluations = await client.listCourses(semester.value, status);
    const summary = summariseEvaluationStatuses(evaluations);
    writeSuccess({
      command: "tis evals",
      data: { semester, status, evaluations, summary },
      text: formatEvaluationStatuses(evaluations, summary),
      items: evaluations,
      summary: { semester: semester.value, status, ...summary },
    }, output);
    return;
  }
  if (command === "ical" && operation === undefined) {
    const semester = parseSemester(values.semester);
    const client = await tisClient(values);
    const entries = await client.schedule(semester);
    const anchor = values["week-one-monday"]
      ? { weekOneMonday: isoDate(values["week-one-monday"], "--week-one-monday") }
      : values["teaching-start"]
        ? { teachingStartDate: isoDate(values["teaching-start"], "--teaching-start") }
        : values.semester
          ? (() => { throw usageError("An explicit --semester requires --week-one-monday or --teaching-start for ICS export."); })()
          : { weekOneMonday: inferWeekOneMonday(todayInShenzhen(), await client.currentWeek()) };
    const events = scheduleOccurrences(entries, anchor);
    const content = buildScheduleIcs(entries, anchor, { calendarName: values["calendar-name"] });
    writeSuccess({
      command: "tis ical",
      data: { semester, anchor, events, eventCount: events.length, content },
      text: content,
      items: events,
      summary: { semester: semester.value, anchor, total: events.length },
    }, output);
    return;
  }
  if (command === "selection" && operation === "preview" && parsed.positionals.length === 4) {
    const semester = parseSemester(values.semester);
    const selectionOperation = selectionOperationValue(required(parsed.positionals[3], "selection operation"));
    const courseId = opaqueToken(required(values["course-id"], "--course-id"), "--course-id");
    const where = selectionWhere(values.where);
    const bid = values.bid === undefined ? undefined : parsePositiveInteger(values.bid, 1, "--bid");
    const cultivation = selectionCultivation(values.cultivation);
    const preview = buildSelectionPreview(
      { semester, cultivation, currentTerm: {} },
      {
        operation: selectionOperation,
        courseId,
        ...(values.round ? { round: opaqueToken(values.round, "--round") } : {}),
        bid,
        where,
      },
    );
    const data = {
      mode: "preview",
      mutation: false,
      applyAvailable: false,
      contextSource: "local",
      preview,
    };
    writeSuccess({ command: "tis selection preview", data, text: formatSelectionPreview(preview) }, output);
    return;
  }
  if (command === "bid" && operation === "plan" && parsed.positionals.length === 3) {
    const semester = parseSemester(values.semester);
    const picks = parseBidPicks(values.pick ?? []);
    const where = selectionWhere(values.where);
    const limit = values["bid-limit"] === undefined
      ? undefined
      : parsePositiveInteger(values["bid-limit"], 1, "--bid-limit");
    const cultivation = selectionCultivation(values.cultivation);
    const plan = planBidUpdates(
      { semester, cultivation, currentTerm: {} },
      picks,
      { where, round: opaqueToken(values.round ?? "yixuan", "--round"), limit },
    );
    writeSuccess({
      command: "tis bid plan",
      data: { mode: "plan", mutation: false, applyAvailable: false, semester, ...plan },
      text: formatBidPlan(plan),
      items: plan.previews,
      summary: { semester: semester.value, where, totalBid: plan.totalBid, limit, overLimit: plan.overLimit, total: plan.previews.length },
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

async function authenticatedCasService(
  values: Values,
  config: CasServiceConfig,
): Promise<{ session: CasSession; credentialSource: string }> {
  const credentials = await resolveCredentials(values["credentials-file"]);
  return { session: new CasSession(credentials, config), credentialSource: credentials.source };
}

async function casServiceAdapter(values: Values, service: "bb" | "ws"): Promise<ServiceAdapter> {
  const { session } = await authenticatedCasService(values, casServiceConfig(service));
  return {
    name: service,
    fetch(input: string, init?: RequestInit): Promise<Response> {
      return session.fetch(input, init);
    },
  };
}

function casServiceConfig(service: string): CasServiceConfig {
  if (service === "bb") {
    return {
      name: "Blackboard",
      baseUrl: "https://bb.sustech.edu.cn",
      serviceUrl: "https://bb.sustech.edu.cn/webapps/bb-sso-BBLEARN/index.jsp",
    };
  }
  if (service === "ws") {
    return {
      name: "SUSTech Global",
      baseUrl: "https://ws.sustech.edu.cn",
      serviceUrl: "https://ws.sustech.edu.cn/SUSTechHome.aspx",
    };
  }
  throw usageError("--service must be tis, bb, or ws.");
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

async function runCalendar(
  positionals: string[],
  values: Values,
  output: ReturnType<typeof resolveOutputOptions>,
): Promise<void> {
  const command = positionals[1];
  const isTerms = command === "terms" && positionals.length === 2;
  const isDay = command === "day" && positionals.length <= 3;
  if (!isTerms && !isDay) throw usageError(`Unknown command: ${positionals.join(" ")}`);

  const date = isDay ? isoDate(positionals[2] ?? values.date ?? todayInShenzhen(), "date") : todayInShenzhen();
  const year = values.year === undefined
    ? Number(date.slice(0, 4))
    : parsePositiveInteger(values.year, new Date().getFullYear(), "--year");
  if (year < 2000 || year > 2100) throw usageError("--year must be between 2000 and 2100.");
  const level = calendarLevel(values["calendar-level"]);
  const calendar = await new CalendarClient().loadYear(year, level);

  if (isTerms) {
    const terms = calendar.terms().map((term) => term.snapshot);
    writeSuccess({
      command: "calendar terms",
      data: { year, level, terms, total: terms.length },
      text: formatCalendarTerms(terms, year, level),
      items: terms,
      summary: { year, level, total: terms.length },
    }, output);
    return;
  }
  if (isDay) {
    const day = calendar.day(date);
    writeSuccess({ command: "calendar day", data: { year, level, day }, text: formatCalendarDay(day) }, output);
    return;
  }
}

async function runFaculty(
  positionals: string[],
  values: Values,
  output: ReturnType<typeof resolveOutputOptions>,
): Promise<void> {
  const command = positionals[1];
  const client = new FacultyClient();
  const limit = parsePositiveInteger(values.limit, 20, "--limit");
  if (limit > 200) throw usageError("--limit cannot exceed 200 for faculty queries.");

  if (command === "departments" && positionals.length === 2) {
    const departments = client.listDepartments();
    writeSuccess({
      command: "faculty departments",
      data: { departments, total: departments.length },
      text: formatDepartments(departments),
      items: departments,
      summary: { total: departments.length },
    }, output);
    return;
  }
  if (command === "list") {
    const department = positionals.slice(2).join(" ").trim();
    if (!department) throw usageError("A faculty department is required.");
    const profiles = await client.list(department, { full: values.full, limit });
    writeSuccess({
      command: "faculty list",
      data: { department, full: Boolean(values.full), profiles, total: profiles.length },
      text: formatFaculty(profiles, `Faculty · ${department}`),
      items: profiles,
      summary: { department, full: Boolean(values.full), total: profiles.length },
    }, output);
    return;
  }
  if (command === "get" && positionals.length === 3) {
    const slug = opaqueToken(required(positionals[2], "faculty slug"), "faculty slug");
    const profile = await client.get(slug);
    writeSuccess({ command: "faculty get", data: profile, text: formatFaculty([profile], "Faculty profile") }, output);
    return;
  }
  if (command === "search") {
    const query = positionals.slice(2).join(" ").trim();
    if (!query) throw usageError("A faculty search query is required.");
    const profiles = await client.search(query, { dept: values.department, limit });
    writeSuccess({
      command: "faculty search",
      data: { query, department: values.department, profiles, total: profiles.length },
      text: formatFaculty(profiles, `Faculty search · ${query}`),
      items: profiles,
      summary: { query, department: values.department, total: profiles.length },
    }, output);
    return;
  }
  if (command === "render" && positionals.length === 3) {
    const slug = opaqueToken(required(positionals[2], "faculty slug"), "faculty slug");
    const markdown = await client.render(slug);
    writeSuccess({ command: "faculty render", data: { slug, markdown }, text: markdown }, output);
    return;
  }
  throw usageError(`Unknown command: ${positionals.join(" ")}`);
}

async function runContext(
  positionals: string[],
  values: Values,
  output: ReturnType<typeof resolveOutputOptions>,
): Promise<void> {
  if (positionals.length !== 1) throw usageError(`Unknown command: ${positionals.join(" ")}`);
  const date = isoDate(values.date ?? todayInShenzhen(), "--date");
  const year = values.year === undefined ? Number(date.slice(0, 4)) : parsePositiveInteger(values.year, Number(date.slice(0, 4)), "--year");
  const calendar = await new CalendarClient().loadYear(year, calendarLevel(values["calendar-level"]));
  const level = contextLevel(values.level);
  const service = new ContextService();
  const snapshot = service.build({ now: `${date}T12:00:00+08:00`, calendar }, level);
  writeSuccess({ command: "context", data: service.toRecord(snapshot), text: service.toText(snapshot) }, output);
}

function runResources(
  positionals: string[],
  values: Values,
  output: ReturnType<typeof resolveOutputOptions>,
): void {
  const command = positionals[1];
  const category = resourceCategory(values.category);
  if (command === "list" && positionals.length === 2) {
    const resources = searchResources("", category);
    writeSuccess({
      command: "resources list",
      data: { category, resources, total: resources.length },
      text: formatResources(resources),
      items: resources,
      summary: { category, total: resources.length },
    }, output);
    return;
  }
  if (command === "search") {
    const query = positionals.slice(2).join(" ").trim();
    if (!query) throw usageError("A resource search query is required.");
    const resources = searchResources(query, category);
    writeSuccess({
      command: "resources search",
      data: { query, category, resources, total: resources.length },
      text: formatResources(resources, `Campus resource search · ${query}`),
      items: resources,
      summary: { query, category, total: resources.length },
    }, output);
    return;
  }
  throw usageError(`Unknown command: ${positionals.join(" ")}`);
}

async function runWifi(
  positionals: string[],
  values: Values,
  output: ReturnType<typeof resolveOutputOptions>,
): Promise<void> {
  const command = positionals[1];
  const client = new WifiClient();
  if (command === "status" && positionals.length === 2) {
    const association = await client.currentAssociation();
    writeSuccess({ command: "wifi status", data: { associated: association !== null, association }, text: formatAssociation(association) }, output);
    return;
  }
  if (command === "events" && positionals.length === 2) {
    const minutes = parsePositiveInteger(values.minutes, 60, "--minutes");
    const events = await client.recentEvents(minutes);
    writeSuccess({
      command: "wifi events",
      data: { minutes, events, total: events.length },
      text: formatWifiEvents(events, minutes),
      items: events,
      summary: { minutes, total: events.length },
    }, output);
    return;
  }
  throw usageError(`Unknown command: ${positionals.join(" ")}`);
}

function runServiceStatus(
  positionals: string[],
  output: ReturnType<typeof resolveOutputOptions>,
): void {
  if (positionals[1] !== "status" || positionals.length > 3) {
    throw usageError(`Unknown command: ${positionals.join(" ")}`);
  }
  const requested = positionals[2];
  const statuses = requested
    ? [serviceStatus(requested)].filter((entry): entry is NonNullable<typeof entry> => entry !== undefined)
    : [...SERVICE_STATUSES];
  if (requested && statuses.length === 0) throw usageError(`Unknown service: ${requested}`);
  writeSuccess({
    command: "services status",
    data: { statuses, total: statuses.length },
    text: formatServiceStatuses(statuses),
    items: statuses,
    summary: { total: statuses.length },
  }, output);
}

async function runPapers(
  positionals: string[],
  values: Values,
  output: ReturnType<typeof resolveOutputOptions>,
): Promise<void> {
  if (positionals[1] !== "search") throw usageError(`Unknown command: ${positionals.join(" ")}`);
  const query = positionals.slice(2).join(" ").trim();
  if (!query) throw usageError("A paper search query is required.");
  const maxResults = parsePositiveInteger(values.max, 10, "--max");
  if (maxResults > 100) throw usageError("--max cannot exceed 100 for paper search.");
  const minYear = values["min-year"] === undefined
    ? undefined
    : parsePositiveInteger(values["min-year"], 1900, "--min-year");
  if (minYear !== undefined && (minYear < 1900 || minYear > new Date().getFullYear() + 1)) {
    throw usageError("--min-year is outside the supported range.");
  }
  const papers = await searchCrossref(query, {
    maxResults,
    minYear,
    openAccessOnly: Boolean(values["open-access"]),
    resolveOpenAccess: Boolean(values["resolve-oa"] || values["open-access"]),
  });
  writeSuccess({
    command: "papers search",
    data: { query, minYear, openAccessOnly: Boolean(values["open-access"]), papers, total: papers.length },
    text: formatPapers(papers, query),
    items: papers,
    summary: { query, minYear, openAccessOnly: Boolean(values["open-access"]), total: papers.length },
  }, output);
}

async function runNces(
  positionals: string[],
  values: Values,
  output: ReturnType<typeof resolveOutputOptions>,
): Promise<void> {
  const command = positionals[1];
  if (command === "browse" && positionals.length === 2) {
    const page = parsePositiveInteger(values.page, 1, "--page");
    const perPage = parsePositiveInteger(values["page-size"], 30, "--page-size");
    if (perPage > 50) throw usageError("--page-size cannot exceed 50 for NCES.");
    const sort = ncesSort(values.sort);
    const result = await browseNces({ page, perPage, sort });
    writeSuccess({
      command: "nces browse",
      data: result,
      text: formatNcesCourses(result.items, "NCES course evaluations"),
      items: result.items,
      summary: { page: result.page, perPage: result.perPage, pages: result.pages, total: result.total, shown: result.items.length },
    }, output);
    return;
  }
  if (command === "search") {
    const query = positionals.slice(2).join(" ").trim();
    if (!query) throw usageError("An NCES search query is required.");
    const result = await searchNces(query);
    writeSuccess({
      command: "nces search",
      data: { query, ...result },
      text: formatNcesCourses(result.items, `NCES search · ${query}`),
      items: result.items,
      summary: { query, total: result.total, shown: result.items.length, sampleReviews: result.sampleReviews.length },
    }, output);
    return;
  }
  if (command === "course" && positionals.length === 3) {
    const id = parsePositiveInteger(positionals[2], 1, "NCES course ID");
    const course = await getNcesCourseDetail(id);
    writeSuccess({ command: "nces course", data: { id, found: course !== null, course }, text: formatNcesDetail(course) }, output);
    return;
  }
  throw usageError(`Unknown command: ${positionals.join(" ")}`);
}

async function runBlackboard(
  positionals: string[],
  values: Values,
  output: ReturnType<typeof resolveOutputOptions>,
): Promise<void> {
  const command = positionals[1];
  const adapter = await casServiceAdapter(values, "bb");
  if (command === "user" && positionals.length === 2) {
    const user = await getBlackboardUser(adapter);
    writeSuccess({ command: "bb user", data: user, text: formatBlackboardUser(user) }, output);
    return;
  }
  if (command === "courses") {
    const query = positionals.slice(2).join(" ").trim() || undefined;
    const courses = await listBlackboardCourses(adapter, { query });
    writeSuccess({
      command: "bb courses",
      data: { query, courses, total: courses.length },
      text: formatBlackboardCourses(courses),
      items: courses,
      summary: { query, total: courses.length },
    }, output);
    return;
  }
  if (command === "content" && positionals.length === 3) {
    const courseId = opaqueToken(required(positionals[2], "Blackboard course ID"), "Blackboard course ID");
    const parentId = values["parent-id"]
      ? opaqueToken(values["parent-id"], "--parent-id")
      : undefined;
    const items = await listBlackboardContent(adapter, courseId, parentId);
    writeSuccess({
      command: "bb content",
      data: { courseId, parentId, items, total: items.length },
      text: formatBlackboardContent(items, `Blackboard content · ${courseId}`),
      items,
      summary: { courseId, parentId, total: items.length },
    }, output);
    return;
  }
  if (command === "assignments" && positionals.length === 3) {
    const courseId = opaqueToken(required(positionals[2], "Blackboard course ID"), "Blackboard course ID");
    const assignments = await listBlackboardAssignments(adapter, courseId);
    writeSuccess({
      command: "bb assignments",
      data: { courseId, assignments, total: assignments.length },
      text: formatBlackboardAssignments(assignments),
      items: assignments,
      summary: { courseId, total: assignments.length },
    }, output);
    return;
  }
  throw usageError(`Unknown command: ${positionals.join(" ")}`);
}

async function runWs(
  positionals: string[],
  values: Values,
  output: ReturnType<typeof resolveOutputOptions>,
): Promise<void> {
  const command = positionals[1];
  const adapter = await casServiceAdapter(values, "ws");
  const token = await getWsToken(adapter);
  if (!token.userToken) throw new CliError("WS session did not expose a user token.", "WS_PROTOCOL_ERROR", 1);
  if (command === "programs") {
    const keywords = positionals.slice(2).join(" ").trim() || undefined;
    const page = parsePositiveInteger(values.page, 1, "--page");
    const pageSize = parsePositiveInteger(values["page-size"], 20, "--page-size");
    if (pageSize > 100) throw usageError("--page-size cannot exceed 100 for WS.");
    const result = await listWsPrograms(adapter, token, { page, pageSize, keywords });
    writeSuccess({
      command: "ws programs",
      data: result,
      text: formatWsPrograms(result.programs),
      items: result.programs,
      summary: { page: result.page, pageSize: result.pageSize, total: result.total, shown: result.programs.length },
    }, output);
    return;
  }
  if (command === "detail" && positionals.length === 3) {
    const id = opaqueToken(required(positionals[2], "WS program ID"), "WS program ID");
    const detail = await getWsProgramDetail(adapter, token, {
      id,
      code: values["program-code"],
      programToken: values["program-token"],
    });
    writeSuccess({ command: "ws detail", data: { id, detail }, text: formatWsDetail(detail) }, output);
    return;
  }
  throw usageError(`Unknown command: ${positionals.join(" ")}`);
}

function runLibrary(
  positionals: string[],
  values: Values,
  output: ReturnType<typeof resolveOutputOptions>,
): void {
  if (positionals[1] !== "search-url") throw usageError(`Unknown command: ${positionals.join(" ")}`);
  const query = positionals.slice(2).join(" ").trim();
  if (!query) throw usageError("A library search query is required.");
  const limit = parsePositiveInteger(values.limit, 10, "--limit");
  const url = buildPrimoSearchUrl({ query, limit });
  const status = serviceStatus("library-catalog");
  const data = {
    query,
    url,
    availability: "browser-required",
    mutation: false,
    ...(status ? { service: status } : {}),
  };
  writeSuccess({
    command: "library search-url",
    data,
    text: `Library search URL · browser required\n${url}\nNo catalog result was fabricated by the CLI.`,
  }, output);
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

function validateCommandOptions(command: string, argv: readonly string[]): void {
  if (!CAPABILITIES.some((entry) => entry.command === command)) return;
  const allowed = new Set(COMMAND_OPTIONS[command] ?? []);
  for (const option of suppliedOptionNames(argv)) {
    if (SHARED_OUTPUT_OPTIONS.has(option) || allowed.has(option)) continue;
    throw usageError(`Option '--${option}' is not valid for '${command}'.`);
  }
}

function suppliedOptionNames(argv: readonly string[]): Set<string> {
  const names = new Set<string>();
  for (const argument of argv) {
    if (argument === "--") break;
    if (argument === "-h") {
      names.add("help");
      continue;
    }
    if (!argument.startsWith("--")) continue;
    names.add(argument.slice(2).split("=", 1)[0]);
  }
  return names;
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

function calendarLevel(value: string | undefined): CalendarLevel {
  if (value === undefined || value === "undergraduate") return "undergraduate";
  if (value === "graduate") return "graduate";
  throw usageError("--calendar-level must be undergraduate or graduate.");
}

function contextLevel(value: string | undefined): ContextLevel {
  if (value === undefined || value === "normal") return "normal";
  if (value === "terse" || value === "verbose") return value;
  throw usageError("--level must be terse, normal, or verbose.");
}

function resourceCategory(value: string | undefined): ResourceCategory | undefined {
  if (value === undefined) return undefined;
  if (value === "official" || value === "academic" || value === "maps" || value === "papers" || value === "community") return value;
  throw usageError("--category must be official, academic, maps, papers, or community.");
}

function ncesSort(value: string | undefined): "rating" | "reviews" | "name" {
  if (value === undefined || value === "rating") return "rating";
  if (value === "reviews" || value === "name") return value;
  throw usageError("--sort must be rating, reviews, or name for NCES.");
}

function classroomQuery(values: Values): { week: number; day: number; periodStart: number; periodEnd: number } {
  const week = parsePositiveInteger(values.week, 1, "--week");
  if (week > 36) throw usageError("--week must be between 1 and 36.");
  const day = parsePositiveInteger(values.day, 1, "--day");
  if (day > 7) throw usageError("--day must be between 1 and 7.");
  const periodStart = parsePositiveInteger(values["period-start"], 1, "--period-start");
  const periodEnd = parsePositiveInteger(values["period-end"], 13, "--period-end");
  if (periodStart > 13 || periodEnd > 13 || periodEnd < periodStart) {
    throw usageError("Class periods must satisfy 1 <= --period-start <= --period-end <= 13.");
  }
  return { week, day, periodStart, periodEnd };
}

function evaluationStatus(value: string | undefined): EvaluationStatusFilter {
  if (value === undefined || value === "all" || value === "pending" || value === "draft" || value === "submitted") {
    return value ?? "all";
  }
  throw usageError("--status must be all, pending, draft, or submitted.");
}

function selectionOperationValue(value: string): SelectionOperation {
  if (value === "enroll" || value === "drop" || value === "cart.add" || value === "cart.remove" || value === "bid.update") {
    return value;
  }
  throw usageError("Selection operation must be enroll, drop, cart.add, cart.remove, or bid.update.");
}

function selectionWhere(value: string | undefined): SelectionBidWhere {
  if (value === undefined || value === "enrolled") return "enrolled";
  if (value === "cart") return "cart";
  throw usageError("--where must be cart or enrolled.");
}

function selectionCultivation(value: string | undefined): "1" | "2" {
  if (value === undefined || value === "1") return "1";
  if (value === "2") return "2";
  throw usageError("--cultivation must be 1 or 2.");
}

function parseBidPicks(values: readonly string[]): Record<string, number> {
  if (values.length === 0) throw usageError("At least one --pick COURSE_ID:BID is required.");
  const picks: Record<string, number> = {};
  for (const value of values) {
    const delimiter = value.lastIndexOf(":");
    if (delimiter <= 0) throw usageError(`Invalid --pick value: ${value}`);
    const courseId = opaqueToken(value.slice(0, delimiter), "--pick course ID");
    const bid = parsePositiveInteger(value.slice(delimiter + 1), 1, "--pick bid");
    picks[courseId] = bid;
  }
  return picks;
}

function isoDate(value: string, option: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const parsed = match ? new Date(`${value}T00:00:00Z`) : undefined;
  if (
    !match
    || !parsed
    || Number.isNaN(parsed.getTime())
    || parsed.getUTCFullYear() !== Number(match[1])
    || parsed.getUTCMonth() + 1 !== Number(match[2])
    || parsed.getUTCDate() !== Number(match[3])
  ) {
    throw usageError(`${option} must be YYYY-MM-DD.`);
  }
  return value;
}

function todayInShenzhen(): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function objectValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function firstValue(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function usageError(message: string): CliError {
  return new CliError(message, "USAGE", 2, { help: "Run `sustech --help` for usage." });
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const argv = process.argv.slice(2);
  const command = inferCommandName(argv);
  process.exitCode = writeError(error, command, inferOutputOptions(argv));
});
