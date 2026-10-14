---
schema_version: 1
name: "catalog: a partial @gobing-ai/ts-* pin bump splits a lockstep dependency with no check catching it"
status: backlog
template: standard
created_at: 2026-10-14T02:53:42.731Z
updated_at: "2026-10-14T02:54:00.857Z"
feature_id: C

---

## 1202. catalog: a partial @gobing-ai/ts-* pin bump splits a lockstep dependency with no check catching it

### Background

Found while running task 1200 (2026-10-13). Task 1200 bumped **one** entry of the
`@gobing-ai/ts-*` catalog in root `package.json` — `@gobing-ai/ts-rule-engine` `^0.5.24` → `^0.5.25` —
while the other eleven stayed at `^0.5.24`. The ts-libs packages are versioned in **lockstep**, so the
new `ts-rule-engine@0.5.25` pulled `@gobing-ai/ts-infra@^0.5.25` transitively while the direct pin
still resolved `0.5.24`. `bun install` then legitimately installed **two** copies of
`@gobing-ai/ts-infra` under `node_modules/.bun/`, and the typecheck failed with an obscure message:

```
@gobing-ai/spur-app typecheck: src/services/rule-service.ts(281,39): error TS2345:
  Types of property 'events' are incompatible.
  Types have separate declarations of a private property 'syncHandlers'.
```

That error names neither the catalog nor the lockstep rule; the fix (move all twelve pins together,
the shape commit `57a1a10cc` used for 0.5.23 → 0.5.24) had to be inferred from the two `.bun` paths
in the message. Task 1200 shipped the complete bump, so this is a **detection gap**, not a live
defect: no check in the tree asserts that the twelve `@gobing-ai/ts-*` catalog pins are version-equal.

**Hypothesis tested and falsified during the session review** — recorded so it is not re-tried:
`scripts/commands/dependency-drift-check.ts` does **not** cover this. `checkDependencyDrift`
(`:97-135`) reads each `@gobing-ai/ts-*` lock entry and compares it against **that entry's installed
copy**; a split install has every lock entry matching its own installed copy, so it reports **no
drift**. It needs a *cross-entry* inequality assertion, which it does not have.

The gap is cheap to close and the failure it prevents is expensive: the symptom costs a full
typecheck round-trip (minutes under load) plus diagnosis, and the regression landed on `main` as
`aa242b5e2` only because the author of task 1200 happened to notice the two copies.

### Requirements

- [ ] R1. A check fails when the `@gobing-ai/ts-*` entries of `workspaces.catalog` in root
      `package.json` are not all the same version, naming every pin that disagrees.
- [ ] R2. The check passes on the current tree (all twelve at `^0.5.25`) and on a catalog whose pins
      are uniformly older (`^0.5.23`), so it asserts *equality*, never a minimum version.
- [ ] R3. The check tolerates the intent of a deliberate cross-version pin if such an intent is
      declared — decide and state explicitly whether an escape hatch exists (e.g. a documented
      allowlist entry). If none, say so in the Design and let the check be absolute.
- [ ] R4. The check's placement follows ADR-119 (`docs/00_ADR.md:1864`): stated in the Design as
      task-local or feature-scoped with the reason, since the assertion can fail for a reason the
      current task did not cause.

### Acceptance Criteria

- [ ] AC1 — A catalog fixture with one pin at a different version produces a failure that names the
      offending pin(s); a fixture with all pins equal produces none (req: R1, R2)
- [ ] AC2 — The check runs green on the unmodified catalog of this repo (req: R1)
- [ ] AC3 — The chosen placement is visible in the change itself (member of the per-task gate or of
      `spur-check-feature`) and matches the Design's stated ADR-119 reading (req: R4)
- [ ] AC4 — Either an escape hatch exists and is covered by a test, or the Design records that the
      check is absolute; no silent bypass (req: R3)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**What to assert.** Read `workspaces.catalog` from root `package.json`, select the keys matching
`@gobing-ai/ts-*`, and fail when the distinct version values exceed one. `bun.lock` does not need to
be read: by the time the lock separates a dependency into two installed copies, the *cause* is
already visible in the catalog, and reading `package.json` alone keeps the check dependency-free and
fast (no lock parse, no `node_modules` walk).

**Mechanism — rule or script.** Prefer a **rule** in `config/rules/` (a static constraint over a
tracked manifest is exactly the rule engine's shape) so it participates in the existing preset and
needs no new gate plumbing. Fall back to a `scripts/commands/*-check.ts` script if the rule engine
cannot express a cross-entry comparison over one JSON document cleanly — the rule evaluators already
read `package.json` for other constraints, so this should not be necessary.

**Placement (ADR-119).** ADR-119 (`docs/00_ADR.md:1864`) forbids a per-task pipeline hosting a check
that "can fail for a reason the current task did not cause". Read carefully, this check is
**task-local and belongs in the per-task pre-check preset**: the invariant is self-consistency of one
file that a task edits *itself*, so a failing check means the current task's own edit is internally
inconsistent. A task that does not touch the catalog cannot make it fail — the property ADR-119
protects. The alternative reading (feature-scoped, because a sibling task could have landed the
partial bump) is weaker: it would delay detection of *this* task's own inconsistency by a whole
feature cycle, which is the exact cost this task exists to remove. **Record this reasoning in the
change** and cite ADR-119 either way.

**Detector lineage.** Do not extend `dependency-drift-check.ts` (`scripts/commands/`): its contract is
lock-vs-installed drift for `@gobing-ai/ts-*` and it is documented as feature-scoped under ADR-119
(`docs/00_ADR.md:641`, `:1776`). Adding a second, unrelated invariant to it would make one check own
two scopes. Keep the two separate.

### Plan

1. Reproduce the negative case cheaply and keep it as the first fixture: copy the catalog, move one
   `@gobing-ai/ts-*` pin to another version, assert the check fails and names that pin. Confirm it
   would have failed on the task-1200 intermediate state (eleven at `^0.5.24`, `ts-rule-engine` at
   `^0.5.25`).
2. Implement the assertion in the chosen mechanism (rule preferred) and wire it into the placement the
   Design settles — per-task pre-check preset, with the ADR-119 citation in the change.
3. Add the positive fixtures: all pins equal at `^0.5.25` (current) and all equal at `^0.5.23`, so a
   uniform-but-older catalog stays green.
4. Decide R3's escape hatch explicitly; if the check is absolute, record that in the Design and add a
   test asserting no bypass exists.
5. Run the owning gate plus `bun run spur-check`; confirm `test-pre-check` still reports its full rule
   count with the new rule included.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
