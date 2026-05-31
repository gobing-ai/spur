---
name: Extract CLI domain to packages-domain and enforce DAO boundary
description: Extract CLI domain to packages-domain and enforce DAO boundary
status: Backlog
created_at: 2026-05-31T06:22:59.990Z
updated_at: 2026-05-31T06:22:59.990Z
folder: docs/tasks
type: task
feature-id: ""
dependencies: ["ts-libs BaseDao (parallel agent) for any DAO feature gaps"]
tags: ["refactor","architecture","packages","dao","rules"]
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: pending
  testing: pending
---

## 0001. Extract CLI domain to packages-domain and enforce DAO boundary

### Background

apps/cli carries 845 lines of shared spur-domain logic (db/ DAOs 544 + analytics/ 301) that does not belong in an app. apps/server (102 LOC) and apps/web (77 LOC) are already thin transport with no domain logic to extract. The stranded logic blocks the server from reading workspaces/runs/history/analytics in roadmap Phase 4 (cross-app imports of apps/cli internals are forbidden). Goal: centralize spur domain in packages/ while keeping apps as real-but-thin transport layers (NOT old-style anemic wrappers; transport/bootstrap/arg-parsing stay in apps). Domain engines (rule/workflow/ai-runner/importer) already live in ts-libs; this task only relocates the spur-local domain that currently lives inside apps/cli.


### Requirements

R1: Create packages/domain (@gobing-ai/spur-domain) with its own package.json + tsconfig extending tooling/typescript/base.json. R2: Move apps/cli/src/db/ (DAOs, base, migrations, types, index) and apps/cli/src/analytics/ (costs, models, query, types, index) into packages/domain/src. Move their tests too. R3: Rewire apps/cli imports to consume @gobing-ai/spur-domain via workspace:* alias; no apps/cli/src/db or apps/cli/src/analytics remain. R4: Lean on ts-db BaseDao in the DAOs — replace raw adapter.run/queryFirst/queryAll with BaseDao typed methods where BaseDao supports it. If BaseDao lacks a needed feature (upsert/on-conflict, composite-key ops, ordered list), DO NOT edit ts-libs here — file a follow-up note for the parallel ts-libs agent and keep a thin documented raw-SQL fallback in the DAO until ts-libs lands it. R5: apps/server and apps/web require no extraction (already thin) — verify they stay thin and are ready to consume packages/domain later; no code change unless an import needs rewiring. R6: Gate green — bun run lint + bun run test + bun run test-cf + bun run build; coverage maintained; migrations smoke (spur migrate creates full schema). R7 (rule enforcement, AFTER R2-R4 land): author .spur/rules rules that (a) forbid importing @gobing-ai/ts-db outside packages/domain (forbidden-import evaluator), and (b) confine raw SQL / adapter.run|exec|query to packages/domain/src/**/dao (regex evaluator). Severity error. R8: Fix the two broken .spur/rules preset files (recommended.yaml, spur-dev.yaml) — they currently fail the GLOBAL spur schema validation because they use extends: with no rules: array (the global /Users/robin/xprojects/spur/dist/cli/spur is the quality gate until new spur is ready). R9: The global spur binary at /Users/robin/xprojects/spur/dist/cli/spur stays the quality-gate tool; do NOT rebuild it. New rules must validate against it.


### Q&A



### Design



### Solution

Single packages/domain package (not split persistence+analytics — premature at ~845 LOC, R2 simplicity). Phased: (1) scaffold packages/domain; (2) git mv db/ + analytics/ + their tests; (3) rewire apps/cli imports to @gobing-ai/spur-domain (workspace:* — it IS a workspace member, unlike ts-libs); (4) refactor DAOs onto BaseDao, documenting any ts-libs gap as a follow-up; (5) verify full gate + migration smoke; (6) add the two enforcement rules scoped to the NEW layout + fix the two broken preset files; (7) re-run global spur rule run --preset recommended to confirm rules validate and pass. Keep apps thin: arg dispatch, commands (transport), Hono/oRPC bootstrap, Astro pages, Worker entrypoint all STAY in apps.


### Plan



### Review



### Testing



### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


