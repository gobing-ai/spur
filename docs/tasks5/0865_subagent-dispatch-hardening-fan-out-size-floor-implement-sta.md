---
schema_version: 1
name: "Subagent dispatch hardening: fan-out size floor, implement-stage handoff contract, pre-dispatch permission check, cheap-model fan-out hint"
status: backlog
template: standard
created_at: 2026-09-16T02:53:37.141Z
updated_at: "2026-09-16T02:54:46.816Z"

---

## 0865. Subagent dispatch hardening: fan-out size floor, implement-stage handoff contract, pre-dispatch permission check, cheap-model fan-out hint

### Background

Spur-dev's `--agent inline` path (tasks 0508/0687/0818) dispatches eligible pipeline stages to native subagents, but four robustness/cost gaps remain after the first fix round. This task bundles them.

**Origin.** On 2026-09-15 an evaluation compared an external subagent best-practices survey against the spur codebase. Three items were fixed immediately (size-based dispatch bypass via `estimate_hours`, fork-dispatch guidance, resume-same-subagent for continuation stages). This task carries the remaining four. The external source document is deleted; every practice statement below is self-contained and was verified against Claude Code harness behavior and this repository on that date.

**Verified practice basis (do not re-litigate):**

- A subagent's assignment should carry acceptance criteria, source-of-truth references, and the evidence format it must return (file:line citations, pasted test output). A silent success line is not a handoff.
- Fanning out below a minimum work size wastes the dispatch: for a ~20-line change, one thorough inline pass beats 3 shallow parallel ones.
- A dispatched subagent that hits a permission prompt stalls with no host visibility until join; read-only workers avoid writes by construction.
- Routing cheap models to high-volume read-only workers is the standard cost lever; on Claude Code the Agent tool accepts a per-invocation `model` override, so no definition-file change is needed.

**Explicitly rejected during evaluation (do not resurrect):**

- Hard per-worker timeouts for native subagents — the Claude Code Agent tool has no timeout parameter; the inline driver already records the governing timeout boundary (task 0727). A TaskStop-style watchdog adds a moving part for no proven need.
- Harness env-var caps (`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`, `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`) — real (v2.1.217+, defaults 3/20) but operator harness config, not plugin scope.
- Subagent definition-file composition (frontmatter `tools`/`skills`/`memory`/`model`, description authoring) — owned by superskill, never this plugin.
- Non-Claude-Code platform-specific mechanics (Codex TOML agents, Antigravity `/boost`, OMP Isolation Mode, Pi extensions, ZCode Goal Mode).

**Current contract locations (all edits stay inside these owners):**

- `plugins/sp/skills/parallel-execution/references/fan-out-patterns.md` — the when-to-use decision table and token-budget guard.
- `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md` — the 0818 five-field dispatch payload and per-stage artifact contracts.
- `plugins/sp/skills/parallel-execution/references/dispatch-surface.md` — SSOT for native-subagent vs `spur agent run` surface choice.
- `plugins/sp/skills/spur-dev/references/cross-cutting.md` — SSOT for `--agent` semantics; other files link, never restate.
- Contract tests that assert doc contents: `plugins/sp/tests/inline-execution-contract.test.ts`, `plugins/sp/tests/skill-structure.test.ts`, `plugins/sp/scripts/validate-flag-contracts.ts`.

### Requirements

- [ ] R1. **Fan-out size floor (dev-parallel).** `fan-out-patterns.md` currently notes "for a 20-line change, one thorough review beats 3 shallow ones" only as an anti-pattern remark under pattern 2. Promote it to a pre-dispatch gate: add a decision-table row and a short "Size floor" rule stating that when the scope is below a deterministic floor (e.g. a single file, or an estimated diff under ~50 lines, or one focused question), the driver MUST NOT fan out and executes inline instead. The floor values live in the reference as constants — no config knob (a value that never changes is a constant).
- [ ] R2. **Implement-stage handoff contract (0818 payload extension).** The five-field dispatch payload in `inline-pipeline-driver.md` (stage id, exact slash command, no-recursion notice, execution-tree cwd + resolved Spur invocation, resolved output path + artifact contract) carries an artifact contract only for the verify and review stages. Add a sixth field for the implement stage: a compact acceptance-evidence requirement naming (a) the task's AC identities the implementation must satisfy (verbatim scenario titles / checklist text from the task file), (b) the evidence the delegate must produce (pasted test output for the narrow targeted tests, `file:line` citations in the Solution change-map), and (c) the existing reminder that a delegate success message is not evidence — post-join validation reads artifacts, not claims. Wording must reuse the task file's own AC text; the driver reads it from the task, never paraphrases.
- [ ] R3. **Pre-dispatch permission check.** Before dispatching a stage to a native subagent, the driver verifies the stage's expected tool/command surface is available to a subagent without interactive prompts (the stage's slash command, the Spur CLI invocation, and any declared shell actions). When the platform offers no way to pre-check, the driver instead records in the run log which permissions the stage requires and instructs the delegate to return a blocker immediately — rather than stalling — when it hits a missing permission. Read-only investigation fan-out (`dev-parallel` investigation mode) dispatches read-only worker shapes by construction. Record the outcome as one run-log line per dispatch.
- [ ] R4. **Cheap-model hint for read-only fan-out.** On hosts whose native subagent invocation accepts a per-call model override (Claude Code: Agent tool `model` parameter), investigation/research fan-out workers (`dev-parallel` investigation mode, competency-lens review's read-only lenses) SHOULD be dispatched with the host's cheapest capable model. This is an invocation-side hint recorded in `fan-out-patterns.md` and `dispatch-surface.md` — never a definition-file edit (those belong to superskill) and never a hard pin (the host may ignore it). Pipeline stage dispatch under `sp:spur-dev` is unaffected: tier routing there is ADR-033/ADR-078's job via `roles.md`.

### Acceptance Criteria

```gherkin
Scenario: R1 — fan-out floor documented and wired

- `plugins/sp/skills/parallel-execution/references/fan-out-patterns.md` contains a "Size floor" rule with concrete constant thresholds AND a matching row in the when-to-use decision table whose guidance is "do not fan out — execute inline".
- The anti-pattern remark under pattern 2 is replaced by a link to the new rule (no duplicated thresholds).
- Evidence: `rg -n "Size floor" plugins/sp/skills/parallel-execution/references/fan-out-patterns.md` exits 0; `bun test` for `plugins/sp/tests` passes.

Scenario: R2 — implement-stage payload carries AC + evidence requirements

- `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md` dispatch-payload section lists the implement-stage evidence field with the three components (AC identities verbatim, required evidence form, success-message-is-not-evidence reminder).
- `plugins/sp/tests/inline-execution-contract.test.ts` is extended with an assertion pinning the new field's presence, and passes.
- Evidence: `cd plugins/sp && bun test tests/inline-execution-contract.test.ts` exits 0.

Scenario: R3 — pre-dispatch permission check documented with run-log provenance

- `inline-pipeline-driver.md` (pipeline stage dispatch) and `fan-out-patterns.md` (ad-hoc fan-out) each state the pre-dispatch permission rule, the blocker-on-missing-permission delegate instruction, and the exact run-log line format.
- Read-only dispatch shapes are named for investigation fan-out.
- Evidence: `rg -n "permission" plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md plugins/sp/skills/parallel-execution/references/fan-out-patterns.md` shows the new rules; plugin tests pass.

Scenario: R4 — cheap-model fan-out hint recorded with scope limits

- `fan-out-patterns.md` and `dispatch-surface.md` state the invocation-side cheap-model hint for read-only fan-out, the two prohibitions (never a definition-file edit — superskill owns those; never a hard pin), and the exemption of `sp:spur-dev` pipeline stage dispatch (ADR-033/ADR-078 tier routing owns that axis).
- Evidence: `rg -n "model" plugins/sp/skills/parallel-execution/references/dispatch-surface.md` shows the hint; `plugins/sp/scripts/validate-flag-contracts.ts` and plugin tests pass.

Scenario: R5 — contract SSOT hygiene preserved

- `cross-cutting.md` remains the only restatement of `--agent` semantics; new text in other files links to the owning section instead of duplicating it.
- `bun run spur-check` passes with no new suppressions.
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

All four items are prompt-contract edits in plugin reference Markdown plus their pinning tests; no workflow YAML, no CLI verbs, no schema changes.

**R1 implementation shape.** In `fan-out-patterns.md`, add a section after the token-budget guard: name it "Size floor"; state the constants (single-file scope, or estimated diff < 50 lines, or one focused question → inline, no fan-out); add one row to the when-to-use decision table. Keep the existing token-budget guard untouched — the floor is orthogonal (budget caps N, floor vetoes N>1).

**R2 implementation shape.** In `inline-pipeline-driver.md` § "Dispatch payload (task 0818 R2)", add field 6 scoped to the implement stage (and any stage whose YAML action declares `requireDiff`): the task's AC identities verbatim, required evidence (narrow-test output paste + `file:line` Solution change-map citations), and the post-join validation reminder. Note the field is assembled by the driver from the task file at dispatch time — it extends the payload contract, it is not a new YAML key.

**R3 implementation shape.** Two insertion points: (a) `inline-pipeline-driver.md` near "Dispatch and join" — pre-dispatch permission verification, delegate blocker instruction, run-log line `stage <id> permission precheck: ok | <missing capability>`; (b) `fan-out-patterns.md` — read-only worker shapes for investigation fan-out, same blocker instruction. State honestly that Claude Code exposes no dry-run permission API, so the runtime contract is: driver names the required capabilities in the payload, delegate returns a blocker on first denial instead of waiting.

**R4 implementation shape.** One paragraph in `fan-out-patterns.md` (per-pattern or global) plus one cross-linking paragraph in `dispatch-surface.md`. Explicit scope fence: invocation-side only; superskill owns definition files; ADR-033/ADR-078 tier routing owns pipeline-stage model selection, so the hint applies to ad-hoc fan-out only.

**Verification.** Focused: `cd plugins/sp && bun test tests/inline-execution-contract.test.ts tests/skill-structure.test.ts` and `bun plugins/sp/scripts/validate-flag-contracts.ts` if the script is directly runnable (otherwise its owning test). Final gate: `bun run spur-check`.

**Out of scope (record to prevent drift).** Subagent definition files (`plugins/sp/agents/*.md`) — superskill's lifecycle. Harness env vars and settings.json — operator config. Workflow definitions' structural performance (state count, guard shape) — the operator deferred that to a later step. Batch-schema or frontmatter additions — none needed here; `estimate_hours` authoring belongs to the sibling fix that introduced the field.

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
