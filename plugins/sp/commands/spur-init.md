---
description: Initialize a new Spur project — scaffold config + docs, then customize for this project's stack and scope
argument-hint: "[--name <name>] [--minimal] [--force] [--skip-docs]"
allowed-tools: ["Bash", "Read", "Write", "Skill"]
---

# Spur Init

Wraps **`spur init`** (deterministic scaffold) + **sp:doc-evolve** (non-deterministic project
customization). This is the one command to bootstrap a fresh Spur project with the full doc
structure wired up.

## When to use

- Starting a brand-new project that will use Spur.
- The operator says "initialize this project," "set up Spur here," or "bootstrap the docs."
- After cloning an empty repo where Spur will manage the development workflow.

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `--name <name>` | Project name passed to `spur init` | current directory name |
| `--minimal` | Only write the minimal `.spur` scaffold (skip docs + templates) | (off) |
| `--force` | Recreate `.spur` config that already exists (docs are always preserved) | (off) |
| `--skip-docs` | Skip the post-scaffold doc customization step | (off) |

## Behavior

Two phases — deterministic scaffold first, then non-deterministic customization. **Ownership
contract:** this command owns content *adaptation* only; `spur init` owns *file materialization*
(`04_DESIGN.md` §1.1 "Init ownership contract"). The command NEVER creates scaffold files
itself — it edits content the CLI already wrote. Two probes sit between the phases: Phase 1.5
(functional validation) confirms the fresh tree is immediately functional; Phase 1.6 (rule glob
adaptation) rewrites layout-dependent rule globs so `recommended-pre-check` runs clean on this
project's layout.

### Phase 1 — Deterministic scaffold (`spur init`)

```
spur init --name <name> [--minimal] [--force] --json
```

This scaffolds (idempotent, never overwrites customized docs):
- `.spur/config.yaml` — minimal project config.
- `.spur/workflows/`, `.spur/rules/`, `.spur/templates/`, `.spur/tasks/templates/` — defaults
  (one template per `TASK_VARIANTS` entry, driven by `SCAFFOLD_MANIFEST`).
- `docs/99_PROJECT_CONSTITUTION.md` + `docs/00`–`docs/05` stubs — the doc structure.

### Phase 1.5 — Functional validation probe

Before any customization, confirm the fresh scaffold is immediately functional. If any probe
fails, STOP and report the gap rather than papering over it with customization:

```
spur status
spur task create "__probe__" --template standard   # confirms task template + matrix resolve
spur workflow validate .spur/workflows/task-pipeline.yaml
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
   `config/rules/**`), rule `id`s, evaluators, and severities verbatim. Write via the `Write` tool.

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

### Phase 2 — Non-deterministic customization (only if `--skip-docs` is absent)

After the scaffold + validation, customize the fresh project. **Every authoritative-doc touch
routes through `sp:doc-evolve`** to honor the constitution §5 sync triggers.

1. **Stack detection.** Read `package.json` / `Cargo.toml` / `go.mod` / `pyproject.toml` to detect
   the runtime, language, and framework. Record findings in `docs/03_ARCHITECTURE.md` §1 (module
   map) via `sp:doc-evolve`.
2. **PRD scope drafting.** Fill the placeholders in `docs/01_PRD.md` (vision, users, in/out/deferred
   scope) based on operator input. This is a **draft** — ask the operator to confirm scope before
   writing.
3. **Optional roadmap phase.** If the operator confirms an initial phase, register it in
   `docs/02_ROADMAP.md`. **Stage** this edit — present the proposed phase row, get explicit approval,
   then write via `sp:doc-evolve`.
4. **First ADR.** Propose `ADR-001` in `docs/00_ADR.md` recording the stack/framework decision
   (Context, Decision, Reason). Write via `sp:doc-evolve`.

Invoke the customization via the skill:

```
Skill(skill="sp:doc-evolve", args="customize --project <name>")
```

## Implementation

Phase 1 runs `spur init` directly (Bash). Phase 1.5 runs the validation probes via Bash and
halts on any failure. Phase 1.6 reads bundled rule files, detects the project layout, and writes
adapted overrides under `.spur/rules/<category>/` via the Write tool (local-layer shadowing, not
scaffold materialization). Phase 2 delegates to `sp:doc-evolve` for every doc touch.
- **Other platforms:** `Skill()` and `$ARGUMENTS` are Claude-specific. Run `spur init` via Bash,
  then invoke the `sp:doc-evolve` skill's `customize` operation directly.

## See also

- **sp:doc-evolve** — constitution-driven doc refresh; enforces §5 sync triggers on every doc touch.
- **sp:spur-dev** — the SSOT for all dev-* operations (planning + execution pipeline); the natural next skill after initialization.
