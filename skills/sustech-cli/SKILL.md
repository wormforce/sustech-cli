---
name: sustech-cli
description: Use the installed sustech CLI for SUSTech campus reads, planning, guarded exports, and confirm-gated workflows across TIS, Blackboard, profile/context, booking, library booking, PMS, transit, faculty, papers, and NCES. Do not use for unrelated universities or invent commands the installed CLI does not report.
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
  `transit schedule`, `transit stops`, `transit live`.
- Academic profile and audits: `profile show`, `profile export`,
  `academic snapshot save`, `academic snapshot diff`, `doctor`.
- Research helpers: `papers search`, `papers fetch-oa`, `nces browse`,
  `nces search`, `nces course`.
- Blackboard: `bb user`, `bb courses`, `bb content`, `bb attachments`,
  `bb assignments`, `bb deadlines`, `bb search`, `bb attempts`,
  `bb download`, `bb sync`, `bb submit preview`, `bb submit apply`.
- TIS reads and planning: `tis courses search`, `tis courses available`,
  `tis enrolled`, `tis schedule`, `tis grades`, `tis exams`,
  `tis timetable`, `tis plan init/show/add/remove/solve`,
  `tis classroom rooms/occupancy/free/live/now`, `tis evals`,
  `tis ical`, `tis degree audit`.
- TIS writes: `tis selection preview/apply` for `cart`, `drop`, and `bid`
  style operations, `tis bid plan`, `tis bid apply`, `tis enroll preview`,
  `tis enroll apply`.
- Other authenticated campus services: `ws programs`, `ws detail`,
  `library search-url`, `booking whoami`, `booking rooms`,
  `booking my-meetings`, `booking create preview/apply`,
  `booking cancel preview/apply`, `lib-booking whoami`,
  `lib-booking home-summary`, `lib-booking labs`, `lib-booking rooms`,
  `lib-booking reservation-count`, `lib-booking reservations`,
  `lib-booking create preview/apply`, `lib-booking cancel preview/apply`,
  `pms check`, `pms server-groups`, `pms stations`, `pms jobs`,
  `pms scan-jobs`, `pms usage`, `pms upload preview/apply`,
  `pms delete preview/apply`.

Some useful routing hints:

- For “what is due soon”, prefer `bb deadlines` and optionally `context --live`.
- For “find a Blackboard file/course item”, prefer `bb search` before scraping.
- For timetable exploration, prefer `tis timetable` for one-off solving and
  `tis plan *` for persistent local planning.
- For room availability, distinguish catalog-backed `tis classroom *` from
  live `tis classroom live/now`.
- `library search-url` is only a browser handoff; do not fabricate library
  catalog results.

## Consume output safely

- Pass `--json` for one structured result and `--jsonl` for record streams.
- Treat the process exit status as authoritative, then inspect `ok`, `error`,
  `meta`, and `schemaVersion` in the output envelope.
- Do not parse human-readable text when a JSON mode is available.
- Preserve IDs exactly as returned; Blackboard and TIS IDs are opaque strings.

## Handle credentials

- Never ask the user to paste a password, token, cookie, or one-time code into
  chat or a visible command argument.
- On a local desktop, let the user run `sustech auth login`; it uses a hidden
  prompt and the operating system's native credential store.
- In headless automation, use credentials supplied by the user's existing
  secret manager through the documented environment or credentials-file
  mechanism. Never create a plaintext fallback.
- Use `sustech auth status --json` and the appropriate read-only
  `sustech auth check --service ... --json` before a workflow that needs login.
- Use `--profile` when the task depends on a specific account identity.

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
- Preserve opaque IDs exactly: TIS course IDs and `rwh`, Blackboard course,
  content, column, and attachment IDs, booking meeting IDs, library reservation
  IDs, and PMS job IDs.
- For TIS drop, treat the consequence as high risk: the released seat may not
  be recoverable.
- For file-bound applies such as Blackboard submission and PMS upload, preserve
  the exact previewed SHA-256 into apply.
- If a result is ambiguous or contains `DO_NOT_RETRY_AUTOMATICALLY`, stop and
  report it; do not retry the mutation automatically.

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

For these commands:

1. Confirm the exact destination path or directory.
2. Avoid `--overwrite` unless the user approved replacing that exact path.
3. Verify the returned absolute path and relevant metadata before treating the
   output as usable.

Specific checks matter:

- `profile export` and `academic snapshot save` contain personal academic data;
  verify private file mode, schema version, masked identity, digest, and
  per-source statuses.
- `tis ical` can include schedule, exams, deadlines, and holidays; verify event
  count, source statuses, omissions, and SHA-256 when it writes a file.
- `papers fetch-oa`, `bb download`, and `bb sync` should report saved paths,
  byte counts, and SHA-256 hashes.

PMS may require the SUSTech campus network. Treat a network-gate failure as an
environment limitation, not as evidence that credentials are wrong.
