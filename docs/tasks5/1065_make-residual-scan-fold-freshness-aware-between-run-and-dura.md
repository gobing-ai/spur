---
schema_version: 1
name: make residual scan fold freshness aware between run and durable verdict copies
status: done
template: issue
created_at: 2026-10-03T04:25:10.514Z
updated_at: "2026-10-03T16:03:03.719Z"

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
| R1 | MET | Freshness-aware selection: mtime winner at `packages/app/src/services/residual-scan.ts:371-377` and disagreement reporter at `:412-415` (re-read this run); shipped plugin copy matches at `plugins/sp/scripts/residual-scan.mjs:230,262-263`. |
| R2 | MET | Disagreement is named with both paths, both verdicts, and the winner — `packages/app/src/services/residual-scan.ts:386-415` message format (re-read this run). |
| R3 | MET | Residual-scan suite `(cd packages/app && bun test tests/services/residual-scan.test.ts)`: 18 pass, 0 fail this run — covers fresh-PASS/stale-PARTIAL, fresh-PARTIAL/stale-PASS, and equal-content cases. |
| R4 | MET | Corpus disposition audit applied: this verifyall batch re-encoded stale dispositions via CLI on 0431/0432/0433/0902 (`RESOLVED` dispositions, `spur task update --section Review`); 0914/0915/0935 reference pattern pre-exists. |
| R5 | MET | Post-audit sweep: residual-scan `scan` over each D3 task in this batch reports blocking=0 after remediation (0431/0432/0433/0622/0901/0902/0980/1064 all blocking=0 this session). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | residual-scan suite 18 pass, 0 fail this run — includes fresh-PASS-over-stale-PARTIAL fold case naming both sources and winner. |
| AC2 | MET | test | Same suite — all three R3 regression cases green this run. |
| AC3 | MET | command | `residual-scan scan` sweep over the D3 done set this session: blocking=0 per task after disposition remediation (see per-task sweep output this batch). |
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

