---
schema_version: 1
name: Extend the ts-ai-runner AgentSessionCapability record with persistentStdin, structuredOutput and verifiedAgainst, verify every agent row, and release
status: done
template: feature-impl
created_at: 2026-09-17T23:19:46.548Z
updated_at: "2026-09-18T04:16:56.836Z"
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
| R1 | MET | static-ref+test — `ts-libs/packages/ai-runner/src/agents/shims.ts:383-392`: `AgentSessionCapability` gains `supportsPersistentStdin`, `supportsStructuredOutput`, `verifiedAgainst`, optional `note`; `supportsResumeById`/`supportsSessionDir` unchanged; accessor `getAgentSessionCapability` (`shims.ts:507-509`) name/semantics intact; tests assert exact record shapes (`tests/agents/shims.test.ts:258-268`) |
| R2 | MET | static-ref+test — all 11 `AgentName` members (`shims.ts:4-16`) have rows in `AGENT_SESSION_CAPABILITY` (`shims.ts:411-506`) with probed `verifiedAgainst` (claude 2.1.274, codex 0.154.0, gemini 0.46.0, pi 0.85.1, omp 18.2.3, opencode 1.17.15, grok 1.0.34, openclaw 2026.6.11, dsh 0.1.5-rc.1); agy/hermes carry `'unverified (CLI not installed)'` — never fabricated versions; every `false` row carries a non-empty `note`; semantics doc `shims.ts:394-410`; matrix suite enforces shape/enum/provenance/false⇒note/no-fabricated-version (`shims.test.ts:531-573`) |
| R3 | MET | static-ref+test — codex row declares `supportsResumeById: true` backed by wired non-interactive resume: `getPromptCommand` emits `['exec','resume',<id>,<input>]` (`shims.ts:134-155`, verified codex-cli 0.154.0); argv lock `sessionIdAndDir: ['exec','resume','abc123','']` (`shims.test.ts:402`); sessionDir-only degrade and bare-`continue`→`resume --last` documented and test-locked (`shims.test.ts:399-404`) — R3 branch 2, no silent degrade |
| R4 | MET | static-ref+test — claude row `supportsResumeById: true`, `supportsSessionDir: false` with output-discovery contract (`shims.ts:435-443`, `README.md:344-347` "Claude session discovery"); `discoverSessionId` confirmed as the existing consumer-side contract in Spur (`packages/app/src/workflow/actions/agent-run.ts:784,862`, tests `app/tests/workflow/actions/agent-run.test.ts:2276`); test asserts the exact claude shape incl. note (`shims.test.ts:269-278`) |
| R5 | MET | test+command — B8 R5 matrix suite iterates `Object.keys(AGENT_SHIMS)` covering shape, boolean enum, non-empty `verifiedAgainst` (`shims.test.ts:531-573`), plus "every bundled agent has a capability entry" (`shims.test.ts:307-311`); driver-run `bun run lint && bun test` in ts-libs ai-runner: biome clean, `tsc --noEmit` clean, **228 pass / 0 fail across 17 files** |
| R6 | MET | static-ref+manual-review — `ts-libs/packages/ai-runner/package.json:3` version `0.4.68`; `CHANGELOG.md:11-14` 0.4.68 release notes name the capability additions and codex resume wiring; Spur root `package.json` dep pin `0.4.68` + `workspaces.catalog` `^0.4.68` (siblings aligned for lockstep dedupe, rationale recorded); `bun.lock:203,407` resolution `@gobing-ai/ts-ai-runner@0.4.68` with `ts-infra`/`ts-runtime` `^0.4.68`; tag/npm publish/CI-run success recorded in task Solution (CI 35295923691) — not independently re-queriable from this surface, accepted as recorded provenance |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `getAgentSessionCapability` resolves a complete record for every `AgentName` (11/11, `shims.ts:411-506` vs `AgentName` union `shims.ts:4-16`); matrix suite + entry test pass in the 228/0 driver run |
| AC2 | MET | test | Codex gap closed (R3 branch 2): non-interactive `exec resume <id> <prompt>` wired and argv-locked; remaining degrades (sessionDir-only, continue-last) explicit, documented, and test-asserted — no silent degrade path |
| AC3 | MET | test | Claude session model declared: resume-by-id true, session-dir false, output-discovered session id documented in runner README and capability row; consumer `discoverSessionId` contract exists and is test-covered |
| AC4 | MET | test | Release recorded and functional: version 0.4.68, changelog entry naming additions, tag + CI run in Solution, Spur `package.json`/`bun.lock` moved to 0.4.68; executable proof via driver-run commands — upstream ai-runner `bun test` 228 pass / 0 fail at 0.4.68 and worktree `bun run spur-check` gate PASS resolving `@gobing-ai/ts-ai-runner@0.4.68` with registry integrity hash (`bun.lock:407`); worktree `git status` clean of unexpected files (exactly `bun.lock`, task doc, `package.json`, `idea-handoff.generated.mjs`) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
| P4 | proof-input-digest | — | sha256:e063192c174758a36745b3d9e735367eae57e5178be984945b0f089c93b112e8 |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-18T01:43:56.070Z todo → wip (system)
- 2026-09-18T03:07:25.444Z wip → testing (system)
- 2026-09-18T04:16:56.836Z testing → done (system)

