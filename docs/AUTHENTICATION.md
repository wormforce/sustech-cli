# Authentication and credential storage

`sustech-cli` separates long-lived account credentials from short-lived service
sessions. An account password may be persisted only in the operating system's
credential store. Blackboard's native calendar subscription link is handled as
a separate secret. CAS cookies, bearer tokens, PMS session IDs, nonces, and
submission state remain in memory.

## Local desktop login

```bash
sustech auth login
sustech auth status
sustech auth check --service bb
sustech auth logout
```

`auth login` prompts for the SID and hides password input. It verifies the
credentials against Blackboard CAS by default and writes them only after a
successful login. Select another validation path with `--service`.

The password is never accepted as a command-line argument. For controlled
non-interactive input, provide the SID separately and redirect exactly one
password line from a secret provider into:

```bash
sustech auth login --sid 12410000 --password-stdin --service bb
```

Do not place a literal password in shell history.

Fresh CAS login is not always password-only. If CAS serves an interactive slide
CAPTCHA, the CLI stops before password submission and returns
`CAS_INTERACTIVE_CHALLENGE_REQUIRED`. It does not attempt to bypass that
challenge.

## Primo browser mode

The library catalog browser flow is separate from `auth login`:

```bash
sustech library search "graph neural networks" --browser
sustech library search "graph neural networks" --browser --interactive
sustech library detail PC:cdi_proquest_miscellaneous_1901310093 --browser
```

This mode is read-only and manual-auth only:

- the CLI does not accept a browser username, password, cookie, or token
- if Primo redirects to CAS, the user must complete that page themselves in the
  opened browser window
- the CLI does not solve CAPTCHAs or automate the challenge
- browser cookies are not persisted by the CLI

Use it when the host cannot complete the public Primo HTTP path directly or
when the record is easier to reach through the browser transport.

## Platform backends

| Platform | Backend | Persistence rule |
| --- | --- | --- |
| macOS | Keychain through the native Security framework | persistent for the current user |
| Windows | Credential Manager | persistent for the current Windows user |
| Linux desktop | freedesktop Secret Service through `secret-tool` | persistent when the user's collection is available and unlocked |
| Headless Linux, container, CI | no implicit local backend | inject from an external secret manager |

Linux deliberately requires a desktop D-Bus session and the distribution's
`secret-tool`/`libsecret-tools` package. It does not silently fall back to a
plaintext file or a session-only kernel keyring.

Credential writes are verified by an immediate read-back before profile
metadata is committed. Linux errors distinguish a locked collection, a missing
desktop D-Bus/Secret Service session, an access denial, and an unclassified
`secret-tool` failure. Run `sustech auth status --json` in the same unlocked
graphical session and follow its `remediation`; do not delete profile metadata
or assume the password expired merely because the collection is locked.

## Profiles

The default profile is named `default`. Multiple accounts use explicit names:

```bash
sustech auth login --profile personal
sustech auth check --profile personal --service tis
sustech bb courses --profile personal
sustech auth logout --profile personal
```

`SUSTECH_PROFILE` selects a default profile for commands that do not pass
`--profile`. Re-running `auth login` updates the password for the same SID only;
a profile cannot silently switch to a different account. Saving another named
profile never changes the implicit `default` profile.

The CLI writes non-secret profile metadata with mode `0600` where POSIX modes
exist. `XDG_CONFIG_HOME` takes precedence; otherwise the path is:

- macOS: `~/Library/Application Support/sustech-cli/credentials.json`
- Windows: `%APPDATA%\sustech-cli\credentials.json`
- Linux: `~/.config/sustech-cli/credentials.json`

This file contains the SID, credential reference, selected backend, and storage
timestamp. It never contains the password.

## Blackboard calendar links

Blackboard's native shared calendar link is not part of `auth login`. It is a
bearer-like secret in its own operating-system credential-store namespace and
is stored without on-disk profile metadata. The current namespace is
`cn.edu.sustech.cli.bb-calendar-link`, separate from the CAS credential entry.

The CLI intentionally refuses a URL command argument for this workflow. Save the
link through stdin only:

```bash
# macOS
pbpaste | sustech bb calendar-link set --url-stdin
# Windows PowerShell
Get-Clipboard | sustech bb calendar-link set --url-stdin
```

`bb calendar-link set` validates that the link is a supported Learn ICS feed on
`bb.sustech.edu.cn` before storing it. `show` masks the token by default and
requires `--reveal` to print the full link. `fetch` reads the stored secret and
either prints ICS content or writes it to an explicit destination, with
`--overwrite` required to replace an existing file. `delete` removes the stored
link for that profile.

```bash
sustech bb calendar-link show
sustech bb calendar-link show --reveal
sustech bb calendar-link fetch
sustech bb calendar-link fetch --destination ./blackboard.ics
sustech bb calendar-link delete
```

The CLI normalizes and stores the native Learn feed URL copied from Blackboard.
In practice this is usually the account-level shared calendar feed, so treat it as
an all-courses subscription for that Blackboard account unless Blackboard
itself issued a narrower feed. Because the feed is a direct secret link,
`bb calendar-link fetch` can work even when a fresh CAS login would currently
stop at `CAS_INTERACTIVE_CHALLENGE_REQUIRED`.

For the upstream UI flow, see the
[SUSTech-specific calendar-link guide](https://sustech.online/service/blackboard/retrive-ics-url/)
and Anthology's official
[Blackboard calendar documentation](https://help.anthology.com/blackboard/student/en/getting-started/calendar.html).

## Resolution precedence

Authenticated commands resolve credentials in this order:

1. explicit `--credentials-file`
2. `SUSTECH_SID` plus `SUSTECH_PASSWORD`
3. `SUSTECH_CREDENTIALS_FILE`
4. selected system credential-store profile

The first three paths are compatibility and automation overrides. Do not keep
`SUSTECH_PASSWORD` in a shell startup file; inject it only into the process that
needs it. A credentials file is plaintext and should be used only when an
external runner already protects that file.

## Failure behavior

- A missing safe backend returns `CREDENTIAL_STORE_UNAVAILABLE`.
- Invalid or corrupt profile metadata is never overwritten automatically.
- Failed remote authentication does not update the stored password.
- Metadata-write failures restore and verify the prior credential-store state;
  an unverifiable rollback fails closed with `CREDENTIAL_STORE_ROLLBACK_FAILED`.
- Keyring and session values are excluded from text, JSON, JSONL, errors, and
  capability output.
- Blackboard calendar-link storage never writes the link token into
  `credentials.json`.
- `auth logout` deletes the system-store item and its local profile metadata;
  it does not alter the SUSTech account itself.
