---
template: feature-impl
schema_version: 1
name: "ts-libs foundation: six-agent session primitives + pipe-no-tty live output"
description: ""
status: done
type: task
profile: standard
feature_id: H83
parent_wbs: null
priority: P0
tags: ["ts-libs", "ai-runner", "runtime", "h83"]
dependencies: []
created_at: "2026-08-05T19:09:03.829Z"
updated_at: "2026-08-05T22:12:28.685Z"
---

## 0447. ts-libs foundation: six-agent session primitives + pipe-no-tty live output

### Background
Upstream facades block H83. Today `PromptOptions` only has `continue?: boolean`, so every shim maps continue to **global last-session** resume (`-c` / `--continue` / `resume --last`). That collides with the host interactive session when host and pipeline share a binary (dogfood run `b388a1e6`: nested omp `-c` resumed host mid-tool). Separately, `ProcessExecutor` conflates non-interactive with end-buffered `all: true`, so pipeline agent output looks batchy.

**Authority:** ADR-047 (Accepted design), feature H83. Implement in `~/xprojects/ts-libs` (`ai-runner` + `runtime`), then `bun link` into spur-new — do **not** wait on npm publish.

**This task owns only the universal library surface.** Spur affinity policy and `AgentService` wiring are **0448**. Docs/inline surface are **0449**. Dogfood is **0450**.
### Requirements
R1. **Universal session fields on `PromptOptions`** (names frozen in Design): add optional `sessionId?: string` and `sessionDir?: string`. Keep existing `continue?: boolean` for legacy callers.

R2. **Capability metadata** per agent (export from ai-runner): at minimum `supportsResumeById` and `supportsSessionDir` for each of omp, pi, claude, codex, agy (`antigravity-cli`), grok. Callers must not invent per-agent argv.

R3. **Shim mapping for all six agents** via `getPromptCommand` only: when `sessionDir` and/or `sessionId` are set, **never** emit unscoped global continue/last-session flags. omp/pi: `--session-dir` + `-r <sessionId>` when provided. Other agents: best-effort isolation or **isolated-fresh / no-resume** degrade (documented matrix) — still never bare global last.

R4. **Durable open vs ephemeral:** when caller intends a durable session (sessionDir set without ephemeral intent), omp/pi must **not** pass `--no-session`. Legacy path without session fields may keep current `--no-session` when `continue` is false (compat).

R5. **Precedence (normative):** (1) if `sessionId` or `sessionDir` set → pin/isolate path; ignore bare `continue` for global last. (2) else if `continue === true` → legacy resume-last only if agent allows. (3) else → fresh open.

R6. **`@gobing-ai/ts-runtime` pipe-no-TTY policy:** stdin ignore, no TTY inherit, stdout/stderr piped so `onOutput` fires as chunks arrive (not only at process exit). Distinct from TTY stream inherit and from pure buffered `all: true`.

R7. **Tests:** (a) per-shim argv matrix table for the six agents × {fresh, sessionDir-only, sessionId+sessionDir, continue-only}; (b) slow-child process proving mid-run `onOutput` under pipe-no-TTY.

R8. **bun link** both packages into spur-new; smoke that spur resolves the linked builds (`bun pm ls` / import path / one argv unit test from spur workspace optional).

R9. **Document** the degrade matrix and precedence in ai-runner package docs (short README section or `docs/` in that package). No Spur app code in this task.
### Acceptance Criteria
```gherkin
@core
Scenario: R4 — Agent matrix: omp, claude, codex, agy, grok, pi
  Given PromptOptions with sessionId and/or sessionDir
  When getPromptCommand runs for omp, pi, claude, codex, agy, grok
  Then argv never uses unscoped global continue when sessionDir or sessionId is set
  And omp and pi include --session-dir when sessionDir is set
  And omp and pi include -r with the sessionId when sessionId is set
  And unit tests lock the argv matrix for fresh, sessionDir, sessionId+sessionDir, and continue-only

@core
Scenario: R5 — Live agent.run streaming without TTY
  Given a child that prints lines over time under the pipe-no-TTY policy
  When onOutput is registered
  Then observers receive at least one chunk before process exit
  And the child does not inherit a TTY on stdout
  And stdin is not an interactive terminal
```
### Q&A
**Q: Does 0447 include Spur wiring?** A: No — only ts-ai-runner + ts-runtime. Spur consumes in 0448.

**Q: Universal surface location?** A: Only `@gobing-ai/ts-ai-runner` PromptOptions + AgentShim.getPromptCommand. No parallel shim layer in Spur.

**Q: What if an agent cannot resume by id?** A: With session* set, open **fresh** in isolation (or plain fresh) — never bare global continue.

**Q: ADR status?** A: ADR-047 already Accepted (design). Implement against it; do not re-litigate Phase D.
### Design
**WHAT — universal session + observation primitives in ts-libs (not Spur).**

**WHY —** One PromptOptions surface + per-agent shims is the only way Spur (and others) can pin run-scoped sessions without N hard-coded CLIs. Pipe-no-TTY is the only way live run logs work without interactive prompts.

**WHERE**
- Code: `/Users/robin/xprojects/ts-libs` packages **`ai-runner`** and **`runtime`**
- Consume: spur-new via `bun link @gobing-ai/ts-ai-runner` and `bun link @gobing-ai/ts-runtime`
- Do **not** reimplement shims under `packages/app`

**Frozen API (ai-runner)**

```ts
// PromptOptions — additive fields
sessionId?: string;   // pin resume target when agent supports resume-by-id
sessionDir?: string;  // isolate session storage from host default store

// Capability (export shape implementer chooses; must be queryable)
interface AgentSessionCapability {
  supportsResumeById: boolean;
  supportsSessionDir: boolean;
}
// e.g. getAgentSessionCapability(agent: AgentName): AgentSessionCapability
```

**Precedence (must match R5)**
1. `sessionId` | `sessionDir` present → isolation/pin path; **do not** emit global continue/last
2. else `continue === true` → legacy resume-last (if agent supports)
3. else → fresh

**Shim target matrix (minimum argv contracts)**

| Agent | Canonical id | sessionDir | sessionId resume | continue-only (legacy) | Degrade if no pin |
|-------|--------------|------------|------------------|------------------------|-------------------|
| omp | `omp` | `--session-dir <dir>` | `-r <id>` | `-c` | N/A (full support) |
| pi | `pi` | `--session-dir <dir>` | `-r <id>` | `-c` | N/A (full support) |
| claude | `claude` | research current CLI; else ignore dir | research resume-by-id | `--continue` | fresh, no global last when session* set |
| codex | `codex` | isolate if possible | often unavailable | `exec resume --last` only on legacy continue | when session* set: **fresh** `exec`, never resume --last |
| agy | `antigravity-cli` | best-effort | best-effort | `--continue` legacy | when session* set: fresh `-p`, no `--continue` |
| grok | `grok` | best-effort | best-effort | `-c` legacy | when session* set: fresh `-p`, no `-c` |

**omp/pi durable open:** with `sessionDir` set and no ephemeral flag → omit `--no-session` so a session file is written and discoverable by 0448.

**Frozen API direction (runtime)**
- Prefer extending `OutputPolicy` (or adjacent option) so non-interactive callers can select **pipe without TTY inherit** while still getting `onOutput` data events.
- Forbidden for pipeline path: requiring `isTTY: true` to get live chunks; using `all: true` only and hoping for mid-run events.
- stdin remains `ignore` for this policy.

**Anti-patterns (do not implement)**
- Spur-side hard-coded `omp -r` / `-c` outside shims
- Treating `continue: true` as sufficient for pipeline affinity
- `--no-session` on every one-shot when sessionDir is set (breaks affinity discovery)
- Claiming all six agents support resume-by-id (false — degrade is required)

**NOT in this task:** AgentRunActionRunner, config `sessionAffinity`, docs/inline (0449), dogfood (0450), ADR edits (already done).

**Handoff to 0448:** Spur will pass `sessionDir` / `sessionId` only through PromptOptions / runner flags that map into PromptOptions; capability query decides resume vs fresh.
### Plan
- [x] Read current shims + ProcessExecutor in ts-libs; list actual CLI flags for omp/pi/claude/codex/agy/grok (help text)
- [x] Add PromptOptions.sessionId/sessionDir + capability export + unit tests (argv matrix)
- [x] Implement shim precedence for all six agents per Design table
- [x] Implement pipe-no-TTY policy + slow-child onOutput test in runtime
- [x] bun link both packages into spur-new; confirm resolution
- [x] Short package doc: precedence + degrade matrix
- [x] Solution change-map via spur task update; targeted tests green
### Solution
**Change map (ts-libs, external repo — pipeline requireDiff cannot see it)**

- `~/xprojects/ts-libs/packages/ai-runner/src/agents/shims.ts`
  - `PromptOptions.sessionId?`/`sessionDir?` (R1): `~/xprojects/ts-libs/packages/ai-runner/src/agents/shims.ts`
  - Capability metadata `AgentSessionCapability` + `getAgentSessionCapability` (R2): `~/xprojects/ts-libs/packages/ai-runner/src/agents/shims.ts`, `~/xprojects/ts-libs/packages/ai-runner/src/agents/shims.ts`
  - Shim precedence (R5) for omp/pi/claude/codex/agy/grok — session* set never emits unscoped global continue/last; omp/pi durable open omits `--no-session` when `sessionDir` set (R4): `~/xprojects/ts-libs/packages/ai-runner/src/agents/shims.ts`, `~/xprojects/ts-libs/packages/ai-runner/src/agents/shims.ts`, `~/xprojects/ts-libs/packages/ai-runner/src/agents/shims.ts`
- `~/xprojects/ts-libs/packages/runtime/src/process-executor.ts`: `OutputPolicy` gains `{ mode: 'pipe' }` — stdin ignore, no TTY inherit, stdout/stderr piped so `onOutput` fires mid-run (R6): `~/xprojects/ts-libs/packages/runtime/src/process-executor.ts`
- Tests: `~/xprojects/ts-libs/packages/ai-runner/tests/agents/shims.test.ts` (argv matrix 6×4 + capability, R7a); `~/xprojects/ts-libs/packages/runtime/tests/process-executor.test.ts` (slow-child mid-run `onOutput`, R7b).
- Docs: `~/xprojects/ts-libs/packages/ai-runner/README.md` — R5 precedence, degrade matrix, durable-vs-ephemeral (R9).

**R8:** `bun link` `@gobing-ai/ts-ai-runner` + `@gobing-ai/ts-runtime` into spur-new; rebuilt dist; verified `getAgentSessionCapability('omp')` and omp sessionId+dir argv resolve from spur-new.

**Pipeline note:** standard `task-pipeline` requireDiff gate (`packages/app/src/workflow/actions/agent-run.ts:256`) checks only spur-new's tree, so this external-repo task cannot be certified by the pipeline's implement gate — completed and verified directly (structural limitation, not an implementation gap).

**Published pin (post-implement):** `@gobing-ai/ts-ai-runner` + `@gobing-ai/ts-runtime` released as **0.4.19**. Spur root catalog is `^0.4.19` (semver, not `bun link`). Live pipe-no-TTY + session primitives resolve from the registry; the temporary link override was removed.

### Testing
**verifyall re-audit** (2026-08-05, `/sp:dev-verifyall --feature H83 --force --fix all`). Status already `done`.

**Verdict: PASS**

**Per-Requirement Traceability** (evidence in external `~/xprojects/ts-libs`; re-run tests this turn)

| Req | Status | Evidence |
|-----|--------|----------|
| R1 sessionId/sessionDir on PromptOptions | MET | command: `bun test packages/ai-runner/tests/agents/shims.test.ts` in ts-libs → **49 pass**; fields present on PromptOptions |
| R2 capability metadata | MET | `getAgentSessionCapability` for omp/pi/claude/codex/agy/grok (supportsResumeById / supportsSessionDir) |
| R3 six-agent shim mapping | MET | shims test matrix 6× argv shapes; never unscoped global continue when session* set |
| R4 durable open omits --no-session when sessionDir | MET | shims tests + omp smoke argv |
| R5 session precedence | MET | R5 precedence documented + locked in shims tests |
| R6 pipe-no-TTY | MET | `bun test packages/runtime/tests/process-executor.test.ts` → **22 pass** (pipe mode live onOutput) |

**Acceptance Criteria Verification** (feature H83 scenario titles)

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| R4 — Agent matrix: omp, claude, codex, agy, grok, pi | MET | test | ts-libs shims.test.ts 49 pass (this turn) |
| R5 — Live agent.run streaming without TTY | MET | test | ts-libs process-executor.test.ts 22 pass (pipe mode) |

**Coverage:** N/A for spur-new tree (work is external ts-libs); package tests green as above.

**`--next`:** no-op — already terminal (`done`)
### Review
**Review** — reviewed the ts-libs implementation directly (external-repo task; pipeline review step could not run because requireDiff is spur-new-scoped).

| Severity | Location | Finding | Disposition |
| -------- | -------- | ------- | ----------- |
| P4 | packages/ai-runner/src/agents/shims.ts:353 | Default capability for non-matrix agents (gemini/opencode/…) hardcodes false/false; acceptable conservative degrade, revisit if those agents gain session flags | Closed — documented degrade rule, no action |
| P3 | packages/app/src/workflow/actions/agent-run.ts:256 | requireDiff gate is repo-scoped; external-repo tasks (like this one) are uncertifiable by the standard pipeline — structural limitation | Closed — worked around by direct verify; consider a future pipeline accommodation, out of H83 scope |

No open P1/P2 findings. Implementation matches ADR-047 / the frozen API exactly; tests green (49 shims + 22 runtime). Residual risk: none for the shipped surface.
### References
- Feature: H83
- ADR-047 (supersedes ADR-046)
- Downstream: 0448 (consumer), 0449 (docs), 0450 (dogfood)
- Code roots: `/Users/robin/xprojects/ts-libs` (`ai-runner`, `runtime`)
- Dogfood evidence of host hijack: workflow run log pattern `omp … -c` + host pending `workflow trace --follow`
### History
- 2026-08-05T20:36:04.016Z todo → wip (system)
- 2026-08-05T20:36:23.970Z wip → testing (system)
- 2026-08-05T20:38:51.816Z testing → done (system)
