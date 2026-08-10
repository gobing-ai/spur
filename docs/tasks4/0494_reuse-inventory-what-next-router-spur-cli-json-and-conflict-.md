---
template: brainstorm
schema_version: 1
name: "Reuse inventory: what next-router, spur CLI --json, and conflict-finding already provide that dev-find-next must compose rather than rebuild"
description: ""
status: done
type: brainstorm
profile: standard
feature_id: H12
parent_wbs: null
priority: P2
tags: []
dependencies: []
ac_numbering: task-local
created_at: "2026-08-10T00:45:45.534Z"
updated_at: "2026-08-10T04:25:55.831Z"
done_forced: "true"
done_reason: "Wayfinder research ticket (reuse inventory): corpus-only investigation, no code diff — same class as siblings 0493/0495. Structural gate PASS; Review L3 findings table populated; verdict .spur/run/0494-verdict.json PASS (R1-R5 MET). Provenance override recorded per CLI guidance."
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
- [x] Read `routing-table.md` §0 and rows B3–B7 in full; extract the frontier predicate verbatim and rule on cite-vs-restate with a named drift-control mechanism; write Artifact A (R1)
- [x] Compare each of rows B4–B7 against what a which-feature-next answer would say for the same feature; assign defer / restate / differs with a reason; write Artifact B (R2)
- [x] Enumerate the candidate signals from the map hypothesis and check each against `spur feature sync|refresh|check|list --json`, `spur task list --json`, and `spur status` for an existing producer (R3)
- [x] Read `sp:conflict-finding` SKILL.md and its four references; classify each as pattern vs conflict-specific; propose the analogous reference file list for `plugins/sp/skills/next-feature/` (R4)
- [x] Assemble the capability ledger, applying the reuse ladder in order and recording which rung answered each capability; write Artifact C (R5)
- [x] Write Artifacts A/B/C into `### Solution` and verification notes into `### Testing` via `spur task update --section`

**Verification intent:** no code ships, so verification is evidential. Every ledger row cites a
repo-relative `file:line` or a runnable `spur` verb; every `must-build` row additionally states which
surfaces were checked and did not provide it. A row justified by prose alone fails R5.
### Solution
**Inventory resolved 2026-08-10** — wayfinder research ticket, branch `wayfind/0495-structure-defect`. Read-only across next-router, conflict-finding, and the spur CLI help surface. No code ships; the deliverable is the build-vs-reuse ledger that bounds the graduated implement ticket. OQ1 (dispatch vs report) is unresolved — the ledger enumerates both readings and marks dispatch-only rows conditional, per the Q&A.

---

**Artifact A — frontier-predicate ruling (R1).**

**Ruling: CITE, never restate.** `sp:next-feature` treats `plugins/sp/skills/next-router/references/routing-table.md:83` (row B3) as the SSOT for "actionable" and contains **no paraphrase** of the predicate.

**Drift-control mechanism — runtime indirection, not vigilance:** the skill's signal-derivation reference carries a one-line pointer — *"Actionability predicate: read `plugins/sp/skills/next-router/references/routing-table.md` row B3 at execution time; this skill intentionally does not copy it."* Because the prompt-first skill instructs the executing agent to **re-read the row at runtime**, there is exactly one definition of the predicate in the repo and no copy to drift. A copied prose predicate was the only alternative and is rejected: two disagreeing definitions of "actionable" is worse than one imperfect one (the ticket's own framing). The residual risk — B3's row number shifting — is accepted: the pointer names the row **by label (B3) and by content ("frontier = open ∧ unblocked")**, not by line number alone.

---

**Artifact B — TABLE B boundary table (R2).**

One row per routing-table row B4–B7 (`plugins/sp/skills/next-router/references/routing-table.md:84-87`). All four fire on `frontier tasks == 0`; dev-find-next's ranking operates on the post-gate frontier, so the surfaces are near-disjoint. The load-bearing rule: **dev-find-next reports and ranks; it never dispatches a `/sp:dev-*` verb that next-router owns.**

| Row | What next-router says | What a which-feature-next answer says about the same feature | Verdict | Reason |
|---|---|---|---|---|
| **B4** (`:84`) — no frontier tasks, backlog, AC invalid → STOP, suggest `/sp:dev-plan` | Routes to planning | "Not rankable — most valuable to *specify* next" (0493 AC-coverage signal, zero-scenario case) | **DEFER** | Same fact, two audiences. next-router owns the route; dev-find-next excludes the feature from the ranked frontier with reason "AC invalid — B4 territory". No second router: the verb suggestion prints only as next-router's own output would, cited as B4. |
| **B5** (`:85`) — no frontier tasks, valid AC, zero tasks → STOP, suggest `/sp:dev-plan` | Routes to decomposition | "Not rankable — specified but not decomposed" | **DEFER** | Same shape as B4: a decomposition gap, reported as a gating reason, never re-routed. |
| **B6** (`:86`) — all child tasks done, feature active/verifying → `/sp:dev-wrapall` | Routes to wrap | **Urgency evidence**: a stale-done feature in `active`/`verifying` is exactly the status-drift defect 0493 Artifact A measured (24 of 25 drift) | **BOTH** | dev-find-next's sync-first precondition (0493's headline finding) *detects* the same condition as drift evidence; next-router owns the `/sp:dev-wrapall` *dispatch*. De-dup rule: dev-find-next says "would advance to done on sync"; the wrap route is expressed only as a citation of B6, never as a second dispatch path. |
| **B7** (`:87`) — mixed cancelled/done only → STOP, manual status update | Routes to manual hygiene | Nothing — cancelled work is excluded from the frontier by the actionability gate | **DEFER** | No corrupting path to a ranking signal; next-router speaks alone. |

**De-duplication invariant:** B4–B7 fire when `frontier tasks == 0`; dev-find-next's rubric fires only on features that *pass* the gate, and its sync precondition *reports* B6-shaped drift without dispatching. One surface speaks per feature.

---

**Artifact C — capability ledger (R3, R5).**

Reuse ladder applied in order: (1) existing `spur` verb → (2) existing skill reference → (3) composition → (4) must-build. The rung that answered is recorded per row. Candidate signals are 0493's measured set: the four survivors (AC coverage, churn exposure, dogfood proximity, authority pull) plus the sync precondition and actionability gate that frame them.

| Capability | Verdict | Rung | Evidence |
|---|---|---|---|
| Read the feature corpus (id, status, priority, tags, timestamps) | **reuse-as-is** | 1 | `spur feature list --json` — carries `id`, `status`, `priority`, `frontmatter.tags`, `created_at`/`updated_at` (verified this session) |
| Status-drift detection (sync precondition) | **reuse-as-is** | 1 | `spur feature sync --all --dry-run --json` — per-feature `proposal.from/to` (re-run this session: 26 proposals) |
| Linked-task roster per feature | **reuse-as-is** | 1 | `spur task list --feature <id> --json` — `wbs`, `status`, `dependencies` per task |
| Actionability gate (B3 predicate) | **compose** | 2+1 | Predicate **cited** from `plugins/sp/skills/next-router/references/routing-table.md:83` at runtime (Artifact A ruling); inputs from `spur task list --feature <id> --json` |
| AC validity / check cleanliness | **reuse-as-is** | 1 | `spur feature check <id> --json` — L4 findings incl. uncovered/invalid AC |
| AC coverage signal (scenario count) | **compose** | 3 | `spur feature show <id> --json` → body `Scenario:` count. No verb emits the count; `check` emits validity, not spread. Composition of one verb + one grep, not new logic |
| Churn exposure signal | **must-build** | 4 | `git rev-list --count --since=<40d> HEAD -- <feature file scope>`. Checked and absent: `spur feature --help` (no churn verb), `spur status` (project/git summary, no per-feature churn), `spur history` (agent-session history, not git churn). Prompt-side derivation, no new TypeScript |
| Dogfood proximity signal | **must-build** | 4 | `rg` for `plugins/sp` / `apps/cli` / `task-pipeline` / `sp:` in feature + child-task bodies. No spur verb produces contact counts (`spur feature --help`, `spur status --help` checked) |
| Authority pull signal | **must-build** | 4 | `rg <feature-id> docs/02_ROADMAP.md docs/00_ADR.md`. Authority docs are markdown; no verb indexes mentions |
| Tiered ranking + evidence-per-candidate report | **must-build** | 4 | The rubric itself — 0493's deliverable (Eisenhower-style ordinal tiers, no numeric scores). This is the command's payload; nothing existing produces an ordering (routing-table B3 falls back to WBS-ascending, `plugins/sp/skills/next-router/references/routing-table.md:83`) |
| Structure-defect proposals (D1–D4) | **compose** | 2+3 | Contract authored by 0495 (Artifacts A/C); schema reused from `docs/plans/feature-tree-restructure-map.md:10`; inputs from `spur feature list --json` + task rosters. No new detection machinery beyond the contract |
| Proposal handoff to `/sp:dev-featurechange` | **reuse-as-is** | 2 | 0495 Artifact C: emit rows conforming to the map schema (inline print or `docs/plans/` append per OQ1); featurechange `--dry-run` → confirm → apply is the sole mutation path (`plugins/sp/commands/dev-featurechange.md:87`) |
| Dispatch into `/sp:dev-next` on the winner | **reuse-as-is — CONDITIONAL on OQ1** | 2 | next-router owns within-target routing (`plugins/sp/skills/next-router/references/routing-table.md:25-40`, §0 step 1). Only exists in the dispatch reading of OQ1; the report reading omits this row entirely |
| Feature-tree structure (parent/child) | **reuse-as-is** | 1 | DD-14 id hierarchy in `spur feature list --json` ids; child-count derivable by id prefix. No traversal code needed |

Every `must-build` row names the surfaces checked and found wanting (`spur feature --help`, `spur status --help`, `spur history`); none duplicates an existing producer. The three must-builds are all prompt-side derivations over `git`/`rg` — consistent with the prompt-first standing preference, no new TypeScript anywhere.

---

**R4 — template extraction (pattern vs conflict-specific).**

`sp:conflict-finding` = 1411 lines: `SKILL.md` (254) + four references. Classification:

| File | Lines | Pattern or conflict-specific | Carries over to `sp:next-feature` as |
|---|---|---|---|
| `SKILL.md` | 254 | **Pattern** (structure): frontmatter shape (platforms, category, pipeline_steps, see_also), honesty contract ("prompt-first, no TypeScript analyzer"), When to Use / Do NOT use, mode sections | `SKILL.md` skeleton — same shape, ranking content |
| `references/authority-resolution.md` | 258 | **Conflict-specific**: claim-specific authority across four pillars has no ranking analog | Nothing directly; its *role* (where answers come from) maps to signal provenance inside signal-derivation.md |
| `references/comparison-protocol.md` | 277 | **Pattern** (role): the operating protocol with token controls — inventories first, then compare | `references/signal-derivation.md` — per-signal derivation commands + degenerate-spread rejection rule (0493 Artifact B) |
| `references/finding-contract.md` | 346 | **Pattern**: evidence bar, mandatory `false_positive_check` (`:100`), two-opposing-anchors (`:153`), result envelope | `references/proposal-contract.md` — 0495's D1–D4 contract + candidate/evidence envelope (already authored to this bar) |
| `references/remediation-routing.md` | 276 | **Pattern**: confirmed, owner-routed outputs — never self-apply | `references/handoff-routing.md` — featurechange handoff (0495 Artifact C), next-router seam, OQ1 conditional dispatch |

**Proposed `plugins/sp/skills/next-feature/` file list:** `SKILL.md` + `references/signal-derivation.md`, `references/ranking-rubric.md`, `references/proposal-contract.md`, `references/handoff-routing.md`. Four references mirroring conflict-finding's split: derivation / rubric / contract / routing. (`ranking-rubric.md` has no single conflict-finding analog — it carries 0493's tiered rubric, the command's payload.) Plus the thin wrapper `plugins/sp/commands/dev-find-next.md` forwarding `$ARGUMENTS`, mirroring `dev-find-conflict.md`'s single `Skill()` forward.

**Handoff:** this ledger + file list bound the graduated implement ticket (map "Not yet specified" → now specified). The implement ticket composes: it writes 5 markdown files + 1 command + README/04_DESIGN entries and no TypeScript.
### Testing
**Evidential verification — no code ships from this ticket (per Design).** Every ledger row cites a verb run this session or a `file:line` re-read this session (2026-08-10, branch `wayfind/0495-structure-defect`).

| Claim | Verification | Result |
|---|---|---|
| B3 predicate exists at `plugins/sp/skills/next-router/references/routing-table.md:83` with WBS-ascending fallback | `sed -n '83p'` — "Frontier = open … unblocked … prefer WBS-ascending" | Exact |
| B4–B7 at `plugins/sp/skills/next-router/references/routing-table.md:84-87`, all fire on `frontier tasks == 0` | `sed -n '84,87p'` — B4 dev-plan / B5 dev-plan / B6 dev-wrapall / B7 manual | Exact |
| Target-omitted non-route (the seam) | `sed -n '32p'` — "Omitted → NOT v1 (see Non-routes); stop with usage" | Exact |
| `spur feature list --json` carries id/status/priority/tags/timestamps | run this session; keys: `filePath, frontmatter, id, name, priority, status` | Reproduced |
| `spur feature sync --all --dry-run --json` emits per-feature proposals | run this session; 26 proposals, `proposal.featureId/from/to` | Reproduced |
| `spur feature check <id> --json` emits L4 findings | run on H12 this session; 6× `L4.uncovered-feature-scenario` | Reproduced |
| No churn/dogfood/authority verb exists | `spur feature --help`, `spur status --help` read; `spur history` = agent-session history | Checked and absent — must-build rows justified |
| conflict-finding = 1411 lines (254/258/277/346/276) | `wc -l` on SKILL.md + 4 references | Exact |
| `dev-find-conflict.md` is a thin wrapper | read in full — single `Skill(skill="sp:conflict-finding", args="$ARGUMENTS")` forward | Exact |
| Mapping schema for the compose rows | `docs/plans/feature-tree-restructure-map.md:10` (`## Schema`), `:15` dispositions | Re-read exact (0495 re-audit, same session) |
| featurechange is sole mutation path | `plugins/sp/commands/dev-featurechange.md:87` "Apply (CLI only)", `:89` forbidden raw writes | Re-read exact |

**0493 dependency note:** R3's ledger uses the map's candidate-signal list per the Q&A (independence), cross-checked against 0493's *measured* results this session: 0493's edge-count correction (verifyall re-audit) does not touch the ledger — the rejected fan-out signal has no ledger row, and the four surviving signals map to rows exactly.

Coverage: N/A (research inventory; no runtime code path added).
### Review
| Priority | Severity | File | Finding | Recommendation |
|---|---|---|---|---|
| P2 | major | `docs/tasks4/0494_*.md` Artifact A | Cite-not-restate ruling's residual risk: the runtime pointer names B3 by label + content, but a routing-table rewrite that renames the row would silently break the indirection. | Accepted — pointer carries the predicate's content description ("frontier = open ∧ unblocked") as the fallback key; a rename is a find-and-repair, not silent drift. |
| P3 | minor | `docs/tasks4/0494_*.md` Artifact C | OQ1 (dispatch vs report) unresolved: the ledger's dispatch row is conditional; the implement ticket must not build argv-shaping until the operator rules. | Implement ticket builds the report reading first; dispatch row activates only on operator decision. |
| P4 | advisory | `docs/tasks4/0494_*.md` Artifact C | Three must-build rows are prompt-side `git`/`rg` derivations; spread thresholds (e.g. churn window 40d) are 0493's measured defaults, not validated constants. | Ship with 0493's values; tune on dogfood. |
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
- 2026-08-10T04:24:57.203Z todo → wip (system)
- 2026-08-10T04:24:57.631Z wip → testing (system)
- 2026-08-10T04:25:55.816Z testing → done (system)
