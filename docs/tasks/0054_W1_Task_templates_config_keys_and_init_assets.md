---
name: "W1: Task templates, config keys and init assets"
description: "W1: Task templates, config keys and init assets"
status: done
created_at: 2026-06-13T01:08:18.983Z
updated_at: 2026-06-14T16:45:30.142Z
folder: docs/tasks
type: task
feature-id: F2
priority: P1
tags: ["rd3-migration","wave-1"]
impl_progress:
  planning: done
  design: done
  implementation: done
  review: done
  testing: done
---

## 0054. "W1: Task templates, config keys and init assets"

### Background

Design §8/§9, A12/A11, DD-11. Templates are real files; CLI never hardcodes body content.


### Requirements

R1. config/templates/task/{default,feature-impl,issue,review,meta}.md + feature/default.md + bdd/{gherkin,checklist}.md per §8 section sets.
R2. tasks:/features: zod keys in packages/config + spur-config.schema.json.
R3. spur init copies templates, matrix, lifecycle+pipeline YAML (ADR-015).
R4. Variant choice leaves no hidden state in files.


### Q&A



### Design

Authority: design §8 (template table: base + feature-impl/issue/review/meta + feature/default + bdd
two-tier snippets; section sets from the DD-08 vocabulary; `{{ PLACEHOLDER }}` substitution — the legacy
mechanism, no template engine dependency; DD-11: the CLI never hardcodes body content; no hidden template
state in files), §9 (config keys `tasks:`/`features:` camelCase; `spur init` copies assets per ADR-015).


### Solution

1. `config/templates/task/{default,feature-impl,issue,review,meta}.md`,
   `config/templates/feature/default.md`, `config/templates/bdd/{gherkin,checklist}.md` — section sets
   exactly per design §8 table; feature-impl pre-seeds AC from the linked feature (B09 hook point used by
   0050 create).
2. `packages/config`: zod additions per design §9 — `tasks.folders` (map of path → `{baseCounter, label?}`)
   + `tasks.active`, and `features.dir`; regenerate `apps/cli/schemas/spur-config.schema.json` to mirror
   the zod source (Zod is the SSOT).
3. `spur init`: extend the ADR-015 copy list with templates, section-matrix, lifecycle + pipeline YAMLs.
4. Tests: template render with placeholder substitution; init copy idempotence; config parse round-trip.
   Same commit: `04 §2.1/2.3` config rows + `§7.4`. Gate: `bun run check`; ≥90%.


### Plan

- [x] 8 template files under `config/templates/{task,feature,bdd}/` with §8 section sets + `{{ }}` placeholders
- [x] `tasks:`/`features:` zod schemas in `packages/config/src/index.ts` (`tasksConfigSchema` with `folders` map per §9, `featuresConfigSchema`)
- [x] `apps/cli/schemas/spur-config.schema.json` regenerated with `tasks`/`features` blocks (mirrors Zod SSOT)
- [x] `spur init` copies templates + section-matrix + lifecycle + pipeline YAML (`scaffold-manifest.ts`, ADR-015)
- [x] Variant choice leaves no hidden state in rendered files (R4)
- [x] Tests: template render, init copy idempotence, config parse round-trip
- [x] Sync `04_DESIGN.md §2.1` config rows (same-commit doc rule)


### Review

**SECU verdict: PARTIAL → PASS** (verified + fixed 2026-06-14 via `/rd3:dev-verify 0054 --force --fix all`)

**S — Security:** Templates are inert markdown with `{{ PLACEHOLDER }}` tokens only — no executable
content, no secrets. Config schemas validate structure; no injection surface.

**E — Efficiency:** N/A — static asset copy + schema parse.

**C — Correctness / architecture:**
- R1 ✓ All 8 templates present with the correct §8 section sets: `task/default`
  (Background/AC/Plan/Solution/Testing/Review/References/History), `task/feature-impl` (+Design,
  `feature_id` placeholder for B09 AC pre-seed), `task/issue` (Root Cause, `tags:[bug]`),
  `task/review` (review table, `profile: review`), `task/meta` (minimal), `feature/default`
  (Goal/Scope/AC + `BEGIN_TASKS`/`END_TASKS` markers), `bdd/{gherkin,checklist}` (two-tier snippets).
- R2 **was UNMET, now FIXED** — see Findings #1/#2.
- R3 ✓ `apps/cli/src/config/scaffold-manifest.ts:29-46` lists all 8 templates + `section-matrix.yaml`
  + lifecycle (`task-lifecycle`/`feature-lifecycle`) + `task-pipeline.yaml` workflows (ADR-015).
- R4 ✓ No hidden template state: rendered files carry only placeholders + legit frontmatter
  (`profile:` is a real task attribute, not a template-selection marker). Variant choice is
  resolved at render time and leaves no `template:`/`variant:` field in the output.

**U — Usability:** Template section sets match the DD-08 vocabulary; config keys are camelCase per §9.

### Findings

| # | Finding | Dim | Location | P | Disposition |
|---|---------|-----|----------|---|-------------|
| 1 | R2 incomplete + wrong shape: design §9 (`rd3-migration-design.md:441`) specifies `tasks: { folders: {path: {baseCounter, label}}, active }`, but `tasksConfigSchema` shipped `{ active, counterBase }` — **missing the `folders` map** and carrying a spurious top-level `counterBase`. The correctly-shaped `folderConfigSchema` was exported but **orphaned** (referenced nowhere). | Correctness | `packages/config/src/index.ts:33` | P2 | **FIXED** — `tasksConfigSchema.folders = z.record(string, folderConfigSchema)` wires in the orphan and matches §9; removed the spurious top-level `counterBase` (no production reader). Test rewritten to encode the §9 folders-map shape (R8). |
| 2 | R2 deliverable missing: `apps/cli/schemas/spur-config.schema.json` — the **active runtime validator** (`loader.ts:14`, embedded into the binary) — had **no `tasks`/`features` blocks** (stale since Jun 9, predates this task). The task explicitly required regenerating it. A user config with `tasks:` would be silently unvalidated. | Correctness | `apps/cli/schemas/spur-config.schema.json` | P2 | **FIXED** — added `tasks` (`folders` map + `active`) and `features` (`dir`) blocks mirroring the Zod SSOT. |
| 3 | Doc drift: design §2.1 project-config surface omitted the `tasks:`/`features:` keys, despite the Solution's "same commit: 04 §2.1/2.3" requirement. | Process | `docs/04_DESIGN.md §2.1` | P3 | **FIXED** — §2.1 example + key list now document `tasks.folders/active` + `features.dir` with a "Zod is SSOT" note. |

No P1 findings; both P2 findings fixed.

**Gate (post-fix):** `bun run lint` clean (249 files; 7 workspaces typecheck OK) · `bun run test`
1024 pass / 0 fail · zod `spurConfigSchema` parses the design §9 example end-to-end.


### Testing

Verified 2026-06-14. Tests genuine (real assertions).

- `packages/config/tests/config-schemas.test.ts` — `tasksConfigSchema` (folders map per §9 + defaults
  + per-folder baseCounter default), `featuresConfigSchema` (dir + default). Rewritten during the
  fix-pass to encode the design §9 `folders` shape rather than the old incomplete `{active, counterBase}`.
- `apps/cli/tests/init-templates.test.ts` — template render with `{{ PLACEHOLDER }}` substitution.
- `apps/cli/tests/commands/init.test.ts` — init copies the scaffold-manifest assets (templates,
  section-matrix, lifecycle + pipeline workflows); idempotence.
- `apps/cli/tests/config/loader.test.ts` — config load + `$schema` resolution against the embedded
  `spur-config.schema.json`.

Behavioral probe: zod `spurConfigSchema.safeParse` accepts the exact design §9 example
(`tasks.folders['docs/tasks'] = {baseCounter, label}`, `tasks.active`, `features.dir`).

Full suite: 1024 pass / 0 fail.


### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


