---
schema_version: 1
name: "Wrapup drift probe: classify doc-owned surfaces against the feature span, not per-task diffs"
status: backlog
template: feature-impl
created_at: 2026-10-02T23:30:38.595Z
updated_at: "2026-10-02T23:39:46.371Z"
feature_id: D63

---

## 1060. Wrapup drift probe: classify doc-owned surfaces against the feature span, not per-task diffs

### Background

**Origin:** D62 runall session (2026-10-02), dogfood finding F2. **Corrected mechanism — the initial hypothesis ("probe inspects per-task diffs, span-blind") was wrong; source-verified since.**

**Probe mechanics (confirmed, `plugins/sp/scripts/wrapup-drift-probe.ts`):** input is NOT git state — it is each task file's `### Solution` section: `changedPathsOf(solutionSectionOf(content))` (lines ~124-136, ~234). It matches those change-map paths against doc-owned surfaces (`plugins/sp/skills/**` among them; corpus prefixes excluded; build-time SSOT), writes `<runId>-drift-probe.json` (`{clean, reasons, paths}`) + `<runId>-mode.txt` under `.spur/run/`, and fails safe (empty mode = dirty = full-wrapup route; lookup/parse problem = dirty, never silently clean). Invoked from wrapup-pipeline.yaml `task-resolve` onEnter (task 0944, feature D64, ADR-115).

**Observed behavior (all four D62 wrap runs, artifacts under `.spur/run/<id>-drift-probe.json`):** `clean:false` with the identical reason `1055: plugins/sp/skills/code-implementation/SKILL.md matches doc-owned surface plugins/sp/skills/**` — including the final fully successful run `a2c2be93`. The other artifacts: `808c67b9` (failed preflight `L4.dogfood-missing` — drift not the blocker), `abcefc87` (same preflight class), `fb334c41` (route `safety:missing evidence (mode empty)`, then failed at feature-transition sync rc=1).

**The durable problem:** the `### Solution` change-map is an immutable historical record. Task 1055 legitimately touched `plugins/sp/skills/code-implementation/SKILL.md` (1055's deliverable was the SKILL.md external-evidence frozen form at line 187) and its owning design-doc sync (`fdb7882cd`, `docs/design/planning-workflow-contracts.md` change-map row) landed in the same span. Yet the probe re-flags the drift on **every** future wrapup of these tasks, forever, because nothing tells it the drift was reconciled. Dirty is a route (full wrapup incl. the doc-sync model step, ~4.5-6.5 min/run), not a failure — so batches complete, but merged-and-synced tasks permanently force the expensive mode and emit a misleading "dirty" verdict.

**Excluded:** the doc-sync content itself (landed, `fdb7882cd`); the preflight L4 gate behavior (separate concern, working as designed); 0944's original composition-budget scope (D64, done).

### Requirements

1. **Reconciliation signal:** give the probe a way to recognize already-reconciled drift. Preferred: for each flagged doc-owned path, check the actual span (merge-base of the batch/base ref..HEAD, or main-tip delta at wrap time) — if the owning design surface for the flagged path changed in-span, classify reconciled → clean with an explanatory reason (e.g. `reconciled-in-span:<path>`). Alternative (simpler): a scope note in the change-map format the probe honors, set by the driver at wrap time after verifying the sync exists in-span.
2. **Fail-safe preserved:** any lookup, parse, path-resolution, or git-read failure still routes dirty; the reconciled path is an affirmative positive finding, never a default.
3. **Dirty remains a route, not a failure:** unchanged for genuinely unreconciled drift — full wrapup mode with doc-sync step, exactly as today.
4. **Artifacts contract stable:** `drift-probe.json` / `mode.txt` shapes and consumers (wrapup-pipeline.yaml task-resolve, route-reason.txt) stay compatible; new reason strings must not break existing parsers (check `wrapup-steps.ts` consumers).

### Acceptance Criteria

- AC1: regression test — a task whose Solution lists a doc-owned surface path with the owning sync present in-span routes clean (reason names the reconciliation); pinned in `plugins/sp/tests/wrapup-drift-probe.test.ts`.
- AC2: regression test — same input without any in-span sync still routes dirty (fail-safe intact).
- AC3: regression test — corrupted/unreadable task Solution or git failure routes dirty (never clean).
- AC4: a real wrapup re-run over merged D62 tasks no longer prints the stale `1055: plugins/sp/skills/code-implementation/SKILL.md` reason; run artifact referenced in Testing.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

- `(cd plugins/sp && bun test tests/wrapup-drift-probe.test.ts)` for the probe unit tests (extend with AC1-AC3 cases; use temp-dir task fixtures, not corpus).
- `(cd packages/app && bun test tests/workflow/wrapup-pipeline.test.ts)` for pipeline routing parity.
- `bun run build:scripts` to regen the `.mjs` twin, then `bun run script-contract-check` and `bun run plugin-smoke`.
- Live check for AC4: re-run wrapup over a merged D62 task set (`spur workflow run wrapup-pipeline.yaml --vars '{"tasks":"[\"1055\"]","profile":"auto","merge":"false","agent":"coder"}'` — or the lighter task-resolve-only path if available) and reference the new run's `drift-probe.json` + `route-reason.txt` as evidence.

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
