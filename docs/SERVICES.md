# Service statuses

This document describes the reusable service-adapter layer reported by
`sustech services status`.

It does not mean "there is no CLI command." A service can still be
`adapter_required` if the underlying module expects an authenticated transport,
while the CLI already supplies that transport for a specific command family.

## Availability meanings

- `implemented`: this repo includes the authenticated transport or public HTTP
  path needed to reach the documented read-only service surface
- `adapter_required`: endpoint coverage and normalization are ported, but the
  caller must provide authenticated cookies, headers, campus reachability, or a
  service-specific transport
- `unavailable`: the rewrite only preserves safe helpers such as URL builders,
  type shapes, or browser handoff; a real fetch layer is intentionally absent

## Current matrix

| Service | Availability | Auth | CLI surface today | Notes |
| --- | --- | --- | --- | --- |
| `blackboard` | `adapter_required` | CAS cookie session | `bb user`, `bb courses`, `bb content`, `bb assignments` | CLI provides a generic CAS-backed adapter; authenticated live QA still pending. |
| `booking` | `implemented` | CAS cookie session plus booking bearer token, campus reachability | `booking whoami`, `booking rooms`, `booking my-meetings` | CLI performs the login handshake itself and keeps credentials, cookies, CAS tickets, and the booking token in memory only. |
| `library-catalog` | `unavailable` | browser session | `library search-url` | The rewrite only offers a Primo handoff URL builder. It does not fabricate catalog results. |
| `library-booking` | `implemented` | IC booking cookie session, campus reachability | `lib-booking whoami`, `lib-booking home-summary`, `lib-booking labs`, `lib-booking rooms`, `lib-booking reservation-count`, `lib-booking reservations` | CLI resolves the authcenter bootstrap, completes CAS, and keeps the resulting `ic-cookie` in memory only. |
| `ws` | `adapter_required` | CAS cookie session | `ws programs`, `ws detail` | CLI provides a generic CAS-backed adapter; authenticated live QA still pending. |
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

None of those secrets are written to disk or echoed in normal command output.
All write paths for these three services remain unavailable in this repository.

## Verification boundary

The new authenticated transports are covered by protocol and mock fixtures and
by request-guard logic. They have not yet been live-QA'd in this repository
with a user-provided campus account.

For PMS specifically, the CLI can perform the documented login flow itself, but
some accounts may still require a first browser-side link or activation step
before CLI authentication succeeds.

## Why Blackboard and WS still show `adapter_required`

The service modules are intentionally transport-agnostic. They know endpoint
shapes and normalization rules, but they do not hardcode how cookies are
obtained.

For Blackboard and WS, the CLI layer now bridges that gap with the shared CAS
session in `src/sso/cas.ts`. That is enough for read commands in this repo, but
the reusable adapter status remains `adapter_required` because other callers
still need to provide the same authenticated transport explicitly.
