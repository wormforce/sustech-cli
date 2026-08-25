# TypeScript rewrite tracker

The Python repository remains unchanged and acts as behavioral reference only.
Ports are fixture-driven and land in this standalone repository.

| Area | Read operations | Mutations | Status | Priority |
| --- | --- | --- | --- | --- |
| Core CLI | text/JSON/JSONL, typed errors, exit codes | confirmation policy | Implemented | P0 |
| SSO/CAS | TIS login, cookie session | none | Initial implementation | P0 |
| TIS catalog | search, normalized schedules, cache | none | Initial implementation | P0 |
| TIS personal | selectable courses, enrolled schedule | enroll | Initial implementation; live QA pending | P0 |
| TIS remaining | terms, weeks, grades, exams, evaluations | cart, drop, bids | Not started | P1 |
| Calendar | academic terms, holidays, date intelligence | local override | Not started | P1 |
| Transit | schedules, live GPS, routing data | none | Not started | P1 |
| Faculty | department list, search, profile | none | Not started | P1 |
| Context | classes, deadlines, exams, weather/AQI snapshot | none | Not started | P1 |
| Blackboard | courses, content, assignments, downloads | submissions | Not started | P2 |
| Library | catalog/search, account state | room booking | Not started | P2 |
| E-Hall booking | resources and availability | reservations | Not started | P2 |
| SUSTech Global | programs and records | service-specific writes | Not started | P2 |
| PMS | printer/account state | print operations | Not started | P2 |
| NCES | course evaluations and search | refresh/import | Not started | P3 |
| Papers | CrossRef/CNKI/WoS/RSC search and fetch | downloads | Not started | P3 |
| Web UI | local human interface | selection workflows | Separate package later | P4 |

## Porting order

1. Stabilize TIS against live read-only fixtures and add remaining TIS reads.
2. Port pure-data modules: calendar, transit, faculty, and context.
3. Port authenticated services: Blackboard, library, booking, Global, and PMS.
4. Add optional browser-backed packages for services that cannot remain pure HTTP.
5. Build a separate Web UI package on top of the same typed service layer.

Every mutation stays unavailable until its preview payload, confirmation gate,
success criteria, and post-action verification have fixture tests.

The CI definition is currently stored as `docs/ci-workflow-template.yml`.
Activate it at `.github/workflows/ci.yml` after the pushing GitHub credential
has the `workflow` scope.
