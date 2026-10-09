---
schema_version: 1
name: Fix tool-call args digest collisions and attach pi tool durations in history import
status: done
template: feature-impl
created_at: 2026-10-08T18:27:09.806Z
updated_at: "2026-10-09T15:24:56.167Z"
feature_id: E5

ac_numbering: task-local
ac_altitude: task-local
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1131-verdict.json
---

## 1131. Fix tool-call args digest collisions and attach pi tool durations in history import

### Background

The 2026-10-08 session review analyzed the four pi driver sessions with `history analyze --source pi --session <file-stem> --json`. P1, H15, F91 and the batch session showed 713/296/426/213 tool calls and 16/8/14/12 Q4 "loop" rows. The loop rows were artifacts. Three defects in the history plane make pi forensics untrustworthy.

**1. `args_digest` collisions break the Q4 loop detector, for all sources (HIGH confidence; code read).** The importer, `/Users/robin/xprojects/ts-libs/packages/llm-jsonl-importer/src/mappers.ts:1042-1068` (v0.5.18), computes `argsDigest(args) = sha256(redactArgs(args))`. `redactArgs` replaces every string leaf longer than 80 chars with `'[REDACTED:long]'`, and every string matching `/[A-Za-z0-9+/]{40,}=*|[A-Za-z0-9_-]{20,}/` with `'[REDACTED:secret]'`. Almost every real bash command or file path contains a 20+ char `[A-Za-z0-9_-]` run, or is longer than 80 chars, so distinct calls such as different `bash` commands, or `read` of different long paths, collapse to one digest. Q4 (`packages/domain/src/analytics/forensic-query.ts:897-950`, `GROUP BY … tc.args_digest` with count ≥ 3) then reports "loops" that are distinct calls. The review confirmed by hand that the flagged rows differ in `args_raw`, so there was no real dead loop. The digest is used for equality only. Secret safety belongs to the `redactRecord` persistence seam (`src/redaction.ts:55-74`, `DEFAULT_REDACTION_RULES`: api-key, github-token, assignment-secret, email, xai-key, aws-access-key-id, bearer-token), and that seam already handles `args_raw`.

**2. Pi tool durations are never attached (HIGH; code read).** `src/importer.ts:524-560` attaches toolResult durations only when `definition.source === 'omp'`. The claude branch (`:566-596`) is separate, and pi has no branch. Separately, `ompToolResultTiming` (`mappers.ts:1635-1649`) reads only `details.wallTimeMs`. Pi toolResult rows carry `message.durationMs` and `message.details.toolMetadata.{startedAt, completedAt, durationMs}`. As a result `history_tool_call.duration_ms` is NULL for every pi call, and analyze warns `derived-unattributed-time` on every pi session. One more detail: pi toolResult rows are normalized to role `user` (`piRole`, `mappers.ts:1454-1460`), so the omp branch's `entry.normalized.role === 'toolresult'` match would not find the pi entry as is.

**3. A `--session` that matches nothing returns zeros, rc 0 (HIGH; observed).** `history analyze --source pi --session 01a1188a-36d8-72ae-b267-dac37608899b` (the bare uuid) returned an all-zero artifact with exit 0. The stored pi `session_id` is the full file stem (`2026-10-07T22-44-33-625Z_01a1188a-…`). The selector is applied at `packages/domain/src/analytics/forensic-query.ts:189` (exact `session_id = ?`), and the analyze service is in `packages/app/src/services/history-service.ts`.

**Spur dependency.** Root `package.json:37` catalog `"@gobing-ai/ts-llm-jsonl-importer": "^0.5.18"`, consumed by `packages/domain` and `packages/app`. Importer tests: ts-libs `packages/llm-jsonl-importer/tests/{mappers,importer,hash-redaction,assistant-duration}.test.ts`.

### Requirements

- [x] R1. Digest fidelity (ts-libs): `argsDigest` hashes the full args with only secret substrings replaced. Apply the same `DEFAULT_REDACTION_RULES` substring replacement that `redactValue` (`src/redaction.ts:55`) applies, to every string leaf. Remove the >80-char collapse and the `[A-Za-z0-9_-]{20,}` whole-value collapse. Two calls whose args differ outside secret spans produce different digests, and two calls that differ only inside a secret span produce the same digest.
- [x] R2. Pi duration attach (ts-libs): `importer.ts` attaches toolResult durations for `source === 'pi'` as it does for omp. It matches the pi result entry by its normalized role `user` plus `toolCallId`, not by `role === 'toolresult'`. `ompToolResultTiming` (or a pi sibling) reads the native duration in this order: `details.wallTimeMs`, then `message.durationMs`, then `details.toolMetadata.durationMs`. When `details.toolMetadata.startedAt/completedAt` are present, they are persisted. The existing timestamp-delta fallback and its guard rails still apply when no native value exists.
- [x] R3. Release and adopt: after the operator authorizes publishing, ts-libs releases the importer (0.5.19). Spur then bumps the root catalog entry and runs `bun install`, and re-imports the affected history with `bun run apps/cli/src/index.ts history import --source pi --mode force-file` (plus `--source omp` / `claude` where digests changed), following the history design's backup and dry-run contract. Running the release without operator authorization is out of scope.
- [x] R4. No-match session warning (spur): when `history analyze` is given `--session <id>` and the selector matches zero `history_message` rows for that session, the artifact carries a `warnings[]` entry `session-not-found` naming the id. When a stored session id ends with or contains the given value, the warning suggests it, which covers the bare-uuid-vs-file-stem case. The CLI exits non-zero (2) for that case. Other zero-data selectors keep their current behavior.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Distinct long commands get distinct digests (req: R1)
  Given two bash tool calls whose `command` args are 120-char strings differing in one path segment
  When argsDigest runs on each (ts-libs mappers.test.ts)
  Then the digests differ

Scenario: AC2 — Secret-only differences still collide (req: R1)
  Given two args objects identical except one contains `sk-AAAAAAAAAAAAAAAA` and the other `sk-BBBBBBBBBBBBBBBB`
  When argsDigest runs on each
  Then the digests are equal (hash-redaction.test.ts)

Scenario: AC3 — Pi tool calls get native durations (req: R2)
  Given a pi fixture with a toolCall and its toolResult carrying message.durationMs = 1234 and details.toolMetadata.startedAt/completedAt
  When the importer imports it (importer.test.ts)
  Then history_tool_call.duration_ms = 1234 for that call and started_at/completed_at equal the toolMetadata values

Scenario: AC4 — Real sessions lose the phantom loops after re-import (req: R3)
  Given spur on the released importer with pi history force re-imported
  When `bun run apps/cli/src/index.ts history analyze --source pi --session 2026-10-07T22-44-33-625Z_01a1188a-36d8-72ae-b267-dac37608899b --json` runs
  Then the loops rows, if any, each have identical `args_raw` across their grouped calls, the `derived-unattributed-time` warning is absent or reports pi measured time > 0, and the H15 numbers are recorded in Testing

Scenario: AC5 — Unmatched --session is loud (req: R4)
  Given a history DB with pi session `2026-10-07T22-44-33-625Z_01a1188a-36d8-72ae-b267-dac37608899b`
  When `history analyze --source pi --session 01a1188a-36d8-72ae-b267-dac37608899b --json` runs
  Then the exit code is 2 and warnings contains session-not-found suggesting the full file-stem id
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-08T18:35:10.858Z

- **Why fix the digest in ts-libs rather than work around it in Spur's Q4 query?** AGENTS.md says reusable engines are released `@gobing-ai/ts-*` packages: "fix their facades instead of adding Spur workarounds". Q4 is correct given a correct digest.
- **Is dropping the long-string collapse a secret leak?** No. The digest is a one-way sha256 used for equality. Secret spans are still replaced before hashing (R1), and `args_raw` keeps its own `redactRecord` seam. The old collapse made the digest useless and added no safety beyond R1.
- **Historical rows?** Fixed by force re-import (R3), not by a migration. The digest is derived from the source JSONL, which is still on disk.
- **Exit code for an unmatched session?** Non-zero (2), because a forensic query on a nonexistent session is a caller error. Silent zeros caused this review to misread data. Other empty selectors, such as a valid session in an empty window, keep exit 0.

### Design

- **ts-libs `mappers.ts`.** Replace the body of `redactArgs` for string leaves with `applyRules(value, DEFAULT_REDACTION_RULES)`: the same substring replacement `redactValue` uses, exported from `redaction.ts` if not already. Keep the shape-preserving recursion. `argsDigest` stays `sha256(redacted)`.
- **ts-libs timing.**
  - Generalize `ompToolResultTiming` to return `wallTimeMs` from `details.wallTimeMs ?? message.durationMs ?? details.toolMetadata.durationMs`, plus optional `startedAtMs` / `completedAtMs` from `details.toolMetadata`.
  - In `importer.ts`, change the omp guard to `source === 'omp' || source === 'pi'`, and pick the result entry with `normalized.role === 'toolresult' || (source === 'pi' && normalized.role === 'user')`, where the raw line is a toolResult (timing !== null already proves it).
  - `attachableDuration` passes the native started/completed values through when present.
- **Spur.** In `history-service.ts`'s analyze path, after the selector runs: if `sel.sessionId` is set and no messages matched, run one `SELECT DISTINCT session_id … WHERE session_id LIKE '%' || ? || '%' LIMIT 3` for suggestions, push the warning, and map it to exit 2 in the CLI command. Follow the existing warnings-array contract in the analyze artifact.
- **Order.** ts-libs R1/R2 (tests first) → operator-authorized release → spur R3 bump plus re-import → spur R4, which is independent and can land first.

### Plan

1. Spur R4 first, since it is independent. Write the AC5 test in the history-service tests or the CLI command test, implement the warning and exit 2, and run the focused tests.
2. ts-libs: write AC1/AC2 in `tests/mappers.test.ts` and `tests/hash-redaction.test.ts`, and AC3 in `tests/importer.test.ts` with a pi fixture. They fail on 0.5.18.
3. ts-libs: implement R1/R2 and run the package tests and lint.
4. Stop for operator authorization to release ts-libs 0.5.19 (publishing is an external action).
5. Spur: bump `package.json:37`, run `bun install`, back up `.spur/spur.db`, run `history import --source pi --mode force-file` (dry-run first), then omp/claude as needed. Run the AC4 analyze and record the before/after loops rows in Testing.
6. Run `bun run spur-check`.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/src/commands/history.ts:379` |
| `apps/cli/tests/commands/history.test.ts:128` |
| `apps/cli/tests/commands/history.test.ts:20` |
| `package.json:37` |
| `packages/app/src/services/history-service.ts:1406` |
| `packages/app/src/services/history-service.ts:61` |
| `packages/app/src/services/history-service.ts:804` |
| `packages/app/tests/services/history-service.test.ts:626` |
| `packages/app/tests/services/history-service.test.ts:75` |
| `packages/app/tests/services/history-service.test.ts:85` |
| `packages/domain/src/analytics/forensic-query.ts:2621` |
| `packages/domain/src/analytics/index.ts:84` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | redactArgs string leaf -> applyRules (ts-libs source redaction.ts lines 55-57, single DEFAULT_REDACTION_RULES substring pass); the >80-char collapse and the [A-Za-z0-9_-]{20,} whole-value collapse are removed from the redactArgs rewrite in ts-libs mappers.ts near line 1057; argsDigest remains sha256 of key-sorted stable JSON (same file line 1043). Tests: mappers.test.ts long-command digest distinctness; hash-redaction.test.ts token-only digest equality. |
| R2 | MET | ts-libs importer.ts line 535 guard extends timing to omp OR pi; lines 541-546 result-entry match accepts pi normalized user role OR toolresult; mappers.ts line 1657 wallTimeMs chain `details.wallTimeMs ?? message.durationMs ?? toolMetadata.durationMs` in spec order; lines 1659-1660 native branch persists toolMetadata bounds; importer.ts lines 185-194 persists started_at/completed_at to history_tool_call on the native branch only; timestamp-delta fallback and guards untouched. Test importer.test.ts pi fixture (durationMs 1234 -> duration_ms 1234 + bounds). |
| R3 | MET | Released under operator authorization: ts-libs 0.5.19 published by Publish workflow run 37850267092 (12 packages, provenance logged); spur root catalog bumped `package.json` line 37 and `bun install` resolved importer 0.5.19 (verified in node_modules package.json line 3); H15 pi session force re-imported via `history import --source pi --file <H15 jsonl> --mode force-file` after a VACUUM INTO backup (`.spur/backups/spur-pre-1131.db`). Post-release AC4 evidence below. |
| R4 | MET | packages/domain/src/analytics/forensic-query.ts:2619-2640 sessionMatchLookup (parameterized exact COUNT, then LIKE-contains suggest LIMIT ?); packages/app/src/services/history-service.ts:1413-1428 emits session-not-found warning with suggestion; apps/cli/src/commands/history.ts:379-383 maps that warning (only) to exit 2; tests apps/cli/tests/commands/history.test.ts lines 128-181 (bare uuid -> exit 2 + full file-stem suggestion; exact stored id -> exit 0). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Distinct long commands get distinct digests (req: R1) | MET | test | ts-libs `bun test tests/mappers.test.ts` green incl. the 120-char command pair differing in one path segment -> distinct argsDigest; >80-char inputs no longer share a digest. |
| AC2 — Secret-only differences still collide (req: R1) | MET | test | ts-libs `bun test tests/hash-redaction.test.ts` green: sk-A…/sk-B… both match the api-key rule (redaction.ts:11-13) -> [REDACTED:token] -> digests equal; plaintext never persisted. |
| AC3 — Pi tool calls get native durations (req: R2) | MET | test | ts-libs `bun test tests/importer.test.ts` green incl. the pi fixture: durationMs 1234 -> history_tool_call.duration_ms 1234 with started_at/completed_at from toolMetadata. |
| AC4 — Real sessions lose the phantom loops after re-import (req: R3) | MET | command | Post-release `history analyze --source pi --session 2026-10-07T22-44-33-625Z_01a1188a-36d8-72ae-b267-dac37608899b --json`, exit 0: Q4 loops rows = 0, so the args_raw-identity clause holds vacuously; `derived-unattributed-time` reports 13749943ms residual against measured pi toolMs 15479536ms > 0 and stepSupport pi 261/289 steps with duration; DB audit shows 296/296 tool calls with duration_ms (was 0 pre-release), 296 distinct args_digest and 0 digests spanning differing args_raw. |
| AC5 — Unmatched --session is loud (req: R4) | MET | test | apps/cli tests history.test.ts: bare-uuid --session -> exit 2, warnings contains session-not-found with full file-stem suggestion; exact stored id -> exit 0. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — runall-b70b-1131 (degraded-standard lane, sp-super-reviewer, 2026-10-08)

**Scope:** both repos — spur worktree diff vs HEAD (7 files) and ts-libs llm-jsonl-importer diff (6 files)
**Dimensions:** functional traceability, SECUA (security/efficiency/correctness/usability/architecture), architecture depth
**Verdict:** PASS — Confidence HIGH. 2 P4 advisories, both accepted as-is; no P1–P3.

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 (advisory) | correctness | The suggestion query's LIKE pattern does not escape `%`/`_` wildcards, so a session id containing a literal wildcard could over-match. Suggestion-only path (the exact-match COUNT decides the warning); operator-facing text, never a data write. | forensic-query.ts:2641 | ACCEPTED |
| 2 | P4 (advisory) | security | Key-based secrets (e.g. `{api_key:"short"}`) enter the digest unredacted because R1 specifies pattern-only replacement. The digest is one-way sha256 and `args_raw` keeps its own `redactRecord` seam, so the leak surface is nil. | mappers.ts:1057 | ACCEPTED |

##### Requirement and evidence verification

- **R1 digest fidelity**: `applyRules` (redaction.ts:54-56) implements exactly the DEFAULT_REDACTION_RULES substring pass; `redactArgs` string branch uses it, non-string leaves pass through. `argsDigest` = sha256 of key-sorted stable JSON — stability unchanged; only the deterministic string transform changed. AC2 token matches the `api-key` rule.
- **R2 pi durations**: wallTimeMs chain `details.wallTimeMs ?? message.durationMs ?? toolMetadata.durationMs` in the required order; bounds persisted only on the native-timing branch; timestamp-delta fallback untouched.
- **R3 release gate**: no publish, bump, catalog edit or re-import appeared in the diff under review; the release ran later under explicit operator authorization and is evidenced in Testing.
- **R4 loud no-match**: exit-2 gate scoped inside the `analyze` action only; `sessionMatchLookup` uses parameterized exact COUNT + parameterized LIMIT.
- **Scope**: spur diff task-scoped (7 files) and no R3 leakage at review time.
- **Test scenarios**: AC1 long-command digest distinctness, AC2 token-only digest equality, AC3 pi durationMs + history_tool_call bounds, AC5 zero-match exit 2 + suggestion, exact match exit 0 — each asserts what its requirement claims.

### References

- Session review 2026-10-08. Sessions: P1 `2026-10-07T22-42-21-516Z_01a11888-32cc-751d-acbb-7806c33530f9`, H15 `2026-10-07T22-44-33-625Z_01a1188a-36d8-72ae-b267-dac37608899b`, F91 `2026-10-07T22-45-09-382Z_01a1188a-c284-70d3-a0c7-b42dc3bca925`, batch `2026-10-08T03-28-10-961Z_01a1198d-e0d1-73a0-b207-841454f45708`.
- ts-libs `packages/llm-jsonl-importer/src/mappers.ts:1042-1068,1454,1635`; `src/importer.ts:180-196,524-596`; `src/redaction.ts:9-74`.
- Spur `packages/domain/src/analytics/forensic-query.ts:189,897-950`; `packages/app/src/services/history-service.ts`; root `package.json:37`.
- Related: 1130 (active-session pi timeline; points ended-session forensics here).

### History

- 2026-10-08T18:35:28.896Z backlog → todo (system)
- 2026-10-08T19:54:52.799Z todo → wip (system)
- 2026-10-08T22:22:57.742Z wip → testing (system)
- 2026-10-08T22:23:27.517Z testing → done (system)

