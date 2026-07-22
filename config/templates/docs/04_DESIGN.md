---
name: Design
doc: 04_DESIGN
owns: SURFACE — concrete shapes: every CLI command, flag, config key, env var, table, DTO
authority: derived
version: 1.0.0
created_at: 1970-01-01T00:00:00.000Z
updated_at: 1970-01-01T00:00:00.000Z
---

# Design

> Derived. Non-UI concrete shapes — every command, flag, config key, env var, schema, and DTO. Edit
> when a non-UI surface changes.

## UI/UX boundary

Repository-root `DESIGN.md` owns all UI/UX design, including visual language, design tokens,
components, layout, interaction, accessibility, and responsive behavior. Read and update it for UI
work; keep this document focused on non-UI surface design. If `DESIGN.md` is absent, follow the
project's established UI conventions rather than adding UI guidance here.

## 1. CLI commands

```
_(command) <positional> [--flag <value>] [--json]
```

| Command | Description |
|---------|-------------|
| _(command)_ | _(one-line description)_ |

## 2. Configuration keys

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| _(key)_ | _(type)_ | _(default)_ | _(description)_ |
