# Service statuses

This document describes the reusable service-adapter layer reported by
`sustech services status`.

It does not mean "there is no CLI command." A service can still be
`adapter_required` if the underlying module expects an authenticated transport,
while the CLI already supplies that transport for a specific command family.

## Availability meanings

- `implemented`: this repo includes the authenticated transport or public HTTP
  path needed to reach its documented service surface
- `adapter_required`: endpoint coverage and normalization are ported, but the
  caller must provide authenticated cookies, headers, campus reachability, or a
  service-specific transport
- `unavailable`: the rewrite only preserves safe helpers such as URL builders,
  type shapes, or browser handoff; a real fetch layer is intentionally absent

## Current matrix

| Service | Availability | Auth | CLI surface today | Notes |
| --- | --- | --- | --- | --- |
| `blackboard` | `adapter_required` | CAS cookie session | `bb user`, `bb courses`, `bb content`, `bb attachments`, `bb download`, `bb assignments`, `bb deadlines`, `bb calendar`, `bb search`, `bb sync`, `bb attempts`, `bb submit preview`, `bb submit apply`, `bb calendar-link set/show/fetch/delete` | CLI CAS login and courses read passed an opt-in live smoke test on 2026-08-26. Content download/sync supports the official Original endpoint and embedded BBML links. Calendar-item reads and native calendar-link handling are implemented with fixtures and keyring tests. Assignment submission is fixture-tested against the official Learn REST attempt/upload/file flow and currently targets Classic/Original assignments. |
| `booking` | `implemented` | CAS cookie session plus booking bearer token, campus reachability | `booking whoami`, `booking rooms`, `booking my-meetings`, `booking create preview/apply`, `booking cancel preview/apply` | CLI login and room-list read passed an opt-in live smoke test on 2026-08-26. Create preview now checks the live room calendar for the exact day/time and fails closed when overlaps or unreadable calendar state prevent a safe decision. Remote writes still require preview, `--confirm`, and exact read-back. |
| `library-catalog` | `implemented` | public HTTP or manual browser session | `library search`, `library detail` | Primo public search/detail normalization is implemented, and `--browser [--interactive]` provides a manual browser-backed fallback. The CLI never fabricates records, never accepts browser credentials, never solves CAPTCHAs, and never persists browser cookies. Some runtimes may still need the browser path because upstream TLS behavior can differ by host. |
| `library-booking` | `implemented` | IC booking cookie session, campus reachability | `lib-booking whoami`, `lib-booking home-summary`, `lib-booking labs`, `lib-booking rooms`, `lib-booking reservation-count`, `lib-booking reservations`, `lib-booking create preview/apply`, `lib-booking cancel preview/apply` | Login plus identity, summary, labs, and count reads passed an opt-in live smoke test on 2026-08-26. Create preview now combines room open-times with reservation metadata and fails closed when exact availability cannot be proved safely. Membership and capacity rules remain conservative. |
| `ws` | `adapter_required` | CAS cookie session | `ws programs`, `ws detail` | CLI CAS login and program-list read passed an opt-in live smoke test on 2026-08-26. |
| `pms` | `implemented` | PMS auth token, RSA login, OSESSIONID cookie, campus reachability | `pms check`, `pms server-groups`, `pms stations`, `pms jobs`, `pms scan-jobs`, `pms usage`, `pms upload preview/apply`, `pms delete preview/apply` | CLI performs the PMS auth flow directly, keeps OSESSIONID in memory, and uses transient RSA login material. Queue mutations are fixture-tested only. A first browser-side account link may still be needed on some accounts. |
| `nces` | `implemented` | none | `nces browse`, `nces search`, `nces course` | Public HTTP API backed by `ncesnext.com`; callers should avoid aggressive polling. |
| `papers` | `implemented` | none | `papers search`, `papers fetch-oa` | Uses CrossRef bibliographic relevance plus optional Unpaywall resolution. OA downloads require an explicit guarded destination and validate redirects, PDF bytes, size, and SHA-256. |

## Authenticated transport guards

Booking, library-booking, and PMS are implemented as constrained authenticated
transports, not generic "logged-in browsers."

- `booking` keeps CAS cookies plus the booking bearer token in memory and only
  calls documented profile, room, and meeting endpoints; writes are exposed
  through typed create/cancel methods rather than generic POST access
- `library-booking` keeps the `ic-cookie` session in memory and constrains reads
  and typed create/cancel calls to documented idle-summary, lab, room, and
  reservation endpoints
- `pms` keeps the OSESSIONID cookie plus transient auth-token/public-key login
  material in memory and constrains reads plus typed queue upload/delete calls
  to documented PMS endpoints

None of those session secrets are written to disk or echoed in normal command
output. The account password may be persisted only through `auth login`, which
uses the operating-system credential store described in `docs/AUTHENTICATION.md`.
Remote writes require an operation-specific preview, explicit `--confirm`, a
fresh preflight, and exact read-back. If the write may have happened but cannot
be verified, the command exits 5 and emits `DO_NOT_RETRY_AUTOMATICALLY`.
No real write was used to validate these new paths; current evidence is from
protocol fixtures and transport-guard tests.

## Primo catalog transports

The library catalog now has two read-only transports:

- direct Primo public search/detail requests used by `library search` and
  `library detail`
- a browser-backed fallback selected with `--browser`, optionally combined with
  `--interactive` when the user needs to finish CAS manually

The browser path has strict boundaries:

- the CLI does not accept a username, password, cookie, or token for Primo
- if CAS appears, the user completes it in the browser window themselves
- the CLI does not solve CAPTCHAs or automate challenge completion
- browser cookies are session-only and are not persisted by the CLI

Use the browser path as a transport fallback, not as a generic scraper.

## Exact availability preflights

The booking and library-booking create previews now try to observe the exact
requested slot before any write:

- `booking create preview` reads the room's day calendar and blocks on
  overlapping meetings
- `lib-booking create preview` combines the room's reported open-times and any
  parseable reservation metadata for that room/day

These checks remain point-in-time observations, so apply repeats the preflight.
If the exact live availability evidence is missing, malformed, or ambiguous, the
preview fails closed instead of assuming the slot is free.

## Blackboard calendar surfaces

The CLI exposes two different Blackboard calendar paths:

- `bb calendar` is an authenticated REST read over
  `/learn/api/public/v1/calendars/items`. It accepts `--since`, `--until`,
  `--type`, and `--course-id` filters and reports partial chunk failures
  conservatively instead of fabricating a complete view.
- `bb calendar-link set/show/fetch/delete` manages Blackboard's native Learn
  ICS feed link. That link is treated like a bearer secret, stored only in the
  operating-system credential store, masked by default, and never accepted as a
  visible command-line URL argument.

The native feed and the REST read have different tradeoffs. `bb calendar`
supports typed filters and requires Blackboard CAS authentication. The stored
native feed is usually the user's account-level shared subscription, so it
behaves like an all-courses ICS export for that account. Once stored,
`bb calendar-link fetch` can refresh it without a fresh CAS login and can
optionally write it to an explicit `--destination` with `--overwrite` required
for replacement.

## Blackboard attachment and submission boundary

`bb attachments COURSE_ID CONTENT_ID` discovers files supplied by the teacher,
using the Learn content-attachment endpoint and same-origin BBML links. It does
not mix those files with the authenticated student's attempt files. `bb download`
requires one attachment ID and an explicit `--destination`; signed URLs are not
returned in text or machine output. The downloader streams to a temporary file,
computes SHA-256, and refuses overwrite unless `--overwrite` is present.

Blackboard assignment submission uses the official Learn REST APIs: v2 grade
columns and attempts, v1 temporary uploads, and v1 attempt files. The attempt
file endpoint is limited by Blackboard to Classic/Original assignments, which
the read-only preflight verifies from both the content handler and grade-column
metadata.

`bb submit preview` authenticates but only reads. `bb submit apply` requires
`--confirm`, the previewed `--expected-sha256`, a fresh preflight, and a
post-submit read-back of both attempt status and filename. Existing in-progress
attempts are not silently resumed. An uncertain write returns exit code 5 with
`DO_NOT_RETRY_AUTOMATICALLY`; the CLI never falls back to the legacy HTML form.

## TIS degree surfaces

The degree commands intentionally expose three different levels of authority:

- `tis degree progress` preserves the personalized result calculated by TIS.
- `tis degree missing` is a derived planning report that joins progress,
  grades, and current enrollment. It separates definite required-course gaps,
  in-progress courses, elective/module deficits, and manual-review cases.
- `tis degree audit` evaluates grades against a user-supplied local JSON rule
  file and is not an official curriculum source.

The missing-course evaluator fails conservatively: unknown grade tokens,
conditional category notes, overlapping constraints, and unavailable secondary
sources are surfaced for review instead of being converted into exact courses.

The same conservative boundary applies to `tis plan explain` and
`tis plan recommend`: degree relevance is attached only when the current
degree-progress or degree-missing evidence supports it directly. Ambiguous cases
stay in manual review. NCES remains a community-contributed reference, not an
official degree or prerequisite source.

## Verification boundary

The authenticated transports are covered by protocol/mock fixtures and
request-guard logic. On 2026-08-26, opt-in read-only live smoke tests passed for
TIS enrollment reads, Blackboard courses, WS programs, eHall rooms, and
library-booking identity, summary, labs, and reservation count. Blackboard
calendar-link storage/fetch, TIS degree progress, and the derived degree-missing
classification are covered by dedicated fixtures, but no Blackboard write path
was exercised.

On 2026-08-27, fresh TIS and Blackboard CAS authentication instead encountered
the interactive slide CAPTCHA. The CLI reports
`CAS_INTERACTIVE_CHALLENGE_REQUIRED` before password submission and does not
attempt to bypass it; this limits current live QA but does not affect fetching
an already stored native Blackboard calendar link.

PMS returned its campus-network gate before login in the same test environment.
The CLI can perform the documented login flow itself, but a campus access path
is required and some accounts may still need a first browser-side link or
activation step.

## Why Blackboard and WS still show `adapter_required`

The service modules are intentionally transport-agnostic. They know endpoint
shapes and normalization rules, but they do not hardcode how cookies are
obtained.

For Blackboard and WS, the CLI layer now bridges that gap with the shared CAS
session in `src/sso/cas.ts`. That is enough for the Blackboard/WS commands in
this repo, but the reusable adapter status remains `adapter_required` because
other callers still need to provide the same authenticated transport explicitly.
