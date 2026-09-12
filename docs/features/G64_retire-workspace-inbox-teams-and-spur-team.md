---
schema_version: 1
id: "G64"
name: "Retire Workspace, Inbox, Teams, and spur team"
status: backlog
priority: P2
tags: ["g6-program"]
created_at: "2026-09-12T04:42:44.350Z"
updated_at: "2026-09-12T04:45:08.190Z"
---

# G64: Retire Workspace, Inbox, Teams, and spur team

## Goal

Retire the overlapping surfaces once — and only once — their capabilities have real replacements:
the `spur team` CLI noun, the Board's Workspace / Inbox / Teams modules, and the legacy config and
spec identities behind them. Migration preserves mailbox identity, offers preview and rollback, and
supersedes the ADRs it invalidates instead of leaving contradictory authority in the tree.

## Scope

- In:
    - **Config and spec migration** per the preserve/convert/retire matrix
      ([runtime inventory](../reports/g6-runtime-inventory.md) §4): convert `agent.team.<id>` blocks
      to project fleet declarations; convert generated specs **with stable-ID preservation** (a spec
      id is the mailbox identity and occupant address — breaking it orphans inbox and coordination
      rows); preserve hand-authored specs; re-link or retire orphan specs; resolve teams whose
      `work_dir` disagrees with the project path; keep deterministic `<role>-<n>` derivation.
    - **Migration mechanics** — inventory report, dry-run preview, backup, idempotent conversion,
      rollback path, and old-client/schema compatibility. Any temporary alias table is tracked under
      ADR-058 with an explicit exit condition. No indefinite dual-writing of rosters or queues and
      no deletion of historical messages.
    - **`spur team` retirement** — migrate assign / status / up / down / start / stop callers to
      their owning nouns (`spur agent`, `spur message`, `spur projects`, task write service) before
      the noun is removed. `TeamService` capabilities are moved, not deleted with the command.
      Public-surface consent governs any new verb.
    - **Board route retirement** — remove Workspace, Inbox, and Teams navigation after G63 replaces
      them functionally; migrate routes and bookmarks; retire the `--agent <spec-id>` warn-once shim
      after confirming no workflow or plugin usage.
    - **Authority reconciliation** — supersede ADR-052 (team-scoped composition) explicitly; retain
      ADR-037 (registry) and ADR-057 (control-plane boundary); ADR-022 keeps task lifecycle. Update
      `docs/03_ARCHITECTURE.md`, the owning design satellites, CLI references, init templates, and
      plugin callers. Do not rewrite historical ADRs or feature receipts.
    - **Corpus reconciliation** — resolve M6 (Workspace Overview removal / Inbox-Teams label split,
      backlog), M3 (Teams board UX, verifying), and any remaining G1 / G4 work against this program
      before creating duplicate tickets.
- Out:
    - Choosing the cutover window itself — that is Robin's breaking-change decision, recorded here
      as a gate, not assumed by implementation.
    - Any destructive schema migration, deletion of historical messages, or forced roster merge.
    - New capabilities: this feature only moves, preserves, or removes what already exists.

## Acceptance Criteria

```gherkin
Feature: Retire Workspace, Inbox, Teams, and spur team

  @core
  Scenario: R1 — Migration previews before it changes anything
    Given an existing project with team config, generated specs, manual specs, and orphans
    When the migration runs in dry-run
    Then it reports every conversion, preservation, and retirement with its conflicts
    And no file, config, or database row has changed

  @core
  Scenario: R2 — Mailbox identity survives conversion
    Given generated specs addressed by existing inbox and coordination rows
    When the migration converts the roster
    Then every spec id is preserved verbatim or mapped through a recorded alias
    And no inbox or coordination row is orphaned

  @core
  Scenario: R3 — Conflicts halt rather than merge silently
    Given two legacy teams resolving to one project path, or a work_dir that disagrees with the project
    When the migration encounters them
    Then it reports the conflict and stops without merging or deleting
    And rollback restores the prior state

  @core
  Scenario: R4 — spur team is retired only after its callers move
    Given the team noun's assign, status, up, down, start, and stop callers
    When the noun is removed
    Then each capability is reachable under its owning noun
    And no capability is lost with the command

  @core
  Scenario: R5 — Board routes retire with a migration path
    Given Workspace, Inbox, and Teams routes and bookmarks
    When the navigation entries are removed
    Then existing routes redirect into the equivalent Projects view
    And no Board capability is unreachable

  @core
  Scenario: R6 — Superseded authority is corrected at its owner
    Given ADR-052's team-scoped composition no longer holds
    When this feature completes
    Then the supersession is recorded in docs/00_ADR.md with its replacement
    And architecture, design satellites, CLI references, and init templates match the shipped surface
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0846 | Migration inventory and dry-run preview with conflict reporting | todo |
| 0847 | Roster conversion with verbatim spec-ID preservation and rollback | todo |
| 0848 | Retire spur team after migrating its callers to owning nouns | todo |
| 0849 | Retire Workspace, Inbox, and Teams board routes with redirects | todo |
| 0850 | Reconcile superseded authority across ADRs, architecture, and templates | todo |
| 0851 | Reconcile M6, M3, G1, and G4 remaining work into this program | todo |
<!-- END AUTO-GENERATED -->

## Notes

Last slice of the G6 program — runs only after G61, G62, and G63 have functionally replaced what is
being retired. Design authority: [Projects and agent fleet unification](../plans/2026-09-11-project-agent-fleet-brainstorm.md)
§ "Migration and delivery order"; full disposition matrix with callers and rollback constraints:
[runtime inventory](../reports/g6-runtime-inventory.md) §4.

Blocking gate: **Robin owns the compatibility and removal window.** Retirement is requested and
approved in direction; no breaking cutover date has been selected. Migration evidence precedes the
choice — do not schedule this feature's destructive steps before that decision is recorded here.

Do not re-status M3, M6, G1, or G4 as part of this feature's planning; reconcile their remaining work
into concrete tasks here, or close them at their own owners with evidence.

## History
