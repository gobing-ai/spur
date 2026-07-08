---
template: standard
schema_version: 1
name: "enhance the review capability in plugin sp"
description: ""
status: backlog
type: task
profile: standard
feature_id: H1
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-08T18:04:39.507Z"
updated_at: "2026-07-08T20:48:58.690Z"
---

## 0227. enhance the review capability in plugin sp

### Background

Despite we already have the following things in plugin `sp` that provide review capabilities:

- plugins/sp/commands/dev-review.md
- plugins/sp/skills/code-review
- plugins/sp/skills/code-verification

But we still can see there is an obvious gap to have a comprehensive review capability. All currently available review capabilities are more like one step of the task file based spur-dev workflow, instead of a comprehensive review capability.

Meanwhile, you can see the implementation drifting between current one with the original version of the plugin `rd3`:

- ~/projects/cc-agents/plugins/rd3/commands/dev-review.md
- ~/projects/cc-agents/plugins/rd3/agents/super-reviewer.md

Some of these changes are intentionally, but some are unintentional or the real driftings.

Meanwhile, we also collected and downloaded some excellent external repo into folder `vendors` for your reference as shown below:

- [addyosmani's agent-skills](vendors/agent-skills)
- [garrytan's gstack](vendors/gstack)
- [mattpocock's skills](vendors/skills)
- [Superpowers](vendors/Superpowers)

We should refer to the original `rd3` and these external references to figure out a solid implementation plan for the review capability in plugin `sp`.

### Requirements

The following proposal was evaluated comprehensively against sp's current review assets, the rd3 reference plugin, and 5 vendor repos. See Q&A §Q1 for the evaluation. The accepted items (5 from proposal + 2 additions) are recorded as R-numbered requirements:

R1. Add `sp:functional-review` skill — requirements-traceability review. Verifies task-file requirements were met, producing per-requirement verdicts (pass/partial/fail) with file:line evidence. Ported from rd3 `functional-review`, adapted to sp conventions (WBS-first, `--auto` flag).

R2. Add `sp:code-improvement` skill — architectural deepening review. Surfaces shallow-module, tight-coupling, wrong-seam, weak-locality, and poor-test-surface signals. Proposes ranked deepening opportunities. Ported from rd3 `code-improvement`, adapted to sp conventions. *(Addition beyond original proposal — fills gap #4.)*

R3. Enhance `plugins/sp/commands/dev-review.md` — dual-mode entry (WBS-based for pipeline, path-based for standalone PR-style review) and multi-dimensional review (SECUA + architecture deepening + functional requirements). Writes Verdict sentence with icon to `## Review` section.

R4. Add `plugins/sp/agents/super-reviewer.md` subagent — thin delegation review specialist. Two modes: Direct-Entry (standalone review) + Worker Mode (pipeline Phase 7). Delegates to `sp:code-verification`, `sp:code-improvement`, `sp:functional-review`, `sp:code-review`. Returns structured findings envelope.

R5. Enhance `plugins/sp/skills/spur-dev/SKILL.md` review step — the review step in the spur-dev workflow must act as a real quality gate covering source code, architecture, and functional requirements (not SECUA-only). References the three dispatched skills.

R6. Improve `## Review` section of task file — add Verdict sentence with icon (`✅ PASS`, `⚠️ PARTIAL`, `❌ FAIL`) as the first line, followed by severity-ranked findings with `path:line` references.

R7. Add behavioral guardrail references — `plugins/sp/skills/code-review/references/receiving-code-review.md` (technical not emotional, verify before implementing) and `plugins/sp/skills/code-review/references/verification-before-completion.md` (evidence before claims). Adapted from Superpowers. *(Addition beyond original proposal — fills gaps #6/#7.)*

### Acceptance Criteria

#### AC-1: functional-review skill

- **Given** the sp plugin needs requirements-traceability review
- **When** `sp:functional-review` is invoked with a WBS
- **Then** it produces per-requirement verdicts (pass/partial/fail) with file:line evidence
- **And** it is structured as Track A (BDD-first, when a BDD report exists) and Track B (direct requirements check)

#### AC-2: code-improvement skill

- **Given** the sp plugin needs architectural deepening review
- **When** `sp:code-improvement` is invoked with a path or WBS
- **Then** it surfaces shallow-module, tight-coupling, wrong-seam, weak-locality, and poor-test-surface signals
- **And** it proposes deepening opportunities ranked by impact

#### AC-3: dev-review command enhanced

- **Given** `/sp:dev-review` is invoked
- **When** it receives a WBS OR a file path
- **Then** it runs a multi-dimensional review: SECUA + architecture deepening + functional requirements
- **And** it writes findings to the task `## Review` section with a Verdict sentence (icon + disposition)

#### AC-4: super-reviewer subagent

- **Given** a standalone review request or pipeline Phase 7 invocation
- **When** `sp:super-reviewer` is dispatched
- **Then** it delegates to `sp:code-verification`, `sp:code-improvement`, `sp:functional-review`, and `sp:code-review` as needed
- **And** it returns a structured findings envelope with severity-ranked, dimension-tagged findings
- **And** it does NOT implement review logic itself (thin delegation only)

#### AC-5: spur-dev review step enhanced

- **Given** the task-pipeline.yaml review step runs
- **When** `/sp:dev-review` is called from the pipeline
- **Then** the review covers source code, architecture, and functional requirements (not SECUA-only)
- **And** the review step acts as a real quality gate that can route to `failed` on blockers

#### AC-6: Review section with Verdict icon

- **Given** a task's `## Review` section is written
- **When** the review completes
- **Then** the section starts with a Verdict line using an icon: `✅ PASS`, `⚠️ PARTIAL`, or `❌ FAIL`
- **And** findings are severity-ranked with `path:line` references

#### AC-7: behavioral guardrails

- **Given** review feedback is received from a subagent or external reviewer
- **When** the implementing agent processes it
- **Then** it follows the receiving-code-review discipline (technical not emotional, verify before implementing)
- **And** it follows verification-before-completion (evidence before claims)

### Q&A

#### Q1: Is the proposal correct?

**A: Mostly yes, with two additions.** The five proposal items address real gaps. After comprehensive discovery (sp plugin, rd3 plugin, 5 vendor repos, task-pipeline.yaml, all reference files), the gap analysis confirms:

**Gap analysis (sp vs rd3 + vendors):**

| # | Gap | Proposal addresses? |
|---|-----|-------------------|
| 1 | No `functional-review` skill (requirements traceability) | ✅ Yes |
| 2 | No `super-reviewer` subagent | ✅ Yes |
| 3 | `dev-review.md` is WBS-only (rd3 is path-based) | Partial — enhancing the command, but path-based mode not explicit |
| 4 | No architectural deepening lens (`code-improvement` equivalent) | Partial — mentioned in review step, but no dedicated skill |
| 5 | Review is one step in spur-dev, not standalone capability | ✅ Yes (super-reviewer + enhanced dev-review) |
| 6 | No receiving-code-review guardrails (Superpowers) | ❌ Not addressed |
| 7 | No verification-before-completion discipline (Superpowers) | ❌ Not addressed |
| 8 | No two-axis parallel sub-agent pattern (mattpocock) | Out of scope — different architecture philosophy |
| 9 | No task-scoped review prompt guidance (Superpowers SDD) | Out of scope — sp uses WBS scoping already |
| 10 | SECUA 5 dims but no separate architectural deepening skill | Same as #4 |

**Decision: accept all 5 proposal items, plus two additions:**

1. **Add `code-improvement` skill** (architectural deepening, ported from rd3). The proposal mentions "architecture and design" in the review step but doesn't create a dedicated skill. Without it, the architecture review has no backing competency — just a prompt instruction with no skill depth behind it. This is the #4 gap.
2. **Add receiving-code-review + verification-before-completion as reference docs** in `code-review/references/`. These are behavioral guardrails from Superpowers that prevent the most common review-process failures: performative agreement with feedback, and claiming "done" without evidence. This is the #6/#7 gap.

**Items 8 and 9 are out of scope.** The two-axis parallel sub-agent pattern (mattpocock) requires a fundamentally different agent architecture (parallel sub-agent dispatch with fixed-point diff). Spur's pipeline is sequential YAML-driven, not parallel sub-agent. Task-scoped review prompts (Superpowers SDD) are already handled by sp's WBS-based scoping — the task file IS the scope.

#### Q2: Should `super-coder` lose all review capability?

**A: No.** `super-coder` keeps its pre-commit self-review (via `sp:code-review` workflow A). `super-reviewer` owns the standalone and pipeline Phase 7 review. The split is:

| Agent | Review scope |
|-------|-------------|
| `super-coder` | Pre-commit self-review during implementation (checklist, quick fix) |
| `super-reviewer` | Standalone review, pipeline review step, architectural deepening, functional verification |

This mirrors rd3's split: `super-coder` implements, `super-reviewer` reviews.

#### Q3: Should `dev-review.md` support path-based review (like rd3)?

**A: Yes.** Currently `dev-review.md` is WBS-only — it can only review a task's diff. Adding path-based mode (`/sp:dev-review <path>`) enables standalone PR-style review without a task file. This aligns with rd3's `dev-review.md` which supports both. The WBS mode remains primary for the pipeline; path mode is for direct-entry.

#### Q4: How does the pipeline review step change?

**A: The YAML stays the same; the command changes.** The `task-pipeline.yaml` review step calls `/sp:dev-review ${vars.wbs} --auto`. The command itself becomes the multi-dimensional review (SECUA + architecture + functional). No YAML change needed — the command owns the review depth. The `--auto` flag still skips confirmations. The review step's guard (always → approve/verify) stays the same.

### Design

#### Architecture

The review capability becomes a three-layer structure mirroring rd3's proven design:

```
┌─ Agent layer ──────────────────────────────────────────────┐
│  super-reviewer.md  — thin delegation, structured envelope   │
│    ├─ Direct-Entry: standalone review requests              │
│    └─ Worker Mode: pipeline Phase 7                         │
└─────────────────────────────────────────────────────────────┘
┌─ Command layer ─────────────────────────────────────────────┐
│  dev-review.md  — WBS-based OR path-based entry              │
│    ├─ /sp:dev-review <wbs>   → task diff review              │
│    └─ /sp:dev-review <path>  → standalone path review        │
└─────────────────────────────────────────────────────────────┘
┌─ Skill layer ───────────────────────────────────────────────┐
│  code-verification  — SECUA 5-dim review + verify gate       │
│  code-improvement   — architectural deepening (NEW)          │
│  functional-review  — requirements traceability (NEW)       │
│  code-review        — self-review + request-review           │
└─────────────────────────────────────────────────────────────┘
┌─ Reference layer ───────────────────────────────────────────┐
│  receiving-code-review.md    — behavioral guardrail (NEW)   │
│  verification-before-completion.md — evidence discipline (NEW)│
│  review-lenses.md, self-review-checklist.md, secu-review.md │
│  verdict-schema.md, code-improvement.md (existing)          │
└─────────────────────────────────────────────────────────────┘
```

#### Key tradeoffs

1. **Port from rd3 vs. build fresh:** Port rd3 skills, adapt to sp conventions (WBS-first, `--auto` flag, spur-dev workflow integration). rd3 skills are proven; sp conventions differ in entry points and flag names.

2. **`dev-review.md` WBS + path dual mode:** WBS is the pipeline entry (task diff). Path is the direct-entry (PR-style). The command detects: numeric WBS → task mode; path-like string → path mode. This mirrors rd3's dual mode.

3. **super-reviewer as thin delegation (not logic carrier):** Following rd3's core principle — the agent delegates to skills, never absorbs review logic. This keeps the agent maintainable and the skills reusable.

4. **Pipeline YAML unchanged:** The review step in `task-pipeline.yaml` already calls `/sp:dev-review`. Enhancing the command enhances the pipeline. No YAML diff needed — separation of concerns.

5. **Behavioral guardrails as references, not skills:** `receiving-code-review` and `verification-before-completion` are short behavioral docs (~1KB each), not full skills. They slot into `code-review/references/` alongside the existing `review-lenses.md` and `self-review-checklist.md`.

6. **Verdict icon in Review section:** Uses `✅ PASS`, `⚠️ PARTIAL`, `❌ FAIL` prefix. Aligns with the `spur task verdict` output schema (`verdict-schema.md`).

#### Invariants

- `super-reviewer.md` NEVER implements review logic — it delegates to skills.
- `dev-review.md` delegates to `sp:code-verification` (SECUA) + `sp:code-improvement` (architecture) + `sp:functional-review` (requirements) as needed.
- `functional-review` produces per-requirement verdicts with file:line evidence, not free-form commentary.
- `code-improvement` produces ranked deepening candidates with module-depth analysis, not style nits.
- The pipeline review step can route to `failed` when blockers are found (via the verdict).

#### Impacted surfaces

| File | Change |
|------|--------|
| `plugins/sp/skills/functional-review/SKILL.md` | NEW — ported from rd3, adapted to sp |
| `plugins/sp/skills/functional-review/references/*.md` | NEW — verdict schema, track guides |
| `plugins/sp/skills/code-improvement/SKILL.md` | NEW — ported from rd3, adapted to sp |
| `plugins/sp/skills/code-improvement/references/*.md` | NEW — deepening signals, module depth |
| `plugins/sp/commands/dev-review.md` | ENHANCED — dual mode (WBS + path), multi-dimensional |
| `plugins/sp/agents/super-reviewer.md` | NEW — review specialist, thin delegation |
| `plugins/sp/skills/spur-dev/SKILL.md` | ENHANCED — review step references new skills |
| `plugins/sp/skills/code-verification/SKILL.md` | UPDATED — cross-reference new skills |
| `plugins/sp/skills/code-review/references/receiving-code-review.md` | NEW — behavioral guardrail |
| `plugins/sp/skills/code-review/references/verification-before-completion.md` | NEW — evidence discipline |
| `docs/04_DESIGN.md` | UPDATED — review command surface |
| `docs/05_FEATURES.md` | UPDATED — review capability status |

### Plan

#### Phase 1: Create skills (functional-review + code-improvement)

- [ ] 1.1 Create `plugins/sp/skills/functional-review/SKILL.md` — port from rd3 `functional-review/SKILL.md`, adapt: sp WBS-first conventions, `--auto` flag, sp skill format. Two tracks: A (BDD-first), B (direct requirements check). Per-requirement verdicts: pass/partial/fail with file:line evidence.
- [ ] 1.2 Create `plugins/sp/skills/functional-review/references/verdict-schema.md` — per-requirement verdict structure (requirement_id, verdict, evidence[], gap_description).
- [ ] 1.3 Create `plugins/sp/skills/code-improvement/SKILL.md` — port from rd3 `code-improvement/SKILL.md`, adapt: sp path-or-WBS entry, sp conventions. Five signals: shallow module, tight coupling, wrong seam, weak locality, poor test surface. Ranked deepening candidates.
- [ ] 1.4 Create `plugins/sp/skills/code-improvement/references/deepening-signals.md` — detailed signal definitions and examples.

#### Phase 2: Enhance dev-review command

- [ ] 2.1 Enhance `plugins/sp/commands/dev-review.md` — dual mode: WBS (task diff) + path (standalone). Multi-dimensional: delegates to `sp:code-verification` (SECUA) + `sp:code-improvement` (architecture) + `sp:functional-review` (requirements). Writes Verdict sentence with icon to `## Review` section.
- [ ] 2.2 Update argument-hint and description to reflect dual mode.
- [ ] 2.3 Ensure `--auto` flag passes through to all delegated skills.

#### Phase 3: Create super-reviewer subagent

- [ ] 3.1 Create `plugins/sp/agents/super-reviewer.md` — thin delegation agent. Two modes: Direct-Entry (standalone review) + Worker Mode (pipeline Phase 7). Delegates to `sp:code-verification`, `sp:code-improvement`, `sp:functional-review`, `sp:code-review`. Structured output envelope. `model: inherit`, `color: crimson`, `see_also: [sp:super-coder, sp:expert-spur]`.
- [ ] 3.2 Add `<example>` blocks for: security audit, architecture deepening, full five-dimension review, pipeline worker mode.
- [ ] 3.3 Verify it does NOT implement review logic (thin delegation only).

#### Phase 4: Enhance spur-dev skill

- [ ] 4.1 Update `plugins/sp/skills/spur-dev/SKILL.md` — review step now references multi-dimensional review (SECUA + architecture + functional requirements). Note the three dispatched skills.
- [ ] 4.2 Update the competencies table in spur-dev to include `sp:code-improvement` and `sp:functional-review` in the review step.

#### Phase 5: Add behavioral guardrails

- [ ] 5.1 Create `plugins/sp/skills/code-review/references/receiving-code-review.md` — behavioral guardrail: technical not emotional, verify before implementing, no performative agreement. Adapted from Superpowers.
- [ ] 5.2 Create `plugins/sp/skills/code-review/references/verification-before-completion.md` — evidence discipline: evidence before claims, run verification, no "I think it works" without proof. Adapted from Superpowers.

#### Phase 6: Update cross-references and docs

- [ ] 6.1 Update `plugins/sp/skills/code-verification/SKILL.md` — cross-reference `sp:code-improvement` and `sp:functional-review` in the see-also and review mode sections.
- [ ] 6.2 Update `docs/04_DESIGN.md` — review command surface (dual mode, multi-dimensional).
- [ ] 6.3 Update `docs/05_FEATURES.md` — review capability feature status.

#### Phase 7: Verify

- [ ] 7.1 Run `bun run lint` — biome check + tsc clean.
- [ ] 7.2 Run `bun run test` — all existing tests pass, no regressions.
- [ ] 7.3 Run `spur task check 0227` — task file compliance.
- [ ] 7.4 Smoke test: invoke `/sp:dev-review 0227 --auto` against this task to verify the multi-dimensional review works end-to-end.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- rd3 `dev-review.md`: `~/projects/cc-agents/plugins/rd3/commands/dev-review.md`
- rd3 `super-reviewer.md`: `~/projects/cc-agents/plugins/rd3/agents/super-reviewer.md`
- rd3 `functional-review` skill: `~/projects/cc-agents/plugins/rd3/skills/functional-review/SKILL.md`
- rd3 `code-improvement` skill: `~/projects/cc-agents/plugins/rd3/skills/code-improvement/SKILL.md`
- sp `dev-review.md`: `plugins/sp/commands/dev-review.md`
- sp `code-verification` skill: `plugins/sp/skills/code-verification/SKILL.md`
- sp `code-review` skill: `plugins/sp/skills/code-review/SKILL.md`
- sp `spur-dev` skill: `plugins/sp/skills/spur-dev/SKILL.md`
- task-pipeline.yaml: `.spur/workflows/task-pipeline.yaml`
- agent-skills `code-reviewer.md`: `vendors/agent-skills/code-reviewer.md`
- Superpowers `requesting-code-review`: `vendors/Superpowers/skills/requesting-code-review.md`
- Superpowers `receiving-code-review`: `vendors/Superpowers/skills/receiving-code-review.md`
- Superpowers `verification-before-completion`: `vendors/Superpowers/skills/verification-before-completion.md`
- mattpocock `code-review`: `vendors/skills/code-review.md`
- mattpocock `improve-codebase-architecture`: `vendors/skills/improve-codebase-architecture.md`

### History
