---
name: "Implement downstream workflow action runners (agent.run, rule.check, file.exists, file.read, http.request) and register them as spur builtins"
description: "Implement downstream workflow action runners (agent.run, rule.check, file.exists, file.read, http.request) and register them as spur builtins"
status: Done
created_at: 2026-06-09T23:35:59.997Z
updated_at: 2026-06-10T01:33:53.981Z
folder: docs/tasks
type: task
feature-id: ""
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: pending
  testing: pending
---

## 0032. "Implement downstream workflow action runners (agent.run, rule.check, file.exists, file.read, http.request) and register them as spur builtins"

### Background

During the migration from spur-old to ts-libs + spur-new, the workflow engine's action catalog was reduced from four kinds (agent.run, shell, check, note) to two (shell, note). The agent.run and check actions were not ported. Decision: implement these opinionated, domain-specific actions downstream in spur-new following the same injection pattern that shell uses. Currently spur-new's feature-dev workflow is entirely note stubs — agent steps are advisory messages the operator runs manually. This task adds five action kinds and a registerSpurBuiltins factory, making the workflow engine actually executable for AI-driven development loops.


### Requirements

1. **AgentRunActionRunner** (kind: `agent.run`) → delegates to **`AgentAppService.run`** (not raw `AiRunner`) — options: `input`, `agent`, `model`, `mode` (text|json), `cwd`, `continue`. Carries the **session latch** (Q8). 2. **RuleCheckActionRunner** (kind: `rule.check`) → delegates to **`RuleAppService.evaluate`** (not raw `RuleEngine`) — options: `preset`, `rule`, `failOn`, `cwd`. 3. **FileExistsActionRunner** (kind: `file.exists`) backed by `ts-runtime` `FileSystem` — options: `path`, `negate`. 4. **FileReadActionRunner** (kind: `file.read`) backed by `FileSystem` (utf-8 only, **no encoding option**) — options: `path`, `maxSize`. 5. **HttpRequestActionRunner** (kind: `http.request`) using built-in `fetch`, GET default + scheme allowlist + header redaction — **deferred to Wave 2** (F4). 6. **`registerSpurBuiltins(host, { agentService, ruleService, fileSystem? })`** in `packages/app/src/workflow/builtins.ts`. 7. Wire into `WorkflowAppService.createEngineService()`. 8. Rewrite `config/workflows/feature-dev.yaml`: notes → real actions (no per-step `continue` — latch handles it); `check` → `rule.check { preset: recommended-pre-check }`. 9. Per-action tests in `packages/app/tests/workflow/` (mock the app-services / FileSystem). 10. Gate: `bun run check` + `bun run build` pass, no regressions.

**Sibling dependency (F1):** the latch and any cross-action data flow need `ActionResult.setVars` in `ts-dual-workflow-engine` — separate task; sequence first or in parallel (see Plan).

**Related tasks:**
- **0033** (F1) — `ActionResult.setVars` in the engine. **Blocking dependency** for the session latch
  (Q8) and `file.read`→`agent.run` data flow. Sequence first or in parallel.
- **0034** (F4, Wave 2) — hardened `http.request` action. **Split out of this task.** 0032 ships
  `agent.run` + `rule.check` + `file.*` (Wave 1); HTTP lands in 0034 with SSRF hardening.
- **Known-accepted limitation:** codex + session latch (continue rejects a new prompt) is accepted
  as-is for now; a proper solution is deferred (Q8).


### Q&A

**Q1. Should `agent.run` be split into `agent.slash` + `agent.prompt`?**

Decision: **Unified `agent.run` with a `mode` option** (`"prompt"` | `"slash"`, default `"prompt"`).

Rationale:
- Both call `AiRunner` — the only difference is slash-translation pre-processing vs raw pass-through. That's a single `if` branch, not two separate classes.
- Old spur YAML files use `kind: agent.run`. Splitting would create a migration burden with no real semantic benefit.
- The `agent.*` namespace is better reserved for genuinely different operations (`agent.help`, `agent.version`, `agent.auth`) — not granularity for its own sake.
- One action kind with a `mode` option is easier to document, discover, and test.

**Q2. Does `ts-dual-workflow-engine` need any new built-in action?**

Decision: **No.** The shared library's `shell` + `note` are sufficient generic primitives.

- `noop` → `note` with empty message already serves as a placeholder.
- `fail` → `shell` with `exit 1` already signals explicit failure.
- `sleep` / `wait` → `shell` with `sleep N` already covers pauses.
- `file.*`, `http.*`, `agent.*`, `rule.*` → all domain-specific; belong downstream.

Adding a built-in now would require an ADR + cross-package dependency justification. The cost isn't warranted given existing coverage.

**Q3. Why `rule.check` instead of `check`?**

Namespace convention: all new spur-specific actions use `domain.*` prefix (`agent.*`, `rule.*`, `file.*`, `http.*`). This:
- Avoids collision with a potential future `check` concept at the engine level.
- Makes the dependency origin immediately visible in YAML: `rule.check` clearly belongs to the rule engine, not the workflow engine.
- Leaves room for future rule-engine actions (`rule.format`, `rule.fix`).

**Q4. Why `file.read` if actions can't set workflow variables?**

`file.read` returns content in `result.data.content`. Guards (e.g., `action-ok`) and downstream actions can access it via `context.lastActionResult.data.content`. A future variable-setting mechanism would make it more powerful, but it's immediately useful for:
- Inspection: gate decisions based on file content (e.g., "does coverage report show >80%?").
- Agent prompts: pass file content to `agent.run` via `${...}` template interpolation (once variable-setting exists).
- Audit trail: file contents are captured in the run record.

**Q5. How does `registerSpurBuiltins` interact with `createDefaultWorkflowEngineHost`?**

```
createDefaultWorkflowEngineHost()  →  host with shell + note + guards (origin: 'builtin')
registerSpurBuiltins(host, deps)   →  adds agent.run, rule.check, file.*, http.* (origin: 'builtin')
loadWorkflowExtensionsIntoHost()   →  extension overrides (origin: 'extension')
```

Both are called in `WorkflowAppService.createEngineService()`. Extension-loaded actions can still override builtins per the engine's last-write-wins registration semantics.

**Q6. File system abstraction — `node:fs` directly or `ts-runtime` `FileSystem`?**

Use `ts-runtime`'s `FileSystem` interface (optional constructor injection). Rationale:
- The engine already depends on `ts-runtime` for `ProcessExecutor`. Same pattern.
- `FileSystem` is portable across Node/Bun/CF Workers. Direct `node:fs` ties actions to Node.
- When no `FileSystem` is injected, `file.exists` and `file.read` throw `WorkflowValidationError` at registration time (fail-fast).
- Default: **`createNodeFileSystem()`** (a factory, NOT a `new NodeFileSystem()` class) from `ts-runtime`. `exists`/`readFile` may return `T | Promise<T>` — `await` defensively.
- `FileSystem.readFile(path)` takes **no encoding argument** (hardcoded utf-8). Drop the `encoding` option from `file.read`; utf-8 only.

**Q7. Should the action runners depend on raw engines (`AiRunner`, `RuleEngine`) or the existing app-services (`AgentAppService`, `RuleAppService`)?**

Decision: **delegate to the existing app-services**, not the raw engines.

`packages/app/src/services/` already has `AgentAppService.run()` and `RuleAppService.evaluate()`, which encapsulate agent resolution, slash-command translation, output policy, Tier-2 warnings, preset resolution, and severity counting. Wiring the workflow actions to raw `AiRunner`/`RuleEngine` would duplicate all of that and let a workflow `rule.check` resolve presets *differently* from `spur rule run` — a latent inconsistency. Going through the app-services makes `agent.run`/`rule.check` behave **identically** to `spur agent run` / `spur rule run`, and shrinks each runner to a thin adapter.

Consequence: `registerSpurBuiltins` takes `{ agentService, ruleService, fileSystem }`, not raw engines.

**Q8. Multi-step session continuity for `agent.run` (the session latch).**

Goal: a `feature-dev` run fires several `agent.run` steps; running them all in **one agent session** (not a cold start each) is faster and far more token-efficient (the agent keeps context across brainstorm → refine → implement → fix → verify). We want this **by default, with zero per-step config**.

Decision: **auto-session-latch built on `setVars` (depends on F1 — see Q9).** Each `agent.run`:
1. Reads run var `${vars.__agentSession}` (the latch).
2. Resolves `continue`:
   - Author set `continue` explicitly on the step → **honor it** (escape hatch).
   - Latch unset → `continue: false` (this is the session opener).
   - Latch set → `continue: true` (inherit the open session).
3. On success, returns `setVars: { __agentSession: "open" }`.

Net effect: the **first `agent.run` actually executed** (by runtime path, not YAML order) opens the session; every later one continues it. Authors write nothing.

Capability note (verified against `ts-ai-runner`): `continue` is **already** a uniform, capability-aware feature — `PromptOptions.continue` is handled per-agent in the shims (`claude --continue`, `codex exec resume --last`, `gemini -r latest`, `pi -c`, etc.). **No `ts-ai-runner` change is required.** Two real constraints the latch must respect:
- **Codex rejects `continue` + a new prompt** (`shims.ts`: "Codex resume mode does not accept a new prompt"). With the latch, a codex `agent.run` after the opener would pass both → the shim throws → `AgentAppService.run` catches it and the action returns `ok: false` (clean failure, not a crash). For codex-targeted workflows, the latch should be **disabled** (codex can't carry a prompt across a resumed session), or those steps set `continue: false` explicitly. Document this; do not silently produce failing runs.
- **The fix loop re-enters `agent.run` with `continue: true` each iteration** — usually ideal (the fixer sees full prior context). The escape hatch covers the rare "start fresh" case: set `continue: false` on that step.

**Q9. Dependency on a variable-setting mechanism (`setVars`).**

The session latch (Q8) and any data flow between actions (`file.read` content → `agent.run` prompt) require actions to write back into run vars. Today an `ActionResult`'s `data` is readable only by the *immediately next* guard via `lastActionResult` — it cannot set a var that a later state reads. This is an **engine-level** capability (`ActionResult.setVars` merged into run vars by the driver) and belongs in `ts-dual-workflow-engine`, tracked as a **sibling task (F1)**. **0032's session latch and any cross-action data flow are gated on F1 landing first.** Without F1, `agent.run` falls back to explicit per-step `continue` (verbose but functional).


### Design

- Wave 1 (this task): AgentRunActionRunner, RuleCheckActionRunner, FileExistsActionRunner, FileReadActionRunner, registerSpurBuiltins, wire into WorkflowAppService, rewrite feature-dev.yaml
- Delegation pattern: actions delegate to existing app-services (AgentService.run, RuleService.evaluate), not raw engines — thin adapters preserving CLI parity (Q7)
- FileSystem: injectable from ts-runtime, defaults to createNodeFileSystem() (Q6)
- Session latch (Q8): depends on F1 (task 0033, Done). AgentRunActionRunner uses vars.__agentSession to auto-continue. Without F1, degrades to explicit per-step continue.
- HTTP deferred to F4 (task 0034)


### Solution

### 1. Module layout

```
packages/app/src/workflow/
├── builtins.ts              # registerSpurBuiltins(host, options)
├── actions/
│   ├── agent-run.ts         # AgentRunActionRunner
│   ├── rule-check.ts        # RuleCheckActionRunner
│   ├── file-exists.ts       # FileExistsActionRunner
│   ├── file-read.ts         # FileReadActionRunner
│   └── http-request.ts      # HttpRequestActionRunner
tests/
└── workflow/
    ├── agent-run.test.ts
    ├── rule-check.test.ts
    ├── file-exists.test.ts
    ├── file-read.test.ts
    ├── http-request.test.ts
    └── builtins.test.ts
```

Each action runner class lives in its own file under `actions/`. Each implements the `ActionRunner` interface from `@gobing-ai/ts-dual-workflow-engine`. The `registerSpurBuiltins` function in `builtins.ts` is the single entry point for wiring all five into a `WorkflowEngineHost`.

### 2. AgentRunActionRunner (`agent.run`)

**Dependencies:** `AgentAppService` (packages/app) — NOT the raw `AiRunner` (see Q7). The service owns
agent resolution, slash translation, output policy, Tier-2 warnings, and `PromptOptions` construction.

**Options:**

|Option|Type|Required|Default|Description|
|---|---|---|---|---|
|`input`|`string`|conditionally*|—|Prompt text or slash command (*optional when continuing a codex session)|
|`agent`|`string` (→ `AgentName`)|no|service default|Agent selector; validate against `AgentName`, reject unknown with a clear error|
|`model`|`string`|no|—|Model override (→ `PromptOptions.model`)|
|`mode`|`"text" \| "json"`|no|`"text"`|Agent output mode (→ `PromptOptions.mode`). NOTE: this is the agent's output mode, not a prompt/slash dispatch switch — slash translation is automatic in the service.|
|`cwd`|`string`|no|`context.workdir`|Working directory|
|`continue`|`boolean`|no|*latch* (Q8)|Continue previous session. Unset → session-latch default; explicit value overrides the latch.|

There is **no `mode: prompt|slash`** option (the original spec was wrong): `AgentAppService.run`
auto-detects and translates Claude-style slash commands (`isClaudeStyleSlashCommand` → `translateSlashCommand`).
`model` and `continue` are real and flow through `PromptOptions` — not through `AgentRunOptions`
(which carries only `cwd`/`timeout`).

**Execution flow:**

1. Resolve `input`. Required unless `continue` is effectively true on an agent whose resume mode
   carries no prompt (codex). Otherwise throw (fail-fast).
2. Resolve `agent`; validate it is a known `AgentName`.
3. **Session latch (Q8):** read `${vars.__agentSession}`; if `continue` was not set on the step,
   default it (unset latch → false, set latch → true). Honor an explicit step `continue`.
4. Build the flag bag for `AgentAppService.run(input, flags)`:
   `{ agent, model, mode, cwd, continue }`.
5. Call `await agentService.run(input, flags)` → returns an exit code (the service streams/buffers
   per its own output policy).
6. Map to `ActionResult`: `ok: exitCode === 0`; `data: { exitCode, agent }`; on failure
   `error: "agent.run (<agent>) exited with code <n>"`.
7. On success, emit `setVars: { __agentSession: "open" }` (latch; requires F1 — see Q9).

Edge cases: codex + `continue` + `input` → the shim throws, the service returns exit 2, the action
returns `ok: false` (documented, not a crash). Unknown `agent` → throw at execute. Without F1, step 7
is a no-op and the latch degrades to explicit per-step `continue`.

### 3. RuleCheckActionRunner (`rule.check`)

**Dependencies:** `RuleAppService` (packages/app) — NOT the raw `RuleEngine` (see Q7). The service
already owns preset resolution, rule discovery/layering, evaluation, and severity counting; its
`evaluate(opts)` returns a structured result. (The raw `RuleEngine.evaluate(rules, workdir, …)` takes
positional args and has no `getPreset`/`getAllEnabledRules` — the original spec invented those.)

**Options:**

|Option|Type|Required|Default|Description|
|---|---|---|---|---|
|`preset`|`string`|no|`recommended-pre-check`|Rule preset name (mirrors `spur rule run`'s default)|
|`rule`|`string`|no|—|Single rule id to run (maps to the service's `--rule`)|
|`failOn`|`"error" \| "warning" \| "info"`|no|`"error"`|Minimum severity that fails|
|`cwd`|`string`|no|`context.workdir`|Working directory|

**Execution flow:**

1. Build `RuleEvaluateOptions` for `RuleAppService.evaluate`: `{ preset, rule, failOn, cwd }` —
   the same option surface `spur rule run` uses, so workflow gating == CLI gating.
2. `const result = await ruleService.evaluate(opts)`.
3. Map the service result to `ActionResult`: `ok` = the service's pass/fail verdict (exit-0 semantics);
   `data: { findings, summary, failOn, preset }`.

Edge cases: `preset` not found → the service surfaces a descriptive error → return `ok: false` with
that message. No findings at/above `failOn` → `ok: true`. Keep the mapping a thin pass-through; do not
re-implement severity counting that the service already does.

### 4. FileExistsActionRunner (`file.exists`)

**Dependencies:** Optional `FileSystem` from `@gobing-ai/ts-runtime`. Defaults to `NodeFileSystem` when not injected.

**Options:**

|Option|Type|Required|Default|Description|
|---|---|---|---|---|
|`path`|`string`|yes|—|Path to check (relative to workdir)|
|`negate`|`boolean`|no|`false`|When true, ok = file does NOT exist|

**Execution flow:**

1. Resolve `path` → if relative, join with `context.workdir` (or `context.metadata?.workdir`).
2. Call `fileSystem.exists(resolvedPath)`.
3. `negate: false` → `ok: exists`.
4. `negate: true` → `ok: !exists`.
5. Return `{ ok, data: { exists, path: resolvedPath } }`.

### 5. FileReadActionRunner (`file.read`)

**Dependencies:** Optional `FileSystem`. Defaults to `NodeFileSystem`.

**Options:**

|Option|Type|Required|Default|Description|
|---|---|---|---|---|
|`path`|`string`|yes|—|Path to read|
|`maxSize`|`number`|no|—|Reject files larger than this (bytes)|

No `encoding` option: `FileSystem.readFile(path)` is utf-8 only and takes no encoding arg (see Q6).

**Execution flow:**

1. Resolve `path` (relative → join `context.workdir`).
2. If `maxSize` set, stat the file and reject if size exceeds limit.
3. `const content = await fileSystem.readFile(resolvedPath)` (utf-8).
4. Return `{ ok: true, data: { content, size, path: resolvedPath } }`. With F1, also
   `setVars` the content into a named var so a later `agent.run` can interpolate it.
5. File not found → `{ ok: false, error: "File not found: ..." }`.

### 6. HttpRequestActionRunner (`http.request`)

> **Scope note (F4):** `http.request` is the odd one out — highest security surface (network/SSRF),
> lowest relevance to the `feature-dev` loop (none of brainstorm→…→verify needs HTTP). **Recommend
> deferring it to its own hardened task** and shipping `agent.run` + `rule.check` + `file.*` first
> (which fully de-`note`s `feature-dev.yaml`, the stated goal). Spec retained here for completeness.

**Security (must address before shipping):** this is the one action that reaches the network with
templated `url`/`body`. Required hardening: reject non-http(s) schemes (no `file://`, `gopher://`);
consider an allowlist or an explicit opt-in flag (mirroring the extension loader's fail-closed gate);
**never log `headers`** (auth tokens). Treat any templated value as untrusted input.

**Dependencies:** None (uses built-in `fetch`). No constructor injection needed.

**Options:**

|Option|Type|Required|Default|Description|
|---|---|---|---|---|
|`url`|`string`|yes|—|Request URL (http/https only)|
|`method`|`string`|no|`"GET"`|HTTP method (GET is the conventional default; POST was a surprising original choice)|
|`headers`|`Record<string,string>`|no|`{}`|Request headers (never logged)|
|`body`|`string`|no|—|Request body|
|`failOnStatus`|`number[]`|no|`[]`|Status codes treated as failure|
|`timeoutMs`|`number`|no|—|Request timeout|

**Execution flow:**

1. Resolve options. Template-interpolate `url`, `headers`, `body` via the engine's variable resolver.
2. Build `RequestInit`: `{ method, headers, body }`. If `timeoutMs`, use `AbortSignal.timeout(timeoutMs)`.
3. Call `fetch(url, init)`.
4. Read response body as text.
5. Determine success:
   - `response.ok && !failOnStatus.includes(response.status)` → `ok: true`.
   - Otherwise → `ok: false`.
6. Return `{ ok, data: { status: response.status, headers: Object.fromEntries(response.headers), body: responseBody } }`.

Edge cases: fetch throws (network error, timeout) → caught and returned as `ok: false` with error message. Non-JSON response bodies returned as-is.

### 7. `registerSpurBuiltins` factory

```typescript
// packages/app/src/workflow/builtins.ts

import { type FileSystem, createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { WorkflowEngineHost } from '@gobing-ai/ts-dual-workflow-engine';
import type { AgentAppService, RuleAppService } from '../services';
import { AgentRunActionRunner } from './actions/agent-run';
import { RuleCheckActionRunner } from './actions/rule-check';
import { FileExistsActionRunner } from './actions/file-exists';
import { FileReadActionRunner } from './actions/file-read';
import { HttpRequestActionRunner } from './actions/http-request';

export interface SpurWorkflowBuiltinsOptions {
    agentService: AgentAppService;     // delegate target for agent.run (Q7)
    ruleService: RuleAppService;       // delegate target for rule.check (Q7)
    fileSystem?: FileSystem;           // defaults to createNodeFileSystem()
}

/** Register all spur-specific built-in action runners on a workflow host. */
export function registerSpurBuiltins(host: WorkflowEngineHost, options: SpurWorkflowBuiltinsOptions): void {
    const fileSystem = options.fileSystem ?? createNodeFileSystem();
    host.registerAction(new AgentRunActionRunner(options.agentService), 'builtin');
    host.registerAction(new RuleCheckActionRunner(options.ruleService), 'builtin');
    host.registerAction(new FileExistsActionRunner(fileSystem), 'builtin');
    host.registerAction(new FileReadActionRunner(fileSystem), 'builtin');
    host.registerAction(new HttpRequestActionRunner(), 'builtin');
}
```

All actions registered with `origin: 'builtin'`. Extensions loaded via `loadWorkflowExtensionsIntoHost`
can override them (last-write-wins). `agent.run`/`rule.check` delegate to the app-services (Q7);
`file.*` take the injected/defaulted `FileSystem`; `http.request` is dependency-free.

### 8. WorkflowAppService wiring

**Current state** (`packages/app/src/services/workflow-service.ts`):
```typescript
private async createEngineService(): Promise<EngineWorkflowService> {
    return new EngineWorkflowService(
        createDefaultWorkflowEngineHost(),
        new DbWorkflowPersistenceAdapter(await this.ctx.getDb()),
    );
}
```

**After wiring:**
```typescript
private async createEngineService(): Promise<EngineWorkflowService> {
    const host = createDefaultWorkflowEngineHost();
    registerSpurBuiltins(host, {
        agentService: this.agentService(),   // constructed from the same CliContext
        ruleService: this.ruleService(),
        // fileSystem defaults to createNodeFileSystem() inside registerSpurBuiltins
    });
    return new EngineWorkflowService(host, new DbWorkflowPersistenceAdapter(await this.ctx.getDb()));
}
```

`WorkflowAppService` constructs (or is injected with) `AgentAppService` and `RuleAppService` from the
same `CliContext` the other commands use — no new raw-engine fields on the context. This keeps the
workflow's `agent.run`/`rule.check` wired through the identical bootstrap as `spur agent run` /
`spur rule run` (Q7).

### 9. feature-dev.yaml: replace note stubs with real actions

Slash commands are passed verbatim as `input`; the service auto-translates them (no `mode` option).
The session latch (Q8) means **none of these set `continue`** — the first executed `agent.run` opens
the session, the rest inherit it automatically.

| State | Current (note stub) | New action |
|---|---|---|
| `brainstorm` | note: "Run: /rd3:dev-brainstorm" | `agent.run`, input: `/rd3:dev-brainstorm` |
| `new-task` | note: "Run: /rd3:dev-new-task" | `agent.run`, input: `/rd3:dev-new-task` |
| `refine` | note: "/rd3:dev-refine ${vars.taskId}..." | `agent.run`, input: `/rd3:dev-refine ${vars.taskId} --focus all --auto` |
| `implement` | note: "/rd3:dev-run ${vars.taskId}..." | `agent.run`, input: `/rd3:dev-run ${vars.taskId} --auto --verify` |
| `check` | note: "STUB (dry-run)..." | `rule.check`, preset: `recommended-pre-check`, failOn: `error` (deterministic gate; see below) |
| `fix` | note: "Fix failures..." | `agent.run`, input: `"Fix the failures from the previous check pass for task ${vars.taskId}; run /rd3:dev-fixall or /rd3:dev-unit as appropriate."` |
| `verify` | note: "/rd3:dev-verify ${vars.taskId}..." | `agent.run`, input: `/rd3:dev-verify ${vars.taskId} --auto --fix all --force --channel codex/auto` |

**Transitions unchanged** — topology (brainstorm→new-task→refine→implement→check→verify→done, with the
check→fix loop guarded by `action-ok`) is identical. Only action payloads change from advisory notes to
executable invocations.

**`check` gate composition (F3):** map your real gate onto the workflow's two presets. Two options:
(a) a single `rule.check { preset: recommended-pre-check }` (constraint gate only); or (b) a `shell`
action `bun run autofix && bun run spur-check` **plus** a `rule.check { preset: recommended-post-check }`
for the full deterministic+constraint gate. Pick (a) for the inner loop, add the post-check before
`verify`. This is the natural mapping of `spur rule run` semantics into the FSM.

**Codex caveat (Q8):** the `verify` step targets `--channel codex/auto`. That is `/rd3:dev-verify`'s
own cross-agent delegation (inside the agent), not this action's `agent`. The `agent.run` here still
runs on the session agent (e.g. claude) and continues the latched session normally. If you ever set the
`agent.run` action's own `agent` to `codex`, disable the latch for that step (codex resume rejects a
new prompt).

### 10. Testing strategy

**Per-action runner tests** (in `tests/workflow/`):

- **agent-run.test.ts** — Mock `AgentAppService.run` (returns an exit code).
  - exit 0 → `ok: true`, `data.exitCode === 0`.
  - exit ≠ 0 → `ok: false`, error message includes the code + agent.
  - Slash input passed verbatim (translation is the service's job — assert the flag bag, not translation).
  - Missing `input` (non-continue) → throws.
  - **Session latch:** latch unset → flag bag has `continue: false` and result `setVars __agentSession`;
    latch set → `continue: true`; explicit step `continue` overrides the latch both ways.
  - Unknown `agent` → throws.
  - cwd falls back to `context.workdir`.

- **rule-check.test.ts** — Mock `RuleAppService.evaluate` (returns the structured verdict).
  - service verdict pass → `ok: true`; fail → `ok: false`.
  - `preset`/`rule`/`failOn`/`cwd` forwarded into `RuleEvaluateOptions` (assert the opts passed).
  - preset-not-found error from the service → `ok: false` with the message.
  - (No severity-counting test here — that lives in `RuleAppService`'s own suite; the action is a thin map.)

- **file-exists.test.ts** — Mock `FileSystem`.
  - File exists → `ok: true`, `data.exists: true`.
  - File missing → `ok: false`, `data.exists: false`.
  - `negate: true` inverts the result.
  - Relative path resolved against `context.workdir`.

- **file-read.test.ts** — Mock `FileSystem`.
  - Reads file content → `ok: true`, `data.content` matches.
  - File not found → `ok: false`, error message.
  - `maxSize` exceeded → `ok: false` before read.
  - `await`s a `FileSystem` whose `readFile` returns a Promise (sync-or-async contract).

- **http-request.test.ts** — Mock global `fetch` (Bun supports this natively). *(Deferred per F4 —
  ship with the hardened HTTP task, not this one.)*
  - default method is `GET` when unspecified.
  - non-http(s) scheme (`file://…`) → `ok: false` (rejected before fetch).
  - 200 OK → `ok: true`; 500 with empty `failOnStatus` → `ok: false`; 200 with `failOnStatus:[200]` → `ok: false`.
  - Network error → `ok: false`. Headers never appear in logs.

- **builtins.test.ts** — Integration test.
  - `registerSpurBuiltins(host, deps)` registers all five actions with `origin: 'builtin'`.
  - `host.listActions()` includes all five kinds.
  - Each action resolves correctly through `host.runAction()`.

### 11. Verification gate

```bash
cd ~/xprojects/spur-new
bun run check          # lint + typecheck + test (must pass)
bun run build          # all packages build successfully
```

No new suppressions, no skipped tests, no regressions in existing test suites.


### Plan

**Dependency:** the session latch (Q8) and `file.read`→`agent.run` data flow require **F1
(`ActionResult.setVars`)** in `ts-dual-workflow-engine` — a sibling task. 0032 can ship its actions
without F1 (latch degrades to explicit per-step `continue`), but the headline "one-session, zero-config"
ergonomics land only once F1 is in. **Recommend sequencing F1 first or in parallel.**

**Scope split (F4):** ship in two waves.

- **Wave 1 (this task, de-`note`s `feature-dev.yaml`):**
  1. `AgentRunActionRunner` → delegates to `AgentAppService.run`; carries the session latch (Q8).
  2. `RuleCheckActionRunner` → delegates to `RuleAppService.evaluate`.
  3. `FileExistsActionRunner` / `FileReadActionRunner` → `FileSystem` (default `createNodeFileSystem()`).
  4. `registerSpurBuiltins({ agentService, ruleService, fileSystem? })`; wire into
     `WorkflowAppService.createEngineService()`.
  5. Per-action tests (mock the app-services / FileSystem) + `builtins.test.ts`.
  6. Rewrite `config/workflows/feature-dev.yaml`: notes → `agent.run` (no `continue`, latch handles it)
     + `check` → `rule.check { preset: recommended-pre-check }` (F3).
  7. Gate: `bun run check` + `bun run build` green; dry-run `feature-dev.yaml` to a terminal state.

- **Wave 2 (separate hardened task):** `HttpRequestActionRunner` with scheme allowlist / opt-in gate,
  header redaction, GET default (F4 + the §6 security list).

**Verification of the latch end-to-end:** with F1 in, a dry-run of `feature-dev.yaml` (agent steps
stubbed to a fake `AgentAppService` returning exit 0) must show the first `agent.run` with
`continue:false` and subsequent ones with `continue:true`, and `__agentSession` set after step 1.


### Review


---

## Resolution — 2026-06-10 (engine 0.3.9 released)

The PARTIAL blocker is **resolved**. `@gobing-ai/ts-*` released at **0.3.9** (incl. `ActionResult.setVars`
from task 0033). Catalog bumped `^0.3.7 → ^0.3.9`; `bun install` reinstalled; installed engine confirmed
to carry `setVars`.

**Verdict: PASS.**

- **Finding 1 (latch inert) → RESOLVED.** Added an end-to-end regression test
  (`tests/workflow/builtins.test.ts` — "session latch propagates across steps end-to-end") that runs a
  real two-step `agent.run` workflow through `StateMachineDriver` and asserts the captured `continue`
  flags are `[undefined, true]` — step 1 opens the session, step 2 auto-continues via `setVars`
  propagating through the engine. This is the exact behavior that was dormant on 0.3.7. Test passes.
- **Finding 2 (`as unknown as ActionResult` cast) → RESOLVED.** With the real `setVars` type present,
  `agent-run.ts` now returns a plainly-typed `ActionResult` (cast removed); app typecheck clean.
- **Finding 3 (file path traversal) → tracked for 0034** hardening (P4, unchanged; local-harness scope).

**Gate:** lint clean (all workspaces); **417 tests pass / 0 fail** (incl. the new e2e latch test);
`bun run build` succeeds across all workspaces. Catalog SSOT honored (root catalog bumped, no literal
version edits in workspaces).

The session latch is now **live**: a `feature-dev.yaml` run executes its `agent.run` steps in one
continued agent session.


### Phase 8 — Requirements traceability (against real source)

| Req | Verified at | Status |
|-----|-------------|--------|
| R1 `agent.run` → `AgentService.run` + latch | `agent-run.ts:24-73` (delegates; latch @42-46; setVars @70) | MET (logic) / see Blocker-1 for runtime effect |
| R2 `rule.check` → `RuleService.evaluate` | `rule-check.ts:25-50` (preset default `recommended-pre-check`, thin map) | MET |
| R3 `file.exists` via FileSystem | `file-exists.ts` (path resolve, `negate`) | MET |
| R4 `file.read` via FileSystem, utf-8, `maxSize` | `file-read.ts` (stat-before-read, no encoding opt) | MET |
| R5 `http.request` deferred to 0034 | absent from `workflow/actions/` by design | MET (correctly deferred) |
| R6 `registerSpurBuiltins({agentService,ruleService,fileSystem?})` | `builtins.ts:18-24` (`createNodeFileSystem()` default) | MET |
| R7 wired into `WorkflowAppService` | `workflow-service.ts:107-114`; CLI ctx supplies services `workflow.ts:36-42` | MET |
| R8 `feature-dev.yaml` de-noted | 6×`agent.run` + 1×`rule.check`, **zero `note`** | MET |
| R9 per-action tests | `tests/workflow/**` — 26 tests incl. latch unit tests | MET |
| R10 gate green | lint+typecheck clean (all workspaces); 26 workflow tests pass | MET |

### Phase 7 — SECU

- **Security:** no secrets/injection/auth surface in the four runners. `rule.check` runs with `NO_COLOR`
  null-object; `file.*` resolve paths via `joinPath(context.workdir, …)` — no traversal guard, but
  scope is the run's own workdir (acceptable for a local dev harness; note for hardening if untrusted
  paths ever flow in). Clean.
- **Correctness:** all four delegate cleanly, handle missing/typed options, stat-before-read, negate
  logic correct. Latch logic correct and unit-tested (no-latch→unset, open→true, explicit-override→false:
  `agent-run.test.ts:61-97`).
- **Efficiency/Usability:** thin adapters, consistent shape, good JSDoc. Clean.

### Findings

| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| 1 | **Session latch is inert in shipped state** — installed engine is `0.3.7`, whose `ActionResult` has **no `setVars`**; the `setVars: {__agentSession:'open'}` (agent-run.ts:70) is silently dropped, so `__agentSession` is never set and every `agent.run` opens a fresh session. The marquee one-session efficiency goal does not yet work despite correct code. | Correctness (deployment) | `agent-run.ts:70` + catalog pin `package.json` `^0.3.7` | **P2.** Release engine 0033 (`setVars`, targeted 0.3.8) and bump spur's catalog pin. The code is forward-correct; this is a release-sequencing gap. Until then the latch correctly *degrades* (no crash) — but the feature is dormant. Track explicitly. |
| 2 | `as unknown as ActionResult` double-cast | Correctness (type safety) | `agent-run.ts:66-71` | **P3.** The cast exists only because the installed `0.3.7` `ActionResult` type lacks `setVars`. Once the catalog bumps to the `setVars`-bearing engine, replace with a plain typed return (no cast). Tie to Finding 1. |
| 3 | `file.*` paths have no traversal guard | Security | `file-read.ts:29`, `file-exists.ts:29` | **P4.** Scoped to run workdir; fine for local harness. If file paths ever become attacker-influenced (e.g. via `${vars}` from untrusted source), add a `..`/absolute-escape guard. Note for the 0034 hardening pass. |

No P1. `--fix all`: findings are release-sequencing (1, 2 — not mechanically fixable here without the
engine release) and a P4 defensive note (3). No mechanical auto-fix applied; all three are tracked.

### Conclusion

Code is correct, typed, tested, gate-green, and `feature-dev.yaml` is fully de-`note`d — the task's
implementation is done. **PARTIAL** (not PASS) solely because the session latch's runtime effect is
blocked on the 0033 engine release reaching spur's catalog. Recommend: release engine 0.3.8, bump the
catalog, then the latch activates and Finding 2's cast clears. Status left as-is (Done) — the gap is
deployment, not implementation; surfaced here for tracking.


### Testing

- Command: `bun run test` in `~/xprojects/spur-new`
- Scope: 416 tests across 63 files including 15 new workflow tests
- New tests: agent-run (8), rule-check (4), file-exists (4), file-read (4), builtins (3), utils (2)
- Result: 416 pass, 0 fail, 1088 expect() calls. Coverage: 99.88% funcs, 99.36% lines.
- All new source files at 100% func/line coverage.
- HTTP deferred per F4 (task 0034).


### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References

- **0033** (F1) — `ActionResult.setVars` engine change (blocking dependency for the session latch).
- **0034** (F4) — hardened `http.request` action (Wave 2, split from this task).
- `packages/app/src/services/agent-service.ts` — `AgentAppService.run` (delegate target; builds `PromptOptions`).
- `packages/app/src/services/rule-service.ts` — `RuleAppService.evaluate` (delegate target).
- `~/xprojects/ts-libs/packages/ai-runner/src/agents/shims.ts` — per-agent `continue` handling (uniform; no change needed).
- `config/workflows/feature-dev.yaml` — the workflow this de-`note`s.


