---
name: Design
doc: 04_DESIGN
owns: SURFACE — concrete shapes: every CLI command, flag, config key, env var, table, DTO; index over docs/design/
authority: derived
version: 1.0.0
derived_from: [00_ADR, 01_PRD]
owner: _(project owner)_
updated_at: {{init-date}}
read_before: changing a command, flag, env var, or schema
edit_rules: 99 §6.5
sync: [T3, T9]
---

# Design

> **Index page** over `docs/design/` satellites (99 §4.5). Each surface area gets a
> `docs/design/<slug>.md` satellite; this index carries the surface map + pointers.
> Edit order: satellite first, then index row — same change (T9).

## UI/UX boundary

Repository-root `DESIGN.md` owns all UI/UX design, including visual language, design tokens,
components, layout, interaction, accessibility, and responsive behavior. Read and update it for UI
work; keep this document focused on non-UI surface design. If `DESIGN.md` is absent, follow the
project's established UI conventions rather than adding UI guidance here.

## 1. CLI commands

```
_(command) <positional> [--flag <value>] [--json]
```

| Command | Description | Design doc |
|---------|-------------|------------|
| _(command)_ | _(one-line description)_ | `docs/design/_(slug)_.md` |

## 2. Configuration keys

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| _(key)_ | _(type)_ | _(default)_ | _(description)_ |

<!--
Shapes only — rationale lives in 00/03. Behavioral notes are shapes ("resolving zero rules exits 1"
— keep); justifications are not ("...because a silent gate is the worst failure mode" — cut).
Transcribe command signatures from the code registrations, never from memory.
-->