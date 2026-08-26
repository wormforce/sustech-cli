# sustech-cli

A standalone TypeScript CLI for SUSTech services, designed for both people and
agents. It talks to campus services directly and never invokes Python at
runtime.

> Status: preview v0.4.1. The TypeScript rewrite now covers the core TIS read
> surface, guarded enrollment apply, public calendar/faculty/transit data,
> local Wi-Fi and resource helpers, public papers/NCES queries, CAS-backed
> Blackboard/WS reads, and authenticated read-only booking, library-booking,
> and PMS flows. On 2026-08-26, opt-in read-only live smoke tests passed for
> TIS enrollment reads, Blackboard courses, WS programs, eHall rooms, and
> library-booking identity/summary/lab/count reads. PMS remained blocked by
> its campus-network gate. Module-by-module status is tracked in [docs/MIGRATION.md](docs/MIGRATION.md)
> and [docs/SERVICES.md](docs/SERVICES.md).

## Output for people and agents

Human-readable text is the default:

```bash
sustech tis courses search "machine learning"
```

Agents and scripts should request a versioned JSON contract explicitly:

```bash
sustech tis courses search "machine learning" --json
sustech tis courses search "machine learning" --json --pretty
```

Bulk consumers can stream one record per line:

```bash
sustech tis courses search "machine learning" --jsonl
```

`--output text|json|jsonl` is the long form. Exit codes remain authoritative in
every mode. The exact envelope, JSONL, stream, and compatibility rules are in
[docs/OUTPUT.md](docs/OUTPUT.md).

Agents can discover the command and safety surface without parsing help text:

```bash
sustech capabilities --json
```

Each capability declares whether it is local/read/plan/mutation, whether it
uses the network, which authentication it needs, and whether confirmation is
required.

## Implemented command areas

```text
sustech capabilities
sustech consequences
sustech auth check
sustech calendar terms
sustech calendar day
sustech faculty departments
sustech faculty list/get/search/render
sustech context
sustech resources list/search
sustech wifi status/events
sustech services status
sustech papers search
sustech nces browse/search/course
sustech bb user/courses/content/assignments
sustech ws programs/detail
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
sustech library search-url
sustech tis courses search [KEYWORD]
sustech tis courses available [KEYWORD] --round ROUND
sustech tis enrolled
sustech tis schedule [--week N|--all]
sustech tis grades [--semester YYYY-YYYY-N]
sustech tis exams
sustech tis classroom rooms/occupancy/free
sustech tis evals
sustech tis ical
sustech tis timetable CODE... [--block MON:1-4] [--max N]
sustech tis enroll preview ...
sustech tis selection preview ...
sustech tis bid plan ...
sustech tis enroll apply ... --confirm
sustech transit facilities
sustech transit find QUERY
sustech transit lines
sustech transit schedule LINE
sustech transit stops LINE
sustech transit live
```

All list commands support JSONL. `tis timetable` fetches the catalog once and
solves conflicts locally with week-aware period overlap checks.

`faculty list` and `faculty search --department` take the exact department
label returned by `sustech faculty departments`.

Only one command currently performs a real mutation:

- `sustech tis enroll apply --confirm`

Everything else in the new selection and service surface is read-only, local
planning, or browser handoff:

- `tis selection preview` builds enroll/drop/cart/bid payloads locally
- `tis bid plan` validates bid budgets locally
- `booking ...`, `lib-booking ...`, and `pms ...` expose authenticated reads only
- `library search-url` builds a Primo handoff URL without claiming catalog data

## Service status model

`sustech services status` reports the reusable service-adapter layer rather than
the CLI wrapper alone.

- `implemented`: this repo includes the transport, login handshake, and
  read-only request guard needed to reach the documented service surface
- `adapter_required`: parsers and endpoints are ported, but the caller still
  must provide an authenticated transport or service-specific headers/cookies
- `unavailable`: only safe URL builders or types are preserved for now

This distinction matters across the current campus-service surface:

- `booking`, `library-booking`, and `pms` are now `implemented`
- `blackboard` and `ws` still report `adapter_required` at the reusable
  service-module level even though the CLI wires CAS-backed reads for them
- `library-catalog` stays `unavailable` apart from `library search-url`

The full matrix is in [docs/SERVICES.md](docs/SERVICES.md).
`papers search` uses CrossRef bibliographic relevance by default and only
resolves open-access links when `--resolve-oa` or `--open-access` is requested.

## Development

Requires Node.js 20.18 or newer.

```bash
npm install
npm test
npm run build
node dist/cli.js --help
```

Once the npm package is published, the intended install is:

```bash
npm install --global sustech-cli
```

For local development on this machine, `build` only compiles `dist/cli.js`; it
does not place `sustech` on your shell `PATH`. Use one of these flows instead:

```bash
# Run the compiled CLI directly without touching global PATH.
npm run build
node dist/cli.js version

# Install the current checkout as the global `sustech` command.
npm install --global .
sustech version
```

`npm link` is also available to package developers who explicitly want a live
symlink. Remove a global install later with:

```bash
npm uninstall --global sustech-cli
```

## CI

Cross-platform CI is active at [.github/workflows/ci.yml](.github/workflows/ci.yml).
It runs `npm ci`, `npm run check`, `npm test`, and `npm pack --dry-run` on
Ubuntu and macOS with Node.js 20 and 22.

## Authentication

Inject credentials through the environment when an agent runner owns secret
management:

```bash
export SUSTECH_SID='12410000'
export SUSTECH_PASSWORD='your-password'
sustech auth check
sustech auth check --service bb
sustech auth check --service ws
sustech auth check --service booking
sustech auth check --service lib-booking
sustech auth check --service pms
```

Alternatively set `SUSTECH_CREDENTIALS_FILE` or pass `--credentials-file` to a
file whose only content is `sid:password`.

All authenticated service sessions stay in memory only:

- booking keeps CAS cookies plus the booking bearer token in memory
- library booking keeps the `ic-cookie` session in memory
- PMS keeps the `OSESSIONID` cookie in memory and uses transient RSA login material

None of those secrets are written to disk or echoed in normal command output.
Each transport is also restricted to an internal read-only allowlist of
documented endpoints.

For PMS specifically, the CLI reuses `SUSTECH_SID` and `SUSTECH_PASSWORD` as
the PMS username/password pair. A first-time PMS account link or activation may
still require a browser-side step before the CLI can authenticate successfully.

## Safe enrollment workflow

```bash
# Returns the account-specific TIS ID required by enrollment.
sustech tis courses available "machine learning" --round bxxk --json

# Pure local preview: no login, network request, or mutation.
sustech tis enroll preview --course-id TIS_INTERNAL_ID --rwh TASK_ID --round bxxk --bid 2

# Mutation requires the exact target plus explicit confirmation.
sustech tis enroll apply --course-id TIS_INTERNAL_ID --rwh TASK_ID --round bxxk --bid 2 --confirm
```

Agents must obtain user approval for the exact course target before invoking an
`apply` command. After TIS accepts the write, the CLI reads the enrolled
schedule back and reports `confirmed`, `not_observed`, or `unavailable`.
Unconfirmed results carry `DO_NOT_RETRY_AUTOMATICALLY`.

## Attribution and license

This project is a TypeScript reimplementation informed by
[`dumixthestpd/sustech_survival`](https://github.com/dumixthestpd/sustech_survival).
It preserves that project's required copyright notice and is distributed under
the PolyForm Noncommercial License 1.0.0. See [NOTICE.md](NOTICE.md) and
[LICENSE](LICENSE).
