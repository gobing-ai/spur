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

## Phase 5+ — Extension Seams (later)

First-party registries (rule evaluators, workflow actions, agent shims, history sources) become
plugin-loadable without changing their seam contracts. Cooperation/remote transport considered only
if a concrete need surfaces.

## Deferred / under review

Asset SSOT model, multi-tenant or remote execution, desktop/mobile — out of scope until reconfirmed
(PRD §5.3/§5.4).
