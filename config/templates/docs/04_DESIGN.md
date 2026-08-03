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

## UI/UX boundary & DESIGN.md

Repository-root `DESIGN.md` owns all UI/UX design documentation (industry standard visual language, color tokens, typography, component specs, accessibility, and responsive patterns). Read and update it for UI work; keep `docs/04_DESIGN.md` focused on non-UI surface design by default. If `DESIGN.md` is absent, ignore it and follow the project's established UI conventions.

By contrast, `docs/04_DESIGN.md` is our SSOT of non-UI surface design by default — covering CLI command signatures, flags, config schemas, DTOs, tables, and system boundaries.

When collaborating with the design team:
- **UI/UX & Visual Design:** Refer to and update repository-root `DESIGN.md`.
- **Non-UI Surface & API/Schema DTOs:** Refer to and update `docs/04_DESIGN.md` (and `docs/design/<slug>.md` satellites).

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