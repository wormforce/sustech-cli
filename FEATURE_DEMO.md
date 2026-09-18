# Feature Demo: Schedule UX Improvements

This document demonstrates the new schedule UX improvements in `sustech-cli`.

## 1. Full ISO-8601 Datetime Timestamps

When querying a specific week (`--week`, `--date`, or current-week default),
personal schedule entries now include full ISO-8601 timestamps combining date
and clock time:

```json
{
  "rwh": "2026-2027-1-CS101-001",
  "courseCode": "CS101",
  "courseName": "Programming",
  "teacher": "Prof. Zhang",
  "room": "一教101",
  "day": 1,
  "periodStart": 1,
  "periodEnd": 2,
  "startAt": "2026-09-07T08:00:00+08:00",
  "endAt": "2026-09-07T09:50:00+08:00",
  "weeks": [1, 2, 3, ...]
}
```

### Benefits for Agents
- **Direct datetime comparisons**: "Is there class this afternoon?" → Compare
  current time against `startAt` / `endAt` directly
- **No date reassembly needed**: Timestamps are complete Asia/Shanghai ISO-8601
  strings ready for parsing
- **Natural language queries**: "What time does CS101 start on Monday?" →
  `startAt` field contains both date and time

### Catalog vs Personal Schedule

- **Personal schedule** (week-specific queries): Full `startAt` / `endAt` timestamps
- **Catalog search** (`tis courses search`): `schedule[]` slots lack concrete
  dates, so only `periodStart` / `periodEnd` are provided

## 2. Date-Based Schedule Queries

Query schedules by specific date instead of week number:

```bash
# Old way (required knowing the teaching week)
sustech tis schedule --week 5

# New way (natural date query)
sustech tis schedule --date 2026-09-15

# Still works: query by week
sustech tis schedule --week 5

# Default behavior: show current week
sustech tis schedule
```

### Benefits
- More intuitive for "where is class on Friday?" questions
- Automatically resolves teaching week from academic calendar
- Validates date is within semester teaching period

## 3. Structured Room Fields

Multiple rooms are now parsed into a structured array:

```json
{
  "room": "505, 506",
  "rooms": ["505", "506"]
}
```

Single rooms remain as-is without the `rooms` array:

```json
{
  "room": "一教101"
}
```

### Benefits
- Easy to detect multiple room assignments
- Structured data for route planning or resource allocation
- Backward compatible: existing `room` field unchanged

## 4. Credential Error Consistency

Master password errors are now clearly identified:

```bash
# Missing master password
Error: Encrypted credential store requires a master password. 
       Set SUSTECH_MASTER_PASSWORD or run interactively.
Code: MASTER_PASSWORD_REQUIRED

# Incorrect master password  
Error: Encrypted store decryption failed; the master password may be incorrect.
Code: MASTER_PASSWORD_INVALID
```

### Benefits
- Clear distinction between missing vs incorrect password
- Consistent error codes across `auth status`, `doctor`, and credential reads
- Remediation always mentions `SUSTECH_MASTER_PASSWORD` when relevant

## 5. Official Period Mapping Documentation

The SUSTech period→clock mapping is now documented in `docs/ARCHITECTURE.md`:

| Period | Start  | End    | Duration |
|--------|--------|--------|----------|
| 1      | 08:00  | 08:50  | 50min    |
| 2      | 09:00  | 09:50  | 50min    |
| 3      | 10:20  | 11:10  | 50min    |
| ...    | ...    | ...    | ...      |

### Benefits
- Single source of truth for humans and agents
- ISO timestamps use this mapping automatically
- Automatic handling of legacy vs current schedules

**Note**: When a specific week is queried, the CLI automatically combines this
mapping with the class date to produce full ISO-8601 timestamps. No manual
date arithmetic needed.

## Backward Compatibility

All changes are backward compatible:
- Period fields (`periodStart`, `periodEnd`) remain unchanged
- New fields (`startAt`, `endAt`, `rooms`) are optional and additive
- `startAt` / `endAt` are only added for week-specific personal schedule queries
- Catalog `schedule[]` slots continue to use period fields only
- Existing JSON consumers continue to work
- `--week` option still works alongside new `--date` option

## Testing

All 474 tests pass, including 6 new tests for:
- Schedule entry normalization (periods, rooms)
- ISO timestamp enrichment with full datetimes
- Multiple room parsing
- Single room behavior
- Missing period data handling
- Week filtering for timestamp enrichment
