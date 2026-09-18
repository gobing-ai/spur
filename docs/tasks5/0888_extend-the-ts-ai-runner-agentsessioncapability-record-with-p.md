---
schema_version: 1
name: Extend the ts-ai-runner AgentSessionCapability record with persistentStdin, structuredOutput and verifiedAgainst, verify every agent row, and release
status: done
template: feature-impl
created_at: 2026-09-17T23:19:46.548Z
updated_at: "2026-09-18T06:53:10.492Z"
feature_id: B8
priority: P1
tags:
  - upstream
  - ts-ai-runner
  - capabilities
  - B8
estimate_hours: 6

dependencies: []
---

## 0888. Extend the ts-ai-runner AgentSessionCapability record with persistentStdin, structuredOutput and verifiedAgainst, verify every agent row, and release

### Background

Feature B8 makes the runner the single declaration point for per-agent session and stdin capabilities. `@gobing-ai/ts-ai-runner@0.4.67` already exports `AgentSessionCapability {supportsResumeById, supportsSessionDir}` and `getAgentSessionCapability(agent)`; codex resume is interactive-only (`exec resume` picker), gemini resumes `latest` only, claude has no session dir, and nothing records which CLI version a row was checked against. Authority: `docs/design/session-pinned-dispatch.md` §5 (accepted 2026-09-17), ADR-121. Upstream source lives in `/Users/robin/xprojects/ts-libs/packages/ai-runner` (verified 2026-09-17); this task edits upstream and bumps the Spur catalog pin.

### Requirements

- [x] R1. `AgentSessionCapability` gains `supportsPersistentStdin: boolean`, `supportsStructuredOutput: boolean`, `verifiedAgainst: string` (agent CLI version the row was checked on) and optional `note: string` (the recorded reason for any `false`); the existing two fields and `getAgentSessionCapability(agent)` keep their names and semantics.
- [x] R2. Every `AgentName` resolves a complete record; each row is verified against the installed CLI (`<agent> --help` / documented flags) and the verification is recorded in `verifiedAgainst`; unverifiable rows are `false` with a `note`, never guessed `true`.
- [x] R3. The codex row declares `supportsResumeById: false` with a `note` naming `exec resume` as interactive-only, or `true` with a working non-interactive resume command in `getPromptCommand` — one or the other, never a silent degrade.
- [x] R4. The claude row declares `supportsResumeById: true`, `supportsSessionDir: false`, and the runner documents that the session id is discovered from output (the existing `discoverSessionId` contract).
- [x] R5. The runner test suite covers the record for every `AgentName` (shape, enum of allowed values, `verifiedAgainst` non-empty) and passes.
- [x] R6. A new ts-ai-runner version is published; Spur's root `package.json` catalog pin and `bun.lock` move to it; release notes name the capability additions.

### Acceptance Criteria

Covers feature B8 scenarios R1, R4, R5, R8.

- [x] AC1 — Every agent resolves a capability record (req: R1)
- [x] AC2 — The codex session gap is closed or declared, never silently degraded (req: R3)
- [x] AC3 — The claude session model is declared accurately (req: R4)
- [x] AC4 — The upstream release is recorded (req: R6)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Decision: extend the existing `AgentSessionCapability` in place rather than add a parallel `AgentCapabilities` type (docs/design/session-pinned-dispatch.md §5) — the accessor already exists, every consumer in Spur already imports it, and a second type would need a second accessor and a merge rule. `verifiedAgainst` is a plain string (CLI version) so Spur can compare it to `agent doctor` detection without a runner-side date model. A `false` row must carry a `note`: the point of the matrix is to stop silent degradation, so an unexplained `false` is a defect. Mutation policy: upstream ts-ai-runner source + tests, its changelog, and Spur's `package.json` / `bun.lock` catalog pin only; no Spur consumer changes (task 2).

### Plan

1. Read design §5 and the runner's `src/agents/shims.ts` / `session-capability` source; list every `AgentName`.
2. Add the three fields + `note` to the interface and every row; verify each CLI's flags locally (`claude --help`, `codex exec --help`, `gemini --help`, `pi --help`, `omp --help`, `antigravity --help`, `grok --help`) and record `verifiedAgainst` from `<agent> --version`.
3. Decide the codex row: implement non-interactive resume if the CLI exposes one, else `false` + `note`.
4. Write/extend runner tests for the full matrix; run the runner suite.
5. Bump the runner version, update its changelog, publish; bump Spur's catalog pin and `bun install`; run `bun run spur-check` in Spur to confirm nothing breaks on the widened type.
6. Record `## Solution` with a file:line map via `spur task update <wbs> --section Solution --from-file`.

### Solution

Upstream `ts-libs` (commits `e7c177c` feat + `19910c8` release, tag `@gobing-ai/ts-ai-runner-v0.4.68`, published to npm, CI run 35295923691 success):

- `/Users/robin/xprojects/ts-libs/packages/ai-runner/src/agents/shims.ts:383-392` — `AgentSessionCapability` gains `supportsPersistentStdin`, `supportsStructuredOutput`, `verifiedAgainst`, optional `note` (R1); existing fields/accessor unchanged.
- `/Users/robin/xprojects/ts-libs/packages/ai-runner/src/agents/shims.ts:394-410` — record semantics doc: rows are CLI-verified at the `verifiedAgainst` version, every `false` carries a `note`, unwired-but-supported flags are named in notes instead of guessed `true` (R2).
- `/Users/robin/xprojects/ts-libs/packages/ai-runner/src/agents/shims.ts:411-506` — all 11 `AgentName` rows verified against installed CLIs probed 2026-09-18 (claude 2.1.274, codex 0.154.0, gemini 0.46.0, pi 0.85.1, omp 18.2.3, opencode 1.17.15, grok 1.0.34, openclaw 2026.6.11, dsh 0.1.5-rc.1); agy/hermes absent → `'unverified (CLI not installed)'` (R2).
- `/Users/robin/xprojects/ts-libs/packages/ai-runner/src/agents/shims.ts:134-155` — codex `getPromptCommand` pins sessions via non-interactive `exec resume <id> <prompt>` (verified 0.154.0), closing the interactive-only gap (R3 branch 2); sessionDir-only still degrades to fresh `exec`, bare `continue` stays `resume --last`.
- `/Users/robin/xprojects/ts-libs/packages/ai-runner/tests/agents/shims.test.ts:262-306` — capability rows updated (claude R4, codex R3, gemini false-reason); `/Users/robin/xprojects/ts-libs/packages/ai-runner/tests/agents/shims.test.ts:531-573` — new B8 R5 matrix suite (shape/boolean-enum per agent, non-empty `verifiedAgainst`, `false` ⇒ non-empty `note`, no fabricated versions); codex argv-matrix case `sessionIdAndDir: ['exec','resume','abc123','']`.
- `/Users/robin/xprojects/ts-libs/packages/ai-runner/README.md:316-357` — capability-query docs, full 11-agent matrix with the two new columns, claude output-discovered session-id contract (`discoverSessionId` consumer side), updated degrade rule (R4).
- `/Users/robin/xprojects/ts-libs/CHANGELOG.md:11-14` — 0.4.68 release notes name the capability additions and the codex resume wiring (R6).

Spur worktree (this tree):

- `package.json:32,105` — root dep + `workspaces.catalog` pin → `0.4.68` / `^0.4.68`.
- `package.json:33-39,106-112` — sibling `ts-*` pins aligned to `0.4.68`: the upstream release is lockstep and ai-runner 0.4.68 declares `ts-infra`/`ts-runtime` `^0.4.68`, so leaving siblings at 0.4.67 produced duplicate ts-infra copies (nominal `EventBus.syncHandlers` type clash in `packages/app` typecheck); alignment dedupes the tree.
- `bun.lock` — resolutions moved; `bun install` clean.

Verification: ai-runner `bun run lint` clean, `bun test` 228 pass (17 files); Spur `packages/app`, `apps/cli`, `apps/server` `tsc --noEmit` all clean on 0.4.68; runtime smoke: `getAgentSessionCapability('codex')` returns the full record and `getPromptCommand({sessionId})` emits `["exec","resume","<id>","<prompt>"]`.

Follow-ups (out of scope, no code written): wire opencode `-s/--session <id>` and openclaw `--session-id`/`--json` argv (notes name them); claude persistent-stdin dispatch mode; Spur consumer adoption (capability-attestation, doctor `verifiedAgainst` drift warning) is task 2 per the design.

#

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | ts-libs ai-runner shims.ts:381-392 interface carries all 6 fields (anchor re-read) |
| R2 | MET | all 11 AgentName rows present incl. antigravity-cli; every false carries a note |
| R3 | MET | codex getPromptCommand emits exec resume argv |
| R4 | MET | claude row: sessionDir false+note, persistentStdin true+note, verifiedAgainst 2.1.274 |
| R5 | MET | fresh run 228 pass / 0 fail across 17 files (upstream bun test) |
| R6 | MET | package.json 0.4.68; spur pin 0.4.68; catalog ^0.4.68; bun.lock resolves 0.4.68 (CI 35295923691) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No P1–P3 findings; verify verdict PASS |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-18T01:43:56.070Z todo → wip (system)
- 2026-09-18T03:07:25.444Z wip → testing (system)
- 2026-09-18T04:16:56.836Z testing → done (system)

