---
schema_version: 1
name: "Wrapup drift probe: classify doc-owned surfaces against the feature span, not per-task diffs"
status: cancelled
template: feature-impl
created_at: 2026-10-02T23:30:38.595Z
updated_at: "2026-10-03T00:00:20.014Z"
feature_id: D63

---

## 1060. Wrapup drift probe: classify doc-owned surfaces against the feature span, not per-task diffs

### Background

**Origin:** D62 runall session (2026-10-02), dogfood finding F2. **Corrected mechanism — the initial hypothesis ("probe inspects per-task diffs, span-blind") was wrong; source-verified since.**

**Probe mechanics (confirmed, `plugins/sp/scripts/wrapup-drift-probe.ts`):** input is NOT git state — it is each task file's `### Solution` section: `changedPathsOf(solutionSectionOf(content))` (lines ~124-136, ~234). It matches those change-map paths against doc-owned surfaces (`plugins/sp/skills/**` among them; corpus prefixes excluded; build-time SSOT), writes `<runId>-drift-probe.json` (`{clean, reasons, paths}`) + `<runId>-mode.txt` under `.spur/run/`, and fails safe (empty mode = dirty = full-wrapup route; lookup/parse problem = dirty, never silently clean). Invoked from wrapup-pipeline.yaml `task-resolve` onEnter (task 0944, feature D64, ADR-115).

**Observed behavior (all four D62 wrap runs, artifacts under `.spur/run/<id>-drift-probe.json`):** `clean:false` with the identical reason `1055: plugins/sp/skills/code-implementation/SKILL.md matches doc-owned surface plugins/sp/skills/**` — including the final fully successful run `a2c2be93`. The other artifacts: `808c67b9` (failed preflight `L4.dogfood-missing` — drift not the blocker), `abcefc87` (same preflight class), `fb334c41` (route `safety:missing evidence (mode empty)`, then failed at feature-transition sync rc=1).

**The durable problem:** the `### Solution` change-map is an immutable historical record. Task 1055 legitimately touched `plugins/sp/skills/code-implementation/SKILL.md` (1055's deliverable was the SKILL.md external-evidence frozen form at line 187) and its owning design-doc sync (`fdb7882cd`, `docs/design/planning-workflow-contracts.md` change-map row) landed in the same span. Yet the probe re-flags the drift on **every** future wrapup of these tasks, forever, because nothing tells it the drift was reconciled. Dirty is a route (full wrapup incl. the doc-sync model step, ~4.5-6.5 min/run), not a failure — so batches complete, but merged-and-synced tasks permanently force the expensive mode and emit a misleading "dirty" verdict.

**Excluded:** the doc-sync content itself (landed, `fdb7882cd`); the preflight L4 gate behavior (separate concern, working as designed); 0944's original composition-budget scope (D64, done).

**Refine corrections (2026-10-02)**

The original per-task Git-diff diagnosis is false: the probe reads historical Solution paths. The claim of stale unsolved drift is also unsupported: wrapup-drift-probe.ts:12 and tests/wrapup-drift-probe.test.ts:76 explicitly define any doc-owned change as conservative routing evidence, not an assertion that sync is absent. A changed owner file in an arbitrary Git span cannot prove the relevant contract was reconciled, and a completed D62 wrap does not prove arbitrary future HEAD inputs. Therefore cancel this proposed bugfix; no safe fast-path optimization is justified by its evidence. A future measured optimization needs an affirmative current-input reconciliation proof and a separately frozen design; do not suppress the probe, alter immutable Solution records or retrofit a receipt framework here.

### Requirements

- [x] R1. Resolve the diagnostic by source verification: no defect established against the conservative routing contract; cancel this task and withdraw its span-based reconciliation shortcut. This checkbox records completed triage, not runtime implementation.

### Acceptance Criteria

Not applicable: cancelled diagnostic; no claim of implementation or runtime verification PASS.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-02T23:58:12.837Z

Closed: cancelled, not deferred as an implementable bug. Performance optimization is a separate measured product decision with a proof design, not a diagnostic fix. Existing full-wrapup route is expected behavior. No overlap transferred to 1058, 1059 or 1061.

### Design

Keep current probe and routing unchanged. Existing script explicitly defines doc-owned paths as safety-route evidence regardless of earlier synchronization. Owner-file presence in a Git diff is insufficient semantic proof. No new flag, schema, receipt, workflow step or dependency.

### Plan

1. Preserve historical incident and record the source-verified correction.
2. Cancel through the task CLI; retain the ID and history so future reviews can deduplicate this same conservative-routing observation.
3. Do not delegate runtime implementation from this task.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

Audit only: `(cd plugins/sp && bun test tests/wrapup-drift-probe.test.ts tests/dogfood-testing/execution-batch-contract.test.ts)` passed 45 tests, including all ten drift-probe cases. The tests intentionally require doc-owned paths to remain dirty. No production wrapup or feature transition was run.

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

plugins/sp/scripts/wrapup-drift-probe.ts:12; plugins/sp/scripts/wrapup-drift-probe.ts:234; plugins/sp/tests/wrapup-drift-probe.test.ts:76; config/workflows/wrapup-pipeline.yaml:179. Audit HEAD 8467f6f6d. Historical D62 session artifact claims are retained as narrative, not proof of a current defect.

### History

- 2026-10-02T23:41:48.146Z backlog → todo (system)
- 2026-10-02T23:58:13.620Z todo → cancelled (system)

