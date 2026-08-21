---
schema_version: 1
name: "Add --fix to spur task check and spur feature check for structural repairs"
status: todo
template: feature-impl
created_at: 2026-08-20T23:18:21.582Z
updated_at: "2026-08-20T23:18:38.576Z"
feature_id: A3
priority: P1
dependencies: ["0613", "0618"]
---

## 0619. Add --fix to spur task check and spur feature check for structural repairs

### Background

`spur task check` and `spur feature check` report structural findings — missing, mis-levelled, or
mis-ordered section headings, and R-items written without the checkbox marker — but every repair is
manual today, which is why the corpus accumulates them and why `spur task check --corpus` has a
baseline of known errors.

The repair scope has a hard ceiling that must be designed in rather than discovered: there is
deliberately no section-delete verb, so `--fix` can add and reshape headings but cannot remove an
off-variant section. And a section body is content the check has no authority to author — repairing
"Design is empty" by writing a Design would be the tool inventing spec.

Both verbs share one repair engine; splitting this into two tasks would duplicate the engine's design
review for the sake of two call sites.

Rubric: E3 D1 L2 C2 R3 = 11 → decompose.

### Requirements

- [ ] R1. Implement a structural repair engine limited to heading presence, heading level, section order, and R-item checkbox form, which never authors section content.
- [ ] R2. Add `--fix` to `spur task check`, repairing structural findings in place and reporting the repairs per file.
- [ ] R3. Add `--fix` to `spur feature check` with the same contract, leaving acceptance-criteria content findings untouched and still reported.
- [ ] R4. Leave a file byte-identical when it has no structural findings, and never remove an off-variant section, since there is deliberately no section-delete verb.
- [ ] R5. Guarantee that re-running the check without `--fix` reports no remaining structural findings, and update the two `docs/help/cmd_*.md` pages plus `docs/04_DESIGN.md`.

### Acceptance Criteria

```gherkin
@core
Scenario: R10 — spur task check --fix repairs structural task defects only
  Given a task file with structural findings such as a missing, mis-levelled, or mis-ordered section heading
  When the check is run with --fix
  Then the structural findings are repaired in place and the repairs are reported per file
  And findings that would require authoring content are left untouched and still reported
  And re-running the check without --fix reports no remaining structural findings

@core
Scenario: R11 — spur feature check --fix repairs structural feature defects only
  Given a feature file with structural findings in its section layout
  When the check is run with --fix
  Then the structural findings are repaired in place and the repairs are reported per file
  And acceptance-criteria content findings are left untouched and still reported
  And re-running the check without --fix reports no remaining structural findings

@edge
Scenario: R15 — --fix is a no-op on a corpus file with nothing structural to repair
  Given a task or feature file whose only findings are content-level
  When the check is run with --fix
  Then the file is left byte-identical
  And the content findings are reported exactly as they are without --fix
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**One engine, two call sites.** The structural vocabulary — heading presence, level, order,
list-marker form — is identical for tasks and features; only the section matrix that defines the
expected layout differs, and both verbs already resolve theirs. Two engines would be two places for
the same repair to be wrong.

**Structural means layout, never content.** The engine repairs the shape a check can derive from the
section matrix. It never fills an empty section, never rewrites prose, and never touches acceptance
criteria bodies. A tool that authors spec content produces work that looks reviewed and is not.

**Off-variant sections cannot be repaired, and that is stated up front.** There is no section-delete
verb by design. `--fix` reports an off-variant section and leaves it; pretending otherwise would put
the engine in the position of deleting operator-written content to satisfy a matrix.

**Byte-identical on a no-op is the trust property.** A `--fix` that reformats a file it had nothing to
repair produces diff noise that makes operators stop trusting it, which is worse than not having it.

**Heading levels are the highest-risk repair.** Feature sections are `##` and task sections are `###`,
and a same-level heading inside a section body is silently lost on a `--section` write. The level
repair must move a heading to the correct depth without colliding with that write path.

### Plan

- [ ] Read the task and feature check implementations and the section matrix to enumerate which findings are structurally repairable
- [ ] Implement the shared repair engine for heading presence, level, order, and R-item checkbox form (R1)
- [ ] Wire `--fix` into `spur task check` with per-file repair reporting (R2)
- [ ] Wire `--fix` into `spur feature check` with the same contract (R3)
- [ ] Enforce the no-op byte-identity and the off-variant non-removal rules (R4)
- [ ] Add tests: each repairable finding, the content-only no-op, the off-variant case, and the re-check-clean property (R5)
- [ ] Update the two `cmd_*.md` pages, `docs/04_DESIGN.md`, and the `sp:spur-cli` references (R5)
- [ ] Run `bun run lint`, `bun run test`, and `bun run corpus-check`

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
