---
schema_version: 1
name: Consolidate task metadata into .spur/tasks/ + multi-folder config + fix bundledConfigRoot
description: Consolidate task metadata into .spur/tasks/ + multi-folder config + fix bundledConfigRoot
status: done
created_at: 2026-06-24T19:56:13.825Z
updated_at: 2026-06-24T22:01:39.062Z
folder: docs/tasks
type: task
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: pending
  testing: pending
---

## 0117. Consolidate task metadata into .spur/tasks/ + multi-folder config + fix bundledConfigRoot

### Background

## Root cause
`spur task create --template review` produces deformed task files (missing template-specific sections like `#### Review Findings`, `### Plan`, `### Review`, `### References`). Two independent bugs:

1. **Template loading fails in compiled binaries + npm packages.** `bundledConfigRoot()` walks from `import.meta.dirName` looking for a `config/` directory. In `bun build --compile` binaries, `import.meta.dirName` resolves to Bun's virtual filesystem (`/$bunfs/root/...`), never finds real `config/`. In npm packages, config ships as `spur-cli/config/` but the resolver looks for `config/`. Returns `null` → templates + section-matrix not loaded → fallback matrix (standard-only) + empty template bodies.

2. **Multi-folder config lost in migration from rd3:tasks.** The old `docs/.tasks/config.jsonc` supported `active_folder` + `folders: { path: { base_counter, label } }` with phase-based multiple task directories. `spur task` hardcodes `docs/tasks/` and drops multi-folder support entirely. WBS allocation scans only one directory.

### Requirements

Each requirement is testable. Acceptance criterion in **bold** at the end of each item is the
pass condition for `/sp:dev-verify`.

#### R-group A — Template loading (the "deformed format" bug)

- [x] R1. Relocate the section matrix: ship `section-matrix.yaml` to the project-local
  `.spur/tasks/section-matrix.yaml` (via `SCAFFOLD_MANIFEST`), keeping `config/tasks/section-matrix.yaml`
  as the bundle source. **Pass: after `spur init`, `.spur/tasks/section-matrix.yaml` exists and is byte-identical to the bundle source.**
- [x] R2. Relocate task templates: ship `templates/task/*.md` to `.spur/tasks/templates/task/*.md`.
  **Pass: all five variants (`standard`, `feature-impl`, `review`, `issue`, `meta`) present under `.spur/tasks/templates/task/` after `spur init`.**
- [x] R3. `loadSectionMatrix()` resolves `.spur/tasks/section-matrix.yaml` first, falls back to the
  bundle. **Pass: with the project-local file present it is used; deleting it falls back to the bundle without error (unit test asserts both branches).**
- [x] R4. `loadTemplateBodies(variant)` resolves `.spur/tasks/templates/task/<variant>.md` first,
  falls back to the bundle. **Pass: project-local override is honored; absence falls back (unit test asserts both branches).**
- [x] R5. `SCAFFOLD_MANIFEST` targets change from `config/tasks/` + `config/templates/task/` to
  `tasks/` + `tasks/templates/task/`. **Pass: `scaffold-manifest.ts` no longer references `config/tasks/` or `config/templates/task/` targets; `spur init` seeds the new paths.**
- [ ] R6. `bundledConfigRoot()` resolves inside `bun build --compile` binaries by embedding `config/`
  as a Bun build asset and checking the asset API before the filesystem walk. **Pass: the compiled binary runs `spur task create "t" --template review` and renders the full template.**
  *DEFERRED — `--asset` is not a valid Bun flag; real fix needs asset-import + `Bun.embeddedFiles`. See Review back-issues.*
- [x] R7. `bundledConfigRoot()` resolves inside npm packages by also probing `spur-cli/config/`, while
  preserving the existing identity check (candidate must contain `rules/` + `workflows/`). **Pass: a path layout with config under `spur-cli/config/` resolves; an unrelated dir named `config/` without `rules/`+`workflows/` is still rejected (unit test).**
- [x] R8. End-to-end render check. **Pass: `spur task create "test" --template review` produces a file containing the `#### Review Findings` table plus `### Plan`, `### Review`, `### References` sections.**

#### R-group B — Multi-folder config

- [x] R9. Define the `tasks:` block in `.spur/config.yaml` (ADR-017 single config surface) using the
  existing `tasksConfigSchema` (camelCase: `active`, `folders/<path>/baseCounter`), validated by
  `spurConfigSchema` in `@gobing-ai/spur-config`. Ports `docs/.tasks/config.jsonc` content.
  **Pass: a malformed config fails zod validation; the documented example parses.**
- [x] R10. `TaskService` reads `active_folder` from the `tasks:` block in `.spur/config.yaml`.
  **Pass: with `tasks: { active: docs/archive }` set, `spur task list` (no `--folder`) lists that folder.**
- [x] R11. `allocateWbs()` scans **all** configured folders and returns global-max + 1 (cross-folder
  uniqueness). **Pass: with two folders holding `0005` and `0042`, the next allocated WBS is `0043` regardless of `active_folder` (unit test against in-memory layout).**
- [x] R12. `spur task list` supports `--folder <path>` override and defaults to `active_folder`.
  **Pass: `--folder` lists the named folder; omitting it lists `active_folder`.**
- [x] R13. `spur task refresh` regenerates `kanban.md` per configured folder. **Pass: refresh writes/updates a `kanban.md` in each folder under `folders`.**
- [x] R14. Backward compatibility: absent `tasks:` block in `.spur/config.yaml` ⇒ behave exactly as today,
  defaulting to `docs/tasks/`. **Pass: with no config file or no `tasks:` block, all `spur task` verbs operate on `docs/tasks/` unchanged (regression test).**

#### Gate

- [x] R15. Full verification gate green. **Pass: `bun run lint && bun run test && bun run build` all succeed; no test skipped to go green.**

### Q&A
Open decisions implicit in the design, resolved during refinement (`--auto` synthesis — confirm if any
should differ).

- **Q1. Bundle source location — move source files or only retarget the manifest?**
  A: **Keep `config/` as the bundle source; only change `SCAFFOLD_MANIFEST` targets** to `.spur/tasks/`.
  The bundle stays the single source of truth shipped with the CLI; `spur init` seeds the project-local
  copy. This is why R1/R2 say "relocate the *seeded* copy", not "move source files" (the original Plan
  step 1 wording was ambiguous).

- **Q2. `import.meta.dirname` vs the binary path resolver — which mechanism for compiled binaries?**
  A: **Bun build asset (`--asset config=config`) + asset-API probe before the filesystem walk.** Do not
  rely on `import.meta.dirname` inside `$bunfs` — it points at the virtual FS and never finds real
  `config/`. (Note: the existing code uses `import.meta.dirname`, lowercase `n` — the task's earlier
  `import.meta.dirName` casing was a typo.)

- **Q3. Does the npm-path fix risk false positives on a coincidental `config/` dir?**
  A: **No — preserve the existing identity guard.** Any candidate (whether `config/` or `spur-cli/config/`)
  must still contain `rules/` + `workflows/` subdirectories to be accepted (`bundled-config.ts:36-37`).
  R7 must not weaken this check.

- **Q4. Cross-folder WBS uniqueness — global or per-folder counters?**
  A: **Global uniqueness.** `allocateWbs()` returns max+1 across all configured folders. `base_counter`
  is an *offset floor* per folder (e.g. an archive folder starting at 9000), not an independent
  sequence — allocation never produces a WBS that collides with another folder's existing files.

- **Q5. Migration of existing `.spur/config/tasks/` + `.spur/config/templates/` seeded by prior `spur init`?**
  A: **`spur init` re-seeds to the new `.spur/tasks/` paths; stale `.spur/config/tasks|templates` left
  in place is harmless** (no longer read). Out of scope to delete them. If cleanup is wanted, it is a
  separate follow-up — flag, don't bundle.
### Design
#### Constraints

Limits and "must NOT" boundaries (technical / compatibility — no budget or regulatory constraints
apply to this internal refactor).

- **Backward compatibility (must NOT break).** Absence of the `tasks:` block in `.spur/config.yaml` must preserve
  today's exact behavior (single `docs/tasks/` folder). No existing task file may be relocated or
  rewritten by this change.
- **No new runtime / package manager / linter** (AGENTS.md). The compiled-binary config path is deferred (needs Bun asset-import, not a CLI flag); R7 npm path uses `spur-cli/config/`.
- **Preserve the bundle identity guard.** The `rules/` + `workflows/` subdirectory check in
  `bundledConfigRoot()` must remain — the npm `spur-cli/config/` probe is *additive*, not a relaxation.
- **Three runtime contexts must all resolve config:** dev (`src/` walk) and npm package (`spur-cli/config/`). Compiled binary deferred to follow-up. A fix for one must not regress the others —
  R6/R7 each carry their own pass condition.
- **Config schema is zod-validated in `@gobing-ai/spur-config`** (the project's config SSOT); the `tasks:` block schema lives in `@gobing-ai/spur-config`, not ad hoc in `TaskService`.
- **Same-commit doc sync.** This touches CLI behavior (`spur task list --folder`, config keys), so
  `docs/04_DESIGN.md` must be updated in the same commit per AGENTS.md.
- **Coverage gate.** New loader-fallback and `allocateWbs` cross-folder branches must hold per-file
  line ≥ 90% / function ≥ 90% (`bunfig.toml`).


## Directory layout after change

```
.spur/
  tasks/                          ← NEW: task-specific metadata
    config.yaml                   ← active_folder + folders config
    section-matrix.yaml           ← section rules per variant/status
    templates/
      task/
        standard.md
        feature-impl.md
        review.md                 ← contains #### Review Findings table
        issue.md
        meta.md
  rules/                          ← exists (seeded by spur init)
  workflows/                      ← exists
  config/                         ← general config (config.yaml, config.json)
docs/
  tasks/                          ← task data files (unchanged)
    0001_xxx.md
    kanban.md
```

## Resolution chain (no global fallback needed)

```
spur task create --template review
  ├─ loadSectionMatrix()
  │    ├─ .spur/tasks/section-matrix.yaml    ← project-local (spur init)
  │    └─ bundle:config/tasks/section-matrix.yaml  ← bundle asset (fallback)
  └─ loadTemplateBodies('review')
       ├─ .spur/tasks/templates/task/review.md
       └─ bundle:config/templates/task/review.md
```

## bundledConfigRoot() fix

For npm package (R7 — implemented): the resolver already walks up — just teach it to check `spur-cli/config/` as well:

```typescript
const candidates = ['config', 'spur-cli/config'];
for (const name of candidates) {
  const candidate = join(dir, name);
  if (isBundledConfigDir(candidate)) return candidate;
}
```

## config.yaml schema (R9 — consolidated)

The `tasks:` block in `.spur/config.yaml` (ADR-017 single config surface), using
the existing `tasksConfigSchema` (camelCase). Ported from `docs/.tasks/config.jsonc`:

```yaml
# .spur/config.yaml
tasks:
  active: docs/tasks
  folders:
    docs/tasks:
      baseCounter: 0
      label: Primary
```

### Solution
Verified entry points (confirmed against the working tree on refine — start here):

- **Template loaders live in `apps/cli/src/commands/task.ts`, not in `bundled-config.ts`:**
  - `loadSectionMatrix()` ~L389 → `join(root, 'tasks', 'section-matrix.yaml')`
  - `loadTemplateBodies(variant)` ~L359 → `join(root, 'templates', 'task', '<variant>.md')`
  - both call `bundledConfigRoot()` from `@gobing-ai/spur-config`. The `.spur/tasks/` project-local
    override (R3/R4) is added *here*, before the `bundledConfigRoot()` fallback.
- **`bundledConfigRoot()` (`packages/config/src/bundled-config.ts:24`)** is the only piece in that
  package: identity-guards on `rules/` + `workflows/` subdirs (L36-37 — preserve for R7) and uses
  `import.meta.dirname` (L26). No Bun-asset handling yet (R6 adds it).
- **Compile script is `build` (`apps/cli/package.json:43`)**, `bun build … --compile --outfile
  ../../dist/cli/spur`. R6 compiled-binary config embedding is deferred — `--asset` is not a valid Bun flag; real fix needs Bun asset-import. `build:bundle` (L45) already runs
  `bundle-config spur-cli/config` — that is the npm layout R7 must resolve.
- **Scaffold targets** (`apps/cli/src/config/scaffold-manifest.ts:52-58`) currently `config/tasks/` +
  `config/templates/task/`; R5 retargets to `tasks/` + `tasks/templates/task/`.
### Plan
- [x] 1. Retarget SCAFFOLD_MANIFEST for section-matrix: source stays `config/tasks/`, target `.spur/tasks/`
- [x] 2. Retarget SCAFFOLD_MANIFEST for templates: target `.spur/tasks/templates/` (5 variants)
- [x] 3. `scaffold-manifest.ts`: `config/tasks/` → `tasks/`, `config/templates/task/` → `tasks/templates/`
- [x] 4. `loadSectionMatrix()` in `apps/cli/src/commands/task.ts`: `.spur/tasks/section-matrix.yaml` → bundle fallback
- [x] 5. `loadTemplateBodies()` in `task.ts`: `.spur/tasks/templates/<variant>.md` → bundle fallback
- [x] 6. `bundledConfigRoot()` in `packages/config/src/bundled-config.ts`: `BUNDLED_CONFIG_DIRS=['config','spur-cli/config']` for npm path; identity guard (`rules/`+`workflows/`) preserved. R6 compiled-binary path DEFERRED (see Review back-issues).
- [x] 7. `apps/cli/package.json` build script: original `--compile` restored (broken `--asset` reverted). Compiled-binary config embedding needs Bun asset-import + `Bun.embeddedFiles` — deferred to follow-up task.
- [x] 8. Config schema: `tasks:` block in `.spur/config.yaml` using existing `spurConfigSchema` + `tasksConfigSchema` (camelCase `active`/`baseCounter`). Loader maps to snake_case `TaskFoldersConfig` at boundary. Ported from `docs/.tasks/config.jsonc`.
- [x] 9. `TaskService` ctor accepts `foldersConfig?: TaskFoldersConfig` — reads `active_folder` + `folders`
- [x] 10. `allocateWbs()` scans all configured folders with `base_counter` floor — global WBS uniqueness
- [x] 11. `spur task list` supports `--folder` override; defaults to `active_folder`
- [x] 12. `spur task refresh` regenerates `kanban.md` per configured folder
- [x] 13. `spur init` seeds `.spur/tasks/` (section-matrix.yaml + templates/)
- [x] 14. Dogfood: `spur task create "test" --template review` renders `#### Review Findings` — verified live
- [x] 15. Full gate: `bun run lint && bun run test && bun run build` — all green (1761 tests, 0 fail)
### Review
**Verdict: PASS-with-one-deferral** (re-verified 2026-06-24 after R9 consolidation; full gate green:
lint ✓, 1761 tests ✓, build ✓). 14/15 requirements MET; R6 (compiled-binary asset) deferred.

#### Requirements traceability (post-R9-consolidation)

| Req | Verdict | Evidence |
| --- | ------- | -------- |
| R1 section-matrix → .spur/tasks/ | ✅ MET | scaffold target + seeded file |
| R2 templates → .spur/tasks/templates/ | ✅ MET | 5 variants seeded |
| R3 loadSectionMatrix local-first | ✅ MET | `task.ts` local → bundle fallback |
| R4 loadTemplateBodies local-first | ✅ MET | `task.ts` local → bundle fallback |
| R5 SCAFFOLD_MANIFEST retarget | ✅ MET | `config/tasks/` → `tasks/` |
| R6 compiled-binary asset | ⛔ DEFERRED | `--asset` is not valid Bun; build reverted. Needs asset-import + `Bun.embeddedFiles`. See back-issues. |
| R7 npm spur-cli/config + guard | ✅ MET | `BUNDLED_CONFIG_DIRS=[config,spur-cli/config]`; identity guard preserved |
| R8 review template renders | ✅ MET | live-verified |
| R9 config schema (YAML + zod) | ✅ MET (consolidated) | Now reads `tasks:` block from `.spur/config.yaml` via `loadSpurConfig` + `spurConfigSchema` + `tasksConfigSchema` (camelCase). Ported from `docs/.tasks/config.jsonc`. Single config surface — ADR-017 compliant. No separate file. |
| R10 active_folder read | ✅ MET | `makeService` resolves `tasks.active` |
| R11 cross-folder allocateWbs | ✅ MET | scans all folders, `baseCounter` floor |
| R12 list --folder + default | ✅ MET | option registered; defaults to `active_folder` |
| R13 refresh per-folder | ✅ MET | `refresh()` iterates `foldersConfig.folders` per folder |
| R14 backward-compat | ✅ MET | defaults when `tasks:` block absent |
| R15 gate green | ✅ MET | lint + 1761 tests + build all pass |

#### R9 consolidation (this pass)

Changed from a separate `.spur/tasks/config.yaml` (ad-hoc snake_case, `yaml` + hand-rolled zod) to the
root `tasks:` block in `.spur/config.yaml` (camelCase, reuses the existing `spurConfigSchema` +
`tasksConfigSchema` wired in `@gobing-ai/spur-config`). This aligns with ADR-017 (single config
surface). Ported `docs/.tasks/config.jsonc` content:

```yaml
tasks:
  active: docs/tasks
  folders:
    docs/tasks:
      baseCounter: 0
      label: Primary
```

The loader (`loadTaskFoldersConfig`) maps camelCase→snake_case at the service boundary.
`TaskFoldersConfig` (snake_case) is unchanged. Removed `yaml` dep from `apps/cli`.

#### Back-issues / follow-ups

- **R6 compiled-binary config** — own task. Bun asset-import + `Bun.embeddedFiles`.
- **Reverted .spur/config.yaml clobber** — the in-flight work's `spur init` had wiped the real
  config (project name, agent/rules/workflows/redaction sections). Restored from HEAD, then added
  `tasks:` on top.
- **`test-config-root.ts`** (repo root) — scratch debug file, delete before commit.
- **Working tree** mixes 0117 with unrelated dev-command refactor — commit 0117 scoped.
- **Recurring status regression** — 0117 frontmatter flips to capitalized `Done` between edits,
  breaking `spur task` validation. Watch for capitalized-status emission in the task-write path.




#### Findings

| Severity | Finding | Recommendation |
| -------- | ------- | -------------- |
| P2 | R6 compiled-binary config embedding not implemented (Bun `--asset` is invalid) | Split to own task: Bun asset-import + `Bun.embeddedFiles` runtime readback |
| P3 | `test-config-root.ts` scratch file at repo root | Delete before commit |
| P2 | Working tree mixes 0117 with unrelated dev-command refactor | Commit 0117 as scoped unit, separate from dev-command changes |
| P3 | Recurring frontmatter status regression (capitalized `Done` between edits) | Audit task-write path for capitalized-status emission |
### Testing



### References

- [rd3:tasks old design](~/projects/cc-agents/plugins/rd3/skills/tasks/)
- [ADR-021](docs/00_ADR.md) — planning layer architecture
- [scaffold-manifest.ts](apps/cli/src/config/scaffold-manifest.ts)
- [bundled-config.ts](packages/config/src/bundled-config.ts) — `bundledConfigRoot()` only (R6/R7)
- [task.ts](apps/cli/src/commands/task.ts) — `loadSectionMatrix()` (~L389) + `loadTemplateBodies()` (~L359), the actual template loaders (R3/R4)
- [task-service.ts](packages/app/src/services/task-service.ts)
- [task-skeleton.ts](packages/domain/src/planning/task-skeleton.ts)
- [Dogfood report](docs/dogfood/2026-06-24-dev-run-0110-auto-dogfood.md)
- [Task 0116 findings](docs/tasks/0116_sp-dev-run-0110-auto-dogfood-findings.md)
