# TIS course detail

`tis courses detail` is a read-only addition to the course-selection workflow.
It retrieves one exact course and teaching task without changing enrollment.

```bash
sustech tis courses detail BMEB316 --semester 2026-2027-1
sustech tis courses detail BIO102B --rwh 2026-2027-1-BIO102B-001 --round bxxk --json
sustech tis courses detail AI203 --semester 2026-2027-1 --jsonl
```

The course code is matched exactly. When more than one teaching task exists,
`TIS_COURSE_AMBIGUOUS` lists candidates; specify `--rwh` to select one. The detail
request uses the catalog's `kcid`, which differs from the mutation `courseId`.
Catalog lookup is live and bounded to 100 keyword matches; incomplete catalog
results produce an error instead of silently selecting a task.

## Output

| Field | Content |
| --- | --- |
| `course` | Normalized semester teaching task, teachers, meetings and identifiers |
| `catalog` | Course-library language/category, hours, assessment and teaching method |
| `content` | Plain-text introductions, objectives, outcomes, outline and readings; Chinese and English when supplied |
| `prerequisites` | Upstream description and deduplicated referenced course codes |
| `enrollment` | Aggregate counts, quotas, counts paired with quotas, source and current-account selection status |
| `selection` | Selection type, period and local start/end times, when `--round` returns them |
| `attachments` | Named Chinese/English syllabus links requiring TIS login |
| `teachingTeam` | Course-library teaching-team names and roles when populated |
| `notices` | Selection remarks, conflicts, preference summary, source differences and partial failures |
| `sources` | Per-source `available`, `empty`, `unavailable` or `not-requested` status |
| `reportedAt` | Read timestamp; not the original publication date |

Text output prefers Chinese content when available, then English. JSON retains
both languages. JSONL emits one detail item and the normal summary record.
HTML is converted to plain text; embedded scripts/styles are removed.

## Interpretation

- `--round` is the existing selection-type code, such as `bxxk`; it is not the
  same as the period name. Without this option, exact matching current-account
  enrolled/cart records supply population data when available.
- Total, undergraduate, graduate, male, female, internal (`对内`) and external
  (`对外`) counts are separate marginals. Their presence does not establish a
  breakdown by department, major or year, or a cross-tabulation of those groups.
- Zero remains zero. Missing fields remain absent. The undergraduate
  percentage is emitted only when undergraduate and graduate counts reconcile
  with a positive total. Quotas and counts paired with quotas are separate from
  aggregate enrollment.
- A missing prerequisite list does not establish that a course has no
  requirements. The upstream description preserves alternatives such as
  “CS112 or CS109”; listed course references are not interpreted as an AND rule.
- A syllabus may be older than the selected term. Course-library language and
  category can differ from the semester teaching task; both remain visible.
- Status `0` means pending, `1` effective, `A` waitlisted and `-1` void. Unresolved
  codes, including `W`, retain the original code with an unknown label.
- Course-specific remarks and conflict information are displayed when returned.
  This command does not claim to aggregate university-wide announcements.

The output is explicitly projected. It excludes raw student identities, grades,
SQL configuration, internal staff IDs and raw error bodies. Optional enrichment
failures retain the core detail with source status; course resolution and the
primary detail response must succeed. There are no automatic attachment writes.
