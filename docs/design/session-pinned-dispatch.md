# Session-pinned headless dispatch and the executor availability lifecycle

- **Status:** Approved (design-approval 2026-09-17) · **Date:** 2026-09-17 · **Features:** B6, B7, B8, G66 (plus activation of P and E6)
- **ADR:** [ADR-121](../00_ADR.md#adr-121-coding-agents-stay-headless-dispatch-is-session-pinned-per-run-not-one-shot-per-stage)
- **Retains:** ADR-047 (session affinity precedence), ADR-057 (no terminal scraping / synthetic keystrokes), ADR-087 (`inline` selector semantics), ADR-111 (B5 durable quota updates), ADR-116/G65 (`agent.fleet`), ADR-118/119 (stage contracts, gate scope)
- **Origin:** idea run `3fc16af1-f2e7-4afd-9f05-59fc6ce555c5` (`.spur/run/…-idea-eval-report.md`)

## 1. Problem, measured

| Finding | Evidence |
| --- | --- |
| The executor ladder only degrades. B5 disables on `agent.quota.exhausted`; nothing re-enables; the project updater cannot write global-only executors (all 16 on the reference machine are global). | `docs/design/executor-availability.md` §6; `packages/config/src/executor-update.ts` (`setProjectExecutorDisabled` only) |
| `--agent auto` cost is per dispatch, not per resolution. Doctor is cached (0.28 s warm); every model-bearing stage still spawns a fresh one-shot subprocess with cold context. | `workflow-execution-economy.md` §1: `agent.run` = 96% of machine time, 357 s avg; `agent-doctor-inspection-surface.md` §5 |
| Fleet members are not persistent agents. `spur agent loop` calls `AgentService.run` per drained message: a fresh `-p` process each time. The runner's `TeamAgentProcess` is imported but not on the member path. | `apps/cli/src/commands/agent.ts` `runAgentLoop`; `packages/app/src/services/agent-coordination-service.ts` |
| Session affinity is declared per agent but incompletely. `AgentSessionCapability` carries only `supportsResumeById` / `supportsSessionDir`; codex resume is interactive-only; gemini resumes `latest` only; claude has no session dir. | `@gobing-ai/ts-ai-runner@0.4.67` `dist/agents/shims.d.ts`, `shims.js:305` — superseded by feature B8: `@gobing-ai/ts-ai-runner@0.4.68` extends the record (`supportsPersistentStdin`, `supportsStructuredOutput`, `verifiedAgainst`, `note`) and closes the codex resume gap (`exec resume <id> <prompt>`); the record is authoritative, Spur reads and never re-declares |
| Nothing measures per-stage executor cost. E6 run→session correlation exists as a feature with 0 mapped rows. | feature E6 (active) |

## 2. Decision — headless stays; dispatch becomes session-pinned

Interactive TTY/PTY mode was evaluated and rejected as a dispatch surface: it has no structured output or exit semantics, permission prompts need a human, and driving it requires the terminal scraping ADR-057 forbids. Its advantages — watching/steering and hooks/MCP parity — already exist headlessly (`spur serve` process streams + `POST /api/processes/:id/stdin`; the agents' own `-p` flags).

What changes is the *granularity* of headless dispatch:

| Today | After |
| --- | --- |
| Resolve executor per stage (doctor cache 60 s) | Resolve once per run per role at precheck; pin in run vars (B7) |
| Fresh subprocess + cold context per stage | Coder-role stages resume the pinned session; reviewer/verify stages fresh by default (B7) |
| Agent capabilities hard-coded in Spur branches | Runner declares `resumeById / sessionDir / persistentStdin / structuredOutput`; Spur reads them (B8) |
| Fleet member = one-shot per drain | Member keeps one session; persistent stdin where supported, resume-by-id otherwise (G66) |
| Disable is reactive and permanent; global executors immutable | Ownership + recovery + global updater + explicit run-once usage producer (B6) |

## 3. B6 — Executor availability lifecycle

### 3.1 Ownership state (config shape)

`AgentExecutorConfigSchema.disabled` widens from `boolean` to `boolean | { owner, since, reason }`:

```yaml
agent:
  executors:
    - name: codex-astra
      disabled: true                         # bare boolean ⇒ owner: operator
    - name: pi-zai-volc
      disabled: { owner: quota, since: "2026-09-17T22:10:00Z", reason: "agent.quota.exhausted zai" }
```

`owner ∈ { operator, quota, probe }`. Precedence for automatic writers: `operator` is never overwritten by `quota` or `probe`; `quota` and `probe` may overwrite each other by `(observedAt, observationId)` order (B5 rule, unchanged). The boolean form stays valid forever; readers normalize through one helper in `packages/config`.

### 3.2 Updater

`setProjectExecutorDisabled` generalizes to `setExecutorAvailability({ layer: 'project' | 'global', executor, disabled: false | {owner, since, reason}, observation })`. Layer is chosen by where the executor is declared (project fragment wins when both exist). Global writes use the same backup + atomic-rename + conflict-detection path against `~/.config/spur/config.yaml`. Loader cache invalidation covers both layers. The B5 `agent_executor_updates` row gains `owner` and `layer`; the serial drain is unchanged.

### 3.3 Recovery consumer

`agent.quota.recovered` (already emitted upstream, dropped today) upserts `disabled: false` with `owner: quota` provenance; the drain applies it only when the current owner is `quota` or `probe`. An operator-owned row is acknowledged as a classified no-op and logged.

### 3.4 Usage producer (run-once, external schedule)

One command, run by cron/launchd like `spur history daily`, never by `spur serve`:

1. Run `codexbar usage --format json --provider all` (adapter behind a small `UsageSource` interface so a second source can be added without touching the mapping).
2. Write `~/.config/spur/agent-usage.json` (`{ captured_at, source, providers: [...] , raw }`). Tests and sandboxes pin the location via `SPUR_AGENT_USAGE_SNAPSHOT` (injected-env override in `defaultAgentUsageSnapshotPath`; bun's `homedir()` ignores `HOME` at runtime).
3. Map provider → executors via `agent.executors[].agent` + model/provider prefix; unmapped providers are reported, never guessed.
4. Emit synthetic `agent.quota.exhausted|recovered` observations with `owner: quota` into the same durable path (§3.2); `--dry-run` prints the diff and writes nothing. A provider is exhausted when any non-null `usage.primary|secondary|tertiary` window has `usedPercent >= 100`, and has headroom when every non-null window is below 100; `extraRateWindows` is kept in `raw` only.
5. codexbar missing, or output that is not a parsable array of provider entries ⇒ exit non-zero naming the cause, no writes. A non-zero exit alone is not a failure: codexbar exits 1 whenever any provider fails. Per-provider `error` entries are skipped and reported; healthy entries still apply.

**Public surface (ADR-051 consent given 2026-09-17):** `spur agent usage [--dry-run] [--source codexbar]` under the existing `agent` noun. The rejected alternative was `spur agent doctor --refresh-usage` (mixes an inspection verb with a write). Consent row: [harness-surface-governance.md](harness-surface-governance.md).

**Partially verified premise (2026-09-17, CodexBar 0.60.4):** the error-entry and healthy-entry shapes were captured in-sandbox, but only one provider was healthy there (cookie-cache lock EPERM). Task 0892 step 1 captures a sample with healthy `claude`/`codex` entries out-of-sandbox and pins it as a fixture before the adapter is written.

### 3.5 Doctor

Table and `--json` add availability provenance: `owner`, `since`, `reason`, and snapshot `age`. A snapshot older than `agent.usage.maxAgeMs` (constant default 6 h; config only if it must vary) renders `stale` and is not used to enable anything.

## 4. B7 — Run-scoped executor session

- **Resolve once.** `precheck` (task-pipeline) and `start` (idea-pipeline) call `resolveRole` for every role declared by the workflow's stages and write `__executor.<role> = { name, agent, model, tier, capabilities }` into run vars. `agent-run.ts` reads the pin; `doctor.probe` is no longer on the per-stage path.
- **Session pin per role.** `__agentSessionDir` / `__agentSessionId` become `__session.<role>.{dir,id}`; discovery after a run (existing `discoverSessionId`) writes back to the role's slot.
- **Stage policy.** New optional stage option `session: reuse | fresh` on `agent.run`. Defaults by role: coder → `reuse`; reviewer, planner, scribe → `fresh`. A reviewer stage may declare `session: reuse` explicitly; the trace records the declaration.
- **Capability gate.** If the runner's record declares `supportsResumeById: false` (`getAgentSessionCapability`), the dispatch is fresh: no `--resume`/`--session-id` flag is emitted, the action result records `session: 'fresh'`, and `__agentSession: 'no-resume'` is written up front so downstream steps skip the latch. A resume-only step — `continue: true` with no `input` — against such a record fails pre-spawn as the ADR-118 `requiresCapabilities` contract violation (task 0898); `continue` with `input` keeps the fresh dispatch.
- **Pin invalidation.** Before each `agent.run`, the pinned executor's current availability is checked through the loader (cache-invalidated by B6). Disabled ⇒ re-resolve the role once, record `pin-reresolved` with the owner/reason, start fresh.
- **Trace.** Each `agent.run` trace row gains `executor`, `sessionId`, `session: reused | fresh`. E6 R2 (agent accepts a session id ⇒ exact mapping) is satisfied by construction for resumed stages.
- **Isolation caveat (Cons).** Reuse leaks the implement context into test. That is the intent for coder stages and forbidden by default for reviewers; the policy is the safeguard, not a heuristic.

## 5. B8 — Runner capability matrix (upstream `@gobing-ai/ts-ai-runner`)

Extend the existing `AgentSessionCapability` rather than add a parallel type:

```ts
export interface AgentSessionCapability {
    readonly supportsResumeById: boolean;
    readonly supportsSessionDir: boolean;
    readonly supportsPersistentStdin: boolean;   // multi-turn over stdin in one process
    readonly supportsStructuredOutput: boolean;  // json / stream-json output mode
    readonly verifiedAgainst: string;            // agent CLI version the row was checked on
    readonly note?: string;                      // recorded reason for a false (e.g. codex resume is interactive-only)
}
```

Initial rows (to be verified per CLI at implementation; LOW confidence marked ?):

| Agent | resumeById | sessionDir | persistentStdin | structuredOutput |
| --- | --- | --- | --- | --- |
| claude | true | false | true? (`--input-format stream-json`) | true |
| codex | false (note: `exec resume` is interactive-only) | false | false | true (`--json`) |
| gemini | false (`-r latest` only) | false | false | true? |
| pi / omp | true | true | ? (rpc/json mode) | true |
| antigravity | true (`--conversation`) | false | false | ? |
| grok | true (`--resume`) | false | false | ? |

Spur consumers: `agent-run.ts` affinity branches, `agent doctor --json` (`capabilities` per executor), `capability-attestation` (`requiresCapabilities: [resumeById]` ⇒ contract-violation before spawn, ADR-118 outcome). Doctor warns when the detected CLI version core differs from the record's `verifiedAgainst` core — branding prefix/suffix is not drift, and no core on either side is unverifiable (never warns, 0899). Release + `bun update` recorded in the workspace catalog.

## 6. G66 — Persistent fleet member

`runAgentLoop` keeps `memberSession = { mode, id?, dir?, process? }` for the loop's lifetime:

| Capability | Mode | Mechanism |
| --- | --- | --- |
| `supportsPersistentStdin` | `persistent` | one `TeamAgentProcess` started at loop start; each drained prompt goes through `send()`; process exit ⇒ supervisor restart policy (unchanged) |
| else `supportsResumeById` | `resume` | `AgentService.run` with `sessionId` from the previous drain |
| else | `one-shot` | today's behaviour; one warning per member lifetime |

Reset on supervisor restart, `agent stop`/`start`, or `MAX_CONSECUTIVE_FAILED_DRAINS` (constant, 3) failures; the run record names the reason. The fleet snapshot and process entry expose `session: { mode, id }`. The 0834 reconcile-before-first-drain and 0831 settle guarantees are untouched: session continuity is an agent-memory property, delivery state stays in the DB.

## 7. Sequencing and dependencies

```
B8 (upstream, parallel) ─┐
B6 ──────────────────────┼─▶ B7 ──▶ G66
E6 (existing, measurement) ┘
P (existing): F5 implementAgent=auto semantics lands with B7; F7 watcher freshness stays as scoped
```

B6 first: it is the safety blocker for `auto`. B7 can start on today's `getAgentSessionCapability`; it re-reads the widened record when B8 lands.

## 8. Same-commit obligations (T3) per feature

- `docs/04_DESIGN.md` — this satellite indexed (done at design time); config shape (`disabled` object, `session:` stage option) in the configuration/workflow satellites when the tasks land.
- `docs/03_ARCHITECTURE.md` §19 — add the resolve-once + ownership invariants **when B6/B7 ship**, not before (03 describes current topology).
- `plugins/sp/skills/spur-cli/references/agent.md` — `agent usage` verb (if consented) and doctor provenance columns.
- `plugins/sp/skills/spur-dev/references/cross-cutting.md` — "Inline-default execution surface" gains the session-policy paragraph.
- `config/config.example.yaml`, `apps/cli/schemas/spur-config.schema.json` — `disabled` object form.
- Tests: `packages/config/tests/executor-update*`, `packages/app/tests/workflow/actions/agent-run*`, `apps/cli/tests/commands/agent*`.

## 9. Open questions — resolved at design-approval (2026-09-17)

1. **ADR-051 consent:** new verb `spur agent usage` under the `agent` noun. Consented.
2. **Default reviewer policy:** reviewer/verify stages are `fresh` by default; `session: reuse` must be declared. Confirmed.
3. **Global-config writes:** automatic writers may target `~/.config/spur/config.yaml` with backup + atomic rename; operator-owned entries are never touched. Approved.
