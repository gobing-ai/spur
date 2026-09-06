---
schema_version: 1
name: "Fix D61 pipeline execution blockers: stale executor doc and 0765 L4 preflight evidence"
status: todo
template: issue
created_at: 2026-09-05T23:39:09.522Z
updated_at: "2026-09-05T23:40:49.899Z"
feature_id: D61
---

## 0776. Fix D61 pipeline execution blockers: stale executor doc and 0765 L4 preflight evidence

### Background

Session triage of the feature D61 batch (2026-09-05) surfaced two execution blockers unrelated to task substance:

1. **Stale executor doc.** `config/workflows/task-pipeline.yaml:68` documents `--vars '{"implementAgent":"omp-zai"}'`, but `omp-zai` is not in the runtime's accepted-executor registry — pipeline run 531e6c03 failed dispatch in 1.1s with `Unknown agent: 'omp-zai'. Accepted: role (scribe, coder, reviewer, planner), configured executor (minimax, pi-dsv4-flash-volc, pi-zai-volc, pi-zai, pi-zai-cn, pi-zai-nvidia, agy-gemini, pi-deepseek, agy-opus, grok, claude), 'inline', or 'auto'`. A valid pin is `pi-zai` (after `executionCapabilities` attestation per 0706 R5, cf. commits b36193142 and cbf4d20b6). The main-repo copy was corrected inline during triage; the worktree copy inherits at merge.

2. **0765 L4 preflight gap.** `spur feature check D61 --strict --json` returns `pass=false` — `L4.evidence-not-recoverable` on task 0765 ("no verdict artifact and its tracked ## Testing section carries no recoverable coverage evidence") plus three downstream `L4.scenario-unverified` findings (feature scenarios R1–R3, covered by 0765). Any `--feature D61`-derived strict preflight aborts on this; the batch bypassed it with explicit `--tasks` selectors. Reproduced 2026-09-05T23:38Z (pass=false, both finding kinds present).

Out of scope (excluded, owner elsewhere): `implementAgent=auto` resolving via capability attestation rather than the operator's session model (operator-owned decision); end-of-batch duplicate-SHA merge cleanup (tracked in the D61 batch report).

### Requirements

- **R1 — Valid executor example:** `config/workflows/task-pipeline.yaml` contains no reference to a nonexistent executor id; the pin example uses a registry-valid id (`pi-zai`) in both checkouts (main fixed 2026-09-05; worktree at/after merge).
- **R2 — Feature strict check recovers:** `spur feature check D61 --strict` no longer emits `L4.evidence-not-recoverable` for 0765: either 0765's recorded evidence becomes recoverable (verdict artifact / Testing section carries concrete coverage evidence) or the check reads the evidence 0765's record stage actually produced.
- **R3 — Scenario findings resolve:** the three `L4.scenario-unverified` findings on feature scenarios R1–R3 clear as a consequence of R2 (same evidence root) or gain their own recorded coverage evidence.

### Acceptance Criteria

- **AC1:** `grep -rn 'omp-zai' config/workflows/task-pipeline.yaml` returns no matches in both checkouts.
- **AC2:** `spur feature check D61 --strict --json` returns `pass=true` with zero `L4.evidence-not-recoverable` and zero `L4.scenario-unverified` findings, without bypassing via `--tasks`.

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

- R1: one-line comment fix (already applied to the main checkout during triage; port to the worktree post-merge or cherry-pick the main commit).
- R2: inspect 0765's record-stage output — the task reached done (commit 56e7e85cb) but `.spur/run/0765-verdict.json` is absent from the tracked evidence path the check consults. Two candidate repairs: (a) reconstruct/regenerate the evidence via the documented history surfaces (source-local CLI, `docs/04_DESIGN.md`), or (b) teach the check to read the recorded artifact. Prefer (a) — the check's contract (evidence must be recoverable) is sound; the gap is 0765's artifact placement.
- R3: expected to clear with R2 (same evidence root); verify after R2 lands.

### Plan

1. Port the yaml:68 example fix to the worktree copy (or cherry-pick the main commit) once the live 0773 pipeline run goes terminal.
2. Locate 0765's record-stage artifacts (run log of the 0765 pipeline; `agent-sessions/` evidence) and determine why the verdict artifact is not where the L4 check looks.
3. Repair evidence placement or regenerate per history-surface docs; re-run `spur feature check D61 --strict --json` until `pass=true`.
4. Confirm R1–R3 scenario findings clear; run `spur task check 0765 --json` to confirm no regression.

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Pipeline run 531e6c03 log: `.spur/run/531e6c03-11d8-49b9-b4e5-53194fa6f7c3.log` (Unknown agent error, verbatim accepted list)
- Pipeline run bda16b4d log: `.spur/run/bda16b4d-36f8-4e2c-8197-dbcf8576a85a.log` (capability tripwire context for the pi-zai pin)
- Commits: b36193142, cbf4d20b6 (executionCapabilities attestation pattern)
- Reproduction: `spur feature check D61 --strict --json` (2026-09-05T23:38Z, pass=false)
- Session triage report, 2026-09-05 (active session review with --triage)

### History
