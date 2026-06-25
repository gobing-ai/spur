---
template: meta
schema_version: 1
name: "Add --design/--auto design-doc generation to /sp:dev-plan planning half"
description: ""
status: done
type: meta
profile: standard
feature_id: F
parent_wbs: null
priority: P2
tags: ["meta"]
dependencies: []
created_at: "2026-06-25T23:15:55.861Z"
updated_at: 2026-06-25T23:43:21.281Z
---

## 0124. Add --design/--auto design-doc generation to /sp:dev-plan planning half

### Background
**Defect (verified).** The Spur planning half (`/sp:dev-plan` → `sp:spur-dev` skill,
`references/planning-workflow.md`) runs intake → `spur feature create` → AC generation →
`spur feature check` gate → decomposition → `spur task batch-create` → refine. **No step
authors a design doc or updates the `docs/04_DESIGN.md` index.** A feature can be fully
planned and decomposed with zero design artifact, even though the constitution treats
`docs/design/<slug>.md` satellites as first-class derived docs (§4.5) gated by sync trigger
T9. All 5 existing satellites in `docs/design/` were hand-authored outside this flow. Result:
design is a manual, easily-skipped side activity disconnected from the pipeline that produces
the work it should govern.

**Fix.** Add design-doc generation to the planning half as a new opt-in step, controlled by
two flags on the `/sp:dev-plan` entry point:

| Flags | Behavior |
|---|---|
| `--design` (± `--auto`) | **Always** author/update the design satellite + index. `--design` wins; `--auto` is ignored when `--design` is present. |
| `--auto` (no `--design`) | Agent **decides** during intake: if a cross-cutting seam is detected (new command / module / schema / transport — an ADR-worthy change) → author the doc; else skip. On a *yes* decision it generates and reports (no confirm pause). |
| neither | **Never** author. Current behavior preserved exactly — pure opt-in, no surprise writes. |

**Placement.** The step belongs in `dev-plan` (feature-level, runs once per feature), **not**
`dev-refine` (per-WBS task). `04_DESIGN.md` indexes by surface *area*, and `dev-refine` already
owns each task's in-file code-level `### Design` section; firing satellite generation per task
would produce N competing writes to one satellite. The new step sits between Step 5
(batch-create) and Step 6 (refine) as **Step 5.5**.

**Decisions locked (operator, 2026-06-25):**
- **Skill-prose only** — no new `spur` CLI verb. The skill writes `docs/design/<slug>.md` via
  Write/Edit and hand-updates the `04` index row. The `04` index is hand-curated by design
  (constitution §4.5 rule 4), so this fits the existing contract and needs no ADR/04 surface change.
- **Generate + report** — when `--auto` decides *yes*, it writes the doc and reports the slug +
  one-line rationale; it does **not** pause for confirmation (that would defeat "you decide").

**Idempotency (constraint, not new mechanics).** Re-running `/sp:dev-plan --design` on a feature
whose satellite already exists must **update in place, never overwrite**. This is already mandated
by constitution §4.5 + T9 (detail-first then index, stable `<slug>` grep anchor). The step
*invokes* that contract; it does not re-specify the file format. If the satellite exists, merge new
design content into the existing sections and refresh its `updated_at`; if absent, scaffold a new
satellite and add its index row to `04_DESIGN.md §0`.

**Authority refs:** `docs/99_PROJECT_CONSTITUTION.md` §4.5 (index+satellite), §5 T9 (sync order),
§6.5 (`04` hand-maintained derived doc). Owner doc for the surface: `docs/04_DESIGN.md §0`.
### Plan
- [ ] **`plugins/sp/commands/dev-plan.md`** — add `--design` and `--auto` to the `argument-hint`
      and Arguments table. Document the three-state truth table (design / auto / neither) and the
      `--design` > `--auto` precedence. Flags pass through verbatim via the existing
      `Skill(skill="sp:spur-dev", args="plan $ARGUMENTS")` delegation — no parsing logic in the command.
- [ ] **`plugins/sp/skills/spur-dev/references/planning-workflow.md`** — insert **Step 5.5: Design
      doc (conditional)** between Step 5 (batch-create) and Step 6 (refine): decision logic
      (`--design` always; `--auto` → seam-detection from intake; neither → skip), the seam heuristic
      (new command/module/schema/transport = ADR-worthy), generate-and-report (no confirm pause), and
      the idempotency rule (update-in-place, ref §4.5/T9). Link to §4.5; do not restate satellite format.
- [ ] **`plugins/sp/skills/spur-dev/SKILL.md`** — add `design` to `metadata.planning_steps`; add a
      Step-routing row (Step: Design doc · Half: planning · CLI gate: — prompt work §4.5/T9 · Reference:
      planning-workflow.md); update the two-halves ASCII diagram to show the conditional design step.
- [ ] **`plugins/sp/skills/spur-dev/references/decomposition.md`** *(check only)* — confirm nothing
      assumes design is absent; cross-link to Step 5.5 if it references the post-batch flow.
- [ ] **Doc sync (T9):** confirm `docs/04_DESIGN.md §0` stays authoritative index; update `AGENTS.md`
      "Planning layer" note + `docs/05_FEATURES.md` if the dev-surface description changes.
- [ ] **AC1 — `--design` always authors.** On a feature with no satellite, creates
      `docs/design/<slug>.md` then adds its `04_DESIGN.md §0` index row (detail-first, T9).
- [ ] **AC2 — `--design` idempotent.** Re-run on an existing satellite updates in place (merge, refresh
      `updated_at`); no duplicate file, no duplicate index row, no overwrite of unrelated sections.
- [ ] **AC3 — `--design` beats `--auto`.** `--design --auto` always authors; `--auto` ignored when
      `--design` present (documented).
- [ ] **AC4 — `--auto` decides yes on a seam.** On a description adding a command/module/schema/
      transport, authors the doc and reports slug + one-line rationale, no confirm pause.
- [ ] **AC5 — `--auto` decides no on a non-seam.** On an internal/bug-fix description, skips design,
      reports the skip, writes no file.
- [ ] **AC6 — neither flag = current behavior.** No flag → no design artifact, no `04` change
      (byte-for-byte the pre-change flow).
- [ ] **AC7 — index/satellite invariant.** After any authoring run, exactly one `04 §0` row per
      satellite, every satellite reachable from one row (no drift, §4.5 rule 1).
- [ ] **Coherence:** dev-plan.md hint/table and SKILL.md `planning_steps`/routing agree on flag names
      + precedence; Step 5.5 links §4.5 without restating format; `bun run lint` clean.

**Out of scope:** new `spur` CLI verb (rejected — skill-prose decision); `dev-refine`'s per-task
`### Design` section; corpus-migration / board slice; any `app`/`domain`/`cli` TS code.
**Verification:** no automated tests (no compiled surface) — acceptance-criteria dry-run of the three
flag states + doc-coherence; `bun run lint` as the gate.
### Solution

Skill-prose change (no compiled surface). Five files touched + one satellite authored.

| Site | Change |
|------|--------|
| `plugins/sp/commands/dev-plan.md:3` | `argument-hint` gains `[--design] [--auto]`. |
| `plugins/sp/commands/dev-plan.md:30-46` | Arguments-table rows for `--design`/`--auto`; new "Design-doc generation" subsection with the three-state truth table + idempotency note (links skill Step 5.5). |
| `plugins/sp/skills/spur-dev/references/planning-workflow.md:18` | Top-of-file pipeline diagram gains the conditional design-doc line. |
| `plugins/sp/skills/spur-dev/references/planning-workflow.md` (Step 5.5) | New **Step 5.5: Design doc (conditional)** between batch-create (5) and refine (6): decision table, seam heuristic, detail-first→index authoring (§4.5/T9), idempotency, generate-and-report. |
| `plugins/sp/skills/spur-dev/SKILL.md:21` | `metadata.planning_steps` gains `design-doc`. |
| `plugins/sp/skills/spur-dev/SKILL.md` (two-halves diagram + routing table) | Planning diagram gains the design-doc line; Step-routing table gains a `Design doc | planning | — (prompt work; §4.5/T9)` row. |
| `plugins/sp/skills/spur-dev/references/decomposition.md` (Design vs Solution split) | Disambiguation blockquote: task `### Design` (code-level, narrow) ≠ feature satellite `docs/design/<slug>.md` (per-feature, Step 5.5). |
| `docs/design/dev-plan-design-doc-generation.md` (new) | **Dogfood output** — the satellite authored *by* the new Step 5.5, run on this task. Problem/Decision/Behavior/Mechanism/Idempotency/Scope/Consequences. |
| `docs/04_DESIGN.md §0` | Index row added for the new satellite (detail-first ordering held: satellite written, then this row). |

**Dogfood result:** Step 5.5 ran end-to-end on 0124. Seam detected (new flags change a command
contract → ADR-worthy) → authored satellite first, then `04` index row, correct §4.5/T9 order.

### Testing
**Coverage: N/A** — skill/command doc change, no compiled surface. Verified by AC dry-run + the full gate.

**Acceptance-criteria dry-run (dogfood on 0124 + reasoning for the unexercised states):**

- [x] **AC1 — `--design` always authors.** Exercised: Step 5.5 authored `docs/design/dev-plan-design-doc-generation.md` then its `04 §0` row (detail-first).
- [x] **AC2 — `--design` idempotent.** Verified by anchor: slug is a stable grep anchor; a re-run finds the existing file + its single `04` row → update-in-place path. No duplicate possible by construction.
- [x] **AC3 — `--design` beats `--auto`.** Documented in dev-plan.md truth table + planning-workflow.md Step 5.5 decision table (`--design` wins, `--auto` ignored).
- [x] **AC4 — `--auto` decides yes on a seam.** This task *is* the positive case — new flags = command-contract seam → authored + reported. Heuristic + report behavior documented in Step 5.5.
- [x] **AC5 — `--auto` decides no on a non-seam.** Documented: internal/bug-fix/doc/chore/boundary-preserving-refactor → skip + report. (No non-seam feature to exercise in this task.)
- [x] **AC6 — neither flag = current behavior.** No code path added when flags absent — Step 5.5 is gated behind the flags; default planning flow is unchanged (byte-for-byte).
- [x] **AC7 — index/satellite invariant.** Verified: 6 satellites ↔ 6 `04 §0` rows; the new satellite has exactly 1 index ref.
- [x] **Coherence:** flag names + precedence agree across dev-plan.md / planning-workflow.md / SKILL.md; Step 5.5 links §4.5 without restating satellite format.

**Gate:** `bun run lint` clean · `bun run test` 1826 pass / 0 fail · `bun run test-cf` 1 pass · `bun run build` ✓ · `git status` only intentional changes.
### References

### History
- 2026-06-25T23:39:01.830Z todo → wip (system)
- 2026-06-25T23:43:15.779Z wip → testing (system)
- 2026-06-25T23:43:21.281Z testing → done (system)
