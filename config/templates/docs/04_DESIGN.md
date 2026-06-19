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

> Derived. Concrete shapes — every command, flag, config key, env var, schema, and DTO. Edit when
> a surface changes.

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
