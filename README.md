# sustech-cli

[![npm](https://img.shields.io/npm/v/sustech-cli)](https://www.npmjs.com/package/sustech-cli)
[![CI](https://github.com/wormforce/sustech-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/wormforce/sustech-cli/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/node/v/sustech-cli)](https://www.npmjs.com/package/sustech-cli)

An unofficial TypeScript CLI for SUSTech services, designed for people,
scripts, and coding agents. Text is the default for humans; versioned JSON and
JSONL are available for software. Python is not required at runtime.

> [!WARNING]
> This is an independent community project, not an official SUSTech service.
> Published npm releases may lag `main`. Inspect `sustech version` and
> `sustech capabilities` on the installed copy before relying on a command or
> allowing it to change state.

## Install

Requires Node.js 20.18 or newer:

```bash
npm install --global sustech-cli
sustech version
```

To try one command without a global install:

```bash
npm exec --package=sustech-cli -- sustech version
```

`npm run build` only compiles a source checkout; it does not put `sustech` on
your shell `PATH`. Package developers can use `npm install --global .` or
`npm link` after building.

## Quick start

Public data does not require an account:

```bash
sustech calendar day 2026-09-01
sustech faculty search "computer vision"
sustech online talks list --limit 10
sustech online contact search "教学"
sustech transit lines
sustech library search "graph neural networks" --limit 5
```

Authenticated services use a named local profile:

```bash
sustech auth login
sustech auth status
sustech context --live --level verbose
sustech academic watch --state ./academic-state.json --include-blackboard
sustech academic changes before.json after.json
sustech tis plan recommend CS330 MA203 --round bxxk --max 5
sustech tis plan explain CS330 --round bxxk
sustech tis degree missing
sustech tis degree progress
sustech bb calendar --type GradebookColumn
sustech tis schedule
sustech bb courses
```

Discover the complete command surface from the installed version:

```bash
sustech --help
sustech capabilities --json --pretty
```

## Use with an Agent

The CLI is self-describing. Agents should inspect structured command and safety
metadata instead of parsing `--help` or relying on a memorized command list:

```bash
sustech version --json
sustech capabilities --json
sustech consequences --json
```

This repository also ships a portable
[`sustech-cli` Agent Skill](skills/sustech-cli/SKILL.md). Install it directly
from the public repository—no source clone is needed:

```bash
npx skills add wormforce/sustech-cli --skill sustech-cli
```

For a global Codex installation:

```bash
npx skills add wormforce/sustech-cli --skill sustech-cli --global --agent codex
```

The [Agent Skills CLI](https://github.com/vercel-labs/skills) can target other
supported agents and project-local scopes. Review the Skill before installing
it: it teaches command discovery, structured output, credential boundaries,
preview/confirm workflows, and the rule never to retry an ambiguous mutation
automatically.

Installing the npm package deliberately does **not** edit Codex, Claude Code,
Cursor, or other agent configuration. The target agent and scope are user
choices, so an npm `postinstall` script should not install instructions
silently.

For an agent without Skill support, provide this short instruction:

> Use the installed `sustech` CLI. Start with `sustech capabilities --json` and
> `sustech consequences --json`; request structured output, never expose login
> secrets, and never add `--confirm` without approval for the exact target.

A Skill is the onboarding layer; the CLI remains the executable source of
truth. The package also ships a local `stdio` MCP entrypoint, `sustech-mcp`, for
clients that support native tools. It needs no hosted server and exposes `33`
typed public/local read-only tools plus JSON resources, resource templates, and
prompts for discovery, public campus data, library, faculty, transit, NCES,
papers, and selected SUSTech Online reads. Authenticated data, browser flows,
local writes, and remote mutations remain unavailable through MCP. See
[docs/MCP.md](docs/MCP.md) for configuration and the complete boundary.
A repository-level `AGENTS.md` alone would only help agents that cloned the
source.

## What it covers

This table is a summary. Use `sustech capabilities --json` for the installed
version's exact command, authentication, network, and confirmation metadata.

| Area | Examples | Access |
| --- | --- | --- |
| Diagnostics | version, capabilities, consequences, doctor | Local; optional live auth checks |
| Academic context | calendar, Context v2 live summaries, profile reports, academic snapshots, `academic changes`, one-shot `academic watch` | Public and authenticated reads; guarded local exports |
| TIS | catalog, schedule, grades, exams, TIS-reported degree progress, conservative missing-course report, persistent planning, `tis plan solve/explain/recommend`, local degree audit, live classrooms, iCalendar | CAS login; selection/enrollment writes are confirm-gated |
| Blackboard | courses, deadlines, calendar reads, native calendar-link workflow, search, attachment download/sync, attempts, submission | CAS login for REST reads; the native calendar link is a separate stored secret and local writes are guarded |
| Library and campus services | Primo catalog search/detail, WS programs, eHall booking, library booking, PMS jobs and usage | Public catalog reads plus authenticated reads; booking and queue writes are confirm-gated |
| Research and courses | Crossref/OA papers, NCES browse and search, SUSTech Online talks | Public; OA downloads use guarded local paths; NCES and SUSTech Online remain community references only |
| Campus and device context | faculty, resources, transit, Wi-Fi status/events | Public or local |
| Community directory | Selected institutional SUSTech Online contacts with provenance and freshness advisories | Public community source; emergency, financial, personal, dining/chat, and professor-list sections are excluded |

For the structured TIS-reported `tis degree progress` response, the derived
`tis degree missing` report, and how both differ from local JSON
`tis degree audit`, see
[docs/DEGREE_PROGRESS.md](docs/DEGREE_PROGRESS.md). For the
snapshot save/diff/change/watch workflow, see
[docs/ACADEMIC_SNAPSHOTS.md](docs/ACADEMIC_SNAPSHOTS.md). For the
`tis degree audit` requirements-file format, matching semantics, and current
runtime limits, see [docs/DEGREE_AUDIT.md](docs/DEGREE_AUDIT.md).
For the selected SUSTech Online source scope, provenance fields, freshness
labels, and contact exclusions, see [docs/ONLINE.md](docs/ONLINE.md).

Remote-state mutations are deliberately limited to these apply commands, all
of which require an exact target plus `--confirm`:

- `tis enroll apply`, `tis selection apply`, and `tis bid apply`
- `bb submit apply`
- `booking create apply` and `booking cancel apply`
- `lib-booking create apply` and `lib-booking cancel apply`
- `pms upload apply` and `pms delete apply`

Local state can also change through credential login/logout, persistent
`tis plan` edits, and explicit file outputs such as `profile export`,
`academic snapshot save`, `tis ical --destination`, `papers fetch-oa`,
`bb download`, and `bb sync`. File commands reject unsafe symbolic-link paths
and do not overwrite an existing target unless the command explicitly permits
and requests it.

## Output contract

```bash
# Human-readable text
sustech tis courses search "machine learning"

# One versioned JSON envelope
sustech tis courses search "machine learning" --json

# One record per line for list commands
sustech tis courses search "machine learning" --jsonl
```

`--output text|json|jsonl` is the long form, and `--pretty` formats JSON for
review. A successful envelope looks like this:

```json
{
  "schemaVersion": "1",
  "ok": true,
  "command": "version",
  "data": {
    "version": "0.10.0",
    "runtime": "node v22.19.0"
  }
}
```

The process exit status remains authoritative in every mode. See
[docs/OUTPUT.md](docs/OUTPUT.md) for envelope, JSONL, error-code, and
compatibility rules.

## Credentials

On a desktop, `sustech auth login` verifies the account and stores the password
in the operating system's native credential store:

- macOS: Keychain
- Windows: Credential Manager
- Linux desktop: Secret Service via `secret-tool`

The password is entered through a hidden prompt, is never accepted as a normal
command-line argument, and is never written to the CLI config. If no safe
backend is available, the CLI returns `CREDENTIAL_STORE_UNAVAILABLE` instead of
falling back to plaintext.

```bash
sustech auth login --profile main
sustech auth check --profile main --service bb --json
sustech auth logout --profile main
```

Headless runners can use credentials supplied by their own secret manager via
the documented environment variables or credentials file. Service sessions and
cookies remain in memory. See [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md)
for precedence, backend requirements, and non-interactive use.

Blackboard also exposes a private native calendar subscription link. Treat that
link like a bearer token or password: store it only through stdin, let `show`
mask it by default, and reveal it only with an explicit `--reveal`:

```bash
# macOS
pbpaste | sustech bb calendar-link set --url-stdin
# Windows PowerShell
Get-Clipboard | sustech bb calendar-link set --url-stdin
sustech bb calendar-link show
sustech bb calendar-link fetch --destination ./blackboard.ics
```

The link is validated before storage and kept in the operating-system
credential store under a separate Blackboard-calendar namespace, not in the
credential metadata file. `bb calendar-link fetch` can later refresh that ICS
feed without a fresh CAS login.

## Guarded workflows

Every remote mutation follows the same pattern: resolve the exact target, run a
preview or read-only preflight, obtain explicit approval, apply with
`--confirm`, then verify by reading the live state back.

Enrollment example:

```bash
sustech tis courses available "machine learning" --round bxxk --json
sustech tis enroll preview \
  --course-id TIS_INTERNAL_ID --rwh TASK_ID --round bxxk --bid 2
sustech tis enroll apply \
  --course-id TIS_INTERNAL_ID --rwh TASK_ID --round bxxk --bid 2 --confirm
```

Blackboard attachment and submission example:

```bash
sustech bb attachments _8537_1 _629896_1 --json
sustech bb download _8537_1 _629896_1 ATTACHMENT_ID \
  --destination ./homework.pdf

sustech bb submit preview \
  --course-id _8537_1 --content-id _629896_1 --file homework.pdf
sustech bb submit apply \
  --course-id _8537_1 --content-id _629896_1 --column-id _12345_1 \
  --file homework.pdf --expected-sha256 HASH --confirm
```

`bb submit preview` is authenticated but read-only. It resolves assignment IDs,
checks attempts, due date and upload limit, hashes the file, and emits the exact
apply command. The same preview/confirm/read-back contract applies to TIS
selection and bid changes, booking and library-booking create/cancel actions,
and PMS upload/delete actions. An ambiguous remote write result includes
`DO_NOT_RETRY_AUTOMATICALLY` and must not be retried automatically.

Booking and library-booking previews now also try to read exact point-in-time
room availability before any write. If the live room calendar, room open-times,
or reservation metadata cannot safely rule out an overlap, preview fails closed
instead of guessing that the slot is free.

## Academic change tracking

```bash
sustech academic snapshot save --destination ./before.json --include-blackboard
sustech academic changes before.json after.json
sustech academic watch --state ./academic-state.json --include-blackboard
```

`academic changes BEFORE AFTER` is the read-only diff command for two saved
snapshots. `academic watch --state PATH` is a one-shot command: it reads live
academic state once, compares it against the existing local state file when
present, reports the changes, and updates that local file. It does not poll, it
does not loop in the background, and it does not write any remote campus state.

## Context v2

```bash
sustech context --level terse
sustech context --live --level normal
sustech context --live --level verbose
```

`context` now has three explicit detail levels:

- `terse`: compact calendar and near-term summary
- `normal`: adds the next deadline, next evaluation, and next exam when known
- `verbose`: adds public weather, AQI, and library-status observations when
  `--live` is enabled

`--live` keeps source status explicit. Missing or failed live sources stay
marked as missing or partial; they are not silently backfilled.

## Library catalog

```bash
sustech library search "graph neural networks" --limit 5
sustech library detail PC:cdi_proquest_miscellaneous_1901310093
sustech library search "graph neural networks" --browser --interactive
sustech library detail L:alma991234567890106575 --browser
```

`library search` and `library detail` are read-only Primo catalog commands.
`--browser` forces the browser-backed path. If that path redirects to CAS, the
user must complete authentication manually in the browser window. The CLI does
not accept browser credentials, does not solve CAPTCHAs, and does not persist
browser cookies. On some hosts, public Primo HTTP access may still be limited by
runtime TLS behavior; `--browser` is the supported fallback.

## Conservative course planning

```bash
sustech tis plan recommend CS330 MA203 --round bxxk --path ./tis-plan.json --max 5
sustech tis plan explain CS330 --round bxxk --path ./tis-plan.json
```

These commands are read-only planning helpers. They do not add courses, do not
submit selection writes, do not treat NCES as official data, and do not guess
prerequisites. `recommend` ranks candidate sections using the current
selectable-course snapshot, timetable-fit evidence, seat observations, optional
degree-progress or degree-missing data, and optional NCES matches. `explain`
shows the same evidence for one exact course code or RWH. Degree relevance stays
conservative: if the available evidence is ambiguous, the result stays in manual
review instead of being promoted to a definite requirement match.

## Current limitations

- Blackboard submission follows official Learn REST attempt/upload endpoints
  and is fixture-tested, but it has not yet performed a real Blackboard write.
- Primo catalog access has both direct and browser-backed paths, but direct
  public HTTP access can still depend on the local runtime's TLS behavior. When
  in doubt, use `--browser` and complete any CAS step manually.
- Fresh CAS logins for TIS- and Blackboard-backed commands may stop before
  password submission with `CAS_INTERACTIVE_CHALLENGE_REQUIRED` when CAS serves
  an interactive slide CAPTCHA. The CLI will not bypass that challenge. A
  previously stored Blackboard native calendar link can still be fetched
  without CAS.
- The supported submission surface is Classic/Original assignment attempts;
  the CLI does not scrape or silently fall back to the legacy
  `uploadAssignment` HTML form.
- Newly added TIS selection, booking, library-booking, and PMS write paths are
  protocol/fixture-tested only. No real account mutation was performed while
  building this expansion.
- PMS may require the campus network, and first-time account linking may still
  require a browser-side step.
- Reusable service-adapter status can differ from the CLI's wired end-to-end
  status. Inspect `sustech services status` and [docs/SERVICES.md](docs/SERVICES.md).

Module-by-module migration status is tracked in
[docs/MIGRATION.md](docs/MIGRATION.md). Architecture and safety invariants are
documented in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Development

```bash
git clone https://github.com/wormforce/sustech-cli.git
cd sustech-cli
npm ci
npm run check
npm test
npm run build
node dist/cli.js --help
```

Cross-platform CI runs checks, tests, native credential-store smoke tests where
available, and `npm pack --dry-run` on Ubuntu, macOS, and Windows. Releases use
the tagged, manually triggered Trusted Publishing workflow in
[.github/workflows/publish.yml](.github/workflows/publish.yml); no long-lived npm
token is stored in GitHub.

## Attribution and license

This project is a TypeScript reimplementation informed by
[`dumixthestpd/sustech_survival`](https://github.com/dumixthestpd/sustech_survival).
It preserves that project's required copyright notice and is distributed under
the PolyForm Noncommercial License 1.0.0. See [NOTICE.md](NOTICE.md) and
[LICENSE](LICENSE).
