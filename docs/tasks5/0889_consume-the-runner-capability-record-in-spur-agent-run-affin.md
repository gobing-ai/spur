---
schema_version: 1
name: "Consume the runner capability record in Spur: agent-run affinity branches, doctor --json capabilities, requiresCapabilities attestation and stale-declaration warning"
status: todo
template: feature-impl
created_at: 2026-09-17T23:19:46.552Z
updated_at: "2026-09-17T23:22:19.292Z"
feature_id: B8
priority: P1
tags:
  - agent-run
  - doctor
  - capabilities
  - B8
estimate_hours: 6

dependencies: ["0888"]
---

## 0889. Consume the runner capability record in Spur: agent-run affinity branches, doctor --json capabilities, requiresCapabilities attestation and stale-declaration warning

### Background

With task 1 the runner declares per-agent session/stdin capabilities. Spur's `packages/app/src/workflow/actions/agent-run.ts` still branches on agent names and only reads the two legacy capability fields; `spur agent doctor --json` does not expose capabilities; `requiresCapabilities` attestation (task 0706) knows only the legacy fields. Authority: `docs/design/session-pinned-dispatch.md` §5 (Spur consumers paragraph), ADR-118 contract-violation outcome.

### Requirements

- [ ] R1. `agent-run.ts` derives every resume/session-dir decision from `getAgentSessionCapability(agent)`; no agent-name conditional remains on the affinity path (verified by `rg` in the task's Solution).
- [ ] R2. When `supportsResumeById` is `false` the action emits no `--resume`/`--session-id` style flag and records `session: fresh` in the action result.
- [ ] R3. `spur agent doctor --json` includes a `capabilities` object per executor with the four booleans and `verifiedAgainst`; the table renders a compact capability column.
- [ ] R4. `requiresCapabilities` accepts `resumeById`, `sessionDir`, `persistentStdin`, `structuredOutput`; an unmet requirement yields the ADR-118 contract-violation outcome before any subprocess spawn, naming the executor and the missing capability.
- [ ] R5. Doctor emits one warning per executor when the detected CLI version differs from the record's `verifiedAgainst` (`capability-declaration-stale`), in both table and JSON output.
- [ ] R6. Tests in `packages/app/tests/workflow/actions/` and `apps/cli/tests/commands/` cover R2, R4 and R5 with a stubbed capability record; `bun run spur-check` passes.

### Acceptance Criteria

Covers feature B8 scenarios R2, R3, R6, R7.

- [ ] AC1 — Spur affinity logic consumes the record instead of agent names (req: R1)
- [ ] AC2 — Doctor exposes capabilities per executor (req: R3)
- [ ] AC3 — A stage can require a capability before spawn (req: R4)
- [ ] AC4 — A stale capability declaration is surfaced (req: R5)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Decision: Spur reads, never re-declares (docs/design/session-pinned-dispatch.md §5). The stale warning compares two strings (`doctor` detection vs `verifiedAgainst`) — no semver parsing, because agent CLIs do not all use semver and a mismatch of any kind is worth a warning. Attestation stays where it is (`parseRequiresCapabilities`), extended by two enum members, so the ADR-118 outcome path is reused unchanged. Mutation policy: `packages/app/src/workflow/actions/agent-run.ts`, `packages/app/src/services/agent-service.ts` (doctor), `apps/cli` doctor rendering, tests, and the `plugins/sp/skills/spur-cli/references/agent.md` doctor row; no runner changes (task 1), no run-scoped pin changes (feature B7).

### Plan

1. Read design §5 and the current affinity block in `agent-run.ts` (lines ~215–340) plus `parseRequiresCapabilities`.
2. Replace name-based branches with capability reads; add the `session: fresh` result field for non-resume executors.
3. Extend `requiresCapabilities` parsing and the pre-spawn attestation; add tests for the contract-violation outcome.
4. Add `capabilities` to doctor JSON + table and the stale-declaration warning; update the spur-cli `agent.md` doctor rows.
5. Run workspace tests then `bun run spur-check`.
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
