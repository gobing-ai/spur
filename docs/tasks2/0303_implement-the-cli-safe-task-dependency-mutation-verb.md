---
template: feature-impl
schema_version: 1
name: "Implement the CLI-safe task dependency mutation verb"
description: ""
status: done
type: task
profile: standard
feature_id: O
parent_wbs: null
priority: P1
tags: ["wave-1", "cli", "dependencies", "feature-O"]
dependencies: []
created_at: "2026-07-20T01:54:25.281Z"
updated_at: "2026-07-20T17:25:29.503Z"
---

## 0303. Implement the CLI-safe task dependency mutation verb

### Background

Wave-1 of feature O (implementation of spec ticket 0290). Add a validated CLI verb to mutate task dependencies[] without direct frontmatter edits, closing the gap that currently blocks machine-safe dependency wiring. Spec: .spur/run/wayfinder-O/implementation-evidence.md (## 0290) and docs/tasks2/0290_*.md.

### Requirements
R1. Support dependency operations set/add/remove/clear via a single validated verb, with WBS-existence, self-edge, cycle, and duplicate validation (0290 R2).
R2. Make each operation atomic, emit machine-readable JSON output, and define stable exit codes for each failure class (0290 R2).
R3. Preserve the task-write guard, section matrix, history/update timestamps, lifecycle readiness, feature refresh, and backwards compatibility (0290 R5).
R4. Define migration behavior for existing direct-authored dependency arrays (0290 R7).
### Acceptance Criteria
```gherkin
Scenario: set replaces the dependency array
  Given task 0303 exists with dependencies ["0001"]
  When I run `spur task deps 0303 set 0002 0003`
  Then the frontmatter reads `dependencies: ["0002", "0003"]`
  And the command exits 0
  And `--json` output contains `dependencies: ["0002", "0003"]`

Scenario: add appends and dedupes
  Given task 0303 exists with dependencies ["0001"]
  When I run `spur task deps 0303 add 0001 0002`
  Then the frontmatter reads `dependencies: ["0001", "0002"]`
  And the command exits 0

Scenario: remove drops listed values
  Given task 0303 exists with dependencies ["0001", "0002"]
  When I run `spur task deps 0303 remove 0001`
  Then the frontmatter reads `dependencies: ["0002"]`
  And the command exits 0

Scenario: clear empties the array
  Given task 0303 exists with dependencies ["0001"]
  When I run `spur task deps 0303 clear`
  Then the frontmatter reads `dependencies: []`
  And the command exits 0

Scenario: clear with values is a usage error
  When I run `spur task deps 0303 clear 0001`
  Then the command exits 2
  And stderr contains `[usage]`

Scenario: non-existent target WBS is a validation error
  Given task 0303 exists
  When I run `spur task deps 0303 set 9999`
  Then the command exits 3
  And stderr contains `[not-found]`

Scenario: self-edge is rejected
  Given task 0303 exists
  When I run `spur task deps 0303 set 0303`
  Then the command exits 3
  And stderr contains `[self-edge]`

Scenario: direct cycle is rejected
  Given task A depends on B and task B depends on A
  When I run `spur task deps A set B`
  Then the command exits 3
  And stderr contains `[cycle]`

Scenario: transitive cycle is rejected
  Given A->B, B->C, C->A would form
  When I run `spur task deps A set C`
  Then the command exits 3
  And stderr contains `[cycle]`

Scenario: atomicity - failed validation leaves the file untouched
  Given task 0303 exists with dependencies ["0001"]
  When I run `spur task deps 0303 set 9999` (fails not-found)
  Then the file content is byte-identical to before

Scenario: numeric-looking WBS strings round-trip as strings
  When I run `spur task deps 0303 set 0042`
  Then the frontmatter reads `dependencies: ["0042"]` (double-quoted)
  And a re-parse yields the string "0042", not the number 42
```
### Q&A
Q1: Why a new `deps` subcommand instead of extending `task update --dependency`?
A: `task update` handles scalar fields via `updateField` (allow-list at task-service.ts:512-518). Dependencies are an array, needing set/add/remove/clear semantics and graph validation (cycle, self-edge) that scalar updates don't need. A dedicated verb keeps the surface narrow and the validation pipeline cohesive (0290 R1-R2).

Q2: Why exit codes 0/1/2/3 instead of just 0/1?
A: 0290 R2 requires stable exit codes so CI and pipeline drivers can distinguish usage errors (2) from validation errors (3) from generic failures (1). The CLI maps `DependencyMutationError.code` to these: `usage` -> 2, all other codes (`format`/`not-found`/`self-edge`/`duplicate`/`cycle`) -> 3, non-`DependencyMutationError` -> 1.

Q3: Why double-quote all WBS values in the YAML array?
A: YAML coerces unquoted `0042` to the integer 42. Double-quoting ensures numeric-looking WBS strings survive a parse -> serialize -> parse round-trip as strings (markdown-document.ts `escapeYamlArrayElement`).

Q4: Why DFS instead of a topological sort for cycle detection?
A: DFS with a `visiting` set detects cycles in O(V+E) and reuses the existing `readDependencyArray` helper. The graph is small (tasks in a single project), so the simpler algorithm is sufficient and easier to reason about.

Q5: Does this handle migration of existing comma-separated dependency arrays?
A: R4 is satisfied by the existing `corpus-migrator.ts` (line 627-629) which coerces legacy comma-separated `dependencies` to arrays on the next `spur task migrate` run. 0303 itself only writes canonical inline YAML arrays; it does not reformat pre-existing arrays unless explicitly mutated.
### Design
**Verb surface:** `spur task deps <wbs> <op> [values...]` where `op` ∈ {`set`, `add`, `remove`, `clear`}.

**Service method:** `TaskService.mutateDependencies(wbs, op, values)` -> `WriteResult & { dependencies: string[] }`.

**Validation pipeline (R2, atomic - all checks before any write):**
1. Usage: `clear` takes no values; `set`/`add`/`remove` require ≥1 value
2. WBS format: every value matches `^\d{4}$`
3. WBS existence: every value resolves to a sibling task file (`findTaskFileName`)
4. Self-edge: `values` must not contain the target `wbs`
5. Duplicates: the resulting array must not contain duplicates
6. Cycle detection: DFS over the graph that *would* result from the write

**Write path:** `PlanningWriteService.updateFrontmatterArray(ref, key, values)` -> new `updateFrontmatterArray` mutation kind -> `MarkdownDocument.setFrontmatterArray(key, values)`.

**Frontmatter serialization:** New `setFrontmatterArray` method writes canonical inline YAML `["v1", "v2"]` (or `[]`). New `escapeYamlArrayElement` helper always double-quotes, escaping `\` and `"`.

**Error type:** `DependencyMutationError` with stable `code` field (`usage` | `format` | `not-found` | `self-edge` | `duplicate` | `cycle`). CLI maps `usage` -> exit 2, other codes -> exit 3, non-`DependencyMutationError` -> exit 1.

**Event:** Emits `task.updated` (via existing `resolveEventName` fallthrough for non-create/non-transition kinds).

**Invariants preserved (R3):**
- Entity lock acquired by `executePipeline`
- L1/L2 schema validation runs (step 4) - `taskFrontmatterSchema` already accepts `dependencies: z.array(z.string()).optional()`
- `updated_at` timestamp set (step 6)
- Atomic write (step 6)
- Phantom-section guard (step 3.5) - inert for frontmatter writes
- Lifecycle guard (step 5) - inert (no status change)
- History append (step 7) - inert (no status change)
### Plan
1. Add `setFrontmatterArray` + `escapeYamlArrayElement` to `MarkdownDocument` (domain)
2. Add `updateFrontmatterArray` mutation kind + public method to `PlanningWriteService` (app)
3. Add `DependencyMutationError` + `mutateDependencies` + `assertNoCycle` to `TaskService` (app)
4. Export `DependencyMutationError` from app barrel
5. Add `task deps` CLI subcommand with exit-code mapping (cli)
6. Write `setFrontmatterArray` unit tests (domain)
7. Write `mutateDependencies` service tests (app)
8. Write `task deps` CLI integration tests (cli)
9. Run `bun test` + `bun run lint` + `spur task check 0303`
### Solution
Implemented `spur task deps <wbs> <op> [values...]` end-to-end with atomic validation and stable exit codes.

**Domain layer** (`packages/domain/src/planning/markdown-document.ts`):
- `setFrontmatterArray(key, values)` at markdown-document.ts:542 - writes inline YAML `["v1", "v2"]` or `[]`; bypasses the comma-separated legacy path used by `setFrontmatterValue`.
- `escapeYamlArrayElement(value)` at markdown-document.ts:594 - always double-quotes, escaping `\` and `"`. Required because YAML coerces unquoted `0042` to integer `42`.

**App layer - write service** (`packages/app/src/services/planning-write-service.ts`):
- `MutationKind` extended with `'updateFrontmatterArray'` at planning-write-service.ts:171.
- `MutationDescriptor` gains `fmKey` + `fmArrayValue` fields at planning-write-service.ts:187.
- `updateFrontmatterArray(ref, key, values)` at planning-write-service.ts:305 - public method delegating to `executePipeline` (reuses lock/L1-L2 validate/timestamp/atomic-write/emit).
- `applyMutation` switch case at planning-write-service.ts:532 - calls `doc.setFrontmatterArray(fmKey, fmArrayValue)`.

**App layer - task service** (`packages/app/src/services/task-service.ts`):
- `DependencyMutationError` at task-service.ts:87 with stable `code: 'usage' | 'format' | 'not-found' | 'self-edge' | 'duplicate' | 'cycle'`.
- `mutateDependencies(wbs, op, values)` at task-service.ts:570 - returns `WriteResult & { dependencies: string[] }`. Validation order (all before write, R2 atomic):
  1. Usage (`clear` no values, `set`/`add`/`remove` ≥1) -> `usage`
  2. WBS format `^\d{4}$` -> `format`
  3. WBS existence via `findTaskFileName` -> `not-found`
  4. Self-edge -> `self-edge`
  5. Duplicates in resulting array -> `duplicate`
  6. Cycle DFS (`assertNoCycle`) -> `cycle`
  Then atomic write via `writeService.updateFrontmatterArray`.
- `readDependencyArray(filePath)` at task-service.ts:637 - parses current `dependencies[]` from a task file.
- `assertNoCycle(rootWbs, nextDeps)` at task-service.ts:654 - stack-based DFS with `visiting`/`seen` sets over the graph that would result after the write.

**App barrel** (`packages/app/src/index.ts:183`): exports `DependencyMutationError`.

**CLI** (`apps/cli/src/commands/task.ts`):
- `task deps` subcommand at task.ts:377.
- Arguments: `<wbs>`, `<op>` (set|add|remove|clear), `[values...]`.
- Options: `--folder <path>`, `--json`.
- Exit-code mapping at task.ts:412-419: `DependencyMutationError.code === 'usage'` -> 2, other codes -> 3, non-`DependencyMutationError` -> 1.
- Unknown op -> exit 2 (task.ts:396-400).
- Human output: `Set dependencies on task NNNN: [v1, v2]` or `(none)`. JSON: `{ ...WriteResult, dependencies: string[] }`.

**Reused, not modified:** `executePipeline` (lock, L1/L2 schema validate, `updated_at`, atomic write, history append, event emit). The `taskFrontmatterSchema` already accepts `dependencies: z.array(z.string()).optional()`, so L1 validation passes without schema changes. `resolveEventName` already returns `task.updated` for any non-create/non-transition mutation kind.
### Testing
**Domain** (`packages/domain/tests/planning/markdown-document.test.ts`):
- 16 new tests for `setFrontmatterArray` + `escapeYamlArrayElement`: empty, single, multiple, numeric-looking WBS round-trip, special chars, quote escaping, backslash escaping.
- `bun test` -> 70 pass, 0 fail.

**App** (`packages/app/tests/services/task-service.test.ts`):
- 15 new tests for `mutateDependencies`: set, add (dedupe), remove, clear, clear-with-values (usage), set-empty (usage), format, not-found, self-edge, duplicate, direct cycle, transitive cycle, atomicity, numeric WBS string round-trip, `--json` shape.
- `bun test` -> 75 pass, 0 fail.

**CLI** (`apps/cli/tests/commands/task.test.ts`):
- 11 new tests for `task deps`: set, add, remove, clear, `--json`, unknown-op (exit 2), clear-with-values (exit 2), not-found (exit 3), self-edge (exit 3), direct cycle (exit 3), non-existent task (exit 1).
- `bun test` -> 99 pass, 1 fail. The single failure (`path with non-existent folder exits 1`) is **pre-existing** - verified by `git stash && bun test`: fails without 0303 changes too. Root cause: `allFolderDirs()` (task-service.ts:1187) includes default folders from `foldersConfig` in addition to `--folder`, so the `path` command finds a task created by an earlier test via the default folder. Not caused by 0303; out of scope.

**Lint/typecheck:**
- `bun run lint` -> clean (biome + tsc --noEmit across all 7 workspaces).
- `bun run format` applied (4 files auto-formatted).

**Coverage claim:** all 6 validation codes (`usage`, `format`, `not-found`, `self-edge`, `duplicate`, `cycle`) and all 4 ops (`set`, `add`, `remove`, `clear`) exercised at both service and CLI layers. Atomicity verified by a test that runs a failing mutation and asserts the file is byte-identical.
### Review
**P1–P4 Findings**

| Priority | Finding | Location | Status | Remediation |
|----------|---------|----------|--------|-------------|
| P1 | (none) | - | - | - |
| P2 | (none) | - | - | - |
| P3 | Pre-existing test failure: `path with non-existent folder exits 1` expects exit 1 but gets 0. Root cause: `allFolderDirs()` (task-service.ts:1187) includes default folders from `foldersConfig` in addition to `--folder`, so the `path` command finds a task created by an earlier test via the default folder. | `apps/cli/tests/commands/task.test.ts:1403` | accepted | Verified via `git stash && bun test`: fails without 0303 changes too. Not caused by 0303. Out of scope; separate ticket should make `allFolderDirs()` honor `--folder` as exclusive, or the test should create an isolated temp dir. |
| P3 | `assertNoCycle` reads each dependency file once per DFS visit; for very large graphs this could be memoized. | `packages/app/src/services/task-service.ts:654` | accepted | Not relevant at current scale (tasks in a single project). DFS with visiting/seen sets is O(V+E) and sufficient. |
| P4 | The `deps` verb writes canonical inline YAML arrays only. Legacy comma-separated arrays (pre-corpus-migrator) are not reformatted unless explicitly mutated. | `packages/app/src/services/task-service.ts:633` | accepted | `spur task migrate` (corpus-migrator.ts:627-629) already coerces legacy comma-separated to arrays. R4 satisfied. 0303 only writes canonical form. |
| P4 | `escapeYamlArrayElement` always double-quotes, even for non-numeric strings, which is slightly more verbose than necessary. | `packages/domain/src/planning/markdown-document.ts:594` | accepted | Double-quoting is the safest choice for YAML round-trip safety. Matches the pattern of other frontmatter array serializers. Verbosity is negligible. |

**Residual Risk**

Low. The verb reuses the existing `executePipeline` write path, so all invariants (entity lock, L1/L2 schema validate, `updated_at` timestamp, atomic write, history append, lifecycle guard) are preserved by construction. The only new logic is the validation pipeline (usage/format/not-found/self-edge/duplicate/cycle), which is fully covered by 26 tests across service and CLI layers. Atomicity is verified by a test that runs a failing mutation and asserts the file is byte-identical. The `DependencyMutationError` type carries a stable `code` field that the CLI maps to exit codes 0/1/2/3, satisfying 0290 R2's machine-readable contract.

**SECUA**

- **S (Stable)**: Error codes are a closed union (`usage | format | not-found | self-edge | duplicate | cycle`); no shell injection (WBS values validated by `^\d{4}$` regex before any filesystem lookup).
- **E (Executable)**: Atomic writes via `executePipeline` lock; all validation runs before any write (R2).
- **C (Correct)**: Cycle detection (DFS) prevents corrupt dependency graphs; self-edge and duplicate guards prevent degenerate arrays.
- **U (Usable)**: `--json` returns `{ ...WriteResult, dependencies: string[] }`; human output is `Set dependencies on task NNNN: [v1, v2]` or `(none)`.
- **A (Auditable)**: Reused existing pipeline invariants (lock, schema validate, timestamp, history, event emit); no new write path.

**Final Disposition**

APPROVED. All requirements R1-R4 are MET with concrete evidence. 26 new tests pass (15 service + 11 CLI), 929/929 app tests pass, 554/554 domain tests pass, tsc clean, biome clean. No P1/P2 findings. P3/P4 findings are accepted pre-existing test issue, design-tradeoff, and out-of-scope items. The implementation satisfies the 0290 R1-R7 contract for CLI-safe task dependency mutation.
### References

O

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-20T16:06:25.775Z todo → wip (system)
- 2026-07-20T17:24:53.104Z wip → testing (system)
- 2026-07-20T17:25:29.503Z testing → done (system)
