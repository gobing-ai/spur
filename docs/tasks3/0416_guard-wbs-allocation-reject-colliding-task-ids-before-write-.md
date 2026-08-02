---
template: issue
schema_version: 1
name: "Guard WBS allocation: reject colliding task IDs before write and honor baseCounter"
description: ""
status: todo
type: issue
profile: standard
feature_id: F2
parent_wbs: null
priority: P1
tags: ["bug"]
dependencies: []
created_at: "2026-08-02T13:26:38.152Z"
updated_at: "2026-08-02T13:28:36.306Z"
---

## 0416. Guard WBS allocation: reject colliding task IDs before write and honor baseCounter

### Background
On 2026-08-02, `spur task create` allocated WBS **0414 twice** and the second create replaced the
first task on disk. The lost task's content survived only because the author happened to keep the
section bodies in scratchpad files; it was restored as 0415. **Nothing in the CLI warned, errored, or
logged.** The first indication was a human noticing the returned WBS looked familiar.

That is a silent data-loss path in the corpus write layer — the one surface the whole harness treats
as authoritative.

#### Root cause: allocate-then-write with no collision check

`packages/app/src/services/task-service.ts`:

```
:593   const wbs = await this.allocateWbs();
:595   const filePath = this.resolveTaskPath(wbs, slug);
       → write (no existence check on filePath, ever)
```

`allocateWbs()` (`:1484-1508`) scans the configured task folders for `^(\d{4})_.*\.md$` and returns
`max + 1`. It is a **read-then-write with no reservation, no locking, and no verification that the
resulting path is free.** Whatever makes the scan return a stale max — a concurrent create, a
transient read failure, an unscanned write target — becomes silent corruption rather than a loud
error.

Note the filename embeds the slug (`resolveTaskPath(wbs, slug)`), so the usual outcome of a repeated
WBS is **two files sharing one WBS prefix under different names**, both looking valid, with
`spur task show <wbs>` silently resolving to whichever the locator finds first. That is arguably
worse than a clean overwrite, because nothing looks broken.

**Corpus audit (2026-08-02):** no duplicate WBS prefixes exist across `docs/tasks`, `docs/tasks2`,
`docs/tasks3` today. The defect is live, not historic.

#### Second, independent defect: `baseCounter` is dead config

| Surface | Field |
|---|---|
| `packages/config/src/index.ts:45` | `baseCounter: z.number().int().nonnegative().default(0)` |
| `packages/app/src/services/task-service.ts:1493` | `folders[dir]?.**base_counter**  ?? 0` |

The allocator reads a snake_case key the schema never produces, so the configured floor is **always
`0`**. `.spur/config.yaml` declares `baseCounter: 348` for `docs/tasks3` and `128` for `docs/tasks2`;
both are silently ignored.

Compounding it, `:1489` builds `dirs` from `Object.keys(foldersConfig.folders)` — **relative** paths
— while `this.ctx.tasksDir` is absolute, so `folders[dir]` misses for the active folder even if the
field name were right.

Today this is masked: the file scan finds `0415`, well above every configured floor. It stops being
masked the moment a folder is emptied, archived, or newly added — then allocation restarts from the
other folders' max and **collides by construction**.

#### What was ruled out

- **cwd dependence** — tested: `task create` from `packages/` allocated correctly (`0417` after
  `0416`). Config and folder resolution are cwd-independent.
- **A pre-existing duplicate causing it** — audited: no duplicate WBS prefixes in the corpus.
- **The dedup guard** — the two creates had different titles and different features, so
  `duplicate-follow-up` was never in play.

#### What is *not* known

The specific trigger for the 0414 repeat was not reproduced. Three sequential creates allocated
`0415 / 0416 / 0417` correctly, and the sandbox blocked backgrounding, so concurrent creates could
not be tested.

**This does not block the fix, and the fix should not wait for it.** A guard that refuses to write a
WBS that already exists makes the trigger irrelevant: whatever the cause, the outcome becomes a loud
error instead of silent loss. Reproducing the trigger is worth doing (R6) but it is a diagnostic, not
a prerequisite.
### Requirements
- **R1 — Never write over an existing task ID.** Before writing a created task, verify no file with
  that WBS prefix exists in **any** configured folder. On collision, fail with a non-zero exit and a
  diagnostic naming the WBS, the existing file, and the attempted one. Silent overwrite and silent
  duplicate-prefix creation are both unacceptable outcomes. This is the requirement that makes the
  unreproduced trigger irrelevant.

- **R2 — The guard covers every allocation path.** `allocateWbs()` has two callers
  (`task-service.ts:593` create, `:1259`). Both are guarded, and a new caller cannot bypass the check
  — put the guard where allocation happens, not in each caller.

- **R3 — Fix the `baseCounter` read.** The allocator must read the field the schema produces
  (`baseCounter`, `packages/config/src/index.ts:45`), not `base_counter` (`task-service.ts:1493`), and
  must look folders up by a key shape that actually matches (`:1489` mixes relative folder keys with
  an absolute `tasksDir`). After the fix, a configured floor demonstrably raises allocation.

- **R4 — Allocation floors must hold when a folder is empty.** With `baseCounter` honored, an empty or
  newly added folder allocates above its floor rather than restarting from another folder's max. This
  is the collision-by-construction case the current bug masks.

- **R5 — Diagnose the residual race.** Determine whether concurrent `spur task create` invocations can
  allocate the same WBS. If they can, either serialize allocation or make the R1 guard retry-with-
  next-free rather than fail. Record the finding either way — including "not reproducible", with what
  was tried.

- **R6 — Detect existing corruption.** A check surfaces duplicate WBS prefixes across all configured
  folders, so a corpus that already drifted is discoverable rather than latent. Wire it where corpus
  checks already run rather than inventing a new entry point.

- **R7 — Regression coverage.** Tests prove: a colliding write is refused with a useful diagnostic;
  both allocation callers are guarded; `baseCounter` is honored, including for an empty folder; the
  duplicate-prefix detector finds a planted duplicate. Each mutation-checked — removing the guard must
  fail its test.
### Acceptance Criteria
**Collisions become loud (R1, R2)**

- [ ] Creating a task whose allocated WBS already exists as a `^<wbs>_` prefix in **any** configured folder fails with a non-zero exit — it never overwrites and never creates a second file sharing the prefix.
- [ ] The diagnostic names the WBS, the existing file path, and the attempted path. "Collision detected" alone is not actionable.
- [ ] Both `allocateWbs()` callers (`task-service.ts:593`, `:1259`) are covered; the guard lives at the allocation seam so a future caller cannot bypass it.
- [ ] Mutation-checked: removing the guard makes the collision test fail.

**`baseCounter` actually works (R3, R4)**

- [ ] The allocator reads `baseCounter` — the field `packages/config/src/index.ts:45` produces — not `base_counter`.
- [ ] Folder lookup uses one consistent key shape; the **active** folder's floor is found (today `:1489` mixes an absolute `tasksDir` with relative folder keys, so it is missed even after the rename).
- [ ] A folder configured with `baseCounter: N` and containing **no** task files allocates above `N`, not from another folder's max. This is the collision-by-construction case.
- [ ] `.spur/config.yaml`'s declared floors (`docs/tasks2: 128`, `docs/tasks3: 348`) are honored — verified by test, not by reading the config.
- [ ] Floors were **not** raised in config to mask the bug.

**Residual race understood (R5)**

- [ ] Concurrent `spur task create` behavior is determined and recorded: either the race is reproduced and addressed, or it is documented as not reproducible with the methods tried. An unexamined "probably fine" does not satisfy this.
- [ ] If the race is real, the chosen response (serialize, or retry-with-next-free) is recorded with rationale. Retry is only acceptable **after** the race is understood — retrying to avoid diagnosing is what turns a bug into a silent workaround.

**Existing corruption is detectable (R6)**

- [ ] A check surfaces duplicate WBS prefixes across all configured folders and reports each offending pair.
- [ ] It runs where corpus checks already run — no new entry point invented.
- [ ] Verified against a planted duplicate, and against the real corpus (which had **none** as of 2026-08-02, so a clean run must not be mistaken for the check not running).

**Scope (R7)**

- [ ] No locking framework, WBS registry, transactional-write layer, or corpus-repair tool.
- [ ] The `<wbs>_<slug>.md` naming scheme is unchanged.
- [ ] The guard reuses `TaskLocator`'s existing folder scan rather than adding a second directory walk per create.

**Gates**

- [ ] `bun run lint`, `bun run test`, `bun run build` green. **Full suite, not a subset** (`sp:code-verification` Step 11); bucket failures by cause — port/listen/`ps` is environmental, anything else is yours.
### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design
The fix is small and its location is exact. Resist widening it into a corpus-integrity framework.

#### R1 is the whole safety story

```
:593   const wbs = await this.allocateWbs();
:595   const filePath = this.resolveTaskPath(wbs, slug);
       ← the check belongs here: does any file with this WBS prefix already exist?
```

`TaskLocator` already scans folders by WBS (`task-locator.ts:98`, `:120` iterate `folderDirs()`), so
the lookup exists — reuse it rather than writing a second scan. On a hit, throw a typed error the CLI
maps to a non-zero exit, in the shape of the existing `DuplicateFollowUpError` (`:590`), which already
demonstrates the pattern for "refuse and name the existing WBS".

**Fail vs. retry.** Preference: **fail loudly** first. A collision means allocation is wrong, and
silently retrying with the next free number hides that. If R5 proves a benign concurrency race,
retry-with-next-free becomes defensible — but only with the race understood, not as a way to avoid
understanding it.

#### R3 is a two-line fix with a trap

Renaming `base_counter` → `baseCounter` is trivial. The trap is `:1489`:

```ts
const dirs = foldersConfig ? [...new Set([tasksDir, ...Object.keys(foldersConfig.folders)])] : [tasksDir];
//                                         ^absolute            ^relative keys
```

`folders[dir]` is then looked up with entries of *both* shapes. Normalize to one (resolve the keys, or
keep a relative→config map alongside the resolved dir list) and add a test that the active folder's
floor is found — the current code silently misses it for `tasksDir` even with the field name fixed.

**Do not** simply raise the floors in `.spur/config.yaml` to paper over this. The floors are correct;
the read is broken.

#### Traps

- **Guarding only the create path.** Two callers allocate (`:593`, `:1259`). R2 exists because a guard
  in one is a guard in neither.
- **Treating the unreproduced trigger as a blocker.** The guard is correct regardless of cause; R5 is
  diagnostic, sequenced after R1.
- **Widening scope.** Locking, transactional writes, a WBS registry, or a corpus-repair tool are all
  out of scope. The deliverable is: collisions become loud, and the configured floor works.
- **The check is not free.** It runs per create. Reuse the locator's existing scan rather than adding
  a second directory walk per call.

#### Out of scope

Repairing a corpus that already has duplicates (none exist today — audited 2026-08-02); a WBS
reservation/registry service; changing the `<wbs>_<slug>.md` naming scheme; migrating folders.
### Plan
**Phase 1 — the guard (do this first; it is the whole safety story)**

- [ ] Add the pre-write existence check at the allocation seam so both callers (`task-service.ts:593`, `:1259`) inherit it. Reuse `TaskLocator`'s folder scan (`task-locator.ts:98`, `:120`) — do not add a second directory walk.
- [ ] Throw a typed error the CLI maps to a non-zero exit, modeled on `DuplicateFollowUpError` (`:590`), naming the WBS and both paths.
- [ ] Test + mutation-check: removing the guard fails the test.

**Phase 2 — `baseCounter`**

- [ ] Rename the read `base_counter` → `baseCounter` (`:1493`).
- [ ] Normalize the key shape at `:1489` so `folders[dir]` resolves for the active folder too — the rename alone does not fix this.
- [ ] Test: an empty folder with `baseCounter: N` allocates above `N`. Test: the real config's floors are honored.

**Phase 3 — diagnose the race (R5)**

- [ ] Attempt concurrent `spur task create` invocations. Note: the sandbox blocked backgrounding during the original investigation — run this outside the sandbox or with a harness that can fork.
- [ ] If reproduced: decide serialize vs. retry-with-next-free and record why. If not: record what was tried so the next person does not redo it.

**Phase 4 — duplicate detection (R6)**

- [ ] Add duplicate-WBS-prefix detection to an existing corpus check surface.
- [ ] Verify against a planted duplicate **and** against the clean real corpus.

**Phase 5 — gates**

- [ ] `bun run lint`, `bun run test`, `bun run build`. Full suite; bucket failures by cause.
- [ ] Re-run the corpus duplicate audit and record the result.
### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
**Incident**

- 2026-08-02: `spur task create` allocated WBS 0414 twice; the second create replaced the first task
  on disk with no warning. Content recovered from scratchpad copies and restored as task 0415.

**Root cause — allocate-then-write, no collision check**

- `packages/app/src/services/task-service.ts:593` — `const wbs = await this.allocateWbs()`
- `:595` — `resolveTaskPath(wbs, slug)` → write, with no existence check between
- `:1259` — the second allocation caller
- `:1484-1508` — `allocateWbs()`: scan `^(\d{4})_.*\.md$` across folders, return `max + 1`
- `:590` — `DuplicateFollowUpError`, the existing "refuse and name the existing WBS" pattern to model

**Second defect — dead `baseCounter`**

- `packages/config/src/index.ts:45` — schema produces `baseCounter`
- `packages/app/src/services/task-service.ts:1493` — allocator reads `base_counter` → always `?? 0`
- `:1489` — `dirs` mixes absolute `tasksDir` with relative `Object.keys(folders)`, so `folders[dir]`
  misses for the active folder regardless of the field name
- `.spur/config.yaml:154-165` — declares `docs/tasks2: 128`, `docs/tasks3: 348` (both ignored today)

**Reuse, do not reinvent**

- `packages/app/src/services/task-locator.ts:70` — folder list construction
- `:91`, `:98`, `:120` — existing per-folder scans the guard should reuse

**Ruled out during investigation (do not redo)**

- **cwd dependence** — `task create` from `packages/` allocated `0417` correctly after `0416`.
- **Pre-existing corpus duplicates** — audited across all three folders: none. (`0347-inventory.md`
  is a hyphenated non-task file and does not match `^(\d{4})_.*\.md$`.)
- **The dedup guard** — the two colliding creates had different titles and different features, so
  `duplicate-follow-up` never applied.

**Not reproduced**

- The specific trigger for the 0414 repeat. Three sequential creates allocated `0415/0416/0417`
  correctly; concurrent creates could not be tested because the sandbox blocked backgrounding.
### History
