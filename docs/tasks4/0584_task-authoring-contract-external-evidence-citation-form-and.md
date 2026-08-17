---
template: feature-impl
schema_version: 1
name: "Task authoring contract: external-evidence citation form and AC-altitude declaration"
description: ""
status: todo
type: task
profile: standard
feature_id: F91
parent_wbs: null
priority: P1
tags: ["corpus", "gate", "docs"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-17T22:18:51.234Z"
updated_at: "2026-08-17T23:06:23.132Z"
---

## 0584. Task authoring contract: external-evidence citation form and AC-altitude declaration

### Background
Two gate rules are unsatisfiable today, for the same underlying reason: **the corpus contract has no
way for a task to declare what kind of thing it is saying**, so the checker assumes, and the
assumption is wrong for a large minority of tasks. Both decisions are authoring-contract decisions
about the same object — what a task file is allowed to assert — so they are decided together, once.

**External evidence has no legal spelling.** `extractBacktickLineAnchors`
(`packages/app/src/services/task-check.ts:207`) matches any backticked `path:line`, and
`checkLineAnchors` resolves it from **this** repo's root. That is the only notation the contract
defines, so evidence that does not live here has nowhere valid to go. Of 851
`L4.stale-line-anchor` warnings measured 2026-08-17, **244 are genuinely external** —
`@gobing-ai/ts-llm-jsonl-importer` sources under `~/xprojects/ts-libs`, and gitignored
`.spur/run/**` artifacts. Task 0564 alone carried ten no repair could clear. Worse, the anchor form
actively hid drift: spot-checking 0564's importer citations against the real ts-libs tree found two
that had drifted **there** too (`mappers.ts:418` → 481-483; `mappers.ts:483` → 546). The notation
asserted a false location *and* the wrong line.

**AC altitude is assumed, not declared.** `checkAcCoverage`
(`packages/domain/src/bdd/coverage.ts:74`) requires every task Gherkin title to be a
normalized-title subset of its linked feature's AC. That holds for a task that *graduates* a feature
scenario — E5's 0553–0556 mirror E5 R1–R7 exactly and warn zero. It is unsatisfiable for a task
whose criteria sit at a finer altitude: a fix task's per-defect regression criteria are not, and
should not be, the feature's ship contract. Measured 2026-08-17: **619** warnings across **57
tasks**. Task 0564 carried 11 that were cleared only by rewriting its Gherkin into AC bullets,
because bullets are invisible to the rule — the corpus teaching authors to evade the gate by
switching notation, which is worse than the warning.
### Requirements
- [ ] **R1.** `checkLineAnchors` recognizes the frozen external-evidence form (named origin + backticked path + line number outside the backticks) and records it as external, never emitting `L4.stale-line-anchor` for it. Measurable: the 244 citations classified external today produce zero stale-anchor findings after reconciliation.
- [ ] **R2.** A repo-relative anchor stays required for in-repo evidence: a bare basename that resolves uniquely inside the repository is **not** eligible for the external form and still reports. Measurable: a test asserts a uniquely-resolvable basename in external form still produces a finding.
- [ ] **R3.** `ac_altitude: graduating | task-local` exists on the task frontmatter schema; `checkAcCoverage` enforces the DD-09 subset rule for `graduating` and skips it for `task-local`. Measurable: the 57 tasks currently reporting `L4.uncovered-task-scenario` report none once declared `task-local`.
- [ ] **R4.** The altitude is read **only** from the declared field — never inferred from `template`, `status`, or whether the AC uses Gherkin. Measurable: a `task-local` task written in Gherkin and a `graduating` task written in bullets each behave per their field, asserted by test.
- [ ] **R5.** A `graduating` task whose scenario titles drift from its feature's is still reported. Measurable: a test asserts a drifted title on a `graduating` task still yields `L4.uncovered-task-scenario`.
- [ ] **R6.** Both contracts are taught where authors read them — `sp:code-verification`, `cross-cutting.md`, `ac-style-guide.md`, `docs/04_DESIGN.md` — in the same commit (constitution T3). Measurable: each names the frozen form/field and when to use it.

**Out of scope / non-goals:** promoting any finding to error severity (task 0583 owns the
warning→error promotion); the anchor-qualification migration (0583); reconciling the warning
baseline (0582); any change to `--strict-core` `testing → done` gate layers.
### Acceptance Criteria
```gherkin
Scenario: R3 — Evidence outside the repository has a legal citation form
  Given verification evidence that lives outside this repository
  When it is cited in the documented external-evidence form
  Then the checker records it as external rather than as a stale repo-root anchor
  And a repo-relative path is still required for evidence that lives in this repository

Scenario: R6 — A task declares its AC altitude instead of having one assumed
  Given a task whose acceptance criteria are finer-grained than its feature's ship contract
  When spur task check runs
  Then no uncovered-scenario finding is raised for that task
  And a task that does graduate its feature's scenarios is still held to the DD-09 subset rule
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
**Both decisions are FROZEN (operator, 2026-08-17). No open questions remain; implement as written.**

**Decision 1 — external evidence uses a non-anchor prose form.** Frozen shape: a named origin plus
a backticked path with the line number **outside** the backticks.

```
Evidence: @gobing-ai/ts-llm-jsonl-importer `src/mappers.ts` line 481 — omp call_id write
```

`extractBacktickLineAnchors` (`packages/app/src/services/task-check.ts:207`) must not match it —
its regex requires the line number inside the backticks (`` `path:NN` ``), so this form is already
invisible to it. The work is therefore **classification, not parsing**: recognize the form, record
it as external evidence, and never emit `L4.stale-line-anchor` for it.

*Rejected:* a package-qualified anchor resolved via `node_modules`. Verifiable only when the package
happens to be installed, so the same corpus yields different verdicts on different machines — the
failure mode that gets gates disabled. And the 2026-08-17 audit showed a resolvable external anchor
still drifts silently: 0564 cited `mappers.ts:418` for the omp `call_id` write, which actually sits
at line 481. Verifiability we cannot maintain is worse than an honest unverifiable citation.

**Decision 2 — AC altitude is a frontmatter field.** Frozen name and vocabulary:

```yaml
ac_altitude: graduating | task-local
```

Declared at `packages/domain/src/planning/schema.ts:288`, directly beside the existing
`ac_numbering: z.literal('task-local').optional()` — the closest sibling concept, kept in one place.
`graduating` enforces the DD-09 subset rule; `task-local` skips it. **Optional with no default**, and
an absent field keeps today's behavior (rule enforced), so no existing task changes meaning
silently.

*Rejected:* a marker inside the AC body. Not machine-readable from `task show --json`, not
schema-validated, and it puts a traceability contract in prose — the same class of mistake as
letting notation choice decide whether a rule applies.

**Anti-patterns — do not implement.** Do not default new tasks to `task-local` (silently disables
DD-09 corpus-wide). Do not key altitude off `template`, `status`, or the presence of a Gherkin block
— inference is exactly what let notation-switching evade the gate (R4). Do not silently downgrade
unresolvable anchors to informational, which deletes the signal instead of routing it. Do not
resolve external paths by scanning the filesystem outside the repo root.

**File targets.** `packages/domain/src/planning/schema.ts` (field); `packages/domain/src/bdd/coverage.ts`
(`checkAcCoverage` gains the altitude parameter); `packages/app/src/services/task-check.ts`
(external-form classification in `checkLineAnchors`, altitude threaded into the DD-09 call);
authoring guidance in `plugins/sp/skills/code-verification/SKILL.md`,
`plugins/sp/skills/spur-dev/references/cross-cutting.md`,
`plugins/sp/skills/spur-dev/references/ac-style-guide.md`, and `docs/04_DESIGN.md` §7.1/§7.3.

**Cross-task.** No dependencies. **Leaves for task 0583:** the external-evidence classifier must
land before 0583's subject-matching rule runs, or all 244 external citations become false positives;
0583 consumes the classification and must not re-implement or re-interpret it.
### Plan
- [ ] Add `ac_altitude` to the task frontmatter schema beside `ac_numbering`, optional, no default (R3)
- [ ] Thread altitude into `checkAcCoverage` so `graduating` enforces DD-09 and `task-local` skips it (R3, R4)
- [ ] Assert the field is the only altitude input — Gherkin/bullets and template must not change behavior (R4)
- [ ] Keep the subset rule fully enforced for `graduating`, including drifted titles (R5)
- [ ] Classify the frozen external-evidence form in `checkLineAnchors` as external, not stale (R1)
- [ ] Keep a uniquely-resolvable in-repo basename ineligible for the external form (R2)
- [ ] Reconcile the 244 external citations to the frozen form and declare the 57 altitude tasks honestly (R1, R3)
- [ ] Document both contracts in the four authoring surfaces; run `bun run lint` / `test` / `build` (R6)
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- **ADR-062** — Corpus Gates Verify Evidence Content, and Every Severity Is Ratcheted (`docs/00_ADR.md`) — the decision record for this feature.
- **ADR-050** — the two-sided error baseline this work extends.
- **ADR-058** — tracked transition shims: the warning-first-then-tighten precedent and the two-sided manifest shape.
- **ADR-063** — top-level feature-node consent (why this feature lives at F91, not a root letter).
- **Feature F91** — `docs/features/F91_*.md`; parent **F9** owns `checkAcCoverage`, the stable finding codes, and the severity-override map this work builds on.
- **Origin audit** — the 2026-08-17 E5 re-audit (`/sp:dev-verifyall --feature E5 --force --fix all`) that surfaced all four root causes; tasks 0553/0554/0555/0564 carry the repaired citations.
### History
