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

Two phases — deterministic scaffold first, then non-deterministic customization:

### Phase 1 — Deterministic scaffold (`spur init`)

```
spur init --name <name> [--minimal] [--force] --json
```

This scaffolds (idempotent, never overwrites customized docs):
- `.spur/config.yaml` — minimal project config.
- `.spur/config/workflows/`, `.spur/rules/`, `.spur/config/templates/` — defaults.
- `docs/99_PROJECT_CONSTITUTION.md` + `docs/00`–`docs/05` stubs — the doc structure.

### Phase 2 — Non-deterministic customization (only if `--skip-docs` is absent)

After the scaffold, customize the fresh project. **Every authoritative-doc touch routes through
`sp:doc-evolve`** to honor the constitution §5 sync triggers.

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

Phase 1 runs `spur init` directly (Bash). Phase 2 delegates to `sp:doc-evolve` for every doc touch.

## Platform Notes

- **Claude Code:** native — `Skill()` delegation and `$ARGUMENTS` work directly.
- **Other platforms:** `Skill()` and `$ARGUMENTS` are Claude-specific. Run `spur init` via Bash,
  then invoke the `sp:doc-evolve` skill's `customize` operation directly.

## See also

- **sp:doc-evolve** — constitution-driven doc refresh; enforces §5 sync triggers on every doc touch.
- **sp:spur-plan** — front-half planning pipeline (design-doc generation, feature-ID derivation);
  the natural next step after a project is initialized.
- **sp:spur-dev** — back-half execution pipeline (feature create → task pipeline → done).
