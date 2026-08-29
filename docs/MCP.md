# Local MCP server

`sustech-cli` ships a local Model Context Protocol entrypoint named
`sustech-mcp`. It is `stdio` only: the client launches a local process and
speaks MCP over standard input and output. There is no hosted endpoint, open
port, background daemon, or shared multi-user server in this repo.

## Launch

After a global install, configure the client to launch:

```text
sustech-mcp
```

A typical local-command configuration looks like:

```json
{
  "mcpServers": {
    "sustech": {
      "command": "sustech-mcp"
    }
  }
}
```

Without a global install, a client that accepts `command` plus `args` can run
the published package through npm:

```json
{
  "command": "npm",
  "args": ["exec", "--yes", "--package=sustech-cli", "--", "sustech-mcp"]
}
```

For a source checkout, run `npm run build` first and point the client at the
absolute path to `dist/mcp/server.js`.

The entrypoint behavior is intentionally narrow:

- `sustech-mcp` starts the MCP `stdio` server.
- `sustech-mcp --help` prints local usage text and exits.
- `sustech-mcp --version` prints the installed `sustech-cli` version and exits.
- Any other argument is rejected on stderr with exit code `2`.

## Tool surface

The server exposes `33` typed public/local read-only tools. It does not expose
a generic string runner such as `sustech_run`.

Core metadata:

- `sustech_discover`
- `sustech_describe`
- `sustech_version`
- `sustech_calendar_day`
- `sustech_consequences`
- `sustech_calendar_terms`
- `sustech_resources_list`
- `sustech_resources_search`
- `sustech_services_status`

Public research and catalog data:

- `sustech_papers_search`
- `sustech_nces_browse`
- `sustech_nces_search`
- `sustech_nces_course`
- `sustech_library_search`
- `sustech_library_detail`
- `sustech_library_search_url`

Public faculty and campus datasets:

- `sustech_faculty_departments`
- `sustech_faculty_list`
- `sustech_faculty_get`
- `sustech_faculty_search`
- `sustech_faculty_render`
- `sustech_transit_facilities`
- `sustech_transit_find`
- `sustech_transit_lines`
- `sustech_transit_schedule`
- `sustech_transit_stops`
- `sustech_transit_live`

Public SUSTech Online layer:

- `sustech_online_search`
- `sustech_online_talks_list`
- `sustech_online_talks_search`
- `sustech_online_talks_get`
- `sustech_online_contact_search`
- `sustech_online_contact_get`

All tools return the same versioned JSON envelope that the direct CLI already
uses, both as `structuredContent` and as a text fallback. This keeps the CLI as
the installed source of truth while giving MCP clients typed input schemas.

## Resources and prompts

The server also exposes JSON resources and reusable prompts.

Static resources (`5`):

- `sustech://version`
- `sustech://capabilities`
- `sustech://services`
- `sustech://consequences`
- `sustech://mcp/policy`

Resource templates (`5`):

- `sustech://faculty/{slug}`
- `sustech://command/{command}`
- `sustech://online/talk/{id}`
- `sustech://nces/course/{id}`
- `sustech://library/{context}/{docId}`

Prompts (`4`):

- `sustech_public_lookup`
- `sustech_guarded_cli_review`
- `sustech_course_research`
- `sustech_talk_digest`

The static policy resource documents the transport and safety boundary. The
template resources reuse the same typed CLI paths as the tool surface instead
of inventing a second parser. Template variables are validated locally before
the CLI subprocess starts. For commands with spaces, use normal URL encoding,
for example `sustech://command/calendar%20day`.

## Safety boundary

This MCP server is intentionally narrower than the CLI.

- No authenticated personal data is exposed through MCP.
- No local private state is exposed through MCP.
- No local file writes are exposed through MCP.
- No remote mutations are exposed through MCP.
- No browser-assisted or interactive flows are exposed through MCP.
- No generic shell or generic CLI runner is exposed through MCP.

In practice, that means MCP excludes commands and flags such as:

- authenticated TIS, Blackboard, booking, library-booking, PMS, profile, and
  auth flows;
- `context --live`, `wifi status`, `wifi events`, and other local/private
  machine state;
- persistent `tis plan` writes;
- downloads, exports, and other filesystem outputs;
- `--confirm`, `--browser`, `--interactive`, `--credentials-file`,
  `--password-stdin`, `--url-stdin`, `--reveal`, and output-mode overrides.

The execution bridge validates the exact command name, blocks command-changing
arguments, validates resource-template variables before dispatch, launches the
packaged CLI without a shell, enforces size limits, and times out long-running
subprocesses.

If the MCP client cancels a request, the bridge aborts the underlying
`sustech` subprocess instead of leaving it running in the background.

Only protocol messages are written to standard output. Diagnostics stay on
standard error so they cannot corrupt the `stdio` stream.

## When to use the direct CLI instead

Use the direct `sustech` CLI whenever the task needs any of the following:

- authenticated campus data;
- remote apply/mutation workflows;
- preview/approval/`--confirm` sequences;
- local exports, downloads, or persistent plan edits;
- browser-assisted library fallback.

Those paths keep the repo's normal preview, explicit approval, apply, and
read-back verification model.

## Hosted deployments

This repo does not ship a hosted HTTP or Streamable HTTP MCP server. If a
future deployment needs cross-machine or shared access, it should be treated as
a separate product surface with its own authentication, authorization, rate
limits, audit logs, and server-side secret handling.
