---
name: sustech-cli
description: Use the installed sustech CLI for SUSTech campus reads, planning, guarded exports, and confirm-gated workflows across TIS, Blackboard, profile/context, booking, library booking, PMS, transit, faculty, papers, NCES, and selected SUSTech Online public information. Do not use for unrelated universities or invent commands the installed CLI does not report.
---

# SUSTech CLI

Use `sustech` as the source of truth for supported SUSTech operations. Prefer an
existing CLI command over reimplementing a request with browser scraping or
private endpoints.

## Discover the installed surface

Start with the installed version and structured registries:

```bash
sustech version --json
sustech capabilities --json
sustech consequences --json
```

Re-query `capabilities` instead of relying on a memorized command list. It
declares each command's summary, kind, network use, authentication
requirement, confirmation requirement, and status for the installed version.

If `sustech` is not on `PATH`, report that fact. Ask before installing it with
`npm install --global sustech-cli`; do not assume a source checkout is needed.

## Route common requests

Use exact command names from `capabilities`. The installed surface currently
includes these high-value areas:

- Public context and campus info: `calendar terms`, `calendar day`, `context`,
  `resources list`, `resources search`, `wifi status`, `wifi events`,
  `faculty departments`, `faculty list`, `faculty get`, `faculty search`,
  `faculty render`, `transit facilities`, `transit find`, `transit lines`,
  `transit schedule`, `transit stops`, `transit live`, `online search`,
  `online talks list/search/get`, `online contact search/get`.
- Academic profile and audits: `profile show`, `profile export`,
  `academic snapshot save`, `academic changes`, `academic watch`, `doctor`.
- Research helpers: `papers search`, `papers fetch-oa`, `nces browse`,
  `nces search`, `nces course`.
- Blackboard: `bb user`, `bb courses`, `bb content`, `bb attachments`,
  `bb assignments`, `bb deadlines`, `bb calendar`, `bb search`,
  `bb attempts`, `bb download`, `bb sync`, `bb submit preview`,
  `bb submit apply`, `bb calendar-link set/show/fetch/delete`.
- TIS reads and planning: `tis courses search`, `tis courses available`,
  `tis enrolled`, `tis schedule`, `tis grades`, `tis exams`,
  `tis timetable`, `tis plan init/show/add/remove/solve/explain/recommend`,
  `tis classroom rooms/occupancy/free/live/now`, `tis evals`,
  `tis ical`, `tis degree progress`, `tis degree missing`,
  `tis degree audit`.
- TIS writes: `tis selection preview/apply` for `cart`, `drop`, and `bid`
  style operations, read-only `tis selection reconcile`, `tis bid plan`, `tis
  bid apply`, `tis enroll preview`, `tis enroll apply`.
- Other authenticated campus services: `ws programs`, `ws detail`,
  `library search`, `library detail`, `booking whoami`, `booking rooms`,
  `booking my-meetings`, `booking create preview/apply`,
  `booking cancel preview/apply`, `lib-booking whoami`,
  `lib-booking home-summary`, `lib-booking labs`, `lib-booking rooms`,
  `lib-booking reservation-count`, `lib-booking reservations`,
  `lib-booking create preview/apply`, `lib-booking cancel preview/apply`,
  `pms check`, `pms server-groups`, `pms stations`, `pms jobs`,
  `pms scan-jobs`, `pms usage`, `pms upload preview/apply`,
  `pms delete preview/apply`.

Some useful routing hints:

- For “what is due soon”, prefer `bb deadlines` and optionally
  `context --live --level normal` or `context --live --level verbose`.
- For Blackboard timeline questions, prefer `bb calendar` when you need typed
  `--since`/`--until`/`--type`/`--course-id` filtering.
- For “find a Blackboard file/course item”, prefer `bb search` before scraping.
- For timetable exploration, prefer `tis timetable` for one-off solving and
  `tis plan *` for persistent local planning.
- `tis plan explain` and `tis plan recommend` are read-only planning helpers.
  Use them to explain timetable fit, seat observations, and conservative
  degree relevance for a round without adding courses or performing any TIS
  write. Treat NCES as community reference only, never as official degree or
  prerequisite authority, and keep ambiguous degree matches in manual review.
- For “how close am I to graduation”, use `tis degree progress` for the
  personalized TIS-reported summary. For “which courses am I still missing”,
  use `tis degree missing --json`, preserve its separation between definite
  required courses, in-progress courses, choice gaps, and `manualReview`, and
  never turn a choice gap into a unique course recommendation. `tis degree
  audit` instead requires a user-supplied local JSON requirements file. Treat
  every degree result as advisory: preserve `report.advisory`, use the
  applicable official cultivation plan as the primary reference, and direct
  discrepancies or uncertainty to the department secretary or Teaching Affairs
  Office. Never describe TIS as the final authority.
- Distinguish calendar export from subscription: `tis ical` produces a static
  ICS snapshot; `bb calendar` is an authenticated REST read; and
  `bb calendar-link` manages Blackboard's native shared ICS link, which is a
  long-lived secret stored in the OS credential store and masked by default.
- `academic watch --state PATH` is a one-shot local workflow: read, compare,
  print, and update the named state file once. It does not schedule itself,
  does not loop, and does not write remote campus state.
- For room availability, distinguish catalog-backed `tis classroom *` from
  live `tis classroom live/now`.
- `library search` and `library detail` are read-only Primo catalog commands.
  Use `--browser` or `--browser --interactive` when the direct public HTTP path
  cannot complete on the current host. Browser auth stays manual.
- Treat every `online` result as community-maintained. Preserve its source URL,
  repository path, fetch/update times, CC BY-SA license, and advisories. Talk
  records may be model-processed. The selected contact surface deliberately
  excludes emergency, medical/crisis, financial/bank, personal, dining/chat,
  QQ-group, and professor-email-list sections; do not use it as an emergency
  directory or invent excluded records. Recheck consequential contact or event
  details against the linked official source.

## Use the local MCP surface when present

Some installations expose `sustech-mcp` as a local `stdio` server. It requires
no hosted service and provides a stable typed allowlist plus JSON resources and
prompts. Start with `sustech_discover`, `sustech_describe`, or the
`sustech://mcp/policy` resource. Then prefer the dedicated public tools for
calendar, resources, services status, papers, NCES, library, faculty, transit,
and `sustech_online_*` when their schemas match the request.

There is intentionally no generic MCP shell/run tool and no MCP mutation tool.
Do not try to route `auth login`, `* apply`, exports/downloads, persistent TIS
plan edits, confirmation flags, secret reveal, credentials files, or
interactive browser flows through MCP. MCP also excludes authenticated personal
data plus local/private machine state such as Wi-Fi and live Context. Use the
direct CLI and the approval workflow below when state must change.

## Consume output safely

- Pass `--json` for one structured result and `--jsonl` for record streams.
- Treat the process exit status as authoritative, then inspect `ok`, `error`,
  `meta`, and `schemaVersion` in the output envelope.
- Do not parse human-readable text when a JSON mode is available.
- Preserve IDs exactly as returned; Blackboard and TIS IDs are opaque strings.
- For `tis courses available`, consume `data.bundles`, count bundle credits
  once, include every required component, and use only its documented
  `operationTargets`. `courseId` becomes upstream `p_id`; `rwh` identifies the
  exact component for read-back. Never guess one from the other.
- Planning output is minimum-data by default. `tis degree missing` is
  grade-free, and course grades in `tis degree progress` require an explicit
  `--details`; do not request details when summary/category/module evidence is
  sufficient.

## Handle credentials

- Never ask the user to paste a password, token, cookie, or one-time code into
  chat or a visible command argument.
- On a local desktop, let the user run `sustech auth login`; it uses a hidden
  prompt and the operating system's native credential store.
- Treat Blackboard calendar links like passwords: use
  `sustech bb calendar-link set --url-stdin`, keep `show` masked by default,
  and use `--reveal` only when the full link is explicitly required.
- In headless automation, use credentials supplied by the user's existing
  secret manager through the documented environment or credentials-file
  mechanism. Never create a plaintext fallback.
- Use `sustech auth status --json` and the appropriate read-only
  `sustech auth check --service ... --json` before a workflow that needs login.
- On Linux, a locked Secret Service collection or missing desktop D-Bus session
  is not evidence that credentials expired. Follow the structured
  `remediation`, keep profile metadata intact, and retry only after the same
  graphical login collection is unlocked.
- Use `--profile` when the task depends on a specific account identity.
- If CAS returns `CAS_INTERACTIVE_CHALLENGE_REQUIRED`, report that the password
  was not submitted and stop. Do not bypass, solve, or repeatedly retry the
  interactive challenge.
- For Primo browser mode, never ask the user to paste a browser username,
  password, cookie, or token. If CAS appears in the browser path, the user
  completes it manually. Do not solve CAPTCHAs and do not persist browser
  cookies.

## Guard remote mutations

Read and plan commands may run when they are necessary to answer the request.
For commands whose remote-state mutation requires confirmation, keep the exact
target stable across preview, approval, apply, and read-back verification:

1. Resolve and show the exact target and consequence.
2. Run the corresponding preview or other read-only preflight.
3. Obtain explicit user approval for that exact operation.
4. Add `--confirm` only after approval.
5. Perform the documented read-back verification.

A preview does not authorize an apply. Never infer consent from a general wish
such as "help me choose courses" or "handle this assignment."

The main confirm-gated flows are:

- `tis selection apply` for exact `cart`, `drop`, or single-course `bid`
  operations after `tis selection preview`.
- `tis bid apply` after `tis bid plan`.
- `tis enroll apply` after `tis enroll preview`.
- `bb submit apply` after `bb submit preview`.
- `booking create apply` and `booking cancel apply` after the matching preview.
- `lib-booking create apply` and `lib-booking cancel apply` after the matching
  preview.
- `pms upload apply` and `pms delete apply` after the matching preview.

Important command-specific rules:

- `tis enroll preview`, `tis selection preview`, and `tis bid plan` are local
  planners; they do not authenticate or write.
- `bb submit preview` is authenticated but read-only.
- Booking, library-booking, and PMS preview commands are live read-only checks,
  not reservations, cancellations, uploads, or deletions.
- Booking and library-booking create previews now attempt exact slot
  availability checks first. If the live evidence is missing, malformed, or
  ambiguous, stop and fail closed instead of guessing that the slot is free.
- Preserve opaque IDs exactly: TIS course IDs and `rwh`, Blackboard course,
  content, column, and attachment IDs, booking meeting IDs, library reservation
  IDs, and PMS job IDs.
- For TIS drop, treat the consequence as high risk: the released seat may not
  be recoverable.
- For file-bound applies such as Blackboard submission and PMS upload, preserve
  the exact previewed SHA-256 into apply.
- If a result is ambiguous or contains `DO_NOT_RETRY_AUTOMATICALLY`, stop and
  report it; do not retry the mutation automatically. For a TIS selection
  timeout, run bounded `tis selection reconcile OP` with the exact
  `courseId`/`rwh`/round from the error. Its `applied`, `not_applied`, or
  `still_uncertain` result is read-only and never authorizes an automatic retry.

## Guard local writes and exports

Some commands are `mutation` because they write local files, not because they
change remote campus state. They still need an explicit destination and
post-write verification:

- `profile export`
- `academic snapshot save`
- `tis ical --destination ...`
- `papers fetch-oa`
- `bb download`
- `bb sync`
- `bb calendar-link fetch --destination ...`

For these commands:

1. Confirm the exact destination path or directory.
2. Avoid `--overwrite` unless the user approved replacing that exact path.
3. Verify the returned absolute path and relevant metadata before treating the
   output as usable.

Specific checks matter:

- `profile export` and `academic snapshot save` contain personal academic data;
  verify schema version, masked identity, digest, and per-source statuses. On
  POSIX, also verify mode `0600`; on Windows, access is governed by the
  destination filesystem's ACLs rather than POSIX mode bits.
- `tis ical` can include schedule, exams, deadlines, and holidays; verify event
  count, source statuses, omissions, and SHA-256 when it writes a file.
- `papers fetch-oa`, `bb download`, and `bb sync` should report saved paths,
  byte counts, and SHA-256 hashes.

PMS may require the SUSTech campus network. Treat a network-gate failure as an
environment limitation, not as evidence that credentials are wrong.
