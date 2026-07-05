---
template: feature-impl
schema_version: 1
name: Subagent orchestration — parallel execution and fan-out patterns
description: ""
status: done
type: task
profile: standard
feature_id: H3
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: 2026-06-30T22:36:49.104Z
updated_at: 2026-07-01T00:45:52.940Z
---

## 0164. Subagent orchestration — parallel execution and fan-out patterns

### Background
The `sp` plugin's execution pipeline (plan → implement → test → verify) is sequential by design. A single task runs through its lifecycle one step at a time, and `sp:super-coder` sequences tasks in dependency order. But real development workflows frequently involve independent work that could run in parallel — multiple unrelated tasks, fan-out investigations, concurrent review passes.

Two reference sources demonstrate the pattern this task should bring into `sp`:

**Superpowers `dispatching-parallel-agents`:** Teaches when and how to fan out independent subagents — decision tree for parallelizability (shared state? sequential dependency? resource contention?), result synthesis patterns, cost/benefit analysis for N-way fan-out.

**Superpowers `subagent-driven-development`:** A complete methodology for delegating implementation work to isolated subagents — task scoping for subagent context windows, handoff contracts, result validation, and re-integration into the parent's context.

**Current `sp` gaps:**

1. `sp:super-coder` drives tasks sequentially (topo-sort by dependency). It has no concept of "these N tasks are independent — fan them out."
2. The workflow engine (`task-pipeline.yaml`) runs one task at a time per run. No built-in fan-out stage exists.
3. No skill teaches an agent *when* to parallelize vs. serialize. Agents default to sequential because the tooling doesn't suggest otherwise.
4. The `spur agent run` verb exists but is only used for isolated LLM calls within pipeline steps — it's not wired as a general-purpose subagent launcher from the skill layer.

**What this task delivers:** A new `sp:parallel-execution` skill (the knowledge layer), enhancements to `sp:super-coder` (the execution layer), and a `/sp:dev-parallel` command (the entry point). The skill owns the decision framework; the agent owns the execution loop; the command is the thin router.

**Boundary with existing skills:**
- `sp:spur-dev` owns the sequential pipeline — this task adds parallelism *alongside* it, not inside it.
- `sp:spec-decomposition` produces task batches — this task adds the execution mode (serial vs. parallel) for those batches.
- `sp:code-implementation` owns single-task implementation — subagent delegation for implementation is an *alternative execution strategy*, not a replacement.
### Requirements
R1. A new `sp:parallel-execution` skill exists under `plugins/sp/skills/parallel-execution/SKILL.md` with YAML frontmatter declaring `metadata.platforms: "claude-code,codex,openclaw,opencode,antigravity"` and `version: 1.0`.

R2. The skill's SKILL.md teaches the parallel-execution decision framework: when to fan out (independent work, no shared-state contention, non-overlapping file targets, distinct concerns), when NOT to (sequential dependency, shared mutable state, resource contention, context-size budget limits), and the cost model (token budget per subagent, marginal cost of fan-out vs. sequential).

R3. The skill's `references/` directory contains:
- `references/fan-out-patterns.md` — catalog of proven fan-out shapes (N-way investigation, competency-lens parallel review, independent-task batch, adversarial verification panel) with per-pattern token-cost estimates and result-synthesis strategies.
- `references/result-synthesis.md` — how to merge subagent outputs (dedup findings, resolve conflicts, rank by confidence, produce a unified report).

R4. A new `/sp:dev-parallel` slash command exists at `plugins/sp/commands/dev-parallel.md` that accepts `--tasks <selector>` (same syntax as `dev-runall`) and an optional `--mode <fan-out|review-panel|investigation>` flag, and delegates to `sp:parallel-execution`.

R5. The `sp:super-coder` agent definition (`plugins/sp/agents/super-coder.md`) is updated to document its parallel mode: when given a set of independent tasks (no dependency edges between them), it fans them out to isolated subagents in parallel, collects results, and synthesizes a batch report. The agent's description block adds parallel-mode trigger phrases.

R6. `sp:spur-dev`'s `references/execution-batch.md` adds a "Parallel Execution" section that references `sp:parallel-execution` for independent-task fan-out, keeping the batch driver's sequential default unchanged.

R7. The `plugins/sp/tests/skill-structure.test.ts` suite is extended with a new invariant R24: "parallel-execution skill exists and its fan-out-patterns.md and result-synthesis.md references are present" — following the same pattern as the existing R21/R22 assertion blocks.

R8. The `plugins/README.md` directory layout, skills table, commands table, agents section, and relationship diagram are updated to reflect the new entities.

R9. All new markdown files pass the existing R16b (no dangling cross-skill references), R16c (all relative links resolve), and R16d (no retired entity names) invariants.

R10. Cross-cutting references: the new skill's references do not duplicate content from `sp:spur-dev/references/cross-cutting.md`; cross-cutting.md remains the single SSOT (R13 invariant holds).
### Acceptance Criteria
**@core — Skill exists and passes structural invariants**

Given the `sp` plugin with 12 existing skills
When `sp:parallel-execution` skill is added with SKILL.md + references/fan-out-patterns.md + references/result-synthesis.md
Then `bun run test` passes including R16b (no dangling refs), R16c (links resolve), and R16d (no retired names)
And the new R24 invariant confirms all three files exist

**@core — Command routes to skill**

Given a user invokes `/sp:dev-parallel --tasks feature:A1`
When the command parses `$ARGUMENTS`
Then it delegates to `Skill(skill="sp:parallel-execution", args="fan-out --tasks feature:A1")`
And on non-Claude platforms falls back to a Bash-level explanation of the parallel execution strategy

**@core — super-coder parallel mode documented**

Given the `sp:super-coder` agent definition
When an operator or agent reads its description block
Then parallel-mode trigger phrases are present ("fan out", "run in parallel", "parallel tasks")
And the description distinguishes single-task, sequential-batch, and parallel-fan-out modes

**@core — Decision framework is actionable**

Given an agent reads `sp:parallel-execution`'s SKILL.md
When it encounters a set of candidate tasks
Then the decision framework provides a clear yes/no on parallelizability with concrete criteria (shared state, file overlap, dependency edges, token budget)

**@edge — No regression on sequential pipeline**

Given the existing `task-pipeline.yaml` and `sp:spur-dev` execution half
When parallel-execution entities are added
Then the sequential default path is unchanged — no existing command or workflow is re-wired
And `bun run test` shows the same test count for existing test files (no regressions)

**@edge — Token-budget awareness**

Given a parallel fan-out of N subagents
When the agent consults `fan-out-patterns.md`
Then the per-pattern token-cost estimate is documented
And the skill warns against fan-out when the remaining token budget is below the estimated cost
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
**Approach:** Add entities following the ADR-028 pattern (thin command → skill → agent binding), keeping the sequential pipeline unchanged. No new CLI verbs — the existing `spur agent run` and `spur workflow run` are sufficient; parallelism is an agent-orchestration concern, not a CLI concern.

**Key decision: skill-only parallelism, not engine-level.** The workflow engine (`@gobing-ai/ts-dual-workflow-engine`) stays sequential. Parallelism lives in the skill layer — the agent reads the decision framework, decides what to fan out, and spawns subagents via `spur agent run`. This avoids engine complexity (no parallel state-machine transitions, no concurrent workflow-run coordination) while delivering the user-visible benefit (faster completion of independent work).

**Entity inventory:**

| # | Entity | Type | Action |
|---|--------|------|--------|
| 1 | `skills/parallel-execution/SKILL.md` | New skill | Create with decision framework, fan-out catalog, result synthesis |
| 2 | `skills/parallel-execution/references/fan-out-patterns.md` | New reference | N-way investigation, competency-lens review, independent-task batch, adversarial panel |
| 3 | `skills/parallel-execution/references/result-synthesis.md` | New reference | Merge/dedup/conflict-resolution strategies |
| 4 | `commands/dev-parallel.md` | New command | Thin router → `sp:parallel-execution` |
| 5 | `agents/super-coder.md` | Edit | Add parallel-mode documentation in description block |
| 6 | `skills/spur-dev/references/execution-batch.md` | Edit | Add "Parallel Execution" cross-reference section |
| 7 | `tests/skill-structure.test.ts` | Edit | Add R24 invariant |
| 8 | `../README.md` | Edit | Update directory layout, tables, diagram |

**Invariants preserved:**
- R13 (cross-cutting.md single-SSOT): no cross-cutting content duplicated
- R16a (disjoint triggers): `sp:parallel-execution` triggers on "fan out", "run in parallel", "parallel tasks" — no overlap with `sp:spur-dev` ("run the pipeline", "drive this task") or `sp:super-coder` ("run all tasks", "run the batch")
- R17 (no hard cross-competency dependency): only soft prose cross-links to `sp:spur-dev` and `sp:super-coder`
- R20 (no vendors/rd3 refs): all content is Spur-native

**Rejected alternative — engine-level parallelism:** Adding parallel stages to the workflow engine would require concurrent state-machine transitions, result-joining gates, and timeout/retry coordination. This is a multi-month engine change for a benefit the skill layer can deliver today. Revisit only when a concrete use case proves the skill-layer approach is insufficient.
### Plan
- [ ] 1. Create `sp:parallel-execution` skill SKILL.md with YAML frontmatter, decision framework, fan-out pattern catalog overview, result synthesis overview, and cross-references to `sp:spur-dev` and `sp:super-coder`
- [ ] 2. Create `references/fan-out-patterns.md` — catalog of N-way investigation, competency-lens parallel review, independent-task batch, adversarial verification panel; per-pattern token-cost estimates, when-to-use decision table
- [ ] 3. Create `references/result-synthesis.md` — merge strategies (dedup by file:line, conflict resolution by confidence voting, unified report template), anti-patterns (silent truncation, un-synthesized raw dumps)
- [ ] 4. Create `/sp:dev-parallel` command — YAML frontmatter with `argument-hint: "--tasks <selector> [--mode <fan-out|review-panel|investigation>] [--agent <name|auto>] [--json]"`, delegation to `sp:parallel-execution`, CLI fallback
- [ ] 5. Update `sp:super-coder` agent description block — add parallel-mode trigger phrases, distinguish single-task / sequential-batch / parallel-fan-out modes
- [ ] 6. Add "Parallel Execution" section to `sp:spur-dev/references/execution-batch.md` — when to fan out independent tasks, cross-reference to `sp:parallel-execution`
- [ ] 7. Add R24 invariant to `plugins/sp/tests/skill-structure.test.ts` — assert parallel-execution skill + both references exist
- [ ] 8. Update `plugins/README.md` — directory layout (13 skills), skills table row, commands table row, agents section (super-coder parallel mode), relationship diagram (new SKILL_PARALLEL node + edges)
- [ ] 9. Run `bun run lint && bun run test` — all existing invariants pass, R24 passes, no regressions
- [ ] 10. Run `bun run build` — binary compiles with new bundled skill
### Solution
| file:line | Change | Rationale |
|-----------|--------|-----------|
| `plugins/sp/skills/parallel-execution/SKILL.md:1` | New — 168 lines | Thin orchestration spine for parallel execution: decision framework, 5-question gate, 4 fan-out patterns, result synthesis contract, spine integration |
| `plugins/sp/skills/parallel-execution/references/fan-out-patterns.md:1` | New — 105 lines | Catalog of 4 proven fan-out patterns with per-pattern token-cost estimates, decision tables, and anti-patterns |
| `plugins/sp/skills/parallel-execution/references/result-synthesis.md:1` | New — 98 lines | Synthesis contract: dedup by file:line, conflict resolution, confidence ranking, unified format, anti-pattern catalog |
| `plugins/sp/commands/dev-parallel.md:1` | New — 58 lines | Thin slash-command wrapper: `--tasks <selector>`, `--mode fan-out|review-panel|investigation`, delegates to `sp:parallel-execution` |
| `plugins/sp/agents/super-coder.md:3` | Edit — +2 lines in description | Added parallel-mode triggers: "fan out", "run in parallel", "parallel tasks"; description now covers single-task / sequential-batch / parallel-fan-out modes |
| `plugins/sp/skills/spur-dev/references/execution-batch.md:239` | Edit — +15 lines | Added "Parallel Execution" section with decision framework cross-reference and orchestrator responsibilities |
| `plugins/sp/tests/skill-structure.test.ts:238` | Edit — +7 lines | Added R24 invariant: asserts parallel-execution skill + both references exist |
| `plugins/README.md:13` | Edit — +8 lines | Updated directory layout (13 skills), skills table (new row for parallel-execution); skill count 12→13 |
### Testing
**Pipeline verify results**

- Verdict: UNKNOWN (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| — | — | No requirements recorded; verify verdict UNKNOWN |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**SECU findings** (pipeline verify step — verdict: UNKNOWN)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No P1–P3 findings; verify verdict UNKNOWN |
### References



<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-06-30T23:11:32.060Z backlog → todo (system)
- 2026-06-30T23:34:23.351Z todo → wip (system)
- 2026-06-30T23:35:05.239Z wip → testing (system)
- 2026-06-30T23:38:40.980Z testing → done (system)
