---
name: Design
doc: 04_DESIGN
owns: SURFACE — index of non-UI CLI, API, config, schema and boundary contracts
authority: derived
version: 1.1.0
derived_from: [00_ADR, 01_PRD]
owner: _(project owner)_
updated_at: {{init-date}}
read_before: changing a command, flag, env var, or schema
edit_rules: 99 §6.5
sync: [T3, T9]
---

# Design

Non-UI contract index (constitution §6.5). Keep signatures, schemas, defaults, errors
and boundary behavior in the owning `docs/design/<slug>.md` satellite.

## UI/UX boundary & DESIGN.md

Root `DESIGN.md`, when present, owns UI/UX visual and interaction design.
Architecture mechanisms belong in `03_ARCHITECTURE.md`.

## Surface map

| Area | Contract reference |
| --- | --- |
| _(Existing CLI/API/config/schema area)_ | _(Link to its owning satellite when created)_ |

Update a satellite when its contract changes; update this index only when its pointers change.
Do not create a satellite merely to hold task receipts or duplicate an existing contract.
