---
name: init
description: "spur-cli noun reference for `spur init` and `spur status`: CLI verbs (init scaffold with --name/--force/--minimal, status with --json) plus post-scaffold init validation for /sp:spur-init - Phase 1.5 functional-validation probes and Phase 1.6 rule-glob adaptation."
see_also:
  - spur-cli
---

# spur init / spur status - CLI verbs and post-scaffold validation

## CLI verbs

| Verb | Purpose | Key flags |
| ---- | ------- | --------- |
| `init` | Scaffold a new Spur project in the current directory | `--name <name>` `--force` `--minimal` `--json` |
| `status [path]` | Show project and git status for a Spur project | `--json` |

### `spur init` - scaffold a Spur project

```bash
spur init                            # interactive: prompt for project name
spur init --name my-project          # non-interactive
spur init --name my-project --force  # overwrite existing .spur/ files
spur init --minimal                  # skip optional scaffolding (rules, workflows)
spur init --json                     # machine-readable
```

Materializes the `.spur/` directory tree with config, docs, rules, and workflow templates. The
post-scaffold validation probes (Phase 1.5 / 1.6, below) run immediately after this verb completes.

#### Flags

| Flag | Purpose |
|------|---------|
| `--name <name>` | Project name (skips interactive prompt). |
| `--force` | Overwrite existing `.spur/` files. Without it, existing files are preserved. |
| `--minimal` | Skip optional scaffolding (rules presets, workflow templates). Core config + docs only. |
| `--json` | Output machine-readable JSON instead of interactive summary. |

### `spur status [path]` - project and git status

```bash
spur status                          # current directory
spur status /path/to/project         # specific project
spur status --json                   # machine-readable
```

Reports the project's Spur configuration state (init status, feature/task counts, rule preset
health) and git working-tree status. Optional `[path]` argument targets a different project
directory.

## Post-scaffold validation

Two probes sit between the deterministic scaffold (`spur init`) and the non-deterministic doc
customization: Phase 1.5 (functional validation) confirms the fresh tree is immediately functional;
Phase 1.6 (rule glob adaptation) rewrites layout-dependent rule globs so `recommended-pre-check`
runs clean on this project's layout. The executing agent owns content *adaptation* only — `spur
init` owns *file materialization* (`04_DESIGN.md` §1.1 "Init ownership contract").

### Phase 1.5 — Functional validation probe

Before any customization, confirm the fresh scaffold is immediately functional. If any probe
fails, STOP and report the gap rather than papering over it with customization:

```
spur status
spur task create "__probe__" --template standard   # confirms task template + matrix resolve
spur workflow validate task-pipeline.yaml
```

### Phase 1.6 — Rule glob adaptation (LLM-as-judge)

The bundled `recommended-pre-check` preset ships globs calibrated to Spur's own monorepo
(`apps/**/*.ts`, `packages/**/*.ts`, `scripts/**/*.ts`). On any other layout these match zero
files, and `rg` exits 2 ("No files were searched") — surfacing as `kind: "error"` findings that
obscure real violations. Rather than ship a broken probe, **you (the executing agent) ARE the
LLM-as-judge**: inspect the project tree and rewrite layout-dependent globs to match reality.

**You are NOT creating scaffold files.** Adapted rule files under `.spur/rules/<category>/` are
customization overlays — the local layer shadows the bundled layer (first-layer-wins by relative
path, `04_DESIGN.md` §1.1). This is content adaptation of rule globs, exactly analogous to the
doc edits in Phase 2, not file materialization.

Steps:

1. **Detect layout.** Inspect top-level dirs + manifest files to classify the project:
   - Monorepo (Bun workspaces / npm workspaces / pnpm): `apps/` + `packages/` present, or
     `package.json` has a non-empty `workspaces` field.
   - Single-package TS/JS: `src/`, `test/` or `tests/`, single `package.json`, no workspaces.
   - Flat script repo: `.ts`/`.js` files at root or one shallow dir, no `src/`.
   - Polyglot / non-TS (Python/Go/Rust primary): primary source lives under non-TS globs;
     TS rules become correct no-ops and need no adaptation (skip to step 5).

2. **Read the resolved preset.** `spur rule list --preset recommended-pre-check --json` returns
   the category → rule-file map with resolved paths (bundled vs. global vs. local).

3. **For each category** (`typescript`, `structure`, `boundary`, `surface`, `ui`), read the
   resolved rule file and identify layout-dependent `include` globs. The Spur-monorepo anchors
   that almost always need rewriting:
   - `apps/**/*.ts`, `packages/**/*.ts`, `scripts/**/*.ts` → project's actual TS source roots
   - `apps/**/*.test.ts`, `packages/**/*.test.ts` → project's actual test roots
   - `apps/*/package.json`, `packages/*/package.json` → workspace manifests (or root `package.json`)
   - `apps/web/src/**`, `apps/server/src/**` → single web/server entry roots

4. **Write adapted overrides.** For each rule file with layout-dependent globs, copy the bundled
   content to `.spur/rules/<category>/<rule-file>.yaml`, then rewrite only the layout-dependent
   globs to match the detected roots. Preserve all non-layout globs (`**/*.ts`, `**/node_modules/**`,
   `.spur/rules/**`), rule `id`s, evaluators, and severities verbatim. Write via the `Write` tool.

5. **Verify the adaptation.** Re-run the probe that motivated this phase:
   ```
   spur rule run --preset recommended-pre-check --json
   ```
   Acceptance: **zero findings with `kind: "error"`**. Genuine violations surface as
   `kind: "violation"` and are expected on a real codebase — they are NOT adaptation failures.
   If `kind: "error"` findings remain, their globs still mismatch; re-read those rule files and
   widen the adapted globs. Idempotency: if `.spur/rules/<category>/` already holds hand-tuned
   overrides for a rule (differs from the bundled content), skip re-adapting that rule.

Phase 2 customization proceeds only after this probe is clean.
