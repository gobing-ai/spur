---
schema_version: 1
name: make residual scan fold freshness aware between run and durable verdict copies
status: done
template: issue
created_at: 2026-10-03T04:25:10.514Z
updated_at: "2026-10-03T06:02:54.224Z"

feature_id: D3
priority: P2
ac_altitude: task-local
done_forced: "false"
done_reason: unforced close; PASS artifact at /Users/robin/xprojects/spur-new-runall-d3-82ca7e3c/.spur/memory/evidence/1065-verdict.json
---

## 1065. make residual scan fold freshness aware between run and durable verdict copies

### Background

Surfaced 2026-10-02 during `/sp-dev-verifyall --feature D63 --force` (session review findings F1/F2).

**Defect 1 — stale durable verdict wins over fresh run copy.** `recordedVerdictPath` (packages/app/src/services/residual-scan.ts:336) returns the durable `.spur/memory/evidence/<wbs>-verdict.json` whenever it exists, regardless of age; `fold` (plugins/sp/scripts/residual-scan.ts:137) then folds THAT copy and writes the result back to the same target. Observed sequence on 0914: `spur task verdict 0914` wrote PASS to `.spur/run/0914-verdict.json` (fresh), but fold loaded the durable PARTIAL (written by an earlier fold that had downgraded on blocking residuals), re-derived PARTIAL, and wrote PARTIAL back — a self-reinforcing stale loop. Three recovery rounds needed; only deleting the durable and re-running verdict+fold adjacently converged. 0915 and 0935 hit the identical trap in the same sweep.

**Defect 2 — historical review findings lack machine-readable dispositions.** The scanner (DISPOSITION_HEADER/RESOLVED_DISPOSITION in packages/app/src/services/residual-scan.ts) clears a P1–P3 finding only when a `Disposition|Action|Status|Resolution|Fixed` column carries `RESOLVED|FIXED|DONE`. Tasks done before that contract encode resolution as prose (`Resolved: …` prefix in the Finding column) — residual sweeps then downgrade them to PARTIAL on every verifyall. In the D63 sweep alone, 8 blocking residuals across 0914/0915/0935 were all historical resolved findings; fixed ad hoc by adding a Disposition column via `spur task update --section Review` (commit 3a4dcf541). Other features' done tasks likely carry the same latent pattern; the audit must be corpus-wide, not D63-scoped.

Both defects share one surface (residual-scan verdict/disposition handling) and one blast radius (every future verifyall/re-record sweep), so they land as one task.

### Requirements

- [x] R1. `recordedVerdictPath` (packages/app/src/services/residual-scan.ts:336) becomes freshness-aware: when both the run copy `.spur/run/<wbs>-verdict.json` and the durable copy `.spur/memory/evidence/<wbs>-verdict.json` exist and disagree, fold selects the newer one (mtime, or a recorded-at field if present) and reports the choice.
- [x] R2. Disagreement is never silent: fold output names both paths, both verdicts, and which one won, so an operator can see a stale durable being overridden.
- [x] R3. Regression tests: (a) fresh run PASS + stale durable PARTIAL → fold resolves PASS and says why; (b) fresh run PARTIAL + stale durable PASS → fold resolves PARTIAL; (c) equal content → no report noise. Tests live in the residual-scan suite (packages/app/tests or the script's existing test home).
- [x] R4. Corpus-wide disposition audit: enumerate every done task whose Review table has P1–P3 rows without a scanner-recognized Disposition value; for each, confirm the finding is genuinely resolved in current code (or carries a written rationale), then encode `RESOLVED` via `spur task update <wbs> --section Review` — never raw file edits. 0914/0915/0935 are already done (3a4dcf541) and serve as the reference pattern.
- [x] R5. Post-audit sweep: `residual-scan scan` + `fold` over every audited task reports blocking=0; a task whose finding cannot be confirmed resolved is re-opened as a real defect instead of being dispositioned.

### Acceptance Criteria

- [x] AC1 — Fresh run-file PASS followed by fold yields verdict=PASS even when a stale durable PARTIAL exists; output names both sources and the winner. (req: R1, R2)
- [x] AC2 — The three regression cases of R3 pass in the residual-scan suite. (req: R3)
- [x] AC3 — The audit script lists all done tasks with unrecognized dispositions, and after remediation a full sweep shows zero blocking residuals across the done set. (req: R4, R5)

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `packages/app/src/services/residual-scan.ts:139` |
| `packages/app/src/services/residual-scan.ts:158` |
| `packages/app/src/services/residual-scan.ts:343` |
| `packages/app/src/services/residual-scan.ts:357` |
| `packages/app/src/services/residual-scan.ts:361` |
| `packages/app/src/services/residual-scan.ts:369` |
| `packages/app/src/services/residual-scan.ts:64` |
| `packages/app/src/services/residual-scan.ts:69` |
| `packages/app/tests/services/residual-scan.test.ts:15` |
| `packages/app/tests/services/residual-scan.test.ts:19` |
| `packages/app/tests/services/residual-scan.test.ts:2` |
| `packages/app/tests/services/residual-scan.test.ts:22` |
| `packages/app/tests/services/residual-scan.test.ts:293` |
| `plugins/sp/scripts/residual-scan.ts:118` |
| `plugins/sp/scripts/residual-scan.ts:137` |
| `plugins/sp/tests/residual-scan.test.ts:2` |
| `plugins/sp/tests/residual-scan.test.ts:28` |
| `plugins/sp/tests/residual-scan.test.ts:327` |
| `scripts/commands/bundle-plugin-lib.ts:353` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/residual-scan.ts` `recordedVerdictPath` picks the newer of run/durable copy by mtime (`mtimeOf` catch → 0), tie → run copy via strict `>`; covered by test "prefers the newer verdict copy" incl. durable-newer-wins case (`packages/app/tests/services/residual-scan.test.ts`, describe "verdict copy freshness (task 1065)") |
| R2 | MET | `verdictDisagreementNote(runDir, wbs, fs)` compares captured vs folded verdict and returns a note when they differ; plugin glue emits the note before folding (`plugins/sp/scripts/residual-scan.ts` fold flow); covered by note tests incl. "chose run"/"chose durable"/null cases |
| R3 | MET | tests/services/residual-scan.test.ts: (a) freshness selection both directions, (b) disagreement note emission, (c) fold write-back is atomic (tmp+rename) to the chosen target with scratch sync so copies converge (silent steady state). 18/18 pass in the file; plugins/sp residual-scan tests 25/25 |
| R4 | MET | Audited all 195 done tasks in-process via `scanResiduals`; 16 offenders remediated by prefixing `RESOLVED: <rationale>` via `spur task update <wbs> --section Review --from-file` (never raw writes). Re-audit after remediation: 0 blocking review-finding across the done set. Two parser defects surfaced and fixed at root (range-priority marker rows `P1–P3` no longer parsed as findings; escape-aware `splitRow` so `\|` inside a cell no longer misaligns disposition columns); regexes made ASCII-only after the shebang'd standalone twin decoded non-ASCII regex literals as latin1. Regression tests added (3, all pass) |
| R5 | MET | Script-level (`plugins/sp/scripts/residual-scan.mjs scan`) over all 17 originally-audited tasks after rebuild: 17/17 report `blocking=0` (R5_SWEEP_PASS=17/17). Fold flow itself is exercised by the settle stage on this task's own artifacts |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | foldVerdict test asserts fresh PASS folds PASS and names the chosen copy; glue fold emits "chose run"/"chose durable" via the disagreement note path (null when silent) |
| AC2 | MET | test | `bun test tests/services/residual-scan.test.ts` (packages/app): 18 pass / 0 fail; plugins/sp residual-scan tests: 25 pass / 0 fail |
| AC3 | MET | command | Pre-remediation audit listed 16 offender tasks; post-remediation in-process audit `BLOCKING_TASKS=0` over 195 done tasks; script sweep `R5_SWEEP_PASS=17/17` with per-task `blocking=0` in `.spur/run/<wbs>-residuals.json` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- Logic: packages/app/src/services/residual-scan.ts:289 (foldVerdict), :336 (recordedVerdictPath); glue plugins/sp/scripts/residual-scan.ts:119, :137. Installed entry resolves via `superskill script path sp residual-scan.mjs` (never invoke plugins/sp/scripts directly — script-contract-check rule 4).
- Session evidence: verifyall D63 run 2026-10-02; recovery trace in session; pitfalls entry `.spur/context/pitfalls.md` (2026-10-02 residual-scan precedence).
- Disposition contract precedent: commit 3a4dcf541 (0914/0915/0935 Review tables).
- Related: task 0936 (preserve feature scenario-key rows when re-verifying/re-recording); 0958 R1 (embedded scenario refs); dogfood report docs/dogfood/2026-10-02-D63-runall-batch-wt4-dogfood.md (local).

### History

- 2026-10-03T05:00:28.704Z todo → wip (system)
- 2026-10-03T06:02:30.329Z wip → testing (system)
- 2026-10-03T06:02:54.212Z testing → done (system)

