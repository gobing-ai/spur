---
name: spur-plan
description: "Front-half planning pipeline placeholder — a thin stub. The full planning narrative (intake → feature → AC → decomposition → batch-create → design-doc Step 5.5) lives in sp:spur-dev, which /sp:dev-plan delegates to directly. Kept for future development of a dedicated front-half skill. Triggers on: 'planning pipeline front-end', 'spur-plan'."
license: Apache-2.0
version: 1.0.0
created_at: 2026-06-19
updated_at: 2026-06-19
type: technique
platform: sp
tags: [planning, design-doc, feature-id, workflow-core, front-half]
metadata:
  author: spur
  platforms: "claude-code,codex,antigravity,opencode,openclaw"
  category: workflow-core
  interactions:
    - pipeline
    - reviewer
  operations:
    - plan-feature
    - derive-feature-id
    - author-design-doc
  pipeline_steps:
    - phasing
    - feature-id
    - design-gen
    - design-approval
    - handoff
see_also:
  - sp:brainstorm
  - sp:doc-evolve
  - sp:spur-dev
---

# sp:spur-plan — Planning Pipeline Front-End (stub)

> **This skill is a thin placeholder.** The SSOT narrative for all dev-* operations lives in
> `sp:spur-dev`. The planning pipeline itself is the YAML state machine at
> `config/workflows/planning-pipeline.yaml`.
>
> This file is kept for future development of a dedicated planning skill. Currently,
> `sp:spur-dev` owns the full workflow narrative (planning + execution), and
> `/sp:dev-plan` delegates directly to `sp:spur-dev`.
