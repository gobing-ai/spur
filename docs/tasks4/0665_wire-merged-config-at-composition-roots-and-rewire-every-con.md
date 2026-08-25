---
schema_version: 1
name: "Wire merged config at composition roots and rewire every consumer"
status: todo
template: feature-impl
created_at: 2026-08-25T06:11:03.779Z
updated_at: "2026-08-25T06:29:29.959Z"
feature_id: A5
priority: P2
tags: ["config", "composition-root", "cli", "layering"]
---

## 0665. Wire merged config at composition roots and rewire every consumer

### Background

Feature A5 closes the composition-root split-brain: config 1.2 shipped the layered merge loader (loadSpurConfig, packages/config/src/loader.ts:247), but the CLI composition root (apps/cli/src/index.ts:55-89) still resolves a single path and discards the merged result after using it as a fail-fast validator, so every project-config user silently loses the global layer. Accepted design: docs/design/universal-config-loading.md (ADR-082; ADR-078 amendment 2026-08-24). This task owns the plumbing half: load once in main(), thread through dispatch context as the only app-config source, delete every per-slice loadSpurConfig call, enforce via boundary rule, and add the CLI-level layering regression tests whose absence let this ship green.

Implements: R1 — Merged config loaded once at the composition root and threaded into dispatch; R2 — Global-only config value honored by every CLI command; R3 — Project config overrides the same global key; R4 — Service slices consume the threaded merged config instead of loading their own; R5 — No stale or ad-hoc config-loading path survives the consumer audit; R11 — CLI-level layering regression tests cover the composition root; R12 — CLI works when no global config file exists; R13 — Invalid global config fails once with a single --json error envelope naming the layer path (the main() catch lives in this task's file surface and its assertion in this task's test file); R14 — Long-running surfaces (serve, history-refresh) observe the same merged config as one-shot commands.

Deferred to sibling task: R6–R10 (agent-surface fallback provenance and --json error envelope) — separate observable behavior with its own review lens; it depends on this task's threaded spurConfig/agentRolesSource. The R6 global-only-executor reversion tripwire test nevertheless lands in this task's config-layering.test.ts (design doc test table).

Rejected alternatives (recorded per scope-creep guard): separate 'write tests' task — tests are part of implementation and this task's wiring is what they guard; folding the agent-surface envelope work in here — two review lenses in one diff; ts-infra layering API and minimal spot-fix of index.ts:89 — both rejected at design (brainstorm record in idea-eval-report).

Rubric: whole-feature score E11 D2 L2 C1 R1 = 16 (>= 5, decompose); this child E8 D1 L2 C0 R1 = 12 -> task (cohesion: one review context — 'merged config is the only source').

### Requirements

- [ ] R1. main() invokes loadSpurConfig(cwd, { embeddedSchemas: EMBEDDED_SPUR_SCHEMAS }) exactly once, before the bootstrap branch and covering both branches; the merged result is threaded into createCliContext as the only app-config source; runNodeApplication is called with configLoader { configFile, bootstrapSection: 'bootstrap' }, the appConfig validator is dropped, and appRt.appConfig is never read.
- [ ] R2. apps/server/src/serve.ts hoists its single loadSpurConfig from :404 to ahead of createServerContext (:386) and threads the result into the server context via a new spurConfig option (team-autostart read reuses the same value); the server never loads twice. The server's lazy AgentService is deliberately NOT threaded — see ### Q&A Q4.
- [ ] R3. Every per-slice loadSpurConfig call outside the two composition roots is deleted: workflow-service (four sites — :1129 agent slice, resolveDefaultAgentVar, resolveWorkflowLogRetentionDays, resolveOutputLogConfig — the latter three becoming sync pure functions of SpurConfig | null with unchanged defaults; note all three are DEFINED in packages/app/src/services/workflow-service.ts and re-exported via packages/app/src/index.ts, NOT in commands/workflow.ts), team-service loadTeamConfig, history-refresh, and commands/workflow.ts resolveWorkflowPaths (the only CLI-local helper, likewise sync and pure).
- [ ] R4. Composition-root config-load failure (invalid YAML / schema violation in either layer) emits exactly one error and exits 1; with --json in argv stdout carries toJson({ error: { code: 'config', message } }) with the loader's layer-path message propagated verbatim; otherwise output.error(message). The db adapter is closed on this path.
- [ ] R5. config/rules/boundary/config-loading-ownership.yaml gains a finding on the loadSpurConfig call pattern outside the allowlist (packages/config/**, apps/cli/src/index.ts, apps/server/src/{serve,context}.ts, **/tests/**), and the rule is proven to fire by a temporary violation.
- [ ] R6. New apps/cli/tests/config-layering.test.ts uses the hermetic-subprocess pattern (spawn real CLI entry via an env-capable runCli, HOME -> temp dir, SPUR_SKIP_GLOBAL_CONFIG='') and covers: global-only executor honored (reversion tripwire), project override wins, no global file proceeds cleanly, invalid global yields exactly one code 'config' envelope naming the global path, and a no-split-brain guard that a workflow-surface command observes a global-only setting via the threaded config.
- [ ] R7. Doc sync lands in the same commit: docs/04_DESIGN.md:1109 'Resolution order: project -> fallback global' sentence rewritten (that order now describes the bootstrap-file pick only), docs/03_ARCHITECTURE.md:90 loses its 'not yet built' marker, docs/design/universal-config-loading.md status flips to implemented and its two stale consumer rows are corrected.

### Acceptance Criteria

```gherkin
Feature: Composition-root merged-config wiring and consumer audit

  @core
  Scenario: R1 — Merged config is loaded once at the composition root and threaded into dispatch
    Given a global config at `~/.config/spur/config.yaml` and a project config at `.spur/config.yaml`
    When any `spur` CLI command runs
    Then `loadSpurConfig` is invoked exactly once in `main()` and the merged result is the only app-config source available through the dispatch context
    And `appRt.appConfig` is never read

  @core
  Scenario: R2 — A config value defined only in the global config is honored by every CLI command
    Given the global config defines an executor `coder` and the project config has no `agent:` section
    When a CLI command that resolves the `coder` executor runs
    Then the globally defined `coder` executor is used

  @core
  Scenario: R3 — A project config value overrides the same key in the global config
    Given the global config and the project config both define the executor `coder` with different settings
    When a CLI command that resolves the `coder` executor runs
    Then the project config's `coder` settings win

  @core
  Scenario: R4 — Service slices consume the threaded merged config instead of loading their own
    Given a workflow-engine setting defined only in the global config
    When `spur workflow run` executes through the workflow service
    Then the workflow service observes the global setting from `WorkflowAppServiceContext.spurConfig` in the dispatch context
    And `workflow-service.ts` calls `loadSpurConfig` zero times

  @core
  Scenario: R5 — No stale or ad-hoc config-loading path survives the consumer audit
    When the codebase is checked for per-slice `loadSpurConfig` calls outside the two composition roots
    Then workflow-service (4 sites), team-service, history-refresh, and `commands/workflow.ts` all consume threaded config and no per-slice loader call remains
    And `appRt.appConfig` has no reader anywhere in `apps/cli/src`

  @core
  Scenario: R11 — CLI-level layering regression tests cover the composition root
    When the CLI test suite runs
    Then `apps/cli/tests/config-layering.test.ts` spawns the real CLI entry with `HOME` pointed at a temp dir and asserts that a global-only default and a project override both reach a dispatched command
    And the suite fails if dispatch reverts to single-file loading

  @edge
  Scenario: R12 — The CLI works when no global config file exists
    Given no file at `~/.config/spur/config.yaml` and a valid project config
    When any `spur` CLI command runs
    Then the command proceeds with the project config and built-in defaults without a config-loading error

  @edge
  Scenario: R13 — An invalid global config fails once with a single validation error
    Given a global config file containing invalid YAML
    When the user runs any `spur` CLI command with `--json`
    Then the command exits non-zero and stdout parses to exactly one `{ error: { code: 'config', message } }` envelope
    And the message names the global config file path, not one error per consumer

  @edge
  Scenario: R14 — Long-running surfaces observe the same merged config as one-shot commands
    Given a setting defined only in the global config
    When `spur serve` starts or a history-refresh pass fires
    Then the surface behaves according to the global setting, identically to a one-shot command
    And `serve.ts` loads the config exactly once, ahead of `createServerContext`
```

### Q&A

Closed at refine `--depth ready` (2026-08-24). Premise checks were run against the working tree,
not against the design doc's prose — three claims did not survive.

**Q1. Does `main()`'s "no config file" branch need the load at all?**
CLOSED — yes, but the branch is rarer than it reads. `resolveConfigFile` returns `project ?? global`
(`packages/config/src/loader.ts:186-189`), so a global-only machine takes the **config-present**
branch with the global path as `configFile`. The no-config branch fires only when neither layer
exists, where `loadSpurConfig` returns `spurConfigSchema.parse({})` (`loader.ts:248-250`). Loading
in both branches keeps one code path and costs nothing.

**Q2. Does ts-infra get the wrong `bootstrap` when only a global layer exists?**
CLOSED — accepted. `configFile` is then the global file, so ts-infra reads `bootstrap` from it.
The 0641 split makes `bootstrap` project-shaped, so the global file carries no such section and
ts-infra falls to defaults. Correct outcome; recorded as an invariant in `### Design` so a later
reader does not "fix" it.

**Q3. Where does the `--json` config-failure envelope get its `--json` signal, before Commander parses?**
CLOSED — raw `argv.includes('--json')`. The failure happens before `runCommandDispatch` builds the
program, so no parsed flag exists. Accepted in the design satellite.

**Q4. Should the server's lazy `AgentService` receive the merged config?**
CLOSED — no; intentional exception. The satellite's consumer table says the server threads config
into `TeamService` / `AgentService` / `WorkflowAppService`, but `apps/server/src/context.ts:484-497`
constructs `AgentServiceImpl` with **no** `agentConfig` and **no** `roles` today, so there is no
stale path to repoint — only an absence. Adding one would change server-side `--agent auto`
resolution, which no A5 acceptance criterion asks for, and would need `resolveAgentRoles`
(`apps/cli/src/context.ts:52`) imported from `apps/server` — a new layering violation. Server agent
dispatch already flows through `WorkflowAppService`, which this task does thread, so R14 is
satisfied without it. Out-of-scope note, not a commit.

**Q5. Are `resolveOutputLogConfig` / `resolveWorkflowLogRetentionDays` in `commands/workflow.ts`?**
CLOSED — **no; the satellite's consumer table is wrong.** Both are defined in
`packages/app/src/services/workflow-service.ts:1576` and `:1563` and re-exported through
`packages/app/src/index.ts:480,482`; `apps/cli/src/commands/workflow.ts:483,719` are only call
sites. Only `resolveWorkflowPaths` (`commands/workflow.ts:192`) is CLI-local. `### Design` states
the corrected homes; the satellite row is stale and is not the authority for file placement.

**Q6. How many `loadSpurConfig` calls does workflow-service actually have?**
CLOSED — **four**, matching this task's R3 but not the satellite's two-row table:
`:1129` (agent slice), `:1516` (`resolveDefaultAgentVar`), `:1565`
(`resolveWorkflowLogRetentionDays`), `:1578` (`resolveOutputLogConfig`). All four are deleted.

**Q7. Can the existing `runCli` test helper drive the layering tests?**
CLOSED — not as written. `apps/cli/tests/helpers.ts:64` spawns the real entry but passes no `env`,
and the new cases must set `HOME`/`USERPROFILE` and clear the `SPUR_SKIP_GLOBAL_CONFIG='true'` that
`tests/setup.ts` sets process-wide and subprocesses inherit. Resolution: add an optional third
`env` param to `runCli` (additive, no call-site churn) rather than writing a second spawner.

**Q8. Do `spurConfigSchema` / `SpurAppConfig` stay imported in `index.ts`?**
DEFERRED to implementation, with a named check. Dropping the `appConfig` validator removes the only
`spurConfigSchema` use (`index.ts:73`) and probably the `SpurAppConfig` type argument
(`:69`, `:83`) once `appRt.appConfig` is unread. Delete whatever `bun run lint` reports unused —
do not leave a dead import to "keep the diff small".

**Q9. L4.gate-language warnings on Background/Requirements — real gates?**
CLOSED — no. The trigger is the "Deferred to sibling task" / "Rejected alternatives" prose. The one
real ordering constraint (0666 after 0665) is modeled where it belongs: `dependencies: ["0665"]` in
0666's frontmatter. The warnings are noise on this task and are accepted as-is.

**Deferred with owner:** none blocking. Q8 is an implementation-time lint outcome, not a design
question.

### Design

Frozen at refine `--depth ready` on 2026-08-24. Names below (types, fields, signatures, paths,
codes) are the contract — implement them verbatim, do not re-derive.

**WHY.** `resolveConfigFile(cwd)` returns `project ?? global` and `main()` uses the merged
`loadSpurConfig` result only as a throw-or-not validator (`apps/cli/src/index.ts:66`), then
hands ts-infra a **single** file and reads `appRt.appConfig?.agent` (`:89`). Everything
downstream therefore sees one layer, and five slices re-load the config themselves. The fix is
plumbing, not semantics: keep the merged result, thread it, delete the re-loads.

**WHERE — primary file targets**

| File | Change |
| --- | --- |
| `apps/cli/src/index.ts` | keep the `loadSpurConfig` result; call it in both branches; drop `appConfig` validator; add config-failure catch |
| `apps/cli/src/context.ts` | `CliContext.spurConfig`; `CreateCliContextOptions.spurConfig`; derive `agentConfig` from it |
| `apps/cli/src/history-refresh.ts` | delete the loader call; read `context.spurConfig` |
| `apps/cli/src/commands/workflow.ts` | pass `context.spurConfig ?? null` into the three now-pure helpers |
| `packages/app/src/services/workflow-service.ts` | `spurConfig` on ctx; 4 loader calls deleted; 3 exported helpers become sync/pure |
| `packages/app/src/services/team-service.ts` | delete `loadTeamConfig()`; read `this.ctx.spurConfig ?? null` |
| `apps/server/src/serve.ts` + `context.ts` | hoist the single load; thread into Team/Workflow service ctors |
| `config/rules/boundary/config-loading-ownership.yaml` | new ownership rule |
| `apps/cli/tests/config-layering.test.ts` | new (R6) |
| `apps/cli/tests/helpers.ts` | `runCli` gains an optional `env` arg |

**WHAT — frozen shapes**

```ts
// apps/cli/src/context.ts
export interface CliContext {
    // …existing…
    /** Merged global+project config, loaded once in main(). The only app-config source. */
    spurConfig?: SpurConfig;
    agentConfig?: AgentConfig;      // = spurConfig?.agent — unchanged consumer contract
}
export interface CreateCliContextOptions {
    // …existing…
    spurConfig?: SpurConfig;
}
```

`createCliContext` computes `const agentConfig = options.agentConfig ?? options.spurConfig?.agent`
(the explicit option keeps existing tests compiling) and threads `spurConfig` onto the context.
`resolveAgentRoles(agentConfig)` signature is **unchanged**.

```ts
// packages/app/src/services/workflow-service.ts
export interface WorkflowAppServiceContext { /* … */ spurConfig?: SpurConfig | null; }
// packages/app/src/services/team-service.ts
export interface TeamServiceContext { /* … */ spurConfig?: SpurConfig | null; }
```

`null` = load failed or absent; every consumer degrades to exactly today's defaults.

```ts
// apps/cli/src/history-refresh.ts
export type HistoryRefreshContext = Pick<CliContext, 'cwd' | 'env' | 'getDb' | 'output' | 'spurConfig'>;
```

**Helper signature freeze** (all three lose `cwd`, lose `async`, lose their try/catch — a load
failure can no longer reach dispatch, so swallowing one is dead code):

```ts
// apps/cli/src/commands/workflow.ts
function resolveWorkflowPaths(config: SpurConfig | null): string[];          // default ['.spur/workflows/']
// packages/app/src/services/workflow-service.ts  (exported via packages/app/src/index.ts)
export function resolveWorkflowLogRetentionDays(config: SpurConfig | null): number;   // default 30
export function resolveOutputLogConfig(config: SpurConfig | null): WorkflowRunLogConfig; // default {}
function resolveDefaultAgentVar(
    config: SpurConfig | null,
    callerVars: Record<string, string> | undefined,
    warn: (message: string) => void,
): Record<string, string>;                                                    // still validates agent.default
```

`bundled:` prefix expansion in `resolveWorkflowPaths` is unchanged; only the config read moves out.

**Composition-root control flow** (`apps/cli/src/index.ts` `main()`):

```
configFile = resolveConfigFile(cwd)          // project ?? global — unchanged, retained for bootstrap
db = await createMigratedDbAdapter(...)
try {
    spurConfig = await loadSpurConfig(cwd, { embeddedSchemas: EMBEDDED_SPUR_SCHEMAS })   // ONCE, both branches
} catch (err) {
    const message = errorMessage(err);
    if (argv.includes('--json')) output.write(toJson({ error: { code: 'config', message } }));
    else output.error(message);
    await db.close();
    return 1;
}
try {
    if (configFile !== undefined) runNodeApplication({ configLoader: { configFile, bootstrapSection: 'bootstrap' }, … })
    else                          direct dispatch
    // both branches: createCliContext({ …, spurConfig })
} finally { await db.close(); }
```

Precedence for the `--json` decision is a raw `argv.includes('--json')` scan — Commander has not
parsed yet at this point, and this is the same pre-parse situation the design accepted.

**Invariants**

- One load ⇒ one error. The loader's message already names the failing layer path (0640 R7); it is
  propagated **verbatim**, never re-wrapped or prefixed.
- `runNodeApplication` keeps `configLoader.configFile` + `bootstrapSection: 'bootstrap'` and loses
  `appConfig`. `bootstrap` is project-shaped (0641 split); when only a global layer exists
  `resolveConfigFile` hands ts-infra the **global** file, which carries no `bootstrap` section, so
  ts-infra falls to defaults. That is correct and intended — record it, do not "fix" it.
- The truly-no-config branch fires only when **neither** layer exists; `loadSpurConfig` returns
  `spurConfigSchema.parse({})` there (`packages/config/src/loader.ts:248-250`) and never throws.
- Degrade behavior at every rewired consumer is byte-for-byte what it is today (empty agent slice,
  `{}`, `30`, `['.spur/workflows/']`, env-only autostart). This task changes *where the value comes
  from*, never *what the default is*.

**Boundary rule (task R5)** — append to `config/rules/boundary/config-loading-ownership.yaml`:

```yaml
  - id: spur-config-loader-only-at-composition-roots
    description: >
      `loadSpurConfig` is called at the composition roots only (ADR-082). Every other surface
      consumes the merged result threaded through its context — a per-slice load re-reads a
      single layer's view and reintroduces the split-brain A5 removed.
    severity: error
    evaluator:
      type: rg
      config:
        pattern: "loadSpurConfig\\("
    include:
      - "apps/**/src/**/*.ts"
      - "packages/**/src/**/*.ts"
    exclude:
      - "packages/config/src/**"
      - "apps/cli/src/index.ts"
      - "apps/server/src/serve.ts"
      - "apps/server/src/context.ts"
      - "**/node_modules/**"
      - "**/tests/**"
```

The `\\(` suffix is load-bearing: it matches call sites while leaving `import { loadSpurConfig }`
and `Awaited<ReturnType<typeof loadSpurConfig>>` alone. Other loader-subpath exports
(`resolvePlanningFolders`, `bundledConfigRoot`, `renderTemplate`) are untouched.

**Test design (task R6)** — `apps/cli/tests/config-layering.test.ts`, hermetic-subprocess pattern
copied from `packages/config/tests/loader-layers.test.ts:44-60`. `tests/setup.ts` sets
`SPUR_SKIP_GLOBAL_CONFIG='true'` process-wide and subprocesses inherit it, so **every** case must
pass `SPUR_SKIP_GLOBAL_CONFIG: ''` plus `HOME`/`USERPROFILE` → temp dir. Extend the existing
`runCli` helper rather than writing a second spawner:

```ts
// apps/cli/tests/helpers.ts:64 — third param, additive
export async function runCli(args: string[], cwd?: string, env?: Record<string, string | undefined>): Promise<CliResult>
// …passed to Bun.spawn as { ...process.env, ...env }
```

| Case | Setup | Assertion |
| --- | --- | --- |
| Global-only executor (R2) | global defines `agent.executors[coder]` + `agent.roles.coder`; project `.spur/config.yaml` with no `agent:` | `agent doctor coder --json` stdout names the global `coder` executor |
| Project override (R3) | both layers define `coder` differently | output reflects the project row |
| No global file (R12) | project config only | command exits 0; no config error on either stream |
| Invalid global (R13) | global config is malformed YAML | exit non-zero; stdout parses to exactly one `{ error: { code: 'config', … } }`; message contains the global path |
| No split-brain (R1/R5) | global-only `agent.default` | a workflow-surface command observes the global value via the threaded config |

The global-only-executor case is the **reversion tripwire**: a return to single-file dispatch
loading makes the global executor invisible and fails it.

**Anti-patterns — do not implement**

- Do **not** add a layering API to ts-infra (`configFiles: string[]`, merge hooks). Layering stays
  owned by `@gobing-ai/spur-config/loader`. Explicitly out of scope in A5.
- Do **not** change `loadSpurConfig`'s merge semantics, add config keys, or bump the config version.
- Do **not** call `loadSpurConfig` a second time "just for this slice" because a context happens to
  lack the field — thread the field.
- Do **not** keep a `try/catch → default` around a now-pure helper. It is unreachable and hides the
  fact that failure is handled once at the root.
- Do **not** delete `resolveConfigFile` or the bootstrap branch. Both are still needed.
- Do **not** touch `resolvePlanningFolders(fs)` — planning folders are deliberately project-layer
  only (intentional exception, same as `bootstrap`).
- Do **not** thread config into the server's lazy `AgentService`. It receives no `agentConfig`/
  `roles` today, no server surface runs `doctor`, and `resolveAgentRoles` lives in
  `apps/cli/src/context.ts:52` — importing it from `apps/server` would be a new layering violation.
  Server agent dispatch already flows through `WorkflowAppService`, which this task does thread.
  Recorded as an intentional exception; see `### Q&A`.
- Do **not** widen `--json` error normalization to the agent/message surfaces here — that is 0666.

**Handoff to 0666** (`dependencies: ["0665"]`): 0666 consumes `CliContext.spurConfig` and adds
`agentRolesSource` next to it. This task owns `spurConfig` on `CliContext`; 0666 owns
`agentRolesSource`. This task also lands the **R2 global-only-executor tripwire test** in
`config-layering.test.ts` (design-doc test table); 0666 adds the `rolesSource: 'fallback'` case to
the same file.

### Plan

Ordered; each step is independently compilable. Run `bun run lint` after steps 2, 4, and 6 —
signature changes ripple through call sites and tsc is the cheapest audit of "did I get them all".

- [ ] 1. **Context shapes (additive, nothing reads them yet)** — R1. `spurConfig?: SpurConfig` on
      `CliContext` + `CreateCliContextOptions` (`apps/cli/src/context.ts:97,147`), with
      `agentConfig = options.agentConfig ?? options.spurConfig?.agent`;
      `spurConfig?: SpurConfig | null` on `WorkflowAppServiceContext`
      (`workflow-service.ts:396`) and `TeamServiceContext` (`team-service.ts:45`); widen
      `HistoryRefreshContext` (`history-refresh.ts:18`) with `spurConfig`.
- [ ] 2. **CLI composition root** — R1, R4. Rewrite `main()` (`apps/cli/src/index.ts:51-108`) to the
      control flow frozen in `### Design`: one `loadSpurConfig` before the branch; `code: 'config'`
      envelope catch (raw `argv.includes('--json')`) with `db.close()` and exit 1; `spurConfig` into
      `createCliContext` in **both** branches; `appConfig` validator dropped; `appRt.appConfig`
      unread; delete imports lint reports unused. → `bun run lint`
- [ ] 3. **CLI consumers** — R3. `history-refresh.ts:33-38`: delete the loader call + try/catch, pass
      `context.spurConfig ?? null`. `commands/workflow.ts`: `resolveWorkflowPaths` → sync
      `(config: SpurConfig | null)`; update `:783`, and pass `context.spurConfig ?? null` at the two
      helper call sites `:483` / `:719`. Drop now-unused loader imports in both files.
- [ ] 4. **packages/app consumers** — R3. workflow-service: all four loader calls deleted — `:1129` →
      `this.ctx.spurConfig?.agent`; `resolveDefaultAgentVar` → sync `(config, callerVars, warn)` with
      `:622` updated; `resolveWorkflowLogRetentionDays` / `resolveOutputLogConfig` → sync `(config)`.
      team-service: delete `loadTeamConfig()` (`:867`), replace `:602` / `:678` with
      `this.ctx.spurConfig ?? null`. Drop the `loadSpurConfig` import from both; keep
      `bundledConfigRoot` / `resolvePlanningFolders`. → `bun run lint`
- [ ] 5. **Server root** — R2, R14. `serve.ts`: hoist the `loadSpurConfig(...).catch(() => null)` from
      `:404` to before `createServerContext` (`:386`); add `spurConfig?: SpurConfig | null` to
      `CreateServerContextOptions` (`context.ts:254`); reuse the same value for `resolveAutostartSet`.
      `context.ts`: pass it into the lazy `TeamServiceImpl` (`:435`) and `WorkflowAppServiceImpl`
      (`:515`). Leave `AgentServiceImpl` (`:488`) untouched — `### Q&A` Q4.
- [ ] 6. **Boundary rule + teeth check** — R5. Append `spur-config-loader-only-at-composition-roots`
      to `config/rules/boundary/config-loading-ownership.yaml` verbatim from `### Design`.
      `spur rule run` clean; then temporarily add a `loadSpurConfig(` call to a non-allowlisted file,
      confirm the error finding, revert. → `bun run lint`
- [ ] 7. **Layering regression tests** — R6. Add the optional third `env` param to `runCli`
      (`apps/cli/tests/helpers.ts:64`, merged as `{ ...process.env, ...env }`). Write
      `apps/cli/tests/config-layering.test.ts` with the five cases in the `### Design` table; temp-dir
      setup mirrors `packages/config/tests/loader-layers.test.ts:28-42`; every case sets `HOME`,
      `USERPROFILE`, `SPUR_SKIP_GLOBAL_CONFIG: ''`; `afterEach` cleanup. Then
      `bun test packages/app apps/cli apps/server` and repoint every existing test broken by the
      step 4-5 signature changes — fix, never skip.
- [ ] 8. **Audit proof, doc sync, gate** — R5, R7. Paste into `### Solution`:
      `rg -n 'loadSpurConfig\(' apps packages --glob '!**/tests/**'` (allowlisted roots only) and
      `rg -n 'appRt\.appConfig' apps/cli/src` (empty). Same commit: rewrite `docs/04_DESIGN.md:1109`
      resolution-order sentence (noting `resolveConfigFile` keeps that order for the **bootstrap file
      only**); drop `; not yet built` from `docs/03_ARCHITECTURE.md:90`; flip
      `docs/design/universal-config-loading.md` status to `implemented` and correct the two stale
      consumer rows from `### Q&A` Q5/Q6. Then `bun run autofix && bun run spur-check`,
      `bun run test-cf`, `bun run build`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

**Authority**

- `docs/00_ADR.md:1213` — ADR-082: merged config loads once at the composition root, the only
  app-config source. The decision this task implements.
- `docs/00_ADR.md:1113` — ADR-078: role→tier SSOT in the config layer with a byte-identical code
  fallback. Constrains what `agent.roles` resolution may assume.
- `docs/03_ARCHITECTURE.md:90` — §1.2.1 composition-root merged-config wiring (mechanism +
  invariants). Loses its `not yet built` marker in this task's commit.
- `docs/design/universal-config-loading.md` — the accepted design satellite (shapes). **Two consumer
  rows are stale** — see `### Q&A` Q5/Q6; `### Design` is the corrected authority for file placement.

**Feature + siblings**

- `docs/features/A5_universal-config-loading-composition-root-merged-config-wiring-consumer-audit-and-agent-surface-json-error-contract.md` — parent feature; this task owns feature R1-R5, R11-R14.
- Task `0666` — agent-surface fallback provenance and `--json` error envelope. Depends on this task;
  consumes `CliContext.spurConfig`. Owns feature R6-R10.
- `docs/plans/2026-08-24-universal-config-loading-brainstorm.md` — the rejected alternatives
  (ts-infra layering API; minimal spot-fix of `index.ts:89`).

**Upstream work this builds on**

- Task `0640` — the layered loader itself (two-file load, deep merge, single post-merge validation,
  layer-path provenance in errors). Semantics are **not** touched here.
- Task `0641` — the `bootstrap` / app-config split that makes single-file bootstrap loading correct.
- Task `0572` — `DEFAULT_AGENT_ROLES` + `resolveAgentRoles(agentConfig)`; the signature this task
  leaves unchanged.

**Code anchors (verified 2026-08-24)**

- `packages/config/src/loader.ts:169` `resolveConfigLayers`, `:186` `resolveConfigFile`
  (`project ?? global`), `:247` `loadSpurConfig`, `:248-250` neither-layer → schema defaults.
- `apps/cli/src/index.ts:51` `main()`, `:66` the discarded load, `:73` `appConfig` validator,
  `:89` `appRt.appConfig?.agent`.
- `apps/cli/src/context.ts:52` `resolveAgentRoles`, `:97` `CliContext`, `:158` roles resolution.
- `apps/cli/src/history-refresh.ts:18` `HistoryRefreshContext`, `:35` the loader call.
- `apps/cli/src/commands/workflow.ts:192` `resolveWorkflowPaths`, `:483` / `:719` helper call sites.
- `packages/app/src/services/workflow-service.ts:396` ctx, `:622` `resolveDefaultAgentVar` caller,
  `:1129` / `:1505` / `:1563` / `:1576` the four loader sites.
- `packages/app/src/services/team-service.ts:45` ctx, `:602` / `:678` callers, `:867` `loadTeamConfig`.
- `apps/server/src/serve.ts:386` `createServerContext` call, `:404` the post-context load.
- `apps/server/src/context.ts:254` options, `:435` / `:488` / `:515` lazy service ctors.
- `config/rules/boundary/config-loading-ownership.yaml` — the rule file extended by R5.

**Patterns to copy**

- `packages/config/tests/loader-layers.test.ts:28-60` — hermetic two-layer subprocess harness
  (temp `HOME`, `SPUR_SKIP_GLOBAL_CONFIG: ''`).
- `apps/cli/tests/helpers.ts:64` `runCli` — the real-entry spawner extended in step 8.

### History
