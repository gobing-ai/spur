---
schema_version: 1
id: "H83"
name: "Run-scoped agent session affinity, live agent streaming, unified --agent inline"
status: backlog
priority: P1
tags: []
created_at: "2026-08-05T18:59:07.219Z"
updated_at: "2026-08-05T19:24:56.271Z"
---

# H83: Run-scoped agent session affinity, live agent streaming, unified --agent inline

## Goal
Close three related defects in workflow-driven agent execution: (1) pipeline stages must not hijack the host coding-agent session via bare continue/last-session resume; (2) a single workflow `runId` must pin a durable coding-agent session for token/time savings across `agent.run` hops; (3) `agent.run` must stream stdout/stderr live into the run log without giving the child a TTY; and (4) `--agent inline` must mean one thing everywhere (host in interactive slash; `agent.default` + run-scoped session in workflow), superseding ADR-046's "inline unrepresentable" dual-legacy.

Dogfood default: session affinity **on**. Operators can disable after several dogfood rounds. Agent matrix for affinity/resume: **omp, claude (Claude Code), codex, agy (antigravity-cli), grok, pi**. ts-libs (`@gobing-ai/ts-ai-runner`, `@gobing-ai/ts-runtime` as needed) may be extended under `/Users/robin/xprojects/ts-libs` with monorepo `bun link` during development.
## Scope
### In scope

- ADR-047 superseding ADR-046: unified `--agent` semantics; run-scoped session affinity default-on; non-interactive **pipe** streaming (no TTY); Phase D (true host-stage control inversion) explicitly deferred.
- `PromptOptions` / shim extensions for session id + session dir (or agent-equivalent isolation) for omp, pi, claude, codex, agy, grok; capability matrix with safe degrade.
- Pipeline latch: never bare global `-c` / resume-last against the host session store; use run-scoped `--session-dir` (or equivalent) + resume-by-id when supported.
- `AgentService.runTraced` live pipe output → `workflow.agent` → `.spur/run/<runId>.log`.
- Unify `inline`: resolve to `agent.default` on `spur agent run` / workflow vars (no exit-2 reject); interactive slash path remains host-session.
- Config knob to turn affinity off after dogfood (default **on**).
- Skill/docs/tests: cross-cutting, flag-glossary, dev-run/plan/runall, observation runbook (`trace --follow --output`, never `| tail`).
- ts-libs changes under `~/xprojects/ts-libs` with temporary `bun link` for unreleased facades.

### Out of scope

- **Phase D** — true in-host execution of pipeline `agent.run` stages / control inversion over HITL (do not implement under this feature; tracked as a deferred meta task only).
- Rewriting tier algorithm or escalation loop (H9 / ADR-033).
- New coding agents beyond omp / claude / codex / agy / grok / pi in the affinity matrix (others degrade to fresh).
- Changing quality-gate commands or task-pipeline stage order.
## Acceptance Criteria
```gherkin
Feature: Run-scoped agent session affinity, live agent streaming, unified --agent inline

  @core
  Scenario: R1 — ADR-047 supersedes ADR-046
    Given the project ADR set
    When ADR-047 is recorded and ADR-046 is marked superseded
    Then one table defines --agent omit|inline|auto|name for interactive and workflow surfaces
    And Phase D host-stage control inversion is listed as deferred non-goal

  @core
  Scenario: R2 — Pipeline never resumes the host session
    Given a host omp (or other matrix agent) is mid-tool while a task-pipeline runs
    When a later agent.run hop enables continue/affinity
    Then the child does not resume the host's global last session
    And host pending tool state does not appear in the stage agent's stderr

  @core
  Scenario: R3 — Run-scoped session affinity default-on
    Given task-pipeline with multiple agent.run hops for the same resolved agent
    When affinity is enabled (default)
    Then the first hop opens a session under .spur/run/<runId>/agent-sessions/<agent>
    And later hops resume that session by id (or isolated last-in-dir only)
    And invocation.sessionId is populated for cost join when discoverable
    And a config or vars knob can disable affinity without a code change

  @core
  Scenario: R4 — Agent matrix: omp, claude, codex, agy, grok, pi
    Given each of omp, claude, codex, agy, grok, pi
    When PromptOptions carry sessionId and/or sessionDir (or agent-equivalent)
    Then the shim maps to the agent CLI's real resume/isolation flags where supported
    And unsupported resume-by-id degrades to isolated-fresh or no-resume without global -c

  @core
  Scenario: R5 — Live agent.run streaming without TTY
    Given a non-interactive agent.run under a workflow
    When the child writes stdout/stderr chunks before exit
    Then workflow.agent output events reach .spur/run/<runId>.log before process exit
    And the child does not inherit a TTY / interactive stdin (R3 non-interactive preserved)

  @core
  Scenario: R6 — Unified --agent inline
    Given --agent inline or omitted --agent on an interactive slash command
    When the execution surface is resolved for that slash command
    Then work stays in the host coding-agent session
    Given --agent inline or omitted --agent on spur agent run or workflow vars.agent
    When the executor is resolved for that headless path
    Then the executor is agent.default (or explicit name/auto) as a subprocess
    And spur agent run no longer exits 2 on the literal inline

  @core
  Scenario: R7 — Docs and tests agree
    Given cross-cutting.md, flag-glossary, dev-run/plan/runall, ADR-047, and plugin contract tests
    When the surface is inspected
    Then there is no dual "inline is default" vs "inline is unrepresentable" split
    And observation guidance prefers workflow trace --follow --output

  @core
  Scenario: R8 — Phase D is held
    Given feature H83 scope
    When implementation is planned
    Then no task implements host-stage control inversion
    And a deferred meta task records Phase D for a future ADR only
```
## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0437 | ADR-047: supersede ADR-046 — unified --agent, run-scoped affinity, pipe streaming, Phase D hold | cancelled |
| 0438 | ts-ai-runner: PromptOptions sessionId/sessionDir + shims for omp/pi/claude/codex/agy/grok | cancelled |
| 0439 | ts-runtime: non-interactive pipe output policy (no TTY) with live onOutput | cancelled |
| 0440 | P0: stop bare global continue — pipeline latch cannot hijack host session | cancelled |
| 0441 | P1: run-scoped session affinity default-on (vars, discovery, config knob) | cancelled |
| 0442 | P2: AgentService.runTraced live pipe streaming into workflow run log | cancelled |
| 0443 | P3: unify --agent inline — remove reject, align docs/tests with ADR-047 | cancelled |
| 0444 | Skill launch hygiene: forward profile/agent vars; observation runbook without tail pipes | cancelled |
| 0445 | H83 dogfood: multi-agent affinity+stream smoke (omp, claude, codex, agy, grok, pi) | cancelled |
| 0446 | Phase D hold: true host-stage control inversion (do not implement) | cancelled |
| 0447 | ts-libs foundation: six-agent session primitives + pipe-no-tty live output | todo |
| 0448 | Spur pipeline agent.run: host-safe affinity default-on + live run log streaming | todo |
| 0449 | Unify --agent inline surface + skill launch/observation hygiene | todo |
| 0450 | H83 dogfood: multi-agent affinity and streaming smoke | todo |
<!-- END AUTO-GENERATED -->

## Notes
**Locked decisions**

1. Agent matrix: omp, claude, codex, agy, grok, pi — ts-libs + bun link.
2. Affinity default-on; config/vars off-switch.
3. Phase D held (0446 cancelled).
4. **ADR-047** Accepted (design) in `docs/00_ADR.md`.

**Implementation-ready task set (2026-08-05)**

| WBS | Deps | Owns |
|-----|------|------|
| **0447** | — | ts-libs: universal `PromptOptions.sessionId/sessionDir` + six-agent shims + pipe-no-TTY (`ts-ai-runner` + `ts-runtime`) |
| **0448** | 0447 | Spur: affinity policy + runTraced streaming (no bare global continue) |
| **0449** | — | Unify `--agent inline` runtime + docs/skills/tests + launch/observation hygiene |
| **0450** | 0448, 0449 | Multi-agent dogfood matrix |

Each task Design freezes APIs, anti-patterns, file targets, and handoffs. Prefer implementing 0447 → 0448; 0449 parallel; 0450 last. Review after implement — do not invent a second shim layer in Spur.
## History
