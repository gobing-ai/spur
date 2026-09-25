---
schema_version: 1
name: Add read-only doctor guidance for legacy plan and design upgrades
status: done
template: feature-impl
created_at: 2026-09-25T07:22:28.366Z
updated_at: "2026-09-25T07:41:07.179Z"
feature_id: H14
priority: P2
estimate_hours: 2

dependencies: ["0954"]
---

## 0955. Add read-only doctor guidance for legacy plan and design upgrades

### Background

Existing plan and design documents vary widely. They should remain readable while authors get a repeatable way to identify and propose safe upgrades.

### Requirements

- [x] R1. Extend spur-doctor with a bounded read-only review of docs/plans and docs/design Markdown files.
- [x] R2. Proposals preserve historical meaning, filenames, headings and references, and verify changed documents without strict validation.

### Acceptance Criteria

- [x] AC1 — Doctor proposes safe upgrades for legacy Markdown (req: R1)
- [x] AC2 — Document contract is reviewed and verified (req: R2)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Doctor cites file evidence and emits proposal rows; it never writes. A document author applies accepted rows using the spur-dev guide, then doc-evolve checks affected key-document sync under the constitution. Do not bulk rewrite existing files or add CLI commands.

### Plan

- [x] Inspect representative legacy files and the doctor contract.
- [x] Add the upgrade review procedure and proposal evidence shape.
- [x] Verify read-only wording, links and examples.

### Solution

Extended the read-only doctor to enumerate and review every plan/design Markdown path, record complete coverage, cite file evidence, and propose only additive, history-preserving upgrades at `plugins/sp/skills/spur-doctor/SKILL.md:64`. The procedure retains the doctor's no-write boundary at `plugins/sp/skills/spur-doctor/SKILL.md:34` and routes accepted document edits to the spur-dev authoring guide at `plugins/sp/skills/spur-dev/references/document-authoring.md:44`.

The existing contract satellite now records this document review and application boundary at `docs/design/spur-artifact-evolution.md:79`; `AGENTS.md:86` and its init template point authors to the doctor. The current corpus contains 53 plan and 71 design Markdown files; representative older files at `docs/plans/2026-09-21-next-generation-spur-workflows.md:1` and `docs/design/dev-plan-design-doc-generation.md:1` remain readable without frontmatter. No bulk rewrite or strict checker was added.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/sp/skills/spur-doctor/SKILL.md:64`; `plugins/sp/skills/spur-doctor/SKILL.md:66`; `plugins/sp/skills/spur-doctor/SKILL.md:80` |
| R2 | MET | `plugins/sp/skills/spur-doctor/SKILL.md:82`; `plugins/sp/skills/spur-dev/references/document-authoring.md:38`; `docs/design/spur-artifact-evolution.md:83` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| [docs-only] R3 — Doctor proposes safe upgrades for legacy Markdown | MET | static-ref | `plugins/sp/skills/spur-doctor/SKILL.md:64`; `plugins/sp/skills/spur-doctor/SKILL.md:80`; `docs/plans/2026-09-21-next-generation-spur-workflows.md:1`; `docs/design/dev-plan-design-doc-generation.md:1` |
| [docs-only] R4 — Document contract is reviewed and verified | MET | command | `superskill skill validate plugins/sp/skills/spur-doctor --json` returned valid=true; `bun run spur-check` passed 9009 tests and 47 precheck/2 postcheck rules; `bun run spur-check-feature`, `bun run test-cf`, and `bun run build` exited 0; contract at `docs/design/spur-artifact-evolution.md:83` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-25T07:33:03.600Z todo → wip (system)
- 2026-09-25T07:40:09.735Z wip → testing (system)
- 2026-09-25T07:40:10.026Z testing → done (system)

