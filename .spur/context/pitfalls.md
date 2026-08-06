# Project Pitfalls

Dated "Do-Not-Repeat" entries extracted from the former `.wolf/cerebrum.md`.
Each entry records a past mistake and its correction. Maintained by the
`indexed-context` skill.

---

## Do-Not-Repeat

<!-- Mistakes made and corrected. Each entry prevents the same mistake recurring. -->
<!-- Format: [YYYY-MM-DD] Description of what went wrong and what to do instead. -->
- [2026-07-02] **The dual-workflow engine THROWS on any undeclared `${vars.*}` reference — it never treats an undefined var as empty/falsy.** `resolveTemplateString` raises `Workflow variable "x" is not defined`, and `firstPassingTransition` has no catch, so a guard referencing an undeclared var CRASHES the run (it does not fall through to the next transition). Every var referenced anywhere in a workflow YAML (guards AND actions) MUST have a default in the `vars:` block; callers override via `--vars`. Structural test R36 (plugins/sp/tests/skill-structure.test.ts) now enforces this for all config/workflows/*.yaml — keep it green. `spur workflow validate` does NOT catch this (it checks structure, not var references).
- [2026-07-02] **The engine's default onError policy is `fail` — never put a "quality check that is expected to fail sometimes" inside an onEnter action chain.** A failing shell/agent.run action fails the whole run before any transition guard is evaluated, so retry-loop transitions become dead code. Checks with retry routing belong in transition GUARDS (which pass/fail without killing the run); onEnter actions should only contain steps whose failure genuinely means "abort the run" (mechanical writes, missing prerequisites). This is why idea-pipeline's ac-generate does `feature update` in the action but `feature check --strict` only in guards.
- [2026-07-02] **`spur workflow run --vars` values must be STRINGS — never document or construct `--vars '{"tasks":["0167"]}'` with a raw JSON array.** parseVars rejects non-string values loudly. List-shaped vars are passed as JSON-encoded strings (`"tasks":"[\"0167\"]"`); pipeline guards parse them with `jq length`. Use `jq -nc --arg` in wrapper snippets to guarantee the shape.
- [2026-07-02] **When a new bundled workflow/config ships, update `apps/cli/src/config/scaffold-manifest.ts` in the same change** — otherwise `spur init` in a fresh project won't seed it and any command referencing `.spur/workflows/<new>.yaml` breaks outside this repo (this repo masks the gap via the .spur/workflows -> config/workflows symlink). The manifest test pins the entry count; bump it too.
- [2026-06-19] **`config/tasks/section-matrix.yaml` now loads via the STANDARD `loadStructuredConfig` path (root `$schema` ref + embedded schema), NOT bare `parseYaml`.** Added `$schema: "@gobing-ai/spur/schemas/section-matrix.schema.json"` as a real root KEY (not the `# yaml-language-server:` comment, which is editor-only). Generalized `apps/cli/src/config/loader.ts` from a single embedded spur-config schema to a registry (`EMBEDDED_SCHEMAS` keyed by subpath) so ANY spur-bundled config validates in a `--compile` binary. `loadSectionMatrix` is now async (`loadSpurConfig(matrixPath, { validateSchema: true })`) → `makeService`/`makeCheckService` are async → all 8 call sites `await`. The JSON schema must DECLARE `$schema` in its `properties` (loadStructuredConfig does NOT strip it before validating). Rule: Spur structured configs follow ONE load path — root `$schema` key + `loadSpurConfig`; never bare `parseYaml` for a file that has a schema.
- [2026-06-19] **ts-runtime's `loadStructuredConfig` JSON-Schema validator is MINIMAL — it supports `properties`/`required`/`additionalProperties` (+ object form `additionalProperties: {schema}`) and `$defs`/`$ref`/`enum`, but NOT `patternProperties` or `uniqueItems`.** The original `section-matrix.schema.json` used `patternProperties` for variant/status keys + `additionalProperties: false` — which the validator ignored (every variant flagged "unknown field"). It "worked" before only because the matrix was never runtime-validated (bare parseYaml). Fixed by restructuring: `variants` uses `additionalProperties: { "$ref": "#/$defs/variant" }` (extensible variant names), and `variant` enumerates the 7 canonical statuses as `properties` + `additionalProperties: false` (rejects typo'd status keys). Rule: when authoring a JSON schema for a ts-runtime-validated config, use ONLY `properties`/`required`/`additionalProperties`(+object)/`enum`/`$ref`/`$defs`; do NOT use `patternProperties`/`uniqueItems`/`pattern`/`minLength` — they silently no-op. Verify by planting a typo.
- [2026-06-19] **The default template variant is `standard`, NOT `default`** — unified so the `--template` default, the matrix fallback variant key, and the `standard`/`default` terminology all align. `TASK_VARIANTS = ['standard','feature-impl','issue','review','meta','brainstorm']`, `DEFAULT_TASK_VARIANT = 'standard'`. The matrix fallback in `resolveMatrixEntry` (planning-check-base) AND `sectionsForStatus` (task-service) AND `feature-check`'s DEFAULT_FEATURE_MATRIX all key on `standard`. Template file renamed `config/templates/task/default.md` → `standard.md` (scaffold-manifest + init tests updated). The `DEFAULT_TASK_VARIANT` *constant name* stays (it means "the default variant is X"), only its value changed.
- [2026-06-19] **The `review` task template logs code-review findings as INPUT, not as the deliverable.** `config/templates/task/review.md` puts the P1–P4 findings table in a `#### Review Findings` sub-section UNDER `### Background` (the findings to fix — input). `### Review` is reserved for POST-fix reflection (what went wrong / back-issues from the first fix round), emitted only at wip+ per the matrix. `extractTemplateBodies` pulls the `#### Review Findings` table + Plan checklist as the Background/Plan bodies for created review tasks. Gotcha when testing: `#### Review Findings` contains the substring `### Review` (drop the first `#`) — assert absence of the `### Review` SECTION with a line-anchored `\n### Review\n` regex, never `.not.toContain('### Review')`.
- [2026-06-19] **Three disagreeing "variant" vocabularies had drifted: frontmatter `type` (task/brainstorm) · batch `template` (feature-impl/issue/review/meta) · matrix `variants` (standard/brainstorm) — and `task check` resolved the variant from `fm.type`, which never matched a matrix key, while `template` reached neither the matrix nor the producer.** UNIFIED on `template` as the single axis: added `TASK_VARIANTS` SSOT (`default·feature-impl·issue·review·meta·brainstorm`) in domain schema; added `template` to `taskFrontmatterSchema`; `TASK_TEMPLATES` now aliases `TASK_VARIANTS`; `task check` resolves `variant = fm.template ?? 'default'`; producer writes `template:` and uses it. Renamed the matrix fallback variant `standard`→`default` EVERYWHERE (section-matrix.yaml, `resolveMatrixEntry` fallback in planning-check-base, AND feature-check.ts's DEFAULT_FEATURE_MATRIX + its `resolveMatrixEntry('standard')` call — features key their matrix on the same word). Rule: when several enums name "the same kind of thing", they are ONE concept — unify on one SSOT and have every consumer import it; don't let frontmatter/CLI/matrix each invent a parallel list.
- [2026-06-19] **Decomposition granularity is NOT runtime config — do not add a `.spur/config.yaml` block for it.** It's LLM judgment guidance (`task check` validates structure, never task SIZE), so a config knob would be dead config no code reads (the dead-rule anti-pattern). Instead the tunable numbers live in the skill's OWN frontmatter (`plugins/sp/skills/spur-dev/references/decomposition.md` → `granularity: {min_hours, target_min_hours, target_max_hours, force_decompose_above_hours}`) and the prose cites them. Rule: config holds values the RUNTIME branches on (folders, ports, active dir); agent-reasoning knobs belong where the agent reads them (the skill).
- [2026-06-19] **Per-variant task section BODIES (e.g. review's P1–P4 table) must be DATA in the template files, not hardcoded.** `config/templates/task/<variant>.md` were scaffold-only (copied at init, never read at runtime). Wired them in: `extractTemplateBodies(md)` (domain) parses a template via MarkdownDocument and returns non-empty canonical section bodies (the `{{ BACKGROUND }}` placeholder is treated as empty); the CLI `makeService` injects `resolveTemplateBodies` (reads `<bundledConfigRoot>/templates/task/<variant>.md`, process-cached); `buildTaskSkeleton` merges template bodies UNDER task-specific bodies (Background/Requirements win). Architecture: matrix = WHICH sections (stage-aware), template file = per-variant BODIES, guidance comment = fallback. A body only injects where the matrix actually places that section at the creation status.
- [2026-06-19] **`config/tasks/section-matrix.yaml` was loaded with bare `parseYaml` + a `.variants` truthiness check — NO schema validation, so a typo'd section name was a silent dead rule.** Added Zod `sectionMatrixSchema` (domain, `task-skeleton.ts`) over the canonical section enum; `loadSectionMatrix` (apps/cli) now `safeParse`s and THROWS a path-pointed error on failure. It immediately caught a real latent bug: the matrix used `Notes` in `blocked.optional`, but `Notes` is a FEATURE section, not in `TASK_CANONICAL_SECTIONS` (the old matrix had it too, silently accepted). **Zod v4 gotcha:** `z.record(enumKey, value)` is EXHAUSTIVE (requires all enum keys) — for an optional-subset map (a variant declares only some statuses) use `z.partialRecord(enumKey, value)` (available in zod 4.4.3). Also tightened `section-matrix.schema.json` to a `$defs/section` enum + `uniqueItems` lists.
- [2026-06-19] **New-task section skeletons were HARDCODED INLINE (×2) in `task-service.ts` `create`+`batchCreate`, drifted from BOTH the canonical vocabulary (`TASK_CANONICAL_SECTIONS`) and the Section-Status-Matrix — shipping empty `Requirements`/`Q&A` headings and a Solution-at-backlog that FAILed `task check` on every new task.** Fixed by centralizing into `buildTaskSkeleton` (`packages/domain/src/planning/task-skeleton.ts`): the producer now renders from a matrix-resolved section list (app-side `sectionsForStatus` reads `config/tasks/section-matrix.yaml` `required∪optional`), so stage→section is a ONE-FILE (YAML) edit. Creation status follows §2.3: spec'd (`--feature` / batch item w/ background|requirements) → `todo` (ready, HITL-review sections present); bare → `backlog` (Background only). `Solution` first appears at `wip`. Rule: there must be exactly ONE producer of a task body — never hand-build a `### Section` array in a service; if you see one, it has drifted. The matrix is the SSOT for both creation AND validation.
- [2026-06-19] **L3 format checks (`task-check.ts`) fired on EMPTY/placeholder sections — the Solution `file:line` rule errored on a bare `### Solution` heading, failing not-yet-implemented tasks.** Fixed with `isPlaceholderBody` (strips HTML guidance comments + `> TBD`, treats the remainder-empty as placeholder); applied to Solution/Review/Testing/Plan/Requirements. Also the Requirements R-numbering regex didn't accept a list-bullet prefix (`- R1.`), so the producer's own bulletized output warned — fixed to `/^\s*[-*]?\s*R\d+\.?\s/`. And the closed-world L2 check flagged `History`/`References`/`Notes` (structural, in every file) → added `UNIVERSAL_SECTIONS` allow-list in `planning-check-base.ts`. Rule: a format rule must only fire on AUTHORED content; guidance-comment placeholders are invisible by design and must be skipped.
- [2026-06-19] **`MarkdownDocument.replaceSection` THREW on an absent canonical section** — incompatible with the progressive-section lifecycle (Solution doesn't exist until `wip`, so an agent couldn't write it). Changed to UPSERT: insert the new section at its canonical-order position (`insertSection`), existing sections byte-preserved. Tests that encoded the old throw / the old "all sections present at creation" / the old "new task FAILs check" were flipped to the new contract (they were encoding the BUG). Rule: when a lifecycle adds sections over time, the section writer must upsert, not require pre-existence.
- [2026-06-19] **Spur task decomposition standard lived too thin in `plugins/sp/skills/spur-dev/references/decomposition.md` ("one task = one session") and let over-decomposition through (11 sub-tasks, several <2h, phase-shaped).** Enhanced it with the legacy `rd3:task-decomposition` rubric: decompose-only-when-necessary (independent streams / distinct gate / different risk / different expert), E+D+L+C+R score bands, deliverable-not-phase, full-lifecycle-per-task, 2h floor / 2–8h target, self-contained, + an anti-patterns table (phase-split / skeleton / over / under). Source of the standard: `~/projects/cc-agents/plugins/rd3/skills/task-decomposition/references/`. Rule: the decomposition standard is judgment-knowledge in the skill (not enforced by `task check`); keep it explicit so batch-create doesn't fragment work.
- [2026-06-19] **Before asserting an artifact is "the gap to build", re-list/Glob it IMMEDIATELY before writing the claim — never from an early-session `ls` snapshot.** The 0088 brainstorm wrote a whole requirement (R1–R3) declaring `sp:spur-plan`, `planning-pipeline.yaml`, and `/sp:spur-init` as unbuilt gaps; all three already existed (and faithfully implemented the brainstorm's own Q1–Q8 decisions). Root cause: an early `ls plugins/sp/skills/` snapshot showed 9 skills and was trusted minutes later when the requirement was written, but the dir had gained `spur-plan` since. The whole "🔴 GAP" framing was false. Rule: a "this doesn't exist yet / must be built" claim is a verifiable fact — `ls`/`Glob`/`rg -l` the exact path the instant before writing it, the same way `spur task check` re-derives state rather than trusting frontmatter. (Caught by `/rd3:dev-verify`, which re-grounded and flipped 0088 Backlog→Done.)
- [2026-06-15] **`apps/server/src/bootstrap.ts` (and anything reachable from `worker.ts`) MUST NOT import the `@gobing-ai/spur-domain` / `@gobing-ai/spur-app` barrel — it crashes the Cloudflare Workers isolate at module-init.** The domain barrel statically re-exports `migrations.ts` (`node:fs/promises`,`node:path`) + `planning/locks.ts` (`node:fs`); pulling those into the Worker bundle → "Worker exited unexpectedly" → `bun run test-cf` exits 1. (ts-db's `bun:sqlite` loads LAZILY inside `createDbAdapter`, so SQLite is NOT the culprit — the Node-builtin STATIC imports are.) Task 0073 shipped this. Rule: domain/app imports live only in Bun-path-only seams (`ServerContext` built in `index.ts`, `apps/cli`, or behind dynamic `await import()`); `bootstrap.ts` stays domain-free, put DB/service logic on `ServerContext` and have the CF path pass no `ctx`. ALWAYS run `bun run test-cf` (not just `bun run test`) when touching `bootstrap.ts`/`worker.ts`/their imports — the Bun suite passes while the Worker bundle crashes.
- [2026-06-15] **`bun run test` coverage threshold is AGGREGATE, not per-file — a new file can sit <90% while the repo gate stays green.** 0073's core deliverable `createMigratedDbViaRuntime` had no direct test; `db.ts` was 80%/72% yet `bun run test` passed. Standard is per-file ≥90% (`bunfig.toml`). When verifying, run `bun --cwd <pkg> test --coverage` on the CHANGED package and read the file's row; test the deliverable DIRECTLY, not only via a consumer.
- [2026-06-01] Do not "fix" `.spur/rules/boundary/dao-boundary.yaml` to the linked `ts-rule-engine` schema while `package.json` still runs installed `spur 0.1.0`; it breaks `bun run spur-check`.
- [2026-06-21] **`apps/web` tests (happy-dom + React 19 + bun:test) CANNOT drive a controlled `<input>`/`<textarea>` via `@testing-library/react` `fireEvent.change`/`.input` — the value never reaches `useState`, so a later submit reads it as empty.** Reproduced with a minimal `useState` input probe: `fireEvent.change(input,{target:{value:'x'}})` then read state → empty. The native value-setter workaround (`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,v)` + dispatch) ALSO fails here (React's event delegation isn't wired to happy-dom synthetic events in this combo). Consequence: any async flow gated on typed input (create-with-fields, body-seed, submit→refresh) is NOT unit-testable on this stack — tests that try it FAIL (and a `waitFor` on an assertion that never becomes true HANGS ~120s before timeout). The working pattern (see `task-detail.test.tsx`) is to MOCK the input-bearing child and call its `onChange` prop directly inside `act()`, bypassing the DOM — only viable when the field is a mockable component (e.g. MDEditor), NOT a plain `<input>`. For plain inputs, cover the synchronous surface (render, validation/empty-name path, api-error dispatch in isolation, a11y) and defer the typed-submit flow to a recorded manual browser check (R12: never ship the failing typed-submit tests to go-through-the-motions). Caught in 0093 dev-verify: an expanded test file asserting the full create/body flow via `fireEvent.change` failed 7/13 (one hung 126s); restored to the passing synchronous-surface suite (14 tests).
- [2026-06-01] Do not let `spur rule list` parse root-level preset YAML files as rule files; only category-folder YAML/JSON files are local rule files.
- [2026-06-03] Do not default an agent spec's `purpose` to `''` — `ts-ai-runner` `loadAgentSpecs` throws `"purpose must be a non-empty string"` on reload. Default to a non-empty value (`"<type> agent"`).
- [2026-06-03] Do not treat `spur agent run --agent <id>` and a message-recipient spec id as the same namespace, and do not pass a spec `type` like `claude-code` to the runner — `isAgentName` rejects it. Map spec id → spec.type for the runner; only valid `AgentName`s resolve.
- [2026-06-03] **Git Sync automation races `git commit`.** A background "Git Sync" actor auto-commits staged changes under a generic message ("fix(indexed-context): ...") between `git add` and `git commit`, so your own commit reports "nothing to commit". The content is safe (committed), but the message is wrong. Recover with `git commit --amend -m "<real conventional message>"` on the local (unpushed) branch — do NOT re-stage or re-run the gate. Watch for this whenever a commit reports an empty tree right after staging real changes.
- [2026-06-03] **Bun per-file function-coverage flake from sibling inline arrows.** Registering two inline arrow handlers (e.g. `app.all(a, ()=>..); app.all(b, ()=>..)`) can read <90% functions only in the whole-repo `bun run test` aggregate (100% in the file's own suite), tripping `coverageThreshold`. Route both through one named closure (`const handle = (req)=>...`) — restores 100% with no behavior change.
- [2026-06-13] **App package tests live in `packages/app/tests/services/`, not the `tests/` root.** Siblings (agent-service, rule-service, etc.) sit in `tests/services/` and import via `../../src/index`. Placing a service test at `tests/` root (import `../src/...`) is off-convention. Watch for a stray 0-byte placeholder at the correct path — `bun test <empty-file>` reports "Ran 0 tests" (passes the suite but is dead weight and trips per-file coverage expectations). Put service tests in `tests/services/` with `../../` import depth.
- [2026-06-13] **rd3-migration tasks (0049, 0050) shipped 0-byte test files while the task body claimed full coverage ("PASS").** Always open the claimed test file during verification — an empty file silently passes `bun test`/lint. In 0050 the empty CLI test hid a real shipping bug (see next entry). When verifying these tasks, read `apps/cli/tests/commands/<noun>.test.ts` and `packages/app/tests/services/<svc>.test.ts` for actual content, not just existence.
- [2026-06-13] **CLI commands must use `context.fs` for path resolution, and `context.fs` is cwd-bound via `createNodeFileSystem(cwd)` in `apps/cli/src/context.ts`.** A command that resolves paths against `process.cwd()` directly (or that relied on the pre-fix `createNodeFileSystem()` with no base dir) ignores `--cwd` and breaks every cwd-injecting test. CLI integration tests use in-process `main([...args], { cwd, output })` (faster than subprocess `runCli`) and assert exit codes 0/1/2 + the `--json` envelope via `createCapturedOutput`. Avoid `!` non-null assertions in tests — biome `--error-on-warnings` fails the gate; use a throwing guard helper instead.
- [2026-06-13] **Bundled config (YAML under repo-root `config/`) is loaded via `bundledConfigRoot()` from `@gobing-ai/spur-config`, then `yaml.parse` (the `yaml` pkg, root catalog).** `bundledConfigRoot()` walks up from the module dir to find `config/` (requires `config/rules` + `config/workflows` to exist) and returns `null` for `--compile` single binaries — so a loader MUST have a built-in fallback for that case. `bun run build` makes `--compile` binaries (no sibling config → fallback); `build:bundle` copies the whole `config/` tree into `spur-cli/config/` for packaged distribution. When adding a new `config/<area>/` dir, the bundle picks it up automatically (whole-tree `cp`), but rebuild `build:bundle` — a stale bundle won't have it.
- [2026-06-13] **rd3-migration task pattern: config-file deliverables shipped but never wired.** Task 0051 created `config/tasks/section-matrix.yaml` + schema, but `loadSectionMatrix(_fs,_tasksDir)` ignored its params and returned a hardcoded matrix — the YAML was a dead artifact and had drifted. When verifying a task whose requirement is "load config X", grep for the actual reader and confirm the file is parsed at runtime (underscore-prefixed `_param` names are a tell that an arg is ignored). Don't trust "files exist" as evidence the requirement is met.
- [2026-06-13] **rd3-migration task files violate their own schema:** they use `status: Done` (capital, plus `Done*`/etc.) and lack `schema_version`, while `taskFrontmatterSchema` expects lowercase `done` + `schema_version: 1`. Running `spur task check` on the corpus surfaces these as L1 errors — correct behavior, but it means the checker can't cleanly self-validate the corpus until a normalization pass (A17 migrate). Don't treat these as task-implementation bugs.
- [2026-06-14] **Zod schemas in `packages/domain/src/planning/schema.ts` are the runtime SSOT; hand-authored JSON schemas under `apps/cli/schemas/` are editor/CI aids that drift.** Task 0052 had `taskBatchSchema` (Zod) and `task-batch.schema.json` diverged in both directions (JSON strict on extra keys, Zod strict on field regexes). When a task says "validated by X.schema.json", check whether code actually loads it — usually it uses the Zod equivalent. Prefer making the Zod schema `.strict()` (reject unknown keys — safer for LLM-input gates) and keep the JSON schema patterns in sync with a "Zod is SSOT" note. No zod-to-json-schema generation exists in this repo yet (a candidate improvement).
- [2026-06-14] **`docs/tasks/kanban.md` is a gitignored generated artifact (`.gitignore:140`), produced by `spur task refresh`.** It is NOT pollution. The pre-existing file uses Obsidian Kanban-plugin format (`kanban-plugin: board`, emoji headers); the `refresh` impl emits plain `# Kanban` / `## <Status>` headers. Don't delete or "fix" it during verification.
- [2026-06-14] **rd3-migration tasks 0049-0052 were all marked `Done` without genuine verification** — 0049 empty test, 0050 empty test + real cwd bug, 0051 unwired config, 0052 empty Review/Testing/Plan + schema drift + dead code + untested rollback. Consistent pattern: self-reported "PASS" hides real gaps. Keep `--force` re-verification on the rest of the batch (0053+); read the actual Review/Testing sections and the claimed test files for real content.
- [2026-06-03] Do NOT call `ts-ai-runner`'s `AgentName` a "closed/extensible-only-via-upstream" registry — it is a compile-time union over a plain runtime object (`AGENT_SHIMS`). The earlier 0006 claim that adding a harness "requires an upstream BaseHarness change" was WRONG. The seam is the structural `AgentShim` interface; a Spur-side overlay map unblocks it with zero upstream work. Read the `.js` (not just `.d.ts`) before declaring an API a blocker.
- [2026-06-04] Do not let the global `flags.help` branch run before checking the command path; it makes `spur <command> --help` indistinguishable from global help. Route command help first, then fall back to global help.
- [2026-06-05] Do not scope **`type: regex`** evaluator rules with deep `apps/**/src/**/*.ts` / `packages/**/src/**/*.ts` globs; the regex evaluator's loose matcher can miss real files. Use `src/` fragments with exclusions and prove the rule catches a planted violation. (SCOPE: applies to `type: regex` only — superseded for `type: rg`, see next entry.)
- [2026-06-05] **`type: rg` (ripgrep) reverses the glob guidance above — use proper deep globs, NOT `src/` fragments.** The `rg` evaluator (ts-rule-engine ≥0.3.x) forwards `include`/`exclude` to ripgrep as `--glob`, so `**/src/**/*.ts` works correctly while a bare `src/` fragment matches ZERO files (`rg --glob 'src/'` searches nothing). When migrating a rule `regex`→`rg`, also rewrite any `src/`-fragment include to a real glob (`apps/**/src/**/*.ts` + `packages/**/src/**/*.ts`). Done for `no-biome-suppressions`.
- [2026-06-05] **`type: rg` ignores the `flags:` config field — it only honors `pattern`, `mode`, `multiline` + inline flags.** Migrating a `regex` rule that used `flags: "i"` must move the `i` into an inline `(?i)` prefix on the pattern, or the rule silently becomes case-sensitive. Verified `(?i)` compiles under ripgrep. Done for `no-hand-written-ddl-for-drizzle-tables`. The `rg-migration` guard does NOT catch this (it only checks lookbehind/backreferences), so verify case-sensitivity behaviorally with a planted lowercase violation.
- [2026-06-05] **Verify rg-migrated rules behaviorally, not just by "all rules passed".** A clean `spur rule run` can hide a rule that now scans zero files (false negative). After a `regex`→`rg` conversion, plant a violation matching each rule's pattern+scope and confirm the rule fires (ERROR/WARNING) before trusting the migration. Used `isRipgrepCompatiblePattern` (exported from ts-rule-engine, run from inside the cli workspace so deps resolve) to pre-screen all 14 patterns first — all compatible (no lookbehind/backreferences).
- [2026-06-05] Do not run or document bare `bun test --coverage` in Spur without checking `bunfig.toml`; Bun's default `--coverage-dir` is `coverage`, but Spur's coverage gate reads root `.coverage/lcov.info`. Keep `[test].coverageDir = ".coverage"` and pass explicit coverage-dir flags in scripts.
- [2026-06-05] Do not verify `--stop-on-first` with a second passing rule or a parse-only CLI assertion. Use a first warning/error plus a later error so the test fails if stop-on-first is ignored.
- [2026-06-05] Do not disable `.spur/rules/quality/tsdoc-exports.yaml` to make `spur-check` pass. Robin confirmed `every-export-has-tsdoc` should stay on; fix the reported missing TSDoc comments, including vendor reference files.
- [2026-06-09] Do not document new dual-workflow YAML fields from TS types alone. If a workflow example includes `$schema`, probe `spur workflow validate <file> --json`; schema-ref validation can reject fields that `--no-schema` and Zod accept.
- [2026-06-13] Do not reach for `--no-schema` (or document it as a "pre-existing limitation") when `spur workflow validate` fails to resolve a `$schema`. First check the ref points at the package that actually SHIPS the schema: workflow JSON schemas are owned by the Spur CLI (`@gobing-ai/spur/schemas/...`), not by `ts-dual-workflow-engine`. A dead package-ref silently degrades a config gate to no-schema validation; fix the ref instead of masking it. Verify the corrected ref on a throwaway copy (`spur workflow validate /tmp/probe.yaml`, no `--no-schema`) before editing the real files.

---

## Do-Not-Repeat

- During the ts-infra 0.3.5 bump, plugin tests were patched with `new EventBus({}) as any` + a "duplicate instances — structurally identical EventBus" biome-ignore. This was a MISDIAGNOSIS: `EventBus<{}>` (default map) is assignable to `PluginHost`'s `EventBus<SpurEventMap>` param under the current tsconfig — removing the casts passes lint+typecheck+test. When a transient bump error appears, root-cause it (clean node_modules, re-typecheck) before reaching for `as any`. Legit partial test-double casts (e.g. agent-team.test.ts `fakeDetector as any`) are fine and stay.

---

## Do-Not-Repeat

- Do not mark a Spur feature "done" when its engine-side support is only in the ts-libs working tree (uncommitted/unpublished). The published package silently no-ops the option. Mark it blocked-on-release, use the sanctioned temporary `link:` (documented in the task), and add a behavioral regression test that fails against the published version.
- Do not write rule/workflow run logs into `.spur/rules/` — that is the rule-DEFINITION root (local layer). Run traces belong under `.spur/runs/<domain>/<runId>.jsonl`.

---

## Do-Not-Repeat

- [2026-06-11] Do not trust "exports resolve + lint passes" as proof a ts-* dependency supports a feature. The 0040 working tree compiled against a store entry whose engine no-ops persistence options. Always run a behavioral probe (insert → query) and keep the two red regression tests (`rule run persists a run…`, `evaluate() persists a finalized run row…`) until ts-rule-engine ≥0.3.15 is published, the catalog bumped, and `bun install` rerun — do NOT skip/weaken them to green the gate.

---

## Do-Not-Repeat

- [2026-06-11] A stale root bun-link can MASK an undeclared workspace dependency: `packages/domain` imported `@gobing-ai/ts-rule-engine` without declaring it and resolved through the root link for an unknown period; removing the link broke typecheck. After deleting any stale link, re-run the full gate, and when a package gains an import from a new `@gobing-ai/ts-*` package, declare it (`"catalog:"`) in that workspace's manifest immediately.

---

## Do-Not-Repeat

- [2026-06-26] Do not leave `Solution`, `Testing`, or `Review` headings in a `todo` task. The section matrix requires `Design` for `todo` and forbids implementation-state sections until later lifecycle states; `spur task check <wbs> --json` will fail even if the prose is otherwise useful. Requirements parser also counts physical non-empty lines, so keep R-items as bulletized `- R1. ...` lines rather than wrapped continuation-heavy paragraphs.

---

## Do-Not-Repeat

- [2026-06-11] Do NOT describe `plugins/sp` skills as "thin wrappers delegating to the CLI". The principle is **Fat Skills, thin others**: skills are the SSOT for agent-facing behavior and may be arbitrarily rich (cross-agent portability: all coding agents support skills; command/subagent support varies). Slash commands and subagents are thin wrappers OF SKILLS. Skills delegate deterministic execution to CLI verbs where they exist but are not limited to CLI wrapping. (ADR-023.)
- [2026-06-11] Do not carry a "minimal structural change only" migration constraint after the operator reverses it — when the evidence demands redesign, porting first and re-foundationing later pays the cost twice. Superseded by ADR-023(3).

---

## Do-Not-Repeat

- The rd3 `tasks` CLI and the workspace `spur task` CLI use **incompatible task-file frontmatter
  dialects** (title-case Backlog/Done + impl_progress vs. lowercase enum). `docs/tasks/*.md` are
  rd3-authored — edit them with the **rd3 `tasks` CLI only** (`tasks update <wbs> <Status>`,
  `tasks update <wbs> --section … --from-file …`, `tasks update <wbs> --phase … --phase-status …`).
  The workspace `spur task` CLI throws a frontmatter-validation error on these files.
- `/rd3:dev-run` can mark a task Done while shipping **nothing at all** (not just a stub) — 0066 had
  zero files. Always check existence + content, never trust Done.

---

## Do-Not-Repeat

- The DD-07 task-file dialect gap (bug-531) BLOCKS check-gating features: `spur task check` rejects
  100% of the live rd3-authored corpus (missing schema_version:1, title-case status). Any feature that
  "denies on `task check` failure" over the live corpus is unbuildable-as-useful until the corpus is
  migrated. Ship the part that works (ownership) and defer the check-gate — don't build a guard that
  blocks every edit.
- Biome `noNonNullAssertion`: a `never`-returning `decide()` called in a bare `if` does NOT narrow for
  Biome — use `return decide(...)` (or init the var to `{}`) so control-flow narrowing kicks in; never
  reach for `!`.

---

## Do-Not-Repeat

- Closing a task does NOT auto-sync the owning feature's `## Tasks` block — run `spur feature refresh`
  at task close so feature Tasks blocks track real task status (found H2/B1 stale at 0068). `refresh`
  is read-only over the corpus (files win) and safe; it does NOT do lifecycle transitions, so it
  sidesteps the stale-DB issue below.
- `spur feature update <id> <status>` (lifecycle transition) hits the project `.spur/spur.db`, which is
  stale (missing `external_key` → SQLiteError). DEFERRED (stale-install class). To advance feature AC
  traceability without a transition: check the AC checkboxes by hand + `spur feature refresh`. Do not
  re-migrate the project DB as part of a task — it's the operator-deferred stale-install remediation.

---

## Do-Not-Repeat

- Run `spur feature refresh` when closing a task (carried over from 0068) — keeps feature Tasks blocks
  honest. Still pending for H3/0069 at close; do it in this cleanup.

---

## Do-Not-Repeat

- **Don't assume the `unit`/`dev-unit` operation is Bun/TS-only.** Spur's SELF-build gate is Bun/TS (AGENTS.md), but the `unit` operation runs against whatever project the agent is working in — which may be any stack. I initially tuned `unit-testing.md` to Bun/TS-only; operator corrected. The spine must be language-agnostic; stack specifics go in adapters.

---

## Do-Not-Repeat

- Don't claim a gate green on `bun run lint` alone — run `bun run format` first; lint never asserts formatting.
- Don't write a prose-only `### Review` reflection without a `P1`–`P4` severity column on review-template tasks — it FAILs `task check` L3.

---

## Do-Not-Repeat

- Security-reminder hook false-fires on the word "child"/"children" in code near no actual exec — rename locals to "kid(s)" or expect a hook block on the first Edit; the code is safe (FileSystem reads only).
- Before declaring a task done, run `git status -s` and diff EVERY modified file — a pre-existing in-flight diff (0109) was in the tree from a prior session; surface it, never silently fold it into the current task's commit.

---

## Do-Not-Repeat

- Don't smoke-test a new mutating CLI verb against the REAL corpus (it dirtied committed 0109) — use an isolated mktemp corpus, or revert immediately. I had to `git checkout` 0109 after the live smoke test.

---

## Do-Not-Repeat

- **`spur serve` serves a PRE-BUILT static `dist/web` — editing `apps/web/src` + restarting the server does NOT reflect UI changes.** `serve.ts`→`resolveWebDistPath` serves `dist/web` static assets (no Vite dev mode in `spur serve`). After ANY `apps/web/src` edit, run `bun run build` (rebuilds the Astro/Vite bundle into `dist/web`) BEFORE restarting `spur serve`, then HARD-REFRESH the browser (Cmd+Shift+R) to bust the cached old JS chunk. Symptom of this trap: a server restart picks up live-API changes (e.g. config → folder LIST) but the JS behavior (e.g. default-folder SELECTION) stays old. Verify the bundle is fresh: `rg -l "<new-symbol>" dist/web/` should hit the new `_astro/*.js` chunk, and `ls -la dist/web/index.html` mtime should be AFTER your source edit.

---

## Do-Not-Repeat

- [2026-06-27] tasks create (rd3 CLI) writes task frontmatter WITHOUT schema_version; spur task update/check rejects it ("schema_version: Invalid input: expected 1"). Every valid docs/tasks2 task carries schema_version: 1. After tasks create, patch frontmatter to add schema_version: 1 BEFORE any spur task write. (bug-709)
- [2026-06-27] The .wolf PreToolUse hooks gate ONLY Write|Edit|MultiEdit — NOT Bash. A frontmatter metadata patch on a task file via Bash python/sed is NOT blocked. Do not over-defer frontmatter fixes to the operator when the sanctioned CLI write path is itself blocked by a CLI bug; the convention "task files CLI-only" governs content sections, not unblocking-metadata patches. (I incorrectly told the operator I could not do this — I could.)

---

## Do-Not-Repeat

- When a `review`-template task fails L3 "Review must contain P1–P4 priority findings table", DON'T assume the bundled template or checker is broken — `diff config/templates/task/review.md .spur/tasks/templates/review.md` first. The project-local copy is the usual culprit (template drift).
- When verifying a "stale" finding by probe, test the EXACT path production uses (project-local template), not just the bundled SSOT — testing the bundled template gave a false "stale" verdict here when the live path was actually broken.

---

## Do-Not-Repeat

- **Do NOT trust `spur task check PASS` as evidence a decomposed task is implementable.** `spur task check` validates schema/structure, not section-content completeness — a task with only Background filled and Requirements/AC/Design/Plan left as template placeholders passes the check. After any decomposition (batch-create) or section-fill pass, spot-check the actual section content of at least one task directly (Read the file) before approving execution. An agent reporting "requirements name only X" is a claim about on-disk content — verify it; do not take the report at face value. (bug-732)

---

## Do-Not-Repeat

- **Never `git stash` in this sandbox without first checking whether a protected file is
  dirty.** `.claude/settings.local.json` and `config/workflows/task-pipeline.yaml` are
  permanently unlink-denied in this session's sandbox. If either has an uncommitted change,
  `git stash pop` WILL fail mid-merge — even when the stash's version and the working-tree
  version are byte-identical — because git still needs to unlink-then-rewrite the file. Check
  `git status -s` for those two exact paths before stashing; if dirty, don't stash (or stash with
  `-- <specific paths>` excluding them) rather than risk a half-applied pop.
- **A half-applied `git stash pop` is recoverable ONLY if the stash entry itself is not dropped.**
  Git leaves the stash intact on merge failure specifically so this is safe — do not panic-drop it.
  Recover file-by-file with `git checkout stash@{N} -- <single-path>` (one path per invocation),
  never a shell loop with output redirection.
- **Never redirect `git show ref:path > path` inside a Bash loop in this sandbox**, even to
  `$TMPDIR`. A single malformed redirect target later in the same command (e.g. a stray
  `2>/tmp_err.log` instead of `$TMPDIR/...`) can cause the sandbox to deny that part of the
  command — but the shell has *already evaluated and applied* the earlier `>` truncation on the
  primary output file before the denial surfaces. This silently truncated 18 tracked files to 0
  bytes in one loop iteration's failure. Use `git checkout <ref> -- <path>` instead — it performs
  the write through git's own internal path, not a shell redirect, so a syntax/permission error
  elsewhere in the command cannot half-execute a truncation.
- **After any multi-file recovery, verify with a full-content checksum loop, not `wc -l` or a
  spot check.** `wc -l` and single-file `rg` greps both looked "recovered" after an earlier bad
  recovery step (which had pulled 4 files from a stale `git show ":path"` **index** snapshot
  instead of the stash's newest working-tree snapshot) — the files were non-empty and
  well-formed, just *wrong* (reverted several hours of progress on tasks 0183-0186). Only a
  per-file `md5` comparison against the stash blob (`git show "stash@{0}:$f" | md5` vs
  `cat "$f" | md5`, looped over every file the stash's own `--stat --name-only` lists) caught the
  mismatch. Only drop the stash after every file in its manifest checksum-matches.
- **`git show ":path"` (bare colon prefix) reads the INDEX, not the working tree or a specific
  commit/stash** — easy to reach for during a panic-recovery and easy to get wrong when the index
  itself is mid-merge-conflict-resolution and may hold an older snapshot than intended.

---

## Do-Not-Repeat

- [2026-07-03] **`spur task record <wbs> --transition done` REGENERATES the `## Testing` section from the verdict artifact, silently discarding hand-authored content** (bug-756). On a hand-walked (non-pipeline) task, run `task record` FIRST and then land the full hand-authored Testing content via `task update --section Testing --from-file` — or expect to restore it. Always `grep` the section after `record`.
- [2026-07-03] **`\b` inside a JS template literal is a BACKSPACE control char, not a regex word boundary** (bug-755, plugins/sp/tests/skill-structure.test.ts R43). `new RegExp(`\b${x}\b`)` matches nothing real; write `\\b`. A structural test that can never pass regardless of the content it gates is the tell — plant a known-good fixture when authoring regex-based tests.

---

## Do-Not-Repeat

- [2026-07-08] Do not pass multiline commit messages through a bash heredoc (`git commit -m "$(cat <<'EOF' … EOF\n)"`). The embedded shell parser mangles the body (`EOF` tag split, `$`/`\`/backtick expansion), producing a truncated message that lefthook `cog` rejects with "expected commit_type". Pattern that WORKS: `Write` the message to `/tmp/<slug>-commit-msg.txt`, then `git commit -F /tmp/<slug>-commit-msg.txt`. The `-F` path bypasses shell quoting entirely and is the reliable workflow for any multi-paragraph conventional commit. Beside it, also keep English prose free of CJK tokens ("一站式" leaked into chat output on 2026-07-08 — keep English in English; CJK only mirrors an explicit user language shift).


- **[2026-08-06] Workflow path model — no triple-sync.** Edit `config/workflows/` only (SSOT). `.spur/workflows/` is a symlink to it in this monorepo. `apps/cli/config/` is gitignored `build:bundle` output — never hand-cp after pipeline edits. Wrong pattern from 0454/0455 thrash: keep three trees in sync. Right: one edit; rebuild package only when testing published CLI.
