---
description: Survey a codebase (or module tree) for shallow modules and deepening opportunities — emit a ranked MARKDOWN candidate report that feeds the planning half; never auto-refactors
argument-hint: "[<module-path>] [--scope <all|<path>>] [--json]"
allowed-tools: ["Bash", "Read", "Grep", "Glob", "Skill"]
---

# Dev Arch

Wraps the **sp:sys-architecture** skill (survey operation).

Run an **architecture-upkeep survey**: scan the whole codebase (or a named module tree) for shallow
modules, pass-through wrappers, and leaky seams using the deep-module vocabulary, and emit a ranked
**MARKDOWN candidate report**. This is a *generator* for the planning half — it surfaces deepening
candidates for a human to turn into a task; it never edits or refactors code.

## When to use

- Periodic architecture upkeep — find where the codebase could deepen before debt calcifies.
- You want a ranked shortlist of restructuring candidates, not a per-task diff review.
- A module tree feels tangled and you want the deletion-test applied across it.

Do **not** use it for:

- **Per-task diff review** — that is `/sp:dev-review` (a WBS, forward, findings to the task's `## Review`).
- **Fixing the code** — the survey only surfaces candidates; route a chosen one through `/sp:dev-plan`.

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `module-path` | Optional module tree to scan (`apps/cli`, `packages/domain`) | whole codebase |
| `--scope <all\|<path>>` | `all` = whole repo; `<path>` = a bounded module tree (prefer bounded) | `all` |
| `--json` | Emit the candidate report as JSON instead of markdown | markdown |

## Behavior

Thin, reliable-sequence entry point (ADR-016), not a bare forwarder: it fixes the scope, invokes the
survey operation, and returns the ranked candidate report. The scan method (the deep-module vocabulary
and deletion test), the smell table, the MARKDOWN report template, and the route-to-grilling-to-design
step are all owned by the skill and its `references/upkeep-survey.md`. The command only forwards scope.

## Implementation

Delegates to the **sp:sys-architecture** skill's survey operation. `$ARGUMENTS` passes scope/flags verbatim:

```
Skill(skill="sp:sys-architecture", args="survey $ARGUMENTS")
```

The operator then picks a candidate and routes it into the planning half (`/sp:dev-idea` or
`/sp:dev-plan`) for grilling-to-design. The survey never auto-refactors.

## Platform Notes

- **Claude Code:** native — `Skill()` delegation and `$ARGUMENTS` work directly.
- **Other platforms:** invoke the `sp:sys-architecture` skill directly with `survey <scope>` as input.
