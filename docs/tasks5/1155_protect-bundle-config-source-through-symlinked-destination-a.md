---
schema_version: 1
name: Protect bundle-config source through symlinked destination ancestors
status: todo
template: feature-impl
created_at: 2026-10-10T07:27:54.618Z
updated_at: "2026-10-10T16:27:20.853Z"
feature_id: A

ac_altitude: task-local
ac_numbering: task-local
priority: P1
estimate_hours: 3
---

## 1155. Protect bundle-config source through symlinked destination ancestors

### Background

Review a71c reproduced source deletion in a temporary repository: a symlinked parent aliases the repo, but the lexical target guard accepts alias/config and rm deletes the real config directory before cp fails. Evidence: `scripts/commands/bundle-config.ts:28` and `scripts/commands/bundle-config.ts:32`; reproduction receipt: `.spur/run/a71c-config-symlink-repro.json`. The separate gate-lock diagnostic was already corrected during triage. These are task-local packaging regression scenarios, not feature ship criteria.

**Refine corrections (2026-10-10)**
- Current bundleConfig guard at scripts/commands/bundle-config.ts:28 is lexical, then rm at :32; callers are spur-dev.ts and CLI init-template tests. The a71c repro artifact exists.
- Existing bundle-web precedent rejects both directions of physical overlap, including destination inside source; original R1 named only source/ancestors. Freeze the same bidirectional rule to prevent copying config into its own subtree.
- Current target-guard tests invoke destructive candidates against the real checkout. Migrate those to a copied-script fixture before running any red safety test; never rely on the production guard protecting this repository during its own regression test.

### Requirements

- [ ] R1. Resolve destination aliases before destructive cleanup and reject physical overlap in either direction: destination equal to source, containing source, or inside source.
- [ ] R2. Preserve ordinary bundle output and schema injection; reject unsafe paths before any removal.
- [ ] R3. Cover symlinked ancestor aliases, direct source/ancestor destinations, and safe missing destination directories with isolated fixtures.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Aliased source cannot be deleted (req: R1, R2)
  Given an isolated repo whose parent alias is a symlink
  When bundleConfig targets alias/config
  Then it rejects before removal and source sentinel bytes remain unchanged

Scenario: AC2 — Safe output still bundles (req: R2, R3)
  Given a safe destination with missing final directories
  When bundleConfig runs
  Then assets are copied and workflow schema directives remain unique

Scenario: AC3 — Direct ancestors are protected (req: R1, R3)
  Given source and ancestor destination paths
  When bundleConfig runs for each
  Then every unsafe destination is rejected before writes
```

### Q&A

- Closed: reject both physical overlap directions, matching bundle-web; source-subtree destinations are unsafe too.
- Closed: keep private local path helpers and the existing bundleConfig API. No filesystem framework or dependency.
- Closed: all destructive safety tests bind SOURCE to an isolated copied-script fixture, including old direct-ancestor tests. No chmod or destructive probe against the live repository.

### Design

**Chosen algorithm / no new API.** Keep bundleConfig(target) and its return/error contract. In scripts/commands/bundle-config.ts use the existing bundle-web canonicalPath and contains algorithm locally (private functions, no shared abstraction): realpath(resolve(path)); on ENOENT only, canonicalize dirname and append basename; propagate EACCES/ENOTDIR/ELOOP and other errors. Canonicalize SOURCE and target before rm/cp; refuse contains(source,target) OR contains(target,source). contains must test empty relative path, '..' exactly and '..'+sep boundary, never startsWith('..') alone. Keep safe-path rm/cp/schema behavior, exclude filter, usage error and injected counter. No command/flag/schema/dependency changes. Do not claim race-free hostile concurrent filesystem replacement; concurrent mutation is outside this local packaging operation's contract.

**Isolated test layout.** Create mkdtemp repo with scripts/commands/bundle-config.ts copied byte-for-byte from the implementation and config/ containing a source sentinel, a workflow with existing quoted schema and one without schema, excluded fixtures and a normal asset. Dynamically import the copied script using its unique absolute file URL, so import.meta.url binds SOURCE to this temporary config. Migrate existing source/ancestor guard cases into that fixture before red tests. Alias fixture: symlink alias-parent→fixtureRepo, then target alias-parent/config or alias-parent/config/subdir; test direct root/config/config-child, symlink final source and aliased ancestor separately. Check source sentinel/schema bytes and tree inventory unchanged after rejection.

**Safe cases / edge tests.** Safe missing nested target under an aliased outside parent must bundle, exclude fixture junk and inject exactly one schema per relevant YAML. Safe sibling names beginning '..' must not be rejected by a loose '..' prefix check. Keep absolute/relative target behavior and ordinary init-template callers. A realpath non-ENOENT error must reject before cleanup; use a deterministic ENOTDIR ancestor fixture rather than permission bits. No symlink/destructive aliases against this checkout.

**Scope/verification.** Only bundle-config.ts/test.ts and task evidence; do not change bundle-web or export its private helper. Run the focused scripts test using the root preload explicitly if invoking outside the root, then CLI init-template suite inside apps/cli and the required gate. 1152 changes source workflow content but not this algorithm; no logical dependency. 1154 moves test tiers and does not own bundler safety.

### Plan

1. [ ] R3: build the copied-script fixture and migrate direct source/ancestor safety tests off the real repository.
2. [ ] R1/R3: add aliased ancestor, exact source, source-child, direct ancestor, final symlink and non-ENOENT path cases; demonstrate source deletion only inside the disposable fixture on the pre-fix implementation.
3. [ ] R1/R2: add local canonicalPath/contains and reject bidirectional physical overlap before rm; retain other errors.
4. [ ] R2/R3: check safe missing/aliased output, '..'-prefixed safe siblings, exclusion filter and schema uniqueness with unchanged source bytes.
5. [ ] Run bun test --preload ./tests/setup.ts scripts/commands/bundle-config.test.ts from root, then apps/cli init-templates suite in its workspace and task gate. Review/verify/record and commit.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- `scripts/commands/bundle-config.ts:28` — lexical-only containment.
- `scripts/commands/bundle-config.ts:32` — destructive cleanup.
- `scripts/commands/bundle-web.ts:103` — existing physical path precedent.

#### Readiness review (2026-10-10)

Outcome: refined; depth: ready; status: todo → todo; corrections: 3.

| id | pass | evidence |
| --- | --- | --- |
| requirements | true | Current-tree audit; observable R-items and explicit scope below. |
| design | true | Chosen seams, fixtures, edge behavior and non-goals frozen in Design. |
| plan | true | Ordered implementation and test plan linked to R-items. |
| ac | true | Task-local scenarios and req links; task check --as todo PASS, no errors. |
| decisions | true | Closed decisions in Q&A; no unresolved implementation decision. |
| dependencies | true | Prerequisite and sibling ownership recorded in Design; declared edges where needed. |
| premises | true | Source/callers/tests inspected; verified facts and corrected hypotheses recorded in Background. |

Planning-only receipt: no implementation pipeline or behavior-change verification PASS is claimed. Recheck source and ownership before implementation; batch began on main at 13da1554f with one worktree, no WIP tasks and a clean tree. Runtime Bun 1.3.14; no dependency install needed for refinement.

### History

- 2026-10-10T07:28:44.925Z backlog → todo (system)

