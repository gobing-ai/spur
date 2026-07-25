---
name: Implement spur agent run command via ts-ai-runner
description: Implement spur agent run command via ts-ai-runner
status: done
created_at: 2026-06-01T12:00:00.000Z
updated_at: 2026-06-01T12:45:00.000Z
folder: docs/tasks
type: task
feature-id: "F-3 agent-run"
dependencies: []
tags: ["feature", "agent", "cli", "ts-ai-runner"]
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: done
  testing: done
---

## 0004. Implement `spur agent run` command via `@gobing-ai/ts-ai-runner`

### Background

The current `spur agent` command group (`apps/cli/src/commands/agent.ts`) supports only `list` and `doctor` subcommands. The `run` subcommand — dispatching prompts/slash-commands through supported coding agents — is the primary user-facing feature of the agent entity but remains unimplemented (💤 in `docs/05_FEATURES.md`).

The old Spur version (`~/xprojects/spur`) implemented `spur agent run` with Commander, a kernel-owned `AgentService`, and a local `AiRunner`/slash-command translation layer. The new Spur architecture replaces the local kernel with the external `@gobing-ai/ts-ai-runner` package which provides `AiRunner`, `AgentDetector`, and `DoctorRunner` — all already wired for `list` and `doctor` in the current codebase.

This task adds `spur agent run <prompt>` and all necessary supporting logic, leveraging `@gobing-ai/ts-ai-runner` while keeping CLI command files thin wrappers per the architecture decision (ADR D-028 in old Spur).

**Reference implementation:** `~/xprojects/spur/packages/kernel/src/agent/agent-service.ts` (AgentService.runAgent) and `~/xprojects/spur/apps/cli/src/commands/agent.ts` (Commander registration + handler). This task adapts the same logic to the new codebase's simpler arg parser, `CliContext`, and `@gobing-ai/ts-ai-runner` API.

### Requirements

## Requirements

- [x] **R1.1** run subcommand → `runAgentRun` → **MET** | `agent.ts:70`
- [x] **R1.2** prompt = positionals[0], parser limitation documented → **MET** | `agent.ts:128-133`, test `agent.test.ts:119`
- [x] **R1.3** missing prompt → exit 2 `Prompt is required` → **MET** | `agent.ts:156-159`, test `:133`
- [x] **R1.4** help text includes `agent run` → **MET** | `index.ts:100`
- [x] **R1.5** `--json` envelope `{ exitCode, stdout, stderr, signal?, durationMs }` → **MET** | `agent.ts:296-308`, test `:426`
- [x] **R2.1** `--agent auto` first usable Tier-1, else exit 1 → **MET** | `agent.ts:252-260`, tests `:167,:218`
- [x] **R2.2** `--agent current` reads SPUR_AGENT, unset → exit 2, validates name → **MET** | `agent.ts:262-268`, tests `:246,:275`
- [x] **R2.3** `--agent <name>` isAgentName, invalid → exit 2 → **MET** | `agent.ts:275-277`, test `:145`
- [x] **R2.4** runOne installed check (explicit/current), auto skips redundant probe, DoctorRunner env wired → **MET** | `agent.ts:278-282, 168, 253`
- [x] **R3.1-3.3** PromptOptions + runPromptCommand + cwd passthrough → **MET** | `agent.ts:184-189, 210`
- [x] **R4.1-4.3** `--cwd` existsSync + isDirectory, exit 2 on fail → **MET** | `agent.ts:142-152`, tests `:149,:155`
- [x] **R5.1** `--mode` text|json validation, exit 2 → **MET** | `agent.ts:135-139`, test `:137`
- [x] **R6.1** codex resume+prompt throw → catch → exit 2 → **MET** | `agent.ts:193-205, 211-215`, tests `:652,:691`
- [x] **R6.2** other agents continue resumes → **MET** | `agent.ts:186` (continue passthrough)
- [x] **R7.1-7.4** slash detect + per-agent translation → **MET** | promoted to `@gobing-ai/ts-ai-runner@0.2.5` (`src/slash-command.ts`); Spur imports it at `agent.ts:11,15` and uses it at `agent.ts:157`; no inline copy remains. Translation table + unit tests now live in the owning package.
- [x] **R8.0-8.4** stream/buffered executor, no TTY re-echo, json envelope → **MET** | `agent.ts:161-168, 296-318`, tests `:401-520`
- [x] **R9** exit codes 0/1/2/3 incl. signal → **MET** | `agent.ts:221-227`
- [x] **R10.1** Tier-2 warning, not blocking, suppressed in json → **MET** | `agent.ts:175-177`, tests `:531,:571`
- [x] **R11.1-11.2** diagnostics `⚙️ <agent> v<version>` + command, suppressed in json, version null-safe → **MET** | `agent.ts:191-201`, tests `:700-755`
- [x] **R12.1-12.3** unit tests + DI + slash translation tests → **MET** | 31 tests, all pass
- [x] **R13.1** 04_DESIGN updated → **MET** | `docs/04_DESIGN.md:23`
- [x] **R13.2** 05_FEATURES status ✅ → **MET** | `docs/05_FEATURES.md:42`
- [x] **R13.3** AGENTS.md CLI surface adds `agent run` → **MET** | `AGENTS.md` CLI surface block

**Traceability: 13/13 requirement groups MET. No scope drift. No UNMET / PARTIAL.**


### Out of scope

- `--timeout` flag (can be added later if needed; AiRunner supports it)
- Workflow integration (`agent.run` action — separate feature)
- `--verbose` diagnostic mode
- Legacy `spur run` top-level alias (old Spur had this for backward compat; new Spur doesn't need it)

### Design

#### Architecture

CLI command files remain thin transport wrappers. Core dispatch logic lives in `runAgentRun()` within `apps/cli/src/commands/agent.ts` — acceptable for Phase 1 since the logic is straightforward (arg validation + resolve + dispatch). If complexity grows in Phase 3+ (workflow integration, server endpoint sharing), extract a shared service to `packages/domain`.

```
apps/cli/src/commands/agent.ts
  runAgentCommand(subcommand, context, flags, positionals)
    ├── runAgentList()          — existing
    ├── runAgentDoctor()        — existing
    └── runAgentRun()           — NEW
         ├── validateFlags(flags)           → exit 2 on invalid
         ├── resolveAgent(flags, context)   → AgentName or exit
         │    ├── auto:  DoctorRunner.runAll() → first usable Tier-1 (no further installed check)
         │    ├── current: context.env.SPUR_AGENT → isAgentName() → runOne() installed check
         │    └── explicit: isAgentName() → runOne() installed check
         ├── translateIfSlashCommand(prompt, agent)  → translated prompt
         ├── buildExecutor(json)            → NodeProcessExecutor({ output: json ? buffered : stream(isTTY) })
         ├── emit dispatch diagnostics to stderr   (getAgentShim().getPromptCommand — also validates codex resume)
         ├── new AiRunner({ processExecutor }).runPromptCommand(agent, promptOpts, { cwd })   // try/catch → exit 2 on shim throw
         └── handleOutput(result, { json, streamed })   // streamed ⇒ skip re-echo; json ⇒ envelope; else echo
```

#### Dependencies

```
@gobing-ai/ts-ai-runner                       // all exported today; no upstream change required
  AiRunner.runPromptCommand(agent, promptOptions, runOptions)  // returns AgentRunResult { exitCode: number|null, stdout, stderr, signal?, durationMs }
  AgentDetector.detectOne(agent)              // .version is string|null
  DoctorRunner({ env: context.env })          // construct with env, as runAgentDoctor already does
  DoctorRunner.runAll() / runOne(agent)       // auto resolution + installed check; DoctorResult { agent, installed, version, usable, tier }
  getAgentShim(agent).getPromptCommand(opts)  // command/args for diagnostics + codex-resume validation throw
  isAgentName(), TIER1_PRIORITY, TIER2_AGENTS // resolution + warnings
  AgentName, PromptOptions, AgentRunResult    // types  (PromptOptions: { input?, continue?, model?, mode? })

@gobing-ai/ts-ai-runner (since 0.2.5 — promoted from inline; see R7.4)
  isClaudeStyleSlashCommand(input): boolean   // slash-command detection
  translateSlashCommand(agent, input): string // slash-command translation

@gobing-ai/ts-runtime                          // already a transitive dep via ts-ai-runner
  NodeProcessExecutor({ output })             // inject into AiRunner to enable live streaming (R8.0)
  OutputPolicy                                // { mode: 'stream'; isTTY } | { mode: 'buffered' }

node:fs
  existsSync, statSync                        // --cwd validation

node:tty
  isatty(1)                                   // feeds OutputPolicy.isTTY at executor construction (R8.0)
```

#### Data flow

```
User: spur agent run "Fix the login bug" --agent pi --mode json

  1. parseArgs(argv) → { command: ['agent', 'run'], flags: { agent: 'pi', mode: 'json' }, positionals: ['Fix the login bug'] }
  2. dispatch(['agent', 'run', ...], context) → runAgentCommand('run', context, flags, positionals)
  3. runAgentRun('Fix the login bug', context, flags)
       a. prompt = positionals[0] = 'Fix the login bug'
       b. validateFlags: mode='json' ✓, agent='pi' ✓; CLI --json absent → text-mode envelope
       c. resolveAgent('pi') → isAgentName('pi') ✓ → DoctorRunner.runOne('pi') installed ✓
       d. detectOne('pi').version → '1.2.3'
       e. shim cmd = getAgentShim('pi').getPromptCommand({ input, mode:'json' })
          → { command:'pi', args:['--no-session','-p','Fix the login bug','--mode','json'] }
       f. emit stderr: "⚙️  pi v1.2.3\n   pi --no-session -p Fix the login bug --mode json"
       g. runner = new AiRunner({ processExecutor: NodeProcessExecutor({ output:{ mode:'stream', isTTY: isatty(1) } }) })
       h. runner.runPromptCommand('pi', { input:'Fix the login bug', mode:'json' }, { cwd })
       i. Result: { exitCode: 0, stdout: '{...}', stderr: '', durationMs: 1234 }  // exitCode: number|null
       j. TTY: executor already streamed the agent's JSON output live → do NOT re-echo; return 0
          (--mode json is the AGENT's output format; CLI --json is a separate envelope — not used here)
```

> Note: `--mode json` (agent output format, passed through to the agent CLI) is distinct from the CLI's own `--json` flag (R1.5 envelope `{ exitCode, stdout, stderr, signal?, durationMs }`). They are independent and can combine.

### Plan

1. **Slash-command translation (✅ promoted to ts-ai-runner@0.2.5):**
   - `isClaudeStyleSlashCommand()` + `translateSlashCommand()` live in `@gobing-ai/ts-ai-runner` (`src/slash-command.ts`), re-exported from `index.ts`, released in 0.2.5. Spur imports them; no inline copy.
   - Initially landed inline in `apps/cli/src/commands/agent.ts` (Phase 1), then promoted upstream per the AGENTS.md "enhance the owning package" rule once the API stabilized.
   - No `AiRunner.buildPromptCommand()` needed — diagnostics use the existing `getAgentShim().getPromptCommand()`.

2. **Implement `runAgentRun()` in `apps/cli/src/commands/agent.ts`:**
   - Add `run` case to `runAgentCommand()` switch
   - Implement agent resolution (auto/current/explicit)
   - Implement flag validation (mode, cwd)
   - Wire to `AiRunner.runPromptCommand()`
   - Implement slash-command translation
   - Implement output handling (TTY vs pipe vs JSON)

3. **Update help text:**
   - Add `agent run` entry to `helpText()` in `apps/cli/src/index.ts`

4. **Write tests:**
   - Extend `apps/cli/tests/commands/agent.test.ts`
   - Test all resolution paths, validation, output modes
   - Test slash-command translation

5. **Update docs:**
   - `docs/04_DESIGN.md` — add `spur agent run` entry
   - `docs/05_FEATURES.md` — update status

6. **Gate (per AGENTS.md verification gate):**
   - `bun run lint` clean (Biome + per-workspace `tsc --noEmit`)
   - `bun run test` passes; coverage stays ≥ line 85% / function 90% (no `.skip`)
   - `bun run test-cf` passes (server Workers runtime — unaffected here, but must stay green)
   - `bun run build` succeeds across all workspaces
   - `git status` shows only intentional changes
   - Manual smoke: `bun run apps/cli/src/index.ts agent run "hello" --agent pi` (the `.ts` entry runs under Bun)

### Design decisions

**Why no AgentService in Phase 1?** The old Spur extracted `AgentService` to enable server-side reuse. Current Spur's server has no agent-run endpoint — it's read-only status. When server/client reuse is needed, extract then. The CLI-layer logic is ~100 lines and straightforward to move later.

**Why no `--timeout` flag?** AiRunner supports it. Add when user demand exists. Not blocking MVP.

**Why no `spur run` legacy alias?** Old Spur had this for backward compat from when `spur run` was the only agent command. New Spur never had it — no compat needed.

### Reference implementation (old Spur)

- **Agent resolution + dispatch:** `~/xprojects/spur/packages/kernel/src/agent/agent-service.ts` — `AgentService.runAgent()`
- **CLI wrapper:** `~/xprojects/spur/apps/cli/src/commands/agent.ts` — `agentRunCommand()`, `agentRunActionHandler()`, Commander registration
- **Slash-command translation:** `~/xprojects/spur/packages/kernel/src/ai-runner/slash-command.ts`
- **AiRunner (kernel):** `~/xprojects/spur/packages/kernel/src/ai-runner/ai-runner.ts`
- **Agent shims:** `~/xprojects/spur/packages/kernel/src/ai-runner/agents/shims.ts`

### Current codebase touchpoints

- `apps/cli/src/commands/agent.ts` — primary implementation file (add `run` subcommand)
- `apps/cli/src/index.ts` — dispatch + help text (add `run` to help)
- `apps/cli/src/context.ts` — CliContext (already has `env` for SPUR_AGENT)
- `apps/cli/src/args.ts` — arg parser (supports `--flag value` and `--flag` boolean)
- `apps/cli/src/output.ts` — CommandOutput (write/error), toJson helper
- `apps/cli/tests/commands/agent.test.ts` — test file (extend)
- `docs/04_DESIGN.md` — CLI surface spec (update)
- `docs/05_FEATURES.md` — feature status (update)
- `~/xprojects/ts-libs/packages/ai-runner/src/` — prerequisite: add slash-command.ts

### Risks

| Risk | Mitigation |
|------|-----------|
| `@gobing-ai/ts-ai-runner` missing slash-command translation | **Resolved (R7.4):** promoted to ts-ai-runner@0.2.5 (`src/slash-command.ts`); Spur consumes it by semver. No inline code, no leak. |
| Output streaming vs capture | **Resolved.** Executor uses `stdout: ['inherit','pipe']` when streaming (`ts-runtime/process-executor.ts:105`) — streams live **and** captures. `canStream` requires `!forceBuffered && policy.mode==='stream' && isTTY` (lines 96-99); `runPromptCommand` passes `forceBuffered=false`, so streaming activates iff the CLI injects a `mode:'stream'` executor and stdout is a TTY (R8.0). No double-output if the CLI skips re-echo on the TTY path (R8.1). |
| Executor `OutputPolicy` is construction-time, not per-call | The CLI must pick stream-vs-buffered when building the executor, before it knows `--json`. Resolve `--json` during flag validation, then construct the executor accordingly (buffered for json, stream for text). Single construction helper (R8.4). |
| `runPromptCommand` may throw (codex resume) before returning a result | `getPromptCommand` runs inside `runPromptCommand`; wrap the call in try/catch and map the throw to exit 2 (R6.1). |
| TTY detection (`isatty(1)`) unreliable in Bun | Bun may not set `process.stdout.isTTY`. Use `import { isatty } from 'node:tty'` as fallback. Old Spur used same pattern successfully. |
| `AgentDetector.detectOne()` timeout | Default 5s per agent. Auto resolution runs `DoctorRunner.runAll()` which probes all 7 agents in parallel — acceptable startup latency (≤5s). |

### Artifacts

| Type | Path | Description |
|------|------|-------------|
| Code | `apps/cli/src/commands/agent.ts` | `runAgentRun()` + `run` subcommand dispatch |
| Code | `apps/cli/src/index.ts` | Updated help text |
| Test | `apps/cli/tests/commands/agent.test.ts` | Extended test coverage |
| Docs | `docs/04_DESIGN.md` | CLI surface update |
| Docs | `docs/05_FEATURES.md` | Feature status update |
| Docs | `AGENTS.md` | Add `agent run` to the CLI surface block (R13.3) |
| Follow-up | `~/xprojects/ts-libs/packages/ai-runner/src/slash-command.ts` | Promote inline slash-command helpers to ts-ai-runner (separate task, not blocking) |

### Review

## Review — 2026-06-01

**Status:** 4 findings (0 P1, 0 P2, 2 P3, 2 P4)
**Scope:** task 0004 — `apps/cli/src/commands/agent.ts`, `apps/cli/tests/commands/agent.test.ts`, `apps/cli/src/index.ts`, `docs/04_DESIGN.md`, `docs/05_FEATURES.md`, `AGENTS.md`
**Mode:** verify (Phase 7 SECU + Phase 8 traceability)
**Channel:** inline (--channel current; dogfood rule)
**Gate:** `bun run lint` → pass · `bun run test` → 220 pass / 0 fail · `agent.ts` 94% func / 90% line
**Verdict:** PASS — implementation complete, all 13 requirements MET, no blockers/warnings.

### P1 — Blockers
_None._

### P2 — Warnings
_None._

### P3 — Info
| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| 1 | `isatty(1)` evaluated twice, independently | Correctness | agent.ts:163, agent.ts:313 | The output-policy TTY decision (163) and the re-echo guard (313) call `isatty(1)` separately. They cannot diverge today, but if one path is later wrapped/redirected they could. Compute `const isTTY = isatty(1)` once at the top of `runAgentRun` and thread it into both the `OutputPolicy` and `handleRunOutput`. Low risk; clarity + single-source. |
| 2 | `--model -<value>` misparse path untested | Correctness | args.ts:26; tests | R1.2 documents that a model id starting with `-` (e.g. `--model -o3`) misparses to a boolean flag. No test asserts the documented limitation, so a future parser change could silently "fix" or worsen it unnoticed. Add one test pinning current behavior (or asserting the model flag is dropped) so the limitation is encoded, not just prose. |

### P4 — Suggestions
| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| 3 | `errorExit` context-optional branch is dead | Usability | agent.ts:285-290 | Every caller passes `context`; the `if (context)` guard + the "called without context" comment describe a path that never executes (resolveAgentAuto handles its own output and does not call errorExit). Make `context` required and drop the guard/comment, or remove the helper in favor of inline `context.output.error(...)`. Three call sites — minor. |
| 4 | Empty-string prompt reaches the shim as `-p ''` | Usability | agent.ts:156-159 | `spur agent run ""` passes the R1.3 guard (`'' !== undefined`) and dispatches an empty prompt to the agent. Harmless (shims default `input ?? ''`), but arguably should be rejected like a missing prompt. Decide intentionally: treat empty/whitespace-only as "missing" (exit 2) or document it as allowed. Out of scope to change without product call. |

### Notes
- Slash-command translation table (R7.2) verified against impl (agent.ts:31-47): claude pass-through, codex `$plugin-command`, pi `/skill:plugin-command`, others `/plugin-command`. Correct.
- DI wiring verified against real ts-ai-runner ctors: `AgentDetector({ runner })`, `DoctorRunner({ agentDetector, runner, env })` — the streaming executor is correctly shared so version probes also stream+capture. Good catch by the implementer; not in the task spec but architecturally right.
- R8 streaming (Option B at config level) implemented exactly as specced: buffered for `--json`, stream+isTTY otherwise; no re-echo on TTY (no double-output). No `node:tty` dead branch.
- Codex resume throw (R6.1) correctly caught at the `runPromptCommand` boundary → exit 2; also guarded earlier at the diagnostics `getPromptCommand` call. Both covered by tests.


### Testing

- **Command:** `bun run test` (219 pass, 0 fail across 39 files)
- **Scope:** agent.test.ts extended from 2 to 30 tests covering all R1-R12 paths
- **Coverage:** 99.66% funcs, 99.69% lines (aggregate; well above 85%/90% thresholds)
- **Result:** All tests pass. `bun run lint` clean. `bun run build` succeeds.
- **Evidence:** 30 test cases exercising validation, resolution, slash-command translation,
  output modes (json/buffered), exit codes (0/1/2/3), Tier-2 warnings, codex resume,
  diagnostics, flag propagation
- **Next action:** none — task complete

### References

- Old Spur agent-run task: `~/xprojects/spur/docs/tasks/0126_convert_spur_run_into_spur_agent_run.md`
- Old Spur AgentService: `~/xprojects/spur/packages/kernel/src/agent/agent-service.ts`
- Old Spur CLI agent command: `~/xprojects/spur/apps/cli/src/commands/agent.ts`
- Current ts-ai-runner: `~/xprojects/ts-libs/packages/ai-runner/src/`
- Current `AGENTS.md` → "CLI surface" section (the `spur agent run` line is currently absent — this task adds it)
- Verified API surface: `ts-libs/packages/ai-runner/src/{ai-runner,doctor-runner,agent-detector,index}.ts` and `agents/shims.ts`
