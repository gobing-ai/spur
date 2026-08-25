# Universal config loading

**Area:** CLI/server composition-root config wiring, per-service config threading, agent-surface
`--json` error envelope, role-fallback provenance.
**Status:** implemented (ADR-082; ADR-078 amendment 2026-08-24; feature A5).
**Authority:** decisions in `00` (ADR-082; ADR-078 amendment); mechanism + invariants in
`03 §1.2.1`; this satellite owns shapes. Layer merge semantics (0640) are unchanged and out of
scope here.

## Loading contract

- `main()` (`apps/cli/src/index.ts`) invokes `loadSpurConfig(cwd, { embeddedSchemas: EMBEDDED_SPUR_SCHEMAS })`
  **exactly once**, before `runNodeApplication`, in both the config-present and no-config branches
  (zero layers returns schema defaults — no throw). The merged `SpurConfig` is threaded into
  `createCliContext` and is the only app-config source on the dispatch context.
- `resolveConfigFile(cwd)` is retained solely to (a) pick the bootstrap branch and (b) hand
  ts-infra the bootstrap file. `bootstrap` is project-shaped (0641 split), so single-file
  bootstrap loading stays correct.
- `runNodeApplication` is called with `configLoader: { configFile, bootstrapSection: 'bootstrap' }`
  — the `appConfig` validator is dropped and `appRt.appConfig` is never read.
- Config-load failure at the composition root (invalid YAML / schema violation in either layer):
  `main()` catches, emits **one** error, exit 1. With `--json` in argv:
  `toJson({ error: { code: 'config', message } })` on stdout; otherwise `output.error(message)`.
  The loader's message already names the failing layer path (0640 R7 provenance); it is propagated
  verbatim. One load ⇒ one error, never one per consumer.
- Server (`apps/server/src/serve.ts`): the existing single `loadSpurConfig(process.cwd()).catch(() => null)`
  moves ahead of `createServerContext`; the result is threaded into the server context and reused by
  the team-autostart read. The server never loads twice.
- No ts-infra multi-file layering API is introduced. Layering stays owned by
  `@gobing-ai/spur-config/loader`.

## Context shapes

```ts
// apps/cli/src/context.ts
interface CliContext {
    // …existing fields…
    /** Merged global+project config, loaded once in main(). The only app-config source. */
    spurConfig?: SpurConfig;
    /** Derived from spurConfig?.agent — unchanged consumer contract. */
    agentConfig?: AgentConfig;
    /** Provenance of agentRoles: 'fallback' iff no layer supplied agent.roles. */
    agentRolesSource: 'config' | 'fallback';
}
```

- `createCliContext` computes `agentConfig = options.spurConfig?.agent`,
  `agentRoles = resolveAgentRoles(agentConfig)` (signature unchanged), and
  `agentRolesSource = agentConfig?.roles === undefined ? 'fallback' : 'config'`.
- `AgentServiceContext` gains `rolesSource?: 'config' | 'fallback'`; the CLI passes
  `agentRolesSource` through `agentService()`.
- `WorkflowAppServiceContext` and `TeamServiceContext` gain `spurConfig?: SpurConfig | null`
  (`null` = load failed / absent; services degrade to their current defaults). CLI construction is
  free via structural typing (`new TeamService(context)`); `apps/server/src/context.ts` passes the
  threaded value explicitly into its lazy `TeamService` / `AgentService` / `WorkflowAppService`
  constructors.

## Consumer rewiring (R5)

| Site | Before | After |
| --- | --- | --- |
| `apps/cli/src/index.ts:66,89` | `loadSpurConfig` result discarded; `appRt.appConfig?.agent` (single-file) | result kept; `spurConfig` threaded; `appRt.appConfig` unread |
| `apps/cli/src/history-refresh.ts:35` | own `loadSpurConfig` + try/catch → null | `HistoryRefreshContext` picks up `spurConfig`; passes `context.spurConfig ?? null` to `enqueueHistoryRefresh`; loader import deleted |
| `apps/cli/src/commands/workflow.ts:195` | `resolveWorkflowPaths(cwd)` loads config | `resolveWorkflowPaths(config: SpurConfig \| null): string[]` — sync, pure; absent `workflows.paths` ⇒ `['.spur/workflows/']`; `bundled:` expansion unchanged |
| `apps/cli/src/commands/workflow.ts:483,719` | `resolveOutputLogConfig(cwd)` / `resolveWorkflowLogRetentionDays(cwd)` **call sites** | both helpers are defined in `packages/app/…/workflow-service.ts` (re-exported via `packages/app/src/index.ts`); the CLI call sites pass `context.spurConfig ?? null`; signatures become `(config: SpurConfig \| null)`, sync, no try/catch (a load failure never reaches dispatch); defaults unchanged (`{}`, `30`) |
| `packages/app/…/workflow-service.ts:1129` | `(await loadSpurConfig(cwd)).agent` + try/catch | `this.ctx.spurConfig?.agent`; degrade-empty behavior unchanged |
| `packages/app/…/workflow-service.ts:1516` | `resolveDefaultAgentVar(cwd, vars, warn)` loads config | `resolveDefaultAgentVar(config, vars, warn)`; validation of `agent.default` unchanged |
| `packages/app/…/team-service.ts:869` | `loadTeamConfig()` loads + try/catch | method deleted; callers read `this.ctx.spurConfig ?? null`; loader import deleted |
| `apps/server/src/serve.ts:404` | post-context `loadSpurConfig().catch(() => null)` | same single load hoisted before `createServerContext`, threaded, and reused for autostart |

Intentional exceptions (project-shaped sections, layering irrelevant): `bootstrap` (ts-infra) and
`resolvePlanningFolders(fs)` (planning folders are read from the project layer only).

**Boundary-rule extension (R5 enforcement):** `config/rules/boundary/config-loading-ownership.yaml`
gains a finding on the `loadSpurConfig` **symbol** outside the allowlist: `packages/config/**`,
`apps/cli/src/index.ts`, `apps/server/src/{serve,context}.ts`, `**/tests/**`. Other loader-subpath
exports (`resolvePlanningFolders`, `bundledConfigRoot`, `renderTemplate`, …) are unaffected.

## Role-fallback provenance (R7/R8)

- `DEFAULT_AGENT_ROLES` content, applicability rule, and byte-identity gate are unchanged
  (ADR-078). What changes is observability.
- `spur agent doctor` reports an active fallback: text mode writes one note line to the error
  stream (`agent.roles: no config layer defines a table — built-in DEFAULT_AGENT_ROLES fallback in
  effect`); `--json` mode adds top-level `rolesSource: 'config' | 'fallback'` to the doctor payload.
- The fallback note never changes exit codes and never fires when any layer supplies `agent.roles`.

## `--json` error envelope (R9/R10)

Shape (existing convention, `apps/cli/src/output.ts` `toJson`): stdout carries
`toJson({ error: { code, message } })`, exit code non-zero, nothing plain-text on either stream.
Newly conforming failure sites:

| Site | code |
| --- | --- |
| Composition-root config-load failure (`main()`) | `config` |
| `agent doctor <role>` unresolvable role / no eligible executor (`agent-service` `resolveRole` failure) | `agent-resolution` |
| `agent run` dispatch failure (`agent-service` `run` outcome) under `--json` | `agent-resolution` |
| `message send` argument/usage failures (`message.ts`) under `--json` | `usage` |

`toJson` stays CLI-owned; `packages/app` services emit the same envelope shape through the injected
`output.write` when their `json` flag is set (doctor already receives `args.json`; `run` reads
`flags.json`), otherwise `output.error(message)`. Exit codes are unchanged. Existing envelope sites
(`agent.ts` waitFail, `message.ts` sendWaitFail, builder/projects) are untouched.

**Surface-change record:** this is a behavior-only output change on existing verbs (ADR-051 gate per
the 2026-08-16 lesson); consent is recorded by the A5 design-review approval of this satellite.

## Layering regression tests (R11)

New `apps/cli/tests/config-layering.test.ts`, hermetic-subprocess pattern from
`packages/config/tests/loader-layers.test.ts` (spawn the real CLI entry; `HOME` → temp dir;
`SPUR_SKIP_GLOBAL_CONFIG=''`):

| Case | Setup | Assertion |
| --- | --- | --- |
| Global-only executor (R2/R6) | global defines executor + `agent.roles.coder`; project config has no `agent:` | `agent doctor coder --json` exits 0/1 by usability, stdout JSON names the global `coder` executor |
| Project override (R3) | both layers define `coder` differently | doctor output reflects the project row |
| Fallback explicit (R7) | neither layer defines `agent.roles` | doctor `--json` payload carries `rolesSource: 'fallback'`; text mode prints the note |
| No global file (R12) | project config only, no `~/.config/spur/config.yaml` | any command proceeds; no config error |
| Invalid global (R13) | global config has invalid YAML | any `--json` command exits non-zero; stdout parses to `{ error: { code: 'config', … } }`; message names the global path; exactly one envelope |
| No split-brain (R1/R5 guard) | global-only `agent.default` | a workflow-surface command observes the global value via the threaded config |

The global-only-executor case is the reversion tripwire: a return to single-file dispatch loading
makes the global executor invisible and fails the test.

## Doc sync in the implementing change (T3)

- `04 §2.1` "Resolution order: project → fallback global" sentence is stale (1.2 ships layered
  merge) — rewrite in the same commit as the code.
- `03 §1.2.1` loses its `(accepted design — not yet built)` marker.
- This satellite's status flips to `implemented`.
