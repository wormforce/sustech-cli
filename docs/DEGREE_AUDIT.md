# Degree Audit

`sustech tis degree audit` reads live TIS grade records, compares them against
a local requirement file, and reports what is satisfied, what is still
missing, and which matches need manual judgment.

This command does not write to TIS. It is a live read plus local analysis.

## Command

```bash
sustech tis degree audit --requirements ./requirements.json
sustech tis degree audit --requirements ./requirements.json --semester 2025-2026-2
sustech tis degree audit --requirements ./requirements.json --json --pretty
```

- `--requirements FILE` is required and must point to a local JSON file.
- `--semester YYYY-YYYY-N` is optional. When present, the CLI still fetches the
  grade list from TIS first and then filters the normalized records locally.
- `--json` and `--jsonl` use the standard versioned machine-readable envelope.

An example requirements file is included at
[`docs/examples/degree-requirements.json`](examples/degree-requirements.json).

## Requirements File

Only JSON is supported in this build. `.yaml` and `.yml` requirement files are
rejected.

The top-level document shape is:

```json
{
  "schemaVersion": "1",
  "kind": "tis-degree-requirements",
  "title": "Example Program",
  "requirements": [
    {
      "id": "cs-core",
      "title": "CS Core",
      "minCourses": 3,
      "match": {
        "codes": ["CS101", "CS102", "CS201"]
      }
    }
  ]
}
```

Top-level fields:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `schemaVersion` | string | yes | Must be `"1"`. |
| `kind` | string | yes | Must be `"tis-degree-requirements"`. |
| `title` | string | no | Optional document title shown in text output. |
| `requirements` | array | yes | Must contain at least one requirement. |

Requirement fields:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | recommended | If omitted or blank, the CLI generates `requirement-N`. IDs must be unique after parsing. |
| `title` | string | recommended | If omitted or blank, the CLI generates `Requirement N`. |
| `minCredits` | number | conditional | Positive number. Required unless `minCourses` is present. |
| `minCourses` | integer | conditional | Positive integer. Required unless `minCredits` is present. |
| `match` | object | yes | Must not be empty. |

Match fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `codes` | string[] | Exact course-code match after uppercasing. |
| `prefixes` | string[] | Course code must start with any listed prefix after uppercasing. |
| `departments` | string[] | Exact department-name match. |
| `natures` | string[] | Exact course-nature match. |
| `nameIncludes` | string[] | Case-insensitive substring match against `name + nameEn`. |
| `letterGrades` | string[] | Exact letter-grade token match after uppercasing. |
| `minScore` | number | Numeric score must be at least this value. |

Validation rules:

- Every array field in `match` must contain only non-empty strings.
- `minScore` must be a non-negative number.
- At least one of `minCredits` or `minCourses` must be present for each
  requirement.
- `match` cannot be empty.

## Matching Semantics

Selector semantics are conservative:

- Different `match` fields are combined with logical AND.
- Multiple values inside a single array field are combined with logical OR.
- `minScore` adds another AND constraint when present.

Examples:

- `{"codes": ["CS101", "CS102"]}` means `CS101 OR CS102`.
- `{"prefixes": ["CS"], "departments": ["计算机科学与工程系"]}` means the course
  code starts with `CS` AND the department is exactly `计算机科学与工程系`.
- `{"nameIncludes": ["machine learning", "机器学习"], "minScore": 80}` means the
  name contains either phrase AND the numeric score is at least `80`.

## Audit Semantics

The result separates counted matches from ambiguous, unresolved, excluded, and
unmatched records.

### Ambiguous Matches

If one counted grade matches more than one requirement, it is treated as
ambiguous:

- it appears in the top-level `ambiguous` list
- it appears in each affected requirement's `ambiguousMatches`
- it does not count toward any requirement's `matchedCredits` or
  `matchedCourses`

The CLI does not auto-resolve these overlaps.

### Retakes and Duplicate Course Codes

Grades are grouped by normalized course code before counting.

- If there are multiple passed attempts for the same course code, only one is
  counted.
- The kept passed attempt is chosen by highest `numericScore`, then highest
  `gpaPoints`, then by semester string, then by `letterGrade`.
- Other passed attempts appear under `duplicateCourses[].excludedPassedRetakes`
  and inside each affected requirement's `duplicateExcludedMatches`.
- Failed, non-completed, and unknown attempts for the same course code are not
  silently merged into the counted result; they remain visible in the audit.

### Unknown and Non-Completed Statuses

Completion is classified from TIS grades before requirement counting:

- If `numericScore` exists, `>= 60` is treated as passed and `< 60` as failed.
- Otherwise the CLI checks known pass, fail, and non-completed letter-grade
  tokens such as `A`, `P`, `F`, `W`, `I`, and common Chinese equivalents.
- If no numeric score exists and the letter grade is not recognized, the grade
  becomes `unknown`.

Effects:

- `unknown` grades go to `unresolved` and do not count toward any requirement.
- recognized failed and non-completed grades go to `excluded` and do not count.
- passed grades that match no requirement go to `unmatched`.

### Requirement Satisfaction

A requirement is satisfied only when both of these reach zero:

- `remainingCredits`
- `remainingCourses`

This matters when a requirement declares both `minCredits` and `minCourses`.

## Runtime Boundaries

Current operational limits:

- This command depends on live TIS access. It needs valid TIS credentials from
  `sustech auth login`, environment overrides, or a credentials file.
- The requirement file is always local; there is no remote requirements source.
- This build currently requests one TIS grades page with `pageSize: 500` and
  does not paginate further.
- Because the optional `--semester` filter runs after fetch, a student with
  more than 500 total grade rows can get an incomplete audit even when the
  selected semester itself is small.

If you expect a very long academic history, treat the current output as a
conservative partial audit until pagination is extended.
