---
name: Architecture
doc: 03_ARCHITECTURE
owns: HOW — module boundaries, data flow, runtime model, invariants
authority: derived
version: 1.0.0
derived_from: [00_ADR, 01_PRD]
owner: _(project owner)_
updated_at: {{init-date}}
read_before: cross-module, seam, or schema work
edit_rules: 99 §6.4
sync: [T1]
---

# Architecture

## 1. Module map

```
_(ascii tree or diagram of the major modules and their boundaries)_
```

## 2. Data flow

_(Describe the primary data path: input → processing → output. Name the seams.)_

## 3. Invariants

- _(state or property that always holds — phrased so a constraint rule or reviewer can check it mechanically)_

<!--
Describes the CURRENT architecture only. Future/accepted designs go in sections explicitly
titled "(accepted design — ADR-NNN; not yet built)". On conflict with 00, the ADR wins; fix here.
-->