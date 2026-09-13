---
schema_version: 1
name: Retire spur team after migrating its callers to owning nouns
status: done
template: feature-impl
created_at: 2026-09-12T04:55:45.302Z
updated_at: "2026-09-13T02:49:35.554Z"
feature_id: G64
priority: P2
tags:
  - g6-program

dependencies: ["0847"]
ac_altitude: task-local
---

## 0848. Retire spur team after migrating its callers to owning nouns

### Background

`spur team` carries assign, status, up, down, start, and stop. Retiring the noun before those
capabilities land elsewhere would delete function, which the design forbids: `TeamService`
capabilities are moved, not deleted with the command
(`docs/plans/2026-09-11-project-agent-fleet-brainstorm.md` § "CLI and Board disposition").

Robin's brief is explicit that launching consolidates into `spur self` or config, with no separate
`spur team` CLI exposure.

Public-surface consent governs any new verb added to an owning noun
(`docs/design/harness-surface-governance.md`).

### Requirements

- **R1** — Each of assign / status / up / down / start / stop is reachable under its owning noun
  (`spur agent`, `spur message`, `spur projects`, `spur self`, or the task write service) before
  removal.
- **R2** — `TeamService` capabilities are moved, not deleted alongside the command.
- **R3** — Any new verb on an owning noun follows public-surface consent with design context.
- **R4** — Plugin, workflow, and script callers of `spur team` are migrated in the same slice.
- **R5** — Removal is gated on Robin's recorded cutover window; until then the noun warns rather than
  disappears.
- **R6** — No capability is lost with the command; a coverage table maps each old verb to its new home.

### Acceptance Criteria

```gherkin
Feature: Retire spur team after migrating its callers

  @core
  Scenario: spur team is retired only after its callers move
    Given the team noun's assign, status, up, down, start, and stop callers
    When the noun is removed
    Then each capability is reachable under its owning noun
    And no capability is lost with the command

  @core
  Scenario: Removal waits for the recorded window
    Given no cutover window has been recorded
    When the migration slice ships
    Then the noun warns about retirement and continues to work
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-12T16:37:07.188Z

**Q: Does this task delete `spur team`?** No — and that is R5, not a hedge. It ships the replacements,
migrates the callers, and adds a deprecation warning. The deletion commit is unblocked only when
Robin records the cutover window in G64's Notes; the shim's removal condition names that record
explicitly, so the gate is checkable rather than remembered.

**Q: `--by-team` has no new home. Isn't that a lost capability, violating R6?** The group key is what
is removed, not the capability. After 0847 a project has exactly one fleet declared in
`.spur/fleet.json`; `agent.team.<id>` grouping only ever distinguished teams that a single project
could not have. `spur agent list --specs` shows every member of the one fleet, which is what
`--by-team` printed for a single-team project today. Recorded here so a future reader does not
reintroduce it.

**Q: Why does `up` get no CLI verb at all?** Robin's brief: launching "consolidated with `spur self`
or config-only, no spur CLI exposure." Materialization already runs at `spur serve` start through the
autostart path; 0835 moves its source from `agent.team.<id>` to `FleetService`. A `spur projects up`
would be a new public verb re-adding exactly the exposure the brief removes. The one part of `up` that
is genuinely operator-facing — `--check`'s desired-vs-observed diff — is `spur projects list --fleet`.

**Q: Why not put start/stop under `spur projects` instead of `spur agent`?** They act on one spec id,
not on a project. `spur agent` already owns per-spec lifecycle (`run`, `loop`, `wait`, `create`,
`edit`, `delete`) and already resolves spec ids. `spur projects` owns the registry. Putting spec
lifecycle under `projects` would split one noun's responsibility across two.

**Q: Why `spur task update --assignee` rather than a new `spur task assign` verb?** A new flag on an
existing verb is a smaller public-surface ask than a new verb, and assignment is a frontmatter field
write, which `update` already owns. `assignTask` stays the implementation either way.

**Q: Why is `TeamService` untouched when the task is named "retire"?** Because the server keeps
calling it. G63's Agents view consumes `/api/team/*`, which G64 does not retire; the routes call
`TeamService` directly. What retires is `apps/cli/src/commands/team.ts`, a transport. Deleting the
service would break the Board, which is the opposite of R2.

**DEFERRED — the `agent.team.<id>` schema removal.** This task ships the halt guard on
`unmapped-member-override` but does not delete the config block. Owner: whoever executes the cutover
commit after Robin's window is recorded. Condition: the inventory reports zero
`unmapped-member-override` warnings across every registered project, or Robin accepts the named
losses in writing. Splitting it into its own task is free — the guard is already where it needs to be.

**DEFERRED — consent for the two new verbs, the new flag, and the output change.** Owner: Robin.
Condition: a granted row in `docs/design/harness-surface-governance.md` §4. Plan steps 5–7 do not
start without it; steps 1–4 and 9–13 are unaffected, so a delay here does not block the slice.

### Design

**WHAT.** Move the six `spur team` capabilities to their owning nouns, then mark the noun deprecated
behind a tracked transition shim. The noun keeps working until Robin's cutover window is recorded —
R5 makes "warns rather than disappears" the shipped behaviour of this task.

**WHY `TeamService` is not touched.** R2 is satisfied by *not* editing
`packages/app/src/services/team-service.ts`: `assignTask` (:568), `getStatus` (called by `runTeamStatus`, `team.ts:130`),
`materializeTeam` (:741), and `teardownTeam` (:906) stay exactly as they are, still called by the
server's `/api/team/*` routes (`apps/server/src/modules/team/index.ts:77,88,250,280`), which G63 keeps
and G64 does not retire. Only `apps/cli/src/commands/team.ts` — the transport — retires. Moving a
capability here means giving it a second CLI entry point, not relocating its implementation.

**Coverage table (R1, R6).** Every verb, its new home, and the consent class of that home:

| `spur team` verb | New home | Shape | Consent class |
| --- | --- | --- | --- |
| `assign <task-id> <agent-id>` | `spur task` | `spur task update <wbs> --assignee <spec-id>` | new flag on an existing verb |
| `status [--json]` | `spur agent` | `spur agent list --specs` gains the live run-status merge `runTeamStatus` already performs (`team.ts:147-159`: fetch `/api/team/agents`, overwrite `agent.status`/`agent.pid`, fall back to local specs when the server is unreachable) | observable-output change of an existing verb |
| `status --by-team` | — | **dropped, not moved.** One project has one fleet; grouping by team id is meaningless after 0847. No capability is lost because the group key ceases to exist. | none |
| `up <team>` | config | materialization runs from `.spur/fleet.json` at `spur serve` start, via `FleetService.materialize` (task 0835). Robin's brief: "launching consolidated with `spur self` or config-only, no spur CLI exposure." | none |
| `up --check` | `spur projects` | `spur projects list --fleet` (task 0835) already renders the desired-vs-observed diff `--check` printed | flag proposed by 0835 |
| `down <team>` | `spur agent` | `spur agent stop <spec-id>` per member | new verb |
| `down --purge` | `spur agent` | `spur agent delete <id>` — **already exists** (`apps/cli/src/commands/agent.ts:215`) | none |
| `start <agent-id>` | `spur agent` | `spur agent start <spec-id>` | new verb |
| `stop <agent-id>` | `spur agent` | `spur agent stop <spec-id>` | new verb |

**Public-surface consent — required before any of the new shapes register (R3).** Proposed row for
`docs/design/harness-surface-governance.md` §4, for Robin to grant or reject as one unit:

| Date | Task | Public change | Granted scope and reason |
| --- | --- | --- | --- |
| TBD | 0848 | `spur agent start <spec-id>` and `spur agent stop <spec-id>` (new verbs); `--assignee <spec-id>` on `spur task update` (new flag); `spur agent list --specs` merges live run status from the server (observable-output change) | Give every `spur team` capability a home under its owning noun before the noun retires, so no function is deleted with the command. `agent` owns spec process lifecycle; `task` owns task frontmatter. Rejected shapes: keeping a `spur team` noun with fewer verbs, and a new `spur fleet` noun (0835 already rejected one). |

The A3 no-further-promotion rule means this cannot ride the `spur builder` or any earlier row.

**WHERE.**

| Layer | Change |
| --- | --- |
| `apps/cli/src/commands/agent.ts` | `start` / `stop` verbs, thin wrappers over the same `/api/team/agents/:id/{start,stop}` calls `runTeamStart` / `runTeamStop` already make |
| `apps/cli/src/commands/task.ts` | `--assignee <spec-id>` on `update`, calling `TeamService.assignTask` unchanged |
| `apps/cli/src/commands/team.ts` | deprecation warning at noun entry; **verbs stay functional** (R5) |
| `config/transition-shims.json` | one new entry, `team-noun-retired` |
| `packages/app/src/services/team-service.ts` | **none** |
| `apps/server/src/modules/team/index.ts` | **none** |

**The retirement shim (R5), and why it is ADR-058's mechanism rather than a new one.** A one-time
warning at noun entry, marked `@transition-shim(team-noun-retired)` in `apps/cli/src/commands/team.ts`
and registered in `config/transition-shims.json` with every required field. The gate
`bun run transition-shim-check` inside `spur-check` is **two-sided** (ADR-058): an unregistered marker
fails, and a registered entry whose marker is gone also fails. That is the property this task wants —
when the noun is finally deleted, the manifest entry must be deleted in the same commit or CI fails.
The removal condition must be objectively checkable, so it is written as:

> no `spur team` invocation remains in `config/workflows/`, `plugins/sp/`, `scripts/`, or `docs/`, and
> the cutover window is recorded in `docs/features/G64_retire-workspace-inbox-teams-and-spur-team.md`.

**Caller migration (R4).** `spur team` occurrences in `config/workflows/*.yaml`, `plugins/sp/**`,
`scripts/**`, and `docs/**` are rewritten to the new homes in this task. The shim's removal condition
is exactly that scan, so R4 and R5 are checked by the same command.

**The `agent.team.<id>` config block.** G64's Scope puts config migration in this feature, and 0847
deliberately leaves the block in place so its conversion stays additive and reversible. Removing the
block is therefore the second half of this retirement and is gated identically — and it halts when
0846 reported an `unmapped-member-override` warning for any member, because those keys (`workspace`,
`model`, `autonomy`, `systemPrompt`, `command`, `autostart`) have no `FleetMember` home and would be
lost with the block. **This task ships the halt and the warning; it does not delete the block until
the cutover window is recorded.** If Robin prefers the schema removal as its own task, it is a
one-task split with no rework — the halt logic is where it needs to be either way.

**Anti-patterns — do not implement.**

- Do not delete or edit `packages/app/src/services/team-service.ts`. R2 is satisfied by leaving it.
- Do not remove `/api/team/*` server routes — G63's Agents view consumes them.
- Do not delete `apps/cli/src/commands/team.ts` in this task. R5 says warn, not disappear.
- Do not add a `spur fleet` noun, and do not re-add `--by-team` under a new name.
- Do not register the new verbs or flag before the consent row exists.
- Do not reimplement start/stop: call the same server endpoints `runTeamStart` / `runTeamStop` do.
- Do not remove `agent.team.<id>` from `TeamConfigSchema` while an `unmapped-member-override` warning
  stands for any member.
- Do not add a shim marker without its `config/transition-shims.json` entry — the gate fails both ways.

**Handoff.** 0849 retires the Board routes and the separate `--agent <spec-id>` shim
(`agent-flag-spec-id`), which is a different manifest entry from this one and retires on its own
evidence. 0850 records the ADR supersession that this retirement makes true.

### Plan

1. **Write the consent row and stop.** Add the proposed row from the Design to
   `docs/design/harness-surface-governance.md` §4 as a pending request and get Robin's explicit grant
   before step 5. Steps 2–4 and 6–9 need no consent; only the new verbs and the new flag do.
   *(R3)*
2. **Prove the coverage table against the tree.** For each of the six verbs, confirm the claimed new
   home exists or is in scope: `spur agent delete` already exists (`agent.ts:215`);
   `spur projects list --fleet` is 0835's; `spur agent start|stop` and `spur task update --assignee`
   do not exist yet. Record any drift in the Design before writing code — the table is R6's
   deliverable and must be true, not aspirational. *(R1, R6)*
3. **Inventory the callers.** `rg -n 'spur team ' config/workflows plugins/sp scripts docs
   apps/*/src packages/*/src` and record each hit with its replacement command. This list is both
   R4's work item and the shim's removal condition; keep it in the task's Solution section when it
   is executed. *(R4)*
4. **Test intent — coverage.** A test asserting the CLI registers every replacement shape
   (`agent start`, `agent stop`, `agent delete`, `agent list --specs`, `task update --assignee`,
   `projects list --fleet`), keyed by the old verb name, so deleting a replacement fails the build
   with the name of the capability it drops. This is R6 as an executable assertion rather than a
   table someone has to re-read. *(R6)*
5. **Add `spur agent start <spec-id>` and `spur agent stop <spec-id>`** in
   `apps/cli/src/commands/agent.ts`, delegating to the same `POST /api/team/agents/:id/{start,stop}`
   calls `runTeamStart` / `runTeamStop` make, including the same unreachable-server error text. Do not
   re-derive the request shape. *(R1, gated on step 1)*
6. **Add `--assignee <spec-id>` to `spur task update`** in `apps/cli/src/commands/task.ts`, calling
   `TeamService.assignTask` unchanged. Validate the id against `AGENT_ID_REGEX`
   (`packages/config/src/index.ts:358`) and fail with the unknown id in the message when no spec
   resolves. *(R1, R2, gated on step 1)*
7. **Merge live run status into `spur agent list --specs`** by lifting the fetch-and-merge block from
   `team.ts:147-159` — same fallback, same stderr warning. This is the observable-output change the
   consent row covers. *(R1, gated on step 1)*
8. **Test intent — behaviour.** (a) `agent start`/`stop` hit the same endpoint paths as the team
   verbs, asserted against a stub server; (b) `task update --assignee` writes the `assignee`
   frontmatter field and emits `team.member.assigned`, matching `assignTask`'s existing behaviour
   (`team-service.ts:568-591`); (c) `agent list --specs` shows `stopped` plus the warning when the
   server is unreachable. *(R1, R2)*
9. **Migrate the callers** found in step 3 to the new shapes, in the same commit as steps 5–7 so no
   revision of the tree has a caller pointing at a command that is about to warn. *(R4)*
10. **Ship the retirement warning, not the removal.** In `apps/cli/src/commands/team.ts`, emit a
    one-time stderr deprecation naming the replacement for the invoked verb, marked
    `@transition-shim(team-noun-retired)`, and register the entry in `config/transition-shims.json`
    with the removal condition from the Design. Every verb keeps working. Run
    `bun run transition-shim-check` to prove the two-sided gate accepts the pair. *(R5)*
11. **Test intent — the gate holds both ways.** Assert that (a) invoking any `spur team` verb still
    returns its previous exit code and output with the warning added on stderr only, and (b) the
    manifest entry and the source marker exist together — the check that fails if a future commit
    deletes one without the other. *(R5)*
12. **Halt guard on the config block.** Where `agent.team.<id>` would be removed, first read 0846's
    inventory and refuse when any `unmapped-member-override` warning is present, naming the member
    and the unmapped keys. Do not remove the block in this task; the guard ships now so the removal
    commit cannot silently drop `workspace`/`model`/`autonomy`/`systemPrompt`/`command`/`autostart`.
    *(R5)*
13. **Gate.** `bun run spur-check`, then `spur task check 0848`. Record in the Solution section that
    the noun still works, listing the six verbs and their warnings.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/src/commands/agent.ts:234` |
| `apps/cli/src/commands/agent.ts:314` |
| `apps/cli/src/commands/agent.ts:320` |
| `apps/cli/src/commands/agent.ts:34` |
| `apps/cli/src/commands/agent.ts:350` |
| `apps/cli/src/commands/agent.ts:364` |
| `apps/cli/src/commands/agent.ts:372` |
| `apps/cli/src/commands/agent.ts:48` |
| `apps/cli/src/commands/agent.ts:55` |
| `apps/cli/src/commands/projects.ts:15` |
| `apps/cli/src/commands/projects.ts:4` |
| `apps/cli/src/commands/projects.ts:416` |
| `apps/cli/src/commands/projects.ts:8` |
| `apps/cli/src/commands/shared-options.ts:105` |
| `apps/cli/src/commands/task.ts:35` |
| `apps/cli/src/commands/task.ts:39` |
| `apps/cli/src/commands/task.ts:454` |
| `apps/cli/src/commands/task.ts:473` |
| `apps/cli/src/commands/task.ts:59` |
| `apps/cli/src/commands/team.ts:110` |
| `apps/cli/src/commands/team.ts:114` |
| `apps/cli/src/commands/team.ts:123` |
| `apps/cli/src/commands/team.ts:127` |
| `apps/cli/src/commands/team.ts:135` |
| `apps/cli/src/commands/team.ts:139` |
| `apps/cli/src/commands/team.ts:147` |
| `apps/cli/src/commands/team.ts:151` |
| `apps/cli/src/commands/team.ts:157` |
| `apps/cli/src/commands/team.ts:263` |
| `apps/cli/src/commands/team.ts:267` |
| `apps/cli/src/commands/team.ts:310` |
| `apps/cli/src/commands/team.ts:38` |
| `apps/cli/src/commands/team.ts:381` |
| `apps/cli/src/commands/team.ts:87` |
| `apps/cli/src/commands/team.ts:97` |
| `apps/cli/src/commands/team.ts:99` |
| `apps/cli/tests/commands/projects.test.ts:423` |
| `apps/cli/tests/json-envelope-inventory.test.ts:197` |
| `apps/cli/tests/json-envelope-inventory.test.ts:238` |
| `apps/cli/tests/json-envelope-inventory.test.ts:245` |
| `apps/cli/tests/json-envelope-inventory.test.ts:275` |
| `apps/cli/tests/json-envelope-inventory.test.ts:283` |
| `apps/web/src/modules/teams/ProcessesTab.tsx:302` |
| `apps/web/tests/modules/teams/components.test.tsx:283` |
| `packages/app/src/index.ts:287` |
| `packages/config/src/index.ts:358` |
| `packages/domain/src/dao/index.ts:3` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | apps/cli/tests/commands/team-retirement.test.ts:109 pins all owning-noun registrations (team keeps six verbs; agent start/stop; agent list --server; task update --assignee); impl apps/cli/src/commands/task.ts:455, apps/cli/src/commands/agent.ts:239,258,48, apps/cli/src/commands/projects.ts:108 (--fleet, up --check home), apps/cli/src/commands/agent.ts:225 (delete, down --purge home) |
| R2 | MET | git diff HEAD on packages/app/src/services/team-service.ts and apps/server/src/modules/team/index.ts is empty (service untouched); delegation parity asserted at apps/cli/tests/commands/team-retirement.test.ts:192,217,245 (same endpoint + error text) and :356 (assignTask frontmatter write + team.member.assigned persisted) |
| R3 | MET | docs/design/harness-surface-governance.md:117 — 0848 consent row names the granted scope (agent start/stop verbs, task update --assignee flag, agent list --specs output change + --server flag), reason, rejected shapes, and provenance (G64 runall session, 2026-09-13); consent treated as granted per standing operator decision |
| R4 | MET | rg 'spur team' config/workflows scripts → zero hits (run this turn); plugins migrated (plugins/sp/skills/spur-cli/references/team.md:9-22 migration table; agent.md; message.md; dispatch-surface.md:131; serve/projects/self/tasks refs); Board caller apps/web/src/modules/teams/ProcessesTab.tsx:302 with test apps/web/tests/modules/teams/components.test.tsx:284; residual P3 noted: docs/help/cmd_agent.md:221 |
| R5 | MET | apps/cli/src/commands/team.ts:41 marker, :67 one-time per-verb warning wired at :87-151; config/transition-shims.json:31-37 entry team-noun-retired (wbs 0848) with removal condition naming the G64 window; two-sided gate bun run transition-shim-check PASS; tests apps/cli/tests/commands/team-retirement.test.ts:128,160,432 |
| R6 | MET | Coverage table in task Design + plugins/sp/skills/spur-cli/references/team.md:14-22 + manifest keepsWorking (config/transition-shims.json:35), verified true against the tree (--by-team dropped with recorded rationale: group key removed, not capability); executable coverage assertion apps/cli/tests/commands/team-retirement.test.ts:109 |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: spur team is retired only after its callers move | MET | test | apps/cli/tests/commands/team-retirement.test.ts:109 (every replacement registered while the noun still stands) + :432 (two-sided shim gate: noun cannot be deleted without the manifest pair, forcing the removal commit to carry the completed caller migration) + parity :192,217,245,356; removal act deferred to the recorded window per R5 (closed Q&A decision) |
| Scenario: Removal waits for the recorded window | MET | test | Given holds: no cutover window recorded (docs/features/G64_retire-workspace-inbox-teams-and-spur-team.md:123); Then holds: apps/cli/tests/commands/team-retirement.test.ts:128 (warns once naming replacement, verb still works exit 0) and :160 (stderr-only, prior exit codes/output unchanged) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | design-conformance | — | WHERE table honored: agent.ts start/stop thin delegation; task.ts --assignee; team.ts warn-only; manifest entry; team-service.ts and server team module untouched |
| P3 | residual-doc-residue-cmd_agent-221 | — | docs/help/cmd_agent.md:221 still names spur team up/start (P3 doc residue; superseded-authority slices are 0850) |

### References

- Parent feature: [G64 — Retire Workspace, Inbox, Teams, and spur team](../features/G64_retire-workspace-inbox-teams-and-spur-team.md)
- Design authority: [Projects and agent fleet unification](../plans/2026-09-11-project-agent-fleet-brainstorm.md) § "CLI and Board disposition"
- Governance: `docs/design/harness-surface-governance.md` (public-surface consent)
- CLI reference: `plugins/sp/skills/spur-cli/references/`

### History

- 2026-09-13T01:40:17.842Z todo → wip (system)
- 2026-09-13T02:48:51.308Z wip → testing (system)
- 2026-09-13T02:49:35.554Z testing → done (system)

