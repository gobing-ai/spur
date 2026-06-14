---
name: "W3: spur agent run team-mode verification and single-LLM-surface docs"
description: "W3: spur agent run team-mode verification and single-LLM-surface docs"
status: Backlog
created_at: 2026-06-13T01:08:18.985Z
updated_at: 2026-06-13T01:08:18.985Z
folder: docs/tasks
type: task
feature-id: B1
priority: P1
tags: ["rd3-migration","wave-3"]
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: pending
  testing: pending
---

## 0068. "W3: spur agent run team-mode verification and single-LLM-surface docs"

### Background

Delivery doc §1.4, M12. Not new — verify team-mode, harden, document as the single LLM execution surface for skills and workflow YAML.


### Requirements

R1. Team-mode verified end-to-end (or gaps filed upstream to ts-ai-runner).
R2. Hardening fixes from verification.
R3. 04_DESIGN documents agent run as the single LLM surface; sp skills reference it.


### Q&A



### Design

Authority: delivery doc §1.4 + B1 feature AC (M12): `spur agent run` is not new — verify team-mode
end-to-end, harden, and document it as the **single LLM execution surface** for skills and workflow YAML.
01_PRD §5.1 baseline: single-shot done, team-mode pending verification. Upstream owner for engine-side
gaps: `@gobing-ai/ts-ai-runner` (self-contained ts-libs tasks per the §14 memo).


### Solution

1. Verification matrix: agents (installed set) × modes (single-shot, --continue, team/drain) × output
   modes (--json); record pass/fail + transcripts in `## Testing`.
2. Gaps: spur-side fixes land here; runner-side gaps filed as self-contained ts-libs tasks (WBS recorded
   here).
3. Documentation: `04_DESIGN.md` agent section gains the single-LLM-surface statement; sp skills and
   workflow YAML reference `spur agent run` exclusively (grep-verified, no alternative execution paths).
4. Gate: matrix green or gaps filed; docs synced same commit.


### Plan



### Review



### Testing



### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


