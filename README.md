<p align="center">
  <img src="docs/assets/sustech-cli.svg" alt="sustech cli" width="460">
</p>

<p align="center">
  <strong>One calm command line for life at SUSTech.</strong><br>
  Courses, Blackboard, calendar, library, campus services, and agent-ready context.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/sustech-cli"><img alt="npm" src="https://img.shields.io/npm/v/sustech-cli?style=flat-square&color=ED6D00"></a>
  <a href="https://github.com/wormforce/sustech-cli/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/wormforce/sustech-cli/ci.yml?branch=main&style=flat-square&label=build&color=004748"></a>
  <a href="https://www.npmjs.com/package/sustech-cli"><img alt="Node.js" src="https://img.shields.io/node/v/sustech-cli?style=flat-square&color=004748"></a>
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/badge/license-PolyForm%20Noncommercial-555555?style=flat-square"></a>
</p>

<p align="center">
  <a href="#quick-start"><strong>Quick start</strong></a> ·
  <a href="#what-it-does">What it does</a> ·
  <a href="#for-ai-assistants">AI assistants</a> ·
  <a href="#safety-by-default">Safety</a> ·
  <a href="#documentation">Docs</a>
</p>

`sustech-cli` brings frequently used SUSTech services into one consistent
TypeScript CLI. It is pleasant in a terminal, predictable in scripts, and
self-describing for coding agents. Human-readable text is the default;
versioned JSON and JSONL are available whenever software needs a stable
interface.

> [!IMPORTANT]
> This is an independent community project, not an official SUSTech service.
> It never bypasses CAPTCHA or other interactive challenges. Review a command
> before allowing it to change university or local state.

## Quick Start

Requires Node.js 20.18 or newer.

```bash
npm install --global sustech-cli
sustech
```

The first screen shows the active account, runtime, and useful next actions.
Public commands work immediately:

```bash
sustech calendar day
sustech talks list
sustech library search "graph neural networks" --limit 5
sustech faculty search "computer vision"
```

Sign in once for personal services:

```bash
sustech auth login
sustech context --live
sustech tis schedule
sustech bb deadlines --days 14
```

Try a command without installing globally:

```bash
npm exec --package=sustech-cli -- sustech version
```

## What It Does

| Area | Useful commands | Access |
| --- | --- | --- |
| Daily snapshot | `context`, `profile show`, `academic changes` | Public calendar plus optional TIS and Blackboard reads |
| Teaching system | courses, schedule, grades, exams, degree progress, planning, iCalendar | SUSTech account |
| Blackboard | courses, content, assignments, deadlines, grades, announcements, discussions, files | SUSTech account |
| Campus calendar | teaching weeks, holidays, makeup days, term dates | Public |
| Library | live Primo search/detail, rooms and reservations | Public catalog; account for bookings |
| Campus services | classrooms, booking, printing, programs, Wi-Fi, transit | Public, local, or account-backed |
| Discovery | faculty, lectures, handbook, contacts, NCES, papers | Public |
| Agent interfaces | JSON, JSONL, Agent Skill, local MCP server | Local |

The installed version is the source of truth:

```bash
sustech --help
sustech capabilities --json --pretty
sustech describe context --json --pretty
```

### A useful day in one command

`context` creates a compact snapshot designed for people and assistants:
date, teaching week and parity, holiday or makeup-day rules, current and next
class, upcoming work, exams, weather, AQI, and library status.

```bash
sustech context --level terse
sustech context --live
sustech context --live --level verbose
sustech context --live --json
```

Live sources run concurrently. Missing credentials and unavailable upstreams
are reported as partial data rather than silently turned into “nothing found.”
All academic times use Asia/Shanghai.

### Live library catalog

Library search reads the university's public Primo catalog directly, so results
stay current without shipping a large offline database:

```bash
sustech library search "三体" --limit 5
sustech library detail L:alma991001055219704181
```

The normal path uses Primo's public JSON endpoints. A manual browser transport
is available when a host cannot complete the direct path:

```bash
sustech library search "三体" --browser --interactive
```

## For AI Assistants

The CLI exposes its capabilities, output contracts, and mutation consequences
as structured data. Agents should inspect these instead of parsing this README
or guessing flags.

```bash
sustech capabilities --json
sustech consequences --json
sustech describe "tis enroll apply" --json
```

Install the bundled Agent Skill:

```bash
npx skills add wormforce/sustech-cli --skill sustech-cli
```

For a global Codex installation:

```bash
npx skills add wormforce/sustech-cli --skill sustech-cli --global --agent codex
```

Clients with MCP support can launch the local `sustech-mcp` stdio server. Its
typed surface is intentionally read-only: authenticated data, browser flows,
local writes, and remote mutations stay in the CLI. See [MCP setup](docs/MCP.md).

## Output That Composes

```bash
# Friendly terminal output
sustech tis courses search "machine learning"

# One versioned JSON envelope
sustech tis courses search "machine learning" --json

# One item per line, followed by a summary
sustech tis courses search "machine learning" --jsonl
```

Every machine-readable response has a stable envelope and the process exit
status remains authoritative. See the [output contract](docs/OUTPUT.md).

## Safety by Default

Read commands are easy; writes are deliberately explicit. Remote mutations
follow the same lifecycle:

```text
resolve exact target → preview / preflight → approve → --confirm → read back
```

For example:

```bash
sustech tis enroll preview \
  --course-id TIS_INTERNAL_ID --rwh TASK_ID --round bxxk --bid 2

sustech tis enroll apply \
  --course-id TIS_INTERNAL_ID --rwh TASK_ID --round bxxk --bid 2 --confirm
```

If a write result is ambiguous, the CLI reports
`DO_NOT_RETRY_AUTOMATICALLY`. It does not trade uncertainty for a duplicate
submission.

<details>
<summary><strong>Commands that can change remote state</strong></summary>

- `tis enroll apply`, `tis selection apply`, `tis bid apply`
- `bb submit apply`, `bb message-send apply`,
  `bb discussion-post apply`, `bb discussion-reply apply`
- `booking create apply`, `booking cancel apply`
- `lib-booking create apply`, `lib-booking cancel apply`
- `pms upload apply`, `pms delete apply`

All require an exact target and explicit confirmation. Local exports also use
guarded paths and do not overwrite existing files unless the command documents
and receives an overwrite option.

</details>

## Credentials

`sustech auth login` verifies the account before storage. Passwords are entered
through a hidden prompt, never accepted as ordinary command-line arguments, and
never written to the normal config file.

| Environment | Credential storage |
| --- | --- |
| macOS | Keychain |
| Windows | Credential Manager |
| Linux desktop | Secret Service |
| Headless Linux | Password-encrypted local store when configured |
| Automation | Explicit environment or credentials-file override |

```bash
sustech auth status
sustech auth check --service bb --json
sustech doctor --live
sustech auth logout
```

Service cookies remain in memory. Browser-backed authentication is
user-completed and ephemeral. Read the full
[authentication guide](docs/AUTHENTICATION.md) before setting up headless or
automated use.

## Updates

Interactive terminals check npm for a newer stable release at most once every
24 hours and ask before installing it. CI, redirected commands, JSON, and JSONL
are never interrupted by a prompt.

```bash
sustech update
sustech update --yes
```

Set `SUSTECH_DISABLE_UPDATE_CHECK=1` to disable automatic checks.

## Documentation

| Guide | What it covers |
| --- | --- |
| [Command output](docs/OUTPUT.md) | JSON envelopes, JSONL, exit codes |
| [Authentication](docs/AUTHENTICATION.md) | profiles, credential backends, browser fallback |
| [MCP](docs/MCP.md) | local server setup and read-only boundary |
| [Academic snapshots](docs/ACADEMIC_SNAPSHOTS.md) | save, diff, changes, one-shot watch |
| [Course detail](docs/TIS_COURSE_DETAIL.md) | exact teaching-task selection and enrichment |
| [Degree progress](docs/DEGREE_PROGRESS.md) | official progress, missing courses, local audit |
| [Selection contracts](docs/SELECTION_CONTRACTS.md) | previews, identifiers, reconciliation |
| [Services](docs/SERVICES.md) | implementation and transport status |
| [Architecture](docs/ARCHITECTURE.md) | module boundaries and safety invariants |

## Development

```bash
git clone https://github.com/wormforce/sustech-cli.git
cd sustech-cli
npm ci
npm run check
npm test
```

Cross-platform CI covers Ubuntu, macOS, and Windows on supported Node.js
versions. Releases use npm Trusted Publishing; no long-lived npm token is
stored in GitHub.

## Project Status

Upstream university systems change independently and some authenticated flows
can stop at an interactive CAPTCHA. The CLI fails visibly when it cannot
establish reliable state; it does not claim success from an incomplete read.
Current transport notes and known limitations live in
[the service matrix](docs/SERVICES.md).

## Attribution and License

This project is informed by
[`dumixthestpd/sustech_survival`](https://github.com/dumixthestpd/sustech_survival)
and preserves its required copyright notice.

Distributed under the [PolyForm Noncommercial License 1.0.0](LICENSE). See
[NOTICE.md](NOTICE.md) for attribution details.
