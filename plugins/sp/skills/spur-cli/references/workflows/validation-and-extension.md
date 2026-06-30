---
name: validation-and-extension
description: Validate workflow definitions and extend the engine — validate semantics, custom action and guard runners, the trust-gated extension loader, and CLI-vs-library capability gaps.
see_also:
  - spur-cli
  - operations
---

# Validation & Extension

Two concerns: trusting a definition (`validate`) and growing the engine's vocabulary (custom
actions/guards and extension modules).

## Validation

`spur workflow validate <file> [--no-schema] --json` runs two layers:

1. **Structural schema** — the state-machine or transition-flow JSON schema. Catches missing required
   keys, wrong types, an unquoted `$schema`, or flow intent (`nodes`/`edges`) parsed against the
   state-machine schema because `kind: transition-flow` was omitted.
2. **Semantic invariants** — beyond what the schema can express: every `transition`/`edge` `from`/`to`
   references a declared state/node; terminal states/nodes are reachable; `${vars.x}` has a matching
   `vars` entry; `${env.X}` is listed in `env.allow`.

`--no-schema` skips only the `$schema` ref resolution (useful offline or for inline definitions),
keeping the structural + semantic checks. Classify a failure before fixing:

| Symptom | Layer | Typical cause | Fix |
| ------- | ----- | ------------- | --- |
| `parse error` near `$schema` | schema | unquoted `@`-leading value | quote the `$schema` string |
| validates as state-machine but you wrote nodes/edges | schema | missing `kind: transition-flow` | set `kind` explicitly |
| `unknown state/node` | semantic | a transition/edge target doesn't exist | fix the `to`/`from` id |
| terminal unreachable | semantic | no path to a `terminalStates`/`terminalNodes` entry | add the missing transition/edge |
| `${env.X}` empty at runtime | semantic-ish | `X` not in `env.allow` | add it to `env.allow` |

The error classes the library throws map to these: `WorkflowValidationError` (schema/semantic/template),
`FSMError` (runtime driver — missing state/node, invalid target), `RunCollisionError` (duplicate
`runId`). Definition errors throw; *run* failures (a failing action/guard) come back as
`status: 'failed'` and do not throw.

## Custom actions and guards

When the built-ins (`note`, `shell`, `always`, `action-ok`) are not enough, register domain runners on
the host. An action's `kind` string is how a workflow references it.

```ts
import { WorkflowEngineHost } from '@gobing-ai/ts-dual-workflow-engine';

const host = new WorkflowEngineHost();

// Custom action — receives resolved options + run context, returns an ActionResult
host.registerAction({
  kind: 'send-email',
  async execute(options, context) {
    await mailer.send(String(options.to), String(options.subject));
    return { ok: true };                 // { ok: false, error } fails the action; { ok: true, terminal: true } ends the run
  },
});

// Custom guard — returns a boolean
host.registerGuard({
  kind: 'isBusinessHours',
  async evaluate() {
    const hour = new Date().getHours();
    return hour >= 9 && hour < 17;
  },
});
```

Once registered, any definition can use `kind: send-email` (in `onEnter`/`onExit`/`node.action`) or
`kind: isBusinessHours` (in a `guard`/`condition`). The host tracks each registration's origin
(`builtin` / `extension` / `core`) — query with `host.actionOrigin(kind)` / `host.guardOrigin(kind)`.

> Inline `registerAction`/`registerGuard` is **not** gated — it is in-process code the caller already
> controls. Only the *module loader* (next section) is trust-gated.

## Extension loading (trust-gated)

For modules that bundle multiple actions/guards, use `loadWorkflowExtensionsIntoHost`. The trust gate
is **fail-closed**: `allowExtensions` defaults to `false`, and a declared-but-not-allowed extension
**throws before any import** — never silently dropped.

```ts
import { loadWorkflowExtensionsIntoHost, WorkflowEngineHost } from '@gobing-ai/ts-dual-workflow-engine';

const host = new WorkflowEngineHost();

await loadWorkflowExtensionsIntoHost(
  host,
  [{ kind: 'actions', absPath: '/abs/path/to/extension.ts', sourceName: 'my-config' }],
  {
    allowExtensions: true,                       // required — disabled by default
    moduleLoader: (absPath) => import(absPath),  // caller owns loading; tests use a stub
    logger: { warn: (msg) => console.warn(msg) },// optional override warnings
  },
);
```

An extension module default-exports `{ name, actions?: [...], guards?: [...] }`. A ref with
`kind: 'actions'` registers only the module's `actions[]` (guards in the same module are ignored, and
vice versa). Security properties:

- `allowExtensions` is fail-closed — refs present without the flag throw before import.
- Extension paths are validated; `..` traversal is rejected.
- The caller supplies `moduleLoader`; the loader has no ambient code-loading capability of its own.

**Extensions execute arbitrary code.** Treat an extension path like a dependency: only load modules you
trust, and never enable `allowExtensions` for paths derived from untrusted input.

## CLI vs. library capability gaps

The `spur workflow` CLI surfaces the lifecycle verbs (`validate`, `run`, `list`) over the
default-host engine. Several engine capabilities are **library-only** — reach for the library
(`@gobing-ai/ts-dual-workflow-engine`) directly when you need them:

| Capability | CLI | Library |
| ---------- | --- | ------- |
| Validate / run / list runs | ✅ | ✅ |
| Custom action/guard runners | ✅ (built-ins only) | ✅ (`registerAction`/`registerGuard`) |
| Extension modules | — | ✅ (`loadWorkflowExtensionsIntoHost`) |
| DB persistence + `listRuns()` history | (via configured adapter) | ✅ (`DbWorkflowPersistenceAdapter`) |
| Event-bus observability (progress bars, dashboards) | — | ✅ (`WorkflowEngineEvents` via `WorkflowRunOptions.events`) |
| OTel traces / structured logs | (emitted) | ✅ (`RunLifecycle`) |
| Programmatic schema parsing | — | ✅ (`WorkflowDefSchema`, `validateWorkflowDef`) |

When a workflow needs a capability the CLI doesn't expose, that is a signal to build a small host-side
integration in the consuming app (registering the runner, wiring the adapter/event bus), not to
work around it in the YAML. Keep domain behavior in action/guard runners, not in workflow parsing.
