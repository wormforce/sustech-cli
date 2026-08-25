# Architecture

The CLI is organized around one rule: service logic returns typed values and
never prints. Commands turn those values into a `CommandResult`; the output
layer renders text, JSON, or JSONL.

```text
command parser
    ↓
command handler       validates intent and confirmation
    ↓
service client        authentication, HTTP, pagination, normalization
    ↓
typed domain result
    ↓
output renderer       text | versioned JSON | streaming JSONL
```

## Boundaries

- `src/cli.ts` owns command routing and option validation.
- `src/core` owns credentials, errors, semesters, and output contracts.
- `src/tis` owns TIS protocol details and normalized course models.
- Services must not write to stdout or stderr.
- Mutation commands use a `preview` / `apply --confirm` pair.
- Machine-readable output is versioned by `schemaVersion`.
- Text is the default; agents opt into `--json` or `--jsonl` explicitly.

As the rewrite grows, each service will move under `src/services/<service>` and
each command family under `src/commands/<service>`. The current flat TIS layout
stays intentionally small during the first compatibility milestone.
