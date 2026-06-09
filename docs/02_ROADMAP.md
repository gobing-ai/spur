# 02 Roadmap — Spur

**Version:** 1.0.0
**Derived from:** `docs/01_PRD.md` v1.0.0, `docs/00_ADR.md`
**Last Updated:** 2026-06-03
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

## Phase 2 — Agent Execution & Run Model

Turn detection into execution with a captured run model.

- [~] `spur agent run <task>` — single-shot execution via `AiRunner` shipped early (incl. team-mode
  identity/drain flags, pending verification); artifact capture into the run model still pending.
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
