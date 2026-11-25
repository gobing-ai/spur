---
schema_version: 1
name: One A2A member list with direction on the Integrations Board
status: done
template: feature-impl
created_at: 2026-11-25T22:13:28.921Z
updated_at: "2026-11-25T22:45:01.862Z"
feature_id: K44

priority: P2
ac_numbering: task-local
ac_altitude: task-local
done_forced: "false"
done_reason: unforced close
---

## 1451. One A2A member list with direction on the Integrations Board

### Background

Captured from the creation title: "One A2A member list with direction on the Integrations Board".

### Requirements

- [x] R1. The Integrations contract replaces a2a.inbound and a2a.outbound with one a2a.members[] whose entries carry direction inbound|outbound and the fields of the old row shapes.
- [x] R2. The A2A tab renders one members list, each row labelled with its direction; per-member receipts, credential state and the card inspector keep working.
- [x] R3. integrations-module.md documents the merged shape.

### Acceptance Criteria

```gherkin
Feature: One A2A member list with direction on the Integrations Board

  Scenario: AC1 — The contract carries one a2a.members list with a direction (req: R1)
    Given a fleet with a receive-capable member and an a2a peer
    When integrations.status is read (verified in packages/app/tests/services/integrations-service.test.ts and apps/server/tests/modules/integrations/handlers.test.ts)
    Then a2a.members holds an inbound row with role, cardUrl and writeFenced and an outbound row with kind, target and auth
    And a2a.inbound and a2a.outbound are absent

  Scenario: AC2 — The A2A tab renders one members list labelled by direction (req: R2)
    Given that status on the Board
    When the A2A tab renders (verified in apps/web/tests/modules/integrations/integrations-module.test.tsx)
    Then both members sit in integrations-a2a-members, each labelled inbound or outbound
    And outbound receipts, credential state, the card inspector and the no-inbound warning keep working

  Scenario: AC3 — The design satellite documents the merged shape (req: R3)
    Given docs/design/integrations-module.md
    When the A2A contract section is read
    Then it shows a2a.members discriminated by direction and no a2a.inbound / a2a.outbound
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

- **Discriminated union.** `a2a.members: z.array(z.discriminatedUnion('direction', [inbound, outbound]))`. Each member is a receiver or a peer, never both, so the union keeps per-direction fields typed without nullable columns.
- **Service order:** inbound rows first, then outbound (`[...inbound, ...outbound]`); the derivation rules (disabled and `a2a`/`project` members are not inbound) are unchanged.
- **Board:** one **Members** list; each row carries a direction badge (`integrations-a2a-direction-<id>`). Inbound rows keep the card URL, inspector and examples; outbound rows (`OutboundMember`) keep target, credential state and receipts. The existing `integrations-a2a-member-<id>` testids stay, so the heavy browser test needs no change.
- **Summary tab keeps two surface rows** (listener vs peers): they describe different surfaces (an endpoint vs outbound calls), derived by filtering `members` through `outboundMembers()`.
- Rendered as a card grid with a direction label instead of a table: it reuses the existing cards and keeps the inspector layout.

### Plan

1. Tests first: service status shape, handler outbound auth, web A2A tab one-list assertions, fixtures in useIntegrations/helpers tests.
2. Contract: add `direction` literals and `integrationsA2aMemberSchema`; replace `inbound`/`outbound` with `members`.
3. Service `a2aSurface` emits `members`.
4. Web: `outboundMembers()` helper; A2A tab one list with `DirectionBadge` + `OutboundMember`; useIntegrations receipts and SummaryTab via the helper.
5. Update `docs/design/integrations-module.md`.
6. `bun run lint` plus affected workspace tests.

### Solution

- `packages/contracts/src/integrations.ts:53`, `packages/contracts/src/integrations.ts:65`, `packages/contracts/src/integrations.ts:81`, `packages/contracts/src/integrations.ts:137` — direction literals, member union, `a2a.members`.
- `packages/app/src/services/integrations-service.ts:272`, `packages/app/src/services/integrations-service.ts:310` — rows tagged with direction; one list.
- `apps/web/src/modules/integrations/helpers.ts:511` — `outboundMembers()`; `allSurfacesOff` uses it (`apps/web/src/modules/integrations/helpers.ts:518`).
- `apps/web/src/modules/integrations/A2aTab.tsx:103`, `apps/web/src/modules/integrations/A2aTab.tsx:112`, `apps/web/src/modules/integrations/A2aTab.tsx:183` — `DirectionBadge`, `OutboundMember`, one members list; the old Outbound card is removed.
- `apps/web/src/modules/integrations/useIntegrations.ts`, `apps/web/src/modules/integrations/SummaryTab.tsx` — receipts and the outbound summary row read `outboundMembers()`.
- `docs/design/integrations-module.md:83` — merged shape documented.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/contracts/src/integrations.ts:81` member union; `packages/contracts/src/integrations.ts:137` a2a.members; `packages/app/src/services/integrations-service.ts:310`; test `packages/app/tests/services/integrations-service.test.ts:172` (15/0) and `apps/server/tests/modules/integrations/handlers.test.ts:527` (26/0) |
| R2 | MET | `apps/web/src/modules/integrations/A2aTab.tsx:183` one members list; `apps/web/src/modules/integrations/A2aTab.tsx:103` DirectionBadge; `apps/web/src/modules/integrations/A2aTab.tsx:112` OutboundMember keeps auth and receipts; tests `apps/web/tests/modules/integrations/integrations-module.test.tsx:406`, `apps/web/tests/modules/integrations/integrations-module.test.tsx:835`, `apps/web/tests/modules/integrations/integrations-module.test.tsx:897` (78 pass) |
| R3 | MET | `docs/design/integrations-module.md:83` documents a2a.members discriminated by direction |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `packages/app/tests/services/integrations-service.test.ts:172`, `apps/server/tests/modules/integrations/handlers.test.ts:527` |
| AC2 | MET | test | `apps/web/tests/modules/integrations/integrations-module.test.tsx:406`, `apps/web/tests/modules/integrations/integrations-module.test.tsx:835`, `apps/web/tests/modules/integrations/integrations-module.test.tsx:897` |
| AC3 | MET | command | `rg -n "direction: 'inbound'" docs/design/integrations-module.md` hits `docs/design/integrations-module.md:85`; `rg -c "a2a\.(inbound |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-25T22:32:54.332Z backlog → todo (system)
- 2026-11-25T22:32:54.709Z todo → wip (system)
- 2026-11-25T22:32:55.631Z wip → testing (system)
- 2026-11-25T22:45:01.759Z testing → done (system)

