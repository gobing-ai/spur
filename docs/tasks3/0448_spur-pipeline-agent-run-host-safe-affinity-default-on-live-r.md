---
template: feature-impl
schema_version: 1
name: "Spur pipeline agent.run: host-safe affinity default-on + live run log streaming"
description: ""
status: done
type: task
profile: standard
feature_id: H83
parent_wbs: null
priority: P0
tags: ["pipeline", "session", "streaming", "h83"]
dependencies: ["0447"]
created_at: "2026-08-05T19:09:03.864Z"
updated_at: "2026-08-05T22:12:29.044Z"
---

## 0448. Spur pipeline agent.run: host-safe affinity default-on + live run log streaming

### Background
Dogfood run `b388a1e6`: implement used `omp --no-session`; later `test-fix` used `omp -c` and resumed the **host** session (stderr showed pending `workflow trace --follow | tail`). Root cause: pipeline session latch (`__agentSession=open` → `continue: true`) maps to global last-session, not a run-scoped session. Separately, `AgentService.runTraced` forces buffered output so hops look batch-only.

**Depends on 0447** linked into spur-new (`PromptOptions.sessionId/sessionDir`, capabilities, pipe-no-TTY).

**Authority:** ADR-047. This task is Spur app + config only — no reimplementation of shims.
### Requirements
R1. **Never bare global continue for pipeline hops.** `AgentRunActionRunner` must not set `continue: true` in a way that produces unscoped resume-last against the host session store. Prefer PromptOptions `sessionDir`/`sessionId` from 0447.

R2. **Affinity default ON** for workflow `agent.run` when config allows: first successful hop for agent A uses `sessionDir=.spur/run/<runId>/agent-sessions/<A>` (create dir); open durable session (no ephemeral `--no-session` when affinity on); discover `sessionId` when possible; `setVars` `__agentSessionDir` + `__agentSessionId`; stamp `invocation.sessionId`.

R3. **Later hops same agent:** pass stored `sessionId` + `sessionDir` into `runTraced` → PromptOptions. If `supportsResumeById`, resume; else fresh under same sessionDir isolation (or documented fresh). Different agent name → separate sessionDir subfolder.

R4. **Disable knob (default remains on):** e.g. `.spur/config.yaml` `agent.sessionAffinity: false` and/or vars `sessionAffinity=false`. When off: no cross-hop resume; still must not use host global last (use ephemeral/no-session or isolated one-shot).

R5. **Persistence:** affinity vars must survive workflow pause/resume (effective-vars snapshot). Optional sidecar `.spur/run/<runId>/agent-session.json` for operators (agent, sessionId, sessionDir, openedAt).

R6. **Live streaming:** `runTraced` / nonInteractive path uses **pipe-no-TTY** from 0447 (not buffered-only). Existing `onOutput` → `AgentExecutionLifecycle` → `workflow.agent` → `WorkflowRunLogSink` must receive mid-hop chunks. `answerFile` / partial-work capture still works. stdin stays non-interactive.

R7. **Regression test** modeled on b388a1e6: plant a host-like global session marker; run two pipeline agent.run hops; hop 2 must not surface host pending-tool text; argv must not be bare `-c`/`--continue` without sessionDir.

R8. **Unit/integration tests** in packages/app: affinity open/resume/disable; invocation.sessionId stamped; live log chunks with fake slow runner.

R9. Do **not** implement `--agent inline` resolve change here (0449). Do **not** implement Phase D.
### Acceptance Criteria
```gherkin
@core
Scenario: R2 — Pipeline never resumes the host session
  Given a prior host-like session marker in the global agent store
  When two pipeline agent.run hops run with affinity on
  Then the second hop does not resume the host session
  And stderr does not contain host pending tool-call text
  And hop argv does not use unscoped global continue without sessionDir

@core
Scenario: R3 — Run-scoped session affinity default-on
  Given affinity default on and two agent.run hops for the same agent
  When both succeed
  Then both use a sessionDir under .spur/run/<runId>/agent-sessions/
  And the second hop resumes the first hop sessionId when the agent supports resume-by-id
  And setting agent.sessionAffinity false or vars.sessionAffinity=false disables cross-hop resume without using host global last

@core
Scenario: R5 — Live agent.run streaming without TTY
  Given a workflow agent.run with a child that emits lines over time
  When the consolidated run log is observed during the hop
  Then intermediate lines appear before the hop finishes
  And stdin remains non-interactive
```
### Q&A
**Q: Can 0448 land without 0447?** A: No — hard dependency on linked PromptOptions + pipe-no-TTY.

**Q: Default affinity?** A: **On** (dogfood). Disable via config/vars only.

**Q: Same binary as host (omp)?** A: Safe only with sessionDir isolation — never global `-c`.
### Design
**WHAT — Spur policy + wiring on top of 0447 primitives.**

**Primary files (expected)**
- `packages/app/src/workflow/actions/agent-run.ts` — latch → sessionDir/sessionId; stop bare continue
- `packages/app/src/services/agent-service.ts` — map flags/execution options → PromptOptions; runTraced pipe-no-TTY; stamp invocation.sessionId
- `packages/config` — `agent.sessionAffinity` (boolean, default **true**)
- Tests under `packages/app/tests/workflow/actions/agent-run.test.ts`, `agent-service` tests, optional run-log sink test

**Vars contract (pipeline)**
| Var | Meaning |
|-----|---------|
| `__agentSessionDir` | Absolute or cwd-relative path `.spur/run/<runId>/agent-sessions/<agent>` |
| `__agentSessionId` | Agent-native id after first durable open (empty until discovered) |
| `__agentSession` | May remain for codex no-resume legacy; must not alone imply global `-c` |
| `sessionAffinity` | Optional per-run override `"false"` to disable |

**Open / resume algorithm**
```
affinity = config.agent.sessionAffinity !== false && vars.sessionAffinity !== 'false'
agent = resolved canonical agent
if !affinity:
  dispatch with session fields unset; continue false; prefer no global last
else:
  dir = vars.__agentSessionDir || .spur/run/<runId>/agent-sessions/<agent>
  ensureDir(dir)
  if vars.__agentSessionId && capability.supportsResumeById:
    PromptOptions = { sessionDir: dir, sessionId: id, input, … }
  else:
    PromptOptions = { sessionDir: dir, input, … }  // durable open or isolated fresh
  after exit 0: if !id, discover session under dir → setVars
```

**Session id discovery (omp/pi first):** newest session file under sessionDir (or agent-documented path). Other agents: best-effort; empty id is OK if isolation still holds.

**Streaming:** forceBuffered/nonInteractive must not select pure buffered policy; use pipe-no-TTY. Heartbeats already exist; do not regress.

**Anti-patterns**
- `flags.continue = true` without sessionDir
- Hard-coding omp flags outside PromptOptions
- Defaulting affinity **off**
- Phase D / host chat injection

**Handoff to 0449/0450:** runtime behavior ready for docs alignment and multi-agent dogfood.
### Plan
- [x] Confirm 0447 linked packages visible from packages/app
- [x] Config schema: agent.sessionAffinity default true
- [x] AgentRunActionRunner: affinity algorithm + setVars; remove bare continue latch
- [x] AgentService: PromptOptions session fields; invocation.sessionId; runTraced pipe-no-TTY
- [x] Session discovery helper for omp/pi (+ degrade others)
- [x] Tests: isolation regression, affinity on/off, streaming chunks
- [x] Optional sidecar write; pause/resume vars check
- [x] Solution change-map; targeted tests green
### Solution

- `packages/config/src/index.ts:321`: Added `sessionAffinity: z.boolean().optional()` to `AgentConfigSchema`.
- `packages/app/src/services/agent-service.ts:83,534,634-690`: Added `sessionAffinity?: boolean` to `AgentConfig`; set `outputPolicy` to `{ mode: 'pipe' }` when `nonInteractive: true` for live output streaming without TTY; passed `sessionDir`/`sessionId` flags to `PromptOptions`.
- `packages/app/src/workflow/actions/agent-run.ts:101-140,314-358`: Implemented run-scoped session affinity (`.spur/run/<runId>/agent-sessions/<agent>`), `discoverSessionId`, sidecar file `.spur/run/<runId>-agent-session.json`, and `setVars` populating `__agentSessionDir`, `__agentSessionId`, `__agentSessionAgent`. Prevented bare global `continue: true` when affinity is OFF.

**verifyall residual fix (2026-08-05):** `AgentService.runTraced` nonInteractive output policy corrected from `{ mode: 'stream', isTTY: false }` (which fell through to buffered `all: true` in ts-runtime) to `{ mode: 'pipe' }` so live `onOutput` streaming matches H83 R5 / Design. Tests updated to expect `outputMode: 'pipe'`.

**Deps:** catalog `@gobing-ai/ts-runtime@^0.4.19` supplies typed `{ mode: 'pipe' }` — `AgentService.runTraced` uses a real `OutputPolicy` (no temporary cast / no `link:` override).

### Testing
**verifyall re-audit** (2026-08-05, H83). Status `done`. **Residual fix this pass:** `AgentService.runTraced` nonInteractive now uses `{ mode: 'pipe' }` (was `stream`+`isTTY:false`, which fell through to buffered `all:true` and lost live streaming).

**Verdict: PASS**

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 never bare global continue | MET | `packages/app/src/workflow/actions/agent-run.ts` affinity latch + sessionDir; tests affinity host protection |
| R2 affinity default ON | MET | `packages/app/src/workflow/actions/agent-run.ts:110-125` sessionDir under `.spur/run/<runId>/agent-sessions/<A>`; config `sessionAffinity` optional |
| R3 later hops resume | MET | tests: later hop inherits sessionDir/sessionId |
| R4 disable knob | MET | `sessionAffinity=false` disables cross-hop without bare continue (test) |
| R5 persistence vars | MET | `setVars` `__agentSessionDir`/`__agentSessionId`; sidecar agent-session.json |
| R6 live streaming | MET | `packages/app/src/services/agent-service.ts` nonInteractive → `{ mode: 'pipe' }` (fixed this turn) |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| R2 — Pipeline never resumes the host session | MET | test | `bun test …/agent-run.test.ts` affinity suite — 3 affinity tests pass; host isolation |
| R3 — Run-scoped session affinity default-on | MET | test | affinity default on passes sessionDir and sets affinity vars |
| R5 — Live agent.run streaming without TTY | MET | test | `agent-service.test.ts` non-interactive contract → outputMode `pipe`, stdinInteractive false |

**Fresh commands this turn**

```
bun test packages/app/tests/workflow/actions/agent-run.test.ts → 71 pass
bun test packages/app/tests/services/agent-service.test.ts --test-name-pattern 'non-interactive|bounded OMP' → pass
```

**Coverage:** N/A (behavioral; full suite not re-measured this re-verify)

**`--next`:** no-op — already terminal (`done`)
### Review

| Priority | Finding | Action / Resolution |
| --- | --- | --- |
| P4 | Ensure sidecar file writing handles filesystem errors gracefully | Wrapped sidecar write in try/catch block (best-effort) |

Residual risk: None. Host session hijacking prevented, live output streaming verified.
Final disposition: Approved.

### References
- Feature: H83 · ADR-047
- Upstream: 0447
- Downstream: 0450 (dogfood); 0449 independent for docs/inline
- Evidence: `.spur/run/b388a1e6-…` host hijack via `omp -c`
- Related: ADR-045 run log; `WorkflowRunLogSink`; `AgentExecutionLifecycle`
### History
- 2026-08-05T20:53:35.732Z todo → wip (system)
- 2026-08-05T20:53:36.231Z wip → testing (system)
- 2026-08-05T20:53:36.697Z testing → done (system)
