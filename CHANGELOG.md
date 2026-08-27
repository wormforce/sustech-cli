# Changelog

All notable changes to `sustech-cli` are documented in this file.

## [0.7.0] - 2026-08-27

### Added

- Added `doctor` for structured diagnostics with per-service status reporting and optional live checks.
- Added guarded open-access PDF downloads through `papers fetch-oa`.
- Added persistent local TIS planning through `tis plan`, including saved course choices, blocked periods, preferences, and solver handoff.
- Added `tis degree audit`, which evaluates completed coursework against a user-supplied local JSON requirements file and keeps ambiguous or unsupported cases unresolved instead of guessing.
- Added TIS live classroom views and guarded apply paths for cart, drop, and bid operations with preview/apply separation, explicit `--confirm`, and post-write readback.
- Expanded `tis ical` from schedule export to a multi-source export that can also include exams, Blackboard deadlines, and academic-calendar holidays.
- Added Blackboard `bb deadlines`, `bb search`, and `bb sync`; hardened the existing attachment, attempts, and guarded Classic/Original assignment submission flows.
- Added `profile show`, `profile export`, `academic snapshot save`, and `academic snapshot diff` for conservative local academic reporting and offline comparison.
- Added guarded booking, library booking, and PMS mutation workflows with explicit apply commands.
- Added the repository-shipped agent skill at `skills/sustech-cli/SKILL.md`.

### Changed

- Expanded the self-describing CLI surface so `capabilities` and `consequences` cover the new commands and confirmation boundaries.
- Hardened local file writes for exports and downloads with no-overwrite defaults, symbolic-link rejection, digest verification where applicable, and private-permission handling for saved reports.
- Improved portability and safety across macOS, Linux, and Windows, including credential-store handling, confirmation helpers, and Windows local-write fixes.
- Updated documentation for the broader guarded workflow model and the larger authenticated command surface.

### Notes

- Blackboard native calendar subscription URLs are not exposed by the CLI in this release. Calendar export is provided through `tis ical`.
- `tis degree audit` is a conservative local audit, not an official server-side degree audit. It requires a local JSON requirements document and intentionally fails closed on unclear matches.
- This release includes broader fixture coverage and selected opt-in live smoke checks for read flows, but it should not be read as full live end-to-end verification for every command or mutation path.
