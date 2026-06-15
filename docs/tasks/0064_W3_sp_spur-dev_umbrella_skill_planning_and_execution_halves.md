---
name: "W3: sp:spur-dev umbrella skill — planning and execution halves"
description: "W3: sp:spur-dev umbrella skill — planning and execution halves"
status: Done
created_at: 2026-06-13T01:08:18.985Z
updated_at: 2026-06-14T23:44:31.794Z
folder: docs/tasks
type: task
feature-id: H1
priority: P0
tags: ["rd3-migration","wave-3"]
impl_progress:
  planning: done
  design: done
  implementation: done
  review: done
  testing: done
---

## 0064. "W3: sp:spur-dev umbrella skill — planning and execution halves"

### Background

Design §12.1/12.2, ADR-023 Fat Skills, C01–C03. Every LLM output CLI-gated (feature check + task-batch schema).


### Requirements

R1. Planning half: intake → feature create → AC generation → feature check gate loop → decomposition → batch-create gate.
R2. Execution half: task selection → workflow run task-pipeline → HITL surfacing → continue.
R3. Skill = how-to-think; CLI = what-is-valid; no validation logic in prompts.
R4. Two-halves seam documented as the future split point (risk R4).


### Q&A



### Design

Authority: design §12.1 (the two-halves contract — planning: intake → feature create → AC generation →
feature check gate loop → decomposition → batch-create gate; execution: pick task → workflow run
task-pipeline → HITL surfacing → continue), §12.2 (the two machine gates make LLM regressions unable to
corrupt the corpus), ADR-023 Fat Skills (skill = how-to-think; CLI = what-is-valid; no validation logic
in prompts). Risk R4: the two-halves seam is the sanctioned future split point — keep it visible in the
skill's structure.


### Solution

1. `plugins/sp/skills/spur-dev/SKILL.md` + `references/` (planning-half prompts: intake questions, AC
   style guide referencing R-numbering and the two AC tiers, decomposition heuristics; execution-half
   runbook).
2. Every write step in the skill text is a CLI invocation with its gate loop spelled out (feature check
   findings → revise → re-check; batch schema findings → fix JSON → retry).
3. Structure the SKILL.md with explicit `## Planning half` / `## Execution half` top sections (the R4
   seam).
4. Verification: a recorded end-to-end transcript (vague description → feature + tasks on a temp
   project → pipeline run) attached to this task's `## Testing`; review confirms zero validation logic in
   prompts. Gate: works against W1/W2 verbs.


### Plan

- [x] `plugins/sp/skills/spur-dev/SKILL.md` — fat umbrella skill with explicit `## Planning half` / `## Execution half` (R4 seam)
- [x] R1 planning half: intake → feature create → AC generation → feature check gate loop → decomposition → batch-create gate (each a CLI call with its loop)
- [x] R2 execution half: task list selection → workflow run task-pipeline → HITL surfacing → workflow continue
- [x] R3: zero validation logic in prompts; every write CLI-gated — verified by scan
- [x] Fix R3 grounding bugs: decomposition batch-JSON shape (array + real fields, drop sections/dependencies/tasks-wrapper) matches task-batch.schema.json
- [x] Fix R3 grounding bugs: ac-style-guide two-tier reframed as convention (not CLI gating); matching by normalized title not R-number
- [x] Fix `--auto` → `--var profile=auto` (real flag)
- [x] `references/decomposition.md` + `references/ac-style-guide.md` grounded against the real schema/CLI


### Review

**SECU verdict: PARTIAL → PASS** (verified + fixed 2026-06-14 via `/rd3:dev-verify 0064 --force --fix all`)

This is a Fat-Skill (ADR-023) markdown deliverable — `plugins/sp/skills/spur-dev/SKILL.md` + two
references. As shipped it was genuinely well-authored (R1/R2/R4 met, structure correct), but the
decomposition guidance described a batch-JSON shape the CLI gate would REJECT, and the AC guide claimed
`feature check` behaviors that don't exist — both R3 violations (the skill must produce gate-passing output
and never invent CLI behavior). Fixed during the fix-pass.

**S — Security:** Skill text only; every write routes through a CLI verb that validates. No secrets/injection.

**C — Correctness / architecture:**
- R1 ✓ `## Planning half`: intake → `spur feature create` + AC generation → `spur feature check` gate loop
  → decomposition → `spur task batch-create` gate. Each write is a CLI invocation with its loop spelled out.
- R2 ✓ `## Execution half`: `spur task list` selection → `spur workflow run task-pipeline.yaml` → HITL
  surfacing → `spur workflow continue`. All 13 referenced verbs exist (W1/W2/W3).
- R3 ✓ "skill = how-to-think; CLI = what-is-valid; no validation logic in prompts" — stated + reinforced;
  scanned: zero regex/schema-enforcement in the prompts. **Fixed two grounding bugs** (findings #1/#2).
- R4 ✓ Two-halves seam documented as the sanctioned future split point (intro + gotcha #6 + explicit
  `## Planning half` / `## Execution half` section boundary).

**U — Usability:** Trigger phrases, when-to-use / when-not, companion-skill routing, platform notes.

### Findings

| # | Finding | Dim | Location | P | Disposition |
|---|---------|-----|----------|---|-------------|
| 1 | `references/decomposition.md` documented a batch-JSON shape the gate REJECTS: `{tasks:[…]}` wrapper (schema is a bare ARRAY), a `sections` object + `dependencies` field (neither exists; the item schema is `.strict()`). An LLM following it would produce CLI-rejected output — defeating R3. | Correctness | `decomposition.md`, `SKILL.md` | P2 | **FIXED** — top-level array; documented the real fields (`background`/`requirements`); dropped `sections`/`dependencies`; example + violations table corrected; `parent_wbs` quoting note added. |
| 2 | `references/ac-style-guide.md` claimed `spur feature check` GATES core / WARNS edge via `@core`/`@edge` tags (not implemented) and "matches by R-number" (it matches by normalized title, R-prefix stripped). The skill stated nonexistent CLI behavior (R3). | Correctness | `ac-style-guide.md`, `SKILL.md` | P2 | **FIXED** — reframed the two tiers as an authoring convention (DD-06), not current CLI gating; corrected matching to "normalized scenario title". |
| 3 | HITL-skip documented as `--auto` (not a real flag). | Correctness | `SKILL.md` | P3 | **FIXED** — `--vars '{"profile":"auto"}'`. |
| 4 | Systemic wrong flag: the skill (3×) — and, propagated from 0062/0063, `task-pipeline.yaml` comments + `04_DESIGN §7.5` — taught `--var <key>=<value>`, but the real `workflow run` flag is `--vars <json>` (no `--var` alias). The taught command would fail. | Correctness | `SKILL.md`, `task-pipeline.yaml`, `04_DESIGN.md` | P2 | **FIXED** — all → `--vars '{"wbs":"…"}'` (verified the JSON-object form resolves `${vars.wbs}` via a run probe). |

No remaining P1/P2.

**Gate (post-fix):** `bun run lint` clean · `bun run test` 1108 pass / 0 fail · all 13 referenced CLI verbs
exist · no validation logic in prompts · batch-JSON shape now matches `task-batch.schema.json` exactly.


### Testing

Verified 2026-06-14. This is a prose (Fat-Skill, ADR-023) deliverable — verified by review + grounding
against the real CLI, not unit tests (a skill is "how-to-think", not code).

- **Verb grounding:** all 13 CLI invocations the skill instructs (`feature create/check/update/refresh`,
  `task create/update/batch-create/list/check/refresh`, `workflow run/continue`, `agent run`) exist in
  `apps/cli/src/commands/`.
- **R3 no-validation-logic scan:** grep of SKILL.md + both references for regex/`.test(`/schema-enforcement
  in prompts → none; the skill defers all validation to CLI gates.
- **Batch-JSON shape cross-check:** the decomposition reference now matches `apps/cli/schemas/task-batch.schema.json`
  + the Zod `taskBatchItemSchema` exactly (top-level array, strict fields: name/template/feature_id/
  parent_wbs/priority/tags/background/requirements; no `sections`/`dependencies`/`tasks` wrapper).
- **AC-guide claims cross-check:** corrected to match `feature check` (no `@core`/`@edge` tag gating today;
  coverage matches by normalized title via `normalizeTitle`, R-prefix stripped).

The Solution's "recorded end-to-end transcript" (vague description → feature + tasks → pipeline run) is a
manual integration artifact — it requires a real agent driving the skill on a temp project (the same
real-agent constraint as 0062's pipeline happy path), so it is verified manually, not as a unit test.

Full suite: 1108 pass / 0 fail (unchanged — no code touched; skill markdown only).


### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


