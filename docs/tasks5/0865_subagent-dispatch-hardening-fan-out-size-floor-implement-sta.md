---
schema_version: 1
name: "Subagent dispatch hardening: fan-out size floor, implement-stage handoff contract, pre-dispatch permission check, cheap-model fan-out hint"
status: todo
template: standard
created_at: 2026-09-16T02:53:37.141Z
updated_at: "2026-09-16T03:33:06.954Z"

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

- [ ] R1. **Fan-out size floor (dev-parallel).** `fan-out-patterns.md` currently notes "for a 20-line change, one thorough review beats 3 shallow ones" only as an anti-pattern remark under pattern 2 (file line ~45). Promote it to a pre-dispatch gate: add a decision-table row and a short `## Size floor` rule stating that when the scope is below a deterministic floor (a single file, or an estimated diff under ~50 lines, or one focused question), the driver MUST NOT fan out and executes inline instead. The floor values live in the reference as constants — no config knob (a value that never changes is a constant).
- [ ] R2. **Implement-stage handoff contract (0818 payload extension).** The five-field dispatch payload in `inline-pipeline-driver.md` (stage id, exact slash command, no-recursion notice, execution-tree cwd + resolved Spur invocation, resolved output path + artifact contract) carries an artifact contract only for the verify and review stages. Add a sixth field for the implement stage: a compact acceptance-evidence requirement naming (a) the task's AC identities the implementation must satisfy (verbatim scenario titles / checklist text from the task file), (b) the evidence the delegate must produce (pasted test output for the narrow targeted tests, `file:line` citations in the Solution change-map), and (c) the existing reminder that a delegate success message is not evidence — post-join validation reads artifacts, not claims. Wording must reuse the task file's own AC text; the driver reads it from the task, never paraphrases.
- [ ] R3. **Pre-dispatch permission check.** Before dispatching a stage to a native subagent, the driver names the stage's required capabilities (the slash command, the resolved Spur invocation, any declared shell actions) in the dispatch payload and instructs the delegate to return a blocker immediately — rather than stalling — when it hits a missing permission (Claude Code exposes no dry-run permission API). Record the outcome as one run-log line per dispatch: `stage <id> permission precheck: ok | <missing capability>`. Read-only investigation fan-out (`dev-parallel` investigation mode) dispatches read-only worker shapes by construction.
- [ ] R4. **Cheap-model hint for read-only fan-out.** On hosts whose native subagent invocation accepts a per-call model override (Claude Code: Agent tool `model` parameter), investigation/research fan-out workers (`dev-parallel` investigation mode, competency-lens review's read-only lenses) SHOULD be dispatched with the host's cheapest capable model. This is an invocation-side hint recorded in `fan-out-patterns.md` and `dispatch-surface.md` — never a definition-file edit (those belong to superskill) and never a hard pin (the host may ignore it). Pipeline stage dispatch under `sp:spur-dev` is unaffected: tier routing there is ADR-033/ADR-078's job via `roles.md`.

**Non-goals:** no timeout/watchdog machinery; no harness env-var or settings.json changes; no edits to `plugins/sp/agents/*.md`; no workflow YAML, CLI verb/flag, or schema changes; no `estimate_hours` work (landed in sibling commit `0e1f25691`); no restructuring of workflow definitions (deferred by the operator).

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

#### Q&A entry — 2026-09-16T03:22:14.599Z

#### Q&A entry — 2026-09-15T00:00:00Z

- **Floor as constants vs config knob → constants.** The evaluation's "config only when behavior must vary" rule: floor values (single file, <50-line diff, one question) never change per project, so they live as constants in `fan-out-patterns.md`. Revisit only if a project demonstrates a real divergent floor.
- **R3 as name-capabilities + fail-fast blocker vs permission-probing subsystem → blocker.** Claude Code exposes no dry-run permission API; a probing subsystem would invent platform surface that does not exist. The delegate fails fast with a named blocker instead of stalling; the host sees it at join.
- **R4 as invocation-side hint vs definition-file model pin → invocation-side.** Subagent definition files belong to superskill's lifecycle; this plugin never edits them. A per-invocation model override needs no definition change.
- **Bundle of four items in one task vs four tasks → one task.** All four edit the same three reference files' dispatch contract; cohesion rule (cross-cutting § task sizing) makes them one review unit.
- **Deferred:** workflow-definition structural performance (state count, guard shape) — operator deferred to a later step, not this task.

### Design

All four items are prompt-contract edits in plugin reference Markdown plus their pinning tests. **No new API**: no workflow YAML, no CLI verbs/flags, no schema changes, no new config keys. Frozen names per item below; every insertion point was re-verified against the tree on 2026-09-15.

**WHAT / WHY.** R1 stops wasteful fan-out of sub-floor scopes; R2 closes the implement-stage handoff gap (verify/review stages carry artifact contracts since 0818, implement carries only `requireDiff`); R3 prevents silent subagent stalls on permission prompts the host cannot see; R4 cuts fan-out cost on hosts with per-invocation model overrides.

**WHERE — frozen insertion points (verified this refine):**

- R1: `plugins/sp/skills/parallel-execution/references/fan-out-patterns.md` — new `## Size floor` section after `## Token-budget guard` (line ~93); one row in `## When-to-use decision table` (line ~81); replace anti-pattern remark at line ~45 with a link.
- R2: `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md` § "Dispatch payload (task 0818 R2)" (line ~263) — new field 6; pin in `plugins/sp/tests/inline-execution-contract.test.ts`.
- R3: `inline-pipeline-driver.md` near "Dispatch and join"; run-log line format `stage <id> permission precheck: ok | <missing capability>`; same rule + read-only worker shapes in `fan-out-patterns.md`.
- R4: one paragraph in `fan-out-patterns.md`; one cross-linking paragraph in `plugins/sp/skills/parallel-execution/references/dispatch-surface.md`.

**R2 field-6 content (frozen):** (a) the task's AC identities verbatim — exact `Scenario:` titles / checklist text read from the task file by the driver, never paraphrased; (b) required evidence — pasted narrow-test output and `file:line` Solution change-map citations; (c) reminder that a delegate success message is not evidence — post-join validation reads artifacts. Applies to implement and any stage whose YAML action declares `requireDiff`. It extends the payload contract; it is NOT a new YAML key.

**R3 runtime contract (frozen):** Claude Code exposes no dry-run permission API, so the contract is: driver names the stage's required capabilities (slash command, resolved Spur invocation, declared shell actions) in the dispatch payload; the delegate returns a blocker immediately on first denial instead of waiting; the driver records one run-log line per dispatch. Do not invent a permission-probing subsystem.

**R4 scope fence (frozen):** invocation-side hint only. Never edit `plugins/sp/agents/*.md` (superskill's lifecycle). Never a hard pin — the host may ignore it. `sp:spur-dev` pipeline stage dispatch is exempt: ADR-033/ADR-078 tier routing via `plugins/sp/references/roles.md` owns that axis.

**Anti-patterns (do not implement):** no config knobs or env vars for the floor values (constants in the reference); no model-based size estimation (the floor uses observable scope: files touched, diff lines, single question); no timeout/watchdog machinery (rejected in evaluation — the Agent tool has no timeout parameter and 0727 already records the governing boundary); no duplicating `--agent` semantics outside `cross-cutting.md`; no restating threshold numbers in two places (R1's pattern-2 remark becomes a link).

**Dependencies / handoff.** No `dependencies[]`; assumes the sibling commit `0e1f25691` (estimate_hours field + driver condition 5 + resume/fork guidance) — landed on main 2026-09-15, verified this refine. No downstream task depends on this one; nothing to leave for dependents.

**Verification.** Focused: `cd plugins/sp && bun test tests/inline-execution-contract.test.ts tests/skill-structure.test.ts` and `plugins/sp/scripts/validate-flag-contracts.ts` (via its owning test if not directly runnable). Final gate: `bun run spur-check`.

**Out of scope (record to prevent drift).** Subagent definition files (`plugins/sp/agents/*.md`) — superskill's lifecycle. Harness env vars and settings.json — operator config. Workflow definitions' structural performance (state count, guard shape) — operator deferred to a later step. Batch-schema or frontmatter additions — `estimate_hours` landed in the sibling fix.

### Plan

1. **R1 — fan-out-patterns.md size floor.** Add a `## Size floor` section after the existing `## Token-budget guard` (currently the last rule section, file line ~93): constants = single-file scope, OR estimated diff < 50 lines, OR one focused question → execute inline, do not fan out. Add one row to the `## When-to-use decision table` (file line ~81) with guidance "do not fan out — execute inline". Replace the pattern-2 anti-pattern remark (file line ~45) with a link to the new section. Verify: `rg -n "Size floor" plugins/sp/skills/parallel-execution/references/fan-out-patterns.md`.
2. **R2 — implement-stage payload field 6.** In `inline-pipeline-driver.md` § "Dispatch payload (task 0818 R2)" (file line ~263), add field 6 scoped to implement (and any stage whose YAML action declares `requireDiff`): (a) task AC identities verbatim, (b) required evidence (narrow-test output + file:line Solution change-map citations), (c) success-message-is-not-evidence reminder. Extend `plugins/sp/tests/inline-execution-contract.test.ts` with a `toContain` assertion pinning the new field. Verify: `cd plugins/sp && bun test tests/inline-execution-contract.test.ts`.
3. **R3 — pre-dispatch permission rule.** `inline-pipeline-driver.md` near "Dispatch and join": driver names required capabilities in the payload; delegate returns a blocker on first denial instead of stalling; run-log line `stage <id> permission precheck: ok | <missing capability>`. Same blocker instruction + read-only worker shapes for investigation fan-out in `fan-out-patterns.md`. State plainly: Claude Code exposes no dry-run permission API, so the contract is name-capabilities + fail-fast blocker. Verify: `rg -n "permission precheck" plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md`.
4. **R4 — cheap-model hint.** One paragraph in `fan-out-patterns.md` (global, near Size floor) + one cross-linking paragraph in `dispatch-surface.md`: invocation-side cheap-model hint for read-only fan-out; prohibitions (no definition-file edits, no hard pin); exemption of spur-dev pipeline stage dispatch (ADR-033/ADR-078 own tier routing). Verify: `rg -n "cheap" plugins/sp/skills/parallel-execution/references/dispatch-surface.md`.
5. **Contract hygiene sweep (R5).** Confirm new text links to cross-cutting.md instead of restating `--agent` semantics. Run `plugins/sp/scripts/validate-flag-contracts.ts` (via its owning test if not directly runnable), `cd plugins/sp && bun test tests/inline-execution-contract.test.ts tests/skill-structure.test.ts`, then the full gate `bun run spur-check`. No new suppressions; commit per file-group with conventional message.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Sibling fix (landed, assumed by this task): commit `0e1f25691` — `estimate_hours` field, driver condition 5 dispatch floor, resume-over-re-dispatch, fork-dispatch guidance.
- `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md` — dispatch payload (0818), eligibility (0508), timeout boundary (0727).
- `plugins/sp/skills/parallel-execution/references/fan-out-patterns.md` — decision table, token-budget guard, pattern anti-patterns.
- `plugins/sp/skills/parallel-execution/references/dispatch-surface.md` — native-subagent vs `spur agent run` SSOT; fork dispatch section.
- `plugins/sp/skills/spur-dev/references/cross-cutting.md` — `--agent` semantics SSOT (link, never restate).
- `plugins/sp/references/roles.md` — role→tier table; ADR-033 (model-tier routing), ADR-078 (role config SSOT).
- Contract tests: `plugins/sp/tests/inline-execution-contract.test.ts`, `plugins/sp/tests/skill-structure.test.ts`, `plugins/sp/scripts/validate-flag-contracts.ts`.
- Tasks 0508 / 0687 / 0818 / 0727 — prior dispatch-contract decisions this task extends.

### History

- 2026-09-16T03:33:06.954Z backlog → todo (system)

