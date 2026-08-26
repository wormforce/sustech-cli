# TypeScript rewrite tracker

The Python repository remains unchanged and acts as behavioral reference only.
Ports are fixture-driven and land in this standalone repository. Opt-in,
read-only live smoke tests on 2026-08-26 covered TIS enrollment reads,
Blackboard courses, WS programs, eHall rooms, and library-booking identity,
summary, lab, and reservation-count reads. PMS remained blocked by its
campus-network gate; no mutation was attempted.

| Area | Read operations | Mutations | Status | Priority |
| --- | --- | --- | --- | --- |
| Core CLI | text/JSON/JSONL, typed errors, exit codes, capabilities, consequences, cross-platform system credential profiles | local credential login/logout, confirmation policy | Implemented | P0 |
| CI | cross-platform check/test/pack workflow | none | Active at `.github/workflows/ci.yml` | P0 |
| SSO/CAS | shared CAS sessions for TIS, Blackboard, and WS | none | Implemented; opt-in live login smoke passed for all three | P0 |
| TIS catalog | search, normalized schedules, cache | none | Implemented | P0 |
| TIS personal | selectable courses, normalized enrolled/week schedule | enroll | Enrolled read live-smoked; other reads still need targeted live QA | P0 |
| TIS academics | grades/GPA, exams | none | Implemented; live QA pending | P1 |
| TIS planning | week-aware timetable solver, blocked periods | none | Implemented with fixtures | P1 |
| TIS remaining | classrooms, evaluation status, iCal export, selection payload previews, bid planning | cart, drop, bids | Read and preview paths implemented; live QA pending; no apply commands except enroll | P1 |
| Calendar | academic terms, holidays, date intelligence | local override not ported | Read paths implemented | P1 |
| Transit | facilities, search, lines, schedules, stops, live GPS | none | Implemented and live-smoked; routing not ported | P1 |
| Faculty | department list, search, profile render | none | Implemented and live-smoked; use exact department labels from the public index | P1 |
| Context | truthful snapshot with per-source availability | none | Initial implementation; currently calendar-derived plus explicit missing-source markers | P1 |
| Resources | built-in campus resource registry and search | none | Implemented | P1 |
| Wi-Fi | current association and recent macOS SUSTC Wi-Fi events | none | Implemented on macOS only | P1 |
| Blackboard | courses, content, teacher-provided attachment listing/download, assignments, attempts | Classic assignment submission | CLI CAS login and courses read live-smoked; attachment download and the hash-bound submission workflow use official Learn REST/BBML paths and remain fixture-tested | P2 |
| Library catalog | Primo browser handoff URL | none | URL builder only; browser-backed fetch still unavailable | P2 |
| Library booking | account state, idle summary, labs, rooms, reservation counts, reservations | reservations/cancel | Login, account, summary, labs, and count live-smoked; rooms/reservations still fixture-only | P2 |
| E-Hall booking | user profile, rooms, meetings | reservations/cancel | Login and rooms read live-smoked; meetings still fixture-only | P2 |
| SUSTech Global | program list and detail | service-specific writes | CLI CAS login and program list live-smoked; detail still fixture-only | P2 |
| PMS | auth check, printer groups, stations, print jobs, scan jobs, usage history | print operations | Live attempt reached the campus-network gate before login; auth remains fixture-verified and first account link may still need browser help | P2 |
| NCES | course evaluations and search | refresh/import | Implemented; public API only | P3 |
| Papers | CrossRef metadata and optional OA resolution | downloads | Implemented and live-smoked; bibliographic relevance plus OA links only | P3 |
| Web UI | local human interface | selection workflows | Separate package later | P4 |

## Porting order

1. Finish targeted live QA for remaining authenticated reads and retry PMS from the campus network.
2. Run a Blackboard submission preview against a real Classic assignment; keep the first real write user-confirmed and supervised.
3. Decide whether library catalog stays browser-backed or moves to a dedicated helper package.
4. Expand `context` beyond the current calendar-derived baseline.
5. Decide whether PMS needs a dedicated first-link browser assist instead of pure CLI fallback messaging.
6. Build a separate Web UI package on top of the same typed service layer.

Every mutation stays unavailable until its preview payload, confirmation gate,
success criteria, and post-action verification have fixture tests. As of
preview v0.6.0, the exposed remote mutation commands are the guarded
`tis enroll apply` and `bb submit apply` flows. Blackboard submission is still
fixture-validated only; booking, library-booking, and PMS continue to expose
authenticated reads only, and their write operations remain unavailable in this
repository.
