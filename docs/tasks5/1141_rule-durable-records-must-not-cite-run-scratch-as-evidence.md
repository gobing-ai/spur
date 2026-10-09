---
schema_version: 1
name: "Rule: durable records must not cite run scratch as evidence"
status: todo
template: standard
created_at: 2026-10-09T16:43:57.789Z
updated_at: "2026-10-09T18:08:18.475Z"
feature_id: E71

ac_numbering: task-local
ac_altitude: task-local
dependencies: ["1140"]
priority: P2
estimate_hours: 2
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

**Refine corrections (2026-10-09)**

- "seventeen task files" → 22 `done_reason` lines mention `.spur/run/`. 20 are verdict pointers, which 1140 retargets. 2 are spike-directory prose (0490, 0491), which is not evidence. The rule matches the verdict-pointer class only, so it stays green after 1140 without an allowlist.
- "joins the recommended pre-check preset" → that preset currently extends `typescript, structure, boundary, surface, ui, strict`; `docs` is temporarily removed (`config/rules/recommended-pre-check.yaml:9-11`). The rule therefore lives in `config/rules/structure/`, which the preset loads, not in `docs/`.
- "`.gitignore:133`" → verified: line 133 is `/.spur/run`.
- Feature: C (generic Rules root) → **E71**. The rule enforces ADR-131's consumer invariant, and E71 closes when that invariant is both migrated (1140) and enforced (this task).

### Requirements

- [ ] R1. A new rule file `config/rules/structure/scratch-evidence-pointer.yaml` with rule id `no-scratch-verdict-pointer` and severity `error`. Its `rg` evaluator uses the pattern `^done_reason:.*\.spur/run/[0-9]{4}(-|/)verdict\.json` over `docs/tasks*/**/*.md`. The description names the durable owner: `.spur/memory/evidence/<wbs>-verdict.json`, or the tracked Testing section, plus the repair command `spur task migrate-anchors --wbs <wbs>`.
- [ ] R2. The pattern is anchored to the `done_reason:` frontmatter key, so prose mentions of `.spur/run/` in any section, design doc or source file never match. No allowlist.
- [ ] R3. A two-sided e2e in `apps/cli/tests/commands/rule.test.ts` runs `spur rule run --file config/rules/structure/scratch-evidence-pointer.yaml --json` on a temp corpus with three cases. A task whose `done_reason` cites `.spur/run/0001-verdict.json` → 1 finding. A task whose pointer is `.spur/memory/evidence/0001-verdict.json` → 0 findings. A task with `.spur/run/0001-test-gate.status` only in its Testing body → 0 findings.
- [ ] R4. After 1140 lands, `spur rule run --preset recommended-pre-check --fail-on warning` reports 0 findings for this rule on this repository. Regenerate `apps/cli/tests/fixtures/raw-json-baseline/rule-validate-preset.json` in the same change, since the preset's resolved rule list grows.
- [ ] R5. The rule file's header comment states the class it cannot see: executable source under the gitignored `.spur/run/`. The header records that no hook or script loader registers from scratch (verified 2026-10-09, see 1145's cancellation), so no runtime guard is owed. It makes no claim to cover that class.

### Acceptance Criteria

```gherkin
Scenario: AC1 — a scratch verdict pointer in done_reason is rejected (req: R1, R3)
  Given a temp corpus task whose done_reason cites .spur/run/0001-verdict.json
  When `spur rule run --file config/rules/structure/scratch-evidence-pointer.yaml --json` runs
  Then one error finding names that file and line
  And the rule description names the durable owner and `spur task migrate-anchors`

Scenario: AC2 — a durable pointer passes (req: R1, R3)
  Given a task whose done_reason cites .spur/memory/evidence/0001-verdict.json
  When the rule runs
  Then no finding is reported for that file

Scenario: AC3 — a prose mention passes (req: R2, R3)
  Given a task whose Testing section mentions .spur/run/0001-test-gate.status and whose done_reason is durable
  When the rule runs
  Then no finding is reported for that file

Scenario: AC4 — the preset is green on the migrated repository (req: R4)
  Given this repository after task 1140 applied its migration
  When `spur rule run --preset recommended-pre-check --rule no-scratch-verdict-pointer --fail-on warning --json` runs
  Then it reports zero findings and exits 0
  And the raw-json-baseline rule-validate-preset fixture matches the regenerated output

Scenario: AC5 — the uncovered class is named (req: R5)
  Given config/rules/structure/scratch-evidence-pointer.yaml
  Then its header names gitignored executable source under .spur/run as out of scope and records that no loader registers from scratch
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

#### Q&A entry — 2026-10-09T17:58:36.577Z

- **Q: Which rule category?** A: `structure`. It is in the active pre-check preset; `docs` is temporarily excluded from the preset.
- **Q: Severity?** A: `error`. After 1140 the class has zero instances, so any hit is new drift. The pre-check gate runs `--fail-on warning`.
- **Q: Feature?** A: E71. ADR-131 enforcement belongs to its owning feature, not to the generic C root.

### Design

One YAML file, modeled on `config/rules/structure/test-focus-skip.yaml`:

```yaml
# ADR-131 consumer invariant: a task's done_reason must cite durable evidence, never run scratch.
# Out of scope: executable source under the gitignored .spur/run (the rule engine reads tracked
# files only) — no loader registers from scratch (1145 cancelled).
include:
  - "docs/tasks*/**/*.md"
rules:
  - id: no-scratch-verdict-pointer
    description: >
      done_reason cites a .spur/run verdict, which ADR-131 makes disposable. Cite
      .spur/memory/evidence/<wbs>-verdict.json or the tracked Testing section; repair with
      `spur task migrate-anchors --wbs <wbs>`.
    severity: error
    evaluator:
      type: rg
      config:
        pattern: "^done_reason:.*\\.spur/run/[0-9]{4}(-|/)verdict\\.json"
```

Validate with `spur rule validate config/rules/structure/scratch-evidence-pointer.yaml`. The rule is portable: `config/rules` is copied by `build:bundle`, so run `bun run --filter @gobing-ai/spur build:bundle`.

### Plan

1. Write the R3 e2e first: three fixture tasks in a temp dir. It fails while the rule file is absent.
2. Add the rule YAML. Run `spur rule validate` on it.
3. Run the e2e, then on the repository `spur rule run --preset recommended-pre-check --rule no-scratch-verdict-pointer --json`. Expect 0 findings; this requires 1140 to have landed.
4. Regenerate the raw-json-baseline `rule-validate-preset.json` fixture and run `build:bundle`.
5. `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- ADR-131 amendment (2026-10-09); `config/rules/recommended-pre-check.yaml`; `config/rules/structure/test-focus-skip.yaml` (pattern).
- Depends on 1140 (migrates the existing class). Executable-source class: no owner needed (1145 cancelled, premise invalid).

### History

- 2026-10-09T16:44:18.234Z backlog → todo (system)

