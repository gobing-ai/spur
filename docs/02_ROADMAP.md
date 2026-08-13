---
doc: 02_ROADMAP
owns: WHEN — phases, current vs deferred, sequencing
authority: derived
version: 1.3.0
derived_from: [01_PRD, 00_ADR]
owner: Robin Min
updated_at: 2026-08-12
read_before: placing work in a phase
edit_rules: 99 §6.3
sync: [T5, T6]
---

# 02 Roadmap — Spur

Phases gate on the previous one.

## Phase 0 — Re-Foundation _(done)_

Clean greenfield foundation, apps ported, engines extracted to ts-libs.

- [x] Scaffold Bun-workspace monorepo from ts-base mono (no Turborepo) — ADR-001/002/003.
- [x] Consume `ts-db`/`ts-infra`/`ts-runtime`/`ts-utils` by semver — ADR-004.
- [x] Port server + web to oRPC type seam (health vertical slice) — ADR-005.
- [x] Port CLI with local DAOs + package-owned schema — ADR-007.
- [x] Extract `ts-ai-runner`, `ts-rule-engine`, `ts-dual-workflow-engine`, `ts-llm-jsonl-importer` — ADR-006/008/009.
- [x] Wire `init`, `agent`, `rule`, `workflow`, `history` CLI commands end-to-end.

**Exit:** `bun run check` + `bun run test-cf` green; five committed commands work end-to-end.

## Phase 1 — Hardening _(current)_

Make the harness robust and clean before adding surface.

- [x] **Publish the extracted engines; switch `link:` → semver** (ADR-004). All `@gobing-ai/ts-*`
  resolve via the root catalog at `^0.3.0`; no `link:` remnants; `bun run build` green from a clean
  install. This is the gate that makes the repo build from a clean clone.
- [x] Cutover: this repo is the canonical Spur (`origin` = `github.com/gobing-ai/spur.git`); legacy
  tree retired / remote re-pointed.
- [ ] Harden each command: richer error messages, exit-code contracts, `--json` schema stability.
- [x] Self-host the quality gate via `spur rule run`. `spur-check` runs `recommended-pre-check` +
  `recommended-post-check` presets via the local CLI (`spur rule run --fail-on warning`).
- [ ] Squash re-foundation commit noise; clean conventional-commit history.
- [x] Expand test coverage on DB-dependent paths. History `query.ts` is integration-tested against
  in-memory SQLite (single/all-source, since-filter, empty, malformed-`payload_json` guard); workflow
  validate/run failure paths covered. Both at 100% line/func.

**Exit:** clean-clone build works; CLI self-hosts its own gate; history/coverage paths covered.

## Phase 1.5 — Planning Layer (rd3 migration) _(current — waves done, board cutover done)_

Migrate the task/feature domain from `cc-agents/plugins/rd3` per ADR-020–023. Scope,
per-item dispositions, and full wave contents live in
`docs/plans/2026-06-10-rd3-migration-feature-list.md` §Batch sequencing — this phase tracks stage
status only. Per ADR-023(3), Stage D designs everything collectively before the waves implement.

- [x] **Stage D — Collective design** (gates all waves): `04` schemas, lifecycle-on-workflow
  design + upstream ts-libs gap tasks, server/web design task (ADR-021.b), planning-skill contract.
- [x] **Wave 0 — Foundation** (schema, BDD validator, locking, lifecycle definitions, migrate tool)
- [x] **Wave 1 — Task CLI** (`spur task`)
- [x] **Wave 2 — Feature CLI** (`spur feature`)
- [x] **Wave 3 — Board** per Stage-D design; **A17 cutover gate cleared** (2026-07-04, task 0192).
      The live Task Kanban board (W3) is the daily driver; the generated `kanban.md` has been
      retired and the live `docs/tasks2/` corpus was normalized via `spur task migrate`. The
      server/web implementation lives in the **Server-Side Adjustment** programme below (groups S + W).
- [x] **Wave 4 — Pipeline + execution** (planning skill, task-pipeline workflow, HITL continue)
- [x] **Wave 5 — sp wrappers** (ADR-016-filtered)
- [ ] **Wave 6 — cc-agents cleanup** (each item gated on its verified replacement)

**Exit:** operator daily-drives the spur board; agents drive `spur task` across the 7 corpora;
legacy `plugins/rd3` executable surface frozen.

### Phase 1.5 — Server-Side Adjustment (server/web re-foundation) _(current — implementing; core waves shipped)_

Re-founds `apps/server` (Hono base API server, module system, task/feature modules) and `apps/web`
(Astro static SPA: React + Tailwind v4 + daisyUI, 3-column board, Task Kanban) so Wave 3's board is
real. Two top-level feature groups: **S — Server API**, **W — Web board**. Scope, IDs, acceptance
criteria, and wave sequencing are authoritative in
`docs/design/server-side-adjustment-feature-finalized.md` v1.0; mechanism in
`docs/design/server-side-adjustment-design.md` v0.2. This sub-phase tracks wave status only.

- [x] **P1 — `ts-runtime` enhancement** _(prerequisite, upstream `ts-libs` — DONE 2026-06-15)_:
  `RuntimeFactory.createDbAdapter()` + `RuntimeCapabilities.hasSqlDatabase` shipped in
  `@gobing-ai/ts-runtime@0.3.19`; Spur catalog bumped to `^0.3.19`, gate green. S0/S1 unblocked.
  **D1 support in `ts-db` remains scoped out** this round (CF factory throws `D1NotConfiguredError`;
  Cloudflare path runs health + OpenAPI only; local Bun path carries full functionality).
- [x] **S0 wave — Server foundation**: S0 (`spur serve` launcher), S1 (middleware pipeline, graceful
  shutdown, `ServerContext` + DB/FS/EventBus/JobQueue/Scheduler wiring), S2 (module system + health
  reference module). *Gate: server boots, pipeline + module system proven.* Shipped 2026-06.
- [x] **W0 wave — Web foundation**: W1 (stack migration), W2 (3-column layout + `WebModule` system +
  React Router 7 + extended `rpc-client`), W5 (unified Vite dev server). *Gate: static SPA shell,
  layout, module system proven; one-port dev. Can overlap S0 (needs only the health endpoint).* Shipped 2026-06.
- [x] **S1 wave — Server domain**: S3 (task + feature modules), S4 (contracts + output envelope +
  error mapping + `planningEventContract`), S5 (static asset serving). *Gate: task/feature API live,
  contracts shipped, board served on one port.* Shipped 2026-07 (events/jobs/messages modules added).
- [x] **W1 wave — Web module**: W3 (Task Kanban — proves the design end-to-end), W4 (theming /
  dark mode / responsive, P2). *Gate: Task Kanban functional end-to-end → satisfies Wave 3 board +
  A17 cutover.* Shipped 2026-07 (observability module added).
- [ ] **Deferred — SSE live stream**: S6 (server SSE handler) + W6 (client subscription). Designed
  now (design §2.9), implementation gated on module-system stability and D1; board uses polling
  until then. `planningEventContract` ships with S4.

**Exit (reached 2026-07-04):** `spur serve` launches a live Task Kanban board backed by the
task/feature oRPC API; the board replaced `kanban.md` (retired in the A17 cutover, task 0192) and
cleared the A17 cutover gate. The legacy `kanban.md` generator is removed.

## Phase 2 — Agent Execution & Run Model

Turn detection into execution with a captured run model.

- [~] `spur agent run <task>` — single-shot execution via `AiRunner` shipped early (incl. team-mode
  identity/drain flags, pending verification); artifact capture into the run model still pending.
- [ ] Run model: persist runs, phases, events, artifacts through the workflow engine's persistence.
- [~] Run inspection — partially delivered as `spur workflow trace [run-id]` and
  `spur rule trace [run-id]` (engine-persisted run history, tasks 0038/0040); events/gates/artifact
  depth still pending the run model.
- [ ] Redaction at the persistence boundary (secrets/PII never reach the store).
- [ ] Occupant identity + coordination-facing run artifacts (ADR-057 wave 1 / G4). Distinct from
  the rich inspector bullet above.
- [ ] Event-driven identity-pinned wait and atomic `message send --wait` (ADR-057 wave 2 / G4).
- [ ] Snapshot-then-follow on the existing `system_events` ledger (ADR-057 wave 3 / G4).

**Exit:** an agent run is executed, captured, and inspectable locally. A sibling agent can address
that run by occupant pin without scraping a terminal.

## Phase 3 — Workflow & Constraint Depth

Deepen the two engines from MVP to production parity.

- [ ] Rule engine: restore advanced evaluators (import-boundary, test-location, tsdoc-export,
  coverage-gate, secrets-scanner, ast-grep, schema-artifact) + fixers + SARIF output.
- [ ] Workflow engine: gates as transition predicates, iteration bounding, parallel/decision nodes,
  resume from last successful phase.
- [ ] Constraint findings linked to runs.

**Exit:** rule/workflow engines reach the capability bar of old spur, on the clean base.

## Phase 4 — Inspection Surface & Analytics

Promote the read surface.

- [ ] Server: expose read-only run/history/analytics procedures over oRPC.
- [ ] Web: inspection dashboards (runs, constraints, cost trends).
- [ ] History analytics: windowing/forecasting if ≥2 consumers justify extracting a shared toolkit;
  otherwise keep inline in `apps/cli/src/analytics`.

**Exit:** runs and analytics are inspectable in the browser without leaving local-first defaults.

## Phase 5+ — Extension Substrate (later)

Plugin substrate — the foundational extension model first-party primitives eventually run on
(design: ADR-012; mechanism: `03 §11`; shapes: `04 §6`). Built as gated, independently-shippable
slices; each passes the gate alone and preserves R10 backward-compat. 5a–5c are the shipped critical
path; 5d is deferred (ADR-012 addendum 2026-06-03); 5e is out of scope; 5f is unscheduled.

- [x] **5a — Plugin SDK** (`@gobing-ai/spur-plugin-sdk`): registries + `PluginConfig` merge + trust
  *policy* (registration-time gating, no runtime sandbox). *(task 0012)*
- [x] **5b — Discovery + CLI**: superseded by the 2026-06-09 ADR-012 amendment; `PluginLoader` and
  `spur plugin list|info` are removed until a real plugin consumer exists. *(task 0013, reversed)*
- [x] **5c — Server seam**: superseded by the 2026-06-09 ADR-012 amendment; `/api/plugins/<prefix>`
  route mounting and server plugin hooks are removed until plugins return. *(task 0014, reversed)*
- [ ] **5d — Harness registry** *(deferred — ADR-012 addendum 2026-06-03)*: Spur-side `AgentShim`
  overlay. Resolution needs no upstream change, but **execution does** (`AiRunner` accepts only the
  closed `AgentName` union). No committed PRD surface consumes plugin-defined agent types; its only
  consumer is the unscheduled 5f migration. Reactivated when 5f is scheduled. *(task 0015 — Blocked)*
- [ ] **5e — Runtime sandboxing** *(out of scope — PRD §5.4 + ADR-010)*: fs/net/shell isolation;
  revisited only if non-operator-authored plugins are onboarded.
- [ ] **5f — First primitive migration** *(unscheduled)*: move the seven built-in harnesses (then
  rule evaluators / providers / history sources) onto bundled plugins. Sequenced after 5a–5d.

Cooperation / remote transport considered only if a concrete need surfaces.

## Deferred / under review

Asset SSOT model, multi-tenant or remote execution, desktop/mobile — out of scope until reconfirmed
(PRD §5.3/§5.4).
