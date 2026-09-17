---
schema_version: 1
name: Extend the ts-ai-runner AgentSessionCapability record with persistentStdin, structuredOutput and verifiedAgainst, verify every agent row, and release
status: todo
template: feature-impl
created_at: 2026-09-17T23:19:46.548Z
updated_at: "2026-09-17T23:21:16.565Z"
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

Feature B8 makes the runner the single declaration point for per-agent session and stdin capabilities. `@gobing-ai/ts-ai-runner@0.4.67` already exports `AgentSessionCapability {supportsResumeById, supportsSessionDir}` and `getAgentSessionCapability(agent)`; codex resume is interactive-only (`exec resume` picker), gemini resumes `latest` only, claude has no session dir, and nothing records which CLI version a row was checked against. Authority: `docs/design/session-pinned-dispatch.md` §5 (accepted 2026-09-17), ADR-121. Upstream source lives in `/Users/robin/xprojects/ts-libs` (ts-ai-runner package); this task edits upstream and bumps the Spur catalog pin.

### Requirements

- [ ] R1. `AgentSessionCapability` gains `supportsPersistentStdin: boolean`, `supportsStructuredOutput: boolean`, `verifiedAgainst: string` (agent CLI version the row was checked on) and optional `note: string` (the recorded reason for any `false`); the existing two fields and `getAgentSessionCapability(agent)` keep their names and semantics.
- [ ] R2. Every `AgentName` resolves a complete record; each row is verified against the installed CLI (`<agent> --help` / documented flags) and the verification is recorded in `verifiedAgainst`; unverifiable rows are `false` with a `note`, never guessed `true`.
- [ ] R3. The codex row declares `supportsResumeById: false` with a `note` naming `exec resume` as interactive-only, or `true` with a working non-interactive resume command in `getPromptCommand` — one or the other, never a silent degrade.
- [ ] R4. The claude row declares `supportsResumeById: true`, `supportsSessionDir: false`, and the runner documents that the session id is discovered from output (the existing `discoverSessionId` contract).
- [ ] R5. The runner test suite covers the record for every `AgentName` (shape, enum of allowed values, `verifiedAgainst` non-empty) and passes.
- [ ] R6. A new ts-ai-runner version is published; Spur's root `package.json` catalog pin and `bun.lock` move to it; release notes name the capability additions.

### Acceptance Criteria

Covers feature B8 scenarios R1, R4, R5, R8.

- [ ] AC1 — Every agent resolves a capability record (req: R1)
- [ ] AC2 — The codex session gap is closed or declared, never silently degraded (req: R3)
- [ ] AC3 — The claude session model is declared accurately (req: R4)
- [ ] AC4 — The upstream release is recorded (req: R6)

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
