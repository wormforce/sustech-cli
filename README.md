# sustech-cli

A standalone TypeScript CLI for SUSTech services, designed for both people and
agents. It talks to campus services directly and never invokes Python at
runtime.

> Status: early preview. TIS authentication, catalog search, selectable-course
> search, enrolled-course lookup, and guarded enrollment are implemented. The
> remaining modules are tracked in [docs/MIGRATION.md](docs/MIGRATION.md).

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
every mode.

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
`apply` command.

## Attribution and license

This project is a TypeScript reimplementation informed by
[`dumixthestpd/sustech_survival`](https://github.com/dumixthestpd/sustech_survival).
It preserves that project's required copyright notice and is distributed under
the PolyForm Noncommercial License 1.0.0. See [NOTICE.md](NOTICE.md) and
[LICENSE](LICENSE).
