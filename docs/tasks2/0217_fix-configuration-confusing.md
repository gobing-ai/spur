---
schema_version: 1
name: "fix configuration confusing"
status: done
template: standard
created_at: 2026-07-06T18:19:13.523Z
updated_at: "2026-07-06T22:41:04.119Z"
---

## 0217. fix configuration confusing

### Background

As the source code of `spur`, we use folder `config` to store configuration files as the default configuration files. That's also the folder we used to publish to the npm registry.

Meanwhile, this project is also a place to apply `spur` as the harness tool to help to ensure the quality of the codebase. That's why we need its runtime configuration in folder `.spur`.

To avoid duplication and avoid conflicts, we already added symbolic links to `.spur/plugins`, `.spur/rules`, `.spur/tasks`, `.spur/templates`, and `.spur/workflows` to make them point to the relevant subfolder under `config`. You can check with command `ls -l` to see the symbolic links.

But as we can see, with the source code in `apps`, `packages` or `plugins/sp`, we mixed them together and used come inconsistently. For example, I just checked with `plugins/sp` via the following command:

```bash
rg -l 'config/plugins' plugins/sp
rg -l 'config/rules' plugins/sp
rg -l 'config/tasks' plugins/sp
rg -l 'config/templates' plugins/sp
rg -l 'config/workflows' plugins/sp
```

Then I got the following results:

```
plugins/sp/commands/spur-init.md
plugins/sp/skills/spur-dev/references/planning-workflow.md
plugins/sp/skills/spec-decomposition/references/decomposition.md
plugins/sp/skills/spur-cli/references/tasks/verbs.md
plugins/sp/skills/spur-dev/SKILL.md
plugins/sp/skills/spur-dev/references/planning-workflow.md
plugins/sp/skills/spur-dev/references/ac-style-guide.md
plugins/sp/skills/spec-decomposition/references/decomposition.md
plugins/sp/commands/dev-brainstorm.md
plugins/sp/skills/spur-dev/SKILL.md
plugins/sp/skills/spur-dev/references/execution-workflow.md
plugins/sp/skills/spur-dev/references/execution-batch.md
plugins/sp/skills/spur-dev/references/dev-operations.md
plugins/sp/skills/code-verification/SKILL.md
plugins/sp/README.md
plugins/sp/skills/code-verification/references/verdict-schema.md
plugins/sp/agents/super-coder.md
plugins/sp/commands/workflow-add.md
plugins/sp/commands/dev-run.md
plugins/sp/skills/spur-cli/references/workflows/operations.md
plugins/sp/commands/dev-runall.md
plugins/sp/skills/spur-cli/references/workflows.md
```

I did not check with `apps` and `packages` right now, I guess they are also having configuration files in `config` folder. That gets all the configuration files incorrectly for all plugin `sp` or `spur` CLI commands. Especially, we have issues with `plugins/sp/commands/spur-init.md`, that means all new project try to use `spur` via `/sp:spur-init` to bring the issues into the new project. We must fix this issue to avoid confusion.

### Requirements
- [ ] R1. All `plugins/sp/` files that reference `config/plugins`, `config/rules`, `config/tasks`, `config/templates`, or `config/workflows` are updated to reference their `.spur/` equivalents — so agent instructions teach the correct runtime convention.
- [ ] R2. `apps/`, `packages/`, and `plugins/sp/` are audited for `config/(plugins|rules|tasks|templates|workflows)` path references. **Runtime** references are updated to `.spur/` equivalents. **Build-time** references (bundled-fallback loaders, JSDoc describing the shipped asset layout, test fixtures loading shipped YAMLs) are **rewritten** so they no longer contain the literal `config/...` pattern — e.g. rephrase JSDoc to "bundled templates" / "shipped workflow `X`", load test fixtures via `bundledConfigRoot()` indirection or a non-string-literal path, reword JSON-Schema `$id`/description prose. No `config/...` pattern may remain in scope, because R6's rule fires on the pattern regardless of whether the reference is runtime or build-time.
- [ ] R3. A new ADR entry clarifies the separation: `config/` = build-time default assets shipped in the CLI bundle; `.spur/` = runtime configuration directory. Agent-facing instructions and runtime code MUST reference `.spur/` paths.
- [ ] R4. `plugins/sp/commands/spur-init.md` no longer propagates `config/` paths — `/sp:spur-init` must instruct agents to reference `.spur/` for rules, workflows, tasks, templates, and plugins.
- [ ] R5. No functional regressions: `bun run check` and `bun run test` pass; `spur init` creates a correct `.spur/` structure referencing `.spur/` paths.
- [ ] R6. A standing `spur` rule enforces zero `config/(plugins|rules|tasks|templates|workflows)` references across `apps/`, `packages/`, and `plugins/sp/` — all file types — so the fix cannot silently regress. The rule runs as part of `recommended-pre-check` (the preset behind `bun run test-pre-check`) at `severity: error` with `fail-on: error`. No new `spur-check` script alias is added.
### Acceptance Criteria
- [ ] R1. After fix, zero files in `plugins/sp/` contain `config/plugins`, `config/rules`, `config/tasks`, `config/templates`, or `config/workflows` as path references.
- [ ] R2. `rg 'config/(plugins|rules|tasks|templates|workflows)' apps packages plugins/sp` returns **zero matches** — including build-time references. No literal `config/...` pattern remains in `apps/`, `packages/`, or `plugins/sp/`. Runtime refs were repointed to `.spur/`; build-time refs were rewritten to avoid the pattern (see R2 requirement).
- [ ] R3. `docs/00_ADR.md` contains a dated entry documenting the `config/` (build-time) vs `.spur/` (runtime) separation, with a one-line rationale.
- [ ] R4. `plugins/sp/commands/spur-init.md` references only `.spur/` paths — `rg 'config/(plugins|rules|tasks|templates|workflows)' plugins/sp/commands/spur-init.md` returns zero matches.
- [ ] R5. `bun run check` exits 0; `bun run test` exits 0; a manual `spur init --minimal --force` smoke test creates a project with correct `.spur/` conventions.
- [ ] R6. A new rule file `config/rules/boundary/sp-runtime-path.yaml` exists with `include` covering `apps/**`, `packages/**`, `plugins/sp/**` (all file types — `.ts`, `.md`, `.yaml`, `.yml`, `.json`), `exclude` covering only `**/node_modules/**` and `**/dist/**`, `evaluator: rg` with pattern `config/(plugins|rules|tasks|templates|workflows)`, `severity: error`. `recommended-pre-check.yaml` runs it via the existing `boundary` category — no preset edit. `bun run test-pre-check --fail-on error` exits 0 after the R1/R2 fixes land. Negative test: re-introduce one `config/rules` literal into any in-scope file (e.g. a `plugins/sp/**/*.md`), re-run `bun run test-pre-check --fail-on error`, confirm non-zero exit; then revert.
### Q&A

<!-- Open questions and their resolutions. Delete if none. -->

### Design
**Chosen approach:** Keep `config/` as build-time SSOT (per ADR-015), update all runtime and agent-instruction references to use `.spur/` paths. Rationale: surgical fix with zero structural change to the build pipeline.

**Rejected alternative:** Move everything from `config/` to `.spur/`. Rejected because: (a) contradicts ADR-015 which makes `config/` the single source of truth for bundled defaults; (b) requires build pipeline and release process changes; (c) `.spur/` in user projects is typically gitignored, but the Spur repo's config assets must be committed.

**Path replacement map** (22 files in `plugins/sp/`, TBD count in `apps/` + `packages/`):
- `config/plugins` → `.spur/plugins`
- `config/rules` → `.spur/rules`
- `config/tasks` → `.spur/tasks`
- `config/templates` → `.spur/templates`
- `config/workflows` → `.spur/workflows`

**Invariants:**
- No symlink changes — `.spur/` → `config/` symlinks remain for the Spur project's own `spur` CLI use.
- No build pipeline changes — `apps/cli` still bundles from `config/`.
**ADR entry:** Appended to ADR-015, dated 2026-07-06, clarifying the build-time vs runtime path convention.

**Standing enforcement (R6):** A new `spur` rule `config/rules/boundary/sp-runtime-path.yaml` uses the `rg` evaluator with pattern `config/(plugins|rules|tasks|templates|workflows)`, `severity: error`, `include: [apps/**, packages/**, plugins/sp/**]` (all file types), `exclude: [**/node_modules/**, **/dist/**]` — same shape as the existing `sp-no-vendor-refs.yaml`. It is covered by `recommended-pre-check`'s existing `boundary` category extension — no preset edit, no new `spur-check` package.json script. **Blanket scope (chosen):** the rule fires on the literal `config/...` pattern regardless of whether the reference is runtime or build-time; this eliminates the false-positive triage of distinguishing the two at the rule level, and instead pushes that distinction into the fix — runtime refs repoint to `.spur/`, build-time refs are rewritten (rephrased JSDoc/test-fixture indirection) to avoid the pattern. The rule is a **standing gate**, not a transitional one — contrast with `rg-migration.yaml`, which is deliberately excluded from the presets. **Cost of blanket scope:** ~17+ legitimate build-time references across `apps/cli`, `packages/app`, `packages/config`, `packages/domain` (bundled-fallback JSDoc, test fixtures loading shipped YAMLs, JSON-Schema prose) must be rewritten in step 4 so they no longer emit the literal pattern.

### Plan
1. Add ADR entry to `docs/00_ADR.md` clarifying `config/` (build-time) vs `.spur/` (runtime) separation.
2. Audit `apps/`, `packages/`, and `plugins/sp/` `config/` references via `rg 'config/(plugins|rules|tasks|templates|workflows)' apps packages plugins/sp`. Enumerate every hit and classify as runtime (→ `.spur/`) or build-time (→ rewrite to avoid the pattern). No reference is kept as-is.
3. Update all `plugins/sp/` files: replace `config/plugins`, `config/rules`, `config/tasks`, `config/templates`, `config/workflows` with `.spur/` equivalents.
4. Update `config/` references in `apps/`, `packages/`, and `plugins/sp/`: runtime refs → `.spur/` equivalents; build-time refs (bundled-fallback JSDoc, test fixtures, JSON-Schema prose) → rewritten to avoid the literal `config/...` pattern (rephrase JSDoc to "bundled templates"/"shipped workflow `X`"; load test fixtures via `bundledConfigRoot()` indirection or non-string-literal paths; reword JSON-Schema `$id`/description). No build-time reference is skipped — all must avoid the pattern so the R6 rule passes.
5. Run `bun run check` → fix any failures.
6. Run `bun run test` → fix any failures.
7. Smoke test: `spur init --minimal --force /tmp/spur-test-0217` and verify `.spur/` structure.
8. Add standing enforcement: create `config/rules/boundary/sp-runtime-path.yaml` (include `apps/**`, `packages/**`, `plugins/sp/**` — all file types; exclude `**/node_modules/**`, `**/dist/**`; rg pattern `config/(plugins|rules|tasks|templates|workflows)`; severity error). No preset edit — `boundary` is already in `recommended-pre-check`.
9. Run `bun run test-pre-check --fail-on error` → must exit 0. Negative test: re-introduce one `config/rules` literal into any in-scope file, confirm `bun run test-pre-check --fail-on error` exits non-zero, then revert.
### Solution
**Change map** (task 0217 — fix configuration path confusion):

| File | Change |
|------|--------|
| `docs/00_ADR.md:364-376` | ADR-015 amendment: `config/` (build-time) vs `.spur/` (runtime) separation |
| `config/rules/boundary/sp-runtime-path.yaml` | New standing rule: zero `config/(plugins\|rules\|tasks\|templates\|workflows)` in scope (severity error, `recommended-pre-check`) |
| `plugins/sp/` (18 files) | All `config/plugins`, `config/rules`, `config/tasks`, `config/templates`, `config/workflows` → `.spur/` equivalents (runtime path convention) |
| `plugins/sp/commands/spur-init.md:98` | `config/rules/**` → `.spur/rules/**` — init no longer propagates wrong convention |
| `apps/cli/schemas/section-matrix.schema.json:5` | Description rephrased: "shipped section-matrix.yaml" (avoids `config/` literal) |
| `apps/cli/src/commands/task.ts:632,672,686,742,768` | JSDoc/code comments rephrased: "bundled template fallback", "bundled section-matrix fallback" (avoids `config/` literal) |
| `apps/cli/src/workflow/make-lifecycle-adapter.ts:27` | JSDoc rephrased: "shipped `workflows/<name>.yaml`" (avoids `config/` literal) |
| `apps/cli/tests/commands/workflow.test.ts:66` | Test description rephrased: "bundled workflows" (avoids `config/` literal) |
| `packages/app/src/services/task-service.ts:219` | JSDoc rephrased: "shipped `tasks/section-matrix.yaml`" |
| `packages/app/src/services/workflow-service.ts:26` | JSDoc rephrased: "shipped `workflows/task-pipeline.yaml`" |
| `packages/app/src/workflow/lifecycle-adapter.ts:32` | JSDoc rephrased: "shipped `workflows/<name>.yaml`" |
| `packages/app/tests/workflow/lifecycle-adapter.test.ts:13` | Test fixture path: `resolve(import.meta.dir, '..', '..', '..', '..', 'config', 'workflows', 'task-lifecycle.yaml')` — separate segments avoid literal |
| `packages/app/tests/workflow/feature-lifecycle-adapter.test.ts:13` | Same pattern: `resolve(import.meta.dir, '..', '..', '..', '..', 'config', 'workflows', 'feature-lifecycle.yaml')` |
| `packages/config/src/bundled-config.ts:89` | JSDoc rephrased: "shipped `templates/`" |
| `packages/domain/src/planning/schema.ts:100` | JSDoc rephrased: "shipped as `templates/task/<variant>.md`" |
| `packages/domain/src/planning/task-skeleton.ts:13,41,146` | JSDoc rephrased: "shipped `tasks/section-matrix.yaml`", "shipped with the CLI" |
| `packages/domain/tests/planning/lifecycle-drift.test.ts` | `loadLifecycleYaml` now accepts `...segments`; all 4 callers pass split path segments; line 198 uses `join(REPO_ROOT, 'config', 'workflows', ...)` |

**Invariants preserved:**
- No symlink changes
- No build pipeline changes — `apps/cli` still bundles from `config/`
- `bundledConfigRoot()` resolution unchanged
- All 2421 tests pass, `bun run check` clean, `bun run test-pre-check --fail-on error` clean

**Negative test:** Re-introducing `config/rules` into `plugins/sp/README.md` → `sp-runtime-path` rule catches it at severity error, exit code 1. Reverted.

**Smoke test:** `spur init --minimal --force` in temp dir creates correct `.spur/` structure with no `config/` path references.
### Testing
**Gate results:**
- `bun run check` — passed (Biome + tsc all workspaces)
- `bun run test` — 2421 tests pass
- `bun run test-cf` — Cloudflare Workers tests pass
- `bun run build` — all workspaces build clean

**Acceptance criteria verification:**
- R1: `rg 'config/(plugins|rules|tasks|templates|workflows)' plugins/sp` — zero matches
- R2: `rg 'config/(plugins|rules|tasks|templates|workflows)' apps packages plugins/sp` — zero matches across all tracked files
- R3: ADR-015 amendment dated 2026-07-06 at `docs/00_ADR.md:364-376`
- R4: `rg 'config/(plugins|rules|tasks|templates|workflows)' plugins/sp/commands/spur-init.md` — zero matches
- R5: `spur init --minimal --force` smoke test — correct `.spur/` structure, no `config/` path references
- R6: `bun run test-pre-check --fail-on error` — all 30 rules pass including `sp-runtime-path` (#26). Negative test: reintroducing `config/rules` literal into `plugins/sp/README.md` → caught at severity error, exit code 1; reverted.

**Coverage:** N/A — this is a path-convention hygiene task with zero net-new production logic.
### Review
| Severity | File | Finding | Recommendation |
|----------|------|---------|---------------|
| P4 | — | No findings — all path replacements are mechanical string substitutions with zero behavioral change. | — |

**Architecture:** No module boundaries, data flow, or invariants changed. The `config/` → `bundledConfigRoot()` resolution path is unaltered. The 23-file change map covers every `config/...` reference in scope: 18 runtime → `.spur/` repoints, 5 build-time → prose rewrites. Standing `sp-runtime-path` rule (severity: error, `recommended-pre-check`) enforces the invariant.
### History
- 2026-07-06T22:28:25.505Z backlog → todo (system)
- 2026-07-06T22:36:37.657Z todo → wip (system)
- 2026-07-06T22:36:40.902Z wip → testing (system)
- 2026-07-06T22:36:53.682Z testing → wip (system)
- 2026-07-06T22:40:40.865Z wip → testing (system)
- 2026-07-06T22:41:04.119Z testing → done (system)
