---
name: fix the default config files container for spur
description: fix the default config files container for spur
status: done
created_at: 2026-06-07T04:09:20.796Z
updated_at: 2026-06-07T21:34:46.314Z
folder: docs/tasks
type: task
feature-id: ""
impl_progress:
  planning: done
  design: done
  implementation: done
  review: done
  testing: done
---

## 0023. fix the default config files container for spur

### Background

This is a cross project fixing issue for current project and ts-libs project in `~/xprojects/ts-libs`. The subject of this issue is how to store these config files in at source code layer and application layer.So far, current project relies on a package `@gobing-ai/ts-rule-engine` in ts-libs project which located in `~/xprojects/ts-libs/packages/rule-engine`.

As two use cases for tool `spur` with global common support, each project has its own `.spur` folder at the root of the project, that's good.

The issues are:
- As a rule engine package, right now, it has a folder in `~/xprojects/ts-libs/packages/rule-engine/rules` to store all default rule files and preset files for `spur rule` incorrectly.
- Meanwhile, at current project, the source of `spur`, we missed this kind of folder to store default config files for `spur` as the single source of truth for all these default config files.
- Due to the above issues, we embedded some default config files contents in current project for command `spur init`, so that we can help to create these default config files for new projects.

We need to fix these issues by moving these default config files to the proper place into current project, so that they can be managed as source code and application layer resources. Meanwhile, we also need to figure out how to deal with the installation procedure and the project initialization procedure (share the same logic? or separate them? TBD)

#### Pending questions
Before we start to fix these issues, we need to figure out the following questions, they will help to make the correct decision on how to fix these issues:
- When end user use command `bun install -g @gobing-ai/spur-cli` to install `spur` as a global tool, where should we store the default config files? ~/.bun/install/global/node_modules/@gobing-ai/spur-cli? ~/node_modules/@gobing-ai/spur-cli ? or any other place?

- If we named the folder name be `config`, which contains `confg/rules`, `config/workflows`, `config/plugins` and etc subfolders. Must we store these folder into `apps/cli` or we can out them anywhere and just ensure they can be found by the build commnad?

- What's the suggested way to copy these files to `~/.config/spur/` as the user global config directory after we executed `bun install -g @gobing-ai/spur-cli` or `bunx @gobing-ai/spur-cli init`.

#### Intentional design
If possible, I tent to go with this way:
- Store all these config files into `/config`, which contains `confg/rules`, `config/workflows`, `config/plugins` and etc subfolders
- When we build the `spur` CLI in `apps/cli`, copy these config files to the proper place(`dist/config`)
- When we install the `spur` CLI tool, copy these config files to the proper place(`~/.config/spur/` or `./node_modules/@gobing-ai/spur-cli`?).
- When we use `spur init` to initialize a new project, copy these config files from the the source folder(`~/.config/spur/` or `./node_modules/@gobing-ai/spur-cli`?) to current project's `.spur` folder.

- To ensure folder `config` is the real single source of truth for these config files, we also need to add the following symbolic link to the `config` folder:
```
- .spur/rules -> config/rules
- .spur/workflows -> config/workflows
- .spur/plugins -> config/plugins
```

### Requirements
- Investigate how to fix this issue on both projects (current project and project ts-lib in `~/xprojects/ts-libs`)
- Fix the relevant part in both projects


### Q&A



### Design

Parent tracking task. Decomposed into three sequential subtasks (0024→0025→0026) plus one cross-repo task in ts-libs (0022). Design contract and locked decisions are documented in the Solution section below. Key architectural decisions codified in ADR-015 (`docs/00_ADR.md`) and surface design in `docs/04_DESIGN.md §2.3`.

### Solution

Decomposed per ADR-015 (`docs/00_ADR.md`) and `04 §2.3` design. Decomposition is by **deliverable + repo boundary**, not implementation phase. Execution continues on the child tasks below; this parent stays open as the tracking task.

#### Subtasks (spur-new — this repo)

- [ ] [0024 — Centralize spur default config into repo-root config tree](0024_centralize_spur_default_config_into_repo-root_config_tree.md)
- [ ] [0025 — Wire config resolution, build pipeline, and global seed](0025_wire_config_resolution_build_pipeline_and_global_seed_for_spur.md)
- [ ] [0026 — Redesign `spur init` from config tree; drop bare `recommended` preset](0026_redesign_spur_init_from_config_tree_and_drop_bare_recommended_preset.md)

#### Subtask (ts-libs — `~/xprojects/ts-libs`, separate repo)

- [ ] **ts-libs 0022** — Remove spur-specific presets from rule-engine; add generic `example.yaml` (`~/xprojects/ts-libs/docs/tasks/0022_remove_spur-specific_presets_from_rule-engine_and_add_generic_example_preset.md`)

**Dependency order:** `0024 → 0025 → 0026 → (ts-libs 0022)`

ts-libs 0022 is **blocked** until spur-new 0024–0026 are merged and green — only then are `recommended.yaml`/`spur-dev.yaml` orphaned and safe to delete. This ordering prevents a broken intermediate state where spur-new has dropped the bundled presets but ts-libs still ships them (or vice versa).

**Estimated total effort:** 12–15 hours (spur-new 12h + ts-libs 3h).

#### Locked decisions (this task's design contract)

| # | Decision |
|---|----------|
| D1 | SSOT = repo-root `./config/{rules,workflows,plugins}` |
| D2 | rule-engine keeps only generic demo rules (one per builtin evaluator) + `example.yaml` |
| D3 | Drop `recommended.yaml` + `spur-dev.yaml` from ts-libs (renamed equivalents already in spur-new) |
| D4 | Rewrite rule-engine tests to reference generic `example.yaml` |
| D5 | `init` = structured-but-explicit (file reads + `scaffold-manifest.ts`, no embedded TS strings) |
| D6 | Eliminate bare `recommended` preset; `recommended-pre-check` is the new default (BREAKING) |
| D7 | No symlinks in install/init; copy-and-resolve three-layer model retained |

#### Risks

1. **`--compile` binary** (`dist/cli/spur`) can't read sibling `dist/config`; relies on `~/.config/spur` seed. Acceptable — `bun install -g` uses `dist/index.js` (primary path).
2. **`recommended` drop is user-visible** — needs `BREAKING CHANGE:` footer (acceptable pre-1.0).
3. **Cross-repo version coupling** — ts-libs 0022 requires a coordinated rule-engine release before spur-new can consume the cleaned package; sequencing above prevents a broken middle state.


### Plan

- [x] 0024 — Centralize spur default config into repo-root config tree (Done)
- [x] 0025 — Wire config resolution, build pipeline, and global seed (Done)
- [x] 0026 — Redesign `spur init` from config tree; drop bare `recommended` preset (Done)
- [ ] ts-libs 0022 — Remove spur-specific presets from rule-engine (separate repo, not blocking this task)

### Review

Verdict: **PASS** — all spur-new subtasks (0024, 0025, 0026) are Done with full verification.
- `bun run spur-check`: 21/21 rules pass, 549 tests pass, 0 fail.
- Config tree at repo-root `config/` is the single source of truth.
- Build copies `config/` → `dist/config/`; bundled config layer resolves at runtime.
- `spur init` reads from manifest + `bundledConfigRoot()`, no embedded TS strings.
- Bare `recommended` preset dropped; `recommended-pre-check` is the new default (BREAKING CHANGE).

### Testing

- Command: `bun run spur-check` (lint + typecheck + pre/post-check rules + full test suite)
- Scope: 549 tests across 71 files
- Result: **pass** — 549 pass, 0 fail, coverage 99.80% functions / 99.47% lines
- ts-libs 0022 has its own test scope in that repo; not part of this verification.

### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |
| config | config/rules/recommended-pre-check.yaml (new) | lord-robb | 2026-06-07 |
| config | config/rules/recommended-post-check.yaml (new) | lord-robb | 2026-06-07 |
| config | config/workflows/basic.yaml (new) | lord-robb | 2026-06-07 |
| source | packages/config/src/bundled-config.ts (new) | lord-robb | 2026-06-07 |
| source | apps/cli/src/config/scaffold-manifest.ts (new) | lord-robb | 2026-06-07 |
| source | apps/cli/src/commands/init.ts (rewrite) | lord-robb | 2026-06-07 |
| source | apps/cli/src/commands/rule.ts (default preset rename) | lord-robb | 2026-06-07 |
| source | packages/app/src/services/rule-service.ts (bundled-config layer) | lord-robb | 2026-06-07 |
| test | packages/config/tests/bundled-config.test.ts (new) | lord-robb | 2026-06-07 |
| test | apps/cli/tests/config/scaffold-manifest.test.ts (new) | lord-robb | 2026-06-07 |
### References
