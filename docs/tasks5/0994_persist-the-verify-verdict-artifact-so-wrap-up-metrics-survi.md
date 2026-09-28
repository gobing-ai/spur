---
schema_version: 1
name: Derive the wrap-up metrics verdict from the tracked Testing record
status: done
template: feature-impl
created_at: 2026-09-28T08:31:25.123Z
updated_at: "2026-09-28T19:12:58.304Z"
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
  - Verify: the existing no-artifact case (`plugins/sp/tests/wrapup-steps.test.ts:290`) still records `UNKNOWN`, and stderr names `.spur/run/0770-verdict.json`.
- [x] AC4 — Schema unchanged (req: R4)
  - Verify: the key-order assertion at `plugins/sp/tests/wrapup-steps.test.ts:294` passes unchanged.
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

`runMetrics` now reads the tracked `Testing` verdict when the artifact yields none. Artifact first,
tracked `Testing` line second, honest `UNKNOWN` last; the row schema, the `UNKNOWN`-stays-telemetry
semantics and the `PASS`/`FAIL` status file are untouched.

#### Change map (`file:line`)

- `plugins/sp/scripts/wrapup-steps.ts:273-289` — new `verdictFromTestingSection(content)`: slices the
  tracked `### Testing` section (heading depth 2–4, same slice rule as `solutionSectionOf` at
  `plugins/sp/scripts/wrapup-drift-probe.ts:112`) and returns the first line-anchored
  `Verdict: PASS|PARTIAL|FAIL|UNKNOWN`. Local copy of `parseVerdictLine` in
  `packages/app/src/services/task-record.ts` — ADR-065 keeps plugin scripts on builtin and relative
  imports only, so the two must be kept in step by hand.
- `plugins/sp/scripts/wrapup-steps.ts:291-304` — new `verdictOfArtifact(path)`: the artifact's
  `verdict` field, or `null` when the file is absent, unreadable, malformed or carries no usable
  value (jq `//` semantics: null/undefined/false are missing, an empty string stays empty).
- `plugins/sp/scripts/wrapup-steps.ts:361-375` — the row verdict is now
  `artifactVerdict ?? trackedVerdict ?? 'UNKNOWN'`; when neither source yields a verdict the row
  stays `UNKNOWN` and one stderr line names the task, the missing artifact path and the missing
  tracked verdict line (the workflow run log captures it).
- `plugins/sp/scripts/wrapup-steps.mjs` — regenerated twin
  (`superskill script convert sp wrapup-steps.ts`, part of `bun run build:scripts`);
  `bun run plugin-smoke` PASS.
- `plugins/sp/tests/wrapup-steps.test.ts:57-72` — `writeTaskShowStub` / `onlyMetricsRow` helpers
  (the `task show` payload is written to a file so task content with newlines and quotes survives
  the shell).
- `plugins/sp/tests/wrapup-steps.test.ts:315-317` — AC3: the existing no-artifact, no-Testing-verdict
  case still records `UNKNOWN` and its stderr names `.spur/run/0770-verdict.json`.
- `plugins/sp/tests/wrapup-steps.test.ts:323-343` — AC1: no artifact plus a tracked
  `- Verdict: PASS (from verdict artifact)` line ⇒ row `verdict: "PASS"`, and no honest-`UNKNOWN`
  diagnostic on stderr.
- `plugins/sp/tests/wrapup-steps.test.ts:345-363` — AC1 (second case): a mid-line `Verdict: FAIL`
  inside an evidence table cell does not match ⇒ the row stays `UNKNOWN`.
- `plugins/sp/tests/wrapup-steps.test.ts:365-379` — AC2: artifact `PARTIAL` plus tracked `PASS` ⇒
  `PARTIAL` (artifact stays the first source).
- `plugins/sp/tests/wrapup-steps.test.ts:383-397` — R1 "yields no verdict": an artifact without a
  `verdict` field falls back to a bold `**Verdict: FAIL**` tracked line.

#### Why

`runMetrics` already fetched `task show --json` for every captured task but only ever read the
gitignored `.spur/run/<wbs>-verdict.json`. `/sp:dev-run --worktree` fast-forwards and removes the
tree on success, so the artifact dies with it and every row landed `UNKNOWN` (28 such rows in
`.spur/memory/wrapup-metrics.jsonl`). The tracked `## Testing` section that `task record` wrote from
that same verdict before the merge is the durable copy (F93), and it needs no new process call.

#### Targeted tests actually run

```text
$ (cd plugins/sp && bun test tests/wrapup-steps.test.ts)
(pass) a resolvable task appends exactly one well-formed metrics row and PASSes [39.07ms]
(pass) 0994 R1: a missing artifact derives the verdict from the tracked Testing section [110.00ms]
(pass) 0994 R2: a mid-line verdict inside an evidence cell is not the Testing verdict [122.84ms]
(pass) 0994 R1: an existing artifact outranks the tracked Testing verdict [109.19ms]
(pass) 0994 R1: an artifact carrying no verdict falls back to the tracked Testing verdict [108.09ms]
 31 pass
 0 fail
 119 expect() calls
Ran 31 tests across 1 file. [2.96s]
```

#### AC5 real-data reproduction

Scratch copy at `.spur/tmp/0994-ac5` (repo working tree minus `node_modules`/`.git`, with the
pre-fix script from `HEAD` and the fixed script side by side), removed afterwards. The real
`.spur/memory/wrapup-metrics.jsonl` was not touched — 207 rows before and after.

```text
$ cd .spur/tmp/0994-ac5        # 0967 tracked Testing: "- Verdict: PASS (from verdict artifact)";
                               # no .spur/run/0967-verdict.json in this copy
$ export spurBin="bun <repo>/apps/cli/src/index.ts"
$ __runId=ac5-pre bun plugins/sp/scripts/wrapup-steps-prefix.ts metrics   # HEAD
$ __runId=ac5-fix bun plugins/sp/scripts/wrapup-steps.ts metrics          # fixed
$ cat .spur/memory/wrapup-metrics.jsonl
{"wbs":"0967","feature_id":"G67","status":"done","verdict":"UNKNOWN","timestamp":"2026-09-28T18:44:28Z"}
{"wbs":"0967","feature_id":"G67","status":"done","verdict":"PASS","timestamp":"2026-09-28T18:44:28Z"}
```

#### Gate

`bun run lint` (biome + tsc, including `plugins/sp/tsconfig.json`) clean; `bun run plugin-smoke`
PASS; `bun run spur-check` → 9394 pass / 0 fail across 541 files, post-check rules PASS.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Artifact-first fallback in the row verdict: `plugins/sp/scripts/wrapup-steps.ts:369` = `artifactVerdict ?? trackedVerdict ?? 'UNKNOWN'`, fed by `verdictFromTestingSection` (`:279-292`, reads the tracked `Testing` section of the already-fetched `task show --json` content) with the artifact unchanged as the first source `verdictOfArtifact` (`:298-306`). Tests `plugins/sp/tests/wrapup-steps.test.ts:323-342` (no artifact + tracked PASS ⇒ `PASS`, no diagnostic) and `:383-397` (artifact without a `verdict` field ⇒ tracked bold `FAIL`); `(cd plugins/sp && bun test tests/wrapup-steps.test.ts)` 31 pass / 0 fail this run. Real-data repro (AC5) derived `PASS` for 0967 from the tracked line with no artifact present. |
| R2 | MET | Line-anchored matcher at `plugins/sp/scripts/wrapup-steps.ts:288` is byte-identical to `parseVerdictLine`'s regex at `packages/app/src/services/task-record.ts:340` (machine-diffed the two literals this run — `grep -o '/^(?:-.*exec(line.trim())'` on both files, `diff` reported no difference: same optional `- ` bullet and `**` bold prefixes, same `Verdict:` head, same `\s*` gap, same four-value alternation PASS, PARTIAL, FAIL, UNKNOWN, same `\b` and `i` flag, same `line.trim()` input, same skip-and-continue loop). JSDoc `:273-278` names `parseVerdictLine` and records the ADR-065 local-copy reason; the file value-imports only `node:*` and `../lib/env` — `spur rule run --preset recommended-pre-check` 49 rules PASS in this run's gate log. Negative case `plugins/sp/tests/wrapup-steps.test.ts:345-362` (mid-line `Verdict: FAIL` inside an evidence table cell) stays `UNKNOWN`. |
| R3 | MET | No source ⇒ honest `UNKNOWN` plus one stderr diagnostic naming the task, the artifact path and the missing tracked verdict line: `plugins/sp/scripts/wrapup-steps.ts:370-374`; asserted at `plugins/sp/tests/wrapup-steps.test.ts:310` (row `UNKNOWN`) and `:317` (stderr contains `.spur/run/0770-verdict.json`). Status semantics untouched: `:387-388` still derive the status file from `metricsRc` only, and `config/workflows/wrapup-pipeline.yaml:282` still reads `is UNKNOWN telemetry, never proof of completion` (workflow file unmodified in the diff). |
| R4 | MET | Row literal unchanged and still single-sourced at `plugins/sp/scripts/wrapup-steps.ts:377` = `{ wbs, feature_id: featureId, status, verdict, timestamp }`; the pre-existing key-order assertion `plugins/sp/tests/wrapup-steps.test.ts:313` is a context line in `git diff eccb8caf3` (untouched) and passes in this run. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `plugins/sp/tests/wrapup-steps.test.ts:323-342` — no artifact + tracked `- Verdict: PASS (from verdict artifact)` ⇒ row `verdict: "PASS"` and empty stderr; second case `:345-362` — `Verdict: FAIL` only inside an evidence table cell ⇒ row stays `UNKNOWN`. Both pass this run (31 pass / 0 fail, 119 expect() calls). Corroborated end-to-end by the AC5 scratch run over real task 0967. |
| AC2 | MET | test | `plugins/sp/tests/wrapup-steps.test.ts:365-380` — artifact `{"verdict":"PARTIAL"}` plus tracked `PASS` records `PARTIAL` (artifact stays the first source, `plugins/sp/scripts/wrapup-steps.ts:369`). Passes this run. |
| AC3 | MET | test | `plugins/sp/tests/wrapup-steps.test.ts:296-320` — the no-artifact, no-tracked-verdict case still records `verdict: "UNKNOWN"` (`:310`) and its stderr names `.spur/run/0770-verdict.json` (`:317`). Passes this run; the step status file stays `PASS` for that case (`:307`). |
| AC4 | MET | test | `plugins/sp/tests/wrapup-steps.test.ts:313` — `expect(Object.keys(row)).toEqual(['wbs','feature_id','status','verdict','timestamp'])` passes and was not modified by the diff (context line in `git diff eccb8caf3 -- plugins/sp/tests/wrapup-steps.test.ts`). |
| AC5 | MET | command | Scratch copy `.spur/tmp/0994-verify-ac5` (main tree minus `node_modules`/`.git`, no `.spur/run/0967-verdict.json`, tracked `- Verdict: PASS (from verdict artifact)` at `docs/tasks5/0967_move-the-g66-member-session-out-of-the-agent-cli-into-a-spur.md:194`), capture `["0967"]`, `spurBin=bun apps/cli/src/index.ts`: base script (`git show eccb8caf3:plugins/sp/scripts/wrapup-steps.ts`) appended `{"wbs":"0967","feature_id":"G67","status":"done","verdict":"UNKNOWN","timestamp":"2026-09-28T19:04:07Z"}`; the working-tree script appended `…"verdict":"PASS"…` in the same second. The copy's log went 207 → 209 rows while the real `.spur/memory/wrapup-metrics.jsonl` stayed at 207 rows (its 0967 row is still `UNKNOWN` at `:197`). `bun run spur-check` on the current revision: rc=0, 9394 pass / 0 fail across 541 files, `rule run --preset recommended-post-check` 2 rules PASS (log `.spur/tmp/0994-verify-spur-check.log`; the stage's own gate log `.spur/run/0994-test-gate.log` was written at 11:58, after the last source edit at 11:45). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Review — 0994 (D62, wrap-up metrics verdict derivation), lane `safety:triage standard lane`, base `eccb8caf3425b58f213e3bcef1b0eaf67fea908c`. Diff: `wrapup-steps.ts` (+ `verdictFromTestingSection`, `verdictOfArtifact`, artifact-first row verdict, no-source stderr line), its `.mjs` twin, 4 new tests + 1 stderr assertion, task Solution/change map.

**Disposition: OK with notes.** No P1/P2 findings. The fallback is correct, minimal and artifact-first; the open items are a drift guard for the hand-copied parser and two advisories. Review P3-2 — the `.mjs` twin-parity gate gap — was closed during this run by `bun run script-contract-check` (29 scripts baselined, 0 violations).

#### Functional traceability (verified)

| Claim | Evidence |
| --- | --- |
| Root cause is real | `docs/tasks5/0967_…md:194` `- Verdict: PASS (from verdict artifact)`; `.spur/run/0967-verdict.json` absent in the main tree; the only 0967 row is `UNKNOWN` (`.spur/memory/wrapup-metrics.jsonl:197`) |
| R1 fallback + artifact precedence | `plugins/sp/scripts/wrapup-steps.ts:367-369`; test `plugins/sp/tests/wrapup-steps.test.ts:365-379` |
| R2 line-anchored match == `parseVerdictLine` | regex identical to `packages/app/src/services/task-record.ts:340` (machine diff, no difference); test `wrapup-steps.test.ts:345-363` |
| R3 honest UNKNOWN + named diagnostic | `wrapup-steps.ts:369-374`; status unchanged (`:382-385`); workflow semantics unchanged (`config/workflows/wrapup-pipeline.yaml:281-283`); assert `wrapup-steps.test.ts:317` |
| R4 schema unchanged | row literal `wrapup-steps.ts:376`; key-order assertion intact at `wrapup-steps.test.ts:313` |
| AC5 causal reproduction | scratch capture `["0967"]`: base script appended `UNKNOWN`, working-tree script appended `PASS`; real `.spur/memory/wrapup-metrics.jsonl` untouched at 207 rows |
| No collateral damage | `existsSync` still used (`wrapup-steps.ts:483,494`); twin mirrors the logic (`wrapup-steps.mjs:175-196,240-246,428`); no design satellite documents the verdict source, so no T3 doc sync is owed |

#### Findings

| Priority | Area | Location | Finding | Disposition |
| --- | --- | --- | --- | --- |
| P3 | maintainability | plugins/sp/scripts/wrapup-steps.ts:279-291 | Hand-copied verdict matcher with no drift guard: the copy is verbatim (ADR-065), but its `Testing` slice uses `#{2,4}` where the canonical `extractTestingSection` (`packages/app/src/services/task-record.ts:275-289`) uses `#{1,6}`. Reachable divergence: an h1 `# Testing` heading, or an h4 subheading before the Verdict line, reads as no verdict on the plugin side while the app sees one. Both degrade to honest `UNKNOWN` and `renderTesting` writes the Verdict line first, so no wrong `PASS` is reachable today. | DEFER — nothing fails if `parseVerdictLine` changes, so a parity test over a shared line corpus (or a JSDoc note recording the intentional slice divergence) is owed; it is a guard, not a defect, so it is filed rather than fixed inside a certification run |
| P4 | telemetry | plugins/sp/scripts/wrapup-steps.ts:369-374 | An explicit tracked `- Verdict: UNKNOWN` line yields `UNKNOWN` without the new diagnostic, because the stderr line fires only when both sources are `null`. R3's letter is met; log-based triage under-reports. | DEFER — optional hardening: `if (verdict === 'UNKNOWN')` |
| P4 | tests | plugins/sp/scripts/wrapup-steps.ts:273 | `verdictFromTestingSection` is exported but no test imports it directly. | DEFER — covered through the four `runMetrics` cases; a direct unit test is nicer, not required |
| P4 | docs | docs/tasks5/0994_persist-the-verify-verdict-artifact-so-wrap-up-metrics-survi.md | The Solution change-map ranges and the AC3/AC4 `Verify` line anchors drifted by about five lines once the section bodies were rewritten. | RESOLVED — section bodies rewritten through `spur task update` during this run |

#### Residual risk

1. Rows can now come from a human-writable tracked line (F93 measured 78 artifact-less `done` tasks carrying a `Verdict:` line); the log no longer distinguishes a machine-certified verdict from a hand-written one. Intended by R1 — relevant when the log is cited as evidence.
2. A literal artifact `"verdict": "UNKNOWN"` counts as a verdict and does not fall through to the tracked record. R1's "absent or yields no verdict" is honoured at field level; a present artifact stays authoritative. ACs pass either way.
3. Stale main-tree artifact precedence over a newer tracked verdict (pre-existing, disclosed in the task's Design, not widened).

Provenance: produced by the `review` stage's dispatched subagent (mission `730e7c2a-74ee-4bfa-9b45-b145b00c79de`, role reviewer, fresh context) and persisted by the pipeline host, because the reviewer agent is read-only and cannot write `answerFile` nor run `spur task update --section`. The review's content was not re-derived in the host.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-28T08:31:44.582Z backlog → todo (system)
- 2026-09-28T18:54:23.139Z todo → wip (system)
- 2026-09-28T19:12:41.902Z wip → testing (system)
- 2026-09-28T19:12:58.304Z testing → done (system)

