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
- `src/core/keyring.ts` keeps long-lived secrets behind platform adapters:
  macOS Keychain, Windows Credential Manager, or Linux Secret Service. CAS
  passwords and Blackboard native calendar links use separate secret
  namespaces. The local config contains profile metadata only for CAS
  credentials; the Blackboard calendar link does not create on-disk metadata.
- `src/sso` owns generic CAS session flow. TIS, Blackboard, and WS reuse this
  layer instead of reimplementing login logic separately.
- `src/tis` owns TIS protocol details, normalized course models, persistent
  planning, official degree-progress normalization, conservative local degree
  audit, live classroom/context helpers, multi-source ICS export, and guarded
  enroll/cart/drop/bid write paths.
- `src/calendar`, `src/faculty`, `src/transit`, `src/resources`, and
  `src/wifi` own public or local-only data sources.
- `src/context` composes a truthful snapshot from whichever sources are
  available and marks missing or partial inputs explicitly.
- `src/profile` aggregates only whitelisted student fields and can save a
  versioned, private local report without exposing raw upstream profiles.
- Academic snapshots and shared local-store helpers provide guarded,
  digest-verifiable local persistence and offline diffing.
- `src/services` owns reusable campus-service adapters such as Blackboard, WS,
  booking, library booking, PMS, NCES, and papers, plus the authenticated
  session wrappers that sit in front of some of them.
- `src/services/blackboard-calendar.ts` owns native Learn ICS-link validation,
  masking, safe same-origin fetch, and bounded ICS parsing for the stored
  Blackboard calendar subscription workflow.
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

3. Authenticated wrappers

   Booking, library-booking, PMS, and the CLI's CAS-backed Blackboard/WS
   entrypoints now have repo-owned login wrappers that:

   - retrieve credentials just in time and keep cookies and transient tokens in memory only
   - constrain service origins; booking, library-booking, and PMS additionally
     enforce documented read allowlists and typed write endpoint allowlists
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
- `bb submit preview` authenticates for live read-only preflight checks but
  never calls a mutation endpoint.
- `bb calendar` is an authenticated read with optional date, type, and course
  filters. `bb calendar-link set` validates a native Learn ICS feed and stores
  it as a separate operating-system secret; `show` masks it by default, and
  `fetch` can refresh the feed without a fresh CAS login.
- `bb attachments` keeps teacher-provided content files separate from student
  attempt files. `bb download` is a local mutation with an explicit destination,
  same-origin URL checks, exclusive no-overwrite placement, and a portable
  filesystem fallback when hard links are unavailable.
- Booking, library-booking, and PMS sessions keep credentials and session
  material in memory only, reject requests outside their allowlists, and never
  expose a generic authenticated write primitive.
- `auth login` verifies the selected service before storing a password in the
  operating-system credential store. Linux refuses a session-only keyutils or
  plaintext fallback when Secret Service is unavailable.
- If CAS responds with an interactive slide CAPTCHA, the shared login layer
  returns `CAS_INTERACTIVE_CHALLENGE_REQUIRED` before password submission
  instead of trying to bypass the challenge.
- Remote mutations cover TIS enroll/cart/drop/bid, Blackboard submission,
  eHall and library booking create/cancel, and PMS queue upload/delete. Every
  path requires `--confirm`; file-bound uploads additionally require the
  previewed SHA-256. These paths are protocol-fixture-tested, not live-written.
- Local file mutations such as Blackboard download/sync, OA PDF fetch,
  iCalendar/profile/snapshot export, and plan persistence require explicit or
  well-scoped destinations, reject symbolic-link traversal, default to
  no-overwrite, and request mode `0600` for personal academic artifacts on
  POSIX platforms. Windows uses the destination filesystem's ACLs rather than
  POSIX mode bits.
- Mutation commands use explicit preview/build phases and post-action
  verification. Any ambiguous remote result returns exit code 5 plus
  `DO_NOT_RETRY_AUTOMATICALLY` when write state cannot be determined safely.
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
