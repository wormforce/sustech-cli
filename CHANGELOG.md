# Changelog

All notable changes to `sustech-cli` are documented in this file.

## [0.8.4] - 2026-08-27

### Added

- Added a branded terminal dashboard for a bare `sustech` invocation, with
  masked account and credential-store status plus context-aware quick-start
  commands.
- Added the SUSTech torch and wordmark to human-readable `sustech version`
  output, with color limited to compatible interactive terminals. Explicit
  help and machine-readable output remain unchanged.

## [0.8.3] - 2026-08-27

### Changed

- `tis degree missing` now prints a prominent warning that TIS data may be
  incomplete or inconsistent and that the student's applicable official
  cultivation plan is the primary reference.
- The JSON report now includes a structured `advisory` object directing
  discrepancies or uncertainty to the department secretary or Teaching
  Affairs Office (教学工作部).
- Updated the repository skill and documentation to describe degree progress
  as TIS-reported guidance rather than a final or authoritative determination.

## [0.8.2] - 2026-08-27

### Fixed

- The derived `tis degree missing` classifier now leaves same-name required
  courses unresolved when the matching grade or enrolled-course row lacks a
  reliable course code, instead of guessing by name and risking a false
  pass/in-progress classification.

## [0.8.1] - 2026-08-27

### Added

- Added `tis degree missing`, a one-command advisory report derived from the
  authenticated student's structured TIS degree progress, grade history, and
  current enrollment.
- Added explicit result groups for definite missing required courses,
  in-progress required courses, category/module choice gaps, and manual-review
  cases.

### Changed

- Current enrollment defaults to TIS current-term metadata, with an explicit
  date-based fallback status and optional `--semester` override.
- Unknown grades, conditional notes, overlapping requirements, and unavailable
  secondary sources now remain unresolved instead of being forced into an
  exact missing-course list.
- Updated the repository skill and degree-progress documentation to route
  exact-course questions to the new command while preserving the authority
  boundary between TIS progress, derived guidance, and local JSON audits.

### Notes

- The classifier is covered by fixtures for retakes, current enrollment,
  name fallback, unknown results, and partial sources. Fresh live TIS QA remains
  subject to the interactive CAS challenge described in the 0.8.0 notes.

## [0.8.0] - 2026-08-27

### Added

- Added `tis degree progress` for the authenticated student's structured,
  TIS-calculated cultivation-plan summary, credit-category constraints, module
  gaps, and optional course-level details.
- Added `bb calendar` for typed Blackboard calendar-item reads with date,
  course, and item-type filters, including bounded long-window pagination and
  partial-failure reporting.
- Added `bb calendar-link set/show/fetch/delete` for Blackboard's native shared
  iCalendar feed. Links are accepted only through stdin, validated before
  storage, kept in a separate operating-system keyring namespace, and masked by
  default.

### Changed

- Distinguished the official personalized TIS progress snapshot from the
  existing user-supplied local JSON `tis degree audit` workflow.
- Added explicit detection of the current interactive CAS slide CAPTCHA. The
  CLI now returns `CAS_INTERACTIVE_CHALLENGE_REQUIRED` before password
  submission instead of attempting to bypass the challenge.
- Hardened Blackboard calendar-feed redirects, size and content validation,
  token redaction, and machine output; unnecessary internal creator IDs are no
  longer exposed in normalized calendar items.
- Updated the repository-shipped `sustech-cli` agent skill and documentation for
  the new calendar and degree-progress workflows.

### Notes

- TIS degree progress and Blackboard native-feed handling are covered by
  protocol, normalization, keyring, and CLI fixtures. Fresh live TIS/Blackboard
  QA was limited on 2026-08-27 by the interactive CAS challenge.
- The public curriculum PDF mirror remains a historical/offline fallback; PDF
  rules are not silently substituted for the student's live assigned TIS plan.

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
