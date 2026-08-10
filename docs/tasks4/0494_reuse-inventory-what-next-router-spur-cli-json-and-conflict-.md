---
template: brainstorm
schema_version: 1
name: "Reuse inventory: what next-router, spur CLI --json, and conflict-finding already provide that dev-find-next must compose rather than rebuild"
description: ""
status: todo
type: brainstorm
profile: standard
feature_id: H12
parent_wbs: null
priority: P2
tags: []
dependencies: []
ac_numbering: task-local
created_at: "2026-08-10T00:45:45.534Z"
updated_at: "2026-08-10T00:58:02.573Z"
---

## 0494. Reuse inventory: what next-router, spur CLI --json, and conflict-finding already provide that dev-find-next must compose rather than rebuild

### Background
**Type:** `wayfinder:research` · **Map:** H12

The most likely way this command fails is by rebuilding traversal, filtering, and reporting the
harness already has — and then drifting out of sync with it.

**Verified terrain (2026-08-09, this tree):**

- **The actionability filter already exists.** `routing-table.md:83` (row B3) defines the frontier
  predicate — open ∧ all `dependencies[]` done — and orders WBS-ascending. dev-find-next needs the
  same predicate with a different ordering. Whether that is reusable prose, extractable logic, or a
  copy is unestablished.
- **Feature-level hygiene routes already exist.** `routing-table.md:84-87` (rows B4–B7) already
  classify: no/invalid AC → `/sp:dev-plan`; valid AC + zero tasks → `/sp:dev-plan`; all children done
  in `active`/`verifying` → `/sp:dev-wrapall`; mixed cancelled/done → manual status update. These
  overlap heavily with what a "which feature next" answer would want to say. Duplicating them creates
  two routers disagreeing about the same feature.
- **The CLI already derives status.** `spur feature sync` aligns lifecycle status from linked tasks;
  `spur feature refresh` rebuilds `INDEX.md` and per-feature `## Tasks` tables; `spur feature check`
  is the four-layer validator; `spur feature list --json` filters by status/priority. Any signal the
  prioritizer computes by hand that one of these already produces is duplicated logic.
- **The command+skill template exists.** `sp:conflict-finding` is 1411 lines across `SKILL.md` (254)
  + four references — `authority-resolution.md`, `comparison-protocol.md`, `finding-contract.md`,
  `remediation-routing.md`. `plugins/sp/commands/dev-find-conflict.md` is a thin wrapper that forwards
  `$ARGUMENTS` to the skill. This is the shape the operator asked for; what carries over structurally
  versus what is conflict-specific is unmapped.

The output of this ticket is a build-vs-reuse ledger, not a design. It bounds the implement tickets
before they are written — which is cheaper than discovering the overlap during review.

Scope note: `/sp:dev-featurechange`'s protocol and the restructure mapping-file schema belong to
**0495**, not here. This ticket stops at what the *ranking and reporting* half composes.
### Requirements
- R1 — Rule on the frontier predicate (`routing-table.md:83`, row B3): can dev-find-next reference it as the SSOT, or must it restate it? If restated, name the mechanism that keeps the two from drifting, since two disagreeing definitions of "actionable" is worse than one imperfect one.
- R2 — Map every TABLE B feature-level row (B4–B7, `routing-table.md:84-87`) against what a "which feature next" answer would say about the same feature, and state per row whether dev-find-next defers to next-router, restates it, or genuinely differs.
- R3 — Inventory which candidate signals from 0493 are already produced by an existing `spur` verb (`feature sync`, `feature refresh`, `feature check`, `feature list --json`, `task list --json`, `status`), with the verb and flag that yields each. Hand-derivation of anything on this list is duplicated logic.
- R4 — Extract the reusable structure of the prompt-first command+skill pattern from `sp:conflict-finding` (SKILL.md + 4 references) and `plugins/sp/commands/dev-find-conflict.md`: which reference files are pattern, which are conflict-specific, and what the analogous reference set for `sp:next-feature` should be.
- R5 — Produce a build-vs-reuse ledger: for each capability the prioritizer needs, one of reuse-as-is / compose / must-build, each with the file:line or verb that justifies the call.
### Acceptance Criteria
```gherkin
Feature: 0494 wayfinder investigation

  Scenario: R1 — one definition of actionable survives
    Given routing-table row B3 defines the frontier predicate
    When this ticket is resolved
    Then the task body rules whether sp:next-feature cites or restates it
    And if restated, names a concrete mechanism preventing drift between the two

  Scenario: R2 — no second router is created
    Given routing-table rows B4 through B7
    When each is compared against a which-feature-next answer for the same feature
    Then every row carries a defer, restate, or differs verdict with its reason

  Scenario: R3 — existing producers are found before anything is built
    Given the candidate signals from the map hypothesis
    When each is checked against the spur feature, task, and status verbs
    Then every signal already produced by an existing verb names that verb and flag
    And hand-derivation of a signal an existing verb produces is reported as duplicated logic

  Scenario: R4 — the template is extracted as a concrete file list
    Given sp:conflict-finding's SKILL.md and its four reference files
    When the prompt-first pattern is extracted
    Then each reference is classified as pattern or conflict-specific
    And the output names the proposed reference files for plugins/sp/skills/next-feature/

  Scenario: R5 — the ledger bounds the implement tickets
    Given every capability the prioritizer needs
    When the inventory completes
    Then each capability carries reuse-as-is, compose, or must-build
    And each verdict cites a repo-relative file:line or a spur verb
    And no capability is marked must-build without evidence that no existing surface provides it
```
### Q&A
**Closed during charting (2026-08-09) — map `### Decisions so far`:**

- *Is there real overlap with `/sp:dev-next`?* **No overlap, a seam.** `routing-table.md:32` declares
  the target-omitted case out of v1. dev-next advances a chosen target; dev-find-next chooses one.
  This ticket's job is to keep that seam clean at the level of concrete capabilities, not to relitigate it.
- *Does this ticket own the featurechange handoff?* **No** — 0495 does. Scope boundary is explicit in
  the Background and repeated as an anti-pattern.

**Closed during this refine (2026-08-10):**

- *Are the conflict-finding line counts and the thin-wrapper claim accurate?* **Yes, re-verified.**
  1411 lines total across SKILL.md (254) + 4 references; `dev-find-conflict.md` forwards `$ARGUMENTS`
  in a single `Skill()` call. Frozen into Design as reference points.
- *Does this ticket depend on 0493?* **No.** It is independent and runs on the frontier alongside it.
  R3 references the map's candidate-signal list (a hypothesis), not 0493's measured results — so this
  ticket does not stall if 0493 is unresolved. If 0493 later rejects a signal, the corresponding
  ledger row becomes moot rather than wrong.

**Deferred with owner — operator (map `### Open questions`), do not settle inside this ticket:**

- **OQ1 — dispatch or report.** Whether `/sp:dev-find-next` chains into `/sp:dev-next` materially
  changes the capability list (a dispatching command needs argv shaping and chain semantics; a
  reporting one does not). This ticket enumerates the capabilities for **both** readings and marks
  the dispatch-only rows as conditional on OQ1, rather than guessing.
- **OQ2 — skill name.** The ledger and the proposed file list use `sp:next-feature` as a placeholder;
  a rename is a find-and-replace, not a re-derivation. Not blocking.
### Design
**WHAT** — A build-vs-reuse ledger. Deliverable is three artifacts written into `### Solution`: a
**frontier-predicate ruling**, a **TABLE B boundary table**, and the **capability ledger**. No
production code ships from this ticket.

**WHY** — The prioritizer's most likely failure is not a wrong ranking; it is a second implementation
of traversal, filtering, and feature-level classification that then drifts from `sp:next-router`.
Two skills disagreeing about which feature is actionable is worse than either being imperfect alone.
This ledger bounds the implement tickets before they are written.

**WHERE** — Read-only across `plugins/sp/skills/next-router/**`, `plugins/sp/skills/conflict-finding/**`,
`plugins/sp/commands/dev-find-conflict.md`, `plugins/sp/commands/dev-next.md`, and `spur … --help`
output for the `feature`, `task`, and `status` nouns. Writes go **only** to this task's `### Solution`
/ `### Testing` sections.

**No new API.** Nothing is created or modified. Frozen output artifact shapes instead:

*Artifact A — frontier-predicate ruling.* A one-paragraph decision plus its drift-control mechanism:
does `sp:next-feature` cite `routing-table.md:83` as SSOT, or restate the predicate? If restated,
name the concrete mechanism keeping the two aligned (cross-reference, shared reference file, or a
test) — "be careful" is not a mechanism.

*Artifact B — TABLE B boundary table.* One row per routing-table row B4–B7, columns:
`row | what next-router says | what a which-feature-next answer would say | verdict (defer/restate/differs) | reason`.

*Artifact C — capability ledger.* One row per capability the prioritizer needs, columns:
`capability | verdict (reuse-as-is / compose / must-build) | evidence (file:line or spur verb)`.
A `must-build` row without evidence that no existing surface provides it is a defect in the ledger,
not a finding.

**Method — the reuse ladder, applied in order.** For each capability: (1) does an existing `spur`
verb produce it? (2) does an existing skill reference define it? (3) does composing two existing
surfaces produce it? Only then (4) must-build. Record which rung answered.

**Anti-patterns — do not implement these:**

- Marking a capability `must-build` without first checking `spur feature --help` / `spur task --help`
  for a verb that already produces it.
- Proposing that `sp:next-feature` copy routing-table's frontier predicate without naming what stops
  the copies from diverging.
- Designing the ranking rubric here — that is 0493's, and duplicating it creates two rubrics.
- Ruling on `/sp:dev-featurechange` or the restructure mapping schema — that is 0495's.
- Extracting the conflict-finding template as prose admiration rather than a concrete proposed file
  list for `plugins/sp/skills/next-feature/`.

**Frozen reference points (verified 2026-08-10):** `sp:conflict-finding` is 1411 lines —
`SKILL.md` 254, `authority-resolution.md` 258, `comparison-protocol.md` 277, `finding-contract.md`
346, `remediation-routing.md` 276. `plugins/sp/commands/dev-find-conflict.md` is a thin wrapper whose
Implementation section is a single `Skill(skill="sp:conflict-finding", args="$ARGUMENTS")` forward.
That two-layer shape — thin command, skill owns the protocol, references own the depth — is the
pattern R4 must map onto `sp:next-feature`.

**Handoff to dependents** — none consume this ticket directly. Its output bounds the graduated
implement tickets (currently fog on the map). **0495** independently owns the featurechange handoff;
this ticket must not pre-empt it.
### Plan
- [ ] Read `routing-table.md` §0 and rows B3–B7 in full; extract the frontier predicate verbatim and rule on cite-vs-restate with a named drift-control mechanism; write Artifact A (R1)
- [ ] Compare each of rows B4–B7 against what a which-feature-next answer would say for the same feature; assign defer / restate / differs with a reason; write Artifact B (R2)
- [ ] Enumerate the candidate signals from the map hypothesis and check each against `spur feature sync|refresh|check|list --json`, `spur task list --json`, and `spur status` for an existing producer (R3)
- [ ] Read `sp:conflict-finding` SKILL.md and its four references; classify each as pattern vs conflict-specific; propose the analogous reference file list for `plugins/sp/skills/next-feature/` (R4)
- [ ] Assemble the capability ledger, applying the reuse ladder in order and recording which rung answered each capability; write Artifact C (R5)
- [ ] Write Artifacts A/B/C into `### Solution` and verification notes into `### Testing` via `spur task update --section`

**Verification intent:** no code ships, so verification is evidential. Every ledger row cites a
repo-relative `file:line` or a runnable `spur` verb; every `must-build` row additionally states which
surfaces were checked and did not provide it. A row justified by prose alone fails R5.
### Solution

<!-- Final synthesized recommendation or output from the brainstorm. -->

### Testing

<!-- Validation performed for claims, links, or feasibility. Use N/A when not applicable. -->

### Review

<!-- Risks, open concerns, and follow-up review notes. -->

### References
- Map: [H12 Feature frontier prioritizer](../features/H12_feature-frontier-prioritizer-derived-importance-urgency-ranking-and-structure-defect-proposals.md)
- `plugins/sp/skills/next-router/references/routing-table.md:32` — the target-omitted non-route (the seam)
- `plugins/sp/skills/next-router/references/routing-table.md:83` — row B3, frontier predicate + WBS-ascending fallback (R1)
- `plugins/sp/skills/next-router/references/routing-table.md:84-87` — rows B4–B7, feature-level hygiene routes (R2)
- `plugins/sp/skills/next-router/SKILL.md` — driver protocol; the "never a second pipeline FSM" constraint this ticket generalises
- `plugins/sp/skills/conflict-finding/SKILL.md` (254 lines) + `references/authority-resolution.md` (258), `comparison-protocol.md` (277), `finding-contract.md` (346), `remediation-routing.md` (276) — the template, 1411 lines total (R4)
- `plugins/sp/commands/dev-find-conflict.md` — the thin-wrapper command shape (R4)
- `plugins/sp/commands/dev-next.md` — the sibling command surface and its flag table
- Sibling ticket: **0493** ranking-model spike — independent, no shared evidence
- Sibling ticket: **0495** owns `/sp:dev-featurechange` and the restructure mapping schema — out of scope here
### History
