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
| `blackboard` | `adapter_required` | CAS cookie session | `bb user`, `bb courses`, `bb content`, `bb attachments`, `bb download`, `bb assignments`, `bb attempts`, `bb submit preview`, `bb submit apply` | CLI CAS login and courses read passed an opt-in live smoke test on 2026-08-26. Content attachment download supports the official Original endpoint and embedded BBML links. Assignment submission is fixture-tested against the official Learn REST attempt/upload/file flow and currently targets Classic/Original assignments. |
| `booking` | `implemented` | CAS cookie session plus booking bearer token, campus reachability | `booking whoami`, `booking rooms`, `booking my-meetings` | CLI login and room-list read passed an opt-in live smoke test on 2026-08-26. |
| `library-catalog` | `unavailable` | browser session | `library search-url` | The rewrite only offers a Primo handoff URL builder. It does not fabricate catalog results. |
| `library-booking` | `implemented` | IC booking cookie session, campus reachability | `lib-booking whoami`, `lib-booking home-summary`, `lib-booking labs`, `lib-booking rooms`, `lib-booking reservation-count`, `lib-booking reservations` | Login plus identity, summary, labs, and count reads passed an opt-in live smoke test on 2026-08-26. |
| `ws` | `adapter_required` | CAS cookie session | `ws programs`, `ws detail` | CLI CAS login and program-list read passed an opt-in live smoke test on 2026-08-26. |
| `pms` | `implemented` | PMS auth token, RSA login, OSESSIONID cookie, campus reachability | `pms check`, `pms server-groups`, `pms stations`, `pms jobs`, `pms scan-jobs`, `pms usage` | CLI performs the PMS auth flow directly, keeps OSESSIONID in memory, and uses transient RSA login material. A first browser-side account link may still be needed on some accounts. |
| `nces` | `implemented` | none | `nces browse`, `nces search`, `nces course` | Public HTTP API backed by `ncesnext.com`; callers should avoid aggressive polling. |
| `papers` | `implemented` | none | `papers search` | Uses CrossRef bibliographic relevance plus optional Unpaywall resolution. Metadata and OA links only, no downloads. |

## Read-only transport guards

Booking, library-booking, and PMS are now implemented as authenticated
read-only transports, not generic "logged-in browsers."

- `booking` keeps CAS cookies plus the booking bearer token in memory and only
  calls the documented profile, room, and meeting endpoints
- `library-booking` keeps the `ic-cookie` session in memory and only allows
  `GET` or `HEAD` to the documented idle-summary, lab, room, and reservation
  endpoints
- `pms` keeps the OSESSIONID cookie plus transient auth-token/public-key login
  material in memory and only allows the documented read endpoints for printer
  groups, printer lists, print jobs, scan jobs, and usage history

None of those session secrets are written to disk or echoed in normal command
output. The account password may be persisted only through `auth login`, which
uses the operating-system credential store described in `docs/AUTHENTICATION.md`.
All write paths for these three services remain unavailable in this repository.

## Blackboard submission boundary

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

## Verification boundary

The authenticated transports are covered by protocol/mock fixtures and
request-guard logic. On 2026-08-26, opt-in read-only live smoke tests passed for
TIS enrollment reads, Blackboard courses, WS programs, eHall rooms, and
library-booking identity, summary, labs, and reservation count. No Blackboard
write path was exercised.

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
