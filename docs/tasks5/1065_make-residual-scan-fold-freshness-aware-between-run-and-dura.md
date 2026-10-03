---
schema_version: 1
name: make residual scan fold freshness aware between run and durable verdict copies
status: todo
template: issue
created_at: 2026-10-03T04:25:10.514Z
updated_at: "2026-10-03T04:42:35.634Z"

feature_id: D3
priority: P2
ac_altitude: task-local
---

## 1065. make residual scan fold freshness aware between run and durable verdict copies

### Background

Surfaced 2026-10-02 during `/sp-dev-verifyall --feature D63 --force` (session review findings F1/F2).

**Defect 1 — stale durable verdict wins over fresh run copy.** `recordedVerdictPath` (packages/app/src/services/residual-scan.ts:336) returns the durable `.spur/memory/evidence/<wbs>-verdict.json` whenever it exists, regardless of age; `fold` (plugins/sp/scripts/residual-scan.ts:137) then folds THAT copy and writes the result back to the same target. Observed sequence on 0914: `spur task verdict 0914` wrote PASS to `.spur/run/0914-verdict.json` (fresh), but fold loaded the durable PARTIAL (written by an earlier fold that had downgraded on blocking residuals), re-derived PARTIAL, and wrote PARTIAL back — a self-reinforcing stale loop. Three recovery rounds needed; only deleting the durable and re-running verdict+fold adjacently converged. 0915 and 0935 hit the identical trap in the same sweep.

**Defect 2 — historical review findings lack machine-readable dispositions.** The scanner (DISPOSITION_HEADER/RESOLVED_DISPOSITION in packages/app/src/services/residual-scan.ts) clears a P1–P3 finding only when a `Disposition|Action|Status|Resolution|Fixed` column carries `RESOLVED|FIXED|DONE`. Tasks done before that contract encode resolution as prose (`Resolved: …` prefix in the Finding column) — residual sweeps then downgrade them to PARTIAL on every verifyall. In the D63 sweep alone, 8 blocking residuals across 0914/0915/0935 were all historical resolved findings; fixed ad hoc by adding a Disposition column via `spur task update --section Review` (commit 3a4dcf541). Other features' done tasks likely carry the same latent pattern; the audit must be corpus-wide, not D63-scoped.

Both defects share one surface (residual-scan verdict/disposition handling) and one blast radius (every future verifyall/re-record sweep), so they land as one task.

### Requirements

- [ ] R1. `recordedVerdictPath` (packages/app/src/services/residual-scan.ts:336) becomes freshness-aware: when both the run copy `.spur/run/<wbs>-verdict.json` and the durable copy `.spur/memory/evidence/<wbs>-verdict.json` exist and disagree, fold selects the newer one (mtime, or a recorded-at field if present) and reports the choice.
- [ ] R2. Disagreement is never silent: fold output names both paths, both verdicts, and which one won, so an operator can see a stale durable being overridden.
- [ ] R3. Regression tests: (a) fresh run PASS + stale durable PARTIAL → fold resolves PASS and says why; (b) fresh run PARTIAL + stale durable PASS → fold resolves PARTIAL; (c) equal content → no report noise. Tests live in the residual-scan suite (packages/app/tests or the script's existing test home).
- [ ] R4. Corpus-wide disposition audit: enumerate every done task whose Review table has P1–P3 rows without a scanner-recognized Disposition value; for each, confirm the finding is genuinely resolved in current code (or carries a written rationale), then encode `RESOLVED` via `spur task update <wbs> --section Review` — never raw file edits. 0914/0915/0935 are already done (3a4dcf541) and serve as the reference pattern.
- [ ] R5. Post-audit sweep: `residual-scan scan` + `fold` over every audited task reports blocking=0; a task whose finding cannot be confirmed resolved is re-opened as a real defect instead of being dispositioned.

### Acceptance Criteria

- [ ] AC1 — Fresh run-file PASS followed by fold yields verdict=PASS even when a stale durable PARTIAL exists; output names both sources and the winner. (req: R1, R2)
- [ ] AC2 — The three regression cases of R3 pass in the residual-scan suite. (req: R3)
- [ ] AC3 — The audit script lists all done tasks with unrecognized dispositions, and after remediation a full sweep shows zero blocking residuals across the done set. (req: R4, R5)

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Logic: packages/app/src/services/residual-scan.ts:289 (foldVerdict), :336 (recordedVerdictPath); glue plugins/sp/scripts/residual-scan.ts:119, :137. Installed entry resolves via `superskill script path sp residual-scan.mjs` (never invoke plugins/sp/scripts directly — script-contract-check rule 4).
- Session evidence: verifyall D63 run 2026-10-02; recovery trace in session; pitfalls entry `.spur/context/pitfalls.md` (2026-10-02 residual-scan precedence).
- Disposition contract precedent: commit 3a4dcf541 (0914/0915/0935 Review tables).
- Related: task 0936 (preserve feature scenario-key rows when re-verifying/re-recording); 0958 R1 (embedded scenario refs); dogfood report docs/dogfood/2026-10-02-D63-runall-batch-wt4-dogfood.md (local).

### History
