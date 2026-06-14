---
name: "W2: FeatureService and spur feature core verbs with hierarchical IDs"
description: "W2: FeatureService and spur feature core verbs with hierarchical IDs"
status: Backlog
created_at: 2026-06-13T01:08:18.983Z
updated_at: 2026-06-13T01:08:18.983Z
folder: docs/tasks
type: task
feature-id: F3
priority: P0
tags: ["rd3-migration","wave-2"]
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: pending
  testing: pending
---

## 0056. "W2: FeatureService and spur feature core verbs with hierarchical IDs"

### Background

Design §2.2/§2.4, DD-14. B01/B02/B05. Groups = top-level letters; ID length = depth.


### Requirements

R1. create --parent <id> with digit allocation under create-lock; no parent = next free group letter.
R2. show/update/list (status/priority filters, --json) sharing the write path.
R3. ID regex ^[A-Z][1-9]*$; parent derived by dropping last char; no parent_id field.
R4. Same-commit 04_DESIGN §7.2 sync.


### Q&A



### Design

Authority: delivery doc §1.2 (verb surface incl. `create --parent`), design §2.2 (feature field table —
no `parent_id`), §2.4 + DD-14 (hierarchical IDs: groups = single letters; children one digit 1–9 per
level; length = depth; allocation scans the parent's children under the create-lock; parent = drop last
char; no-parent create allocates the next free group letter), §10 behavior contracts. Same write path as
tasks (PlanningWriteService).


### Solution

1. `packages/app/src/services/feature-service.ts`: create/show/update/list over PlanningWriteService;
   ID allocation in the create-lock scope; ID parsing/derivation helpers (parentOf, depthOf, childrenOf).
2. `apps/cli/src/commands/feature.ts`: commander noun, transport-only.
3. Dogfood requirement (F3 note): the hand-authored `docs/features/` corpus (A–H groups + leaves) is a
   fixture — parsing, listing, and ID derivation must accept it unchanged; add it to the test fixtures.
4. Tests: allocation sequences (A→A1→A2; A1→A11), next-free-group-letter, regex rejections, list
   filters, `--json` envelope. Same commit: `04 §7.2`. Gate: `bun run check`; ≥90%.


### Plan



### Review



### Testing



### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


