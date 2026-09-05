#!/usr/bin/env node
import { resolve as resolvePath } from "node:path";
import { parseArgs } from "node:util";
import {
  comparableAcademicSnapshotSourceCount,
  diffAcademicSnapshotChanges,
  evaluateAcademicSnapshotWatch,
  formatAcademicSnapshotChanges,
  formatAcademicSnapshotWatch,
} from "./academic/changes.js";
import {
  academicSnapshotError,
  academicSnapshotSource,
  buildAcademicSnapshot,
  diffAcademicSnapshots,
  formatAcademicSnapshot,
  formatAcademicSnapshotDiff,
  loadAcademicSnapshot,
  saveAcademicSnapshot,
  type AcademicSnapshotFailure,
  type AcademicSnapshotSource,
} from "./academic/snapshot.js";
import {
  buildBookingCancelApplyConfirmation,
  buildBookingCreateApplyConfirmation,
  buildLibraryBookingCancelApplyConfirmation,
  buildLibraryBookingCreateApplyConfirmation,
  shellQuote,
} from "./cli-confirmations.js";
import { inferCommandName } from "./core/argv.js";
import { formatBrandArt, shouldUseBrandColor } from "./core/branding.js";
import { CAPABILITIES, formatCapabilities } from "./core/capabilities.js";
import { CLI_PARSE_OPTIONS, COMMAND_OPTIONS, SHARED_OUTPUT_OPTION_NAMES, type CliOptionName } from "./core/command-metadata.js";
import { CONSEQUENCES, consequenceByOperation, formatConsequences } from "./core/consequences.js";
import { resolveCredentials, type Credentials } from "./core/credentials.js";
import { formatDashboard } from "./core/dashboard.js";
import { CliError, ConfirmationRequiredError } from "./core/errors.js";
import { assertPathAndParentsAreNotSymlinks } from "./core/local-store.js";
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
import {
  promptHiddenPassword,
  promptLoginSid,
  readCalendarLinkFromStdin,
  readPasswordFromStdin,
} from "./core/prompt.js";
import { parseSemester, type Semester } from "./core/semester.js";
import { CLI_VERSION } from "./core/version.js";
import { AcademicCalendar, CalendarClient } from "./calendar/client.js";
import { formatCalendarDay, formatCalendarTerms } from "./calendar/text.js";
import type { CalendarLevel } from "./calendar/types.js";
import {
  fetchContextAirQuality,
  fetchContextLibraryStatus,
  fetchContextWeather,
} from "./context/live.js";
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
import {
  formatOnlineContact,
  formatOnlineContactSearch,
  formatOnlineSearchHits,
  formatOnlineTalk,
  formatOnlineTalkSearch,
  formatOnlineTalks,
  getOnlineContact,
  getOnlineTalk,
  listOnlineTalks,
  searchOnline,
  searchOnlineContacts,
  searchOnlineTalks,
} from "./online/index.js";
import { searchResources, type ResourceCategory } from "./resources/catalog.js";
import { formatResources } from "./resources/text.js";
import {
  formatAuthCheck,
  formatAvailableCourses,
  formatCourseSearch,
  formatStudentProfile,
  formatEnrolledCourses,
  formatEnrollPreview,
  formatEnrollSuccess,
  formatExams,
  formatDegreeAudit,
  formatDegreeMissing,
  formatDegreeProgress,
  formatGrades,
  formatScheduleEntries,
  formatTisPlan,
  formatTimetables,
  formatVersion,
} from "./core/text.js";
import { collectStudentProfile, hasExportableProfileData, saveStudentProfile } from "./profile/report.js";
import { auditDegreeRequirements, loadDegreeRequirements } from "./tis/degree-audit.js";
import { gradesBySemester, summariseGrades } from "./tis/academics.js";
import { TisSession } from "./tis/auth.js";
import { TisClient, type TisSelectionState } from "./tis/client.js";
import {
  buildCourseDecisionNcesLookupRequests,
  recommendCourseSections,
  selectCourseDecisionCandidates,
} from "./tis/course-decision.js";
import { formatCourseRecommendationReport } from "./tis/course-decision-text.js";
import { deriveTisDegreeMissing } from "./tis/degree-missing.js";
import { parseBlockedTime, solveTimetables } from "./tis/planner.js";
import { addPlanEntries, createPlanDocument, loadPlan, removePlanEntries, savePlan } from "./tis/plan.js";
import {
  fetchLiveRoomCatalog,
  fetchLiveRoomSchedule,
  classroomLiveEntryOutput,
  classroomLiveRoomOutput,
  buildClassroomDirectory,
  buildIcsContent,
  buildSelectionPreview,
  ensureSelectionVerified,
  inferWeekOneMonday,
  holidayToIcsEvent,
  nearestUpcomingExam,
  parseIsoDateTimeToUtcStamp,
  parseShenzhenExamTimeRange,
  planBidUpdates,
  projectBidTotal,
  revalidateSelectionWrite,
  resolveLiveRoom,
  scheduleIcsEvents,
  summariseEvaluationStatuses,
  summariseCurrentOrNextClass,
  summariseLiveOccupancy,
  teachingPeriodAtShenzhenTime,
  verifySelectionWrite,
  writeIcsFile,
  type IcsAnchor,
  type IcsEvent,
  type BidPick,
  type EvaluationCourseStatus,
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
  buildBookingCreatePreview,
  buildBookingCancelPreview,
  applyBookingCreate,
  applyBookingCancel,
  buildLibraryBookingCreatePreview,
  buildLibraryBookingCancelPreview,
  applyLibraryBookingCreate,
  applyLibraryBookingCancel,
  createBlackboardAttempt,
  downloadOpenAccessPdf,
  downloadBlackboardContentAttachment,
  evaluateBlackboardSubmissionPreflight,
  formatBrowserPrimoCatalogDetail,
  formatBrowserPrimoCatalogSearch,
  formatServiceStatuses,
  getBlackboardAttempt,
  getBlackboardContentItem,
  getBlackboardUser,
  getBlackboardUploadSettings,
  getLibraryBookingUser,
  getLibraryCatalogDetail,
  getPrimoCatalogDetailByBrowser,
  getLibraryIdleSummary,
  getLibraryReservationCount,
  getNcesCourseDetail,
  getWsProgramDetail,
  getWsToken,
  listBlackboardAssignments,
  listBlackboardCalendarItems,
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
  createPrimoPublicAdapter,
  buildPmsPrintDeletePreview,
  buildPmsPrintUploadPreview,
  findPmsPrintJob,
  inspectPmsUploadFile,
  listPmsPrintJobs,
  listPmsScanJobs,
  listPmsServerGroups,
  listPmsStations,
  listPmsUsageHistory,
  listWsPrograms,
  inspectBlackboardSubmissionFile,
  pmsDuplexLabel,
  pmsPaperName,
  readBlackboardSubmissionPayload,
  readPmsUploadPayload,
  resolveNcesCourseLookups,
  searchLibraryCatalog,
  searchPrimoCatalogByBrowser,
  selectBlackboardAssignment,
  searchCrossref,
  searchNces,
  serviceStatus,
  syncBlackboardAttachments,
  updateBlackboardAttempt,
  uploadBlackboardTemporaryFile,
  verifyPmsPrintDeletion,
  verifyPmsPrintUpload,
  deleteBlackboardCalendarLink,
  fetchBlackboardCalendarFeed,
  fetchStoredBlackboardCalendarFeed,
  loadBlackboardCalendarLink,
  saveBlackboardCalendarLink,
  type BlackboardAttempt,
  type BlackboardAttemptFile,
  type BlackboardCalendarItemType,
  type BlackboardDeadline,
  type BlackboardSubmissionFile,
  type BlackboardSubmissionPreflight as BlackboardSubmissionAssessment,
  type PmsPrintUploadOptions,
  type ServiceAdapter,
} from "./services/index.js";
import {
  formatBookingMeetings,
  formatBookingCreatePreview,
  formatBookingCreateSuccess,
  formatBookingCancelPreview,
  formatBookingCancelSuccess,
  formatBookingProfile,
  formatBookingRooms,
  formatBlackboardAssignments,
  formatBlackboardCalendar,
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
  formatLibraryBookingCreatePreview,
  formatLibraryBookingCreateSuccess,
  formatLibraryBookingCancelPreview,
  formatLibraryBookingCancelSuccess,
  formatLibraryCatalogDetail,
  formatLibraryCatalogSearch,
  formatLibraryIdleSummary,
  formatLibraryLabs,
  formatLibraryReservations,
  formatLibraryRooms,
  formatPmsDeletePreview,
  formatPmsDeleteSuccess,
  formatPmsPrintJobs,
  formatPmsScanJobs,
  formatPmsServerGroups,
  formatPmsStations,
  formatPmsUploadPreview,
  formatPmsUploadSuccess,
  formatPmsUsage,
  formatWsDetail,
  formatWsPrograms,
} from "./services/text.js";
import type { ExamRecord, PersonalScheduleEntry } from "./tis/types.js";

const VERSION = CLI_VERSION;

const HELP = `sustech — SUSTech services for humans and agents

Usage:
  sustech version [--json|--jsonl]
  sustech capabilities [--json|--jsonl]
  sustech describe COMMAND... [--json|--jsonl]
  sustech consequences [OPERATION] [--json|--jsonl]
  sustech doctor [--profile NAME] [--credentials-file PATH] [--service all|tis,bb,ws,booking,lib-booking,pms] [--live]
  sustech auth login [--profile NAME] [--sid SID] [--service bb|tis|ws|booking|lib-booking|pms] [--password-stdin]
  sustech auth status [--profile NAME]
  sustech auth logout [--profile NAME]
  sustech auth check [--profile NAME] [--service tis|bb|ws|booking|lib-booking|library-booking|pms] [--credentials-file PATH] [--json|--jsonl]
  sustech calendar terms [--year YYYY] [--calendar-level undergraduate|graduate]
  sustech calendar day [YYYY-MM-DD|--date YYYY-MM-DD] [--calendar-level undergraduate|graduate]
  sustech academic snapshot save --destination PATH [--semester YYYY-YYYY-N] [--include-blackboard] [--overwrite]
  sustech academic snapshot diff BEFORE AFTER
  sustech academic changes BEFORE AFTER
  sustech academic watch --state PATH [--semester YYYY-YYYY-N] [--include-blackboard] [--overwrite]
  sustech faculty departments
  sustech faculty list DEPARTMENT [--full] [--limit N]
  sustech faculty get SLUG
  sustech faculty search QUERY [--department DEPARTMENT] [--limit N]
  sustech faculty render SLUG
  sustech online search QUERY [--section talks|contact] [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--limit N]
  sustech online talks list [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--limit N]
  sustech online talks search QUERY [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--limit N]
  sustech online talks get ID
  sustech online contact search QUERY [--limit N]
  sustech online contact get ID
  sustech context [--date YYYY-MM-DD] [--calendar-level undergraduate|graduate] [--level terse|normal|verbose] [--live] [--credentials-file PATH]
  sustech profile show [--profile NAME] [--credentials-file PATH]
  sustech profile export --destination PATH [--overwrite] [--profile NAME] [--credentials-file PATH]
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
  sustech bb calendar [--since ISO-DATETIME] [--until ISO-DATETIME] [--type Course|GradebookColumn|Institution|OfficeHours|Personal] [--course-id COURSE_ID]
  sustech bb calendar-link set --url-stdin [--profile NAME]
  sustech bb calendar-link show [--reveal] [--profile NAME]
  sustech bb calendar-link fetch [--destination PATH [--overwrite]] [--profile NAME]
  sustech bb calendar-link delete [--profile NAME]
  sustech bb search QUERY [--course QUERY] [--kind file|folder|assignment|document|unknown] [--attachments include|only|none] [--page N] [--page-size N]
  sustech bb sync COURSE_ID --destination DIR [--content-id CONTENT_ID] [--overwrite]
  sustech bb attempts COURSE_ID [--content-id CONTENT_ID|--column-id COLUMN_ID] [--status InProgress|NeedsGrading|Completed]
  sustech bb submit preview --course-id COURSE_ID [--content-id CONTENT_ID|--column-id COLUMN_ID] --file PATH [--comment TEXT]
  sustech bb submit apply --course-id COURSE_ID [--content-id CONTENT_ID|--column-id COLUMN_ID] --file PATH --expected-sha256 HEX [--comment TEXT] [--allow-late] --confirm
  sustech ws programs [KEYWORD] [--page N] [--page-size N]
  sustech ws detail ID [--program-code CODE] [--program-token TOKEN]
  sustech library search QUERY [--limit N] [--browser [--interactive]]
  sustech library detail CONTEXT:DOC_ID [--browser [--interactive]]
  sustech library search-url QUERY [--limit N]
  sustech booking whoami
  sustech booking rooms [QUERY] [--available] [--page N] [--page-size N]
  sustech booking my-meetings [--page N] [--page-size N]
  sustech booking create preview --room-id ROOM_ID --start YYYY-MM-DDTHH:MM --end YYYY-MM-DDTHH:MM --title TEXT [--participants N] [--description TEXT]
  sustech booking create apply --room-id ROOM_ID --start YYYY-MM-DDTHH:MM --end YYYY-MM-DDTHH:MM --title TEXT [--participants N] [--description TEXT] --confirm
  sustech booking cancel preview --meeting-id ID
  sustech booking cancel apply --meeting-id ID --confirm
  sustech lib-booking whoami
  sustech lib-booking home-summary
  sustech lib-booking labs [--class-kind N]
  sustech lib-booking rooms --kind-id N --lab-id N [--class-kind N]
  sustech lib-booking reservation-count
  sustech lib-booking reservations [--start YYYY-MM-DD] [--end YYYY-MM-DD] [--need-status N] [--page N] [--page-size N]
  sustech lib-booking create preview --kind-id N --lab-id N --dev-id N --start YYYY-MM-DDTHH:MM --end YYYY-MM-DDTHH:MM --title TEXT [--class-kind N] [--member-kind 1|2] [--member ACC_NO ...] [--memo TEXT]
  sustech lib-booking create apply --kind-id N --lab-id N --dev-id N --start YYYY-MM-DDTHH:MM --end YYYY-MM-DDTHH:MM --title TEXT [--class-kind N] [--member-kind 1|2] [--member ACC_NO ...] [--memo TEXT] --confirm
  sustech lib-booking cancel preview --reservation-id N
  sustech lib-booking cancel apply --reservation-id N --confirm
  sustech pms check
  sustech pms server-groups
  sustech pms stations [--server-group N]
  sustech pms jobs
  sustech pms scan-jobs
  sustech pms usage --begin YYYY-MM-DD --end YYYY-MM-DD [--type N] [--page N] [--page-size N]
  sustech pms upload preview --file PATH [--color bw|color] [--paper unspecified|A4|A3] [--duplex single|short|long] [--page-from N [--page-to N]] [--copies N]
  sustech pms upload apply --file PATH --expected-sha256 HEX [--color bw|color] [--paper unspecified|A4|A3] [--duplex single|short|long] [--page-from N [--page-to N]] [--copies N] --confirm
  sustech pms delete preview JOB_ID
  sustech pms delete apply JOB_ID --confirm
  sustech tis courses search [KEYWORD] [--semester YYYY-YYYY-N] [--limit N] [--refresh]
  sustech tis courses available [KEYWORD] --round ROUND [--semester YYYY-YYYY-N] [--limit N]
  sustech tis enrolled [--semester YYYY-YYYY-N]
  sustech tis schedule [--semester YYYY-YYYY-N] [--week N|--all]
  sustech tis grades [--semester YYYY-YYYY-N]
  sustech tis exams
  sustech tis timetable CODE... [--semester YYYY-YYYY-N] [--block MON:1-4] [--max N] [--refresh]
  sustech tis plan init [CODE...] [--semester YYYY-YYYY-N] [--block MON:1-4] [--path PATH]
    [--early-period-threshold N] [--weight-early-session N] [--weight-gap-segment N] [--weight-gap-period N] [--weight-distinct-weekday N] [--weight-campus-switch N]
  sustech tis plan show [--path PATH]
  sustech tis plan add [CODE...] [--block MON:1-4] [--path PATH]
    [--early-period-threshold N] [--weight-early-session N] [--weight-gap-segment N] [--weight-gap-period N] [--weight-distinct-weekday N] [--weight-campus-switch N]
  sustech tis plan remove [CODE...] [--block MON:1-4] [--path PATH]
  sustech tis plan solve [--path PATH] [--semester YYYY-YYYY-N] [--max N] [--refresh]
  sustech tis plan explain COURSE_OR_RWH --round ROUND [--semester YYYY-YYYY-N] [--path PATH]
  sustech tis plan recommend [CODE...] --round ROUND [--semester YYYY-YYYY-N] [--path PATH] [--max N]
  sustech tis classroom rooms [KEYWORD] [--semester YYYY-YYYY-N] [--refresh]
  sustech tis classroom occupancy ROOM --week N --day N [--period-start N --period-end N] [--semester YYYY-YYYY-N] [--refresh]
  sustech tis classroom free --week N --day N [--period-start N --period-end N] [--semester YYYY-YYYY-N] [--refresh]
  sustech tis classroom live ROOM [--semester YYYY-YYYY-N]
  sustech tis classroom now ROOM [--semester YYYY-YYYY-N]
  sustech tis evals [--semester YYYY-YYYY-N] [--status all|pending|draft|submitted]
  sustech tis ical [--include schedule|exams|deadlines|holidays ...] [--semester YYYY-YYYY-N] [--week-one-monday YYYY-MM-DD|--teaching-start YYYY-MM-DD] [--calendar-level undergraduate|graduate] [--calendar-name NAME] [--destination PATH [--overwrite]]
  sustech tis degree progress [--details]
  sustech tis degree missing [--semester YYYY-YYYY-N]
  sustech tis degree audit --requirements FILE [--semester YYYY-YYYY-N]
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
  profile export writes a versioned JSON report to the explicit destination path.

Credentials:
  'sustech auth login' verifies credentials, then stores the password in the operating-system credential store.
  Use --profile to select an account. Environment variables and --credentials-file remain explicit automation overrides.
  The CLI never accepts a password on the command line and never stores one in its config file.

Safety:
  TIS preview commands are local-only. Blackboard submission preview performs authenticated read-only checks.
  Blackboard/TIS/booking/lib-booking/PMS apply commands change remote state only with --confirm.
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
  state?: string;
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
  include?: string[];
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
  section?: string;
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
  "room-id"?: string;
  "meeting-id"?: string;
  title?: string;
  participants?: string;
  description?: string;
  "dev-id"?: string;
  "member-kind"?: string;
  member?: string[];
  memo?: string;
  "reservation-id"?: string;
  "server-group"?: string;
  type?: string;
  color?: string;
  paper?: string;
  duplex?: string;
  copies?: string;
  "page-from"?: string;
  "page-to"?: string;
  service?: string;
  profile?: string;
  sid?: string;
  "password-stdin"?: boolean;
  path?: string;
  requirements?: string;
  details?: boolean;
  since?: string;
  until?: string;
  "url-stdin"?: boolean;
  reveal?: boolean;
  "include-blackboard"?: boolean;
  browser?: boolean;
  interactive?: boolean;
  "early-period-threshold"?: string;
  "weight-early-session"?: string;
  "weight-gap-segment"?: string;
  "weight-gap-period"?: string;
  "weight-distinct-weekday"?: string;
  "weight-campus-switch"?: string;
  help?: boolean;
};

type AuthService = "tis" | "bb" | "ws" | "booking" | "lib-booking" | "pms";

function brandArt(): string {
  return formatBrandArt(shouldUseBrandColor(process.stdout.isTTY));
}

async function main(argv: string[]): Promise<void> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: CLI_PARSE_OPTIONS,
    });
  } catch (error) {
    throw new CliError(error instanceof Error ? error.message : String(error), "USAGE", 2, {
      help: "Run `sustech --help` for usage.",
    });
  }
  const values = parsed.values as Values;
  if (values.help) {
    process.stdout.write(HELP);
    return;
  }
  if (parsed.positionals.length === 0) {
    const credentials = await getCredentialStatus(values.profile);
    process.stdout.write(`${formatDashboard({
      version: VERSION,
      runtime: `node ${process.version}`,
      credentials,
      brandArt: brandArt(),
      terminalColumns: process.stdout.isTTY ? process.stdout.columns : undefined,
    })}\n`);
    return;
  }
  const output = resolveOutputOptions(values);
  const [group, command, operation] = parsed.positionals;
  validateCommandOptions(inferCommandName(argv), argv);

  if (group === "version" && command === undefined) {
    const data = { version: VERSION, runtime: `node ${process.version}` };
    writeSuccess({
      command: "version",
      data,
      text: `${brandArt()}\n\n${formatVersion(VERSION, data.runtime)}`,
    }, output);
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
  if (group === "describe") {
    runDescribe(parsed.positionals, output);
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
  if (group === "academic") {
    await runAcademic(parsed.positionals, values, output);
    return;
  }
  if (group === "faculty") {
    await runFaculty(parsed.positionals, values, output);
    return;
  }
  if (group === "online") {
    await runOnline(parsed.positionals, values, output);
    return;
  }
  if (group === "context") {
    await runContext(parsed.positionals, values, output);
    return;
  }
  if (group === "profile") {
    await runProfile(parsed.positionals, values, output);
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
    await runLibrary(parsed.positionals, values, output);
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
  if (command === "plan" && operation === "init") {
    const semester = values.semester ? parseSemester(values.semester) : undefined;
    const preferences = parsePlanPreferenceFlags(values);
    const view = await savePlan(values.path, createPlanDocument({
      ...(semester ? { semester } : {}),
      requestedCodes: parsed.positionals.slice(3),
      blocked: (values.block ?? []).map(parseBlockedTime),
      ...(preferences ? { preferences } : {}),
    }));
    writeSuccess({
      command: "tis plan init",
      data: { path: view.path, plan: view.plan, mutation: "local-only" },
      text: formatTisPlan(view, "TIS plan initialized"),
    }, output);
    return;
  }
  if (command === "plan" && operation === "show" && parsed.positionals.length === 3) {
    const view = await loadPlan(values.path);
    writeSuccess({
      command: "tis plan show",
      data: { path: view.path, plan: view.plan },
      text: formatTisPlan(view),
    }, output);
    return;
  }
  if (command === "plan" && operation === "add") {
    const existing = await loadPlan(values.path);
    const preferences = parsePlanPreferenceFlags(values);
    const next = addPlanEntries(existing.plan, {
      requestedCodes: parsed.positionals.slice(3),
      blocked: (values.block ?? []).map(parseBlockedTime),
      ...(preferences ? { preferences } : {}),
    });
    const view = await savePlan(existing.path, next);
    writeSuccess({
      command: "tis plan add",
      data: { path: view.path, plan: view.plan, mutation: "local-only" },
      text: formatTisPlan(view, "TIS plan updated"),
    }, output);
    return;
  }
  if (command === "plan" && operation === "remove") {
    const existing = await loadPlan(values.path);
    const next = removePlanEntries(existing.plan, {
      requestedCodes: parsed.positionals.slice(3),
      blocked: (values.block ?? []).map(parseBlockedTime),
    });
    const view = await savePlan(existing.path, next);
    writeSuccess({
      command: "tis plan remove",
      data: { path: view.path, plan: view.plan, mutation: "local-only" },
      text: formatTisPlan(view, "TIS plan updated"),
    }, output);
    return;
  }
  if (command === "plan" && operation === "solve" && parsed.positionals.length === 3) {
    const view = await loadPlan(values.path);
    const semester = values.semester
      ? parseSemester(values.semester)
      : view.plan.semester
        ? parseSemester(view.plan.semester)
        : parseSemester(undefined);
    const maxResults = parsePositiveInteger(values.max, 20, "--max");
    if (maxResults > 100) throw usageError("--max cannot exceed 100.");
    const client = await tisClient(values);
    const catalog = await client.catalog(semester, values.refresh);
    const result = solveTimetables(catalog.courses, view.plan.requestedCodes, {
      maxResults,
      blocked: view.plan.blocked,
      preferences: view.plan.preferences,
    });
    writeSuccess({
      command: "tis plan solve",
      data: { path: view.path, semester, source: catalog.source, plan: view.plan, ...result },
      text: `${formatTisPlan(view)}\n\n${formatTimetables(result)}`,
      items: result.solutions,
      summary: {
        path: view.path,
        semester: semester.value,
        source: catalog.source,
        requestedCodes: result.requestedCodes,
        missingCodes: result.missingCodes,
        total: result.solutions.length,
        truncated: result.truncated,
        evaluatedCount: result.evaluatedCount,
        searchLimit: result.searchLimit,
        searchTruncated: result.searchTruncated,
      },
    }, output);
    return;
  }
  if (command === "plan" && (operation === "explain" || operation === "recommend")) {
    await runTisPlanDecision(parsed.positionals, values, output);
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
    const client = await tisClient(values);
    const evaluations = await client.evaluations(semester.value, status);
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
    const includes = tisIcalIncludes(values.include);
    const level = calendarLevel(values["calendar-level"]);
    const sourceStatuses = initTisIcalSourceStatuses(includes);
    const omissions: TisIcalOmission[] = [];
    const events: IcsEvent[] = [];
    const calendarName = defaultTisIcalCalendarName(values["calendar-name"], semester, includes);

    let calendar: AcademicCalendar | undefined;
    let term = undefined;
    let calendarFailure: string | undefined;
    const needsCalendar = includes.includes("holidays") || includes.includes("schedule");
    if (needsCalendar) {
      try {
        calendar = await new CalendarClient().loadYear(calendarYearForSemester(semester), level);
        term = calendarTermForSemester(calendar, semester);
      } catch (error) {
        calendarFailure = errorMessage(error);
      }
    }

    let tis: TisClient | undefined;
    if (includes.includes("schedule") || includes.includes("exams")) {
      try {
        tis = await tisClient(values);
      } catch (error) {
        const message = errorMessage(error);
        const state = error instanceof CliError && error.code === "CREDENTIALS_REQUIRED" ? "credentials-missing" : "error";
        if (includes.includes("schedule")) {
          sourceStatuses.schedule = { requested: true, state, eventCount: 0, omissionCount: 1, message };
          omissions.push({ source: "schedule", code: state, message });
        }
        if (includes.includes("exams")) {
          sourceStatuses.exams = { requested: true, state, eventCount: 0, omissionCount: 1, message };
          omissions.push({ source: "exams", code: state, message });
        }
      }
    }

    if (includes.includes("schedule") && tis) {
      try {
        const entries = await tis.schedule(semester);
        const anchor = await resolveTisIcalAnchor(values, semester, tis, term);
        const scheduleEvents = scheduleIcsEvents(entries, anchor, term);
        events.push(...scheduleEvents);
        const calendarAdjustmentUnavailable = term === undefined;
        if (calendarAdjustmentUnavailable) {
          omissions.push({
            source: "schedule",
            code: "CALENDAR_ADJUSTMENTS_UNAVAILABLE",
            message: calendarFailure
              ? `Schedule dates were exported without holiday or compensatory-day adjustments: ${calendarFailure}`
              : `Schedule dates were exported without holiday or compensatory-day adjustments because ${semester.value} was absent from the academic calendar.`,
          });
        }
        sourceStatuses.schedule = {
          requested: true,
          state: scheduleEvents.length > 0
            ? (calendarAdjustmentUnavailable ? "partial" : "included")
            : "omitted",
          eventCount: scheduleEvents.length,
          omissionCount: scheduleEvents.length > 0 ? (calendarAdjustmentUnavailable ? 1 : 0) : 1,
          ...(scheduleEvents.length > 0
            ? (calendarAdjustmentUnavailable ? { message: "Academic-calendar adjustments were unavailable." } : {})
            : { message: "No scheduled classes were available for the selected semester." }),
        };
        if (scheduleEvents.length === 0) {
          omissions.push({
            source: "schedule",
            code: "NO_SCHEDULE_EVENTS",
            message: "No scheduled classes were available for the selected semester.",
          });
        }
      } catch (error) {
        const message = errorMessage(error);
        sourceStatuses.schedule = {
          requested: true,
          state: "error",
          eventCount: 0,
          omissionCount: 1,
          message,
        };
        omissions.push({ source: "schedule", code: error instanceof CliError ? error.code : "SCHEDULE_EXPORT_ERROR", message });
      }
    }

    if (includes.includes("exams") && tis) {
      try {
        const exams = await tis.exams();
        const examEvents: IcsEvent[] = [];
        for (const exam of exams) {
          const examOmissions = examToIcsOmissions(exam, semester);
          if (examOmissions.length > 0) {
            omissions.push(...examOmissions);
            continue;
          }
          examEvents.push(examToIcsEvent(exam)!);
        }
        events.push(...examEvents);
        const omissionCount = omissions.filter((entry) => entry.source === "exams").length;
        sourceStatuses.exams = {
          requested: true,
          state: omissionCount > 0
            ? (examEvents.length > 0 ? "partial" : "omitted")
            : examEvents.length > 0 ? "included" : "omitted",
          eventCount: examEvents.length,
          omissionCount,
          ...(examEvents.length > 0 || omissionCount === 0 ? {} : { message: "No exam entries had exact parseable date and time ranges." }),
        };
      } catch (error) {
        const message = errorMessage(error);
        sourceStatuses.exams = {
          requested: true,
          state: "error",
          eventCount: 0,
          omissionCount: 1,
          message,
        };
        omissions.push({ source: "exams", code: error instanceof CliError ? error.code : "EXAMS_EXPORT_ERROR", message });
      }
    }

    if (includes.includes("deadlines")) {
      try {
        const adapter = await casServiceAdapter(values, "bb");
        const report = await listBlackboardDeadlines(adapter);
        const deadlineEvents: IcsEvent[] = [];
        for (const deadline of report.deadlines) {
          const event = blackboardDeadlineToIcsEvent(deadline);
          if (!event) {
            omissions.push({
              source: "deadlines",
              code: deadline.columnId || deadline.contentId || deadline.title,
              message: `Skipped Blackboard deadline "${deadline.title}": dueAt was not an exact ISO date-time with timezone.`,
            });
            continue;
          }
          deadlineEvents.push(event);
        }
        events.push(...deadlineEvents);
        omissions.push(...report.failures.map((failure, index) => ({
          source: "deadlines" as const,
          code: failure.code || failure.contentId || failure.courseCode || `failure-${index + 1}`,
          message: failure.message,
        })));
        const deadlineOmissions = omissions.filter((entry) => entry.source === "deadlines").length;
        sourceStatuses.deadlines = {
          requested: true,
          state: deadlineOmissions > 0
            ? (deadlineEvents.length > 0 ? "partial" : "omitted")
            : deadlineEvents.length > 0 ? "included" : "omitted",
          eventCount: deadlineEvents.length,
          omissionCount: deadlineOmissions,
          ...(report.failures[0]?.message ? { message: report.failures[0].message } : {}),
        };
      } catch (error) {
        const message = errorMessage(error);
        const state = error instanceof CliError && error.code === "CREDENTIALS_REQUIRED" ? "credentials-missing" : "error";
        sourceStatuses.deadlines = {
          requested: true,
          state,
          eventCount: 0,
          omissionCount: 1,
          message,
        };
        omissions.push({ source: "deadlines", code: error instanceof CliError ? error.code : "DEADLINES_EXPORT_ERROR", message });
      }
    }

    if (includes.includes("holidays")) {
      if (calendarFailure) {
        sourceStatuses.holidays = {
          requested: true,
          state: "error",
          eventCount: 0,
          omissionCount: 1,
          message: calendarFailure,
        };
        omissions.push({ source: "holidays", code: "CALENDAR_LOAD_FAILED", message: calendarFailure });
      } else if (!calendar || !term) {
        const message = `Academic calendar did not expose a term window for semester ${semester.value}.`;
        sourceStatuses.holidays = {
          requested: true,
          state: "omitted",
          eventCount: 0,
          omissionCount: 1,
          message,
        };
        omissions.push({ source: "holidays", code: "TERM_NOT_FOUND", message });
      } else {
        const holidays = calendarHolidaysForTerm(calendar, term.snapshot.start, term.snapshot.end).map(holidayToIcsEvent);
        events.push(...holidays);
        sourceStatuses.holidays = {
          requested: true,
          state: holidays.length > 0 ? "included" : "omitted",
          eventCount: holidays.length,
          omissionCount: holidays.length > 0 ? 0 : 1,
          ...(holidays.length > 0 ? {} : { message: `No academic-calendar holidays overlapped ${semester.value}.` }),
        };
        if (holidays.length === 0) {
          omissions.push({
            source: "holidays",
            code: "NO_TERM_HOLIDAYS",
            message: `No academic-calendar holidays overlapped ${semester.value}.`,
          });
        }
      }
    }

    const content = buildIcsContent(events, { calendarName });
    const file = values.destination
      ? await writeIcsFile(content, values.destination, { overwrite: values.overwrite === true })
      : undefined;
    const text = file || events.length === 0
      ? formatTisIcalResult({
          semester: semester.value,
          includes,
          total: events.length,
          sourceStatuses,
          omissions,
          ...(file ? { file } : {}),
        })
      : content;
    writeSuccess({
      command: "tis ical",
      data: {
        semester,
        includes,
        calendarLevel: level,
        sourceStatuses,
        omissions,
        events,
        eventCount: events.length,
        content,
        ...(file ? { file } : {}),
      },
      text,
      items: events,
      summary: {
        semester: semester.value,
        includes,
        total: events.length,
        ...(file ? { destination: file.destination, overwritten: file.overwritten } : {}),
      },
      meta: { sourceStatuses, omissions },
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
        evaluatedCount: result.evaluatedCount,
        searchLimit: result.searchLimit,
        searchTruncated: result.searchTruncated,
      },
    }, output);
    return;
  }
  if (command === "degree" && operation === "audit" && parsed.positionals.length === 3) {
    const requirementsPath = required(values.requirements, "--requirements");
    const requirements = await loadDegreeRequirements(requirementsPath);
    const semester = values.semester ? parseSemester(values.semester) : undefined;
    const client = await tisClient(values);
    const grades = await client.grades(semester);
    const audit = auditDegreeRequirements(grades, requirements);
    writeSuccess({
      command: "tis degree audit",
      data: { ...(semester ? { semester } : {}), requirementsPath, ...audit },
      text: formatDegreeAudit(audit, requirementsPath),
      meta: { requirementsPath },
    }, output);
    return;
  }
  if (command === "degree" && operation === "progress" && parsed.positionals.length === 3) {
    const client = await tisClient(values);
    const progress = await client.degreeProgress({ details: values.details === true });
    writeSuccess({
      command: "tis degree progress",
      data: progress,
      text: formatDegreeProgress(progress),
      ...(progress.detailsIncluded && progress.courses ? { items: progress.courses } : {}),
      summary: {
        dataAvailable: progress.dataAvailable,
        detailsRequested: progress.detailsRequested,
        detailsIncluded: progress.detailsIncluded,
        creditCategories: progress.creditCategories.length,
        moduleGaps: progress.moduleGaps.length,
        ...(progress.courseCount !== undefined ? { courseCount: progress.courseCount } : {}),
        ...progress.summary,
      },
      meta: {
        sourceStatuses: progress.sourceStatuses,
        warnings: progress.warnings,
      },
    }, output);
    return;
  }
  if (command === "degree" && operation === "missing" && parsed.positionals.length === 3) {
    const semester = values.semester ? parseSemester(values.semester) : undefined;
    const client = await tisClient(values);
    const report = await deriveTisDegreeMissing(client, { semester });
    writeSuccess({
      command: "tis degree missing",
      data: report,
      text: formatDegreeMissing(report),
      summary: {
        definiteMissingRequiredCourses: report.counts.definiteMissingRequiredCourses,
        inProgressRequiredCourses: report.counts.inProgressRequiredCourses,
        choiceGaps: report.counts.choiceGaps,
        manualReview: report.counts.manualReview,
        ...(report.officialSummary.remainingCredits !== undefined ? { remainingCredits: report.officialSummary.remainingCredits } : {}),
        ...(report.officialSummary.remainingCourses !== undefined ? { remainingCourses: report.officialSummary.remainingCourses } : {}),
      },
      meta: {
        sourceStatuses: report.sourceStatuses,
        warnings: report.warnings,
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

async function runOnline(
  positionals: string[],
  values: Values,
  output: ReturnType<typeof resolveOutputOptions>,
): Promise<void> {
  const section = positionals[1];
  const operation = positionals[2];
  const limit = parsePositiveInteger(values.limit, 20, "--limit");
  if (limit > 200) throw usageError("--limit cannot exceed 200 for SUSTech Online queries.");
  const since = values.since === undefined ? undefined : isoDate(values.since, "--since");
  const until = values.until === undefined ? undefined : isoDate(values.until, "--until");
  if (since && until && since > until) throw usageError("--since cannot be later than --until.");
  const meta = {
    authority: "community",
    official: false,
    project: "SUSTech Online",
    license: "CC-BY-SA-4.0",
  };

  if (section === "search") {
    const query = positionals.slice(2).join(" ").trim();
    if (!query) throw usageError("A SUSTech Online search query is required.");
    const selectedSection = onlineSection(values.section);
    if (selectedSection === "contact" && (since || until)) {
      throw usageError("--since and --until apply only to talk searches.");
    }
    const hits = await searchOnline(query, {
      section: selectedSection,
      since,
      until,
      limit,
    });
    writeSuccess({
      command: "online search",
      data: { query, section: selectedSection ?? "all", hits, total: hits.length },
      text: formatOnlineSearchHits(hits, query),
      items: hits,
      summary: { query, section: selectedSection ?? "all", total: hits.length },
      meta,
    }, output);
    return;
  }

  if (section === "talks" && operation === "list" && positionals.length === 3) {
    const talks = await listOnlineTalks({ since, until, limit });
    writeSuccess({
      command: "online talks list",
      data: { since, until, talks, total: talks.length },
      text: formatOnlineTalks(talks),
      items: talks,
      summary: { since, until, total: talks.length },
      meta,
    }, output);
    return;
  }
  if (section === "talks" && operation === "search") {
    const query = positionals.slice(3).join(" ").trim();
    if (!query) throw usageError("A talk search query is required.");
    const talks = await searchOnlineTalks(query, { since, until, limit });
    writeSuccess({
      command: "online talks search",
      data: { query, since, until, talks, total: talks.length },
      text: formatOnlineTalkSearch(talks, query),
      items: talks,
      summary: { query, since, until, total: talks.length },
      meta,
    }, output);
    return;
  }
  if (section === "talks" && operation === "get" && positionals.length === 4) {
    const talk = await getOnlineTalk(required(positionals[3], "talk id"));
    writeSuccess({ command: "online talks get", data: talk, text: formatOnlineTalk(talk), meta }, output);
    return;
  }

  if (section === "contact" && operation === "search") {
    const query = positionals.slice(3).join(" ").trim();
    if (!query) throw usageError("A contact search query is required.");
    const contacts = await searchOnlineContacts(query, { limit });
    writeSuccess({
      command: "online contact search",
      data: { query, contacts, total: contacts.length },
      text: formatOnlineContactSearch(contacts, query),
      items: contacts,
      summary: { query, total: contacts.length },
      meta,
    }, output);
    return;
  }
  if (section === "contact" && operation === "get" && positionals.length >= 4) {
    const identifier = positionals.slice(3).join(" ").trim();
    const contact = await getOnlineContact(required(identifier, "contact id"));
    writeSuccess({ command: "online contact get", data: contact, text: formatOnlineContact(contact), meta }, output);
    return;
  }

  throw usageError(`Unknown command: ${positionals.join(" ")}`);
}

function onlineSection(value?: string): "talks" | "contact" | undefined {
  if (value === undefined) return undefined;
  if (value === "talks" || value === "contact") return value;
  throw usageError("--section must be talks or contact.");
}

async function runProfile(
  positionals: string[],
  values: Values,
  output: ReturnType<typeof resolveOutputOptions>,
): Promise<void> {
  const command = positionals[1];
  if ((command !== "show" && command !== "export") || positionals.length !== 2) {
    throw usageError(`Unknown command: ${positionals.join(" ")}`);
  }

  const destination = command === "export" ? required(values.destination, "--destination") : undefined;
  const semester = parseSemester(undefined);
  const generatedAt = new Date();
  let credentials: Credentials | null = null;
  let credentialError: unknown;
  try {
    credentials = await resolvedCredentials(values);
  } catch (error) {
    credentialError = error;
  }
  const tisSession = credentials ? new TisSession(credentials) : undefined;
  const tis = tisSession ? new TisClient(tisSession) : undefined;
  const blackboardSession = credentials ? new CasSession(credentials, casServiceConfig("bb")) : undefined;

  const report = await collectStudentProfile({
    semester,
    generatedAt,
    loadTisUserMe: async () => {
      if (!tisSession) throw credentialError;
      return tisSession.getJson("/user/me");
    },
    loadCurrentCourses: async () => {
      if (!tis) throw credentialError;
      return tis.enrolled(semester);
    },
    loadExams: async () => {
      if (!tis) throw credentialError;
      return tis.exams();
    },
    loadBlackboardDeadlines: async () => {
      if (!blackboardSession) throw credentialError;
      const adapter: ServiceAdapter = {
        name: "bb",
        fetch(input: string, init?: RequestInit): Promise<Response> {
          return blackboardSession.fetch(input, init);
        },
      };
      return listBlackboardDeadlines(adapter, { now: generatedAt });
    },
  });

  if (command === "show") {
    writeSuccess({
      command: "profile show",
      data: report,
      text: formatStudentProfile(report),
      summary: {
        semester: report.semester,
        ...report.summary,
      },
    }, output);
    return;
  }

  if (!hasExportableProfileData(report)) {
    throw new CliError(
      "No profile data could be collected; no export was written.",
      "PROFILE_NO_DATA",
      1,
      {
        destination,
        sources: Object.fromEntries(
          Object.entries(report.sources).map(([name, source]) => [name, source.status]),
        ),
      },
    );
  }
  const path = await saveStudentProfile(destination!, report, { overwrite: values.overwrite });
  writeSuccess({
    command: "profile export",
    data: { path, profile: report, localMutation: true, remoteMutation: false },
    text: formatStudentProfile(report, { path }),
    summary: {
      path,
      semester: report.semester,
      ...report.summary,
    },
  }, output);
}

async function runAcademic(
  positionals: string[],
  values: Values,
  output: ReturnType<typeof resolveOutputOptions>,
): Promise<void> {
  const command = positionals[1];
  const operation = positionals[2];

  if (command === "snapshot" && operation === "save" && positionals.length === 3) {
    const destination = required(values.destination, "--destination");
    const { semester, snapshot, sourceItems } = await captureAcademicSnapshot(values);
    const path = await saveAcademicSnapshot(destination, snapshot, { overwrite: values.overwrite });
    writeSuccess({
      command: "academic snapshot save",
      data: { path, snapshot, localMutation: true, remoteMutation: false },
      text: formatAcademicSnapshot(snapshot, path),
      items: sourceItems,
      summary: {
        path,
        semester: semester.value,
        digest: snapshot.digest,
        sources: sourceItems.length,
        completeSources: sourceItems.filter((source) => source.status === "ok").length,
        partialSources: sourceItems.filter((source) => source.status === "partial").length,
        failedSources: sourceItems.filter((source) => source.status === "error").length,
      },
    }, output);
    return;
  }

  if (command === "snapshot" && operation === "diff" && positionals.length === 5) {
    const [beforePath, afterPath] = positionals.slice(3);
    const [before, after] = await Promise.all([
      loadAcademicSnapshot(required(beforePath, "before snapshot path")),
      loadAcademicSnapshot(required(afterPath, "after snapshot path")),
    ]);
    const diff = diffAcademicSnapshots(before, after);
    const sourceItems = Object.entries(diff.sources).map(([source, result]) => ({ source, ...result }));
    writeSuccess({
      command: "academic snapshot diff",
      data: diff,
      text: formatAcademicSnapshotDiff(diff),
      items: sourceItems,
      summary: diff.summary,
    }, output);
    return;
  }

  if (command === "changes" && positionals.length === 4) {
    const [beforePath, afterPath] = positionals.slice(2);
    const [before, after] = await Promise.all([
      loadAcademicSnapshot(required(beforePath, "before snapshot path")),
      loadAcademicSnapshot(required(afterPath, "after snapshot path")),
    ]);
    const changes = diffAcademicSnapshotChanges(before, after);
    writeSuccess({
      command: "academic changes",
      data: changes,
      text: formatAcademicSnapshotChanges(changes),
      items: changes.changes,
      summary: changes.summary,
    }, output);
    return;
  }

  if (command === "watch" && positionals.length === 2) {
    const requestedState = required(values.state, "--state");
    const statePath = await resolveAcademicWatchStatePath(requestedState);
    const previous = await loadAcademicWatchBaseline(statePath);
    const { snapshot, sourceItems } = await captureAcademicSnapshot(values);
    if (!previous || values.overwrite) assertAcademicWatchBaselineSeed(snapshot, previous ? "reset" : "create");
    const watch = evaluateAcademicSnapshotWatch(previous, snapshot, { overwrite: values.overwrite });
    const baselinePath = watch.baselineUpdated
      ? await saveAcademicSnapshot(statePath, snapshot, { overwrite: Boolean(previous) || values.overwrite })
      : statePath;
    writeSuccess({
      command: "academic watch",
      data: {
        path: baselinePath,
        watch,
        snapshot,
        localMutation: watch.baselineUpdated,
        remoteMutation: false,
      },
      text: formatAcademicSnapshotWatch(watch, baselinePath),
      items: sourceItems,
      summary: {
        path: baselinePath,
        semester: snapshot.semester,
        digest: snapshot.digest,
        state: watch.state,
        noComparison: watch.noComparison,
        comparisonAvailable: watch.comparisonAvailable,
        baselineUpdated: watch.baselineUpdated,
        comparableSources: watch.changes?.summary.comparableSources ?? 0,
        unavailableSources: watch.changes?.summary.unavailableSources ?? 0,
        totalChanges: watch.changes?.summary.totalChanges ?? 0,
      },
    }, output);
    return;
  }

  throw usageError(`Unknown command: ${positionals.join(" ")}`);
}

async function captureAcademicSnapshot(
  values: Values,
): Promise<{
  semester: Semester;
  snapshot: ReturnType<typeof buildAcademicSnapshot>;
  sourceItems: Array<{ source: string; status: string | undefined; total: number; failures: number }>;
}> {
  const semester = parseSemester(values.semester);
  const client = await tisClient(values);
  const sources: Partial<Record<"schedule" | "grades" | "exams" | "blackboardDeadlines", AcademicSnapshotSource>> = {
    schedule: await captureAcademicSource(() => client.schedule(semester)),
    grades: await captureAcademicSource(() => client.grades(semester)),
    exams: await captureAcademicExamSource(client, semester),
  };

  if (values["include-blackboard"]) {
    try {
      const report = await listBlackboardDeadlines(await casServiceAdapter(values, "bb"));
      const failures: AcademicSnapshotFailure[] = report.failures.map((failure) => ({
        code: failure.code || "BLACKBOARD_DEADLINE_READ_FAILED",
        message: failure.message,
      }));
      sources.blackboardDeadlines = academicSnapshotSource(report.deadlines, {
        status: failures.length > 0 ? "partial" : "ok",
        failures,
      });
    } catch (error) {
      sources.blackboardDeadlines = academicSnapshotError(error);
    }
  }

  if (Object.values(sources).every((source) => source?.status === "error")) {
    throw new CliError(
      "No academic source could be captured; no snapshot was written.",
      "ACADEMIC_SNAPSHOT_NO_DATA",
      1,
      { sources: Object.fromEntries(Object.entries(sources).map(([name, source]) => [name, source?.status])) },
    );
  }
  const snapshot = buildAcademicSnapshot({ semester: semester.value, sources });
  return { semester, snapshot, sourceItems: academicSnapshotSourceItems(snapshot) };
}

function academicSnapshotSourceItems(
  snapshot: ReturnType<typeof buildAcademicSnapshot>,
): Array<{ source: string; status: string | undefined; total: number; failures: number }> {
  return Object.entries(snapshot.sources).map(([name, source]) => ({
    source: name,
    status: source?.status,
    total: source?.items.length ?? 0,
    failures: source?.failures.length ?? 0,
  }));
}

function assertAcademicWatchBaselineSeed(
  snapshot: ReturnType<typeof buildAcademicSnapshot>,
  mode: "create" | "reset",
): void {
  const comparableSources = comparableAcademicSnapshotSourceCount(snapshot);
  if (comparableSources > 0) return;
  throw new CliError(
    `Academic watch needs at least one complete source to ${mode} a baseline.`,
    "ACADEMIC_WATCH_NO_COMPARABLE_BASELINE",
    1,
    {
      mode,
      sources: academicSnapshotSourceItems(snapshot).map(({ source, status }) => ({ source, status })),
    },
  );
}

async function resolveAcademicWatchStatePath(value: string): Promise<string> {
  const path = resolvePath(value.trim());
  await assertPathAndParentsAreNotSymlinks(path);
  return path;
}

async function loadAcademicWatchBaseline(path: string): Promise<Awaited<ReturnType<typeof loadAcademicSnapshot>> | undefined> {
  try {
    return await loadAcademicSnapshot(path);
  } catch (error) {
    if (error instanceof CliError && error.code === "ACADEMIC_SNAPSHOT_NOT_FOUND") return undefined;
    throw error;
  }
}

async function runTisPlanDecision(
  positionals: string[],
  values: Values,
  output: ReturnType<typeof resolveOutputOptions>,
): Promise<void> {
  const operation = positionals[2];
  const explicitSelectors = positionals.slice(3);
  if (operation === "explain" && explicitSelectors.length !== 1) {
    throw usageError("Usage: sustech tis plan explain COURSE_OR_RWH --round ROUND [--semester YYYY-YYYY-N] [--path PATH]");
  }
  const round = opaqueToken(required(values.round, "--round"), "--round");
  const view = await loadPlan(values.path);
  const semester = values.semester
    ? parseSemester(values.semester)
    : view.plan.semester
      ? parseSemester(view.plan.semester)
      : parseSemester(undefined);
  const selectors = operation === "recommend" && explicitSelectors.length === 0
    ? view.plan.requestedCodes
    : explicitSelectors;
  if (selectors.length === 0) {
    throw usageError("tis plan recommend needs one or more course codes, either as arguments or in the saved plan.");
  }
  const maxResults = operation === "recommend" ? parsePositiveInteger(values.max, 20, "--max") : undefined;
  if (maxResults !== undefined && maxResults > 50) throw usageError("--max cannot exceed 50 for plan recommendations.");

  const client = await tisClient(values);
  const selectable = await client.searchAvailable(semester, { keyword: "", round, limit: 500 });
  const selection = selectCourseDecisionCandidates(selectable.courses, selectors);
  const selectableTruncated = selectable.total > selectable.courses.length;
  if (selection.matched.length === 0) {
    throw new CliError(
      selectableTruncated
        ? "No requested section was visible in the truncated selectable-course snapshot; narrow or re-check the live round before relying on this result."
        : "No selectable section matched the requested exact course code or RWH.",
      selectableTruncated ? "COURSE_RECOMMENDATION_INCOMPLETE" : "COURSE_SELECTOR_NOT_FOUND",
      1,
      {
        semester: semester.value,
        round,
        selectors,
        missingSelectors: selection.missingSelectors,
        observed: selectable.courses.length,
        reportedTotal: selectable.total,
      },
    );
  }
  if (selection.matched.length > 50) {
    throw new CliError(
      "The requested selectors matched more than 50 sections; use a more exact course code or RWH.",
      "COURSE_RECOMMENDATION_TOO_BROAD",
      2,
      { matched: selection.matched.length, limit: 50 },
    );
  }

  let degreeMissing: Awaited<ReturnType<typeof deriveTisDegreeMissing>> | undefined;
  let degreeFailure: string | undefined;
  try {
    degreeMissing = await deriveTisDegreeMissing(client, { semester });
  } catch (error) {
    degreeFailure = errorMessage(error);
  }

  const ncesBatch = await resolveNcesCourseLookups(
    buildCourseDecisionNcesLookupRequests(selection.matched),
  );
  const baseReport = recommendCourseSections({
    selectableCourses: selectable.courses,
    candidates: selection.matched,
    plan: view.plan,
    ...(degreeMissing ? { degreeMissing } : {}),
    ncesByKey: ncesBatch.items,
    ...(maxResults !== undefined ? { maxResults } : {}),
  });
  const extraWarnings = [
    ...(selection.missingSelectors.length > 0
      ? [`No selectable section matched: ${selection.missingSelectors.join(", ")}.`]
      : []),
    ...(selectableTruncated
      ? [`TIS reported ${selectable.total} selectable sections, but only ${selectable.courses.length} were inspected; the recommendation is incomplete.`]
      : []),
    ...(view.plan.semester && view.plan.semester !== semester.value
      ? [`The saved plan targets ${view.plan.semester}, while this run inspected ${semester.value}.`]
      : []),
    ...(degreeFailure ? [`TIS degree-gap evidence was unavailable: ${degreeFailure}`] : []),
  ];
  const sourceStatuses = {
    ...baseReport.sourceStatuses,
    ...(selectableTruncated
      ? { selectable: { state: "partial" as const, message: "The selectable-course response was truncated at 500 sections." } }
      : {}),
    ...(degreeFailure
      ? { degree: { state: "unavailable" as const, message: "TIS degree-gap evidence could not be loaded for this run." } }
      : {}),
  };
  const warnings = [...new Set([...baseReport.warnings, ...extraWarnings])];
  const report = {
    ...baseReport,
    partial: baseReport.partial || extraWarnings.length > 0,
    sourceStatuses,
    warnings,
  };
  const commandName = `tis plan ${operation}`;
  writeSuccess({
    command: commandName,
    data: {
      mutation: false,
      path: view.path,
      semester,
      round,
      selectors,
      missingSelectors: selection.missingSelectors,
      selectable: { observed: selectable.courses.length, total: selectable.total, truncated: selectableTruncated },
      report,
    },
    text: formatCourseRecommendationReport(
      report,
      operation === "explain" ? "Course explanation" : "Course recommendations",
    ),
    items: report.items,
    summary: {
      path: view.path,
      semester: semester.value,
      round,
      total: report.items.length,
      partial: report.partial,
      missingSelectors: selection.missingSelectors,
      sourceStatuses: report.sourceStatuses,
    },
    meta: { advisory: report.advisory, warnings: report.warnings },
  }, output);
}

async function captureAcademicSource(load: () => Promise<readonly unknown[]>): Promise<AcademicSnapshotSource> {
  try {
    return academicSnapshotSource(await load());
  } catch (error) {
    return academicSnapshotError(error);
  }
}

async function captureAcademicExamSource(client: TisClient, semester: Semester): Promise<AcademicSnapshotSource> {
  try {
    const exams = await client.exams();
    const matching = exams.filter((exam) => exam.semester && academicSemesterLabelMatches(exam.semester, semester));
    const unknownSemesterCount = exams.filter((exam) => !exam.semester).length;
    const failures: AcademicSnapshotFailure[] = unknownSemesterCount > 0
      ? [{
          code: "EXAM_SEMESTER_UNKNOWN",
          message: `${unknownSemesterCount} exam record(s) were omitted because TIS did not identify their semester.`,
        }]
      : [];
    return academicSnapshotSource(matching, {
      status: failures.length > 0 ? "partial" : "ok",
      failures,
    });
  } catch (error) {
    return academicSnapshotError(error);
  }
}

function academicSemesterLabelMatches(label: string, semester: Semester): boolean {
  const season = semester.xq === "1" ? "秋季" : semester.xq === "2" ? "春季" : "夏季";
  const startYear = semester.xn.slice(0, 4);
  const endYear = semester.xn.slice(5);
  return [semester.value, `${semester.xn}${semester.xq}`, `${startYear}${season}`, `${endYear}${season}`]
    .some((candidate) => label.includes(candidate))
    || (label.includes(semester.xn) && label.includes(season));
}

async function runContext(
  positionals: string[],
  values: Values,
  output: ReturnType<typeof resolveOutputOptions>,
): Promise<void> {
  if (positionals.length !== 1) throw usageError(`Unknown command: ${positionals.join(" ")}`);
  const date = isoDate(values.date ?? todayInShenzhen(), "--date");
  const year = Number(date.slice(0, 4));
  const calendar = await new CalendarClient().loadYear(year, calendarLevel(values["calendar-level"]));
  const level = contextLevel(values.level);
  const service = new ContextService();
  const now = contextReferenceTime(date, values.live);
  const live = values.live ? await loadLiveContext(date, now, calendar, values, level) : undefined;
  const snapshot = service.build({
    now,
    calendar,
    ...(live?.schedule ? { schedule: live.schedule } : {}),
    ...(live?.nextDeadline ? { nextDeadline: live.nextDeadline } : {}),
    ...(live?.nextEvaluation ? { nextEvaluation: live.nextEvaluation } : {}),
    ...(live?.nextExam ? { nextExam: live.nextExam } : {}),
    ...(live?.weather ? { weather: live.weather } : {}),
    ...(live?.airQuality ? { airQuality: live.airQuality } : {}),
    ...(live?.libraryStatus ? { libraryStatus: live.libraryStatus } : {}),
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
  omissionCount?: number;
  message?: string;
}

async function loadLiveContext(
  date: string,
  now: Date,
  calendar: AcademicCalendar,
  values: Values,
  level: ContextLevel,
): Promise<{
  schedule?: { now?: string; next?: string; nextDetail?: string; tomorrowMorning?: string };
  nextDeadline?: DeadlineSummary;
  nextEvaluation?: { course: string; name: string; daysLeft?: number; dueAt?: string };
  nextExam?: { name: string; code: string; date: string; time?: string; building?: string; room?: string; campus?: string };
  liveSources: {
    tisSchedule: ContextLiveSourceStatus;
    tisExams: ContextLiveSourceStatus;
    blackboardDeadlines: ContextLiveSourceStatus;
    tisEvaluations?: ContextLiveSourceStatus;
    weather?: ContextLiveSourceStatus;
    airQuality?: ContextLiveSourceStatus;
    libraryStatus?: ContextLiveSourceStatus;
  };
  weather?: { condition: string; icon?: string; tempC?: number; feelsLikeC?: number; humidity?: number; windKmh?: number; precipitationMm?: number };
  airQuality?: { aqi: number; level?: string; pm25?: number; pm10?: number; ozone?: number };
  libraryStatus?: string;
}> {
  const liveSources: {
    tisSchedule: ContextLiveSourceStatus;
    tisExams: ContextLiveSourceStatus;
    blackboardDeadlines: ContextLiveSourceStatus;
    tisEvaluations?: ContextLiveSourceStatus;
    weather?: ContextLiveSourceStatus;
    airQuality?: ContextLiveSourceStatus;
    libraryStatus?: ContextLiveSourceStatus;
  } = {
    tisSchedule: { state: "missing" },
    tisExams: { state: "missing" },
    blackboardDeadlines: { state: "missing" },
    ...(contextLoadsNormalFields(level) ? { tisEvaluations: { state: "missing" as const } } : {}),
    ...(contextLoadsVerboseFields(level)
      ? {
          weather: { state: "missing" as const },
          airQuality: { state: "missing" as const },
          libraryStatus: { state: "missing" as const },
        }
      : {}),
  };

  const result: {
    schedule?: { now?: string; next?: string; nextDetail?: string; tomorrowMorning?: string };
    nextDeadline?: DeadlineSummary;
    nextEvaluation?: { course: string; name: string; daysLeft?: number; dueAt?: string };
    nextExam?: { name: string; code: string; date: string; time?: string; building?: string; room?: string; campus?: string };
    liveSources: {
      tisSchedule: ContextLiveSourceStatus;
      tisExams: ContextLiveSourceStatus;
      blackboardDeadlines: ContextLiveSourceStatus;
      tisEvaluations?: ContextLiveSourceStatus;
      weather?: ContextLiveSourceStatus;
      airQuality?: ContextLiveSourceStatus;
      libraryStatus?: ContextLiveSourceStatus;
    };
    weather?: { condition: string; icon?: string; tempC?: number; feelsLikeC?: number; humidity?: number; windKmh?: number; precipitationMm?: number };
    airQuality?: { aqi: number; level?: string; pm25?: number; pm10?: number; ozone?: number };
    libraryStatus?: string;
  } = { liveSources };

  const calendarDay = calendar.day(date);
  const termSemester = calendarDay.semester;
  const semester = termSemester
    ? parseSemester(termSemester.semester.value)
    : parseSemester(undefined);
  const currentWeek = calendarDay.week;

  let tis: TisClient | undefined;
  try {
    tis = await tisClient(values);
  } catch (error) {
    const message = errorMessage(error);
    const state = error instanceof CliError && error.code === "CREDENTIALS_REQUIRED" ? "credentials-missing" : "error";
    liveSources.tisSchedule = { state, message };
    liveSources.tisExams = { state, message };
    if (liveSources.tisEvaluations) liveSources.tisEvaluations = { state, message };
  }

  if (tis) {
    const [scheduleResult, examsResult, evaluationsResult] = await Promise.allSettled([
      currentWeek > 0 ? tis.schedule(semester) : Promise.resolve([] as PersonalScheduleEntry[]),
      tis.exams(),
      contextLoadsNormalFields(level)
        ? tis.evaluations(semester.value, "all")
        : Promise.resolve(undefined),
    ]);

    if (scheduleResult.status === "fulfilled") {
      if (currentWeek > 0) {
        const calendarTerm = calendar.terms().find((candidate) => (
          candidate.snapshot.semester.value === semester.value
        ));
        const schedule = summariseCurrentOrNextClass(scheduleResult.value, { currentWeek, now, calendarTerm });
        result.schedule = schedule;
        liveSources.tisSchedule = {
          state: schedule.now || schedule.next || schedule.tomorrowMorning ? "provided" : "missing",
        };
      } else {
        liveSources.tisSchedule = {
          state: "missing",
          message: `Date ${date} is outside the loaded academic teaching weeks.`,
        };
      }
    } else {
      liveSources.tisSchedule = {
        state: "error",
        message: errorMessage(scheduleResult.reason),
      };
    }

    if (examsResult.status === "fulfilled") {
      const semesterOmissions = examsResult.value
        .filter((exam) => !matchesSemesterLabel(exam.semester, semester))
        .map((exam) => ({
          code: exam.code || exam.name || "exam",
          message: exam.semester
            ? `Skipped ${exam.code || exam.name || "exam"}: exam semester "${exam.semester}" did not match ${semester.value}.`
            : `Skipped ${exam.code || exam.name || "exam"}: exam semester was missing.`,
        }));
      const selection = nearestUpcomingExam(
        examsResult.value.filter((exam) => matchesSemesterLabel(exam.semester, semester)),
        { now },
      );
      if (selection.exam) result.nextExam = contextExamSummary(selection.exam);
      const omissionCount = selection.omissions.length + semesterOmissions.length;
      liveSources.tisExams = {
        state: omissionCount > 0 ? "partial" : selection.exam ? "provided" : "missing",
        omissionCount,
        ...((selection.omissions[0] ?? semesterOmissions[0]) ? { message: (selection.omissions[0] ?? semesterOmissions[0])?.message } : {}),
      };
    } else {
      liveSources.tisExams = {
        state: "error",
        message: errorMessage(examsResult.reason),
      };
    }

    if (liveSources.tisEvaluations) {
      if (evaluationsResult.status === "fulfilled") {
        const selection = nextPendingEvaluationSummary(evaluationsResult.value ?? [], now);
        if (selection.evaluation) result.nextEvaluation = selection.evaluation;
        liveSources.tisEvaluations = {
          state: selection.state,
          omissionCount: selection.omissionCount,
          ...(selection.message ? { message: selection.message } : {}),
        };
      } else {
        liveSources.tisEvaluations = {
          state: "error",
          message: errorMessage(evaluationsResult.reason),
        };
      }
    }
  }

  try {
    const adapter = await casServiceAdapter(values, "bb");
    const report = await listBlackboardDeadlines(adapter, { now });
    const deadline = nextBlackboardDeadline(report);
    if (deadline) result.nextDeadline = contextDeadlineSummary(deadline);
    liveSources.blackboardDeadlines = {
      state: report.failures.length > 0 ? "partial" : deadline ? "provided" : "missing",
      generatedAt: report.generatedAt,
      failureCount: report.failures.length,
      ...(report.failures[0]?.message ? { message: report.failures[0].message } : {}),
    };
  } catch (error) {
    const message = errorMessage(error);
    liveSources.blackboardDeadlines = {
      state: error instanceof CliError && error.code === "CREDENTIALS_REQUIRED" ? "credentials-missing" : "error",
      message,
    };
  }

  if (contextLoadsVerboseFields(level)) {
    const [weatherResult, airQualityResult, libraryStatusResult] = await Promise.allSettled([
      fetchContextWeather(),
      fetchContextAirQuality(),
      fetchContextLibraryStatus(),
    ]);

    liveSources.weather = settledContextPublicSource(weatherResult);
    if (weatherResult.status === "fulfilled" && weatherResult.value) result.weather = weatherResult.value;

    liveSources.airQuality = settledContextPublicSource(airQualityResult);
    if (airQualityResult.status === "fulfilled" && airQualityResult.value) result.airQuality = airQualityResult.value;

    liveSources.libraryStatus = settledContextPublicSource(libraryStatusResult);
    if (libraryStatusResult.status === "fulfilled" && libraryStatusResult.value) result.libraryStatus = libraryStatusResult.value;
  }

  return result;
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

function formatContextLiveSources(sources: {
  tisSchedule: ContextLiveSourceStatus;
  tisExams: ContextLiveSourceStatus;
  blackboardDeadlines: ContextLiveSourceStatus;
  tisEvaluations?: ContextLiveSourceStatus;
  weather?: ContextLiveSourceStatus;
  airQuality?: ContextLiveSourceStatus;
  libraryStatus?: ContextLiveSourceStatus;
}): string[] {
  const parts = [
    formatContextLiveSource("TIS schedule", sources.tisSchedule),
    formatContextLiveSource("TIS exams", sources.tisExams),
    formatContextLiveSource("Blackboard deadlines", sources.blackboardDeadlines),
    ...(sources.tisEvaluations ? [formatContextLiveSource("TIS evaluations", sources.tisEvaluations)] : []),
    ...(sources.weather ? [formatContextLiveSource("Weather", sources.weather)] : []),
    ...(sources.airQuality ? [formatContextLiveSource("Air quality", sources.airQuality)] : []),
    ...(sources.libraryStatus ? [formatContextLiveSource("Library status", sources.libraryStatus)] : []),
  ];
  return [
    `Live sources: ${parts.join(" | ")}`,
  ];
}

function contextLoadsNormalFields(level: ContextLevel): boolean {
  return level === "normal" || level === "verbose";
}

function contextLoadsVerboseFields(level: ContextLevel): boolean {
  return level === "verbose";
}

function nextPendingEvaluationSummary(
  rows: readonly EvaluationCourseStatus[] | undefined,
  now: Date,
): {
  state: ContextLiveSourceState;
  omissionCount: number;
  message?: string;
  evaluation?: { course: string; name: string; daysLeft?: number; dueAt?: string };
} {
  const actionable = (rows ?? []).filter((row) => !row.submitted);
  if (actionable.length === 0) return { state: "missing", omissionCount: 0 };

  const dated = actionable
    .map((row) => ({ row, due: parseContextDueAt(row.deadline) }))
    .filter((
      entry,
    ): entry is { row: EvaluationCourseStatus; due: { epochMs: number; label: string; date: string } } => entry.due !== undefined)
    .sort((left, right) => left.due.epochMs - right.due.epochMs || left.row.courseCode.localeCompare(right.row.courseCode));
  const missingDeadlineCount = actionable.length - dated.length;
  const next = dated.find((entry) => entry.due.epochMs >= now.getTime()) ?? dated[0];
  if (next) {
    return {
      state: missingDeadlineCount > 0 ? "partial" : "provided",
      omissionCount: missingDeadlineCount,
      ...(missingDeadlineCount > 0 ? { message: `${missingDeadlineCount} evaluation task(s) did not expose a parseable deadline.` } : {}),
      evaluation: {
        course: [next.row.courseCode, next.row.courseName].filter(Boolean).join(" ").trim() || next.row.courseName,
        name: next.row.rawStatus === "3" ? "教学评估（已保存）" : "教学评估",
        dueAt: next.due.label,
        daysLeft: daysLeftFromShenzhen(now, next.due.date),
      },
    };
  }
  const fallback = actionable[0];
  return {
    state: "partial",
    omissionCount: missingDeadlineCount || actionable.length,
    message: "Evaluation tasks were available, but none exposed a parseable upcoming deadline.",
    evaluation: {
      course: [fallback?.courseCode, fallback?.courseName].filter(Boolean).join(" ").trim() || fallback?.courseName || "Teaching evaluation",
      name: fallback?.rawStatus === "3" ? "教学评估（已保存）" : "教学评估",
    },
  };
}

function parseContextDueAt(value: string | undefined): { epochMs: number; label: string; date: string } | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return {
      epochMs: new Date(`${text}T23:59:59+08:00`).getTime(),
      label: text,
      date: text,
    };
  }
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?$/.test(text)) {
    const iso = text.replace(" ", "T");
    const normalized = /[zZ]|[+-]\d{2}:\d{2}$/.test(iso) ? iso : `${iso}+08:00`;
    const parsed = new Date(normalized);
    if (!Number.isNaN(parsed.getTime())) {
      return {
        epochMs: parsed.getTime(),
        label: iso,
        date: iso.slice(0, 10),
      };
    }
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return {
    epochMs: parsed.getTime(),
    label: text,
    date: text.slice(0, 10),
  };
}

function daysLeftFromShenzhen(now: Date, dueDate: string): number {
  const start = new Date(`${todayInShenzhen(now)}T00:00:00+08:00`).getTime();
  const end = new Date(`${dueDate}T00:00:00+08:00`).getTime();
  return Math.floor((end - start) / (24 * 60 * 60 * 1000));
}

function settledContextPublicSource<T>(result: PromiseSettledResult<T | null | string | undefined>): ContextLiveSourceStatus {
  if (result.status === "rejected") {
    return {
      state: "error",
      message: errorMessage(result.reason),
    };
  }
  if (result.value === undefined || result.value === null || result.value === "") {
    return { state: "missing" };
  }
  return { state: "provided" };
}

type TisIcalInclude = "schedule" | "exams" | "deadlines" | "holidays";
type TisIcalSourceState = "included" | "partial" | "omitted" | "not-requested" | "credentials-missing" | "error";

interface TisIcalSourceStatus {
  requested: boolean;
  state: TisIcalSourceState;
  eventCount: number;
  omissionCount: number;
  message?: string;
}

type TisIcalSourceStatuses = Record<TisIcalInclude, TisIcalSourceStatus>;

interface TisIcalOmission {
  source: TisIcalInclude;
  code: string;
  message: string;
}

function tisIcalIncludes(values: readonly string[] | undefined): TisIcalInclude[] {
  if (!values || values.length === 0) return ["schedule"];
  const includes: TisIcalInclude[] = [];
  for (const value of values) {
    if (value === "schedule" || value === "exams" || value === "deadlines" || value === "holidays") {
      if (!includes.includes(value)) includes.push(value);
      continue;
    }
    throw usageError("--include must be schedule, exams, deadlines, or holidays.");
  }
  return includes;
}

function initTisIcalSourceStatuses(includes: readonly TisIcalInclude[]): TisIcalSourceStatuses {
  const requested = new Set(includes);
  const make = (source: TisIcalInclude): TisIcalSourceStatus => ({
    requested: requested.has(source),
    state: requested.has(source) ? "omitted" : "not-requested",
    eventCount: 0,
    omissionCount: 0,
  });
  return {
    schedule: make("schedule"),
    exams: make("exams"),
    deadlines: make("deadlines"),
    holidays: make("holidays"),
  };
}

function defaultTisIcalCalendarName(
  explicit: string | undefined,
  semester: Semester,
  includes: readonly TisIcalInclude[],
): string {
  if (explicit?.trim()) return explicit.trim();
  if (includes.length === 1 && includes[0] === "schedule") return "SUSTech Schedule";
  return `SUSTech ${semester.value} academic calendar`;
}

function calendarYearForSemester(semester: Semester): number {
  return Number(semester.xq === "1" ? semester.xn.slice(0, 4) : semester.xn.slice(5));
}

function calendarTermForSemester(calendar: AcademicCalendar, semester: Semester) {
  return calendar.terms().find((term) => term.snapshot.semester.value === semester.value);
}

async function resolveTisIcalAnchor(
  values: Values,
  semester: Semester,
  tis: TisClient,
  term: ReturnType<typeof calendarTermForSemester> | undefined,
): Promise<IcsAnchor> {
  if (values["week-one-monday"]) return { weekOneMonday: isoDate(values["week-one-monday"], "--week-one-monday") };
  if (values["teaching-start"]) return { teachingStartDate: isoDate(values["teaching-start"], "--teaching-start") };
  if (term) return { teachingStartDate: term.snapshot.teachingStart };
  if (values.semester) {
    throw new CliError(
      "An explicit --semester requires either --week-one-monday, --teaching-start, or a matching academic-calendar term.",
      "ICS_ANCHOR_REQUIRED",
      2,
      { semester: semester.value },
    );
  }
  return { weekOneMonday: inferWeekOneMonday(todayInShenzhen(), await tis.currentWeek()) };
}

function examToIcsEvent(exam: ExamRecord): IcsEvent | undefined {
  if (!exactIsoDate(exam.date)) return undefined;
  const range = parseShenzhenExamTimeRange(exam.date, exam.time);
  if (!range) return undefined;
  const location = [exam.building, exam.room, exam.campus].filter(Boolean).join(" ").trim();
  return {
    uid: `exam-${sanitizeIcsId(exam.code || exam.name || "exam")}-${exam.date}-${sanitizeIcsId(exam.time || "time")}@sustech-cli`,
    summary: `Exam · ${[exam.code, exam.name].filter(Boolean).join(" ").trim() || "SUSTech exam"}`,
    description: [
      exam.name ? `Course: ${exam.name}` : "",
      exam.type ? `Type: ${exam.type}` : "",
      exam.semester ? `Semester: ${exam.semester}` : "",
    ].filter(Boolean).join(" | "),
    ...(location ? { location } : {}),
    startUtc: range.startUtc,
    endUtc: range.endUtc,
  };
}

function examToIcsOmissions(exam: ExamRecord, semester?: Semester): TisIcalOmission[] {
  const code = exam.code || exam.name || "exam";
  if (semester) {
    if (!exam.semester) {
      return [{ source: "exams", code, message: `Skipped ${code}: exam semester was missing.` }];
    }
    if (!matchesSemesterLabel(exam.semester, semester)) {
      return [{ source: "exams", code, message: `Skipped ${code}: exam semester "${exam.semester}" did not match ${semester.value}.` }];
    }
  }
  if (!exactIsoDate(exam.date)) {
    return [{ source: "exams", code, message: `Skipped ${code}: exam date was not an exact YYYY-MM-DD value.` }];
  }
  if (!parseShenzhenExamTimeRange(exam.date, exam.time)) {
    return [{ source: "exams", code, message: `Skipped ${code}: exam time was not an exact HH:MM-HH:MM Shenzhen range.` }];
  }
  return [];
}

function blackboardDeadlineToIcsEvent(deadline: BlackboardDeadline): IcsEvent | undefined {
  const startUtc = parseIsoDateTimeToUtcStamp(deadline.dueAt);
  if (!startUtc) return undefined;
  return {
    uid: `bb-deadline-${sanitizeIcsId(deadline.courseId)}-${sanitizeIcsId(deadline.columnId)}@sustech-cli`,
    summary: `Deadline · ${deadline.courseCode} ${deadline.title}`,
    description: [
      deadline.courseName ? `Course: ${deadline.courseName}` : "",
      deadline.scorePossible !== undefined ? `Score possible: ${deadline.scorePossible}` : "",
      deadline.attemptsAllowed !== undefined ? `Attempts allowed: ${deadline.attemptsAllowed}` : "",
    ].filter(Boolean).join(" | "),
    startUtc,
  };
}

function calendarHolidaysForTerm(calendar: AcademicCalendar, start: string, end: string) {
  const seen = new Set<string>();
  const holidays: Array<{ name: string; start: string; end: string }> = [];
  for (let cursor = start; cursor <= end; cursor = addIsoDays(cursor, 1)) {
    const holiday = calendar.day(cursor).holiday;
    if (!holiday) continue;
    const key = `${holiday.name}|${holiday.start}|${holiday.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    holidays.push(holiday);
  }
  return holidays.sort((left, right) =>
    left.start.localeCompare(right.start)
    || left.end.localeCompare(right.end)
    || left.name.localeCompare(right.name),
  );
}

function formatTisIcalResult(input: {
  semester: string;
  includes: readonly TisIcalInclude[];
  total: number;
  sourceStatuses: TisIcalSourceStatuses;
  omissions: readonly TisIcalOmission[];
  file?: { destination: string; size: number; sha256: string; overwritten: boolean };
}): string {
  const lines = [
    `TIS iCalendar export · ${input.semester}`,
    `Included sources: ${input.includes.join(", ")}`,
    `Events: ${input.total}`,
    `Schedule: ${formatTisIcalSourceStatus(input.sourceStatuses.schedule)}`,
    `Exams: ${formatTisIcalSourceStatus(input.sourceStatuses.exams)}`,
    `Blackboard deadlines: ${formatTisIcalSourceStatus(input.sourceStatuses.deadlines)}`,
    `Holidays: ${formatTisIcalSourceStatus(input.sourceStatuses.holidays)}`,
    ...(input.file ? [
      `Destination: ${input.file.destination}`,
      `Size: ${input.file.size} bytes`,
      `SHA-256: ${input.file.sha256}`,
      `Overwritten: ${input.file.overwritten ? "yes" : "no"}`,
    ] : []),
  ];
  if (input.omissions[0]) lines.push(`First omission: ${input.omissions[0].message}`);
  return lines.join("\n");
}

function formatTisIcalSourceStatus(status: TisIcalSourceStatus): string {
  const extras = [
    `events=${status.eventCount}`,
    status.omissionCount > 0 ? `omissions=${status.omissionCount}` : "",
    status.message ?? "",
  ].filter(Boolean).join(" · ");
  return `${status.state}${extras ? ` (${extras})` : ""}`;
}

function contextReferenceTime(date: string, live: boolean | undefined): Date {
  if (live && date === todayInShenzhen()) return new Date();
  return new Date(`${date}T12:00:00+08:00`);
}

function contextExamSummary(exam: ExamRecord): {
  name: string;
  code: string;
  date: string;
  time?: string;
  building?: string;
  room?: string;
  campus?: string;
} {
  return {
    name: exam.name,
    code: exam.code,
    date: exam.date,
    ...(exam.time ? { time: exam.time } : {}),
    ...(exam.building ? { building: exam.building } : {}),
    ...(exam.room ? { room: exam.room } : {}),
    ...(exam.campus ? { campus: exam.campus } : {}),
  };
}

function formatContextLiveSource(label: string, status: ContextLiveSourceStatus): string {
  const extras = [
    status.failureCount ? `${status.failureCount} failure(s)` : "",
    status.omissionCount ? `${status.omissionCount} omission(s)` : "",
    status.message ?? "",
  ].filter(Boolean).join(" · ");
  return `${label}: ${status.state}${extras ? ` · ${extras}` : ""}`;
}

function matchesSemesterLabel(label: string, semester: Semester): boolean {
  if (!label.trim()) return false;
  const season = semester.xq === "1" ? "秋季" : semester.xq === "2" ? "春季" : "夏季";
  const startYear = semester.xn.slice(0, 4);
  const endYear = semester.xn.slice(5);
  return [semester.value, `${semester.xn}${semester.xq}`, `${startYear}${season}`, `${endYear}${season}`]
    .some((candidate) => label.includes(candidate))
    || (label.includes(semester.xn) && label.includes(season));
}

function exactIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

function sanitizeIcsId(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "item";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
  if (command === "calendar-link" && positionals.length === 3) {
    const operation = positionals[2];
    if (operation === "set") {
      if (values["url-stdin"] !== true) {
        throw usageError("bb calendar-link set requires --url-stdin so the private feed token is not placed in shell history.");
      }
      const url = await readCalendarLinkFromStdin();
      const verified = await fetchBlackboardCalendarFeed(url);
      const saved = await saveBlackboardCalendarLink({ profile: values.profile, url });
      writeSuccess({
        command: "bb calendar-link set",
        data: {
          ...saved,
          verified: true,
          feedSize: verified.size,
          contentType: verified.contentType,
        },
        text: [
          "Blackboard calendar subscription saved in the operating-system credential store.",
          `Profile: ${saved.profile}`,
          `Link: ${saved.maskedUrl}`,
          `Verified feed: ${verified.size} bytes · ${verified.contentType}`,
          "Treat the subscription link as a password; it grants calendar access without CAS login.",
        ].join("\n"),
      }, output);
      return;
    }
    if (operation === "show") {
      const stored = await loadBlackboardCalendarLink(values.profile);
      const reveal = values.reveal === true;
      writeSuccess({
        command: "bb calendar-link show",
        data: {
          profile: stored.profile,
          backend: stored.backend,
          maskedUrl: stored.maskedUrl,
          revealed: reveal,
          ...(reveal ? { url: stored.url } : {}),
        },
        text: [
          `Blackboard calendar subscription · ${stored.profile}`,
          reveal ? stored.url : stored.maskedUrl,
          reveal
            ? "Private link revealed by explicit request. Do not share or log it."
            : "Masked by default. Pass --reveal only when the full private link is required.",
        ].join("\n"),
      }, output);
      return;
    }
    if (operation === "fetch") {
      const feed = await fetchStoredBlackboardCalendarFeed({ profile: values.profile });
      if (values.destination) {
        const written = await writeIcsFile(feed.content, values.destination, { overwrite: values.overwrite === true });
        writeSuccess({
          command: "bb calendar-link fetch",
          data: {
            profile: feed.profile,
            maskedUrl: feed.maskedUrl,
            contentType: feed.contentType,
            redirects: feed.redirects,
            ...written,
          },
          text: [
            "Blackboard calendar subscription fetched.",
            `Profile: ${feed.profile ?? "default"}`,
            `Link: ${feed.maskedUrl}`,
            `Saved to: ${written.destination}`,
            `Size: ${written.size} bytes`,
            `SHA-256: ${written.sha256}`,
            `Overwritten: ${written.overwritten ? "yes" : "no"}`,
          ].join("\n"),
        }, output);
      } else {
        writeSuccess({
          command: "bb calendar-link fetch",
          data: feed,
          text: feed.content,
        }, output);
      }
      return;
    }
    if (operation === "delete") {
      const removed = await deleteBlackboardCalendarLink(values.profile);
      writeSuccess({
        command: "bb calendar-link delete",
        data: removed,
        text: removed.removed
          ? `Blackboard calendar subscription removed from profile ${removed.profile}.`
          : `No Blackboard calendar subscription was stored for profile ${removed.profile}.`,
      }, output);
      return;
    }
  }
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
  if (command === "calendar" && positionals.length === 2) {
    const type = blackboardCalendarItemType(values.type);
    const courseId = values["course-id"]
      ? opaqueToken(values["course-id"], "--course-id")
      : undefined;
    const adapter = await casServiceAdapter(values, "bb");
    const report = await listBlackboardCalendarItems(adapter, {
      ...(values.since ? { since: values.since } : {}),
      ...(values.until ? { until: values.until } : {}),
      ...(type ? { type } : {}),
      ...(courseId ? { courseId } : {}),
    });
    writeSuccess({
      command: "bb calendar",
      data: report,
      text: formatBlackboardCalendar(report),
      items: report.items,
      summary: {
        since: report.since,
        until: report.until,
        ...(report.type ? { type: report.type } : {}),
        ...(report.courseId ? { courseId: report.courseId } : {}),
        total: report.totalItems,
        partial: report.partial,
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
        4,
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

async function runLibrary(
  positionals: string[],
  values: Values,
  output: ReturnType<typeof resolveOutputOptions>,
): Promise<void> {
  const command = positionals[1];
  if (command === "search") {
    const query = positionals.slice(2).join(" ").trim();
    if (!query) throw usageError("A library search query is required.");
    if (values.interactive && !values.browser) throw usageError("--interactive requires --browser for library catalog commands.");
    const limit = parsePositiveInteger(values.limit, 10, "--limit");
    if (limit > 50) throw usageError("--limit cannot exceed 50 for library catalog search.");
    if (values.browser) {
      const page = await searchPrimoCatalogByBrowser(
        { query, limit, scope: "default" },
        { interactive: values.interactive },
      );
      writeSuccess({
        command: "library search",
        data: { mutation: false, transport: "browser", page },
        text: formatBrowserPrimoCatalogSearch(page),
        items: page.results,
        summary: { query, shown: page.totalReturned, transport: "browser", authentication: page.authentication },
      }, output);
      return;
    }
    const page = await searchLibraryCatalog(createPrimoPublicAdapter(), { query, limit });
    writeSuccess({
      command: "library search",
      data: { mutation: false, transport: "public-json", page },
      text: formatLibraryCatalogSearch(page),
      items: page.items,
      summary: { query, total: page.total, shown: page.items.length, first: page.first, last: page.last, transport: "public-json" },
    }, output);
    return;
  }
  if (command === "detail" && positionals.length === 3) {
    const reference = inlineText(required(positionals[2], "Primo record reference"), "Primo record reference", 2048);
    if (values.interactive && !values.browser) throw usageError("--interactive requires --browser for library catalog commands.");
    if (values.browser) {
      const detail = await getPrimoCatalogDetailByBrowser(reference, { interactive: values.interactive });
      writeSuccess({
        command: "library detail",
        data: { mutation: false, transport: "browser", detail },
        text: formatBrowserPrimoCatalogDetail(detail),
        summary: { reference: detail.reference, transport: "browser", authentication: detail.authentication },
      }, output);
      return;
    }
    const detail = await getLibraryCatalogDetail(createPrimoPublicAdapter(), reference);
    writeSuccess({
      command: "library detail",
      data: { mutation: false, transport: "public-json", detail },
      text: formatLibraryCatalogDetail(detail),
      summary: { reference: detail.reference, transport: "public-json" },
    }, output);
    return;
  }
  if (command === "search-url") {
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
    return;
  }
  throw usageError(`Unknown command: ${positionals.join(" ")}`);
}

async function runBooking(
  positionals: string[],
  values: Values,
  output: ReturnType<typeof resolveOutputOptions>,
): Promise<void> {
  const command = positionals[1];
  const operation = positionals[2];
  if (command === "create" && operation === "preview" && positionals.length === 3) {
    const target = bookingCreateTarget(values);
    const session = await bookingService(values);
    const preview = await buildBookingCreatePreview(session, target);
    const confirmation = preview.applyAllowed
      ? buildBookingCreateApplyConfirmation(target, {
        credentialsFile: values["credentials-file"],
        profile: values.profile,
      })
      : undefined;
    writeSuccess({
      command: "booking create preview",
      data: {
        mode: "preview",
        mutation: false,
        target,
        preview,
        confirmation: {
          required: true,
          available: Boolean(confirmation),
          ...(confirmation ? { argv: confirmation.argv, command: confirmation.command } : {}),
        },
      },
      text: formatBookingCreatePreview(preview, confirmation?.command),
    }, output);
    return;
  }
  if (command === "create" && operation === "apply" && positionals.length === 3) {
    if (!values.confirm) throw new ConfirmationRequiredError("E-Hall booking create", "E-Hall booking create changes campus room state. Re-run the exact previewed command with --confirm.");
    const target = bookingCreateTarget(values);
    const session = await bookingService(values);
    const result = await applyBookingCreate(session, target);
    writeSuccess({
      command: "booking create apply",
      data: {
        mode: "apply",
        mutation: true,
        ...result,
      },
      text: formatBookingCreateSuccess(result),
    }, output);
    return;
  }
  if (command === "cancel" && operation === "preview" && positionals.length === 3) {
    const target = bookingCancelTarget(values);
    const session = await bookingService(values);
    const preview = await buildBookingCancelPreview(session, target);
    const confirmation = preview.applyAllowed
      ? buildBookingCancelApplyConfirmation(target, {
        credentialsFile: values["credentials-file"],
        profile: values.profile,
      })
      : undefined;
    writeSuccess({
      command: "booking cancel preview",
      data: {
        mode: "preview",
        mutation: false,
        target,
        preview,
        confirmation: {
          required: true,
          available: Boolean(confirmation),
          ...(confirmation ? { argv: confirmation.argv, command: confirmation.command } : {}),
        },
      },
      text: formatBookingCancelPreview(preview, confirmation?.command),
    }, output);
    return;
  }
  if (command === "cancel" && operation === "apply" && positionals.length === 3) {
    if (!values.confirm) throw new ConfirmationRequiredError("E-Hall booking cancel", "E-Hall booking cancel releases a live room slot. Re-run the exact previewed command with --confirm.");
    const target = bookingCancelTarget(values);
    const session = await bookingService(values);
    const result = await applyBookingCancel(session, target);
    writeSuccess({
      command: "booking cancel apply",
      data: {
        mode: "apply",
        mutation: true,
        ...result,
      },
      text: formatBookingCancelSuccess(result),
    }, output);
    return;
  }
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
  const operation = positionals[2];
  if (command === "create" && operation === "preview" && positionals.length === 3) {
    const target = libraryBookingCreateTarget(values);
    const session = await libraryBookingService(values);
    const preview = await buildLibraryBookingCreatePreview(session, target);
    const confirmation = preview.applyAllowed
      ? buildLibraryBookingCreateApplyConfirmation(target, {
        credentialsFile: values["credentials-file"],
        profile: values.profile,
      })
      : undefined;
    writeSuccess({
      command: "lib-booking create preview",
      data: {
        mode: "preview",
        mutation: false,
        target,
        preview,
        confirmation: {
          required: true,
          available: Boolean(confirmation),
          ...(confirmation ? { argv: confirmation.argv, command: confirmation.command } : {}),
        },
      },
      text: formatLibraryBookingCreatePreview(preview, confirmation?.command),
    }, output);
    return;
  }
  if (command === "create" && operation === "apply" && positionals.length === 3) {
    if (!values.confirm) throw new ConfirmationRequiredError("Library booking create", "Library booking create changes a live reservation slot. Re-run the exact previewed command with --confirm.");
    const target = libraryBookingCreateTarget(values);
    const session = await libraryBookingService(values);
    const result = await applyLibraryBookingCreate(session, target);
    writeSuccess({
      command: "lib-booking create apply",
      data: {
        mode: "apply",
        mutation: true,
        ...result,
      },
      text: formatLibraryBookingCreateSuccess(result),
    }, output);
    return;
  }
  if (command === "cancel" && operation === "preview" && positionals.length === 3) {
    const target = libraryBookingCancelTarget(values);
    const session = await libraryBookingService(values);
    const preview = await buildLibraryBookingCancelPreview(session, target);
    const confirmation = preview.applyAllowed
      ? buildLibraryBookingCancelApplyConfirmation(target, {
        credentialsFile: values["credentials-file"],
        profile: values.profile,
      })
      : undefined;
    writeSuccess({
      command: "lib-booking cancel preview",
      data: {
        mode: "preview",
        mutation: false,
        target,
        preview,
        confirmation: {
          required: true,
          available: Boolean(confirmation),
          ...(confirmation ? { argv: confirmation.argv, command: confirmation.command } : {}),
        },
      },
      text: formatLibraryBookingCancelPreview(preview, confirmation?.command),
    }, output);
    return;
  }
  if (command === "cancel" && operation === "apply" && positionals.length === 3) {
    if (!values.confirm) throw new ConfirmationRequiredError("Library booking cancel", "Library booking cancel releases a live reservation slot. Re-run the exact previewed command with --confirm.");
    const target = libraryBookingCancelTarget(values);
    const session = await libraryBookingService(values);
    const result = await applyLibraryBookingCancel(session, target);
    writeSuccess({
      command: "lib-booking cancel apply",
      data: {
        mode: "apply",
        mutation: true,
        ...result,
      },
      text: formatLibraryBookingCancelSuccess(result),
    }, output);
    return;
  }
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
  if (command === "upload" && positionals[2] === "preview" && positionals.length === 3) {
    const file = await inspectPmsUploadFile(required(values.file, "--file"));
    const options = pmsUploadOptions(values);
    const session = await pmsService(values);
    const jobs = await listPmsPrintJobs(session);
    const preview = buildPmsPrintUploadPreview(
      jobs,
      file,
      options,
      buildPmsUploadApplyConfirmation(file.absolutePath, file.sha256, options, {
        credentialsFile: values["credentials-file"],
        profile: values.profile,
      }),
    );
    writeSuccess({
      command: "pms upload preview",
      data: { mode: "preview", mutation: false, ...preview },
      text: formatPmsUploadPreview(preview),
    }, output);
    return;
  }
  if (command === "upload" && positionals[2] === "apply" && positionals.length === 3) {
    const filePath = required(values.file, "--file");
    if (!values.confirm) {
      throw new ConfirmationRequiredError(
        "PMS print upload",
        "PMS print upload adds a remote queue entry. Re-run the exact previewed command with --confirm.",
      );
    }
    const expectedSha256 = blackboardExpectedSha256(required(values["expected-sha256"], "--expected-sha256"));
    const payload = await readPmsUploadPayload(filePath);
    const file = payload.file;
    if (file.sha256 !== expectedSha256) {
      throw new CliError(
        "The selected file no longer matches the reviewed preview hash. Re-run preview before uploading.",
        "PMS_UPLOAD_FILE_HASH_MISMATCH",
        4,
        {
          file: file.absolutePath,
          expectedSha256,
          actualSha256: file.sha256,
        },
      );
    }
    const options = pmsUploadOptions(values);
    const session = await pmsService(values);
    const previousJobs = await listPmsPrintJobs(session);
    const preflight = buildPmsPrintUploadPreview(
      previousJobs,
      file,
      options,
      buildPmsUploadApplyConfirmation(file.absolutePath, file.sha256, options, {
        credentialsFile: values["credentials-file"],
        profile: values.profile,
      }),
    );
    try {
      const mutation = await session.uploadPrintJob({ name: file.name, bytes: payload.bytes }, options);
      const readBackJobs = await bestEffortPmsPrintJobs(session);
      const verification = readBackJobs
        ? verifyPmsPrintUpload(previousJobs, readBackJobs, file, options)
        : { status: "unavailable" as const, message: "The print queue could not be read back after the upload request.", observedJobIds: [] };
      const observedJob = readBackJobs?.find((job) => verification.observedJobIds[0] === job.jobId);
      if (verification.status !== "confirmed") {
        throw new CliError(
          "PMS accepted the upload request, but the read-back verification was inconclusive.",
          "PMS_UPLOAD_NOT_CONFIRMED",
          5,
          {
            file: file.absolutePath,
            options,
            uploadMessage: mutation.message,
            verification,
            warning: "DO_NOT_RETRY_AUTOMATICALLY",
          },
        );
      }
      writeSuccess({
        command: "pms upload apply",
        data: {
          mode: "apply",
          mutation: true,
          file,
          options,
          preflight: {
            checkedAt: preflight.checkedAt,
            queueSize: previousJobs.length,
          },
          ...(observedJob ? { job: observedJob } : {}),
          verification,
          uploadMessage: mutation.message,
        },
        text: formatPmsUploadSuccess({ job: observedJob, verification }),
      }, output);
      return;
    } catch (error) {
      const readBackJobs = await bestEffortPmsPrintJobs(session);
      const verification = readBackJobs
        ? verifyPmsPrintUpload(previousJobs, readBackJobs, file, options)
        : { status: "unavailable" as const, message: "The print queue could not be read back after the upload request failed.", observedJobIds: [] };
      const observedJob = readBackJobs?.find((job) => verification.observedJobIds[0] === job.jobId);
      if (verification.status === "confirmed") {
        writeSuccess({
          command: "pms upload apply",
          data: {
            mode: "apply",
            mutation: true,
            file,
            options,
            ...(observedJob ? { job: observedJob } : {}),
            verification,
            recoveredAfterError: true,
          },
          text: formatPmsUploadSuccess({ job: observedJob, verification }),
          meta: { recoveredAfterError: true },
        }, output);
        return;
      }
      if (isPmsMutationOutcomeUncertain(error)) {
        throw new CliError(
          "PMS print upload outcome is uncertain. Do not retry automatically.",
          "PMS_UPLOAD_OUTCOME_UNKNOWN",
          5,
          {
            file: file.absolutePath,
            options,
            verification,
            cause: error instanceof Error ? error.message : String(error),
            warning: "DO_NOT_RETRY_AUTOMATICALLY",
          },
        );
      }
      throw error;
    }
  }
  if (command === "delete" && positionals[2] === "preview" && positionals.length === 4) {
    const jobId = pmsJobId(positionals[3]);
    const session = await pmsService(values);
    const jobs = await listPmsPrintJobs(session);
    const job = requirePmsPrintJob(jobs, jobId);
    const preview = buildPmsPrintDeletePreview(
      jobs,
      job,
      buildPmsDeleteApplyConfirmation(jobId, {
        credentialsFile: values["credentials-file"],
        profile: values.profile,
      }),
    );
    writeSuccess({
      command: "pms delete preview",
      data: { mode: "preview", mutation: false, ...preview },
      text: formatPmsDeletePreview(preview),
    }, output);
    return;
  }
  if (command === "delete" && positionals[2] === "apply" && positionals.length === 4) {
    const jobId = pmsJobId(positionals[3]);
    if (!values.confirm) {
      throw new ConfirmationRequiredError(
        "PMS print-job deletion",
        "PMS print-job deletion removes a queued remote document. Re-run the exact previewed command with --confirm.",
      );
    }
    const session = await pmsService(values);
    const previousJobs = await listPmsPrintJobs(session);
    const job = requirePmsPrintJob(previousJobs, jobId);
    try {
      const mutation = await session.deletePrintJob(jobId);
      const readBackJobs = await bestEffortPmsPrintJobs(session);
      const verification = readBackJobs
        ? verifyPmsPrintDeletion(readBackJobs, jobId)
        : { status: "unavailable" as const, message: "The print queue could not be read back after the delete request.", observedJobIds: [] };
      if (verification.status !== "confirmed") {
        throw new CliError(
          "PMS accepted the delete request, but the read-back verification was inconclusive.",
          "PMS_DELETE_NOT_CONFIRMED",
          5,
          {
            jobId,
            deleteMessage: mutation.message,
            verification,
            warning: "DO_NOT_RETRY_AUTOMATICALLY",
          },
        );
      }
      writeSuccess({
        command: "pms delete apply",
        data: {
          mode: "apply",
          mutation: true,
          job,
          verification,
          deleteMessage: mutation.message,
        },
        text: formatPmsDeleteSuccess({ job, verification }),
      }, output);
      return;
    } catch (error) {
      const readBackJobs = await bestEffortPmsPrintJobs(session);
      const verification = readBackJobs
        ? verifyPmsPrintDeletion(readBackJobs, jobId)
        : { status: "unavailable" as const, message: "The print queue could not be read back after the delete request failed.", observedJobIds: [] };
      if (verification.status === "confirmed") {
        writeSuccess({
          command: "pms delete apply",
          data: {
            mode: "apply",
            mutation: true,
            job,
            verification,
            recoveredAfterError: true,
          },
          text: formatPmsDeleteSuccess({ job, verification }),
          meta: { recoveredAfterError: true },
        }, output);
        return;
      }
      if (isPmsMutationOutcomeUncertain(error)) {
        throw new CliError(
          "PMS print-job deletion outcome is uncertain. Do not retry automatically.",
          "PMS_DELETE_OUTCOME_UNKNOWN",
          5,
          {
            jobId,
            verification,
            cause: error instanceof Error ? error.message : String(error),
            warning: "DO_NOT_RETRY_AUTOMATICALLY",
          },
        );
      }
      throw error;
    }
  }
  throw usageError(`Unknown command: ${positionals.join(" ")}`);
}

function pmsUploadOptions(values: Values): PmsPrintUploadOptions {
  const color = pmsColorValue(values.color);
  const paper = pmsPaperValue(values.paper);
  const duplex = pmsDuplexValue(values.duplex);
  const copies = parsePositiveInteger(values.copies, 1, "--copies");
  const pageFrom = parseNonNegativeInteger(values["page-from"], 0, "--page-from");
  if (pageFrom === 0 && values["page-to"] !== undefined) {
    throw usageError("--page-to requires --page-from.");
  }
  const pageTo = pageFrom === 0 ? 0 : parsePositiveInteger(values["page-to"], pageFrom, "--page-to");
  if (pageFrom > 0 && pageTo < pageFrom) throw usageError("--page-to must be greater than or equal to --page-from.");
  return {
    ...color,
    ...paper,
    ...duplex,
    copies,
    pageFrom,
    pageTo,
  };
}

function pmsColorValue(value: string | undefined): Pick<PmsPrintUploadOptions, "color" | "colorCode"> {
  const normalized = (value ?? "bw").trim().toLowerCase();
  if (normalized === "bw" || normalized === "blackwhite" || normalized === "black-white" || normalized === "1" || normalized === "黑白") {
    return { color: "bw", colorCode: 1 };
  }
  if (normalized === "color" || normalized === "2" || normalized === "彩色") {
    return { color: "color", colorCode: 2 };
  }
  throw usageError("--color must be bw or color.");
}

function pmsPaperValue(value: string | undefined): Pick<PmsPrintUploadOptions, "paper" | "paperCode"> {
  const normalized = (value ?? "unspecified").trim().toLowerCase();
  if (normalized === "unspecified" || normalized === "" || normalized === "-1" || normalized === "不指定") {
    return { paper: "unspecified", paperCode: -1 };
  }
  if (normalized === "a4" || normalized === "9") return { paper: "A4", paperCode: 9 };
  if (normalized === "a3" || normalized === "8") return { paper: "A3", paperCode: 8 };
  throw usageError("--paper must be unspecified, A4, or A3.");
}

function pmsDuplexValue(value: string | undefined): Pick<PmsPrintUploadOptions, "duplex" | "duplexCode"> {
  const normalized = (value ?? "single").trim().toLowerCase();
  if (normalized === "single" || normalized === "1" || normalized === "单面") return { duplex: "single", duplexCode: 1 };
  if (normalized === "short" || normalized === "short-edge" || normalized === "2" || normalized === "双面短边") {
    return { duplex: "short", duplexCode: 2 };
  }
  if (normalized === "long" || normalized === "long-edge" || normalized === "3" || normalized === "双面长边") {
    return { duplex: "long", duplexCode: 3 };
  }
  throw usageError("--duplex must be single, short, or long.");
}

function buildPmsUploadApplyConfirmation(
  absolutePath: string,
  expectedSha256: string,
  options: PmsPrintUploadOptions,
  metadata: { credentialsFile?: string; profile?: string } = {},
): { required: true; available: true; expectedSha256: string; argv: string[]; command: string } {
  const argv = [
    "sustech",
    "pms",
    "upload",
    "apply",
    ...(metadata.credentialsFile ? ["--credentials-file", metadata.credentialsFile] : []),
    ...(metadata.profile ? ["--profile", metadata.profile] : []),
    "--file",
    absolutePath,
    "--expected-sha256",
    expectedSha256,
    "--color",
    options.color,
    "--paper",
    options.paper,
    "--duplex",
    options.duplex,
    ...(options.pageFrom > 0 ? ["--page-from", String(options.pageFrom), "--page-to", String(options.pageTo)] : []),
    "--copies",
    String(options.copies),
    "--confirm",
  ];
  return {
    required: true,
    available: true,
    expectedSha256,
    argv,
    command: argv.map(shellQuote).join(" "),
  };
}

function buildPmsDeleteApplyConfirmation(
  jobId: number,
  metadata: { credentialsFile?: string; profile?: string } = {},
): { required: true; available: true; argv: string[]; command: string } {
  const argv = [
    "sustech",
    "pms",
    "delete",
    "apply",
    ...(metadata.credentialsFile ? ["--credentials-file", metadata.credentialsFile] : []),
    ...(metadata.profile ? ["--profile", metadata.profile] : []),
    String(jobId),
    "--confirm",
  ];
  return {
    required: true,
    available: true,
    argv,
    command: argv.map(shellQuote).join(" "),
  };
}

async function bestEffortPmsPrintJobs(session: PmsSession): Promise<Awaited<ReturnType<typeof listPmsPrintJobs>> | undefined> {
  try {
    return await listPmsPrintJobs(session);
  } catch {
    return undefined;
  }
}

function pmsJobId(value: string | undefined): number {
  return parsePositiveInteger(value, 1, "PMS job ID");
}

function requirePmsPrintJob(jobs: readonly Awaited<ReturnType<typeof listPmsPrintJobs>>[number][], jobId: number) {
  const job = findPmsPrintJob(jobs, jobId);
  if (job) return job;
  throw new CliError(
    "The requested PMS print job was not found in the current queue.",
    "PMS_PRINT_JOB_NOT_FOUND",
    4,
    {
      jobId,
      warning: "NO_MUTATION_PERFORMED",
      availableJobIds: jobs.map((entry) => entry.jobId),
    },
  );
}

function isPmsMutationOutcomeUncertain(error: unknown): boolean {
  if (!(error instanceof CliError)) return false;
  return error.code === "NETWORK_ERROR"
    || error.code === "NETWORK_TIMEOUT"
    || error.code === "TOO_MANY_REDIRECTS"
    || (error.code === "SERVICE_HTTP_ERROR" && Number(error.details?.status) >= 500);
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

function validateCommandOptions(command: string, argv: readonly string[]): void {
  if (!CAPABILITIES.some((entry) => entry.command === command) && command !== "describe") return;
  const allowed = new Set(COMMAND_OPTIONS[command] ?? []);
  if (allowed.has("credentials-file")) allowed.add("profile");
  for (const option of suppliedOptionNames(argv)) {
    if (SHARED_OUTPUT_OPTION_NAMES.includes(option as typeof SHARED_OUTPUT_OPTION_NAMES[number]) || allowed.has(option as CliOptionName)) continue;
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

interface CommandDescription {
  command: string;
  found: boolean;
  usage: string[];
  options: Array<{ name: string; type: "string" | "boolean"; multiple: boolean; shared: boolean }>;
  capability?: (typeof CAPABILITIES)[number];
  consequences: Array<{ operation: string; severity: string; irreversible: boolean; verification: string }>;
}

function runDescribe(
  positionals: string[],
  output: ReturnType<typeof resolveOutputOptions>,
): void {
  const targetArgv = positionals.slice(1);
  if (targetArgv.length === 0) throw usageError("Usage: sustech describe COMMAND...");
  const command = inferCommandName(targetArgv);
  const capability = CAPABILITIES.find((entry) => entry.command === command);
  if (!capability) throw usageError(`Unknown command to describe: ${targetArgv.join(" ")}`);
  const description: CommandDescription = {
    command,
    found: true,
    usage: commandUsageLines(command),
    options: commandOptionDescriptions(command),
    capability,
    consequences: describeConsequencesForCommand(command),
  };
  writeSuccess({
    command: "describe",
    data: description,
    text: formatCommandDescription(description),
    items: description.options,
    summary: {
      command: description.command,
      options: description.options.length,
      consequences: description.consequences.length,
      usageLines: description.usage.length,
    },
  }, output);
}

function commandUsageLines(command: string): string[] {
  const usageLines = HELP.split("\n").slice(3);
  const prefix = `  sustech ${command}`;
  const start = usageLines.findIndex((line) => line.startsWith(prefix));
  if (start < 0) return [`sustech ${command}`];
  const collected: string[] = [];
  for (let index = start; index < usageLines.length; index += 1) {
    const line = usageLines[index];
    if (!line) break;
    if (index > start && line.startsWith("  sustech ")) break;
    if (index > start && !line.startsWith("    ")) break;
    collected.push(line.trimEnd());
  }
  return collected.map((line) => line.trim());
}

function commandOptionDescriptions(command: string): CommandDescription["options"] {
  const specific = [...(COMMAND_OPTIONS[command] ?? [])]
    .sort((left, right) => left.localeCompare(right))
    .map((name) => ({
      name: `--${name}`,
      type: CLI_PARSE_OPTIONS[name].type,
      multiple: Boolean("multiple" in CLI_PARSE_OPTIONS[name] && CLI_PARSE_OPTIONS[name].multiple),
      shared: false,
    }));
  const shared = SHARED_OUTPUT_OPTION_NAMES.map((name) => ({
    name: `--${name}`,
    type: CLI_PARSE_OPTIONS[name].type,
    multiple: false,
    shared: true,
  }));
  return [...specific, ...shared];
}

function describeConsequencesForCommand(command: string): CommandDescription["consequences"] {
  return commandConsequenceOperations(command)
    .map((operation) => consequenceByOperation(operation))
    .filter((entry): entry is NonNullable<ReturnType<typeof consequenceByOperation>> => entry !== undefined)
    .map((entry) => ({
      operation: entry.operation,
      severity: entry.severity,
      irreversible: entry.irreversible,
      verification: entry.verification,
    }));
}

function commandConsequenceOperations(command: string): string[] {
  const direct: Partial<Record<string, readonly string[]>> = {
    "auth login": ["credentials.store"],
    "auth logout": ["credentials.delete"],
    "profile export": ["profile.export"],
    "academic snapshot save": ["academic.snapshot.save"],
    "academic watch": ["academic.snapshot.save"],
    "tis ical": ["tis.ical.export"],
    "tis enroll apply": ["tis.enroll"],
    "tis bid apply": ["tis.bid"],
    "bb download": ["blackboard.download"],
    "bb sync": ["blackboard.sync"],
    "bb calendar-link set": ["blackboard.calendar-link.store"],
    "bb calendar-link fetch": ["blackboard.calendar-link.fetch"],
    "bb calendar-link delete": ["blackboard.calendar-link.delete"],
    "bb submit apply": ["blackboard.submit"],
    "booking create apply": ["booking.create"],
    "booking cancel apply": ["booking.cancel"],
    "lib-booking create apply": ["library-booking.create"],
    "lib-booking cancel apply": ["library-booking.cancel"],
    "pms upload apply": ["pms.upload"],
    "pms delete apply": ["pms.delete"],
  };
  if (command === "tis selection apply") return ["tis.cart.update", "tis.drop", "tis.bid"];
  return [...(direct[command] ?? [])];
}

function formatCommandDescription(description: CommandDescription): string {
  const lines = [
    `Command description · ${description.command}`,
    `Kind ${description.capability?.kind ?? "local"} · auth ${description.capability?.authentication ?? "none"} · confirmation ${description.capability?.confirmation ?? "none"} · ${description.capability?.network ? "network" : "local"}${description.capability?.status === "preview" ? " · preview" : ""}`,
  ];
  if (description.capability?.summary) lines.push(description.capability.summary);
  lines.push("Usage:");
  lines.push(...description.usage.map((line) => `  ${line}`));
  if (description.options.length > 0) {
    lines.push("Options:");
    lines.push(...description.options.map((option) => `  ${option.name} [${option.type}${option.multiple ? ", multiple" : ""}${option.shared ? ", shared" : ""}]`));
  }
  if (description.consequences.length > 0) {
    lines.push("Consequences:");
    lines.push(...description.consequences.map((entry) => `  ${entry.operation} [${entry.severity}${entry.irreversible ? ", irreversible" : ""}]`));
  }
  return lines.join("\n");
}

function bookingCreateTarget(values: Values): {
  roomId: string;
  title: string;
  start: string;
  end: string;
  participants: number;
  description?: string;
} {
  return {
    roomId: opaqueToken(required(values["room-id"], "--room-id"), "--room-id"),
    title: inlineText(required(values.title, "--title"), "--title", 160),
    start: localDateTime(required(values.start, "--start"), "--start"),
    end: localDateTime(required(values.end, "--end"), "--end"),
    participants: parsePositiveInteger(values.participants, 1, "--participants"),
    description: optionalInlineText(values.description, "--description", 500),
  };
}

function bookingCancelTarget(values: Values): { meetingId: string } {
  return {
    meetingId: opaqueToken(required(values["meeting-id"], "--meeting-id"), "--meeting-id"),
  };
}

function libraryBookingCreateTarget(values: Values): {
  classKind: number;
  kindId: number;
  labId: number;
  devId: number;
  title: string;
  start: string;
  end: string;
  memberKind: 1 | 2;
  members: number[];
  memo?: string;
} {
  return {
    classKind: parsePositiveInteger(values["class-kind"], 1, "--class-kind"),
    kindId: parsePositiveInteger(required(values["kind-id"], "--kind-id"), 1, "--kind-id"),
    labId: parsePositiveInteger(required(values["lab-id"], "--lab-id"), 1, "--lab-id"),
    devId: parsePositiveInteger(required(values["dev-id"], "--dev-id"), 1, "--dev-id"),
    title: inlineText(required(values.title, "--title"), "--title", 160),
    start: localDateTime(required(values.start, "--start"), "--start"),
    end: localDateTime(required(values.end, "--end"), "--end"),
    memberKind: memberKindValue(values["member-kind"]),
    members: (values.member ?? []).map((value) => parsePositiveInteger(value, 1, "--member")),
    memo: optionalInlineText(values.memo, "--memo", 500),
  };
}

function libraryBookingCancelTarget(values: Values): { reservationId: number } {
  return {
    reservationId: parsePositiveInteger(required(values["reservation-id"], "--reservation-id"), 1, "--reservation-id"),
  };
}

function opaqueToken(value: string, option: string): string {
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(value)) {
    throw usageError(`${option} contains unsupported characters.`);
  }
  return value;
}

function inlineText(value: string, option: string, maxLength: number): string {
  const text = value.trim();
  if (!text) throw usageError(`${option} cannot be empty.`);
  if (text.length > maxLength) throw usageError(`${option} cannot exceed ${maxLength} characters.`);
  if (/[\u0000-\u001f\u007f]/.test(text)) throw usageError(`${option} cannot contain control characters.`);
  return text;
}

function optionalInlineText(value: string | undefined, option: string, maxLength: number): string | undefined {
  if (value === undefined) return undefined;
  const text = value.trim();
  if (!text) return undefined;
  if (text.length > maxLength) throw usageError(`${option} cannot exceed ${maxLength} characters.`);
  if (/[\u0000-\u001f\u007f]/.test(text)) throw usageError(`${option} cannot contain control characters.`);
  return text;
}

function localDateTime(value: string, option: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) throw usageError(`${option} must be YYYY-MM-DDTHH:MM or YYYY-MM-DDTHH:MM:SS.`);
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText ?? "00");
  const parsed = new Date(`${yearText}-${monthText}-${dayText}T${hourText}:${minuteText}:${String(second).padStart(2, "0")}+08:00`);
  if (
    Number.isNaN(parsed.getTime())
    || month < 1
    || month > 12
    || day < 1
    || day > 31
    || hour > 23
    || minute > 59
    || second > 59
  ) {
    throw usageError(`${option} must be a valid local date-time.`);
  }
  const check = new Date(`${yearText}-${monthText}-${dayText}T${hourText}:${minuteText}:${String(second).padStart(2, "0")}Z`);
  if (
    check.getUTCFullYear() !== year
    || check.getUTCMonth() + 1 !== month
    || check.getUTCDate() !== day
    || check.getUTCHours() !== hour
    || check.getUTCMinutes() !== minute
    || check.getUTCSeconds() !== second
  ) {
    throw usageError(`${option} must be a valid local date-time.`);
  }
  return `${yearText}-${monthText}-${dayText}T${hourText}:${minuteText}:${String(second).padStart(2, "0")}`;
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

function parseIntegerInRange(value: string | undefined, option: string, minimum: number, maximum: number): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw usageError(`${option} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function parsePlanPreferenceFlags(values: Values): {
  earlyPeriodThreshold?: number;
  weights?: {
    earlySession?: number;
    gapSegment?: number;
    gapPeriod?: number;
    distinctWeekday?: number;
    campusSwitch?: number;
  };
} | undefined {
  const earlyPeriodThreshold = parseIntegerInRange(values["early-period-threshold"], "--early-period-threshold", 1, 13);
  const weights = {
    earlySession: parseIntegerInRange(values["weight-early-session"], "--weight-early-session", 0, 100),
    gapSegment: parseIntegerInRange(values["weight-gap-segment"], "--weight-gap-segment", 0, 100),
    gapPeriod: parseIntegerInRange(values["weight-gap-period"], "--weight-gap-period", 0, 100),
    distinctWeekday: parseIntegerInRange(values["weight-distinct-weekday"], "--weight-distinct-weekday", 0, 100),
    campusSwitch: parseIntegerInRange(values["weight-campus-switch"], "--weight-campus-switch", 0, 100),
  };
  const hasWeights = Object.values(weights).some((value) => value !== undefined);
  if (earlyPeriodThreshold === undefined && !hasWeights) return undefined;
  return {
    ...(earlyPeriodThreshold !== undefined ? { earlyPeriodThreshold } : {}),
    ...(hasWeights ? { weights } : {}),
  };
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

function blackboardCalendarItemType(value: string | undefined): BlackboardCalendarItemType | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  const types: Readonly<Record<string, BlackboardCalendarItemType>> = {
    course: "Course",
    gradebookcolumn: "GradebookColumn",
    institution: "Institution",
    officehours: "OfficeHours",
    personal: "Personal",
  };
  const type = types[normalized];
  if (!type) {
    throw usageError("--type must be Course, GradebookColumn, Institution, OfficeHours, or Personal.");
  }
  return type;
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

function memberKindValue(value: string | undefined): 1 | 2 {
  if (value === undefined || value === "1") return 1;
  if (value === "2") return 2;
  throw usageError("--member-kind must be 1 or 2.");
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

function todayInShenzhen(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
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
