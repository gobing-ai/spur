---
kind: report
title: Key-document drift audit against Spur 0.3.96
created_at: 2026-09-30
status: complete
---

# Key-document audit — Spur 0.3.96

Audited `AGENTS.md`, `docs/00_ADR.md`, `docs/01_PRD.md`,
`docs/03_ARCHITECTURE.md`, and `docs/99_PROJECT_CONSTITUTION.md` using
`sp:doc-evolve`. Baseline: clean working tree at `8ab6cdfb4`; installed `spur --version`
reported `0.3.96`, matching the CLI manifest. Findings below are documentation repairs,
not new product decisions. Later accepted ADRs govern earlier historical wording.

## Findings and repairs

| Document | Previous statement / defect | Evidence and governing authority | Repair |
| --- | --- | --- | --- |
| AGENTS; architecture §1 | Web uses an Astro Cloudflare adapter | `apps/web/astro.config.mjs` uses static output; web manifest has no Cloudflare adapter | Describe the static Astro/React Board; retain the separate Worker server |
| AGENTS | Root tests enforce a repository coverage denominator | `bunfig.toml` explicitly documents thresholds per measured file | Point to the actual coverage contract |
| AGENTS init seed | Outside-facade list includes retired `team` and already-covered nouns | `plugins/sp/skills/spur-cli/SKILL.md` noun routing; constitution §4.4 | Align fallback guidance with root AGENTS without copying a volatile inventory |
| ADR-010/033/047/082/085/086 | Original wording can be mistaken for current Board, selector, config, triage or fleet policy | ADR-021/078/087/089 amendments/111/116/121 | Add current-authority pointers; retain original decisions and dates (§6.1) |
| ADR-050/058/088/115 | Older sweep, baseline and gate-placement descriptions lack nearby current-policy pointers | ADR-090/108/119; root `package.json` | Identify superseded policy and current feature gate without deleting history |
| ADR-024/038/120 | Moved builtins, parity test and environment gateway paths; ambiguous upstream path | `packages/app/src/workflow/builtins.ts`, `plugins/sp/tests/cli-surface-parity.test.ts`, `plugins/sp/lib/env.ts`, `config/rules/boundary/env-var-hygiene.yaml` | Correct references; distinguish current strict enforcement from historical exemption wording |
| PRD §4–5 | Planning presented as obligatorily spawning `spur agent run` | ADR-047/087; root harness execution contract | Describe host-session planning with explicit subprocess support |
| PRD §5 | Recovery remains deferred; capability conversion treated as future Spur ownership | ADR-121 and architecture §25; ADR-032 | Include ownership-scoped recovery and assign adapter generation to Superskill |
| PRD §4–6 | Hidden top-level self-management aliases presented as canonical; universal JSON claim | `apps/cli/src/index.ts` self registrations and hidden aliases; ADR-053 | Use `spur self` forms, preserve compatibility note, qualify machine-output scope |
| Architecture §1–4 | Stale dependency sketch, Team/Plugin inventory, single-process-only framing, incorrect source paths | Workspace manifests; `apps/server/src/modules/task/handlers.ts` and feature handlers; ADR-021/034 | Describe shared application writes, current vocabulary, source locations and fenced tree diagram |
| Architecture §1.2/19 | Code-owned roles, public `--stage`, retired adapter, omission differing from inline | `AgentService.resolveAgent`/`resolveCanonicalStage`; `plugins/sp/tests/roles.test.ts`; ADR-078/087 | Restore config authority, fallback provenance and current selector semantics |
| Architecture §1.2/8 | Once-per-process config implies no availability reload; ambiguous precedence; absolute ts-db import rule | Composition-root reload callbacks; ADR-111/121; `config/rules/boundary/dao-boundary.yaml` | Explain reload ownership, local-over-global precedence and bundler-only exception |
| Architecture §10/12 | Future Board routes, old feature filename shape, obsolete cutover risk | Task/feature HTTP handlers; `FeatureService` generates `<id>_<slug>.md`; ADR-021 | Describe existing routes, filename convention and shared-write invariant |
| Architecture §14.5 | Full-bleed header contradicts later amendment | ADR-081 amendment; `TasksShell.tsx` centered header | Retain centered header with full-bleed board body |
| Architecture §16/25 | Catalog-open ingestion still pending | `system-event-catch-all.ts`, `SystemEventEmitter`, server attachment; ADR-110 | Describe generic retained events and cataloged live SSE limitation |
| Architecture §20/27 | Retired composition baseline treated as active; inline System Event pairs required despite amendment | ADR-108; ADR-117 amendment of 2026-09-17 | Describe live contract checking and current inline trace obligation |
| Architecture §26; deadline satellite | Renewable durable queue ownership still upstream-pending | Installed ts-db/ts-infra 0.5.11: `claimReady(..., {leaseMs})`, `renewLease`, fenced terminal writes; domain queue factory and server consumer wiring | Describe adopted lease ownership and legacy unleased age recovery; synchronize satellite |
| ADR test | Working diff allows changes only in seven hardcoded ADRs, then becomes vacuous after commit | Reproduced failure on an editorial pointer; constitution §6.1 permits editorial maintenance | Replace edit whitelist with issued-heading/date preservation; retain all six specific supersession/history tests |
| Constitution | No confirmed governance defect | Full read; §4.3 metadata checks; init template comparison identical apart from creation/update dates | Leave unchanged; no version-only churn |

## Verification

- `spur --version`: **0.3.96**.
- `bun run lint`: **PASS**, including all workspace and standalone TypeScript checks.
- `bun run test-pre-check`: **50 rules passed**.
- `bun run test-post-check`: **2 rules passed**.
- `bun run test-repo-wide`: **7 tests passed**, including historical identity and G64 preservation.
- From `apps/cli`, `bun test tests/agents-md-portable-alignment.test.ts`: **9 tests passed**.
- Parsed numbered-document YAML: required fields, document IDs, authority, edit-rule pointers and
  derived ownership **PASS**. Changed numbered documents receive minor version bumps.
- Constitution/init-template parity: **PASS** after normalizing only creation/update dates.
- Markdown file-link existence scan across the five requested files: **zero broken destinations**.
- Entry aliases: `CLAUDE.md` and `GEMINI.md` both resolve to `AGENTS.md`.
- `git diff --check`: **PASS**.

The obsolete ADR whitelist failed before its repair; all six content-specific tests already passed.
The replacement checks every previously issued ADR heading and original date, rather than expanding
an allowlist for this edit. This changes document-maintenance validation, not corpus checker policy.

## Scope and retained history

This is a key-document audit with targeted source verification, not a repository-wide defect or
legacy-corpus audit. No task/feature records, product runtime behavior, public CLI surface or
accepted architectural choices changed. No pipeline ran, so no task verification verdict is claimed.
Full application tests, Cloudflare tests and release builds were not run for these documentation and
ADR-test changes. Queue ownership was verified from installed code and composition, not a live
multi-process stress test. Markdown heading anchors were not exhaustively validated.

Deleted pipeline, Inbox and plugin paths remain where the prose explicitly records their retirement
or historical implementation. The old generated digest path in ADR-079 is historical amendment
evidence. `spur task show 0015 --json` confirms the harness-registry task remains blocked; its
reactivation conditions are preserved. ADR-131/E71 remains explicitly implementation-pending.
Legacy task metadata and design satellites outside the affected deadline contract are separate audit
scope; their presence does not authorize a broad migration in this change.
