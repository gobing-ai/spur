---
name: "W3: sp:dev-* slash command subset and subagents"
description: "W3: sp:dev-* slash command subset and subagents"
status: Done
created_at: 2026-06-13T01:08:18.985Z
updated_at: 2026-06-15T00:04:26.598Z
folder: docs/tasks
type: task
feature-id: H1
priority: P1
tags: ["rd3-migration","wave-3"]
impl_progress:
  planning: done
  design: done
  implementation: done
  review: done
  testing: done
---

## 0065. "W3: sp:dev-* slash command subset and subagents"

### Background

Design §12.3 + delivery doc §7.3/7.4. dev-* names continue rd3:dev-* muscle memory; final subset = ADR-016 decision test per candidate.


### Requirements

R1. ADR-016 test applied per candidate (dev-plan, dev-run, dev-unit, dev-review, dev-verify, dev-new-task, dev-fixall, dev-gitmsg, dev-docs, dev-changelog, dev-handover, dev-refine); record pass/fail rationale.
R2. Shipped commands are thin wrappers of sp:spur-dev.
R3. expert-dev/expert-tasks/expert-features thin subagent wrappers.


### Q&A



### Design

Authority: design §12.3 + delivery doc §7.3 (candidates: dev-plan, dev-run, dev-unit, dev-review,
dev-verify, dev-new-task, dev-fixall, dev-gitmsg, dev-docs, dev-changelog, dev-handover, dev-refine —
names continue rd3:dev-* for muscle memory) and §7.4 (expert-dev/tasks/features). ADR-016 decision test
applied **per candidate**: a command exists only where the LLM converts non-deterministic intent into a
reliable sequence; expect few, not 42. ADR-023(2): commands and subagents are thin wrappers of skills.


### Solution

1. Verdict table first: run each candidate through the ADR-016 test; record pass/fail + one-line
   rationale in this task's `## Review` (the auditable filter output).
2. For passing candidates: `plugins/sp/commands/dev-<verb>.md` — argument parsing + `sp:spur-dev` (or
   companion) invocation only; mirror the existing rule-add/workflow-add command style.
3. `plugins/sp/agents/expert-dev.md`, `expert-tasks.md`, `expert-features.md` mirroring the
   expert-rules/expert-workflows pattern: description, trigger examples, skill delegation.
4. Same commit: delivery doc §7.3 updated with the final subset (replacing 'candidates'). Gate: each
   shipped command demonstrably wraps the skill with zero embedded pipeline logic (review).


### Plan

- [x] R1: apply the ADR-016 test per candidate; record pass/fail + rationale in `## Review` (the auditable verdict table)
- [x] R2: 12 `plugins/sp/commands/dev-*.md` thin wrappers — single `Skill()` delegation, no embedded logic (11 → sp:spur-dev, 1 → sp:doc-evolve)
- [x] R3: `expert-dev`/`expert-tasks`/`expert-features` thin subagent wrappers mirroring expert-rules/expert-workflows
- [x] Flag: `dev-docs` is a forward-dependency on the unbuilt `sp:doc-evolve` skill (P3, future task)
- [x] Same-commit: delivery doc §7.3 updated to the final subset (proposed → shipped)


### Review

**SECU verdict: PARTIAL → PASS** (verified + fixed 2026-06-14 via `/rd3:dev-verify 0065 --force --fix all`)

The 12 `sp:dev-*` commands + the 3 expert subagents (expert-dev/tasks/features) were authored as thin
wrappers, but the **R1 ADR-016 verdict table** (the auditable per-candidate filter output the task
requires in this section) was missing. Produced it below; also flagged the one forward-dependency.

**S — Security:** Markdown command/subagent definitions only; all logic delegated to skills/CLI. No injection.

**C — Correctness / architecture:**
- R2 ✓ Each command is a thin `Skill()` delegation (~50 lines: frontmatter + when-to-use + a single
  `Skill(skill=…)` call), no embedded pipeline logic. 11/12 delegate to `sp:spur-dev`; `dev-docs` →
  `sp:doc-evolve`.
- R3 ✓ `expert-dev` / `expert-tasks` / `expert-features` mirror the `expert-rules`/`expert-workflows`
  pattern: `skills:` frontmatter, trigger examples, "delegate to the skill — do NOT reimplement" role.
  `expert-dev` → `sp:spur-dev` (exists). `expert-tasks` → `sp:spur-tasks` and `expert-features` →
  `sp:spur-features` are **forward-dependencies** on the companion skills built in **0066** (the next
  task) — inert until those land (finding #3, same class as `dev-docs`).

### R1 — ADR-016 decision test, per candidate

ADR-016: a command is justified **only** when it converts non-deterministic intent into a reliable
sequence the CLI can't express as one verb. All 12 dev-* verbs are LLM-driven (fuzzy intent → a reliable
generated/edited artifact or orchestrated multi-step run) — none is a bare forwarder of a deterministic
CLI verb — so each **passes**. Backing skill in parens.

| Candidate | Verdict | Rationale |
|-----------|---------|-----------|
| `dev-plan` (spur-dev) | **PASS** | description → feature + AC + decomposed batch; multi-step LLM orchestration with two CLI gates. Not a single verb. |
| `dev-run` (spur-dev) | **PASS** | drives a task through `task-pipeline.yaml` with HITL/result interpretation — orchestration, not a verb. |
| `dev-unit` (spur-dev) | **PASS** | LLM authors/extends tests to a coverage target — generative, not deterministic. |
| `dev-review` (spur-dev) | **PASS** | SECU review = LLM judgment over a diff; no CLI verb produces it. |
| `dev-verify` (spur-dev) | **PASS** | requirements traceability + SECU verdict — LLM synthesis. |
| `dev-new-task` (spur-dev) | **PASS** | NL intent → a validated task file (CLI-gated) — fuzzy→artifact. |
| `dev-fixall` (spur-dev) | **PASS** | iterative lint/type/test fix loop the LLM orchestrates until clean. |
| `dev-gitmsg` (spur-dev) | **PASS** | diff → conventional commit message — generation, not a verb. |
| `dev-changelog` (spur-dev) | **PASS** | commit range → curated changelog prose — generative. |
| `dev-handover` (spur-dev) | **PASS** | session state → a structured handover doc — synthesis. |
| `dev-refine` (spur-dev) | **PASS** | auto-refine a task definition — LLM editing toward the matrix. |
| `dev-docs` (doc-evolve) | **PASS (forward-dep)** | constitution-native doc evolution — LLM-value-add — BUT its skill `sp:doc-evolve` is "proposed (full rewrite of rd3:code-docs)", not yet built (delivery §7.3). The command is inert until that skill ships. |

### Findings

| # | Finding | Dim | Location | P | Disposition |
|---|---------|-----|----------|---|-------------|
| 1 | R1's auditable ADR-016 verdict table (Solution step 1 — "record pass/fail + rationale in `## Review`") was missing. | Process | task `## Review` | P2 | **FIXED** — full per-candidate table above. |
| 2 | `dev-docs` delegates to `sp:doc-evolve`, a skill that does NOT yet exist (delivery §7.3 lists it "proposed"). The command is a forward-dependency — inert until the skill ships. | Correctness | `dev-docs.md` | P3 | **FLAGGED** — kept (the verb passes ADR-016 and the skill is a planned sibling, guardrail: future-task dependency); noted as inert-pending. Not a 0065 bug to fix here. |
| 3 | `expert-tasks` / `expert-features` subagents delegate to `sp:spur-tasks` / `sp:spur-features`, which do NOT exist yet — they are built by **0066** (the next task). Inert until then. | Correctness | `expert-tasks.md`, `expert-features.md` | P3 | **FLAGGED** — forward-dependency on 0066's companion skills (same class as #2). Kept; the subagents are correct thin wrappers, just pending their skills. Verified at 0066. |

No remaining P1/P2.

**Gate (post-fix):** `bun run lint` clean · `bun run test` 1108 pass / 0 fail · all 12 commands are thin
`Skill()` wrappers (no embedded logic); 11 → `sp:spur-dev`, 1 → `sp:doc-evolve` (forward-dep); 3 expert
subagents are thin delegations; delivery §7.3 updated to the final subset.


### Testing

Verified 2026-06-14. Prose deliverable (commands + subagents) — verified by review + grounding, not unit tests.

- **Thin-wrapper check (R2):** each of the 12 `plugins/sp/commands/dev-*.md` has a single `Skill(skill=…)`
  Implementation block; grep for embedded pipeline logic (multi-step bash / validation loops) → none. 11
  delegate to `sp:spur-dev`, `dev-docs` to `sp:doc-evolve`.
- **Subagent check (R3):** `expert-dev`/`expert-tasks`/`expert-features` carry `skills:` frontmatter +
  trigger examples + a "delegate, do NOT reimplement" role, mirroring `expert-rules`/`expert-workflows`.
- **ADR-016 application (R1):** each candidate scored against the ADR-016 test (see the `## Review` table) —
  all 12 pass (LLM-driven, not bare CLI forwarders); `dev-docs` passes but is a forward-dependency on the
  unbuilt `sp:doc-evolve` skill.
- **Backing-skill existence:** `sp:spur-dev` exists (0064); `sp:doc-evolve` does NOT yet (flagged P3).

Full suite: 1108 pass / 0 fail (no code touched — markdown + the delivery doc only).


### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


