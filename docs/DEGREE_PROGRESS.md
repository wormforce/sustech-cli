# TIS degree progress

`sustech tis degree progress` reads the authenticated student's official
structured personalized “学业修读情况” from TIS. It is the preferred command for
questions such as “还差多少学分” or “哪个培养方案模块尚未完成”.

```bash
sustech tis degree progress
sustech tis degree progress --json --pretty
sustech tis degree progress --details --json
```

The default response includes:

- a whitelisted plan context such as cohort, major, and plan code;
- the TIS-reported credit/course summary;
- credit-category constraints and their notes;
- module requirements and a conservative `moduleGaps` view;
- independent source statuses and any disagreement warnings.

`--details` additionally requests the course-by-course plan table. Leave it off
when only a summary is needed. Structured output distinguishes
`detailsRequested` from `detailsIncluded`; a failed detail source is never
reported as a successful zero-row table.

The JSON document has `kind: "tis-degree-progress"` and `schemaVersion: "1"`.
It deliberately omits the student number, TIS student-row ID, and raw upstream
payloads. Credit-category rows can overlap—for example, a combined humanities
and social-science minimum may coexist with separate per-category minimums—so
consumers must not add every row together.

If every downstream source returns no usable plan data, the command fails with
`TIS_DEGREE_PROGRESS_NO_DATA` instead of presenting an empty object as official
progress. Per-source failures remain visible in `sourceStatuses`.

## Progress versus local audit

`tis degree progress` and the existing local JSON command `tis degree audit`
answer different questions:

- `degree progress` reports the personalized result calculated by TIS from the
  student's assigned cultivation plan.
- `degree audit --requirements FILE` applies a user-maintained local JSON rules
  file to live grade records. It remains useful for proposed rules, offline
  checking, or curricula not represented correctly in TIS.

The official progress response is not automatically rewritten into the local
audit schema. TIS can express nested modules, combined minima, language-placement
conditions, and free-text exceptions that the current flat audit schema cannot
represent losslessly. The local audit is therefore a separate conservative tool,
not a hidden serialization of the personalized TIS result.

Neither command is a final graduation determination. Confirm unusual results in
TIS and with the Teaching Affairs office.

## Authentication note

TIS currently may require an interactive slide CAPTCHA at CAS login. The CLI
detects that challenge, returns `CAS_INTERACTIVE_CHALLENGE_REQUIRED`, and stops
before submitting the stored password. It does not bypass CAPTCHAs. In that
state, the command remains implemented and fixture-tested, but a fresh
password-only CLI session cannot complete until an approved interactive/session
handoff is available.

## Curriculum PDF fallback

The public [SUSTech curriculum mirror](https://mirrors.sustech.edu.cn/courses/%E6%9C%AC%E7%A7%91%E4%BA%BA%E6%89%8D%E5%9F%B9%E5%85%BB%E6%96%B9%E6%A1%88/)
is the fallback for historical, offline, or unassigned plans. Cohorts through
2024 generally provide one text-based PDF per major; the 2025 curriculum is a
single text-based multi-major volume. Those files are useful for later
cataloguing and extraction, but they are not the student's personalized truth.
PDF-derived rules should retain cohort, major, page, and source-document
provenance instead of being silently treated as a live assigned plan.
