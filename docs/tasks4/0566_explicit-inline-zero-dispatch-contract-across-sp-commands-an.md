---
template: feature-impl
schema_version: 1
name: "Explicit-inline zero-dispatch contract across sp commands and skills"
description: ""
status: todo
type: task
profile: standard
feature_id: G5
parent_wbs: null
priority: P2
tags: ["plugins/sp", "contracts", "adr-047"]
dependencies: ["0565"]
ac_numbering: task-local
created_at: "2026-08-15T16:12:04.377Z"
updated_at: "2026-08-15T16:26:00.737Z"
---

## 0566. Explicit-inline zero-dispatch contract across sp commands and skills

### Background

Run after the CLI/service/workflow error contract lands (sibling task in this batch — contract text documents shipped behavior). The plugin-side inline-default execution-surface contract (plugins/sp/skills/spur-dev/references/cross-cutting.md) currently treats explicit `inline` as equivalent to omit, which under 0508 permits a single native-subagent dispatch — leaking the host-session guarantee. Design: docs/design/agent-inline-host-session.md. Enforcement here is convention, not mechanism — the CLI error (sibling task) is the mechanical backstop.

### Requirements
- [ ] **R1.** `cross-cutting.md` § inline-default execution surface gains the explicit-`inline` carve-out: all model-bearing work executes in the invoking host session — no subagent, no subprocess, no workflow hop; 0508 eligibility applies to `omit` only. Measurable: the contract text states the carve-out and names the CLI error as backstop.
- [ ] **R2.** `flag-glossary.md` and `dev-plan.md` inline rows no longer document `inline` ≡ omit; `dev-parallel.md` documents explicit-inline as sequential host-session execution with a printed notice (parallel fan-out is dispatch). Measurable: each file's inline row states the zero-dispatch semantics.
- [ ] **R3.** Same-change sweep (feature AC R4): no command, skill, or reference under `plugins/sp` resolves or documents `inline` as `agent.default`/omit-equivalent after this task. Measurable: a grep over the plugin tree for the old equivalence returns no live row (the 0539 inventory script's plugin assertions stay green).
### Acceptance Criteria
Covers feature G5 scenarios:

- **R2 — Explicit inline on slash commands and agent skills means zero dispatch**
- **R4 — Consumers documenting inline as omit-equivalent are corrected in the same change**

```gherkin
Scenario: R2 — Explicit inline on slash commands and agent skills means zero dispatch
  Given a slash command or backend agent skill invoked with `--agent inline`
  When it executes model-bearing work
  Then all of that work runs in the invoking host session
  And no subagent, subprocess, or workflow hop receives the prompt

Scenario: R4 — Consumers documenting inline as omit-equivalent are corrected in the same change
  Given `agent-service` resolution, the workflow `agent.run` action, and `dev-plan` docs
  When the feature ships
  Then none of them resolve or document `inline` as `agent.default`
  And the ADR-047 amendment, flag glossary, and docs/04 §7.8 updates land in the same commit
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
Implement-ready freeze (refine --depth ready, 2026-08-15). Implements design satellite
`docs/design/agent-inline-host-session.md` § Component 4. Depends on 0565 (consumes the shipped
`AGENT_INLINE_HEADLESS_MESSAGE` text verbatim — do not paraphrase it in docs).

**Frozen contract language (the carve-out — this wording is the deliverable):**

> Explicit `--agent inline` is a hard host-session guarantee: all model-bearing work executes in
> the invoking host session — never a native subagent, never a subprocess, never a workflow hop.
> The 0508 native-subagent eligibility applies to **omitted** `--agent` only. Headless surfaces
> (`spur agent run`, workflow `agent.run`, serve-side dispatch) reject `inline` with the stable
> special error (exit 2 at the CLI) and take no further action — no dispatch, no `agent.default`
> fallback.

**File targets (current anchors — re-locate by content, lines drift):**

- `plugins/sp/skills/spur-dev/references/cross-cutting.md` § inline-default execution surface —
  rewrite `:39` ("Omitting `--agent` is exactly `--agent inline`" → omit keeps the default;
  explicit inline is the zero-dispatch carve-out), the `:44` table row (split omit vs explicit
  inline; headless column → special error), and `:53-56` (the "not rejected (ADR-047)" note →
  reversed: headless surfaces reject with the frozen message).
- `plugins/sp/skills/spur-dev/references/flag-glossary.md` — `--agent` entry `:50` table row:
  same omit/inline split; `:61-62` collapse note stays historical (mark the inline leg superseded
  by G5).
- `plugins/sp/commands/dev-plan.md:19` — the `--agent` row: replace "synonym for omit, resolving
  to `agent.default`" with the special-error contract (planning pipeline `agent.run` stages are
  headless ⇒ explicit `inline` errors; use omit/auto/name).
- `plugins/sp/commands/dev-parallel.md:19` — the `--agent` row: explicit `inline` = legs run
  sequentially in the host session with a printed notice (parallel fan-out is dispatch); omit
  keeps the default fan-out semantics.

**Anti-patterns:** no new flag/env/config; do not soften MUST/NEVER wording; do not document
`inline` as `agent.default` anywhere; do not change `dev-run`/`dev-runall` semantics beyond the
carve-out wording; historical notes (H82/0413 collapse) stay as history, marked superseded.

**R3 sweep (frozen procedure):** `rg -n -i "inline.{0,40}(omit|agent\.default)|synonym for omit|exactly .inline" plugins/sp`
— every hit is either corrected to the carve-out or explicitly a superseded-history note; then
re-run `bun plugins/sp/scripts/surface-drift-inventory.ts --out docs/tasks2/0539-inventory.md`
(exit 0 expected; refreshed artifact committed).

**Handoffs:** none downstream; this task closes feature G5's AC R2/R4. Out of scope: any code
change (0565 owns all code); workflow YAML edits; serve-side docs (inherits service behavior).
### Plan
- [ ] Rewrite cross-cutting.md § inline-default execution surface (:39 equivalence, :44 table row, :53-56 ADR-047 note) with the frozen carve-out language (R1)
- [ ] Correct flag-glossary.md `--agent` entry (:50 row; mark :61-62 collapse note superseded-by-G5) (R2)
- [ ] Correct dev-plan.md:19 `--agent` row to the special-error contract (R2)
- [ ] Add dev-parallel.md:19 explicit-inline sequential-notice semantics (R2)
- [ ] R3 sweep: run the frozen `rg` pattern over plugins/sp; correct or mark-superseded every hit (R3)
- [ ] Re-run the surface-drift inventory and commit the refreshed artifact (R3)
- [ ] Run `bun run autofix && bun run spur-check`
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

L

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
