---
name: Features
doc: 05_FEATURES
owns: STATUS — feature decomposition + state; index over docs/features/
authority: derived
version: 1.0.0
derived_from: [00_ADR, 01_PRD]
owner: _(project owner)_
updated_at: {{init-date}}
read_before: finding a feature's state
edit_rules: 99 §6.6
sync: [T4, T9]
---

# Features

> **Index page** over `docs/features/` satellites (99 §4.5). Both the satellites and this index's
> generated region are **tool-owned** (e.g. `spur feature`/`ftree`); edit through the tool, never
> with raw file writes. Edit order: satellite first, then refresh index (T9).

## Status legend

✅ done · 🔶 partial · ⏳ planned · 💤 deferred

## Feature tree

| ID | Feature | Status | Parent | Notes | Satellite |
|----|---------|--------|--------|-------|-----------|
| F1 | _(root feature)_ | ⏳ planned | — | _(one-line scope)_ | `docs/features/F1__(slug)_.md` |

<!--
Never trust a row you have not verified — check status against code before citing or building on it.
One item per satellite; <feature-id> is the stable grep anchor. Renaming is a tool operation.
-->