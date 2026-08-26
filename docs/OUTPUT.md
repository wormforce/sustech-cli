# Output contract

The CLI has one typed command result and three renderers. Human text is the
default. Agents opt into `--json`; pipelines that consume large lists use
`--jsonl`.

## JSON

Successful commands emit exactly one object to stdout:

```json
{
  "schemaVersion": "1",
  "ok": true,
  "command": "tis courses search",
  "data": {},
  "meta": {}
}
```

Failures requested in a machine mode also emit exactly one parseable object to
stdout and set a non-zero process exit code:

```json
{
  "schemaVersion": "1",
  "ok": false,
  "command": "tis enroll apply",
  "error": {
    "code": "CONFIRMATION_REQUIRED",
    "message": "...",
    "details": {}
  }
}
```

`meta` and `error.details` are optional. Consumers must use `ok`, `command`,
and `error.code`, rather than matching human messages.

## JSONL

List commands emit one `type: "item"` record per result followed by one
`type: "summary"` record. A scalar command emits one `type: "result"` record.
An error emits one `type: "error"` record and a non-zero exit code.

Every line is independent JSON. JSONL is never pretty-printed.

## Streams and exit codes

- Text results: stdout.
- Text errors and future progress diagnostics: stderr.
- JSON/JSONL results and errors: stdout, so the requested stream remains
  parseable. stderr is reserved for diagnostics that are outside the contract.
- `0`: success.
- `1`: network, protocol, or upstream service failure.
- `2`: usage, credentials, or authentication failure.
- `3`: a mutation was attempted without explicit confirmation.
- `4`: a mutation precondition failed or TIS rejected the mutation.
- `5`: a write may have partially completed and its final state is unknown;
  do not retry automatically.

Exit status is authoritative even when an error envelope was parsed.

## Compatibility

Adding optional fields does not change `schemaVersion`. Removing or renaming a
field, changing its type, or changing JSONL record semantics requires a new
schema version. Command availability and safety metadata are discoverable with
`sustech capabilities --json`.

Credential commands return backend, profile, availability, and masked account
metadata only. Passwords, cookies, bearer tokens, and keyring values are never
part of text, JSON, JSONL, error details, or capability output.

Blackboard attachment listings likewise omit signed `bbcswebdav` URLs. A
successful `bb download` result contains only stable attachment metadata, the
absolute destination path, byte count, content type, and SHA-256.
