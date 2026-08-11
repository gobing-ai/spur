---
template: meta
schema_version: 1
name: "Fine-tune inline execution surface: subagent-first dispatch for non-interactive pipeline stages with host-session fallback"
description: ""
status: backlog
type: meta
profile: standard
feature_id: E
parent_wbs: null
priority: P2
tags: ["meta"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-11T06:19:26.407Z"
updated_at: "2026-08-11T06:22:48.127Z"
---

## 0508. Fine-tune inline execution surface: subagent-first dispatch for non-interactive pipeline stages with host-session fallback

### Background
The 0505 run (task 0505, session `2026-08-11T04-35-08-988Z_019fef1a...`) completed under `/sp:dev-run 0505 --auto --next --agent inline` with a PASS verdict, but the post-mortem showed the host session absorbed the entire model-bearing load: 27.2M tokens (23.7M host + 3.2M wrap subprocess), 156 model round-trips, 38.1 min wall (23.2 min thinking latency), all inside one context. The inline-default execution-surface contract (cross-cutting.md §inline-default) currently fixes `inline` to the host session unconditionally: "the current coding agent is already executing the command, so inline means continuing in that session." The harness already ships native subagents (`task` tool; `parallel-execution/references/dispatch-surface.md`: "use the native subagent when the host platform provides one"), but the pipeline driver never uses them — every non-interactive stage (implement, review, verify, test-fix) runs in the host context regardless of size or suitability.

This task refines the inline surface: when the current agent platform provides a native subagent and a capable agent exists for the stage, dispatch non-interactive model-bearing stages to that subagent (distinct provenance), keeping the host session as the fallback and as the owner of interactive/operator-confirm decision points. The `inline` value's semantics are unchanged (host session = fallback); the refinement is additive and explicit, not a silent default flip.
### Requirements
- [ ] R1. Define the subagent dispatch criteria for pipeline stages: a stage may dispatch to a native subagent only when (a) the platform exposes a subagent mechanism (task tool or equivalent), (b) the stage is non-interactive (no operator-confirm/taste/ask pause), (c) a capable agent exists for the stage (full-capability for implement/verify/test-fix, read-only acceptable for review), and (d) the expected handoff cost is smaller than the host context it saves. Document the criteria in cross-cutting.md next to the inline-default contract.
- [ ] R2. Add distinct provenance for subagent-dispatched stages: the inline run log records `stage <id> executed via subagent <agent-id> (host session <session-id>)` — never the plain `executed inline` line — and the stage's answerFile/expectFile/requireDiff semantics are enforced on the subagent's returned artifacts exactly as for host execution.
- [ ] R3. Implement the dispatch path: when criteria R1 pass and the operator's selector allows subagent use, the inline pipeline driver passes the pure slash command (ADR-043) + surface-resolved note + `local://` contract refs to the native subagent; the host remains the fallback when no subagent/capable agent is available or the stage is interactive.
- [ ] R4. Keep interactive stages host-owned: operator-confirm step (operator-confirm step), taste/ask decision pauses, and todo-driven steps never dispatch; the pipeline's `pause: true` states and any step that can surface an operator prompt stay in the host session.
- [ ] R5. Update the parity surface: flag-glossary `--agent` entry, cross-cutting value table (add the subagent note without changing `inline`'s semantics), and `validate-flag-contracts.ts` C3a/C3b fixtures stay green; document the subagent surface in execution-workflow.md and the inline-pipeline-driver.md.
### Acceptance Criteria
Scenario: R1 — Subagent dispatch criteria are documented and checkable
  Given the inline pipeline driver considers a non-interactive stage
  When the platform has a native subagent and a capable agent for the stage
  And the handoff cost is smaller than the saved host context
  Then the stage MAY dispatch to the subagent
  And the criteria are stated in cross-cutting.md next to the inline-default contract

Scenario: R2 — Subagent stages carry distinct provenance
  Given a stage dispatched to a native subagent
  When the run log records the stage
  Then it reads `stage <id> executed via subagent <agent-id> (host session <session-id>)`
  And answerFile/expectFile/requireDiff are enforced on the subagent's returned artifacts

Scenario: R3 — Host session is the fallback
  Given a platform with no native subagent, or no capable agent, or an interactive stage
  When the pipeline driver executes the stage
  Then it runs in the host session as today (no subagent, no subprocess)
  And the run log records `stage <id> executed inline in session <session-id>`

Scenario: R4 — Interactive stages never dispatch
  Given a pipeline state that pauses for operator input (approve, taste, ask)
  When the driver reaches it
  Then it stays in the host session and surfaces the prompt to the operator

Scenario: R5 — Parity contract stays green
  Given the flag-glossary and cross-cutting value tables updated with the subagent surface
  When `bun test plugins/sp/tests/flag-contract-parity.test.ts` runs
  Then C3a/C3b fixtures pass and `inline` semantics are unchanged (host session fallback)
### Q&A
**Q: Why not change `--agent inline` to mean "subagent-first"?**

A: `inline` is a documented, parity-tested value (`validate-flag-contracts.ts` C3a/C3b): "the current session does the work." Silently redefining it to spawn subagents would break the parity fixtures, invert the operator's explicit `--agent inline` choice (as in 0505), and mislabel provenance. The refinement is additive: `inline` keeps meaning host-session fallback; subagent dispatch becomes an explicit, criteria-gated surface the driver may use.

**Q: What exactly does the host session save by dispatching?**

A: Context. The 0505 run put 23.7M tokens / 156 round-trips through one context, and the wrap hop's 3 subprocess agents cost 3.2M tokens partly re-reading what the host already knew. Dispatching a non-interactive stage to a native subagent with `'/Users/robin/.omp/agent/sessions/-xprojects-spur-new/2026-08-11T04-35-08-988Z_019fef1a-583c-7000-9c00-944ff32a0838/local'` refs (not re-reads) contains that growth in a disposable context and keeps the host transcript readable.

**Q: Isn't this what `--agent auto` / subprocess already does?**

A: No. Subprocess (`spur agent run`) is a separate OS process with its own agent binary, storage, and audit record — heavyweight, and it was flagged as the 0505 wrap violation. A native subagent shares the host platform's tooling and working tree, is cheaper to spawn, and is already the documented default in `dispatch-surface.md`. This task extends that existing preference from parallel fan-out to sequential pipeline stages.

**Q: What are the hard constraints?**

A: (1) Provenance must never claim "inline" for subagent work; (2) interactive stages (approve/taste/ask) must never leave the host; (3) requireDiff/answerFile/expectFile must be enforced on the subagent's returned artifacts exactly as for host execution; (4) no recursion — a subagent receives the pure slash command with the surface already resolved (ADR-043); (5) parity fixtures updated in the same change.

**Q: How is the host kept as the fallback?**

A: The driver checks platform subagent support and per-stage capability before dispatching. Any check failing (no subagent mechanism, no capable agent, interactive stage, handoff cost too high) falls back to the current host-session path with the existing `executed inline` provenance. The fallback is the default, not the exception.

**Q: What is out of scope?**

A: Changing `inline`'s documented semantics; forcing subagent dispatch in headless/subprocess mode (`--agent auto`/named executors already have their own surfaces); adding new CLI flags or nouns; and touching the wrap-up pipeline (that is task 0506's R1).
### Design
**Evidence (0505 run).** Host session: 27.2M tokens total, 156 model round-trips, 23.2 min thinking latency in one context; wrap hop's 3 subprocess agents: 3.2M tokens, 7.2 min. The inline driver executed every `agent.run` stage in the host session per the current contract, with no subagent option.

**Target surfaces.**
- `plugins/sp/skills/spur-dev/references/cross-cutting.md` §inline-default execution-surface — add the subagent dispatch criteria + provenance note beside the value table (value semantics unchanged).
- `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md` — extend the `agent.run` action section: subagent dispatch path, criteria checks, provenance line, enforcement of answerFile/expectFile/requireDiff on returned artifacts.
- `plugins/sp/skills/spur-dev/references/flag-glossary.md` — `--agent` entry: note the subagent surface without changing the value table.
- `plugins/sp/tests/flag-contract-parity.test.ts` — extend C3a/C3b fixtures for the additive note; existing fixtures stay green.
- `plugins/sp/skills/parallel-execution/references/dispatch-surface.md` — cross-reference: this task applies the native-subagent preference to sequential pipeline stages.

**Dispatch decision (per stage, in driver):**
1. Platform exposes subagent mechanism? (task tool / equivalent probe)
2. Stage non-interactive? (no `pause: true`, no operator-confirm step, no ask/taste pause)
3. Capable agent for stage? (implement/verify/test-fix: full; review: read-only acceptable)
4. Handoff cost < saved host context? (stage contract via `local://`, not re-reads)
→ all pass: dispatch to subagent; record `executed via subagent <agent-id> (host session <sid>)`; enforce artifacts. Any fail: host session, `executed inline`.

**Provenance format.** `stage <id> executed via subagent <agent-id> (host session <session-id>)` — never the plain inline line for subagent work. Answer-file schema contract (R2/0478) applies unchanged; the subagent writes the same answer file the host would.

**Interactive ownership.** `operator-confirm` step (operator-confirm step) and any step that can surface an operator prompt are host-owned by construction: the dispatch criteria exclude them before the subagent branch.
### Plan
- [ ] P1 (R1, R5) Document the subagent dispatch criteria in cross-cutting.md §inline-default + flag-glossary `--agent` entry; extend C3a/C3b parity fixtures for the additive note; keep `inline` semantics unchanged.
- [ ] P2 (R2, R3) Extend the inline pipeline driver: subagent dispatch path (criteria checks, pure slash command + surface-resolved note + `'/Users/robin/.omp/agent/sessions/-xprojects-spur-new/2026-08-11T04-35-08-988Z_019fef1a-583c-7000-9c00-944ff32a0838/local'` contract), distinct provenance line, and artifact enforcement (answerFile/expectFile/requireDiff) on subagent returns; host fallback on any failed check.
- [ ] P3 (R4) Verify interactive states stay host-owned: operator-confirm operator-confirm step, taste/ask pauses — add a driver test that a `pause: true` stage never dispatches.
- [ ] P4 (R5) Update execution-workflow.md + dispatch-surface.md cross-reference; run flag-parity and driver tests; run the project quality check.
### Solution

<!-- Filled during implementation: changed files/sections and concise rationale. -->

### Testing

<!-- Filled during verification: commands/checks run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Inline contract SSOT: `plugins/sp/skills/spur-dev/references/cross-cutting.md` §inline-default execution-surface (value table, precedence chain, triggers)
- Driver: `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md` (agent.run action semantics, provenance lines)
- Flag parity: `plugins/sp/tests/flag-contract-parity.test.ts` (C3a/C3b fixtures)
- Native-subagent preference: `plugins/sp/skills/parallel-execution/references/dispatch-surface.md`
- Pipeline YAML: `.spur/workflows/task-pipeline.yaml` (agent.run steps, approve pause)
- Evidence session: `~/.omp/agent/sessions/-xprojects-spur-new/2026-08-11T04-35-08-988Z_019fef1a-583c-7000-9c00-944ff32a0838.jsonl`
- Post-mortem: task 0506 (0505 run inefficiencies) and task 0507 (history ETL forensics) — related follow-ups
### History
### Notes

**RC1 — host-context bloat is the motivator.** 0505: 23.7M host tokens, 156 round-trips, 23.2 min thinking — all in one context. Native subagents (already the documented default for fan-out in dispatch-surface.md) contain that growth.

**RC2 — the 0505 wrap violation is the cautionary tale.** The wrap hop's 3 subprocess agents (7.2 min, 3.2M tokens) were flagged because `--agent inline` was silently bypassed. This task's distinct-provenance requirement exists so subagent dispatch is never mistaken for inline work and never happens without the criteria.

**RC3 — interactive stages are non-negotiable.** Approve/taste/ask pauses require operator contact; a subagent cannot own them. The dispatch criteria exclude them structurally, not by convention.

**RC4 — parity is the guardrail.** `inline`'s documented semantics (host session) are parity-tested. The additive subagent surface must land with updated fixtures in the same change, or the build fails — which is the point.

**What already works:** native subagents, dispatch-surface criteria, answerFile/expectFile/requireDiff enforcement, ADR-043 pure-slash inputs, inline run-log provenance. This task composes them for sequential stages; it invents no new engine machinery.

