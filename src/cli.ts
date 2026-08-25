#!/usr/bin/env node
import { parseArgs } from "node:util";
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
  formatVersion,
} from "./core/text.js";
import { TisSession } from "./tis/auth.js";
import { TisClient } from "./tis/client.js";

const VERSION = "0.1.0";

const HELP = `sustech — SUSTech services for humans and agents

Usage:
  sustech version [--json|--jsonl]
  sustech auth check [--credentials-file PATH] [--json|--jsonl]
  sustech tis courses search [KEYWORD] [--semester YYYY-YYYY-N] [--limit N] [--refresh]
  sustech tis courses available [KEYWORD] --round ROUND [--semester YYYY-YYYY-N] [--limit N]
  sustech tis enrolled [--semester YYYY-YYYY-N]
  sustech tis enroll preview --course-id TIS_ID --rwh TASK_ID [--round ROUND] [--bid N]
  sustech tis enroll apply --course-id TIS_ID --rwh TASK_ID [--round ROUND] [--bid N] --confirm

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
  help?: boolean;
};

async function main(argv: string[]): Promise<void> {
  const parsed = parseArgs({
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
      output: { type: "string" },
      json: { type: "boolean", default: false },
      jsonl: { type: "boolean", default: false },
      pretty: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  const values = parsed.values as Values;
  if (values.help || parsed.positionals.length === 0) {
    process.stdout.write(HELP);
    return;
  }
  const output = resolveOutputOptions(values);
  const [group, command, operation, keyword] = parsed.positionals;

  if (group === "version") {
    const data = { version: VERSION, runtime: `node ${process.version}` };
    writeSuccess({ command: "version", data, text: formatVersion(VERSION, data.runtime) }, output);
    return;
  }
  if (group === "auth" && command === "check") {
    const { session, credentialSource } = await authenticatedSession(values);
    await session.login();
    const data = { authenticated: true, service: "tis", credentialSource, credentialsStored: false };
    writeSuccess({ command: "auth check", data, text: formatAuthCheck(credentialSource) }, output);
    return;
  }
  if (group !== "tis") throw usageError(`Unknown command: ${parsed.positionals.join(" ")}`);

  const semester = parseSemester(values.semester);
  if (command === "courses" && operation === "search") {
    const client = await tisClient(values);
    const limit = parsePositiveInteger(values.limit, 50, "--limit");
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
    const round = required(values.round, "--round");
    const client = await tisClient(values);
    const limit = parsePositiveInteger(values.limit, 50, "--limit");
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
  if (command === "enroll" && operation === "preview") {
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
  if (command === "enroll" && operation === "apply") {
    if (!values.confirm) throw new ConfirmationRequiredError("Enrollment");
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
    const data = { mutation: true, action: "enroll", target, result };
    writeSuccess({
      command: "tis enroll apply",
      data,
      text: formatEnrollSuccess(target.rwh, result.message),
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

function enrollTarget(values: Values, semester: ReturnType<typeof parseSemester>) {
  const courseId = required(values["course-id"], "--course-id");
  const rwh = required(values.rwh, "--rwh");
  const bid = parsePositiveInteger(values.bid, 1, "--bid");
  const round = values.round ?? "yixuan";
  return { semester, courseId, rwh, bid, round, cultivation: "1" as const };
}

function required(value: string | undefined, option: string): string {
  if (!value?.trim()) throw usageError(`${option} is required.`);
  return value.trim();
}

function parsePositiveInteger(value: string | undefined, fallback: number, option: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw usageError(`${option} must be a positive integer.`);
  return parsed;
}

function usageError(message: string): CliError {
  return new CliError(message, "USAGE", 2, { help: "Run `sustech --help` for usage." });
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const argv = process.argv.slice(2);
  const command = argv.filter((argument) => !argument.startsWith("-")).slice(0, 3).join(" ") || "unknown";
  process.exitCode = writeError(error, command, inferOutputOptions(argv));
});
