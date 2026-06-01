# 05 Features — Spur

**Version:** 1.0.0
**Status:** Active
**Derived from:** `docs/01_PRD.md`, `docs/02_ROADMAP.md`, `docs/04_DESIGN.md`
**Last Updated:** 2026-05-30
**Owner:** Robin Min

Feature decomposition for Spur. Each leaf is a single deliverable mappable to one `tasks` WBS item
with a clear acceptance check. Status reflects the current codebase. When this conflicts with
`docs/00_ADR.md`, the ADR wins.

Legend: ✅ done · 🔶 partial (MVP, depth pending) · ⏳ planned · 💤 deferred (needs design).

## 1. Foundation

| Feature | Status | Acceptance |
|---------|--------|-----------|
| Bun-workspace monorepo, no Turborepo | ✅ | `bun run --filter '*'` orchestrates; no `turbo.json` |
| ts-base tooling (Biome, Lefthook, tsconfig presets) | ✅ | `bun run lint` gate green |
| ts-libs infra deps via semver | ✅ | `ts-db/infra/runtime/utils` at `^0.2.3` |
| Extracted engines published + semver-pinned | ⏳ | replace `link:` with `^x.y.z`; clean-clone build works |
| oRPC type seam (contracts, implement, generated OpenAPI) | ✅ | health vertical slice; drift is a compile error |
| Package-owned schema + CLI migrator | ✅ | `spur migrate` creates full schema; legacy migrations inert |

## 2. CLI Core

| Feature | Status | Acceptance |
|---------|--------|-----------|
| Arg dispatch + help/version | ✅ | `dispatch()` routes all commands; `--json` everywhere |
| `spur init` scaffold | ✅ | writes `.spur/config.json`, registers workspace (idempotent) |
| `spur status` | ✅ | reports config/package/workspace/git context |
| `spur migrate` | ✅ | applies CLI-owned schema via isolated journal |
| `spur inspect <path>` | ✅ | file metadata |
| `spur workspace add\|list` | ✅ | local workspace registry |
| Exit-code + `--json` schema contracts hardened | 🔶 | stabilize across all commands (Phase 1) |

## 3. Agents (`ts-ai-runner`)

| Feature | Status | Acceptance |
|---------|--------|-----------|
| `spur agent list` (detection) | ✅ | installed/missing per known agent |
| `spur agent doctor [agent]` (readiness) | ✅ | usable/needs-auth/missing + tier; exit on tier-1 failure |
| `spur agent run <task>` (execution + capture) | 💤 | execute via `AiRunner`, capture stdout/stderr as artifacts |
| Channel resolution / slash-command translation | 💤 | design before porting |

## 4. Rules (`ts-rule-engine`)

| Feature | Status | Acceptance |
|---------|--------|-----------|
| `spur rule run` (preset/file/rule, `--fail-on`) | ✅ | evaluates rules, returns findings + exit code |
| Built-in evaluators: regex/rg, path/file-exist, forbidden-import, exit-code, secrets-scanner, agent-detection | ✅ | covered by ts-libs tests |
| Text + JSON formatters | ✅ | host-registered |
| Advanced evaluators: import-boundary, test-location, tsdoc-export, coverage-gate, ast-grep, schema-artifact | 🔶 | restore to parity (Phase 3) |
| Fixers + SARIF output | ⏳ | Phase 3 |
| Self-host the quality gate (`spur rule run` as CI check) | ⏳ | Phase 1 |

## 5. Workflows (`ts-dual-workflow-engine`)

| Feature | Status | Acceptance |
|---------|--------|-----------|
| `spur workflow validate` (YAML + Zod) | ✅ | rejects invalid definitions |
| `spur workflow run` (FSM driver + persistence) | ✅ | runs to terminal state; persists run |
| `spur workflow list` | ✅ | lists persisted runs |
| State-machine + transition-flow modes | 🔶 | both present; gates/parallel/decision depth pending |
| Gates as transition predicates, iteration bounding, resume | ⏳ | Phase 3 |
| Built-in actions (shell, check, find-changed-files, find-unit-gaps) | 🔶 | core present; expand in Phase 3 |

## 6. History (`ts-llm-jsonl-importer` + analytics consumer)

| Feature | Status | Acceptance |
|---------|--------|-----------|
| `spur history import` (full/incremental/force-file) | ✅ | validated-before-persist; checkpointed; idempotent |
| 7 source definitions (pi, claude, codex, gemini, opencode, antigravity, openclaw) | ✅ | one `SourceDefinition` each |
| Configurable splitting (one-to-one/one-to-many/custom) | ✅ | declarative `splitConfig` |
| Field firewall (fieldMap + transforms) | ✅ | raw→canonical decoupling |
| Redaction (secrets/PII before dedup) | ✅ | runs before SHA-256 hashing |
| `spur history analyze` (cost/token analytics) | ✅ | totals + per-source/model/day |
| DB-dependent query test coverage | 🔶 | integration tests for `query.ts` (Phase 1) |
| Windowing/forecasting toolkit | 💤 | extract only with ≥2 consumers; else stay inline |

## 7. Server / Web (read surface)

| Feature | Status | Acceptance |
|---------|--------|-----------|
| Hono app + oRPC OpenAPI handler | ✅ | `/api/health`, `/openapi.json` |
| Bun + Cloudflare Worker entrypoints | ✅ | shared app at module scope; `test-cf` green |
| Astro web + typed oRPC client | ✅ | renders live health |
| Read-only run/history/analytics procedures | ⏳ | Phase 4 |
| Inspection dashboards | ⏳ | Phase 4 |

## 8. Deferred (needs design before build)

| Feature | Why deferred |
|---------|--------------|
| Asset SSOT model / `spur asset inspect` | Old `@spur/assets` discarded; rebuild only if needed |
| Rich `spur inspect <run-id>` (timeline/events/gates) | Depends on Phase 2 run model |
| Extension/plugin seams | Phase 5; first-party registries stay stable in the meantime |
| Remote/cooperation transport | Out of scope until a concrete need surfaces |
