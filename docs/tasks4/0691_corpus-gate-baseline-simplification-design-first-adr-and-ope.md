---
schema_version: 1
name: "Corpus gate & baseline simplification: design-first ADR and operator-gated implementation"
status: todo
template: feature-impl
created_at: 2026-08-27T20:16:10.884Z
updated_at: "2026-08-27T21:38:18.697Z"
feature_id: F94
priority: P1
---

## 0691. Corpus gate & baseline simplification: design-first ADR and operator-gated implementation

### Background
The corpus gate and `config/corpus-baseline.json` machinery is failing operationally. The dated
baseline stands at **1917 entries** (`config/corpus-baseline.json` `entries[]`, verified
2026-08-27). Three reconcile incidents occurred in the 0688 session alone (2026-08-27): an inverted
jq filter silently dropped the baseline **1907 → 18** entries (caught only by a 408-new-error gate
blowup); object-construction key loss truncated the file; both were hand-rolled jq on a policy file.
The recurring churn classes keep forcing reconcile: post-close checkbox flips rewriting history,
filing residue (**21** class entries filed for one single filing), and matcher-change fallout
forcing reconcile (the T10 same-commit rule).

The two-sided dated-baseline direction is not one ADR but a four-ADR chain: **ADR-050** (continuous,
unbypassable corpus gates — the two-sided baseline itself), **ADR-062** (every severity is ratcheted,
warnings included), **ADR-083** (the anchor-citation class frozen as a dated legacy set), and
**ADR-088** (the anchor-subject gate demoted to warning, reconciling two-sided). ADR-088 is the most
recent instance of the direction, not its founding decision.

Operator direction (2026-08-27): that direction is the **wrong direction** — simplify the gate and
baseline massively for reliability and efficiency. That direction message is the ADR-051 consent
evidence for any `task check` surface change. Absorbs F96 (claim-matcher subject association,
`status: cancelled` 2026-08-27): the simplification may delete the clause-window machinery rather
than refine it — the three dated residue entries 0607/0677/0670 are the evidence set (present in
`config/corpus-baseline.json`, verified 2026-08-27).
### Requirements

- [ ] R1. **ADR entry in `docs/00_ADR.md`** evaluating simplification options: e.g. drop
      dated-residue baselining entirely and gate only new findings against a committed snapshot;
      collapse superseded finding classes (testing-coverage successors, gate-language, readiness
      classes); single-sided vs two-sided tradeoffs; disposition of the claim-matcher
      clause-window machinery (F96 absorption).
- [ ] R2. **Design-first, operator-gated:** implementation waits for explicit operator approval
      of the ADR decision. Do NOT implement in this task's filing — the ADR decision gate comes
      first.
- [ ] R3. **Implement the approved option** once approved, removing the machinery it retires
      while the gate stays able to catch genuine regressions.
- [ ] R4. **Do not entrench:** any interim baseline reconcile stays minimal — this task's
      direction is simplification, not more dated-baseline machinery.

### Acceptance Criteria

- [ ] AC1. Given the simplification ADR entry in docs/00_ADR.md, when it is reviewed, then it evaluates the named options (drop dated-residue baselining / gate new-findings-vs-committed-snapshot, superseded-class collapse, single-sided vs two-sided) and records a recommendation.
- [ ] AC2. Given the operator approval gate, when implementation starts, then the ADR records the approval (ADR-051 consent evidence dated 2026-08-27).
- [ ] AC3. Given the approved option, when implementation lands, then the retired machinery is removed and the corpus gate still fails on genuine new findings.
- [ ] AC4. Given the F96 absorption, when the ADR decides the claim-matcher clause-window machinery's fate, then the decision is recorded with the 0607/0677/0670 residue as the evidence set.

### Q&A
- **Which ADR founds the direction being reversed?** Not ADR-088 alone. The chain is ADR-050
  (two-sided gate) → ADR-062 (every severity ratcheted) → ADR-083 (dated legacy set) → ADR-088
  (latest instance). Background corrected 2026-08-27; the new ADR supersedes as much of that chain
  as the chosen option requires, and must say which.
- **How many baseline entries are actually there?** 1917, not ~1928 (verified against
  `config/corpus-baseline.json` `entries[]`, 2026-08-27). Corrected in Background.
- **Is the implementation half in scope for this task?** Yes (R3), but strictly behind the operator
  approval gate (R2). The task is not "write an ADR"; it is "decide, get approval, then land it".
- **May the ADR pick an option outside A–D?** Yes — the option set is a floor, not a ceiling. It may
  not silently drop one: an option evaluated and rejected must say why.
- **Deferred:** the exact removal diff for the clause-window machinery. It depends on which option
  is approved, so it is deferred to step 5 with owner = this task's implementer.
### Design
**WHAT.** Author one ADR entry in `docs/00_ADR.md` that decides how the corpus gate and
`config/corpus-baseline.json` are simplified, then — only after explicit operator approval of the
chosen option — implement it. This task's deliverable up to the approval gate is the ADR entry
alone; no gate code, no baseline rewrite.

**WHY.** The two-sided dated baseline (ADR-050 → ADR-062 → ADR-083 → ADR-088) converts every matcher
change into a mandatory same-commit reconcile of a 1917-entry policy file, reconciled by hand-rolled
jq. The 0688 session produced three reconcile incidents in one sitting. The failure is not a bug in
any one matcher — it is the cost curve of the dated ratchet itself, which the operator ruled the
wrong direction on 2026-08-27.

**WHERE.**
- ADR entry: `docs/00_ADR.md` (next free `ADR-0NN`, appended in date order).
- Gate implementation surface (post-approval only): `packages/app` corpus-check services plus
  `scripts/commands/` corpus-check entry; `config/corpus-baseline.json` is data, not code.
- Constitution rule **T10** (`docs/99_PROJECT_CONSTITUTION.md`) is the same-commit reconcile
  obligation the simplification must explicitly keep, amend, or retire.

**Options the ADR must evaluate (the frozen option set — the ADR may add, never silently drop):**

| Option | Shape | Keeps | Costs |
| --- | --- | --- | --- |
| **A. Snapshot-diff** | Drop dated-residue baselining; gate only *new* findings against a committed snapshot of the previous run | Catches genuine regressions; no per-entry diagnosis obligation | Loses the per-entry reason/date audit trail |
| **B. Class collapse** | Keep two-sided, but collapse superseded finding classes (testing-coverage successors, gate-language, readiness) into single class keys | Smallest diff from today | Does not change the cost curve — reconcile churn stays |
| **C. Single-sided** | Gate on new findings only; a vanished entry no longer fails | Kills stale-entry reconcile, the dominant churn source | Reintroduces the silent-suppression risk ADR-050 exists to prevent |
| **D. Retire the baseline** | Delete `config/corpus-baseline.json`; corpus sweep becomes advisory-only | Zero reconcile cost | No gate force at all — rejected unless the ADR argues the sweep's value is reporting, not gating |

**Precedence.** Reliability > audit fidelity > diff size. An option that removes a whole failure
mode (C's stale-entry reconcile, A's per-entry diagnosis) beats an option that only shrinks the
current file (B).

**F96 disposition (absorbed).** The ADR must state whether the claim-matcher clause-window machinery
(`ANCHOR_WINDOW_LINES`, row-subject tokenization — ADR-088) is **deleted** or **retained** under the
chosen option, citing the 0607/0677/0670 dated residue as the evidence set. "Defer" is not a legal
answer: F96 was cancelled into this task precisely so the decision lands here.

**Anti-patterns (do NOT implement).**
- Do **not** add a `spur corpus reconcile` verb or any other new baseline-maintenance surface —
  F94's Scope names that explicitly out of scope, and it would entrench the machinery being retired.
- Do **not** add a new CLI noun; corpus validation stays `spur task check --corpus` (ADR-051 noun
  discipline, task 0502).
- Do **not** hand-roll jq over `config/corpus-baseline.json` again. Any interim edit goes through a
  script with a round-trip assertion on `entries.length`.
- Do **not** implement any option before the approval gate, even a "small obvious part" of it.

**Handoff to dependents.** Task **0694** (docs consolidation) depends on this task: its
verification-gate documentation must describe the gate as this ADR decides it, so 0694's gate-doc
half cannot start until the ADR is approved. 0694's symbol-anchor half is independent and may
proceed. State the approved option and its ADR number in this task's Solution so 0694 can cite it.
### Plan
- [ ] 1. Measure the current cost curve: `entries[]` count, distinct finding codes, and how many
      entries are dated residue vs live diagnoses (`config/corpus-baseline.json`). → R1 evidence.
- [ ] 2. Read the four-ADR chain (ADR-050, ADR-062, ADR-083, ADR-088) and constitution T10; record
      what each one would have to give up under each option. → R1.
- [ ] 3. Draft the ADR entry in `docs/00_ADR.md` evaluating options A–D with a recommendation,
      including the F96 clause-window disposition. → R1, AC1, AC4.
- [ ] 4. Present the ADR to the operator and record the approval verbatim in the ADR (ADR-051
      consent evidence, dated). **Stop here until approved.** → R2, AC2.
- [ ] 5. Implement the approved option: remove the retired machinery, keep the gate failing on
      genuine new findings. → R3, AC3.
- [ ] 6. Verify: run `bun run corpus-check` on a tree with a deliberately introduced new finding
      (must fail) and on a clean tree (must pass); confirm the retired machinery's code paths and
      config entries are gone, not merely unreferenced. → AC3.
- [ ] 7. Confirm no reconcile verb, no new CLI noun, and no new baseline-maintenance surface was
      added. → R4.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Parent feature: `docs/features/F94_pipeline-close-out-and-gate-friction-*.md` (R1)
- Absorbed feature: F96 `docs/features/F96_claim-matcher-subject-association-*.md` (`status: cancelled`, 2026-08-27)
- `docs/00_ADR.md` — ADR-050 (continuous unbypassable corpus gates), ADR-062 (every severity ratcheted), ADR-083 (dated legacy set), ADR-088 (anchor-subject gate demoted to warning), ADR-051 (surface consent gate)
- `docs/99_PROJECT_CONSTITUTION.md` — T10 same-commit reconcile obligation
- `config/corpus-baseline.json` — the policy file under review (1917 entries; its `note` field carries the per-code diagnoses)
- Dependent task: 0694 (docs consolidation — gate-doc half blocked on this ADR's approval)
- Sibling task: 0692 (close-out integrity — independent surface, same feature)
### History
