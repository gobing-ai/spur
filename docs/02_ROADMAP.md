# 02 Roadmap — Spur

**Version:** 1.0.0
**Derived from:** `docs/01_PRD.md` v1.0.0, `docs/00_ADR.md`
**Last Updated:** 2026-05-30
**Owner:** Robin Min

Phases gate on the previous one. When this document conflicts with `docs/00_ADR.md`, the ADR wins.

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

- [ ] **Publish the four extracted engines to npm; switch `link:` → semver** (ADR-004 open item). This
  is the gate that makes the repo build from a clean clone.
- [ ] Cutover: make this repo the canonical Spur (replace the legacy tree or re-point the remote).
- [ ] Harden each command: richer error messages, exit-code contracts, `--json` schema stability.
- [ ] Self-host the quality gate via `spur rule run` (recommended + spur-dev presets, coverage gate).
- [ ] Squash re-foundation commit noise; clean conventional-commit history.
- [ ] Expand test coverage on DB-dependent paths (history analytics queries, workflow run failures).

**Exit:** clean-clone build works; CLI self-hosts its own gate; history/coverage paths covered.

## Phase 2 — Agent Execution & Run Model

Turn detection into execution with a captured run model.

- [ ] `spur agent run <task>` — execute a prompt/slash-command through a detected agent, capturing
  stdout/stderr as artifacts (uses `AiRunner`).
- [ ] Run model: persist runs, phases, events, artifacts through the workflow engine's persistence.
- [ ] `spur inspect <run-id>` — run timeline, events, gates, artifacts.
- [ ] Redaction at the persistence boundary (secrets/PII never reach the store).

**Exit:** an agent run is executed, captured, and inspectable locally.

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

The plugin system is a **low-level substrate**, not an optional add-on: first-party primitives
(agent harnesses, rule evaluators, model providers, history sources, workflow actions) are *eventually
implemented as bundled plugins on top of it*. The substrate is designed for that load-bearing role from
day one (two-class fail-fast/fail-soft loading, public registry contracts, `bundled` trust = "this is
the system"), but no working first-party code is migrated onto it in the initial slices —
**substrate now, migrate later** (ADR-012 Decision 7). Cooperation/remote transport considered only if
a concrete need surfaces.

Plugin system design is settled in **ADR-012** (task 0006, design-only). The monolithic build is
re-scoped into gated, independently-shippable slices:

- [ ] **5a — Plugin SDK** (`@gobing-ai/spur-plugin-sdk`): `SpurPlugin`, `PluginHost`, the eight
  registries, `PluginConfig` merge, trust-level *policy* (registration-time capability gating). No
  runtime sandboxing. Standalone package depending only on `ts-infra`. *Substrate:* registry
  `register()` methods are public SemVer-significant contracts; built-ins are pre-registered through
  the same path; `bundled` capabilities are unconditionally allowed.
- [ ] **5b — Discovery + CLI**: `PluginLoader` (discover → validate → load → register) in
  `packages/app`; `spur plugin list|info`; plugin commands surface in `spur help`. *Substrate:*
  two-class loading — **bundled/core plugins fail-fast** (a failure aborts startup, it *is* the
  system); local/curated plugins fail-soft (skipped, never crash Spur). Core discovery completes
  before command dispatch and before server route-mount (explicit bootstrap ordering).
- [ ] **5c — Server seam**: mount plugin Hono routes under their prefix; appear in generated OpenAPI.
- [ ] **5d — Harness registry**: a Spur-side overlay `Map<string, AgentShim>` checked before
  `getAgentShim`, so a plugin supplies an object satisfying the structural **`AgentShim`** interface.
  No upstream gate (the `AgentName` union is compile-time only). An optional upstream nicety (export
  an `AgentShim` guard / accept an injected shim in `AiRunner`) removes seam casting but is not
  required.
- [ ] **5e — Runtime sandboxing** *(accepted out of scope, PRD §5.4 + ADR-010)*: true fs/net/shell
  isolation for `curated`/`untrusted` plugins. **Not on the Phase-5 critical path.** Spur is
  single-machine and every installed plugin is operator-trusted; `untrusted` plugins are not loaded
  (fail-closed). Revisited only if genuinely third-party, non-operator-authored plugins are onboarded.
- [ ] **5f — First primitive migration** *(substrate's first real exercise; not yet scheduled)*: move
  the seven built-in agent harnesses (and, subsequently, rule evaluators / providers / history sources)
  from hardcoded built-ins onto **bundled** plugins running on the substrate. Validates that a core
  primitive really lives on the plugin system, not beside it. R10 backward-compat is preserved by
  construction (a built-in becomes a bundled plugin with identical behavior). Sequenced after 5a–5d.

## Deferred / under review

Asset SSOT model, multi-tenant or remote execution, desktop/mobile — out of scope until reconfirmed
(PRD §5.3/§5.4).
