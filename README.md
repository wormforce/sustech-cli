# sustech-cli

A standalone TypeScript CLI for SUSTech services, designed for both people and
agents. It talks to campus services directly and never invokes Python at
runtime.

> Status: preview v0.6.0. The TypeScript rewrite now covers the core TIS read
> surface, guarded enrollment apply, public calendar/faculty/transit data,
> local Wi-Fi and resource helpers, public papers/NCES queries, CAS-backed
> Blackboard/WS reads, safe Blackboard attachment downloads, fixture-validated Blackboard assignment submission, and
> authenticated read-only booking, library-booking, and PMS flows. On
> 2026-08-26, opt-in read-only live smoke tests passed for
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
sustech auth login/status/logout/check
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
sustech bb user/courses/content/attachments/assignments/attempts
sustech bb download COURSE_ID CONTENT_ID ATTACHMENT_ID --destination PATH [--overwrite]
sustech bb submit preview ...
sustech bb submit apply ... --expected-sha256 HASH --confirm
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

The currently exposed mutation commands are:

- `sustech tis enroll apply --confirm`
- `sustech bb submit apply --expected-sha256 HASH --confirm`

`sustech bb download ... --destination PATH` is a local filesystem mutation,
not a Blackboard write. It refuses to replace an existing path unless the exact
command includes `--overwrite`.

Everything else in the new selection and service surface is read-only, local
planning, or browser handoff:

- `tis selection preview` builds enroll/drop/cart/bid payloads locally
- `tis bid plan` validates bid budgets locally
- `bb submit preview` authenticates for read-only assignment, attempt, and upload-limit checks; it never mutates
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
  service-module level even though the CLI wires CAS-backed Blackboard/WS commands for them
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

Install the CLI from npm with:

```bash
npm install --global sustech-cli
```

For local development, `build` creates `dist`; it does not place `sustech` on
your shell `PATH`. Use one of these flows instead:

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
Ubuntu, macOS, and Windows with Node.js 20 and 22.

## Authentication

For a local desktop, verify the account once and save it in the operating
system's credential store:

```bash
sustech auth login
sustech auth status
sustech auth check --service bb
```

The hidden password prompt writes to stderr, so `--json` remains parseable on
stdout. macOS uses Keychain, Windows uses Credential Manager, and Linux desktop
uses Secret Service through `secret-tool`. Profile metadata contains the SID
and backend but never the password. Use `--profile NAME` for multiple accounts
and `sustech auth logout` to delete one.

Headless Linux, containers, and CI do not silently fall back to plaintext or a
session-only kernel keyring. Inject credentials when an agent runner or CI
system owns secret management:

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
file whose only content is `sid:password`. Explicit files and environment
variables override a stored profile. See [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md)
for backend availability, profile precedence, config paths, and non-interactive
usage.

All authenticated service sessions stay in memory only:

- booking keeps CAS cookies plus the booking bearer token in memory
- library booking keeps the `ic-cookie` session in memory
- PMS keeps the `OSESSIONID` cookie in memory and uses transient RSA login material

None of those session secrets are written to disk or echoed in normal command
output. A long-lived account password is persisted only when `auth login`
explicitly stores it in the operating-system credential store.
Booking, library-booking, and PMS remain restricted to read-only endpoint
allowlists. Blackboard writes are exposed only through the guarded official
assignment-submission workflow below.

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

## Safe Blackboard submission workflow

Teacher-provided assignment files are discovered separately from files in a
student submission attempt:

```bash
# List attachment IDs without exposing signed bbcswebdav URLs.
sustech bb attachments _8537_1 _629896_1

# Download exactly one listed attachment. --output remains reserved for the
# text/json/jsonl renderer, so the local file flag is named --destination.
sustech bb download _8537_1 _629896_1 ATTACHMENT_ID --destination ./homework.pdf
```

The attachment reader supports the official Learn content-attachment endpoint
used by Original courses and attachment links embedded in BBML. Downloads are
streamed through a same-origin guard into a temporary file, then placed with
exclusive no-overwrite semantics only after the byte count and SHA-256 have
been computed. Existing files are never replaced by default.

```bash
# Resolve assignment IDs first. The first column is contentId, the second is columnId.
sustech bb assignments _8537_1

# Optional: inspect your own attempt history for one assignment.
sustech bb attempts _8537_1 --content-id _629896_1 --json

# Authenticated, read-only preflight: resolves the exact assignment, checks
# existing attempts/due date/upload limit, hashes the file, and prints an apply command.
sustech bb submit preview --course-id _8537_1 --content-id _629896_1 --file homework.pdf

# Copy the exact command emitted by preview. HASH is its SHA-256 value.
sustech bb submit apply --course-id _8537_1 --content-id _629896_1 --column-id _12345_1 \
  --file homework.pdf --expected-sha256 HASH --confirm
```

The Blackboard submission flow follows the official Learn REST v2 attempt
lifecycle and v1 upload/attempt-file endpoints. `preview` refuses unsupported
content, an existing in-progress attempt, exhausted attempts, or an oversized
file. It adds `--allow-late` to the handoff only when the live due date has
passed. `apply` uploads the exact bytes bound to `--expected-sha256`, creates an
in-progress attempt, attaches the file, changes the status to `NeedsGrading`,
and reads the attempt plus filename back.

The official attempt-file endpoint currently supports only Classic/Original
course assignments, so this CLI deliberately does not fall back to scraping the
legacy `uploadAssignment` HTML form. The implementation is fixture-tested but
has not made a real Blackboard write. Ambiguous write outcomes use exit code 5
and `DO_NOT_RETRY_AUTOMATICALLY`.

Official references: [Learn REST API](https://developer.blackboard.com/portal/displayApi/Learn?version=4001.2.0)
and [Blackboard's SOAP-to-REST mapping](https://blackboard.github.io/rest-apis/learn/advanced/soap-to-rest-mapping).

## Attribution and license

This project is a TypeScript reimplementation informed by
[`dumixthestpd/sustech_survival`](https://github.com/dumixthestpd/sustech_survival).
It preserves that project's required copyright notice and is distributed under
the PolyForm Noncommercial License 1.0.0. See [NOTICE.md](NOTICE.md) and
[LICENSE](LICENSE).
