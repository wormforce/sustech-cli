#!/usr/bin/env node
import { parseArgs } from "node:util";
import { inferCommandName } from "./core/argv.js";
import { CAPABILITIES, formatCapabilities } from "./core/capabilities.js";
import { CONSEQUENCES, consequenceByOperation, formatConsequences } from "./core/consequences.js";
import { resolveCredentials, type Credentials } from "./core/credentials.js";
import { CliError, ConfirmationRequiredError } from "./core/errors.js";
import {
  DEFAULT_CREDENTIAL_PROFILE,
  deleteStoredCredentials,
  getCredentialBackendStatus,
  getCredentialStatus,
  maskSid,
  saveStoredCredentials,
  validateCredentialPassword,
  validateCredentialSid,
  validateProfileName,
} from "./core/keyring.js";
import {
  inferOutputOptions,
  resolveOutputOptions,
  writeError,
  writeSuccess,
  type OutputFlags,
  type OutputOptions,
} from "./core/output.js";
import { promptHiddenPassword, promptLoginSid, readPasswordFromStdin } from "./core/prompt.js";
import { parseSemester } from "./core/semester.js";
import { CLI_VERSION } from "./core/version.js";
import { CalendarClient } from "./calendar/client.js";
import { formatCalendarDay, formatCalendarTerms } from "./calendar/text.js";
import type { CalendarLevel } from "./calendar/types.js";
import { ContextService } from "./context/service.js";
import type { ContextLevel, DeadlineSummary } from "./context/types.js";
import {
  DOCTOR_SERVICES,
  buildDoctorReport,
  type DoctorLiveResult,
  type DoctorService,
} from "./doctor/service.js";
import { formatDoctorReport } from "./doctor/text.js";
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
import { TisClient, type TisSelectionState } from "./tis/client.js";
import { parseBlockedTime, solveTimetables } from "./tis/planner.js";
import {
  fetchLiveRoomCatalog,
  fetchLiveRoomSchedule,
  classroomLiveEntryOutput,
  classroomLiveRoomOutput,
  buildClassroomDirectory,
  buildScheduleIcs,
  buildSelectionPreview,
  ensureSelectionVerified,
  EvaluationStatusClient,
  inferWeekOneMonday,
  planBidUpdates,
  projectBidTotal,
  revalidateSelectionWrite,
  resolveLiveRoom,
  scheduleOccurrences,
  summariseEvaluationStatuses,
  summariseLiveOccupancy,
  teachingPeriodAtShenzhenTime,
  verifySelectionWrite,
  type BidPick,
  type EvaluationStatusFilter,
  type SelectionApplyTarget,
  type SelectionBidWhere,
  type SelectionOperation,
} from "./tis/remaining.js";
import {
  formatBidApplySuccess,
  formatBidPlan,
  formatClassroomLive,
  formatClassroomNow,
  formatClassroomOccupancy,
  formatClassrooms,
  formatEvaluationStatuses,
  formatSelectionApplySuccess,
  formatSelectionPreview,
} from "./tis/remaining-text.js";
import { TransitClient } from "./transit/client.js";
import { formatBusLines, formatBusSchedule, formatFacilities, formatLiveBuses } from "./transit/text.js";
import { WifiClient } from "./wifi/client.js";
import { formatAssociation, formatWifiEvents } from "./wifi/text.js";
import { CasSession, type CasServiceConfig } from "./sso/cas.js";
import { BookingSession } from "./services/booking-auth.js";
import { LibraryBookingSession } from "./services/library-booking-auth.js";
import { PmsSession } from "./services/pms-auth.js";
import {
  SERVICE_STATUSES,
  attachBlackboardAttemptFile,
  browseNces,
  buildPrimoSearchUrl,
  createBlackboardAttempt,
  downloadOpenAccessPdf,
  downloadBlackboardContentAttachment,
  evaluateBlackboardSubmissionPreflight,
  formatServiceStatuses,
  getBlackboardAttempt,
  getBlackboardContentItem,
  getBlackboardUser,
  getBlackboardUploadSettings,
  getLibraryBookingUser,
  getLibraryIdleSummary,
  getLibraryReservationCount,
  getNcesCourseDetail,
  getWsProgramDetail,
  getWsToken,
  listBlackboardAssignments,
  listBlackboardDeadlines,
  listBlackboardContentAttachments,
  listBlackboardAttemptFiles,
  listBlackboardAttempts,
  listBlackboardContent,
  listBlackboardCourses,
  nextBlackboardDeadline,
  searchBlackboardContentTree,
  listBookingRooms,
  listLibraryLabs,
  listLibraryReservationsPage,
  listLibraryRooms,
  listMyBookingMeetings,
  listPmsPrintJobs,
  listPmsScanJobs,
  listPmsServerGroups,
  listPmsStations,
  listPmsUsageHistory,
  listWsPrograms,
  inspectBlackboardSubmissionFile,
  readBlackboardSubmissionPayload,
  selectBlackboardAssignment,
  searchCrossref,
  searchNces,
  serviceStatus,
  syncBlackboardAttachments,
  updateBlackboardAttempt,
  uploadBlackboardTemporaryFile,
  type BlackboardAttempt,
  type BlackboardAttemptFile,
  type BlackboardSubmissionFile,
  type BlackboardSubmissionPreflight as BlackboardSubmissionAssessment,
  type ServiceAdapter,
} from "./services/index.js";
import {
  formatBookingMeetings,
  formatBookingProfile,
  formatBookingRooms,
  formatBlackboardAssignments,
  formatBlackboardAttachmentDownload,
  formatBlackboardAttachments,
  formatBlackboardAttempts,
  formatBlackboardContent,
  formatBlackboardCourses,
  formatBlackboardDeadlines,
  formatBlackboardSearch,
  formatBlackboardSubmissionSuccess,
  formatBlackboardSubmitPreview,
  formatBlackboardSync,
  formatBlackboardUser,
  formatNcesCourses,
  formatNcesDetail,
  formatPaperDownload,
  formatPapers,
  formatLibraryBookingUser,
  formatLibraryIdleSummary,
  formatLibraryLabs,
  formatLibraryReservations,
  formatLibraryRooms,
  formatPmsPrintJobs,
  formatPmsScanJobs,
  formatPmsServerGroups,
  formatPmsStations,
  formatPmsUsage,
  formatWsDetail,
  formatWsPrograms,
} from "./services/text.js";

const VERSION = CLI_VERSION;

const HELP = `sustech — SUSTech services for humans and agents

Usage:
  sustech version [--json|--jsonl]
  sustech capabilities [--json|--jsonl]
  sustech consequences [OPERATION] [--json|--jsonl]
  sustech doctor [--profile NAME] [--credentials-file PATH] [--service all|tis,bb,ws,booking,lib-booking,pms] [--live]
  sustech auth login [--profile NAME] [--sid SID] [--service bb|tis|ws|booking|lib-booking|pms] [--password-stdin]
  sustech auth status [--profile NAME]
  sustech auth logout [--profile NAME]
  sustech auth check [--profile NAME] [--service tis|bb|ws|booking|lib-booking|library-booking|pms] [--credentials-file PATH] [--json|--jsonl]
  sustech calendar terms [--year YYYY] [--calendar-level undergraduate|graduate]
  sustech calendar day [YYYY-MM-DD|--date YYYY-MM-DD] [--calendar-level undergraduate|graduate]
  sustech faculty departments
  sustech faculty list DEPARTMENT [--full] [--limit N]
  sustech faculty get SLUG
  sustech faculty search QUERY [--department DEPARTMENT] [--limit N]
  sustech faculty render SLUG
  sustech context [--date YYYY-MM-DD] [--level terse|normal|verbose] [--live] [--credentials-file PATH]
  sustech resources list [--category CATEGORY]
  sustech resources search QUERY [--category CATEGORY]
  sustech wifi status
  sustech wifi events [--minutes N]
  sustech services status [SERVICE]
  sustech papers search QUERY [--max N] [--min-year YYYY] [--open-access|--resolve-oa]
  sustech papers fetch-oa DOI --destination PATH [--overwrite]
  sustech nces browse [--page N] [--page-size N] [--sort rating|reviews|name]
  sustech nces search QUERY
  sustech nces course ID
  sustech bb user
  sustech bb courses [QUERY]
  sustech bb content COURSE_ID [--parent-id CONTENT_ID]
  sustech bb attachments COURSE_ID CONTENT_ID
  sustech bb download COURSE_ID CONTENT_ID ATTACHMENT_ID --destination PATH [--overwrite]
  sustech bb assignments COURSE_ID
  sustech bb deadlines [--days N] [--course QUERY]
  sustech bb search QUERY [--course QUERY] [--kind file|folder|assignment|document|unknown] [--attachments include|only|none] [--page N] [--page-size N]
  sustech bb sync COURSE_ID --destination DIR [--content-id CONTENT_ID] [--overwrite]
  sustech bb attempts COURSE_ID [--content-id CONTENT_ID|--column-id COLUMN_ID] [--status InProgress|NeedsGrading|Completed]
  sustech bb submit preview --course-id COURSE_ID [--content-id CONTENT_ID|--column-id COLUMN_ID] --file PATH [--comment TEXT]
  sustech bb submit apply --course-id COURSE_ID [--content-id CONTENT_ID|--column-id COLUMN_ID] --file PATH --expected-sha256 HEX [--comment TEXT] [--allow-late] --confirm
  sustech ws programs [KEYWORD] [--page N] [--page-size N]
  sustech ws detail ID [--program-code CODE] [--program-token TOKEN]
  sustech library search-url QUERY [--limit N]
  sustech booking whoami
  sustech booking rooms [QUERY] [--available] [--page N] [--page-size N]
  sustech booking my-meetings [--page N] [--page-size N]
  sustech lib-booking whoami
  sustech lib-booking home-summary
  sustech lib-booking labs [--class-kind N]
  sustech lib-booking rooms --kind-id N --lab-id N [--class-kind N]
  sustech lib-booking reservation-count
  sustech lib-booking reservations [--start YYYY-MM-DD] [--end YYYY-MM-DD] [--need-status N] [--page N] [--page-size N]
  sustech pms check
  sustech pms server-groups
  sustech pms stations [--server-group N]
  sustech pms jobs
  sustech pms scan-jobs
  sustech pms usage --begin YYYY-MM-DD --end YYYY-MM-DD [--type N] [--page N] [--page-size N]
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
  sustech tis classroom live ROOM [--semester YYYY-YYYY-N]
  sustech tis classroom now ROOM [--semester YYYY-YYYY-N]
  sustech tis evals [--semester YYYY-YYYY-N] [--status all|pending|draft|submitted]
  sustech tis ical [--semester YYYY-YYYY-N] [--week-one-monday YYYY-MM-DD|--teaching-start YYYY-MM-DD] [--calendar-name NAME]
  sustech tis selection preview OP --course-id ID [--rwh RWH] [--semester YYYY-YYYY-N] [--round ROUND] [--bid N] [--where cart|enrolled] [--cultivation 1|2]
  sustech tis selection apply OP --course-id ID --rwh RWH [--semester YYYY-YYYY-N] [--round ROUND] [--bid N] [--where cart|enrolled] [--cultivation 1|2] --confirm
  sustech tis bid plan --pick COURSE_ID:BID|RWH:COURSE_ID:BID [--pick ...] [--semester YYYY-YYYY-N] [--bid-limit N] [--where cart|enrolled] [--round ROUND] [--cultivation 1|2]
  sustech tis bid apply --pick RWH:COURSE_ID:BID [--pick ...] [--semester YYYY-YYYY-N] [--where cart|enrolled] [--round ROUND] [--cultivation 1|2] --confirm
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
  'sustech auth login' verifies credentials, then stores the password in the operating-system credential store.
  Use --profile to select an account. Environment variables and --credentials-file remain explicit automation overrides.
  The CLI never accepts a password on the command line and never stores one in its config file.

Safety:
  TIS preview commands are local-only. Blackboard submission preview performs authenticated read-only checks.
  Blackboard/TIS apply commands change remote state only with --confirm.
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
  "content-id"?: string;
  "column-id"?: string;
  file?: string;
  comment?: string;
  "expected-sha256"?: string;
  destination?: string;
  overwrite?: boolean;
  days?: string;
  course?: string;
  kind?: string;
  attachments?: string;
  live?: boolean;
  "allow-late"?: boolean;
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
  available?: boolean;
  start?: string;
  end?: string;
  begin?: string;
  "kind-id"?: string;
  "lab-id"?: string;
  "class-kind"?: string;
  "need-status"?: string;
  "server-group"?: string;
  type?: string;
  service?: string;
  profile?: string;
  sid?: string;
  "password-stdin"?: boolean;
  help?: boolean;
};

type AuthService = "tis" | "bb" | "ws" | "booking" | "lib-booking" | "pms";

const SHARED_OUTPUT_OPTIONS = new Set(["output", "json", "jsonl", "pretty"]);
const COMMAND_OPTIONS: Readonly<Record<string, readonly string[]>> = {
  "auth login": ["profile", "sid", "service", "password-stdin"],
  "auth status": ["profile"],
  "auth logout": ["profile"],
  "auth check": ["service", "credentials-file", "profile"],
  doctor: ["profile", "credentials-file", "service", "live"],
  "calendar terms": ["year", "calendar-level"],
  "calendar day": ["date", "calendar-level"],
  "faculty list": ["full", "limit"],
  "faculty search": ["department", "limit"],
  context: ["date", "level", "live", "credentials-file"],
  "resources list": ["category"],
  "resources search": ["category"],
  "wifi events": ["minutes"],
  "papers search": ["max", "min-year", "open-access", "resolve-oa"],
  "papers fetch-oa": ["destination", "overwrite"],
  "nces browse": ["page", "page-size", "sort"],
  "bb user": ["credentials-file"],
  "bb courses": ["credentials-file"],
  "bb content": ["credentials-file", "parent-id"],
  "bb attachments": ["credentials-file"],
  "bb download": ["credentials-file", "destination", "overwrite"],
  "bb assignments": ["credentials-file"],
  "bb deadlines": ["credentials-file", "days", "course"],
  "bb search": ["credentials-file", "course", "kind", "attachments", "page", "page-size"],
  "bb sync": ["credentials-file", "content-id", "destination", "overwrite"],
  "bb attempts": ["credentials-file", "content-id", "column-id", "status"],
  "bb submit preview": ["credentials-file", "course-id", "content-id", "column-id", "file", "comment"],
  "bb submit apply": ["credentials-file", "course-id", "content-id", "column-id", "file", "expected-sha256", "comment", "allow-late", "confirm"],
  "ws programs": ["credentials-file", "page", "page-size"],
  "ws detail": ["credentials-file", "program-code", "program-token"],
  "library search-url": ["limit"],
  "booking whoami": ["credentials-file"],
  "booking rooms": ["credentials-file", "available", "page", "page-size"],
  "booking my-meetings": ["credentials-file", "page", "page-size"],
  "lib-booking whoami": ["credentials-file"],
  "lib-booking home-summary": ["credentials-file"],
  "lib-booking labs": ["credentials-file", "class-kind"],
  "lib-booking rooms": ["credentials-file", "kind-id", "lab-id", "class-kind"],
  "lib-booking reservation-count": ["credentials-file"],
  "lib-booking reservations": ["credentials-file", "start", "end", "need-status", "page", "page-size"],
  "pms check": ["credentials-file"],
  "pms server-groups": ["credentials-file"],
  "pms stations": ["credentials-file", "server-group"],
  "pms jobs": ["credentials-file"],
  "pms scan-jobs": ["credentials-file"],
  "pms usage": ["credentials-file", "begin", "end", "type", "page", "page-size"],
  "tis courses search": ["credentials-file", "semester", "limit", "refresh"],
  "tis courses available": ["credentials-file", "semester", "limit", "round"],
  "tis enrolled": ["credentials-file", "semester"],
  "tis schedule": ["credentials-file", "semester", "week", "all"],
  "tis grades": ["credentials-file", "semester"],
  "tis exams": ["credentials-file"],
  "tis classroom rooms": ["credentials-file", "semester", "refresh"],
  "tis classroom occupancy": ["credentials-file", "semester", "refresh", "week", "day", "period-start", "period-end"],
  "tis classroom free": ["credentials-file", "semester", "refresh", "week", "day", "period-start", "period-end"],
  "tis classroom live": ["credentials-file", "semester"],
  "tis classroom now": ["credentials-file", "semester"],
  "tis evals": ["credentials-file", "semester", "status"],
  "tis ical": ["credentials-file", "semester", "week-one-monday", "teaching-start", "calendar-name"],
  "tis timetable": ["credentials-file", "semester", "refresh", "max", "block"],
  "tis enroll preview": ["semester", "course-id", "rwh", "round", "bid"],
  "tis selection preview": ["semester", "course-id", "rwh", "round", "bid", "where", "cultivation"],
  "tis selection apply": ["credentials-file", "semester", "course-id", "rwh", "round", "bid", "where", "cultivation", "confirm"],
  "tis bid plan": ["semester", "pick", "bid-limit", "where", "round", "cultivation"],
  "tis bid apply": ["credentials-file", "semester", "pick", "where", "round", "cultivation", "confirm"],
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
        "content-id": { type: "string" },
        "column-id": { type: "string" },
        file: { type: "string" },
        comment: { type: "string" },
        "expected-sha256": { type: "string" },
        destination: { type: "string" },
        overwrite: { type: "boolean", default: false },
        days: { type: "string" },
        course: { type: "string" },
        kind: { type: "string" },
        attachments: { type: "string" },
        live: { type: "boolean", default: false },
        "allow-late": { type: "boolean", default: false },
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
        available: { type: "boolean", default: false },
        start: { type: "string" },
        end: { type: "string" },
        begin: { type: "string" },
        "kind-id": { type: "string" },
        "lab-id": { type: "string" },
        "class-kind": { type: "string" },
        "need-status": { type: "string" },
        "server-group": { type: "string" },
        type: { type: "string" },
        service: { type: "string" },
        profile: { type: "string" },
        sid: { type: "string" },
        "password-stdin": { type: "boolean", default: false },
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
    const backend = await getCredentialBackendStatus();
    const credentialStorage = {
      profiles: true,
      passwordArgument: false,
      precedence: ["credentials-file", "environment", "environment-file", "system-keyring"],
      backend,
    };
    const data = { schemaVersion: "1", outputModes: ["text", "json", "jsonl"], credentialStorage, capabilities };
    writeSuccess({
      command: "capabilities",
      data,
      text: `${formatCapabilities(capabilities)}\n\nCredential storage\n  ${backend.backend}: ${backend.available ? "available" : "unavailable"} (${backend.persistent ? "persistent" : "non-persistent"})`,
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
  if (group === "doctor" && command === undefined) {
    await runDoctor(values, output);
    return;
  }
  if (group === "auth") {
    await runAuth(parsed.positionals, values, output);
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
  if (group === "booking") {
    await runBooking(parsed.positionals, values, output);
    return;
  }
  if (group === "lib-booking") {
    await runLibraryBooking(parsed.positionals, values, output);
    return;
  }
  if (group === "pms") {
    await runPms(parsed.positionals, values, output);
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
  if (command === "classroom" && operation === "live") {
    const roomQuery = parsed.positionals.slice(3).join(" ").trim();
    if (!roomQuery) throw usageError("A classroom room name or room code is required.");
    const semester = parseSemester(values.semester);
    const { session } = await authenticatedSession(values);
    const rooms = await fetchLiveRoomCatalog(session, semester);
    const resolution = resolveLiveRoom(rooms, roomQuery);
    if (resolution.status === "missing") {
      throw new CliError("No live classroom room matched the provided name or room code.", "TIS_CLASSROOM_NOT_FOUND", 1, {
        room: roomQuery,
      });
    }
    if (resolution.status === "ambiguous") {
      throw new CliError("Multiple live classroom rooms matched the provided name; use an exact room code or full name.", "TIS_CLASSROOM_AMBIGUOUS", 2, {
        room: roomQuery,
        matches: resolution.matches.slice(0, 10),
      });
    }
    const room = resolution.room;
    if (!room) throw new CliError("Resolved live classroom room is missing.", "TIS_PROTOCOL_ERROR", 1, { room: roomQuery });
    const entries = await fetchLiveRoomSchedule(session, semester, room.roomCode);
    const outputRoom = classroomLiveRoomOutput(room);
    const outputEntries = entries.map(classroomLiveEntryOutput);
    writeSuccess({
      command: "tis classroom live",
      data: { semester, query: roomQuery, room: outputRoom, entries: outputEntries, total: outputEntries.length },
      text: formatClassroomLive(room, entries, { title: `Live classroom schedule · ${semester.value}` }),
      items: outputEntries,
      summary: { semester: semester.value, room: room.roomLabel, roomCode: room.roomCode, total: outputEntries.length },
    }, output);
    return;
  }
  if (command === "classroom" && operation === "now") {
    const roomQuery = parsed.positionals.slice(3).join(" ").trim();
    if (!roomQuery) throw usageError("A classroom room name or room code is required.");
    const semester = parseSemester(values.semester);
    const { session } = await authenticatedSession(values);
    const rooms = await fetchLiveRoomCatalog(session, semester);
    const resolution = resolveLiveRoom(rooms, roomQuery);
    if (resolution.status === "missing") {
      throw new CliError("No live classroom room matched the provided name or room code.", "TIS_CLASSROOM_NOT_FOUND", 1, {
        room: roomQuery,
      });
    }
    if (resolution.status === "ambiguous") {
      throw new CliError("Multiple live classroom rooms matched the provided name; use an exact room code or full name.", "TIS_CLASSROOM_AMBIGUOUS", 2, {
        room: roomQuery,
        matches: resolution.matches.slice(0, 10),
      });
    }
    const room = resolution.room;
    if (!room) throw new CliError("Resolved live classroom room is missing.", "TIS_PROTOCOL_ERROR", 1, { room: roomQuery });
    const client = new TisClient(session);
    const week = await client.currentWeek();
    const entries = await fetchLiveRoomSchedule(session, semester, room.roomCode);
    const window = teachingPeriodAtShenzhenTime(new Date());
    const fallbackNow = { date: todayInShenzhen(), time: timeInShenzhen(), weekday: weekdayInShenzhen() };
    const active = window
      ? summariseLiveOccupancy(entries, {
          week,
          day: window.weekday,
          periodStart: window.periodStart,
          periodEnd: window.periodEnd,
        })
      : [];
    const outputRoom = classroomLiveRoomOutput(room);
    const outputEntries = active.map(classroomLiveEntryOutput);
    writeSuccess({
      command: "tis classroom now",
      data: {
        semester,
        query: roomQuery,
        room: outputRoom,
        now: {
          week,
          ...(window ?? fallbackNow),
        },
        entries: outputEntries,
        total: outputEntries.length,
      },
      text: formatClassroomNow(room, active, {
        date: window?.date ?? fallbackNow.date,
        time: window?.time ?? fallbackNow.time,
        week,
        weekday: window?.weekday ?? fallbackNow.weekday,
        ...(window ? { periodLabel: window.periodLabel } : {}),
      }),
      items: outputEntries,
      summary: {
        semester: semester.value,
        room: room.roomLabel,
        roomCode: room.roomCode,
        week,
        weekday: window?.weekday ?? fallbackNow.weekday,
        total: outputEntries.length,
      },
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
    const rwh = values.rwh ? opaqueToken(values.rwh, "--rwh") : undefined;
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
    const applyCommand = selectionOperation === "enroll"
      ? (rwh ? buildEnrollApplyCommand({
          semester,
          courseId,
          rwh,
          round: opaqueToken(values.round ?? "yixuan", "--round"),
          bid: bid ?? 1,
        }) : undefined)
      : (rwh ? buildSelectionApplyCommand({
          operation: selectionOperation,
          courseId,
          rwh,
          round: opaqueToken(values.round ?? defaultSelectionRound(selectionOperation), "--round"),
          bid: bid ?? defaultSelectionBid(selectionOperation),
          where,
          cultivation,
          semester,
        }) : undefined);
    const data = {
      mode: "preview",
      mutation: false,
      applyAvailable: Boolean(applyCommand),
      contextSource: "local",
      preview,
      exactTarget: { courseId, ...(rwh ? { rwh } : {}) },
      ...(applyCommand ? { confirmation: { required: true, command: applyCommand } } : {}),
    };
    writeSuccess({
      command: "tis selection preview",
      data,
      text: formatSelectionPreview(preview, {
        exactTarget: { courseId, ...(rwh ? { rwh } : {}) },
        ...(applyCommand ? { applyCommand } : {}),
      }),
    }, output);
    return;
  }
  if (command === "selection" && operation === "apply" && parsed.positionals.length === 4) {
    const selectionOperation = selectionOperationValue(required(parsed.positionals[3], "selection operation"));
    if (selectionOperation === "enroll") {
      throw usageError("Use `sustech tis enroll apply` for enroll operations.");
    }
    if (!values.confirm) {
      throw new CliError(
        "TIS selection apply changes remote selection state. Re-run with --confirm after reviewing the preview.",
        "CONFIRMATION_REQUIRED",
        3,
        { action: "tis selection apply" },
      );
    }
    const semester = parseSemester(values.semester);
    const cultivation = selectionCultivation(values.cultivation);
    const target = selectionApplyTarget(values, selectionOperation);
    const client = await tisClient(values);
    const state = await client.selectionState(semester, {
      keyword: "",
      round: target.round,
      limit: 50,
      cultivation,
    });
    const precheck = revalidateSelectionWrite(state, target);
    if (!precheck.ok) {
      throw new CliError("TIS selection pre-check failed; no mutation was performed.", precheck.code, 4, {
        target,
        observation: precheck.observation,
        reason: precheck.message,
        warning: "NO_MUTATION_PERFORMED",
      });
    }
    const preview = buildSelectionPreview(
      { semester, cultivation, currentTerm: state.currentTerm },
      {
        operation: target.operation,
        courseId: target.courseId,
        round: target.round,
        bid: target.bid,
        where: target.where,
      },
    );
    const result = await client.selectionWrite(preview);
    if (result.jg !== "1") {
      throw new CliError(result.message || "TIS rejected the selection mutation.", "TIS_WRITE_REJECTED", 4, {
        target,
        tisCode: result.jg,
      });
    }
    let verification;
    try {
      const postState = await client.selectionState(semester, {
        keyword: "",
        round: target.round,
        limit: 50,
        cultivation,
      });
      verification = verifySelectionWrite(postState, target);
    } catch (error) {
      throw new CliError(
        "TIS accepted the selection mutation, but read-back verification could not be completed.",
        "TIS_SELECTION_OUTCOME_UNKNOWN",
        5,
        {
          target,
          cause: error instanceof Error ? error.message : String(error),
          warning: "DO_NOT_RETRY_AUTOMATICALLY",
        },
      );
    }
    ensureSelectionVerified(verification, {
      message: "TIS accepted the selection mutation, but the exact target was not conclusively verified.",
      code: "TIS_SELECTION_NOT_CONFIRMED",
      details: { target, result },
    });
    writeSuccess({
      command: "tis selection apply",
      data: { mode: "apply", mutation: true, target, result, verification },
      text: formatSelectionApplySuccess(target, result.message, verification),
    }, output);
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
    const applyCommand = plan.errors.length === 0 && plan.pickDetails.length > 0 && plan.pickDetails.every((pick) => pick.rwh)
      ? buildBidApplyCommand({
          picks: plan.pickDetails,
          where,
          round: opaqueToken(values.round ?? "yixuan", "--round"),
          cultivation,
          semester,
        })
      : undefined;
    writeSuccess({
      command: "tis bid plan",
      data: {
        mode: "plan",
        mutation: false,
        applyAvailable: Boolean(applyCommand),
        semester,
        ...plan,
        ...(applyCommand ? { confirmation: { required: true, command: applyCommand } } : {}),
      },
      text: formatBidPlan(plan, applyCommand ? { applyCommand } : {}),
      items: plan.previews,
      summary: { semester: semester.value, where, totalBid: plan.totalBid, limit, overLimit: plan.overLimit, total: plan.previews.length },
    }, output);
    return;
  }
  if (command === "bid" && operation === "apply" && parsed.positionals.length === 3) {
    if (!values.confirm) {
      throw new CliError(
        "TIS bid apply changes remote bid state. Re-run with --confirm after reviewing the plan.",
        "CONFIRMATION_REQUIRED",
        3,
        { action: "tis bid apply" },
      );
    }
    const semester = parseSemester(values.semester);
    const picks = parseBidPicks(values.pick ?? []);
    if (picks.some((pick) => !pick.rwh)) {
      throw usageError("tis bid apply requires every --pick to use RWH:COURSE_ID:BID.");
    }
    const where = selectionWhere(values.where);
    const cultivation = selectionCultivation(values.cultivation);
    const round = opaqueToken(values.round ?? "yixuan", "--round");
    const client = await tisClient(values);
    let state = await client.selectionState(semester, { keyword: "", round, limit: 50, cultivation });
    const projection = projectBidTotal(state, picks, where);
    if (projection.missingTargets.length > 0) {
      throw new CliError("TIS bid pre-check failed; some exact targets were not observed in live state.", "TIS_BID_PRECHECK_FAILED", 4, {
        where,
        round,
        missingTargets: projection.missingTargets,
        warning: "NO_MUTATION_PERFORMED",
      });
    }
    if (projection.overLimit) {
      throw new CliError("The live round bid budget would be exceeded; no mutation was performed.", "TIS_BID_LIMIT_EXCEEDED", 4, {
        where,
        round,
        projectedTotalBid: projection.totalBid,
        previousTotalBid: projection.previousTotalBid,
        limit: projection.limit,
        warning: "NO_MUTATION_PERFORMED",
      });
    }

    const confirmed: BidPick[] = [];
    const unchanged: BidPick[] = [];
    for (const pick of picks) {
      const target: SelectionApplyTarget = {
        operation: "bid.update",
        courseId: pick.courseId,
        rwh: pick.rwh!,
        round,
        bid: pick.bid,
        where,
      };
      const precheck = revalidateSelectionWrite(state, target);
      if (!precheck.ok) {
        if (confirmed.length > 0) {
          throw new CliError("TIS bid flow is partial: earlier picks were confirmed, but a later live pre-check failed.", "TIS_BID_PARTIAL_UNKNOWN", 5, {
            target,
            confirmed,
            unchanged,
            observation: precheck.observation,
            reason: precheck.message,
            warning: "DO_NOT_RETRY_AUTOMATICALLY",
          });
        }
        throw new CliError("TIS bid pre-check failed before the next write; no mutation was performed.", precheck.code, 4, {
          target,
          confirmed,
          unchanged,
          observation: precheck.observation,
          reason: precheck.message,
          warning: "NO_MUTATION_PERFORMED",
        });
      }
      const observed = where === "cart" ? precheck.observation.cart : precheck.observation.enrolled;
      if (observed?.bid === pick.bid) {
        unchanged.push(pick);
        continue;
      }
      const preview = buildSelectionPreview(
        { semester, cultivation, currentTerm: state.currentTerm },
        {
          operation: "bid.update",
          courseId: pick.courseId,
          round,
          bid: pick.bid,
          where,
        },
      );
      const result = await client.selectionWrite(preview);
      if (result.jg !== "1") {
        if (confirmed.length > 0) {
          throw new CliError("TIS bid flow is partial: earlier picks were confirmed, but a later bid update was rejected.", "TIS_BID_PARTIAL_UNKNOWN", 5, {
            target,
            confirmed,
            unchanged,
            tisCode: result.jg,
            result,
            warning: "DO_NOT_RETRY_AUTOMATICALLY",
          });
        }
        throw new CliError(result.message || "TIS rejected the bid update.", "TIS_WRITE_REJECTED", 4, {
          target,
          confirmed,
          unchanged,
          tisCode: result.jg,
        });
      }
      try {
        state = await client.selectionState(semester, { keyword: "", round, limit: 50, cultivation });
      } catch (error) {
        throw new CliError(
          "TIS accepted a bid update, but read-back verification could not be completed.",
          "TIS_BID_OUTCOME_UNKNOWN",
          5,
          {
            target,
            confirmed,
            unchanged,
            cause: error instanceof Error ? error.message : String(error),
            warning: "DO_NOT_RETRY_AUTOMATICALLY",
          },
        );
      }
      const verification = verifySelectionWrite(state, target);
      ensureSelectionVerified(verification, {
        message: "TIS accepted a bid update, but the exact target was not conclusively verified.",
        code: "TIS_BID_NOT_CONFIRMED",
        details: { target, confirmed, unchanged },
      });
      confirmed.push(pick);
    }
    const finalObservation = {
      totalBid: projection.totalBid,
      roundCode: state.round.xkfsdm ? String(state.round.xkfsdm) : undefined,
      roundLimit: state.round.jffs === undefined ? undefined : Number(state.round.jffs),
    };
    writeSuccess({
      command: "tis bid apply",
      data: {
        mode: "apply",
        mutation: true,
        where,
        round,
        confirmed,
        unchanged,
        total: picks.length,
        observedState: finalObservation,
      },
      text: formatBidApplySuccess(picks, where, round, finalObservation),
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

async function runAuth(positionals: readonly string[], values: Values, output: OutputOptions): Promise<void> {
  const [, command, operation] = positionals;
  if (operation !== undefined) throw usageError(`Unknown command: ${positionals.join(" ")}`);

  if (command === "login") {
    const environmentProfile = process.env.SUSTECH_PROFILE?.trim() || undefined;
    const profile = validateProfileName(values.profile ?? environmentProfile ?? DEFAULT_CREDENTIAL_PROFILE);
    const service = authServiceValue(values.service, "bb");
    if (values["password-stdin"] && !values.sid) {
      throw usageError("--password-stdin requires --sid so stdin contains only the password.");
    }
    const backend = await getCredentialBackendStatus();
    if (!backend.available) {
      throw new CliError(
        backend.reason ?? "No secure system credential store is available.",
        "CREDENTIAL_STORE_UNAVAILABLE",
        2,
        {
          backend: backend.backend,
          persistent: backend.persistent,
          ...(backend.remediation ? { remediation: backend.remediation } : {}),
        },
      );
    }
    const sid = validateCredentialSid(values.sid ?? await promptLoginSid());
    const password = validateCredentialPassword(
      values["password-stdin"] ? await readPasswordFromStdin() : await promptHiddenPassword(),
    );
    const authenticated = await authenticateCredentials({ sid, password, source: "interactive" }, service);
    const stored = await saveStoredCredentials({ profile, sid, password });
    const identity = authenticated.identity ? `\nIdentity: ${authenticated.identity}` : "";
    writeSuccess({
      command: "auth login",
      data: {
        authenticated: true,
        service,
        credentialsStored: true,
        credentialSource: "system-keyring",
        ...stored,
        ...(authenticated.identity ? { identity: authenticated.identity } : {}),
      },
      text: [
        `${service.toUpperCase()} credentials verified.${identity}`,
        `Saved profile '${stored.profile}' (${stored.maskedSid}) to ${stored.backend}.`,
      ].join("\n"),
    }, output);
    return;
  }

  if (command === "status") {
    const status = await getCredentialStatus(values.profile);
    const availability = status.credentialAvailable ? "ready" : status.configured ? "secret missing or locked" : "not configured";
    const remediation = status.remediation ? `\n${status.remediation}` : "";
    writeSuccess({
      command: "auth status",
      data: status,
      text: [
        `Credential profile '${status.profile}': ${availability}`,
        `Backend: ${status.backend} (${status.backendAvailable ? "available" : "unavailable"}, ${status.persistent ? "persistent" : "non-persistent"})`,
        ...(status.maskedSid ? [`Account: ${status.maskedSid}`] : []),
        ...(status.reason ? [`Reason: ${status.reason}${remediation}`] : []),
      ].join("\n"),
    }, output);
    return;
  }

  if (command === "logout") {
    const result = await deleteStoredCredentials(values.profile);
    writeSuccess({
      command: "auth logout",
      data: result,
      text: result.removed
        ? `Removed credential profile '${result.profile}' from ${result.backend}.`
        : `Credential profile '${result.profile}' was not configured.`,
    }, output);
    return;
  }

  if (command === "check") {
    const service = authServiceValue(values.service);
    const result = await checkAuthentication(values, service);
    const credentialsStored = result.credentialSource === "system-keyring";
    const data = { ...result, service, credentialsStored };
    const identity = result.identity ? `\nIdentity: ${result.identity}` : "";
    writeSuccess({
      command: "auth check",
      data,
      text: `${service.toUpperCase()} ${formatAuthCheck(result.credentialSource, credentialsStored)}${identity}`,
    }, output);
    return;
  }

  throw usageError(`Unknown command: ${positionals.join(" ")}`);
}

async function runDoctor(values: Values, output: OutputOptions): Promise<void> {
  const services = doctorServices(values.service);
  const backend = await getCredentialBackendStatus();
  const profile = await getCredentialStatus(values.profile);
  const liveResults: DoctorLiveResult[] = [];
  let credentialSource: string | undefined;

  if (values.live) {
    let credentials: Credentials | undefined;
    let credentialError: unknown;
    try {
      credentials = await resolvedCredentials(values);
      credentialSource = credentials.source;
    } catch (error) {
      credentialError = error;
    }

    for (const service of services) {
      if (!credentials) {
        liveResults.push({ service, status: "fail", ...doctorFailure(credentialError) });
        continue;
      }
      try {
        const result = await authenticateCredentials(credentials, service);
        liveResults.push({
          service,
          status: "pass",
          message: `authentication succeeded via ${result.credentialSource}`,
          ...(result.identity ? { identity: result.identity } : {}),
        });
      } catch (error) {
        liveResults.push({ service, status: "fail", ...doctorFailure(error) });
      }
    }
  }

  const report = buildDoctorReport({
    backend,
    profile,
    services,
    live: Boolean(values.live),
    ...(credentialSource ? { credentialSource } : {}),
    ...(values.live ? { liveResults } : {}),
  });
  writeSuccess({
    command: "doctor",
    data: report,
    text: formatDoctorReport(report),
    items: report.checks,
    summary: report.summary,
  }, output);
}

async function authenticatedSession(values: Values): Promise<{ session: TisSession; credentialSource: string }> {
  const credentials = await resolvedCredentials(values);
  return { session: new TisSession(credentials), credentialSource: credentials.source };
}

async function checkAuthentication(
  values: Values,
  service: AuthService,
): Promise<{
  authenticated: true;
  credentialSource: string;
  identity?: string;
  profile?: string;
  credentialBackend?: string;
}> {
  const credentials = await resolvedCredentials(values);
  const result = await authenticateCredentials(credentials, service);
  return {
    ...result,
    ...(credentials.profile ? { profile: credentials.profile } : {}),
    ...(credentials.backend ? { credentialBackend: credentials.backend } : {}),
  };
}

async function authenticateCredentials(
  credentials: Credentials,
  service: AuthService,
): Promise<{ authenticated: true; credentialSource: string; identity?: string }> {
  if (service === "tis") {
    await new TisSession(credentials).login();
    return { authenticated: true, credentialSource: credentials.source };
  }
  if (service === "bb" || service === "ws") {
    await new CasSession(credentials, casServiceConfig(service)).login();
    return { authenticated: true, credentialSource: credentials.source };
  }
  if (service === "booking") {
    const session = new BookingSession(credentials);
    await session.login();
    return {
      authenticated: true,
      credentialSource: credentials.source,
      ...(session.userProfile?.name ? { identity: session.userProfile.name } : {}),
    };
  }
  if (service === "lib-booking") {
    const session = new LibraryBookingSession(credentials);
    await session.login();
    const user = await getLibraryBookingUser(session);
    return {
      authenticated: true,
      credentialSource: credentials.source,
      ...((user.trueName || user.logonName) ? { identity: user.trueName || user.logonName } : {}),
    };
  }
  if (service === "pms") {
    const session = new PmsSession({ username: credentials.sid, password: credentials.password });
    await session.login();
    const check = await session.check();
    if (!check.authenticated) {
      throw new CliError("PMS login completed but the session check failed.", "AUTHENTICATION_FAILED", 2, {
        service: "pms",
      });
    }
    return {
      authenticated: true,
      credentialSource: credentials.source,
      ...(check.displayName ? { identity: check.displayName } : {}),
    };
  }
  throw usageError("Unsupported authentication service.");
}

async function bookingService(values: Values): Promise<BookingSession> {
  const credentials = await resolvedCredentials(values);
  return new BookingSession(credentials);
}

async function libraryBookingService(values: Values): Promise<LibraryBookingSession> {
  const credentials = await resolvedCredentials(values);
  return new LibraryBookingSession(credentials);
}

async function pmsService(values: Values): Promise<PmsSession> {
  const credentials = await resolvedCredentials(values);
  return new PmsSession({ username: credentials.sid, password: credentials.password });
}

async function authenticatedCasService(
  values: Values,
  config: CasServiceConfig,
): Promise<{ session: CasSession; credentialSource: string }> {
  const credentials = await resolvedCredentials(values);
  return { session: new CasSession(credentials, config), credentialSource: credentials.source };
}

async function resolvedCredentials(values: Values): Promise<Credentials> {
  return resolveCredentials({
    credentialsFile: values["credentials-file"],
    profile: values.profile,
  });
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
  const live = values.live ? await loadLiveContext(date, values) : undefined;
  const snapshot = service.build({
    now: `${date}T12:00:00+08:00`,
    calendar,
    ...(live?.nextDeadline ? { nextDeadline: live.nextDeadline } : {}),
  }, level);
  const liveText = live ? formatContextLiveSources(live.liveSources) : [];
  writeSuccess({
    command: "context",
    data: {
      ...service.toRecord(snapshot),
      ...(live ? { liveSources: live.liveSources } : {}),
    },
    text: [...snapshot.lines, ...liveText].join("\n"),
    ...(live ? { meta: { liveSources: live.liveSources } } : {}),
  }, output);
}

type ContextLiveSourceState = "provided" | "missing" | "partial" | "credentials-missing" | "error";

interface ContextLiveSourceStatus {
  state: ContextLiveSourceState;
  generatedAt?: string;
  failureCount?: number;
  message?: string;
}

async function loadLiveContext(
  date: string,
  values: Values,
): Promise<{ nextDeadline?: DeadlineSummary; liveSources: { blackboardDeadlines: ContextLiveSourceStatus } }> {
  const now = new Date(`${date}T12:00:00+08:00`);
  try {
    const adapter = await casServiceAdapter(values, "bb");
    const report = await listBlackboardDeadlines(adapter, { now });
    const deadline = nextBlackboardDeadline(report);
    return {
      ...(deadline ? { nextDeadline: contextDeadlineSummary(deadline) } : {}),
      liveSources: {
        blackboardDeadlines: {
          state: report.failures.length > 0 ? "partial" : deadline ? "provided" : "missing",
          generatedAt: report.generatedAt,
          ...(report.failures.length > 0 ? { failureCount: report.failures.length, message: report.failures[0]?.message } : {}),
        },
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof CliError && error.code === "CREDENTIALS_REQUIRED") {
      return {
        liveSources: {
          blackboardDeadlines: {
            state: "credentials-missing",
            message,
          },
        },
      };
    }
    return {
      liveSources: {
        blackboardDeadlines: {
          state: "error",
          message,
        },
      },
    };
  }
}

function contextDeadlineSummary(input: {
  title: string;
  courseCode: string;
  courseName: string;
  dueAt: string;
  daysLeft: number;
}): DeadlineSummary {
  return {
    name: `${input.courseCode} · ${input.title}`,
    course: input.courseName || input.courseCode,
    dueAt: input.dueAt,
    daysLeft: input.daysLeft,
  };
}

function formatContextLiveSources(sources: { blackboardDeadlines: ContextLiveSourceStatus }): string[] {
  const details = [
    `Blackboard deadlines: ${sources.blackboardDeadlines.state}`,
    ...(sources.blackboardDeadlines.failureCount ? [`${sources.blackboardDeadlines.failureCount} failure(s)`] : []),
    ...(sources.blackboardDeadlines.message ? [sources.blackboardDeadlines.message] : []),
  ].join(" · ");
  return [`Live sources: ${details}`];
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
  if (positionals[1] === "fetch-oa" && positionals.length === 3) {
    const doi = doiValue(positionals[2] ?? "");
    const destination = required(values.destination, "--destination");
    const downloaded = await downloadOpenAccessPdf(doi, destination, { overwrite: Boolean(values.overwrite) });
    writeSuccess({
      command: "papers fetch-oa",
      data: downloaded,
      text: formatPaperDownload(downloaded),
    }, output);
    return;
  }
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
  if (command === "submit" && positionals[2] === "preview" && positionals.length === 3) {
    const target = blackboardSubmissionTarget(values);
    const file = await inspectBlackboardSubmissionFile(required(values.file, "--file"));
    const comment = submissionComment(values.comment);
    const adapter = await casServiceAdapter(values, "bb");
    const preflight = await buildBlackboardSubmissionPreflight(adapter, values, target, file, comment);
    writeSuccess({
      command: "bb submit preview",
      data: { mode: "preview", mutation: false, ...preflight },
      text: formatBlackboardSubmitPreview(preflight),
    }, output);
    return;
  }
  if (command === "user" && positionals.length === 2) {
    const adapter = await casServiceAdapter(values, "bb");
    const user = await getBlackboardUser(adapter);
    writeSuccess({ command: "bb user", data: user, text: formatBlackboardUser(user) }, output);
    return;
  }
  if (command === "courses") {
    const adapter = await casServiceAdapter(values, "bb");
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
    const adapter = await casServiceAdapter(values, "bb");
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
  if (command === "attachments" && positionals.length === 4) {
    const courseId = opaqueToken(required(positionals[2], "Blackboard course ID"), "Blackboard course ID");
    const contentId = opaqueToken(required(positionals[3], "Blackboard content ID"), "Blackboard content ID");
    const adapter = await casServiceAdapter(values, "bb");
    const attachments = await listBlackboardContentAttachments(adapter, courseId, contentId);
    writeSuccess({
      command: "bb attachments",
      data: { courseId, contentId, attachments, total: attachments.length },
      text: formatBlackboardAttachments(attachments, contentId),
      items: attachments,
      summary: { courseId, contentId, total: attachments.length },
    }, output);
    return;
  }
  if (command === "download" && positionals.length === 5) {
    const courseId = opaqueToken(required(positionals[2], "Blackboard course ID"), "Blackboard course ID");
    const contentId = opaqueToken(required(positionals[3], "Blackboard content ID"), "Blackboard content ID");
    const attachmentId = opaqueToken(required(positionals[4], "Blackboard attachment ID"), "Blackboard attachment ID");
    const destination = required(values.destination, "--destination");
    const adapter = await casServiceAdapter(values, "bb");
    const result = await downloadBlackboardContentAttachment(
      adapter,
      courseId,
      contentId,
      attachmentId,
      destination,
      { overwrite: values.overwrite === true },
    );
    writeSuccess({
      command: "bb download",
      data: { courseId, contentId, ...result },
      text: formatBlackboardAttachmentDownload(result, contentId),
    }, output);
    return;
  }
  if (command === "assignments" && positionals.length === 3) {
    const adapter = await casServiceAdapter(values, "bb");
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
  if (command === "deadlines" && positionals.length === 2) {
    const days = values.days === undefined ? undefined : parsePositiveInteger(values.days, 1, "--days");
    const courseQuery = values.course?.trim() || undefined;
    const adapter = await casServiceAdapter(values, "bb");
    const report = await listBlackboardDeadlines(adapter, {
      now: new Date(),
      ...(days !== undefined ? { days } : {}),
      ...(courseQuery ? { courseQuery } : {}),
    });
    writeSuccess({
      command: "bb deadlines",
      data: report,
      text: formatBlackboardDeadlines(report),
      items: report.deadlines,
      summary: {
        ...(days !== undefined ? { days } : {}),
        ...(courseQuery ? { courseQuery } : {}),
        coursesMatched: report.coursesMatched,
        coursesScanned: report.coursesScanned,
        total: report.deadlines.length,
        failures: report.failures.length,
      },
      ...(report.failures.length > 0 ? { meta: { failures: report.failures } } : {}),
    }, output);
    return;
  }
  if (command === "search") {
    const query = positionals.slice(2).join(" ").trim();
    if (!query) throw usageError("A Blackboard search query is required.");
    const page = parsePositiveInteger(values.page, 1, "--page");
    const pageSize = parsePositiveInteger(values["page-size"], 25, "--page-size");
    if (pageSize > 100) throw usageError("--page-size cannot exceed 100 for Blackboard search.");
    const courseQuery = values.course?.trim() || undefined;
    const kind = values.kind ? blackboardContentKind(values.kind) : undefined;
    const attachments = blackboardSearchAttachmentMode(values.attachments);
    const adapter = await casServiceAdapter(values, "bb");
    const report = await searchBlackboardContentTree(adapter, {
      query,
      ...(courseQuery ? { courseQuery } : {}),
      ...(kind ? { kind } : {}),
      attachments,
      page,
      pageSize,
    });
    writeSuccess({
      command: "bb search",
      data: report,
      text: formatBlackboardSearch(report),
      items: report.results,
      summary: {
        query,
        page: report.page,
        pageSize: report.pageSize,
        totalMatches: report.totalMatches,
        returned: report.returned,
        hasMore: report.hasMore,
        failures: report.failures.length,
      },
      ...(report.failures.length > 0 ? { meta: { failures: report.failures } } : {}),
    }, output);
    return;
  }
  if (command === "sync" && positionals.length === 3) {
    const courseId = opaqueToken(required(positionals[2], "Blackboard course ID"), "Blackboard course ID");
    const destination = required(values.destination, "--destination");
    const adapter = await casServiceAdapter(values, "bb");
    const report = await syncBlackboardAttachments(adapter, {
      courseId,
      destination,
      ...(values["content-id"] ? { contentId: opaqueToken(values["content-id"], "--content-id") } : {}),
      overwrite: values.overwrite === true,
    });
    writeSuccess({
      command: "bb sync",
      data: report,
      text: formatBlackboardSync(report),
      items: report.files,
      summary: {
        courseId: report.courseId,
        destination: report.destination,
        plannedFiles: report.plannedFiles,
        downloadedFiles: report.downloadedFiles,
        partial: report.partial,
        failures: report.failures.length,
      },
      ...(report.failures.length > 0 ? { meta: { failures: report.failures } } : {}),
    }, output);
    return;
  }
  if (command === "attempts" && positionals.length === 3) {
    const courseId = opaqueToken(required(positionals[2], "Blackboard course ID"), "Blackboard course ID");
    const selector = blackboardAssignmentSelector(values);
    const status = blackboardAttemptStatus(values.status);
    const adapter = await casServiceAdapter(values, "bb");
    const assignments = await listBlackboardAssignments(adapter, courseId);
    const assignment = resolveBlackboardAssignmentSelector(assignments, selector, courseId);
    const attempts = await listBlackboardAttempts(adapter, courseId, assignment.id, { ...(status ? { status } : {}) });
    writeSuccess({
      command: "bb attempts",
      data: { courseId, assignment, ...(status ? { status } : {}), attempts, total: attempts.length },
      text: formatBlackboardAttempts(assignment, attempts),
      items: attempts,
      summary: { courseId, contentId: assignment.contentId, columnId: assignment.id, ...(status ? { status } : {}), total: attempts.length },
    }, output);
    return;
  }
  if (command === "submit" && positionals[2] === "apply" && positionals.length === 3) {
    const target = blackboardSubmissionTarget(values);
    const filePath = required(values.file, "--file");
    if (!values.confirm) {
      throw new ConfirmationRequiredError(
        "Blackboard submission",
        "Blackboard submission uploads and submits an assignment attempt. Re-run the exact previewed command with --confirm.",
      );
    }
    const expectedSha256 = blackboardExpectedSha256(required(values["expected-sha256"], "--expected-sha256"));
    const payload = await readBlackboardSubmissionPayload(filePath);
    const file = payload.file;
    const comment = submissionComment(values.comment);
    if (file.sha256 !== expectedSha256) {
      throw new CliError(
        "The selected file no longer matches the reviewed preview hash. Re-run preview before submitting.",
        "BLACKBOARD_FILE_HASH_MISMATCH",
        2,
        {
          file: file.absolutePath,
          expectedSha256,
          actualSha256: file.sha256,
        },
      );
    }
    const adapter = await casServiceAdapter(values, "bb");
    const preflight = await buildBlackboardSubmissionPreflight(adapter, values, target, file, comment);
    ensureBlackboardSubmissionAllowed(preflight, values["allow-late"] === true);

    const assignment = preflight.assignment;
    let createdAttemptId = "";
    let uploadedId = "";
    let stage: "upload" | "create_attempt" | "attach_file" | "submit_attempt" | "verify" = "upload";
    try {
      stage = "upload";
      const uploaded = await uploadBlackboardTemporaryFile(adapter, file, payload.bytes);
      uploadedId = uploaded.id;
      stage = "create_attempt";
      const attempt = await createBlackboardAttempt(adapter, target.courseId, assignment.id, {
        ...(comment ? { studentComments: comment } : {}),
      });
      createdAttemptId = attempt.id;
      stage = "attach_file";
      await attachBlackboardAttemptFile(adapter, target.courseId, createdAttemptId, {
        name: file.name,
        uploadId: uploadedId,
      });
      stage = "submit_attempt";
      const submitted = await updateBlackboardAttempt(adapter, target.courseId, assignment.id, createdAttemptId, {
        status: "NeedsGrading",
      });
      stage = "verify";
      const snapshot = await observeBlackboardAttemptSnapshot(adapter, target.courseId, assignment.id, createdAttemptId);
      const observedAttempt = snapshot.attempt ?? submitted;
      const verification = snapshot.attempt
        ? verifyBlackboardSubmission(snapshot.attempt.status, snapshot.files, file.name)
        : {
            status: "unavailable" as const,
            message: "The submitted attempt status could not be read back from Blackboard.",
          };
      if (verification.status !== "confirmed") {
        throw new CliError(
          "Blackboard accepted the submission request, but the read-back verification was inconclusive.",
          "BLACKBOARD_SUBMISSION_NOT_CONFIRMED",
          1,
          {
            courseId: target.courseId,
            contentId: assignment.contentId,
            columnId: assignment.id,
            attemptId: createdAttemptId,
            verification,
            warning: "DO_NOT_RETRY_AUTOMATICALLY",
          },
        );
      }
      writeBlackboardSubmissionResult(output, preflight, file, comment, observedAttempt, snapshot.files, verification);
      return;
    } catch (error) {
      if (error instanceof CliError && error.code === "BLACKBOARD_FILE_CHANGED") throw error;
      let candidateAttemptIds: string[] = [];
      if (!createdAttemptId) {
        const drift = stage === "create_attempt"
          ? await observeBlackboardAttemptCreation(adapter, target.courseId, assignment.id, preflight.attempts)
          : undefined;
        candidateAttemptIds = drift?.candidateAttemptIds ?? [];
        if (drift?.attempt) createdAttemptId = drift.attempt.id;
      }
      const snapshot = createdAttemptId
        ? await observeBlackboardAttemptSnapshot(adapter, target.courseId, assignment.id, createdAttemptId)
        : { files: [] as BlackboardAttemptFile[] };
      const verification = verifyBlackboardSubmission(snapshot.attempt?.status ?? "", snapshot.files, file.name);
      if (snapshot.attempt && verification.status === "confirmed") {
        writeBlackboardSubmissionResult(
          output,
          preflight,
          file,
          comment,
          snapshot.attempt,
          snapshot.files,
          verification,
          true,
        );
        return;
      }
      throw new CliError(
        "Blackboard submission outcome is uncertain. Do not retry automatically.",
        "BLACKBOARD_SUBMISSION_OUTCOME_UNKNOWN",
        5,
        {
          stage,
          courseId: target.courseId,
          contentId: assignment.contentId,
          columnId: assignment.id,
          ...(createdAttemptId ? { attemptId: createdAttemptId } : {}),
          candidateAttemptIds,
          ...(uploadedId ? { uploadId: uploadedId } : {}),
          fileName: file.name,
          ...(snapshot.attempt?.status ? { attemptStatus: snapshot.attempt.status } : {}),
          observedFiles: snapshot.files.map((entry) => entry.name),
          verification,
          cause: error instanceof Error ? error.message : String(error),
          warning: "DO_NOT_RETRY_AUTOMATICALLY",
        },
      );
    }
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

async function runBooking(
  positionals: string[],
  values: Values,
  output: ReturnType<typeof resolveOutputOptions>,
): Promise<void> {
  const command = positionals[1];
  if (command === "whoami" && positionals.length === 2) {
    const session = await bookingService(values);
    await session.login();
    const profile = session.userProfile;
    if (!profile) throw new CliError("Booking login did not expose a user profile.", "SERVICE_PROTOCOL_ERROR", 1);
    writeSuccess({ command: "booking whoami", data: profile, text: formatBookingProfile(profile) }, output);
    return;
  }
  if (command === "rooms") {
    const page = parsePositiveInteger(values.page, 1, "--page");
    const pageSize = parsePositiveInteger(values["page-size"], 100, "--page-size");
    if (pageSize > 500) throw usageError("--page-size cannot exceed 500 for booking rooms.");
    const query = positionals.slice(2).join(" ").trim() || undefined;
    const session = await bookingService(values);
    let rooms = await listBookingRooms(session, { page, pageSize, keyword: query });
    if (values.available) rooms = rooms.filter((room) => room.available);
    writeSuccess({
      command: "booking rooms",
      data: { query, availableOnly: Boolean(values.available), page, pageSize, rooms, total: rooms.length },
      text: formatBookingRooms(rooms),
      items: rooms,
      summary: { query, availableOnly: Boolean(values.available), page, pageSize, total: rooms.length },
    }, output);
    return;
  }
  if (command === "my-meetings" && positionals.length === 2) {
    const page = parsePositiveInteger(values.page, 1, "--page");
    const pageSize = parsePositiveInteger(values["page-size"], 50, "--page-size");
    if (pageSize > 500) throw usageError("--page-size cannot exceed 500 for booking meetings.");
    const session = await bookingService(values);
    const meetings = await listMyBookingMeetings(session, { page, pageSize });
    writeSuccess({
      command: "booking my-meetings",
      data: { page, pageSize, meetings, total: meetings.length },
      text: formatBookingMeetings(meetings),
      items: meetings,
      summary: { page, pageSize, total: meetings.length },
    }, output);
    return;
  }
  throw usageError(`Unknown command: ${positionals.join(" ")}`);
}

async function runLibraryBooking(
  positionals: string[],
  values: Values,
  output: ReturnType<typeof resolveOutputOptions>,
): Promise<void> {
  const command = positionals[1];
  if (command === "whoami" && positionals.length === 2) {
    const session = await libraryBookingService(values);
    const user = await getLibraryBookingUser(session);
    writeSuccess({ command: "lib-booking whoami", data: user, text: formatLibraryBookingUser(user) }, output);
    return;
  }
  if (command === "home-summary" && positionals.length === 2) {
    const session = await libraryBookingService(values);
    const categories = await getLibraryIdleSummary(session);
    writeSuccess({
      command: "lib-booking home-summary",
      data: { categories, total: categories.length },
      text: formatLibraryIdleSummary(categories),
      items: categories,
      summary: { total: categories.length },
    }, output);
    return;
  }
  if (command === "labs" && positionals.length === 2) {
    const classKind = parsePositiveInteger(values["class-kind"], 1, "--class-kind");
    const session = await libraryBookingService(values);
    const labs = await listLibraryLabs(session, classKind);
    writeSuccess({
      command: "lib-booking labs",
      data: { classKind, labs, total: labs.length },
      text: formatLibraryLabs(labs),
      items: labs,
      summary: { classKind, total: labs.length },
    }, output);
    return;
  }
  if (command === "rooms" && positionals.length === 2) {
    const kindId = parsePositiveInteger(required(values["kind-id"], "--kind-id"), 1, "--kind-id");
    const labId = parsePositiveInteger(required(values["lab-id"], "--lab-id"), 1, "--lab-id");
    const classKind = parsePositiveInteger(values["class-kind"], 1, "--class-kind");
    const session = await libraryBookingService(values);
    const groups = await listLibraryRooms(session, { kindId, labId, classKind });
    const total = groups.reduce((sum, group) => sum + group.labs.reduce((labSum, lab) => labSum + lab.rooms.length, 0), 0);
    writeSuccess({
      command: "lib-booking rooms",
      data: { kindId, labId, classKind, groups, total },
      text: formatLibraryRooms(groups),
      items: groups,
      summary: { kindId, labId, classKind, groups: groups.length, total },
    }, output);
    return;
  }
  if (command === "reservation-count" && positionals.length === 2) {
    const session = await libraryBookingService(values);
    const count = await getLibraryReservationCount(session);
    writeSuccess({ command: "lib-booking reservation-count", data: { count }, text: `Library reservation count\n${count}` }, output);
    return;
  }
  if (command === "reservations" && positionals.length === 2) {
    const start = isoDate(values.start ?? todayInShenzhen(), "--start");
    const end = isoDate(values.end ?? addIsoDays(start, 30), "--end");
    if (end < start) throw usageError("--end must be on or after --start.");
    const page = parsePositiveInteger(values.page, 1, "--page");
    const pageSize = parsePositiveInteger(values["page-size"], 20, "--page-size");
    if (pageSize > 100) throw usageError("--page-size cannot exceed 100 for library reservations.");
    const needStatus = values["need-status"] === undefined
      ? undefined
      : parseNonNegativeInteger(values["need-status"], 0, "--need-status");
    const session = await libraryBookingService(values);
    const result = await listLibraryReservationsPage(session, { start, end, page, pageSize, needStatus });
    const reservations = result.reservations;
    writeSuccess({
      command: "lib-booking reservations",
      data: { start, end, page, pageSize, needStatus, reservations, total: result.total, shown: reservations.length },
      text: formatLibraryReservations(reservations),
      items: reservations,
      summary: { start, end, page, pageSize, needStatus, total: result.total, shown: reservations.length },
    }, output);
    return;
  }
  throw usageError(`Unknown command: ${positionals.join(" ")}`);
}

async function runPms(
  positionals: string[],
  values: Values,
  output: ReturnType<typeof resolveOutputOptions>,
): Promise<void> {
  const command = positionals[1];
  if (command === "check" && positionals.length === 2) {
    const session = await pmsService(values);
    await session.login();
    const result = await session.check();
    if (!result.authenticated) throw new CliError("PMS session check failed.", "AUTHENTICATION_FAILED", 2, { service: "pms" });
    writeSuccess({ command: "pms check", data: result, text: `PMS authentication\n${result.message}` }, output);
    return;
  }
  if (command === "server-groups" && positionals.length === 2) {
    const session = await pmsService(values);
    const groups = await listPmsServerGroups(session);
    writeSuccess({
      command: "pms server-groups",
      data: { groups, total: groups.length },
      text: formatPmsServerGroups(groups),
      items: groups,
      summary: { total: groups.length },
    }, output);
    return;
  }
  if (command === "stations" && positionals.length === 2) {
    const serverGroup = values["server-group"] === undefined
      ? undefined
      : parsePositiveInteger(values["server-group"], 1, "--server-group");
    const session = await pmsService(values);
    const stations = await listPmsStations(session, serverGroup);
    writeSuccess({
      command: "pms stations",
      data: { serverGroup, stations, total: stations.length },
      text: formatPmsStations(stations),
      items: stations,
      summary: { serverGroup, total: stations.length },
    }, output);
    return;
  }
  if (command === "jobs" && positionals.length === 2) {
    const session = await pmsService(values);
    const jobs = await listPmsPrintJobs(session);
    writeSuccess({
      command: "pms jobs",
      data: { jobs, total: jobs.length },
      text: formatPmsPrintJobs(jobs),
      items: jobs,
      summary: { total: jobs.length },
    }, output);
    return;
  }
  if (command === "scan-jobs" && positionals.length === 2) {
    const session = await pmsService(values);
    const jobs = await listPmsScanJobs(session);
    writeSuccess({
      command: "pms scan-jobs",
      data: { jobs, total: jobs.length },
      text: formatPmsScanJobs(jobs),
      items: jobs,
      summary: { total: jobs.length },
    }, output);
    return;
  }
  if (command === "usage" && positionals.length === 2) {
    const begin = isoDate(required(values.begin, "--begin"), "--begin");
    const end = isoDate(required(values.end, "--end"), "--end");
    if (end < begin) throw usageError("--end must be on or after --begin.");
    const type = parsePositiveInteger(values.type, 1, "--type");
    const page = parsePositiveInteger(values.page, 1, "--page");
    const pageSize = parsePositiveInteger(values["page-size"], 20, "--page-size");
    if (pageSize > 100) throw usageError("--page-size cannot exceed 100 for PMS usage.");
    const session = await pmsService(values);
    const result = await listPmsUsageHistory(session, { begin, end, type, page, pageSize });
    writeSuccess({
      command: "pms usage",
      data: { begin, end, type, page, pageSize, ...result, total: result.records.length },
      text: formatPmsUsage(result.records),
      items: result.records,
      summary: { begin, end, type, page, pageSize, totalPages: result.totalPages, total: result.records.length },
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

type BlackboardSubmissionTarget = {
  courseId: string;
  contentId?: string;
  columnId?: string;
};

type BlackboardSubmissionVerification = {
  status: "confirmed" | "not_observed" | "unavailable";
  message: string;
};

type BlackboardSubmissionPreviewData = {
  checkedAt: string;
  target: BlackboardSubmissionTarget;
  assignment: Awaited<ReturnType<typeof listBlackboardAssignments>>[number];
  content: Awaited<ReturnType<typeof getBlackboardContentItem>>;
  attempts: Array<{
    id: string;
    status: BlackboardAttempt["status"];
    created: string;
    attemptDate: string;
    submissionDate?: string;
  }>;
  attemptsUsed: number;
  remainingAttempts?: number;
  inProgressAttempts: number;
  file: Awaited<ReturnType<typeof inspectBlackboardSubmissionFile>>;
  commentSummary: { present: boolean; length: number };
  uploadSettings?: Awaited<ReturnType<typeof getBlackboardUploadSettings>>;
  blockers: BlackboardSubmissionAssessment["blockers"];
  warnings: BlackboardSubmissionAssessment["warnings"];
  late: boolean;
  applyAllowed: boolean;
  confirmation: {
    required: true;
    available: boolean;
    expectedSha256: string;
    argv?: string[];
    command?: string;
  };
};

function blackboardAssignmentSelector(values: Values): { contentId?: string; columnId?: string } {
  const contentId = values["content-id"] ? opaqueToken(values["content-id"], "--content-id") : undefined;
  const columnId = values["column-id"] ? opaqueToken(values["column-id"], "--column-id") : undefined;
  if (!contentId && !columnId) {
    throw usageError("One of --content-id or --column-id is required.");
  }
  return { ...(contentId ? { contentId } : {}), ...(columnId ? { columnId } : {}) };
}

function blackboardSubmissionTarget(values: Values): BlackboardSubmissionTarget {
  return {
    courseId: opaqueToken(required(values["course-id"], "--course-id"), "--course-id"),
    ...blackboardAssignmentSelector(values),
  };
}

function resolveBlackboardAssignmentSelector(
  assignments: Awaited<ReturnType<typeof listBlackboardAssignments>>,
  selector: { contentId?: string; columnId?: string },
  courseId: string,
) {
  const assignment = selectBlackboardAssignment(assignments, selector);
  if (assignment) return assignment;

  const contentMatch = selector.contentId
    ? selectBlackboardAssignment(assignments, { contentId: selector.contentId })
    : undefined;
  const columnMatch = selector.columnId
    ? selectBlackboardAssignment(assignments, { columnId: selector.columnId })
    : undefined;
  if (contentMatch && columnMatch && contentMatch.id !== columnMatch.id) {
    throw new CliError(
      "The provided --content-id and --column-id do not refer to the same Blackboard assignment.",
      "BLACKBOARD_ASSIGNMENT_MISMATCH",
      1,
      { courseId, contentId: selector.contentId, columnId: selector.columnId },
    );
  }
  throw new CliError(
    "The provided Blackboard assignment selector did not match any assignment in this course.",
    "BLACKBOARD_ASSIGNMENT_NOT_FOUND",
    1,
    { courseId, contentId: selector.contentId, columnId: selector.columnId },
  );
}

function blackboardAttemptStatus(value: string | undefined):
  | "InProgress"
  | "NeedsGrading"
  | "Completed"
  | undefined {
  if (value === undefined) return undefined;
  if (value === "InProgress" || value === "NeedsGrading" || value === "Completed") return value;
  throw usageError("--status must be InProgress, NeedsGrading, or Completed for Blackboard attempts.");
}

function submissionComment(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function summariseSubmissionComment(comment: string | undefined): { present: boolean; length: number } {
  return { present: Boolean(comment), length: comment?.length ?? 0 };
}

function blackboardExpectedSha256(value: string): string {
  const normalised = value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalised)) {
    throw usageError("--expected-sha256 must be a 64-character lowercase or uppercase hexadecimal digest.");
  }
  return normalised;
}

async function buildBlackboardSubmissionPreflight(
  adapter: ServiceAdapter,
  values: Values,
  target: BlackboardSubmissionTarget,
  file: Awaited<ReturnType<typeof inspectBlackboardSubmissionFile>>,
  comment: string | undefined,
): Promise<BlackboardSubmissionPreviewData> {
  const assignments = await listBlackboardAssignments(adapter, target.courseId);
  const assignment = resolveBlackboardAssignmentSelector(assignments, target, target.courseId);
  const content = await getBlackboardContentItem(adapter, target.courseId, assignment.contentId);
  const attempts = await listBlackboardAttempts(adapter, target.courseId, assignment.id);
  let uploadSettings: Awaited<ReturnType<typeof getBlackboardUploadSettings>> | undefined;
  try {
    uploadSettings = await getBlackboardUploadSettings(adapter);
  } catch (error) {
    if (!isOptionalBlackboardUploadSettingsError(error)) throw error;
    uploadSettings = undefined;
  }

  const assessed: BlackboardSubmissionAssessment = evaluateBlackboardSubmissionPreflight({
    assignment,
    content,
    attempts,
    file,
    ...(uploadSettings ? { uploadSettings } : {}),
  });
  const attemptsAllowed = assessed.attemptsAllowed;
  const attemptsUsed = assessed.attemptsUsed;
  const remainingAttempts = attemptsAllowed !== undefined && attemptsAllowed > 0
    ? Math.max(attemptsAllowed - attemptsUsed, 0)
    : undefined;
  const warnings = [...assessed.warnings];
  if (attempts.some((attempt) => attempt.status === "NeedsGrading" || attempt.status === "Completed")) {
    warnings.push({
      code: "PREVIOUS_SUBMISSION_EXISTS",
      message: "Previous submitted attempts already exist; verify Blackboard's submission history before consuming another attempt.",
    });
  }

  const resolvedTarget = {
    courseId: target.courseId,
    contentId: assignment.contentId,
    columnId: assignment.id,
  };
  const handoff = assessed.ready
      ? buildBlackboardSubmitApplyConfirmation(resolvedTarget, file.absolutePath, file.sha256, {
        credentialsFile: values["credentials-file"],
        profile: values.profile,
        comment,
        allowLate: assessed.late,
      })
    : undefined;
  return {
    checkedAt: assessed.checkedAt,
    target: resolvedTarget,
    assignment,
    content,
    attempts: attempts.map((attempt) => ({
      id: attempt.id,
      status: attempt.status,
      created: attempt.created,
      attemptDate: attempt.attemptDate,
      ...(attempt.attemptReceipt?.submissionDate ? { submissionDate: attempt.attemptReceipt.submissionDate } : {}),
    })),
    attemptsUsed,
    ...(remainingAttempts !== undefined ? { remainingAttempts } : {}),
    inProgressAttempts: assessed.inProgressAttemptIds.length,
    file,
    commentSummary: summariseSubmissionComment(comment),
    ...(uploadSettings ? { uploadSettings } : {}),
    blockers: assessed.blockers,
    warnings,
    late: assessed.late,
    applyAllowed: assessed.ready,
    confirmation: {
      required: true,
      available: Boolean(handoff),
      expectedSha256: file.sha256,
      ...(handoff ? { argv: handoff.argv, command: handoff.command } : {}),
    },
  };
}

function ensureBlackboardSubmissionAllowed(
  preflight: BlackboardSubmissionPreviewData,
  allowLate: boolean,
): void {
  if (preflight.blockers.length > 0) {
    throw new CliError(
      "Blackboard submission is blocked by the current live assignment state.",
      "BLACKBOARD_SUBMISSION_BLOCKED",
      4,
      {
        courseId: preflight.target.courseId,
        contentId: preflight.assignment.contentId,
        columnId: preflight.assignment.id,
        blockers: preflight.blockers,
        warning: "NO_MUTATION_PERFORMED",
      },
    );
  }
  if (preflight.late && !allowLate) {
    throw new CliError(
      "Blackboard shows this assignment as past due. Re-run with --allow-late only if you intend to submit late.",
      "BLACKBOARD_LATE_SUBMISSION_REQUIRES_ALLOW_LATE",
      3,
      {
        courseId: preflight.target.courseId,
        contentId: preflight.assignment.contentId,
        columnId: preflight.assignment.id,
        due: preflight.assignment.grading.due,
        warning: "NO_MUTATION_PERFORMED",
      },
    );
  }
}

function isOptionalBlackboardUploadSettingsError(error: unknown): boolean {
  if (!(error instanceof CliError)) return false;
  const status = Number(error.details?.status);
  return status === 401 || status === 403 || status === 404;
}

async function observeBlackboardAttemptSnapshot(
  adapter: ServiceAdapter,
  courseId: string,
  columnId: string,
  attemptId: string,
): Promise<{
  attempt?: Awaited<ReturnType<typeof getBlackboardAttempt>>;
  files: Awaited<ReturnType<typeof listBlackboardAttemptFiles>>;
}> {
  let attempt: Awaited<ReturnType<typeof getBlackboardAttempt>> | undefined;
  let files: Awaited<ReturnType<typeof listBlackboardAttemptFiles>> = [];
  try {
    attempt = await getBlackboardAttempt(adapter, courseId, columnId, attemptId);
  } catch {
    attempt = undefined;
  }
  try {
    files = await listBlackboardAttemptFiles(adapter, courseId, attemptId);
  } catch {
    files = [];
  }
  return { attempt, files };
}

async function observeBlackboardAttemptCreation(
  adapter: ServiceAdapter,
  courseId: string,
  columnId: string,
  previousAttempts: readonly { id: string }[],
): Promise<{
  attempt?: Awaited<ReturnType<typeof listBlackboardAttempts>>[number];
  candidateAttemptIds: string[];
}> {
  try {
    const current = await listBlackboardAttempts(adapter, courseId, columnId);
    const previousIds = new Set(previousAttempts.map((attempt) => attempt.id));
    const candidates = current.filter((attempt) => !previousIds.has(attempt.id));
    return {
      ...(candidates.length === 1 ? { attempt: candidates[0] } : {}),
      candidateAttemptIds: candidates.map((attempt) => attempt.id),
    };
  } catch {
    return { candidateAttemptIds: [] };
  }
}

function verifyBlackboardSubmission(
  status: string,
  files: Awaited<ReturnType<typeof listBlackboardAttemptFiles>>,
  expectedFileName: string,
): BlackboardSubmissionVerification {
  const observedFile = files.some((entry) => entry.name === expectedFileName);
  if ((status === "NeedsGrading" || status === "Completed") && observedFile) {
    return { status: "confirmed", message: "NeedsGrading/Completed and the uploaded filename were read back from Blackboard." };
  }
  if (status) {
    return {
      status: "not_observed",
      message: `Attempt status was ${status}, but the expected uploaded filename was not fully observed in the read-back state.`,
    };
  }
  return { status: "unavailable", message: "Blackboard did not expose enough read-back state to confirm the submission." };
}

function writeBlackboardSubmissionResult(
  output: ReturnType<typeof resolveOutputOptions>,
  preflight: BlackboardSubmissionPreviewData,
  file: BlackboardSubmissionFile,
  comment: string | undefined,
  attempt: BlackboardAttempt,
  files: readonly BlackboardAttemptFile[],
  verification: BlackboardSubmissionVerification,
  recoveredAfterError = false,
): void {
  writeSuccess({
    command: "bb submit apply",
    data: {
      mode: "apply",
      mutation: true,
      target: preflight.target,
      assignment: preflight.assignment,
      file,
      commentSummary: summariseSubmissionComment(comment),
      preflight: {
        checkedAt: preflight.checkedAt,
        attemptsUsed: preflight.attemptsUsed,
        ...(preflight.remainingAttempts !== undefined ? { remainingAttempts: preflight.remainingAttempts } : {}),
        late: preflight.late,
        ...(preflight.assignment.grading.due ? { due: preflight.assignment.grading.due } : {}),
      },
      attempt,
      files,
      verification,
      ...(preflight.uploadSettings ? { uploadSettings: preflight.uploadSettings } : {}),
    },
    text: formatBlackboardSubmissionSuccess({
      assignment: preflight.assignment,
      attempt,
      files,
      verification,
    }),
    ...(recoveredAfterError ? { meta: { recoveredAfterError: true } } : {}),
  }, output);
}

function buildBlackboardSubmitApplyConfirmation(
  target: BlackboardSubmissionTarget,
  absolutePath: string,
  expectedSha256: string,
  options: {
    credentialsFile?: string;
    profile?: string;
    comment?: string;
    allowLate?: boolean;
  } = {},
): { required: true; argv: string[]; command: string } {
  const argv = [
    "sustech",
    "bb",
    "submit",
    "apply",
    ...(options.credentialsFile ? ["--credentials-file", options.credentialsFile] : []),
    ...(options.profile ? ["--profile", options.profile] : []),
    "--course-id",
    target.courseId,
    ...(target.contentId ? ["--content-id", target.contentId] : []),
    ...(target.columnId ? ["--column-id", target.columnId] : []),
    "--file",
    absolutePath,
    "--expected-sha256",
    expectedSha256,
    ...(options.comment ? ["--comment", options.comment] : []),
    ...(options.allowLate ? ["--allow-late"] : []),
    "--confirm",
  ];
  return { required: true, argv, command: argv.map(shellQuote).join(" ") };
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9._/:=-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function validateCommandOptions(command: string, argv: readonly string[]): void {
  if (!CAPABILITIES.some((entry) => entry.command === command)) return;
  const allowed = new Set(COMMAND_OPTIONS[command] ?? []);
  if (allowed.has("credentials-file")) allowed.add("profile");
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

function doiValue(value: string): string {
  const doi = value.trim();
  if (doi.length > 512 || !/^10\.\d{4,9}\/\S+$/.test(doi) || /[\u0000-\u001f\u007f]/.test(doi)) {
    throw usageError("A DOI must look like 10.1234/example and contain no whitespace or control characters.");
  }
  return doi;
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

function blackboardContentKind(value: string): "file" | "folder" | "assignment" | "document" | "unknown" {
  if (value === "file" || value === "folder" || value === "assignment" || value === "document" || value === "unknown") {
    return value;
  }
  throw usageError("--kind must be file, folder, assignment, document, or unknown.");
}

function blackboardSearchAttachmentMode(value: string | undefined): "include" | "only" | "none" {
  if (value === undefined || value === "none") return "none";
  if (value === "include") return value;
  if (value === "only" || value === "none") return value;
  throw usageError("--attachments must be include, only, or none.");
}

function authServiceValue(value: string | undefined, fallback: AuthService = "tis"): AuthService {
  if (value === undefined) return fallback;
  if (value === "tis") return "tis";
  if (value === "library-booking") return "lib-booking";
  if (value === "bb" || value === "ws" || value === "booking" || value === "lib-booking" || value === "pms") {
    return value;
  }
  throw usageError("--service must be tis, bb, ws, booking, lib-booking (or library-booking), or pms.");
}

function doctorServices(value: string | undefined): DoctorService[] {
  const available = DOCTOR_SERVICES.map((entry) => entry.service);
  if (value === undefined || value.trim() === "" || value.trim() === "all") return [...available];
  const services: DoctorService[] = [];
  for (const raw of value.split(",")) {
    const normalized = raw.trim() === "library-booking" ? "lib-booking" : raw.trim();
    if (!available.includes(normalized as DoctorService)) {
      throw usageError("--service for doctor must be all or a comma-separated subset of tis, bb, ws, booking, lib-booking, and pms.");
    }
    if (!services.includes(normalized as DoctorService)) services.push(normalized as DoctorService);
  }
  if (services.length === 0) throw usageError("--service for doctor cannot be empty.");
  return services;
}

function doctorFailure(error: unknown): { code: string; message: string } {
  const code = error instanceof CliError ? error.code : "UNEXPECTED_ERROR";
  const raw = error instanceof Error ? error.message : String(error ?? "unknown diagnostic failure");
  const message = raw
    .replace(/(password|authorization|cookie|token)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
  return { code, message: message || "diagnostic probe failed" };
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

function parseBidPicks(values: readonly string[]): BidPick[] {
  if (values.length === 0) throw usageError("At least one --pick COURSE_ID:BID or RWH:COURSE_ID:BID is required.");
  const picks = new Map<string, BidPick>();
  for (const value of values) {
    const parts = value.split(":");
    if (parts.length !== 2 && parts.length !== 3) throw usageError(`Invalid --pick value: ${value}`);
    if (parts.length === 2) {
      const courseId = opaqueToken(parts[0], "--pick course ID");
      const bid = parsePositiveInteger(parts[1], 1, "--pick bid");
      picks.set(courseId, { courseId, bid });
      continue;
    }
    const rwh = opaqueToken(parts[0], "--pick rwh");
    const courseId = opaqueToken(parts[1], "--pick course ID");
    const bid = parsePositiveInteger(parts[2], 1, "--pick bid");
    picks.set(`${rwh}#${courseId}`, { rwh, courseId, bid });
  }
  return [...picks.values()];
}

function selectionApplyTarget(values: Values, operation: SelectionOperation): SelectionApplyTarget {
  return {
    operation,
    courseId: opaqueToken(required(values["course-id"], "--course-id"), "--course-id"),
    rwh: opaqueToken(required(values.rwh, "--rwh"), "--rwh"),
    round: opaqueToken(values.round ?? defaultSelectionRound(operation), "--round"),
    bid: values.bid === undefined ? defaultSelectionBid(operation) : parsePositiveInteger(values.bid, 1, "--bid"),
    where: selectionWhere(values.where),
  };
}

function defaultSelectionRound(operation: SelectionOperation): string {
  return operation === "cart.add" ? "bxxk" : "yixuan";
}

function defaultSelectionBid(operation: SelectionOperation): number {
  return operation === "drop" || operation === "cart.remove" ? 1 : 1;
}

function buildEnrollApplyCommand(target: {
  semester: ReturnType<typeof parseSemester>;
  courseId: string;
  rwh: string;
  round: string;
  bid: number;
}): string {
  return [
    "sustech",
    "tis",
    "enroll",
    "apply",
    "--course-id",
    target.courseId,
    "--rwh",
    target.rwh,
    ...(target.semester ? ["--semester", target.semester.value] : []),
    "--round",
    target.round,
    "--bid",
    String(target.bid),
    "--confirm",
  ].map(shellQuote).join(" ");
}

function buildSelectionApplyCommand(target: SelectionApplyTarget & { cultivation: "1" | "2"; semester: ReturnType<typeof parseSemester> }): string {
  return [
    "sustech",
    "tis",
    "selection",
    "apply",
    target.operation,
    "--course-id",
    target.courseId,
    "--rwh",
    target.rwh,
    "--semester",
    target.semester.value,
    "--round",
    target.round,
    "--bid",
    String(target.bid),
    "--where",
    target.where,
    "--cultivation",
    target.cultivation,
    "--confirm",
  ].map(shellQuote).join(" ");
}

function buildBidApplyCommand(input: {
  picks: readonly BidPick[];
  where: SelectionBidWhere;
  round: string;
  cultivation: "1" | "2";
  semester: ReturnType<typeof parseSemester>;
}): string {
  return [
    "sustech",
    "tis",
    "bid",
    "apply",
    ...input.picks.flatMap((pick) => ["--pick", `${pick.rwh}:${pick.courseId}:${pick.bid}`]),
    "--semester",
    input.semester.value,
    "--where",
    input.where,
    "--round",
    input.round,
    "--cultivation",
    input.cultivation,
    "--confirm",
  ].map(shellQuote).join(" ");
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

function addIsoDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function todayInShenzhen(): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function timeInShenzhen(): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

function weekdayInShenzhen(): number {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    weekday: "short",
  }).format(new Date());
  if (weekday === "Mon") return 1;
  if (weekday === "Tue") return 2;
  if (weekday === "Wed") return 3;
  if (weekday === "Thu") return 4;
  if (weekday === "Fri") return 5;
  if (weekday === "Sat") return 6;
  return 7;
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
