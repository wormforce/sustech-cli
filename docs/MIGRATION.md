# TypeScript rewrite tracker

The Python repository remains unchanged and acts as behavioral reference only.
Ports are fixture-driven and land in this standalone repository.

| Area | Read operations | Mutations | Status | Priority |
| --- | --- | --- | --- | --- |
| Core CLI | text/JSON/JSONL, typed errors, exit codes, capabilities, consequences | confirmation policy | Implemented | P0 |
| CI | cross-platform check/test/pack workflow | none | Active at `.github/workflows/ci.yml` | P0 |
| SSO/CAS | shared CAS sessions for TIS, Blackboard, and WS | none | Implemented; authenticated live QA pending | P0 |
| TIS catalog | search, normalized schedules, cache | none | Implemented | P0 |
| TIS personal | selectable courses, normalized enrolled/week schedule | enroll | Implemented; live QA pending | P0 |
| TIS academics | grades/GPA, exams | none | Implemented; live QA pending | P1 |
| TIS planning | week-aware timetable solver, blocked periods | none | Implemented with fixtures | P1 |
| TIS remaining | classrooms, evaluation status, iCal export, selection payload previews, bid planning | cart, drop, bids | Read and preview paths implemented; live QA pending; no apply commands except enroll | P1 |
| Calendar | academic terms, holidays, date intelligence | local override not ported | Read paths implemented | P1 |
| Transit | facilities, search, lines, schedules, stops, live GPS | none | Implemented and live-smoked; routing not ported | P1 |
| Faculty | department list, search, profile render | none | Implemented and live-smoked; use exact department labels from the public index | P1 |
| Context | truthful snapshot with per-source availability | none | Initial implementation; currently calendar-derived plus explicit missing-source markers | P1 |
| Resources | built-in campus resource registry and search | none | Implemented | P1 |
| Wi-Fi | current association and recent macOS SUSTC Wi-Fi events | none | Implemented on macOS only | P1 |
| Blackboard | courses, content, assignments | submissions/downloads | Read adapter implemented; CLI wired through CAS; authenticated live QA pending | P2 |
| Library catalog | Primo browser handoff URL | none | URL builder only; browser-backed fetch still unavailable | P2 |
| Library booking | account state, rooms, reservations | reservations/cancel | Read adapter implemented; CLI auth wiring not added yet | P2 |
| E-Hall booking | rooms and meetings | reservations/cancel | Read adapter and envelope builders implemented; CLI auth wiring not added yet | P2 |
| SUSTech Global | program list and detail | service-specific writes | Read adapter implemented; CLI wired through CAS; authenticated live QA pending | P2 |
| PMS | printer/account state and history | print operations | Read adapter implemented; CLI auth wiring not added yet | P2 |
| NCES | course evaluations and search | refresh/import | Implemented; public API only | P3 |
| Papers | CrossRef metadata and optional OA resolution | downloads | Implemented and live-smoked; bibliographic relevance plus OA links only | P3 |
| Web UI | local human interface | selection workflows | Separate package later | P4 |

## Porting order

1. Finish authenticated live QA for TIS, Blackboard, and WS read flows.
2. Add CLI auth/transport wiring for booking, library booking, and PMS.
3. Decide whether library catalog stays browser-backed or moves to a dedicated helper package.
4. Expand `context` beyond the current calendar-derived baseline.
5. Build a separate Web UI package on top of the same typed service layer.

Every mutation stays unavailable until its preview payload, confirmation gate,
success criteria, and post-action verification have fixture tests. As of
v0.3.0, the only live mutation is the existing guarded `tis enroll apply`
command; selection preview, bid planning, and service adapters stay read-only
or local-only.
