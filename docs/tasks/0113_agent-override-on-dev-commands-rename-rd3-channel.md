---
schema_version: 1
name: "--agent override on dev-* commands (rename rd3 --channel)"
status: todo
template: feature-impl
created_at: 2026-06-24T03:52:29.296Z
updated_at: 2026-06-24T03:52:29.297Z
feature_id: H2
parent_wbs: "0109"
priority: P2
tags: ["cli", "commands", "agent-override"]
---

## 0113. --agent override on dev-* commands (rename rd3 --channel)

### Background

Covers 0109 R5. Spur dev-* commands have NO agent override — only the clunky `--vars '{"agent":"x"}'`. rd3 had `--channel <auto|current|...>`; `spur agent run` already supports `--agent <name|current|auto>` (capability exists, just not exposed on dev-*). Add `--agent <name|current|auto>` to dev-run/dev-verify/dev-review/dev-implement/dev-unit: default = pipeline's specified agent (vars.agent, omp), `auto` = resolveAgentAuto, explicit name overrides. Thread to the pipeline/agent.run. Round-4's broken-pi default would have been a one-flag escape. Mirror rd3 --channel semantics, renamed.

### Requirements

- [ ] R1. Add `--agent <name|current|auto>` to the agent-spawning dev-* commands; default = the configured/pipeline agent, `auto` = resolveAgentAuto, name = explicit override.
- [ ] R2. Thread the override to the pipeline (vars.agent) / agent.run agent option.
- [ ] R3. Declare the flag in each arg-hint; document the override path.
- [ ] R4. lint green; `--agent auto` and an explicit name both override correctly; surface synced in AGENTS.md/04_DESIGN.

### Acceptance Criteria

<!-- System-tone Given/When/Then (what the SYSTEM does), or a `- [ ]` checklist for sub-tasks. Drives UAT and L4 coverage. -->

### Q&A

<!-- Open questions and their resolutions. Delete if none. -->

### Design

<!-- Decision record — WHAT/WHY. Chosen approach + 1-line reason, rejected alternatives, key signatures (not bodies), invariants. ≤2 illustrative snippets MAX. -->

### Plan

<!-- Ordered checklist or table of implementation steps (not prose). The how-to-execute order within this one task. -->

### History
