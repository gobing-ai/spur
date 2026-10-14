---
schema_version: 1
name: "catalog: a partial @gobing-ai/ts-* pin bump splits a lockstep dependency with no check catching it"
status: todo
template: standard
created_at: 2026-10-14T02:53:42.731Z
updated_at: "2026-10-14T05:48:16.656Z"
feature_id: C2

ac_altitude: graduating
ac_numbering: task-local
priority: P2
estimate_hours: 2
---

## 1202. catalog: a partial @gobing-ai/ts-* pin bump splits a lockstep dependency with no check catching it

### Background

Task 1200's historical partial ts-rule-engine bump exposed a catalog consistency gap: dependency versions can diverge while lock-vs-installed comparisons remain individually satisfied. The historical session/typecheck receipt is retained as the reported incident, not a freshly reproduced package installation. Current code inspection confirms checkDependencyDrift compares each locked resolution to an installed version and has no catalog cross-entry assertion.

**Refine corrections (2026-10-13)**
- Current root package.json has twelve @gobing-ai/ts-* entries at ^0.5.26, not ^0.5.25; tests must discover matching keys rather than freeze the count or version.
- A manifest-wide assertion can fail on pre-existing catalog edits; the original claim that it necessarily belongs in every task pre-check contradicts ADR-119. Resolve by extending the existing feature-scoped dependency-drift-check command.
- Rule-vs-script and escape-hatch choices are closed: use the existing script and enforce equality absolutely. No new rule evaluator or allowlist.
- The old checkbox AC did not bind R-items; use Scenario titles and matching feature scenarios under C2.
- Scope remains valid as a prevention gap; there is no current split-pin defect to repair.

### Requirements

- [ ] R1. dependency-drift-check rejects unequal string specifiers among all root workspaces.catalog keys starting with @gobing-ai/ts-, printing every conflicting package/specifier group deterministically and exiting nonzero before lock-vs-installed checking.
- [ ] R2. Equal specifiers pass catalog checking at any version; unrelated catalog entries are ignored; zero or one matching entry is vacuously consistent. Malformed JSON, missing/non-object catalog, or non-string matching specifiers fail with an actionable manifest diagnostic.
- [ ] R3. The existing feature-scoped dependency-drift-check includes this assertion while preserving its lock-vs-installed checks and public exports; task-local presets remain unchanged. No escape hatch or automatic bump is added.
- [ ] R4. Fixtures prove both catalog consistency and existing installed-dependency drift behavior; documentation of the command states its two checks and ADR-119 scope.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Split pins fail before dependency diagnosis (req: R1)
  Given a temporary manifest with eleven matching pins and one divergent ts-rule-engine pin
  When the dependency-drift-check command reads that manifest
  Then it exits nonzero and lists every package and specifier in both groups
  And its diagnostic names catalog consistency rather than an installed-package type error
Scenario: AC2 — Equality and malformed-input boundaries are pinned (req: R2)
  Given fixtures with equal current and older pins, unrelated keys, and zero or one matching key
  When the catalog assertion runs
  Then those valid fixtures pass
  And malformed JSON, absent catalog, and non-string matching values fail clearly
Scenario: AC3 — Existing gate scope and drift detection are preserved (req: R3, R4)
  Given scripts/commands/dependency-drift-check.test.ts and the root gate scripts
  When their focused tests run
  Then an unequal catalog fails even if installed and locked dependencies match
  And an equal catalog still permits existing installed-drift detection to fail
  And only the existing feature-scoped entrypoint owns the assertion
```

### Q&A

- Closed: compare exact specifier strings, including range syntax; semver equivalence is not lockstep declaration equality.
- Closed: report all groups sorted by specifier then package name; no arbitrary majority choice for ties.
- Closed: extend dependency-drift-check rather than introduce a second engine or gate. Catalog consistency and installed consistency are two checks of the same dependency integrity surface and share ADR-119 scope.
- Closed: no allowlist, minimum version, automatic install, or portable preset addition.

### Design

WHAT: add readCatalogTsDependencies(manifestPath) and checkCatalogConsistency(manifestPath) in scripts/commands/dependency-drift-check.ts, using the script's existing filesystem pattern. Extend DependencyDriftCheckOptions with optional packageJsonPath for fixture injection; default to the root cwd package.json. Keep checkDependencyDrift and its existing fixture callers unchanged; run the manifest assertion only from dependencyDriftCheck before its existing lock check. Group matching entries by exact string specifier; if multiple groups exist, emit the sorted groups and return 1. Catch manifest IO/parse/shape errors at the command boundary and return 1 with the path and remediation.

WHY/WHERE: dependency-drift-check already owns repo dependency integrity and is wired into spur-check-feature. ADR-119 requires this repo-wide invariant at that feature boundary. Root package.json script wiring is already sufficient; no task-local rule is added. Extend scripts/commands/dependency-drift-check.test.ts with temporary manifests passed through packageJsonPath, plus command integration fixtures where matching lock/installed data cannot hide a split catalog.

C2 owns this outcome; graduating AC match its ship scenarios, and ac_numbering: task-local binds every task requirement. No dependencies on 1203 or the review-confidence task.

Before implementation, obtain a clean task-owned tree. The inspected main tree has unrelated F43 edits in task-service/task-check, Board modules, tests, and generated residual-scan.mjs; do not include or revert them. Only one worktree was registered and 1204 was the only wip task at inspection. Recheck ownership before starting.

Out of scope: dependency upgrades, lockfile rewrites, minimum-version enforcement, new CLI nouns/verbs, rules, or deep imports into ts-* packages.

### Plan

1. Recheck task ownership and catalog values; inspect all callers of checkDependencyDrift and dependencyDriftCheck. Prepare a clean implementation tree without the unrelated F43 edits.
2. Add temporary-manifest negative fixtures to scripts/commands/dependency-drift-check.test.ts for a single divergent pin, tied groups, malformed manifest and non-string values (R1/R2).
3. Implement the two manifest helpers and packageJsonPath option; invoke them before the existing installed drift check, keeping its exports and fixtures compatible (R1-R3).
4. Add equal-current/equal-older, zero/one-entry, unrelated-key and combined catalog/installed-drift cases; update the command TSDoc and relevant existing command documentation (R2-R4).
5. Run bun test ./scripts/commands/dependency-drift-check.test.ts from the repository root, then bun run dependency-drift-check. Confirm spur-check-feature already includes it and task-local presets did not change. Run the task pipeline's named gate once; the feature-scoped pass runs once at C2 acceptance (R3/R4).

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature C2: docs/features/C2_lockstep-dependency-catalog-integrity.md
- Root package.json: workspaces.catalog and dependency-drift-check / spur-check-feature scripts.
- scripts/commands/dependency-drift-check.ts: checkDependencyDrift and dependencyDriftCheck.
- scripts/commands/dependency-drift-check.test.ts: existing fixture seam.
- docs/00_ADR.md: ADR-119; historical source incident task 1200.
- Snapshot: 2026-10-13 local refinement, HEAD 46718be2c; installed ts-rule-engine package reports 0.5.26. Unrelated dirty F43 work must be reconciled at implementation start.

### History

- 2026-10-14T05:47:30.158Z backlog → todo (system)

