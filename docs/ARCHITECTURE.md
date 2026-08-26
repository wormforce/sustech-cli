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

- `src/cli.ts` owns command routing, option validation, and user-facing help.
- `src/core` owns credentials, errors, output contracts, capabilities,
  consequences, and other shared primitives.
- `src/sso` owns generic CAS session flow. TIS, Blackboard, and WS reuse this
  layer instead of reimplementing login logic separately.
- `src/tis` owns TIS protocol details, normalized course models, planning, the
  guarded `enroll apply` write path, and the newer classroom/evaluation/ICS and
  selection-preview helpers.
- `src/calendar`, `src/faculty`, `src/transit`, `src/resources`, and
  `src/wifi` own public or local-only data sources.
- `src/context` composes a truthful snapshot from whichever sources are
  available and marks missing inputs explicitly.
- `src/services` owns reusable campus-service adapters such as Blackboard, WS,
  booking, library booking, PMS, NCES, and papers.
- `src/core/capabilities.ts` is the machine-discoverable safety registry.
- Services must not write to stdout or stderr.
- Machine-readable output is versioned by `schemaVersion`.
- Text is the default; agents opt into `--json` or `--jsonl` explicitly.

## Service layers

The repo now has two service-facing patterns:

1. Direct clients

   Modules such as TIS, transit, calendar, papers, and NCES can create or own
   their HTTP access directly because they are either public or use the repo's
   built-in authentication flow.

2. Adapter-first clients

   Modules in `src/services` accept a `ServiceAdapter` with a `fetch(...)`
   method. This keeps parsers and endpoint knowledge reusable across:

   - the CLI
   - future Web UI packages
   - tests with fixture-backed adapters
   - browser-backed or cookie-injected transports

`sustech services status` reports this adapter layer, not only whether a CLI
command happens to wrap it. For example, Blackboard and WS remain
`adapter_required` at the service-module level even though the CLI already
provides CAS-backed read commands for them.

## Safety model

- Read commands never mutate remote state.
- Local planning commands such as `tis enroll preview`, `tis selection preview`,
  `tis bid plan`, and `library search-url` do not authenticate or write.
- The only live mutation currently exposed is `tis enroll apply --confirm`.
- Mutation commands use explicit preview/build phases and post-action
  verification where the upstream service allows it.
- Consequence metadata lives in `src/core/consequences.ts` so agents can inspect
  risks and follow-up checks without scraping prose.

## Current shape

As the rewrite grows, command routing will likely split out of `src/cli.ts`,
but the core rule stays the same: domain modules return typed values, renderers
format them, and the CLI layer is where auth, confirmation, and output mode
selection come together.
