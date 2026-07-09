---
allowed-tools: ["Read", "Write", "Edit", "Grep", "Glob", "Bash"]
description: Reverse engineer a codebase with selectable depth, focus, and output format
argument-hint: "[<path>] [--mode <briefing|structure|architecture|design|full>] [--focus <all|stack|dependencies|data|flows|api|security|quality|performance>] [--format <markdown|json|both>] [--output <file>]"
---

# Dev Reverse

Analyze a codebase through the **sp:reverse-engineering** skill. The command is a thin wrapper: parse arguments, preserve backward compatibility, then delegate all analysis behavior to the skill.

## When to Use

- Identify unfamiliar codebase structure and dependencies.
- Produce architecture or design documentation for onboarding.
- Reconstruct data models, flows, APIs, and module boundaries.
- Audit security, quality, performance, or technical debt before refactoring.

## Quick Start

```bash
# Default architecture-level analysis of the current project
/sp:dev-reverse

# Fast stack and purpose briefing
/sp:dev-reverse --mode briefing --focus stack

# Static component and dependency structure for a subdirectory
/sp:dev-reverse src/auth --mode structure --focus dependencies

# Detailed data design reconstruction
/sp:dev-reverse --mode design --focus data

# Comprehensive package with audit and roadmap
/sp:dev-reverse --mode full --focus all --format both --output docs/reverse-engineering.md
```

## Arguments

| Argument | Description | Default |
|---|---|---|
| `<path>` | Directory or file to analyze | project root |
| `--mode` | Analysis depth: `briefing`, `structure`, `architecture`, `design`, `full` | inferred, usually `architecture` |
| `--focus` | Analysis lens: `all`, `stack`, `dependencies`, `data`, `flows`, `api`, `security`, `quality`, `performance` | `all` |
| `--format` | Output encoding: `markdown`, `json`, `both` | `markdown` |
| `--output` | Write output to file instead of conversation | none |

## Backward Compatibility

Existing invocations using the old `--focus security|architecture|all` shape remain valid:

| Legacy Input | Normalized Behavior |
|---|---|
| `--focus security` | `--mode architecture --focus security` |
| `--focus architecture` | `--mode architecture --focus all` |
| `--focus all` | `--mode architecture --focus all` |

If the user explicitly asks for "complete", "comprehensive", "full reverse engineering", or equivalent wording, normalize to `--mode full`.

## Workflow

1. Parse `$ARGUMENTS` for path, `--mode`, `--focus`, `--format`, and `--output`.
2. Normalize legacy focus values.
3. Delegate to `sp:reverse-engineering` with normalized arguments.
4. The skill executes the depth-driven workflow: orient -> index -> classify -> trace -> synthesize -> audit when required.
5. If `--output` is specified, write the generated report to that path. Otherwise return it in conversation.

## Output

The skill selects deliverables from the depth mode:

| Mode | Output Shape |
|---|---|
| `briefing` | purpose, stack, entry points, risks/unknowns |
| `structure` | repository map, component table, dependency map, boundaries |
| `architecture` | HLD, context diagram, runtime topology, flows, cross-cutting concerns |
| `design` | architecture summary, data model, contracts, sequence diagrams, ER/class diagrams when evidence exists |
| `full` | design package plus audit, roadmap, open questions, evidence index |

`--format json` changes encoding only; it is not an analysis mode.

## Platform Notes

- **Claude Code**: Invoke via `Skill(skill="sp:reverse-engineering", args="$ARGUMENTS")` delegation with normalized arguments.
- **Codex / Gemini CLI / OpenClaw / OpenCode / Antigravity / Pi**: Extract arguments from the user message and follow `sp:reverse-engineering` directly. There is no deterministic analyzer script in this skill directory; do not call a non-existent script path.
