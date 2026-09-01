# TIS selection contracts

The selection surface separates catalog rows, selectable bundles, mutation identifiers, and read-back identifiers. Consumers must not infer one identifier's meaning from its spelling.

## Bundled availability

`sustech tis courses available ... --json` returns `data.bundles`. A bundle contains:

- `bundleId`: an explicit source bundle ID when TIS exposes one; otherwise a stable selection/task-scoped identity.
- `components`: lecture, lab, tutorial, other, or unknown rows. Every component states whether it is required and identifies its task `rwh`.
- `credits` and `creditStatus`: equal repeated component credits are counted once. Conflicting component credits produce `creditStatus: "ambiguous"` and omit `credits` instead of guessing or summing.
- `teachingTeam` and `meetings`: unions across all components, retaining parity-week schedules.
- `operationTargets`: exact component-level mutation `courseId`, task `rwh`, payload field, and read-back identity.
- `selectableWithoutGuessing`: true only when every required component has the explicit identifier pair needed for mutation and verification.

Duplicate source rows for the same component are merged and reported in `warnings`. Default CLI output never contains the upstream selection envelope, enrolled/cart raw rows, credentials, cookies, tokens, or unrelated student fields. `retainCourseSourceRecord` is a library-level diagnostics-only escape hatch and is not called by CLI commands.

## Identifier meanings

| Name | Meaning | Accepted by |
| --- | --- | --- |
| `bundleId` | normalized course bundle identity | display, planning, grouping only |
| `componentId` / `taskId` / `rwh` | exact teaching-task component | required together with `courseId` for apply and reconciliation read-back |
| `courseId` | opaque selection mutation identifier | CLI `--course-id`; serialized as upstream `p_id` |
| `clientRequestId` | local correlation identifier | output/errors only; it is not an upstream idempotency key |

Do not pass `bundleId`, course code, or `rwh` as `--course-id`. Do not treat `courseId` alone as a unique lecture/lab component: exact verification keys on `{courseId, rwh}`.

## Uncertain writes and reconciliation

TIS does not currently expose a verified idempotency-key facility for these endpoints. Every preview therefore says `upstreamKeySupported: false` and `automaticRetry: "forbidden"`. The generated `clientRequestId` is not added to the upstream payload.

If a request is known to fail before submission, the CLI returns `TIS_SELECTION_NOT_SUBMITTED`, exit 4, and `NO_MUTATION_PERFORMED`. If submission may have started but no conclusive response arrives, it returns `TIS_SELECTION_OUTCOME_UNKNOWN`, exit 5, and `DO_NOT_RETRY_AUTOMATICALLY`.

Use the exact target from the error:

```bash
sustech tis selection reconcile cart.add \
  --course-id SELECTION_ID --rwh TASK_ID --round bxxk \
  --attempts 3 --json
```

Reconciliation performs two to five bounded read-only queries and reports:

- `applied`: the final bounded observation reached the requested exact state;
- `not_applied`: at least two consistent exact observations retained the inverse state and no desired/conflicting observation appeared;
- `still_uncertain`: a query failed, identifiers conflicted, observations regressed, or evidence remained incomplete.

None of these states authorizes an automatic mutation retry. `not_applied` means a human or higher-level workflow may review a new preview; it does not reuse the uncertain request.

## Privacy-minimized planning projections

Planning commands use documented allowlists:

- `tis courses available`: normalized bundles, components, exact identifiers, teaching teams, meetings, capacity/credit context, and report time;
- `tis enrolled`: course identity, exact `rwh`, teaching team, and meeting coordinates;
- `tis degree progress`: summary/category/module data by default; course grades appear only with explicit `--details`;
- `tis degree missing`: completion classification may guide gap reasoning, but letter grades and numeric scores are removed from both text and JSON.

The projection guard rejects credential, cookie, token, raw-envelope, SID, and unrelated student-identifier keys before output.
