---
schema_version: 1
name: "Add the spur self noun and hide the four legacy standalone nouns behind it"
status: done
template: feature-impl
created_at: 2026-08-20T23:18:21.541Z
updated_at: "2026-08-21T18:03:05.680Z"
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

- [x] R1. Add a `self` noun mounting the four existing command builders so `spur self init|migrate|serve|status` behave identically to the legacy nouns, including flags, output, and exit codes.
- [x] R2. Keep each legacy top-level noun registered and working unchanged, as a hidden alias rather than a re-implementation.
- [x] R3. Hide the four legacy nouns from the top-level help listing while `self` is listed.
- [x] R4. Update `docs/help/spur-cli-matrix.md`, the affected `docs/help/cmd_*.md` pages, and `docs/04_DESIGN.md` in the same commit.
- [x] R5. Cover the alias equivalence and the help-listing visibility with tests.

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

- [x] Read `apps/cli/src/index.ts` and the four command modules to find the registration seam
- [x] Add the `self` noun mounting the four existing builders (R1)
- [x] Re-register the legacy nouns as hidden aliases over the same implementations (R2, R3)
- [x] Verify flags, output, and exit codes are identical on both paths (R1)
- [x] Update the CLI matrix, the affected `cmd_*.md` pages, and `docs/04_DESIGN.md` (R4)
- [x] Add tests for alias equivalence and for help-listing visibility (R5)
- [x] Run `bun run lint`, `bun run test`, and the `sp:spur-cli` parity gate

### Solution
Implemented in commit `9baf106b` (this session verified and closed the corpus bookkeeping). The
`self` noun mounts the four existing command builders; legacy nouns stay registered over the same
builders as hidden aliases.

- `self` sub-command created and `registerInitCommand`/`registerMigrateCommand`/
  `registerServeCommand`/`registerStatusCommand` mounted under it — one implementation registered
  twice, so flags, output, and exit codes are identical by construction
  (`apps/cli/src/index.ts:135-147`).
- The four legacy top-level registrations re-registered with `{ hidden: true }` over the same
  builders — hidden alias, not a re-implementation (`apps/cli/src/index.ts:144-147`).
- Help: `self` listed with its summary; `init`/`migrate`/`serve`/`status` absent from the top-level
  listing (verified live via `spur --help`).
- Docs updated in the same commit: `docs/help/spur-cli-matrix.md`, `cmd_init.md` / `cmd_migrate.md`
  / `cmd_serve.md` / `cmd_status.md`, `docs/help/index.md`, `docs/04_DESIGN.md`, and the
  `sp:spur-cli` routing.
- Tests: alias equivalence and help-visibility assertions in
  `apps/cli/tests/commands/dispatch-inspect.test.ts` and `apps/cli/tests/spur-cli-parity.test.ts`.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Scenario: R7 — spur self hosts the self-management verbs with the legacy nouns preserved | MET | R1: `self` mounts the four existing builders (`apps/cli/src/index.ts:135-147`). R2: legacy nouns re-registered `{ hidden: true }` over the same builders (`apps/cli/src/index.ts:144-147`). R3: help lists `self`, hides the four (live smoke). R4: matrix + `cmd_init.md`/`cmd_migrate.md`/`cmd_serve.md`/`cmd_status.md` + `docs/04_DESIGN.md` same commit `9baf106b`. R5: alias equivalence + visibility tests green — `apps/cli/tests/commands/dispatch-inspect.test.ts` and `apps/cli/tests/spur-cli-parity.test.ts` (24 pass / 0 fail) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
| Priority | Kind | Finding | Ref |
|---|---|---|---|
| P4 | Verify | No P1–P3 findings. One implementation registered twice — no fork, no drift surface | R1/R2 MET |
| P4 | Verify | Hidden-alias choice matches the design note: published `spur status` contract in shipped workflow YAML keeps working while help lists only `self` | R3 MET |
| P4 | Verify | Docs (matrix, cmd_* pages, 04_DESIGN, spur-cli routing) landed in the same commit `9baf106b` | R4 MET |
| P4 | Verify | Equivalence + visibility covered by dispatch-inspect and parity tests | R5 MET |
| P4 | Note | Task file status was left `todo` when the code landed; this change closes the corpus bookkeeping only — no code delta in this commit | — |
### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-21T18:02:54.834Z todo → wip (system)
- 2026-08-21T18:02:55.394Z wip → testing (system)
- 2026-08-21T18:03:05.680Z testing → done (system)
