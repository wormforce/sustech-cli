# sustech-cli

A standalone TypeScript CLI for SUSTech services, designed for both people and
agents. It talks to campus services directly and never invokes Python at
runtime.

> Status: preview. The selection-focused TIS command set and public transit
> queries are implemented without a Python runtime. Authenticated TIS commands
> still need fixture-backed live QA before a stable release. Remaining upstream
> modules are tracked honestly in [docs/MIGRATION.md](docs/MIGRATION.md).

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

## Implemented commands

```text
sustech capabilities
sustech auth check
sustech tis courses search [KEYWORD]
sustech tis courses available [KEYWORD] --round ROUND
sustech tis enrolled
sustech tis schedule [--week N|--all]
sustech tis grades [--semester YYYY-YYYY-N]
sustech tis exams
sustech tis timetable CODE... [--block MON:1-4] [--max N]
sustech tis enroll preview ...
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

## Authentication

Inject credentials through the environment when an agent runner owns secret
management:

```bash
export SUSTECH_SID='12410000'
export SUSTECH_PASSWORD='your-password'
sustech auth check
```

Alternatively set `SUSTECH_CREDENTIALS_FILE` or pass `--credentials-file` to a
file whose only content is `sid:password`. The CLI never writes credentials or
session cookies to disk.

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
