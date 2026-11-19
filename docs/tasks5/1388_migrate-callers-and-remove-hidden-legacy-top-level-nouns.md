---
schema_version: 1
name: Migrate callers and remove hidden legacy top-level nouns
status: done
template: feature-impl
created_at: 2026-11-18T05:29:30.253Z
updated_at: "2026-11-19T00:41:49.836Z"
feature_id: A36
priority: P1
tags:
  - phase-1
  - protocol-surfaces
estimate_hours: 6

dependencies: ["1387"]
done_forced: "false"
done_reason: unforced close
---

## 1388. Migrate callers and remove hidden legacy top-level nouns

### Background

`init`, `maintain`, `migrate`, `serve` and `status` are registered as hidden top-level aliases (`apps/cli/src/index.ts:323-327`), and `migrate`/`status` are also registered on the boot-free fast path (`:144`, `:168`).

**Refine corrections (2026-11-17)**
- "internal callers may still spawn them" → confirmed, a live one: `startProject` spawns `[...invocation, 'serve', …]` (`packages/app/src/services/project-start.ts:464-473`), so every `spur projects start` and every gateway-started project uses the legacy noun. The LaunchAgent plist already uses `self serve` (`packages/app/src/services/gateway-daemon.ts:82`). → Migrate the spawn argv first. It is the one caller whose breakage would take every gateway-routed project down.
- The scope was larger than the inventory step implied → `rg "spur (serve|init|maintain|migrate|status)\b"` finds 89 non-test source mentions (mostly user-facing remedy strings such as "restart it with `spur serve`"), plus scripts (`scripts/commands/a2a-serve-e2e.ts:136` spawns `bun CLI serve`), `scripts/commands/surface-drift-inventory.test.ts` rows, plugin references and templates (`config/templates/AGENTS.md`).
- Fast path missed → the boot-free `migrate`/`status` registrations at `index.ts:144,168` must go too, or the alias survives on the fast path.
- `scripts/install.sh` was suspected → it already runs `self install` (`:121`). Only its comment at `:19` needs updating.

### Requirements

- [x] R1. Migrate every executable caller to `self <verb>`: the `project-start.ts` spawn argv, script spawns (`a2a-serve-e2e.ts`, `a2a-member-e2e.ts`, `fleet-e2e.ts` and any others `rg` finds), and package scripts.
- [x] R2. Migrate user-facing strings (remedy messages, help summaries such as "requires spur serve"), plugin references, templates, READMEs and drift-inventory rows to the `spur self <verb>` spelling.
- [x] R3. Remove the five hidden registrations at `index.ts:323-327` and the fast-path `migrate`/`status` registrations at `:144,168`, keeping the `self` fast path intact. Drop the `hidden` option from the register helpers if nothing else uses it.
- [x] R4. Prove after removal that `spur projects start` spawns a healthy serve, the gateway starts and proxies to it, `spur serve` is an unknown command, and the parity suites pass. `rg` over executable sources returns no legacy spelling.

### Acceptance Criteria

- [x] AC1 — Legacy top-level nouns are removed with no internal caller left (req: R1, R2, R3, R4)

Test layer: the real commander program, the real `startProject` spawn seam, and one real gateway proxy smoke.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-18T05:52:45.710Z

- **Split string migration from removal?** Closed: no. It lands as one commit so no tree ships with documented-but-removed spellings.
- **Stale plugin copies elsewhere?** Accepted break pre-1.0; the remedy is `superskill install sp`.

### Design

**WHAT.** Do callers first and the removal last, in one commit:
1. Change the argv in `project-start.ts` to `[...invocation, 'self', 'serve', …]`, and pin it with a spawn-seam test.
2. Do a mechanical string migration over the files `rg` lists, reviewing each file. Generated files such as `apps/cli/schemas/*.json` and `apps/cli/config/` are regenerated, never hand-edited.
3. Delete the registrations.

**WHY.** The spawn argv is the only runtime caller. Everything else is text that would teach agents and operators a dead spelling. A single commit means no intermediate tree ships with a broken `projects start`.

**WHERE.** `packages/app/src/services/project-start.ts`, `apps/cli/src/index.ts`, `apps/cli/src/commands/{serve,init,maintain,migrate,status}.ts` (hidden options), the remedy strings across `apps/` and `packages/`, `scripts/commands/*`, `plugins/sp/**`, `config/templates/*` and READMEs.

**Anti-patterns.** Don't sed-replace inside CHANGELOG, done tasks, ADR history or migrations (`drizzle/0047` mentions the spelling in a comment, which is history). Don't touch `vendors/`.

**Blast radius.** Projects started by an older binary keep running. Stale plugin copies in other projects that call `spur serve` break until re-installed (`superskill install sp`). That break is accepted pre-1.0 (feature Notes).

### Plan

- [x] Step 1 (test first, R1/R4): add a `startProject` spawn-seam test asserting the argv contains `self serve`, and a program test asserting `spur serve` / `spur status` are unknown commands on both the normal path and the fast path.
- [x] Step 2 (R1): migrate the executable callers.
- [x] Step 3 (R2): migrate strings and docs, file by file from the `rg` inventory, and regenerate generated files.
- [x] Step 4 (R3): remove the registrations.
- [x] Step 5 (R4): `bun run --filter @gobing-ai/spur build:bundle`, then a real `spur projects start` plus a gateway proxy smoke on a temp project. Then the parity suites, `bun run spur-check`, and `bun run test:heavy` for the gateway e2e.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `.env.example:23` |
| `.env.example:26` |
| `README.md:233` |
| `README.md:246` |
| `README.md:249` |
| `README.md:387` |
| `README.md:85` |
| `README.md:92` |
| `apps/cli/README.md:101` |
| `apps/cli/README.md:105` |
| `apps/cli/README.md:110` |
| `apps/cli/README.md:118` |
| `apps/cli/README.md:145` |
| `apps/cli/README.md:68` |
| `apps/cli/README.md:92` |
| `apps/cli/README.md:95` |
| `apps/cli/board/kit/base-path.d.ts:4` |
| `apps/cli/schemas/spur-config.schema.json:200` |
| `apps/cli/src/commands/agent/list.ts:32` |
| `apps/cli/src/commands/agent/list.ts:40` |
| `apps/cli/src/commands/agent/shared.ts:280` |
| `apps/cli/src/commands/agent/shared.ts:336` |
| `apps/cli/src/commands/agent/shared.ts:48` |
| `apps/cli/src/commands/agent/shared.ts:548` |
| `apps/cli/src/commands/agent/shared.ts:566` |
| `apps/cli/src/commands/agent/shared.ts:68` |
| `apps/cli/src/commands/agent/start.ts:11` |
| `apps/cli/src/commands/agent/status.ts:37` |
| `apps/cli/src/commands/agent/status.ts:71` |
| `apps/cli/src/commands/agent/stop.ts:10` |
| `apps/cli/src/commands/agent/trace.ts:10` |
| `apps/cli/src/commands/agent/usage.ts:0` |
| `apps/cli/src/commands/agent/usage.ts:160` |
| `apps/cli/src/commands/mcp.ts:0` |
| `apps/cli/src/commands/mcp.ts:19` |
| `apps/cli/src/commands/mcp.ts:9` |
| `apps/cli/src/commands/self/index.ts:2` |
| `apps/cli/src/commands/self/index.ts:4` |
| `apps/cli/src/commands/self/index.ts:6` |
| `apps/cli/src/commands/self/index.ts:9` |
| `apps/cli/src/commands/self/init.ts:1` |
| `apps/cli/src/commands/self/maintain.ts:1` |
| `apps/cli/src/commands/self/migrate.ts:1` |
| `apps/cli/src/commands/self/serve.ts:1` |
| `apps/cli/src/commands/self/status.ts:0` |
| `apps/cli/src/commands/self/status.ts:1` |
| `apps/cli/src/commands/task/shared.ts:130` |
| `apps/cli/src/config/scaffold-manifest.ts:2` |
| `apps/cli/src/config/scaffold-manifest.ts:35` |
| `apps/cli/src/config/scaffold-manifest.ts:54` |
| `apps/cli/src/index.ts:141` |
| `apps/cli/src/index.ts:164` |
| `apps/cli/src/index.ts:167` |
| `apps/cli/src/index.ts:26` |
| `apps/cli/src/index.ts:28` |
| `apps/cli/src/index.ts:313` |
| `apps/cli/src/index.ts:317` |
| `apps/cli/src/index.ts:33` |
| `apps/cli/src/index.ts:35` |
| `apps/cli/tests/agents-md-portable-alignment.test.ts:4` |
| `apps/cli/tests/commands/agent-server.test.ts:3` |
| `apps/cli/tests/commands/agent/member-dispatch.test.ts:483` |
| `apps/cli/tests/commands/agent/member-dispatch.test.ts:62` |
| `apps/cli/tests/commands/agent/start.test.ts:3` |
| `apps/cli/tests/commands/agent/start.test.ts:84` |
| `apps/cli/tests/commands/agent/start.test.ts:93` |
| `apps/cli/tests/commands/agent/stop.test.ts:3` |
| `apps/cli/tests/commands/agent/usage.test.ts:303` |
| `apps/cli/tests/commands/agent/usage.test.ts:305` |
| `apps/cli/tests/commands/dispatch-inspect.test.ts:105` |
| `apps/cli/tests/commands/dispatch-inspect.test.ts:109` |
| `apps/cli/tests/commands/dispatch-inspect.test.ts:116` |
| `apps/cli/tests/commands/dispatch-inspect.test.ts:249` |
| `apps/cli/tests/commands/dispatch-inspect.test.ts:251` |
| `apps/cli/tests/commands/dispatch-inspect.test.ts:256` |
| `apps/cli/tests/commands/dispatch-inspect.test.ts:269` |
| `apps/cli/tests/commands/dispatch-inspect.test.ts:33` |
| `apps/cli/tests/commands/dispatch-inspect.test.ts:70` |
| `apps/cli/tests/commands/init-search.test.ts:110` |
| `apps/cli/tests/commands/init-search.test.ts:119` |
| `apps/cli/tests/commands/init-search.test.ts:122` |
| `apps/cli/tests/commands/init-search.test.ts:124` |
| `apps/cli/tests/commands/init-search.test.ts:130` |
| `apps/cli/tests/commands/init-search.test.ts:27` |
| `apps/cli/tests/commands/init-search.test.ts:40` |
| `apps/cli/tests/commands/init-search.test.ts:57` |
| `apps/cli/tests/commands/init-search.test.ts:69` |
| `apps/cli/tests/commands/init-search.test.ts:78` |
| `apps/cli/tests/commands/init-search.test.ts:96` |
| `apps/cli/tests/commands/init-status.test.ts:0` |
| `apps/cli/tests/commands/init-status.test.ts:18` |
| `apps/cli/tests/commands/init-status.test.ts:22` |
| `apps/cli/tests/commands/init-status.test.ts:30` |
| `apps/cli/tests/commands/init-status.test.ts:44` |
| `apps/cli/tests/commands/init-status.test.ts:49` |
| `apps/cli/tests/commands/init-status.test.ts:60` |
| `apps/cli/tests/commands/init-status.test.ts:73` |
| `apps/cli/tests/commands/mcp.test.ts:180` |
| `apps/cli/tests/commands/migrate-stubs.test.ts:0` |
| `apps/cli/tests/commands/migrate-stubs.test.ts:13` |
| `apps/cli/tests/commands/planning-system-events.test.ts:4` |
| `apps/cli/tests/commands/projects.test.ts:833` |
| `apps/cli/tests/commands/self-migrate-check.test.ts:20` |
| `apps/cli/tests/commands/self-migrate-check.test.ts:77` |
| `apps/cli/tests/commands/self-migrate-check.test.ts:85` |
| `apps/cli/tests/commands/self/init.test.ts:1` |
| `apps/cli/tests/commands/self/maintain.test.ts:1` |
| `apps/cli/tests/commands/self/migrate.test.ts:1` |
| `apps/cli/tests/commands/self/serve.test.ts:0` |
| `apps/cli/tests/commands/self/serve.test.ts:1` |
| `apps/cli/tests/commands/self/status.test.ts:1` |
| `apps/cli/tests/commands/serve-gateway.heavy.test.ts:3` |
| `apps/cli/tests/commands/serve-gateway.test.ts:0` |
| `apps/cli/tests/commands/serve-gateway.test.ts:7` |
| `apps/cli/tests/commands/status-gateway.test.ts:3` |
| `apps/cli/tests/commands/status-gateway.test.ts:37` |
| `apps/cli/tests/commands/status.test.ts:100` |
| `apps/cli/tests/commands/status.test.ts:124` |
| `apps/cli/tests/commands/status.test.ts:143` |
| `apps/cli/tests/commands/status.test.ts:157` |
| `apps/cli/tests/commands/status.test.ts:19` |
| `apps/cli/tests/commands/status.test.ts:39` |
| `apps/cli/tests/commands/status.test.ts:76` |
| `apps/cli/tests/commands/status.test.ts:92` |
| `apps/cli/tests/commands/workflow-system-events.test.ts:4` |
| `apps/cli/tests/errors.test.ts:108` |
| `apps/cli/tests/fixtures/agents-md-portable-contract.ts:4` |
| `apps/cli/tests/fixtures/script-absorption-pr9/workflows/pr-review.yaml:4` |
| `apps/cli/tests/help-doc-parity.test.ts:123` |
| `apps/cli/tests/help-doc-parity.test.ts:136` |
| `apps/cli/tests/help-doc-parity.test.ts:139` |
| `apps/cli/tests/help-doc-parity.test.ts:148` |
| `apps/cli/tests/help-doc-parity.test.ts:23` |
| `apps/cli/tests/help-doc-parity.test.ts:40` |
| `apps/cli/tests/help-doc-parity.test.ts:44` |
| `apps/cli/tests/help-doc-parity.test.ts:50` |
| `apps/cli/tests/help-doc-parity.test.ts:80` |
| `apps/cli/tests/help-doc-parity.test.ts:91` |
| `apps/cli/tests/helpers.test.ts:32` |
| `apps/cli/tests/helpers.test.ts:58` |
| `apps/cli/tests/init-templates.test.ts:100` |
| `apps/cli/tests/init-templates.test.ts:112` |
| `apps/cli/tests/init-templates.test.ts:122` |
| `apps/cli/tests/init-templates.test.ts:143` |
| `apps/cli/tests/init-templates.test.ts:150` |
| `apps/cli/tests/init-templates.test.ts:160` |
| `apps/cli/tests/init-templates.test.ts:172` |
| `apps/cli/tests/init-templates.test.ts:185` |
| `apps/cli/tests/init-templates.test.ts:209` |
| `apps/cli/tests/init-templates.test.ts:214` |
| `apps/cli/tests/init-templates.test.ts:226` |
| `apps/cli/tests/init-templates.test.ts:238` |
| `apps/cli/tests/init-templates.test.ts:24` |
| `apps/cli/tests/init-templates.test.ts:241` |
| `apps/cli/tests/init-templates.test.ts:252` |
| `apps/cli/tests/init-templates.test.ts:265` |
| `apps/cli/tests/init-templates.test.ts:282` |
| `apps/cli/tests/init-templates.test.ts:29` |
| `apps/cli/tests/init-templates.test.ts:296` |
| `apps/cli/tests/init-templates.test.ts:308` |
| `apps/cli/tests/init-templates.test.ts:333` |
| `apps/cli/tests/init-templates.test.ts:362` |
| `apps/cli/tests/init-templates.test.ts:383` |
| `apps/cli/tests/init-templates.test.ts:74` |
| `apps/cli/tests/init-templates.test.ts:85` |
| `apps/cli/tests/init-templates.test.ts:91` |
| `apps/cli/tests/self-noun.test.ts:21` |
| `apps/cli/tests/self-noun.test.ts:61` |
| `apps/cli/tests/self-noun.test.ts:68` |
| `apps/cli/tests/self-noun.test.ts:69` |
| `apps/cli/tests/self-noun.test.ts:72` |
| `apps/cli/tests/self-noun.test.ts:81` |
| `apps/cli/tests/self-noun.test.ts:86` |
| `apps/cli/tests/self-noun.test.ts:88` |
| `apps/cli/tests/self-noun.test.ts:94` |
| `apps/cli/tests/self-noun.test.ts:97` |
| `apps/cli/tests/workflow/make-lifecycle-adapter.test.ts:101` |
| `apps/server/src/modules/a2a/index.ts:12` |
| `apps/server/src/modules/a2a/index.ts:18` |
| `apps/server/src/modules/health/index.ts:84` |
| `apps/server/src/serve.ts:347` |
| `apps/server/src/serve.ts:722` |
| `apps/server/tests/board-listener-lifecycle.test.ts:4` |
| `apps/server/tests/mcp-e2e.test.ts:2` |
| `apps/server/tests/mcp-e2e.test.ts:51` |
| `apps/server/tests/modules/a2a/routes.test.ts:2` |
| `apps/server/tests/modules/a2a/routes.test.ts:404` |
| `apps/server/tests/modules/mcp-module.test.ts:2` |
| `apps/server/tests/modules/observability/index.test.ts:72` |
| `apps/server/tests/serve.test.ts:2526` |
| `apps/server/tests/serve.test.ts:3135` |
| `apps/server/tests/workspace-test-isolation.test.ts:9` |
| `apps/server/vite.config.ts:17` |
| `apps/web/src/components/LeftSidebar.tsx:20` |
| `apps/web/src/components/base-path.ts:4` |
| `apps/web/src/modules/settings/GeneralView.tsx:194` |
| `apps/web/tests/test-helpers/board-server.ts:4` |
| `config/config.example.yaml:141` |
| `config/config.example.yaml:198` |
| `config/config.example.yaml:2` |
| `config/config.global.yaml:3` |
| `config/rules/strict/runtime-boundaries.yaml:133` |
| `config/templates/AGENTS.md:13` |
| `config/workflows/task-pipeline.yaml:46` |
| `docs/01_PRD.md:140` |
| `docs/03_ARCHITECTURE.md:1439` |
| `docs/03_ARCHITECTURE.md:856` |
| `docs/03_ARCHITECTURE.md:868` |
| `docs/04_DESIGN.md:136` |
| `docs/04_DESIGN.md:90` |
| `docs/analysis/relaydeck-vs-spur-analysis.md:179` |
| `docs/design/a2a-member-transport.md:121` |
| `docs/design/a2a-member-transport.md:147` |
| `docs/design/a2a-member-transport.md:164` |
| `docs/design/a2a-member-transport.md:166` |
| `docs/design/a2a-member-transport.md:200` |
| `docs/design/a2a-member-transport.md:23` |
| `docs/design/a2a-member-transport.md:278` |
| `docs/design/a2a-member-transport.md:293` |
| `docs/design/a2a-member-transport.md:89` |
| `docs/design/a2a-member-transport.md:97` |
| `docs/design/cli-contracts.md:1278` |
| `docs/design/cli-contracts.md:142` |
| `docs/design/cli-contracts.md:144` |
| `docs/design/cli-contracts.md:162` |
| `docs/design/cli-contracts.md:175` |
| `docs/design/cli-contracts.md:180` |
| `docs/design/cli-contracts.md:56` |
| `docs/design/cli-contracts.md:635` |
| `docs/design/cli-contracts.md:641` |
| `docs/design/cli-contracts.md:741` |
| `docs/design/cli-contracts.md:882` |
| `docs/design/cli-contracts.md:887` |
| `docs/design/cli-contracts.md:893` |
| `docs/design/cli-contracts.md:925` |
| `docs/design/configuration-contracts.md:124` |
| `docs/design/configuration-contracts.md:126` |
| `docs/design/configuration-contracts.md:128` |
| `docs/design/configuration-contracts.md:205` |
| `docs/design/configuration-contracts.md:24` |
| `docs/design/configuration-contracts.md:43` |
| `docs/design/configuration-contracts.md:78` |
| `docs/design/downstream-board-modules.md:254` |
| `docs/design/downstream-board-modules.md:269` |
| `docs/design/e2e-workflow-for-system-development.md:265` |
| `docs/design/embedded-mcp-server.md:104` |
| `docs/design/embedded-mcp-server.md:15` |
| `docs/design/embedded-mcp-server.md:22` |
| `docs/design/embedded-mcp-server.md:3` |
| `docs/design/fleet-config-declaration.md:100` |
| `docs/design/fleet-orchestration-lanes.md:73` |
| `docs/design/harness-surface-governance.md:223` |
| `docs/design/harness-surface-governance.md:227` |
| `docs/design/history-cli-contracts.md:559` |
| `docs/design/history-cli-contracts.md:697` |
| `docs/design/history-cli-contracts.md:758` |
| `docs/design/history-refresh-process-isolation.md:20` |
| `docs/design/hybrid-search.md:245` |
| `docs/design/hybrid-search.md:85` |
| `docs/design/inter-agent-control-plane.md:202` |
| `docs/design/inter-agent-control-plane.md:85` |
| `docs/design/planning-command-contracts.md:74` |
| `docs/design/planning-command-contracts.md:77` |
| `docs/design/planning-workflow-contracts.md:522` |
| `docs/design/portable-agents-harness-contract.md:17` |
| `docs/design/portable-agents-harness-contract.md:58` |
| `docs/design/project-gateway.md:17` |
| `docs/design/project-gateway.md:26` |
| `docs/design/project-switcher.md:153` |
| `docs/design/project-switcher.md:17` |
| `docs/design/project-switcher.md:205` |
| `docs/design/project-switcher.md:210` |
| `docs/design/project-switcher.md:220` |
| `docs/design/project-switcher.md:284` |
| `docs/design/project-switcher.md:29` |
| `docs/design/project-switcher.md:32` |
| `docs/design/project-switcher.md:415` |
| `docs/design/project-switcher.md:468` |
| `docs/design/project-switcher.md:82` |
| `docs/design/rd3-migration-design.md:225` |
| `docs/design/rd3-migration-design.md:468` |
| `docs/design/server-contracts.md:100` |
| `docs/design/server-contracts.md:151` |
| `docs/design/server-contracts.md:182` |
| `docs/design/server-side-adjustment-design.md:1357` |
| `docs/design/server-side-adjustment-design.md:1362` |
| `docs/design/server-side-adjustment-design.md:1395` |
| `docs/design/server-side-adjustment-design.md:1419` |
| `docs/design/server-side-adjustment-design.md:1424` |
| `docs/design/server-side-adjustment-design.md:1478` |
| `docs/design/server-side-adjustment-design.md:1531` |
| `docs/design/server-side-adjustment-design.md:1539` |
| `docs/design/server-side-adjustment-design.md:1706` |
| `docs/design/server-side-adjustment-design.md:1733` |
| `docs/design/server-side-adjustment-design.md:1764` |
| `docs/design/server-side-adjustment-design.md:199` |
| `docs/design/server-side-adjustment-design.md:25` |
| `docs/design/server-side-adjustment-design.md:66` |
| `docs/design/server-side-adjustment-design.md:702` |
| `docs/design/server-side-adjustment-feature-finalized.md:1023` |
| `docs/design/server-side-adjustment-feature-finalized.md:115` |
| `docs/design/server-side-adjustment-feature-finalized.md:120` |
| `docs/design/server-side-adjustment-feature-finalized.md:131` |
| `docs/design/server-side-adjustment-feature-finalized.md:138` |
| `docs/design/server-side-adjustment-feature-finalized.md:147` |
| `docs/design/server-side-adjustment-feature-finalized.md:151` |
| `docs/design/server-side-adjustment-feature-finalized.md:158` |
| `docs/design/server-side-adjustment-feature-finalized.md:163` |
| `docs/design/server-side-adjustment-feature-finalized.md:171` |
| `docs/design/server-side-adjustment-feature-finalized.md:176` |
| `docs/design/server-side-adjustment-feature-finalized.md:67` |
| `docs/design/session-pinned-dispatch.md:30` |
| `docs/design/session-pinned-dispatch.md:69` |
| `docs/design/workflow-composition-contract.md:30` |
| `docs/design/workflow-consolidation.md:157` |
| `docs/design/workflow-shell-ownership.md:305` |
| `docs/help/cmd_agent.md:34` |
| `docs/help/cmd_agent.md:354` |
| `docs/help/cmd_init.md:10` |
| `docs/help/cmd_maintain.md:5` |
| `docs/help/cmd_migrate.md:7` |
| `docs/help/cmd_serve.md:8` |
| `docs/help/cmd_status.md:6` |
| `docs/help/spur-cli-matrix.md:123` |
| `docs/help/spur-cli-matrix.md:125` |
| `docs/help2/init.md:6` |
| `docs/help2/maintain.md:5` |
| `docs/help2/migrate.md:5` |
| `docs/help2/serve.md:6` |
| `docs/help2/status.md:5` |
| `docs/inventory/0221-emit-sites.md:132` |
| `docs/inventory/0221-emit-sites.md:15` |
| `docs/inventory/0221-emit-sites.md:159` |
| `docs/inventory/0221-emit-sites.md:165` |
| `docs/inventory/0221-emit-sites.md:18` |
| `docs/inventory/0221-emit-sites.md:205` |
| `docs/inventory/0221-emit-sites.md:24` |
| `docs/inventory/0221-emit-sites.md:42` |
| `docs/inventory/0221-emit-sites.md:60` |
| `docs/inventory/system-events-producer-audit.md:16` |
| `docs/inventory/system-events-producer-audit.md:169` |
| `docs/inventory/system-events-producer-audit.md:98` |
| `docs/plans/2026-06-10-rd3-migration-feature-list.md:127` |
| `docs/plans/2026-06-10-rd3-migration-feature-list.md:331` |
| `docs/plans/2026-06-10-rd3-migration-feature-list.md:61` |
| `docs/plans/2026-07-03-feature-cycle-prioritization-brainstorm.md:118` |
| `docs/plans/2026-07-03-feature-cycle-prioritization-brainstorm.md:124` |
| `docs/plans/2026-07-03-feature-cycle-prioritization-brainstorm.md:41` |
| `docs/plans/2026-07-03-feature-cycle-prioritization-brainstorm.md:43` |
| `docs/plans/2026-07-03-feature-cycle-prioritization-brainstorm.md:55` |
| `docs/plans/2026-07-03-feature-cycle-prioritization-brainstorm.md:70` |
| `docs/plans/2026-07-12-observability-processes-runtime-tree-brainstorm.md:22` |
| `docs/plans/2026-07-12-observability-tool-using-tab-brainstorm.md:67` |
| `docs/plans/2026-07-29-project-switcher-brainstorm.md:117` |
| `docs/plans/2026-07-29-project-switcher-brainstorm.md:139` |
| `docs/plans/2026-07-29-project-switcher-brainstorm.md:16` |
| `docs/plans/2026-07-29-project-switcher-brainstorm.md:169` |
| `docs/plans/2026-07-29-project-switcher-brainstorm.md:172` |
| `docs/plans/2026-07-29-project-switcher-brainstorm.md:22` |
| `docs/plans/2026-07-29-project-switcher-brainstorm.md:27` |
| `docs/plans/2026-07-29-project-switcher-brainstorm.md:40` |
| `docs/plans/2026-07-29-project-switcher-brainstorm.md:50` |
| `docs/plans/2026-07-29-project-switcher-brainstorm.md:67` |
| `docs/plans/2026-08-15-agent-inline-host-session-brainstorm.md:120` |
| `docs/plans/2026-10-14-spur-script-absorption.md:272` |
| `docs/plans/2026-11-03-runall-a34-batch-report.md:20` |
| `docs/plans/2026-11-14-a2a-agent-orchestration-brainstorm.md:30` |
| `docs/plans/2026-11-14-a2a-agent-orchestration-brainstorm.md:34` |
| `docs/plans/2026-11-15-multi-agent-task-orchestration.md:237` |
| `docs/plans/rd3-migration-delivery.md:258` |
| `docs/plans/rd3-migration-delivery.md:430` |
| `docs/plans/rd3-migration-delivery.md:53` |
| `docs/plans/rd3-migration-delivery.md:91` |
| `docs/plans/server-side-adjustment-feature-drafted.md:272` |
| `docs/plans/server-side-adjustment-feature-drafted.md:33` |
| `docs/plans/server-side-adjustment-feature-drafted.md:406` |
| `docs/plans/server-side-adjustment-feature-drafted.md:411` |
| `docs/plans/server-side-adjustment-feature-drafted.md:414` |
| `docs/plans/server-side-adjustment-feature-drafted.md:416` |
| `docs/plans/server-side-adjustment-feature-drafted.md:421` |
| `docs/plans/server-side-adjustment-feature-drafted.md:423` |
| `docs/plans/server-side-adjustment-feature-drafted.md:425` |
| `docs/plans/server-side-adjustment-feature-drafted.md:430` |
| `docs/plans/server-side-adjustment-feature-drafted.md:434` |
| `docs/plans/server-side-adjustment-feature-drafted.md:439` |
| `docs/plans/server-side-adjustment-feature-drafted.md:476` |
| `docs/plans/server-side-adjustment-feature-drafted.md:558` |
| `docs/plans/server-side-adjustment-feature-drafted.md:567` |
| `docs/plans/server-side-adjustment-feature-drafted.md:603` |
| `docs/plans/server-side-adjustment-feature-drafted.md:622` |
| `docs/plans/server-side-adjustment-feature-drafted.md:649` |
| `docs/plans/server-side-adjustment-feature-drafted.md:667` |
| `docs/publish/2026-08-28-spur-self-improving-harness-zh.md:32` |
| `packages/app/src/builder/bundle-web.ts:7` |
| `packages/app/src/services/a2a-member-address.ts:90` |
| `packages/app/src/services/git-context.ts:3` |
| `packages/app/src/services/global-seed.ts:8` |
| `packages/app/src/services/member-dispatch.ts:12` |
| `packages/app/src/services/member-dispatch.ts:146` |
| `packages/app/src/services/member-dispatch.ts:150` |
| `packages/app/src/services/member-dispatch.ts:58` |
| `packages/app/src/services/process-inventory-service.ts:180` |
| `packages/app/src/services/project-gateway.ts:17` |
| `packages/app/src/services/project-gateway.ts:195` |
| `packages/app/src/services/project-registry.ts:79` |
| `packages/app/src/services/project-start.ts:208` |
| `packages/app/src/services/project-start.ts:211` |
| `packages/app/src/services/project-start.ts:244` |
| `packages/app/src/services/project-start.ts:364` |
| `packages/app/src/services/project-start.ts:38` |
| `packages/app/src/services/project-start.ts:409` |
| `packages/app/src/services/project-start.ts:466` |
| `packages/app/src/services/projects-summary.ts:100` |
| `packages/app/src/services/projects-summary.ts:102` |
| `packages/app/src/services/scheduler-custom-job-service.ts:102` |
| `packages/app/src/services/scheduler-custom-job-service.ts:104` |
| `packages/app/src/services/scheduler-custom-job-service.ts:21` |
| `packages/app/src/services/scheduler-custom-job-service.ts:236` |
| `packages/app/src/services/scheduler-custom-job-service.ts:45` |
| `packages/app/src/services/section-matrix-loader.ts:11` |
| `packages/app/src/services/self-status.ts:208` |
| `packages/app/src/services/self-status.ts:217` |
| `packages/app/src/services/self-status.ts:233` |
| `packages/app/src/services/self-status.ts:249` |
| `packages/app/src/services/self-status.ts:276` |
| `packages/app/src/services/self-status.ts:359` |
| `packages/app/src/services/self-status.ts:48` |
| `packages/app/src/services/supervisor-service.ts:143` |
| `packages/app/src/services/supervisor-service.ts:376` |
| `packages/app/src/services/supervisor-service.ts:92` |
| `packages/app/tests/builder/bundle-web.test.ts:3` |
| `packages/app/tests/services/a2a-member-address.test.ts:89` |
| `packages/app/tests/services/agent-run-executor.test.ts:141` |
| `packages/app/tests/services/agent-run-executor.test.ts:147` |
| `packages/app/tests/services/dogfood/pipeline-detect.test.ts:59` |
| `packages/app/tests/services/git-context.test.ts:7` |
| `packages/app/tests/services/history-capability-replay.test.ts:311` |
| `packages/app/tests/services/process-inspector.test.ts:12` |
| `packages/app/tests/services/process-inspector.test.ts:19` |
| `packages/app/tests/services/process-inspector.test.ts:42` |
| `packages/app/tests/services/process-inspector.test.ts:52` |
| `packages/app/tests/services/process-inventory-service.test.ts:53` |
| `packages/app/tests/services/project-gateway-dial.test.ts:6` |
| `packages/app/tests/services/project-registry.test.ts:103` |
| `packages/app/tests/services/project-start.test.ts:708` |
| `packages/app/tests/services/projects-summary.test.ts:148` |
| `packages/app/tests/services/self-status.test.ts:177` |
| `packages/config/src/bundled-config.ts:98` |
| `packages/config/src/config-layers.ts:34` |
| `packages/config/src/index.ts:699` |
| `packages/config/src/loader.ts:396` |
| `packages/domain/src/analytics/importer-schema-version.ts:110` |
| `packages/domain/src/analytics/importer-schema-version.ts:90` |
| `packages/domain/src/envelope/schema.ts:233` |
| `packages/domain/src/migrations.ts:1082` |
| `packages/domain/src/migrations.ts:143` |
| `packages/domain/src/migrations.ts:1695` |
| `packages/domain/tests/analytics/importer-schema-version.test.ts:105` |
| `packages/domain/tests/analytics/importer-schema-version.test.ts:134` |
| `packages/domain/tests/analytics/importer-schema-version.test.ts:2` |
| `packages/domain/tests/analytics/importer-schema-version.test.ts:9` |
| `packages/domain/tests/db.test.ts:694` |
| `plugins/sp/README.md:405` |
| `plugins/sp/references/roles.md:78` |
| `plugins/sp/skills/doc-evolve/SKILL.md:72` |
| `plugins/sp/skills/doc-evolve/SKILL.md:75` |
| `plugins/sp/skills/parallel-execution/references/dispatch-surface.md:168` |
| `plugins/sp/skills/spur-cli/references/agent.md:104` |
| `plugins/sp/skills/spur-cli/references/agent.md:62` |
| `plugins/sp/skills/spur-cli/references/projects.md:96` |
| `plugins/sp/skills/spur-cli/references/self.md:11` |
| `plugins/sp/skills/spur-cli/references/serve.md:65` |
| `plugins/sp/skills/spur-dev/references/execution-worktree.md:164` |
| `plugins/sp/tests/help-docs-parity.test.ts:122` |
| `scripts/commands/a2a-member-e2e.ts:251` |
| `scripts/commands/a2a-member-e2e.ts:271` |
| `scripts/commands/a2a-serve-e2e.ts:133` |
| `scripts/commands/a2a-serve-e2e.ts:136` |
| `scripts/commands/a2a-serve-e2e.ts:2` |
| `scripts/commands/a2a-serve-e2e.ts:224` |
| `scripts/commands/a2a-serve-e2e.ts:229` |
| `scripts/commands/a2a-serve-e2e.ts:433` |
| `scripts/commands/a2a-serve-e2e.ts:8` |
| `scripts/commands/a2a-two-install-e2e.ts:111` |
| `scripts/commands/delegate-workflow-e2e.ts:147` |
| `scripts/commands/delegate-workflow-e2e.ts:5` |
| `scripts/commands/fleet-e2e.ts:3411` |
| `scripts/commands/fleet-e2e.ts:626` |
| `scripts/commands/fleet-e2e.ts:632` |
| `scripts/commands/surface-drift-inventory.test.ts:941` |
| `scripts/commands/surface-drift-inventory.test.ts:963` |
| `scripts/commands/surface-drift-inventory.ts:899` |
| `scripts/install.sh:19` |
| `scripts/spur-dev.ts:42` |
| `tests/setup.ts:83` |
| `apps/cli/tests/self-noun-only.test.ts:1` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — migrate every executable caller (`packages/app/src/services/project-start.ts` spawn argv, script spawns, package scripts) | MET | `packages/app/src/services/project-start.ts` spawns `[..., 'self', 'serve', ...]`; the seam test in `packages/app/tests/services/project-start.test.ts` was red before the change and asserts `spawned[serveIndex - 1] === 'self'` now. Four e2e scripts (`a2a-serve-e2e`, `a2a-member-e2e`, `a2a-two-install-e2e`, `delegate-workflow-e2e`) and the drift inventory's probe argv migrated. **Runtime proof:** `spur projects start` spawned a healthy serve (`running: true`, port 3014) and `self serve --gateway` proxied `/spur-new/api/health` → 200 |
| R2 — migrate user-facing strings, help summaries, plugin references, templates, READMEs and drift rows | MET | 170 files swept (`spur serve |
| R3 — remove the five hidden registrations, the fast-path `migrate`/`status` registrations, keeping the `self` fast path | MET | `apps/cli/src/index.ts` no longer registers any of the five at the top level (normal boot) and drops both fast-path aliases; `self` retains all five. `apps/cli/tests/self-noun-only.test.ts` drives `buildProgram`: no top-level noun list entry, `self` still has all five, and `spur serve`/`spur status` are unknown commands |
| R4 — prove `projects start` spawns a healthy serve, the gateway proxies, `spur serve` is unknown, parity suites pass; no legacy spelling in executable sources | MET | `projects start` → `running: true`; gateway index 200 + proxy 200; unknown-command test above; `cli-surface-parity` + `help-docs-parity` 25/25, `apps/cli` 1887/1887, `recommended-pre-check` 51/51; `rg` over executable sources returns only the removal test that names the old spelling on purpose |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Legacy top-level nouns are removed with no internal caller left (R1,R2,R3,R4) | MET | command | `bun apps/cli/src/index.ts projects start <name> --json` → `running: true, port 3014`; `bun apps/cli/src/index.ts self serve --gateway` + `curl /spur-new/api/health` → 200; `bun test apps/cli/tests` 1887/1887; `rg "spur (serve |
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

- 2026-11-18T17:46:14.599Z todo → wip (system)
- 2026-11-18T18:31:01.653Z wip → testing (system)
- 2026-11-18T18:31:03.137Z testing → done (system)

