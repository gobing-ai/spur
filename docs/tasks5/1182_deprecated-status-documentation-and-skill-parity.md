---
schema_version: 1
name: Deprecated status documentation and skill parity
status: todo
template: meta
created_at: 2026-10-12T05:21:53.041Z
updated_at: "2026-10-12T05:34:48.436Z"
feature_id: F42
priority: P2
tags:
  - feature-lifecycle
  - docs

dependencies: ["1180", "1181"]
estimate_hours: 1.5
---

## 1182. Deprecated status documentation and skill parity

### Background

Implements: R7 — Owning documents and skills describe the deprecated status and its affected surfaces.

Design: docs/design/feature-deprecated-status.md; ADR-136. Surfaces S15–S16. Runs after 1180 and 1181 so docs quote shipped messages and codes.

**Refine corrections (2026-10-11)**
- "`03_ARCHITECTURE.md` names the status graph" → it carries no feature-status vocabulary (grep finds none) → dropped from scope.
- "`spur-dev/references/dev-operations.md` documents feature statuses" → it does not list them → dropped; the next-feature skill line is 1180's.
- Verified status-vocabulary sites: `docs/design/planning-record-contracts.md:221,225`; `docs/design/rd3-migration-design.md:138,168-171`; `docs/design/planning-workflow-contracts.md:31`; `docs/design/e2e-workflow-for-system-development.md:96`; `plugins/sp/skills/spur-cli/references/features.md:84,172`.
- "Seeded feature-lifecycle template matches the source graph" → there is no separate init template; parity is source `config/workflows/` vs bundled `apps/cli/config/workflows/` (owned by 1179) → this task only confirms it.

### Requirements

- [ ] R1. The status vocabulary at every verified site lists `deprecated`; the graph descriptions (`rd3-migration-design.md` §2.3 diagram, `planning-workflow-contracts.md:31` row, e2e mermaid node) show its entry edges and its two exits.
- [ ] R2. `plugins/sp/skills/spur-cli/references/features.md` documents the freeze: link refusal message, `L4.feature-deprecated` warning, section-write warning, sync no-op, `advance` refusal — quoting the strings 1180 shipped.
- [ ] R3. `docs/00_ADR.md` ADR-136 status → `Accepted (implemented)`; `docs/design/feature-deprecated-status.md` frontmatter `status: current` and §1 wording updated from proposed to current.
- [ ] R4. A CHANGELOG/release note states that project-layer `feature-lifecycle.yaml` overrides must be re-synced to gain the deprecated edges.
- [ ] R5. Source and bundled `feature-lifecycle.yaml` are byte-identical (`cmp`).
- Out of scope: `03_ARCHITECTURE.md`, `dev-operations.md`, relabelling M/M3/M6.

### Acceptance Criteria

- [ ] AC1 — Owning documents and skills describe the deprecated status and its affected surfaces (req: R1, R2, R3, R4, R5)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**Approach.** Update only owners whose facts changed (constitution §5); quote shipped strings from 1180 rather than paraphrasing. Run `sp:doc-evolve` drift check afterwards.

**Files.** As listed in Requirements; release note goes wherever the repo's CHANGELOG convention lives (check `CHANGELOG.md` at root, else the plugin README release section).

**Anti-patterns.** No new doc files; no edits to `99_PROJECT_CONSTITUTION.md`; no restating the affected-surface table outside the satellite.

**Dependencies.** Assumes 1180's messages/finding code and 1181's action labels are final.

### Plan

- [ ] Step 0: 1180 and 1181 done; copy their final strings.
- [ ] Vocabulary + graph sites (R1).
- [ ] spur-cli features reference (R2).
- [ ] ADR-136 + satellite status (R3).
- [ ] Release note (R4).
- [ ] `cmp config/workflows/feature-lifecycle.yaml apps/cli/config/workflows/feature-lifecycle.yaml` (R5).
- [ ] `sp:doc-evolve` drift check; `bun run spur-check`.

### Root Cause

<!-- For issue/bug tasks: the verified underlying cause, with a `file:line` anchor. -->

### Solution

<!-- Filled during implementation: changed files/sections and concise rationale. -->

### Testing

<!-- Filled during verification: commands/checks run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to docs, tasks, decisions, or external references. -->

### History
