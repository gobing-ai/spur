---
schema_version: 1
name: "Add the spur self noun and hide the four legacy standalone nouns behind it"
status: todo
template: feature-impl
created_at: 2026-08-20T23:18:21.541Z
updated_at: "2026-08-20T23:19:40.743Z"
feature_id: A3
priority: P1
dependencies: ["0613", "0618"]
---

## 0616. Add the spur self noun and hide the four legacy standalone nouns behind it

### Background

`init`, `migrate`, `serve`, and `status` are standalone top-level nouns today — the CLI matrix
records them as the only four nouns with no sub-verbs. They are all Spur-managing-itself operations,
which is a group, and ADR-051's first-layer noun discipline exists precisely so similar actions group
under one noun.

Aliasing has a cost the operator has already ruled on: keeping the four legacy nouns visible would
grow the noun count from 13 to 14 with nothing removed. The decision is hidden aliases — every
existing script, workflow YAML, and habit keeps working, while `spur --help` lists only `self`.

Rubric: E2 D1 L1 C2 R2 = 8 → decompose.

### Requirements

- [ ] R1. Add a `self` noun mounting the four existing command builders so `spur self init|migrate|serve|status` behave identically to the legacy nouns, including flags, output, and exit codes.
- [ ] R2. Keep each legacy top-level noun registered and working unchanged, as a hidden alias rather than a re-implementation.
- [ ] R3. Hide the four legacy nouns from the top-level help listing while `self` is listed.
- [ ] R4. Update `docs/help/spur-cli-matrix.md`, the affected `docs/help/cmd_*.md` pages, and `docs/04_DESIGN.md` in the same commit.
- [ ] R5. Cover the alias equivalence and the help-listing visibility with tests.

### Acceptance Criteria

```gherkin
@core
Scenario: R7 — spur self hosts the self-management verbs with the legacy nouns preserved
  Given init, migrate, serve, and status are standalone top-level nouns today
  When the self noun ships
  Then each verb is reachable as spur self <verb> with behavior identical to the legacy noun
  And each legacy noun keeps working unchanged for existing scripts and workflows
  And the legacy nouns are hidden from the top-level help listing while self is listed
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**Mount the existing builders; do not fork them.** The four commands keep one implementation each,
registered twice. Copying the definitions would double the maintenance surface and let the alias
drift from its original — the exact failure this feature exists to prevent.

**Hidden, not removed.** `spur status` appears in shipped workflow YAML, docs, and operator muscle
memory. Removing it would be a breaking change to a published contract for no benefit; hiding it from
help delivers the surface-shrink goal at zero migration cost.

**Consent lives in the prerequisite task's ADR-051 amendment** (frontmatter dependency), so this
task implements against a recorded decision rather than re-deriving one.

**Docs move in the same commit.** The CLI matrix's legend explicitly distinguishes standalone from
compound nouns, and `sp:spur-cli` is parity-checked against the live CLI (ADR-038, ADR-053) — a surface
change that lands without its doc updates fails the parity gate, correctly.

### Plan

- [ ] Read `apps/cli/src/index.ts` and the four command modules to find the registration seam
- [ ] Add the `self` noun mounting the four existing builders (R1)
- [ ] Re-register the legacy nouns as hidden aliases over the same implementations (R2, R3)
- [ ] Verify flags, output, and exit codes are identical on both paths (R1)
- [ ] Update the CLI matrix, the affected `cmd_*.md` pages, and `docs/04_DESIGN.md` (R4)
- [ ] Add tests for alias equivalence and for help-listing visibility (R5)
- [ ] Run `bun run lint`, `bun run test`, and the `sp:spur-cli` parity gate

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
