# Service statuses

This document describes the reusable service-adapter layer reported by
`sustech services status`.

It does not mean "there is no CLI command." A service can still be
`adapter_required` if the underlying module expects an authenticated transport,
while the CLI already supplies that transport for a specific command family.

## Availability meanings

- `implemented`: the module can reach the upstream service directly in this repo
  without any external adapter beyond ordinary public HTTP access
- `adapter_required`: endpoint coverage and normalization are ported, but the
  caller must provide authenticated cookies, headers, campus reachability, or a
  service-specific transport
- `unavailable`: the rewrite only preserves safe helpers such as URL builders,
  type shapes, or browser handoff; a real fetch layer is intentionally absent

## Current matrix

| Service | Availability | Auth | CLI surface today | Notes |
| --- | --- | --- | --- | --- |
| `blackboard` | `adapter_required` | CAS cookie session | `bb user`, `bb courses`, `bb content`, `bb assignments` | CLI provides a generic CAS-backed adapter; authenticated live QA still pending. |
| `booking` | `adapter_required` | bearer header + campus reachability | none yet | Read paths and payload envelope builders are ported, but the CLI does not mint or import the booking token yet. |
| `library-catalog` | `unavailable` | browser session | `library search-url` | The rewrite only offers a Primo handoff URL builder. It does not fabricate catalog results. |
| `library-booking` | `adapter_required` | IC booking cookie session + campus reachability | none yet | Read APIs are normalized, but the CLI does not yet provide the cookie adapter. |
| `ws` | `adapter_required` | CAS cookie session | `ws programs`, `ws detail` | CLI provides a generic CAS-backed adapter; authenticated live QA still pending. |
| `pms` | `adapter_required` | OSESSIONID cookie + campus reachability | none yet | Printer/account reads are ported; writes stay out of scope. |
| `nces` | `implemented` | none | `nces browse`, `nces search`, `nces course` | Public HTTP API backed by `ncesnext.com`; callers should avoid aggressive polling. |
| `papers` | `implemented` | none | `papers search` | Uses CrossRef bibliographic relevance plus optional Unpaywall resolution. Metadata and OA links only, no downloads. |

## Why Blackboard and WS show `adapter_required`

The service modules are intentionally transport-agnostic. They know endpoint
shapes and normalization rules, but they do not hardcode how cookies are
obtained.

For Blackboard and WS, the CLI layer now bridges that gap with the shared CAS
session in `src/sso/cas.ts`. That is enough for read commands in this repo, but
the reusable adapter status remains `adapter_required` because other callers
still need to provide the same authenticated transport explicitly.
