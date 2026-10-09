---
schema_version: 1
name: "Rule: durable records must not cite run scratch as evidence"
status: todo
template: standard
created_at: 2026-10-09T16:43:57.789Z
updated_at: "2026-10-09T16:44:18.234Z"
feature_id: C

ac_numbering: task-local
ac_altitude: task-local
dependencies: ["1140"]
---

## 1141. Rule: durable records must not cite run scratch as evidence

### Background

ADR-131 (as amended 2026-10-09) states the consumer invariant for run scratch: `.spur/run/` may be
absent in any later run, so no tracked source file, document or task record may rely on it, and a
durable citation names `.spur/memory/evidence/`, `.spur/memory/runs/` or the tracked task Testing
section.

The amendment is prose. Nothing enforces it, and the corpus already drifted once: seventeen task
files cite a `.spur/run/<wbs>-verdict.json` path in `done_reason` while seventy-one others name the
durable owner. Task 1140 retires that existing class; this task stops the class from returning.

The rule must be precise. Six hundred and six tracked documents mention `.spur/run/`, and most of
those mentions are legitimate: they document what the pipeline writes there, which is the mechanism
the ADR governs. A rule that matches every occurrence would flag mechanism documentation as a
violation and train readers to suppress it. The invariant binds citations of record — the metadata
pointer a consumer resolves later — so the rule scopes to that pointer field rather than to the
directory string in general.

### Requirements

- [ ] R1. A constraint rule rejects a tracked task file whose `done_reason` frontmatter value cites a `.spur/run/` evidence path, reporting the file, the offending pointer, and the durable owner that should be named instead. The rule joins the recommended pre-check preset so the corpus is checked at the existing cheap tier.
- [ ] R2. The rule does not fire on legitimate scratch descriptions: a prose mention of `.spur/run/` inside a task section, a design document describing where the pipeline writes, or a runtime code path that reads or writes scratch all pass. Precision comes from scoping to the metadata pointer field, not from an allowlist of permitted documents.
- [ ] R3. The rule is two-sided on a fixture in the rule's own smoke test: a fixture task whose `done_reason` cites `.spur/run/<wbs>-verdict.json` FAILS with the durable owner named, and a fixture whose `done_reason` cites `.spur/memory/evidence/<wbs>-verdict.json` PASSES, as does a fixture that mentions `.spur/run/` only in prose.
- [ ] R4. `spur rule run --preset recommended-pre-check` reports the corpus clean once task 1140 has migrated the existing pointers, and the rule run's own smoke result is recorded in this task's Testing. A rule that makes the preset red on the pre-migration corpus is not acceptable output for this task.
- [ ] R5. The task states the class it cannot cover and why: executable source under `.spur/run/` is outside any corpus rule because the directory is gitignored (`.gitignore:133`), so that case belongs to a runtime guard on hook and script registration rather than to a ripgrep or regex evaluator. It is named here and deferred, not silently dropped.

### Acceptance Criteria

```gherkin
Scenario: AC1 — a scratch pointer in done_reason is rejected (req: R1, R3)
  Given a task file whose done_reason cites `.spur/run/<wbs>-verdict.json`
  When the rule runs against the corpus
  Then it reports a violation naming the file, the pointer, and the durable evidence owner

Scenario: AC2 — a durable pointer passes (req: R1, R3)
  Given a task file whose done_reason cites `.spur/memory/evidence/<wbs>-verdict.json`
  When the rule runs
  Then no violation is reported for that file

Scenario: AC3 — a prose mention passes (req: R2, R3)
  Given a task file whose Testing section describes `.spur/run/<wbs>-test-gate.status` as pipeline output
  And whose done_reason names the durable owner
  When the rule runs
  Then no violation is reported for that file

Scenario: AC4 — the preset stays green after the migration (req: R4)
  Given the corpus after task 1140 has retargeted the existing pointers
  When `spur rule run --preset recommended-pre-check --fail-on warning` runs
  Then the preset reports no violations

Scenario: AC5 — the uncovered class is named, not implied (req: R5)
  Given the rule's documentation and this task's Design section
  Then the gitignored executable-source case is stated as out of scope with its proper owner
  And no rule claims to cover it
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-09T16:44:06.781Z

- **Why a rule rather than a check inside `spur task check`?** The warning tier already exists for
  corpus shape, and this invariant is corpus shape. A rule keeps the check declarative, testable in
  the rule engine's own smoke harness, and tunable by preset membership, which a hardcoded check
  cannot offer.
- **Why scope to `done_reason` when the ADR names Testing evidence and review pointers too?** Those
  fields are free prose today, and a matcher for them would need a citation grammar that does not
  exist. `done_reason` is the one machine-consumed pointer with a fixed shape, so the rule starts
  where precision is provable. Widening it is a later, separate decision with its own evidence.
- **What happens if a legitimate carve-out appears?** Preset membership and the rule's own `exclude`
  configuration are the tuning surfaces; an allowlist of documents is explicitly not, because it
  hides new violations in the same file class.
- **Deferred, with owner named:** the executable-source case under `.spur/run/` (a runtime guard on
  hook/script registration, not a corpus rule), and any rule for Testing or review pointer fields
  until a citation grammar exists for them.

### Design

**Rule home and evaluator.** A rule file in the docs corpus family under `config/rules/`, using the
existing regex or ripgrep evaluator scoped to `docs/tasks*/**/*.md`, matching the frontmatter pointer
form (`done_reason` naming a `.spur/run/` path). Authoring follows the rule-authoring path: schema,
fixture, `spur rule run` smoke in both directions, then preset membership. No new evaluator kind and
no engine change.

**Why the field scope carries the precision.** The rule's discriminator is the field, not the string.
`done_reason` is a durable citation that a consumer resolves later (F93 reads it), so a scratch value
there is unambiguously wrong. A `.spur/run/` string in a section body is mechanism documentation and
stays legal. This keeps the rule at zero false positives on the current corpus, which is a
precondition for `--fail-on warning` preset membership: a rule that must be suppressed to pass is
worse than no rule.

**Rejected alternative.** Matching every `.spur/run/` occurrence with a document allowlist. It would
flag six hundred and six documents on day one, require a growing allowlist, and invert the intent —
the invariant constrains citations, not vocabulary.

**Relationship to the amended ADR.** The ADR states the invariant; this rule is its enforcement, and
task 1140 is its one-time cleanup. The three belong to one boundary: ADR-131 (as amended), 1140
(migration), this task (guard). The `cited-directory:` persist-out skip vocabulary is untouched and
remains compatibility for citations inside task bodies.

**Impacted surfaces.** One rule file under `config/rules/`, its fixture, and the preset membership
list. No CLI, schema or contract change. The rule must pass the same admission and smoke bar as any
other preset member, and the preset is the published contract, so its membership change is recorded
in the rule's own task evidence.

### Plan

1. Read an existing preset rule in the docs family and the rule-file schema; copy the structure
   rather than inventing one.
2. Write the fixture pair first (scratch pointer, durable pointer) plus the prose-mention case, and
   confirm the rule body FAILS both the scratch fixture and the prose case before the matcher is
   right — red before green.
3. Implement the rule with the field-scoped matcher and the violation message naming the durable
   owner.
4. Run `spur rule run` against the fixture and the real corpus; confirm zero violations on prose and
   one violation per scratch pointer.
5. Add the rule to `recommended-pre-check` and run the full preset with `--fail-on warning`.
6. Record the smoke output and the preset result in Testing; confirm the corpus is clean after task
   1140 lands, or report the task ordering dependency if 1140 has not landed yet.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-10-09T16:44:18.234Z backlog → todo (system)

