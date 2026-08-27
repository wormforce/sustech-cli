# TypeScript rewrite tracker

The Python repository remains unchanged and acts as behavioral reference only.
Ports are fixture-driven and land in this standalone repository. Opt-in,
read-only live smoke tests on 2026-08-26 covered TIS enrollment reads,
Blackboard courses, WS programs, eHall rooms, and library-booking identity,
summary, lab, and reservation-count reads. PMS remained blocked by its
campus-network gate. All newly added mutation paths remain fixture-tested only;
no real account mutation was attempted while completing this expansion.

| Area | Read operations | Mutations | Status | Priority |
| --- | --- | --- | --- | --- |
| Core CLI | text/JSON/JSONL, typed errors, exit codes, capabilities, consequences, structured doctor, cross-platform system credential profiles | local credential login/logout, guarded file writes, confirmation policy | Implemented | P0 |
| CI | cross-platform check/test/pack workflow | none | Active at `.github/workflows/ci.yml` | P0 |
| SSO/CAS | shared CAS sessions for TIS, Blackboard, and WS | none | Implemented; opt-in live login smoke passed for all three on 2026-08-26, while fresh login on 2026-08-27 was blocked before password submission by the current interactive slide CAPTCHA | P0 |
| TIS catalog | search, normalized schedules, cache | none | Implemented | P0 |
| TIS personal | selectable courses, normalized enrolled/week schedule | enroll | Enrolled read live-smoked; other reads still need targeted live QA | P0 |
| TIS academics | grades/GPA, exams, TIS-reported structured degree progress, conservative missing-course classification | none | Implemented with fixtures; live QA pending | P1 |
| TIS planning | persistent week-aware timetable plans, scored solver, blocked periods, conservative local degree audit | guarded local plan files | Implemented with fixtures | P1 |
| TIS remaining | catalog and live classroom views, evaluation status, multi-source iCalendar export, selection previews, bid planning | enroll, cart, drop, single and batch bids | Implemented with explicit confirmation and exact post-readback for remote writes; live QA pending | P1 |
| Calendar | academic terms, holidays, date intelligence | local override not ported | Read paths implemented | P1 |
| Transit | facilities, search, lines, schedules, stops, live GPS | none | Implemented and live-smoked; routing not ported | P1 |
| Faculty | department list, search, profile render | none | Implemented and live-smoked; use exact department labels from the public index | P1 |
| Context and profile | truthful calendar/live-class/exam/deadline context; whitelisted student summary with independent source status | guarded versioned profile export | Implemented with conservative omissions and masked identity fields | P1 |
| Academic snapshots | normalized TIS state with optional Blackboard deadlines; verified offline diff | guarded versioned snapshot files | Implemented with digest verification and no-overwrite defaults | P1 |
| Resources | built-in campus resource registry and search | none | Implemented | P1 |
| Wi-Fi | current association and recent macOS SUSTC Wi-Fi events | none | Implemented on macOS only | P1 |
| Blackboard | courses, content, teacher-provided attachment listing/download, assignments, deadlines, calendar REST reads, search, attempts, native calendar-link storage/fetch | guarded local sync, optional ICS write, Classic assignment submission | CLI CAS login and courses read live-smoked; calendar reads, native feed-link storage/fetch, local download/sync, and the hash-bound submission workflow use official Learn REST/BBML paths or keyring fixtures and remain conservatively documented | P2 |
| Library catalog | Primo browser handoff URL | none | URL builder only; browser-backed fetch still unavailable | P2 |
| Library booking | account state, idle summary, labs, rooms, reservation counts, reservations | guarded create/cancel | Login, account, summary, labs, and count live-smoked; room/reservation reads and writes remain fixture-only | P2 |
| E-Hall booking | redacted user profile, rooms, meetings | guarded create/cancel | Login and rooms read live-smoked; meeting reads and writes remain fixture-only | P2 |
| SUSTech Global | program list and detail | service-specific writes | CLI CAS login and program list live-smoked; detail still fixture-only | P2 |
| PMS | auth check, printer groups, stations, print jobs, scan jobs, usage history | guarded queue upload/delete | Live attempt reached the campus-network gate before login; auth and writes remain fixture-verified and first account link may still need browser help | P2 |
| NCES | course evaluations and search | refresh/import | Implemented; public API only | P3 |
| Papers | CrossRef metadata and optional OA resolution | guarded OA PDF download | Search implemented and live-smoked; PDF signature, redirect, destination, size, and digest checks are fixture-tested | P3 |
| Web UI | local human interface | selection workflows | Separate package later | P4 |

## Porting order

1. Finish targeted live QA for remaining authenticated reads and retry PMS from the campus network.
2. Exercise only read-only previews against real booking, library-booking, PMS,
   selection, and Blackboard targets before considering any supervised write.
3. Decide whether library catalog stays browser-backed or moves to a dedicated helper package.
4. Decide whether PMS needs a dedicated first-link browser assist instead of pure CLI fallback messaging.
5. Build a separate Web UI package on top of the same typed service layer.

Every mutation stays unavailable until its preview payload, confirmation gate,
success criteria, and post-action verification have fixture tests. As of
preview v0.8.4, guarded remote mutations include TIS enroll/cart/drop/bid,
Blackboard submission, eHall and library booking create/cancel, and PMS queue
upload/delete. They require an exact typed target, fresh preflight, explicit
`--confirm`, and operation-specific read-back; an ambiguous result exits 5 with
`DO_NOT_RETRY_AUTOMATICALLY`. These paths are fixture-validated only. Legacy
venue borrowing, library early-finish, scan download, raw TIS queries, and
browser-driven vendor/database automation remain intentionally unavailable
because the reference implementation does not provide a trustworthy,
verifiable CLI boundary.
