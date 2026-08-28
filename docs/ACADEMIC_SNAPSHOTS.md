# Academic snapshots, changes, and one-shot watch

The academic snapshot workflow keeps one rule: live academic state is read
conservatively, saved as a private local artifact, and compared explicitly.

## Commands

```bash
sustech academic snapshot save --destination ./snapshot.json [--semester YYYY-YYYY-N] [--include-blackboard] [--overwrite]
sustech academic changes BEFORE AFTER
sustech academic watch --state ./academic-state.json [--semester YYYY-YYYY-N] [--include-blackboard]
```

## Snapshot save

`academic snapshot save` reads the current academic sources, writes one
versioned local JSON file, and verifies the saved digest before returning
success. On POSIX systems the CLI requests private `0600` permissions for this
personal academic artifact and rejects unsafe symbolic-link targets.

When `--include-blackboard` is set, Blackboard deadline data is included in the
saved snapshot. If Blackboard data is unavailable or partial, that source stays
marked as such in the saved file instead of being treated as a complete empty
deadline list.

## Changes

`academic changes BEFORE AFTER` is the read-only comparison command. It reports
added, removed, changed, unchanged, and unavailable source groups separately.
The diff is intentionally conservative:

- a source is comparable only when both snapshots contain complete enough data
  for that source
- partial or missing sources stay marked unavailable
- the command does not invent semantic equivalence across different source
  states

Use it when you already have two saved snapshots and want a stable offline diff.

## One-shot watch

`academic watch --state PATH` is not a background daemon. It runs once:

1. read the latest live academic snapshot
2. compare it with the existing state file at `PATH` when present
3. print the detected changes
4. update the local state file to the latest snapshot

It never loops, never schedules itself, and never writes remote campus state.
Its only mutation is the explicit local state file you named with `--state`.

`--semester` narrows the academic sources to a specific term when the underlying
source supports that filter. `--include-blackboard` extends the watched state to
include Blackboard deadlines.

## Source boundaries

The snapshot/change/watch workflow is about observation and local persistence.
It can read TIS and optional Blackboard data, but it does not:

- enroll, drop, bid, or otherwise change TIS selection state
- submit or modify Blackboard work
- poll continuously in the background
- infer hidden data when a source is partial or unavailable

For remote mutations elsewhere in the CLI, keep using the separate
preview/confirm/read-back flows.
