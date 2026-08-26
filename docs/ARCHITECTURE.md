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
  booking, library booking, PMS, NCES, and papers, plus the authenticated
  read-only session wrappers that sit in front of some of them.
- `src/core/capabilities.ts` is the machine-discoverable safety registry.
- Services must not write to stdout or stderr.
- Machine-readable output is versioned by `schemaVersion`.
- Text is the default; agents opt into `--json` or `--jsonl` explicitly.

## Service layers

The repo now has three service-facing patterns:

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

3. Authenticated read-only wrappers

   Booking, library-booking, and PMS now have repo-owned login wrappers that:

   - keep credentials, cookies, and transient tokens in memory only
   - constrain requests to documented read-only endpoint allowlists
   - normalize the resulting responses through the same typed service layer

`sustech services status` reports the reusable service layer, not only whether
a command exists. That is why booking, library-booking, and PMS now show
`implemented`, while Blackboard and WS still show `adapter_required` at the
service-module level even though the CLI already provides CAS-backed read
commands for them.

## Safety model

- Read commands never mutate remote state.
- Local planning commands such as `tis enroll preview`, `tis selection preview`,
  `tis bid plan`, and `library search-url` do not authenticate or write.
- Booking, library-booking, and PMS sessions keep credentials and session
  material in memory only and reject requests outside their read-only
  allowlists.
- The only live mutation currently exposed is `tis enroll apply --confirm`.
- Mutation commands use explicit preview/build phases and post-action
  verification where the upstream service allows it.
- Consequence metadata lives in `src/core/consequences.ts` so agents can inspect
  risks and follow-up checks without scraping prose.
- New authenticated campus-service wrappers are validated with protocol fixtures
  and transport guards. Opt-in read-only live smoke tests passed for booking and
  library-booking on 2026-08-26; PMS remained blocked by its campus-network gate.

## Current shape

As the rewrite grows, command routing will likely split out of `src/cli.ts`,
but the core rule stays the same: domain modules return typed values, renderers
format them, and the CLI layer is where auth, confirmation, and output mode
selection come together.
