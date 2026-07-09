# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project

<!-- Replace the line below with your project name and a one-line description. -->
**{project-name}** — (one-line description).

## Commands

<!-- Fill in the build/test/lint commands for this project. Examples: -->
```bash
# build
# test
# lint
```

## Conventions & boundaries

- Conventional Commits required (`feat:`, `fix:`, `docs:`, `chore:`, ...). Breaking changes in a `BREAKING CHANGE:` footer.
- Never commit secrets, `.env*`, or credentials.
- Surgical changes only: touch what the task needs; no drive-by refactors, no speculative abstractions,
  no comments that restate what the code already says.

---

## Indexed context

Project context lives in `.spur/context/` (gitignored) and is surfaced by the `sp:indexed-context` skill.
Check it before re-reading files you may already have indexed:

1. `.spur/context/anatomy.md` — one-line description + token estimate per file. Read before opening a file.
2. `.spur/context/learnings.md` — project conventions, decisions, preferences. Read before generating code.
3. `.spur/context/pitfalls.md` — dated "do-not-repeat" entries. Read before generating code.
4. `.spur/context/buglog.md` — historical bug log. Read before fixing a bug.
5. `.spur/context/memory.md` — session log. Append one line per significant action.
6. `.spur/context/token-ledger.jsonl` — auto-tracked by hooks; never hand-edit.

If `.spur/context/` is absent, proceed normally. Never block work on its absence.
