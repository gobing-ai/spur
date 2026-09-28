---
schema_version: 1
name: Derive the wrap-up metrics verdict from the tracked Testing record
status: done
template: feature-impl
created_at: 2026-09-28T08:31:25.123Z
updated_at: "2026-09-28T19:30:49.387Z"
feature_id: D62

ac_altitude: task-local
---

## 0994. Derive the wrap-up metrics verdict from the tracked Testing record

### Background

Found during the 2026-09-28 `sp:dev-review-session --triage` of the 0981 → 0974 → 0970 → 0973 run; re-verified 2026-09-28 against the code and `.spur/memory/wrapup-metrics.jsonl`.

`runMetrics` (`plugins/sp/scripts/wrapup-steps.ts:278`) derives each row's verdict only from the gitignored `.spur/run/<wbs>-verdict.json` (`:326-337`), defaulting to `UNKNOWN`. `/sp:dev-run --worktree` FF-merges and removes the tree on success (WT-4/WT-5), so the artifact dies with the tree and `/sp:dev-wrap` in the main tree finds nothing.

0984 does not cover it: persist-out copies only `.spur/run/<name>` files the fast-forwarded task file *cites* (`RUN_CITATION_RE`, `packages/app/src/services/inline-run-setup.ts:207`), and `renderTesting` (`packages/app/src/services/task-record.ts:150`) writes a pathless `- Verdict: PASS (from verdict artifact)` line.

The verdict is not actually lost: `task record` writes it into the tracked `### Testing` section before merge, and `runMetrics` already fetches that content through `spur task show <wbs> --json` (`:309`). It just never reads it.

Evidence (reproducible now): the log holds 28 `UNKNOWN` rows. Task 0967 is `done` with `- Verdict: PASS` in its tracked Testing section and no `.spur/run/0967-verdict.json` in the main tree; its row (2026-09-27T06:27:31Z) is `UNKNOWN`. The 0981 `UNKNOWN` row cited by the triage is no longer in the log (only a later hand-assisted `PASS` row remains), so 0967 is the reference case.

AC altitude: task-local. Regression fix on the wrap-up metrics path, not a new feature ship criterion.

### Requirements

- [x] R1. When `.spur/run/<wbs>-verdict.json` is absent or yields no verdict, `runMetrics` derives the row verdict from the `Verdict:` line of the tracked `Testing` section in the `task show --json` content it already fetches. The artifact stays the first source, so existing single-tree behavior is unchanged.
- [x] R2. The fallback matches only a line-anchored `Verdict: PASS|PARTIAL|FAIL|UNKNOWN` inside the Testing section, with the same semantics as `parseVerdictLine` (`packages/app/src/services/task-record.ts:336`). Evidence text elsewhere in the task must not match. Because of the plugin standalone contract (ADR-065), the check is a local copy with a comment pointing to `parseVerdictLine`, not an import.
- [x] R3. When neither source gives a verdict, the row stays `UNKNOWN` and stderr, which the workflow run log captures, names the task, the missing artifact path and the missing Testing verdict. The step status is unchanged: `UNKNOWN` stays telemetry, not failure (`config/workflows/wrapup-pipeline.yaml:281`).
- [x] R4. The metrics row schema does not change (`wbs, feature_id, status, verdict, timestamp`, same key order), so existing rows stay readable.

### Acceptance Criteria

- [x] AC1 — Tracked verdict used when the artifact is gone (req: R1, R2)
  - Verify: `plugins/sp/tests/wrapup-steps.test.ts` has a case where the stubbed `task show` content has a `### Testing` section with `- Verdict: PASS` and there is no artifact. The row has `verdict: "PASS"`. A second case has `Verdict: FAIL` only inside an evidence table cell, and the row stays `UNKNOWN`.
- [x] AC2 — Artifact precedence kept (req: R1)
  - Verify: a test case where the artifact says `PARTIAL` and the tracked line says `PASS` records `PARTIAL`.
- [x] AC3 — Absent verdict is honest (req: R3)
  - Verify: the existing no-artifact case (`plugins/sp/tests/wrapup-steps.test.ts:317-324`) still records `UNKNOWN`, and stderr names `.spur/run/0770-verdict.json`.
- [x] AC4 — Schema unchanged (req: R4)
  - Verify: the key-order assertion at `plugins/sp/tests/wrapup-steps.test.ts:320` passes unchanged.
- [x] AC5 — Real-data reproduction (req: R1)
  - Verify: in a scratch copy, a metrics run over a capture of `["0967"]` in the main tree records `PASS` (before the fix: `UNKNOWN`). Then `bun run spur-check` is green.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**Chosen: read the tracked task record as the fallback** (F93's direction: the gate reads the tracked record). Artifact first, tracked `Testing` verdict line second, honest `UNKNOWN` last. This is about 15 lines in `runMetrics`, with no new process call, because the `task show --json` content is already in hand.

**Rejected: citing `.spur/run/<wbs>-verdict.json` from `renderTesting`** so 0984's persist-out copies it:
- 0984 R1 makes a cited file that is missing in both trees *block teardown*. That would turn a telemetry gap into a merge blocker.
- It adds a gitignored path to every tracked task file. The path dangles in any fresh clone.
- It only fixes future worktree runs. The copied file is still gitignored, so it is lost on another clone. The 28 existing `UNKNOWN` rows' tasks stay unrecoverable.
- It changes `renderTesting` output, which every task record and its tests pin.

**Rejected: a derived `verdict` field on `spur task show --json`.** It is a public CLI surface change (needs consent), and the plugin can already read the line.

**Rejected: reading the verdict inside the worktree during `dev-run`.** `dev-run` does not produce the wrap, so this would couple two commands' responsibilities.

Out of scope (note only): backfilling the 28 historical `UNKNOWN` rows. The log is append-only telemetry. A rerun of `/sp:dev-wrap` for a task would append a corrected row if anyone needs it.

Residual: a stale main-tree artifact from an earlier non-worktree attempt still wins over a newer tracked verdict. This is the existing behavior and is not widened by this fix.

### Plan

- [x] Add the failing tests (AC1, AC2, AC3 stderr) to `plugins/sp/tests/wrapup-steps.test.ts`.
- [x] Implement the Testing-section slice + line-anchored verdict match in `runMetrics`; add the stderr line for the no-source case.
- [x] Regenerate the `plugins/sp/scripts/wrapup-steps.mjs` twin (`superskill script convert sp wrapup-steps.ts`, part of `bun run build:scripts`), then run `bun run plugin-smoke`.
- [x] AC5 real-data reproduction on 0967 in a scratch copy (do not append to the real metrics log).
- [x] `bun run spur-check`; commit.

### Solution

`runMetrics` now reads the tracked `Testing` verdict when the artifact yields none — artifact first, tracked `Testing` line second, honest `UNKNOWN` last — and reports every uncertified row. The row schema, the `UNKNOWN`-stays-telemetry semantics and the `PASS`/`FAIL` status file are untouched.

A follow-up revision on the same task (2026-09-28) closed this task's own review findings P3/P4: the `Testing` slice was aligned to the canonical rule, the uncertified-row diagnostic now also fires on an explicit `UNKNOWN`, and the exported helper gained direct tests plus a machine parity guard. Task 0995 — the residual follow-up `residual-scan settle` filed for the deferred P3 — was folded back into this task and removed, so nothing is deferred.

#### Change map (`file:line`)

- `plugins/sp/scripts/wrapup-steps.ts:285-299` — `verdictFromTestingSection(content)`: slices the tracked `Testing` section and returns the first line-anchored `Verdict: PASS|PARTIAL|FAIL|UNKNOWN`. The matcher (`:295`) and the slice (`:286-291`) are byte-identical to `parseVerdictLine` and the `Testing` slice in `extractTestingSection` (`packages/app/src/services/task-record.ts:275-290`, `:336-347`); ADR-065 keeps plugin scripts on builtin and relative imports only, so the copies are kept in step by hand and by the parity guard below. One deliberate difference, documented in the JSDoc (`:275-284`): with no `Testing` heading this returns `null` instead of falling back to the whole document, so a `Verdict:` token in another section cannot be misread as this task's verdict.
- `plugins/sp/scripts/wrapup-steps.ts:301-313` — `verdictOfArtifact(path)`: the artifact's `verdict` field, or `null` when the file is absent, unreadable, malformed or carries no usable value (jq `//` semantics: null/undefined/false are missing, an empty string stays empty).
- `plugins/sp/scripts/wrapup-steps.ts:373-383` — the row verdict is `artifactVerdict ?? trackedVerdict ?? 'UNKNOWN'` (`:376`); whenever it resolves to `UNKNOWN` (`:377`) one stderr line (`:381`) names the task, the artifact path and both source readings. An explicit `UNKNOWN` on either source is an uncertified row, so it reports the same way a miss does.
- `plugins/sp/scripts/wrapup-steps.ts:386` — the row literal `{ wbs, feature_id, status, verdict, timestamp }`; `:396-397` — the `PASS|FAIL` status file is unchanged.
- `plugins/sp/scripts/wrapup-steps.mjs` — regenerated twin (`bun run build:scripts`; `bun run script-contract-check` PASS, 29 scripts, 0 violations, which re-converts each twin and byte-compares).
- `plugins/sp/tests/wrapup-steps.test.ts:66-79` — `writeTaskShowStub` / `onlyMetricsRow` helpers (the `task show` payload is written to a file so task content with newlines and quotes survives the shell).
- `plugins/sp/tests/wrapup-steps.test.ts:320` — R4: the untouched row-schema key-order assertion.
- `plugins/sp/tests/wrapup-steps.test.ts:324` — AC3: the no-artifact, no-Testing-verdict case records `UNKNOWN` and its stderr names `.spur/run/0770-verdict.json`.
- `plugins/sp/tests/wrapup-steps.test.ts:330-351` — AC1: no artifact plus a tracked `- Verdict: PASS (from verdict artifact)` line ⇒ row `verdict: "PASS"`, and no uncertified diagnostic on stderr.
- `plugins/sp/tests/wrapup-steps.test.ts:352-371` — AC1 (second case): a mid-line `Verdict: FAIL` inside an evidence table cell does not match ⇒ the row stays `UNKNOWN`.
- `plugins/sp/tests/wrapup-steps.test.ts:372-389` — AC2: artifact `PARTIAL` plus tracked `PASS` ⇒ `PARTIAL` (artifact stays the first source).
- `plugins/sp/tests/wrapup-steps.test.ts:390-407` — R1 "yields no verdict": an artifact without a `verdict` field falls back to a bold `**Verdict: FAIL**` tracked line.
- `plugins/sp/tests/wrapup-steps.test.ts:764-779` — P3 parity guard: reads `packages/app/src/services/task-record.ts` and this script, asserting the `Testing` heading literal, the `Verdict:` matcher literal and the level-aware end-anchor statement are identical in both — it fails when either copy moves. Independently mutation-tested: moving any one literal in either copy failed the guard.
- `plugins/sp/tests/wrapup-steps.test.ts:780-791` — P3 slice cases that previously diverged: an `# Testing` heading, an h4 subheading inside `## Testing`, a sibling `## Solution` heading that must end the section, no `Testing` heading at all, and a section with no verdict line.
- `plugins/sp/tests/wrapup-steps.test.ts:792-811`, `:812-828` — P4: an explicit tracked `UNKNOWN` still reports the uncertified row, and the h1 slice reaches a real metrics row end to end.

#### Why

`runMetrics` already fetched `task show --json` for every captured task but only ever read the gitignored `.spur/run/<wbs>-verdict.json`. `/sp:dev-run --worktree` fast-forwards and removes the tree on success, so the artifact dies with it and every row landed `UNKNOWN` (28 such rows in `.spur/memory/wrapup-metrics.jsonl`). The tracked `## Testing` section that `task record` wrote from that same verdict before the merge is the durable copy (F93), and it needs no new process call.

#### Targeted tests actually run

```text
$ (cd plugins/sp && bun test tests/wrapup-steps.test.ts)
(pass) 0994 R1: a missing artifact derives the verdict from the tracked Testing section
(pass) 0994 R2: a mid-line verdict inside an evidence cell is not the Testing verdict
(pass) 0994 R1: an existing artifact outranks the tracked Testing verdict
(pass) 0994 R1: an artifact carrying no verdict falls back to the tracked Testing verdict
(pass) 0994 P3: the local verdict literals stay identical to the canonical parser
(pass) 0994 R1: verdictFromTestingSection slices like the canonical extractTestingSection
(pass) 0994 P4: an explicit tracked UNKNOWN still reports the uncertified row
(pass) 0994 R1: an h1 Testing heading reaches the metrics row
 35 pass
 0 fail
 137 expect() calls
Ran 35 tests across 1 file. [3.43s]
```

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Artifact stays first source, tracked `Testing` verdict second: `plugins/sp/scripts/wrapup-steps.ts:376` = `artifactVerdict ?? trackedVerdict ?? 'UNKNOWN'`; the fallback `verdictFromTestingSection` (`plugins/sp/scripts/wrapup-steps.ts:285`) reads the already-fetched `task show --json` content, and `verdictOfArtifact` (`plugins/sp/scripts/wrapup-steps.ts:305`) is untouched. Tests `plugins/sp/tests/wrapup-steps.test.ts:330` (no artifact, tracked `- Verdict: PASS (from verdict artifact)` ⇒ row `PASS`) and `plugins/sp/tests/wrapup-steps.test.ts:390` (artifact without a `verdict` field ⇒ tracked `**Verdict: FAIL**`). AC5 scratch rerun derived `PASS` for 0967 from the tracked line with no artifact. |
| R2 | MET | Line-anchored matcher `plugins/sp/scripts/wrapup-steps.ts:295` is byte-identical to `parseVerdictLine` at `packages/app/src/services/task-record.ts:340` (diffed this run: same optional `- `/`**` prefixes, `Verdict:` head, four-value alternation, `\b`, `i` flag, `line.trim()`); slice (`plugins/sp/scripts/wrapup-steps.ts:286-290`) is the canonical `extractTestingSection` rule (`packages/app/src/services/task-record.ts:276-288`). Local copy per ADR-065 (file value-imports only `node:*` and `../lib/env`), documented in the JSDoc and machine-enforced by the parity guard `plugins/sp/tests/wrapup-steps.test.ts:764`. Negative mid-line case `plugins/sp/tests/wrapup-steps.test.ts:352`. |
| R3 | MET | No certifying verdict ⇒ honest `UNKNOWN` plus one stderr line naming the task, the artifact path and the tracked reading: `plugins/sp/scripts/wrapup-steps.ts:377` (fires on any `UNKNOWN`, including an explicit one); row literal `plugins/sp/scripts/wrapup-steps.ts:386`; status file still derived from `metricsRc` only at `plugins/sp/scripts/wrapup-steps.ts:396`. Asserts `plugins/sp/tests/wrapup-steps.test.ts:317` (row `UNKNOWN`) and `plugins/sp/tests/wrapup-steps.test.ts:324` (stderr names `.spur/run/0770-verdict.json`). |
| R4 | MET | Row literal `plugins/sp/scripts/wrapup-steps.ts:386` = `{ wbs, feature_id: featureId, status, verdict, timestamp }` (key order unchanged); key-order assertion `plugins/sp/tests/wrapup-steps.test.ts:320` passes and is untouched by the diff. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `plugins/sp/tests/wrapup-steps.test.ts:330` — no artifact plus tracked `- Verdict: PASS (from verdict artifact)` ⇒ row `verdict: "PASS"` with empty stderr; second case `plugins/sp/tests/wrapup-steps.test.ts:352` — `Verdict: FAIL` only inside an evidence table cell ⇒ row stays `UNKNOWN`. Both pass in `(cd plugins/sp && bun test tests/wrapup-steps.test.ts)` (35 pass / 0 fail). |
| AC2 | MET | test | `plugins/sp/tests/wrapup-steps.test.ts:372` — artifact `{"verdict":"PARTIAL"}` plus tracked `PASS` records `PARTIAL` (artifact stays the first source, `plugins/sp/scripts/wrapup-steps.ts:376`). Passes in the 35-test run. |
| AC3 | MET | test | `plugins/sp/tests/wrapup-steps.test.ts:303` — the no-artifact, no-tracked-verdict case still records `verdict: "UNKNOWN"` (`plugins/sp/tests/wrapup-steps.test.ts:317`) and its stderr names `.spur/run/0770-verdict.json` (`plugins/sp/tests/wrapup-steps.test.ts:324`); step status file stays `PASS`. Passes in the 35-test run. |
| AC4 | MET | test | `plugins/sp/tests/wrapup-steps.test.ts:320` — `expect(Object.keys(row)).toEqual(['wbs','feature_id','status','verdict','timestamp'])` passes unchanged by the diff. Passes in the 35-test run. |
| AC5 | MET | command | Independent rerun this stage in scratch `.spur/tmp/0994-verify-ac5-rerun` (real 0967 lookup, no `.spur/run/0967-verdict.json`, tracked `- Verdict: PASS (from verdict artifact)`): working-tree script appended `{"wbs":"0967","feature_id":"G67","status":"done","verdict":"PASS",...}`; the base script (`git show eccb8caf3:plugins/sp/scripts/wrapup-steps.ts`) appended `...,"verdict":"UNKNOWN",...`; the real `.spur/memory/wrapup-metrics.jsonl` stayed at 207 rows. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Review — 0994 (D62, wrap-up metrics verdict derivation), lane `safety:triage standard lane`, base `eccb8caf3425b58f213e3bcef1b0eaf67fea908c`. Reviewed revisions: the pipeline's implementation, then the follow-up revision that closes this review's own findings.

**Disposition: OK, all findings closed.** No P1/P2. Every P3/P4 below was addressed in this task rather than deferred — 0995 was folded back in and removed, so no residual follow-up is outstanding.

#### Functional traceability (verified)

| Claim | Evidence |
| --- | --- |
| Root cause is real | `docs/tasks5/0967_…md:194` `- Verdict: PASS (from verdict artifact)`; `.spur/run/0967-verdict.json` absent; the last recorded 0967 row is `UNKNOWN` (`.spur/memory/wrapup-metrics.jsonl:197`) |
| R1 fallback + artifact precedence | `plugins/sp/scripts/wrapup-steps.ts:376`; tests `plugins/sp/tests/wrapup-steps.test.ts:372-389`, `:390-407` |
| R2 line-anchored match == `parseVerdictLine` | matcher byte-identical to `packages/app/src/services/task-record.ts:340`, slice now byte-identical to `extractTestingSection` (`:275-290`) — both asserted by the parity guard `wrapup-steps.test.ts:764-779` (mutation-tested); behavioural cases `:352-371`, `:780-791` |
| R3 honest UNKNOWN + named diagnostic | `wrapup-steps.ts:377-383`; status unchanged (`:396-397`); workflow semantics unchanged (`config/workflows/wrapup-pipeline.yaml:281-283`); asserts `wrapup-steps.test.ts:324`, `:792-811` |
| R4 schema unchanged | row literal `wrapup-steps.ts:386`; key-order assertion `wrapup-steps.test.ts:320` |
| AC5 causal reproduction | scratch capture `["0967"]`: base `eccb8caf3` script appended `UNKNOWN`, working-tree script appended `PASS`; real `.spur/memory/wrapup-metrics.jsonl` untouched at 207 rows |
| No collateral damage | `existsSync` still used (`wrapup-steps.ts:492,503`); twin regenerated by `bun run build:scripts` and verified by `bun run script-contract-check`; no design satellite documents the verdict source, so no T3 doc sync is owed |

#### Findings

| Priority | Area | Location | Finding | Disposition |
| --- | --- | --- | --- | --- |
| P3 | maintainability | plugins/sp/scripts/wrapup-steps.ts:286-290 | Hand-copied verdict parser: the matcher was already verbatim per ADR-065, but the `Testing` slice used `#{2,4}` where the canonical `extractTestingSection` uses `#{1,6}` and ends at the next same-or-higher heading. An `# Testing` heading, or a verdict below an h4 subheading inside `## Testing`, read as absent here while the app read one — both degraded to honest `UNKNOWN`, so no wrong `PASS` was reachable, but the two copies disagreed on reachable input. | FIXED — the slice is now the canonical rule verbatim, the deliberate difference (no `Testing` heading ⇒ `null`, never a document-wide scan) is documented in the JSDoc at `:275-284`, and the parity guard reads both files and fails if any of the three literals moves (`wrapup-steps.test.ts:764-779`) |
| P4 | telemetry | plugins/sp/scripts/wrapup-steps.ts:377-383 | An explicit tracked `- Verdict: UNKNOWN` produced a silent UNKNOWN row, because the diagnostic fired only when both sources were null. R3's letter was met; log-based triage under-reported. | FIXED — the diagnostic now fires whenever the row resolves to `UNKNOWN` and names the task, the artifact path and both source readings; asserted at `wrapup-steps.test.ts:792-811` |
| P4 | tests | plugins/sp/scripts/wrapup-steps.ts:285 | `verdictFromTestingSection` was exported but no test imported it, so the helper's slice semantics had no direct coverage. | FIXED — direct unit cases at `wrapup-steps.test.ts:780-791` (h1 heading, h4 subheading, level-aware end anchor, no heading, no verdict line) plus an end-to-end h1 case at `:812-828` |
| P4 | docs | docs/tasks5/0994_persist-the-verify-verdict-artifact-so-wrap-up-metrics-survi.md | Documentation line anchors drifted twice: once when the section bodies were first rewritten, then again when the follow-up revision reformatted the test import block (+7) and grew the script JSDoc (+7) after the ranges had been derived — the first "RESOLVED" disposition was therefore inaccurate. | FIXED — every `file:line` anchor in this section, in `## Solution` and in the AC3/AC4 `Verify` lines was re-derived from the current files and verified against them; the re-verification pass that caught the second drift is recorded in the run log |

#### Residual risk

1. Rows can now come from a human-writable tracked line (F93 measured 78 artifact-less `done` tasks carrying a `Verdict:` line); the log no longer distinguishes a machine-certified verdict from a hand-written one. Intended by R1 — relevant when the log is cited as evidence.
2. A literal artifact `"verdict": "UNKNOWN"` stays authoritative and does not fall through to the tracked record. R1's "absent or yields no verdict" is honoured at field level; the uncertified row is now reported rather than silent. Documented invariant, not a defect.
3. Stale main-tree artifact precedence over a newer tracked verdict (pre-existing, disclosed in the task's Design, not widened).

Provenance: the review was produced by the `review` stage's dispatched subagent (mission `730e7c2a-74ee-4bfa-9b45-b145b00c79de`, role reviewer, fresh context) and persisted by the pipeline host, because the reviewer agent is read-only and cannot write `answerFile` nor run `spur task update --section`. The findings were then fixed in-task and the revision re-verified by a second fresh verifier (mission `d5fbd55f-ff5b-4089-b88e-b38ebca12e71`), which is what caught the second anchor drift.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-28T08:31:44.582Z backlog → todo (system)
- 2026-09-28T18:54:23.139Z todo → wip (system)
- 2026-09-28T19:12:41.902Z wip → testing (system)
- 2026-09-28T19:12:58.304Z testing → done (system)

