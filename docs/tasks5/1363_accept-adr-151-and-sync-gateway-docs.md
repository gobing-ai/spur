---
schema_version: 1
name: Accept ADR-151 and sync gateway docs
status: todo
template: feature-impl
created_at: 2026-11-17T00:06:29.308Z
updated_at: "2026-11-17T00:29:18.375Z"
feature_id: K4
priority: P3
tags:
  - docs
  - adr
estimate_hours: 2

dependencies: ["1357", "1358", "1359", "1360", "1361", "1362"]
---

## 1363. Accept ADR-151 and sync gateway docs

### Background

Feature K4. ADR-151 and `docs/design/project-gateway.md` were written during planning as **Proposed**. After 1357–1362 land, the docs must match what shipped and ADR-151 moves to Accepted. Covers R11.

### Requirements

- [ ] R11. ADR-151 is Accepted and matches the shipped surface (`self serve --gateway`, `self daemon <action>`, `projects add --prefix`); `docs/design/project-gateway.md` risk register rows carry their landing task and any deviations; `docs/design/project-switcher.md`, `docs/03_ARCHITECTURE.md`, `docs/04_DESIGN.md`, `docs/design/downstream-board-modules.md`, `docs/design/board-module-ui-kit.md` and the `spur-cli` self/projects references reflect the prefix contract, gateway and daemon; doc checks pass.

### Acceptance Criteria

- [ ] AC1 — Architecture decision and size evaluation are recorded (req: R11)

Verification: `bun run spur-check-feature` (contract/drift checks) green; `rg -n "projects gateway|projects daemon|X-Forwarded-Prefix" docs plugins/sp` returns no live references (history notes excepted); `spur feature check K4 --json` pass. Artifact: the command outputs in `## Testing`.

### Q&A

- Docs-only task; no code. Use `sp:doc-evolve` for drift/sync; constitution untouched.
- If any task deviated from the design (e.g. fell back to `cssCodeSplit:false`), record it in the design and ADR Consequence, not in the task.

### Design

- `docs/00_ADR.md` ADR-151: Status → Accepted with date; reconcile Decision/Consequence with shipped behavior.
- `docs/design/project-gateway.md`: `updated_at`; §6 risk register — confirm each row's task; §5.1 note the final chunk-URL mechanism.
- `docs/design/project-switcher.md:33` Launchd row: keep the "superseded by ADR-151" pointer; add a short prefix/gateway paragraph in the registry section.
- `docs/03_ARCHITECTURE.md:187` gateway paragraph; `docs/04_DESIGN.md:73` index row (already K4).
- `plugins/sp/skills/spur-cli/references/self.md`, `serve.md`, `projects.md`: `self serve --gateway`, `self daemon`, `projects add --prefix`, `projects list` URL column (facade is the single parity authority per AGENTS.md).
- Portable doc changes also update init templates only if they touch template-owned sections (check `config/templates`).

### Plan

1. Diff shipped code against the design (surface, config keys, file names) and list deviations.
2. Update each owner doc above; run `sp:doc-evolve` drift check.
3. Run `bun run spur-check-feature`, the `rg` stale-reference gate, `spur feature check K4 --json`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature K4 R11; ADR-151; ADR-037; `docs/design/project-gateway.md`; `docs/design/project-switcher.md`; `docs/99_PROJECT_CONSTITUTION.md` (process).
- Depends on 1357–1362.

### History

- 2026-11-17T00:21:24.181Z feature_id Q → K4 (system)

