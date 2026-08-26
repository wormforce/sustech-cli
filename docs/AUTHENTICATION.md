# Authentication and credential storage

`sustech-cli` separates long-lived account credentials from short-lived service
sessions. A password may be persisted only in the operating system's credential
store; CAS cookies, bearer tokens, PMS session IDs, nonces, and submission
state remain in memory.

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
- `auth logout` deletes the system-store item and its local profile metadata;
  it does not alter the SUSTech account itself.
