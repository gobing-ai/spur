---
schema_version: 1
name: dsh agent shim in ts-ai-runner with a pinned NDJSON contract
status: todo
template: feature-impl
created_at: 2026-11-26T20:35:39.274Z
updated_at: "2026-11-26T22:06:02.332Z"
feature_id: B81
priority: P2
tags:
  - dsh
  - agent
  - ts-libs

estimate_hours: 3
---

## 1456. dsh agent shim in ts-ai-runner with a pinned NDJSON contract

### Background

Covers R1, R2, R3, R4, R5, R6, R12. The dsh shim lives in the released `@gobing-ai/ts-ai-runner` facade (ts-libs repo, `packages/ai-runner/src/agents/shims.ts`). Design: docs/design/dsh-agent-integration.md §2, ADR-153.

**Refine corrections (2026-11-26)**

- "Add `dshShim`" → ts-ai-runner 0.8.4 already ships `dshShim` under canonical id `deepseek` (`../ts-libs/packages/ai-runner/src/agents/shims.ts:424`), registered in `AGENT_SHIMS` (:504), `AGENT_SESSION_CAPABILITY` (:634), `TIER1_PRIORITY` (:667) and `DISPLAY_ORDER` (:682), but it is stale: it emits only `['--profile','headless', input]` and its capability row says no resume, verified against 0.1.5-rc.1 → this task upgrades the existing shim to the 0.2.x headless contract; the agent id stays `deepseek` and the binary stays `dsh`.
- "Map NDJSON events to runner events" → shims are pure argv builders (`AgentShim`, shims.ts:104) and no ai-runner code parses agent stdout → the shim emits `--json` only when `mode === 'json'`; it does not parse events.
- "Success = exit 0 AND final.reason.kind === 'completed'" needs an event parser → dsh's exit mapping already encodes it: exit 0 only for a completed final `turn/end`, otherwise exit 1 (`vendors/deepseek-harness/packages/bundle/headless/README.md:134`) → the exit code is authoritative; the fixture test asserts the exit-code/`final.reason` agreement.
- The task positional → a blank positional is a usage error, and a lone `-` is the only stdin marker (headless README:118; `dsh --profile headless --help`) → `ShimCommand` has no stdin channel (`shims.ts:23-28`), so the shim passes the input as the positional after a `--` terminator (the `fmShim` pattern) and never sends it blank.
- Worktree commits → `--add-dir <git-common-dir>` is required for commits from a worktree and must be repeated on resume, along with the permission flags (headless README:87-92) → `PromptOptions` carries no permission or grant field (`shims.ts:31-84`; only `workspace`), and `grokShim` hard-codes its noninteractive grant (`shims.ts:399`) → the shim always emits `--permission-mode workspace-write --approval-policy never` (resume included). `--add-dir` is deferred until 1458 shows that a dsh run must commit from a worktree; a pure shim cannot compute the git common dir.
- Resume → `--session-id` refuses an unknown id or a cwd mismatch with the recorded Session (headless README:77) → resume dispatches from the same workspace; a refused resume exits 1 with an `error` event.

### Requirements

- [ ] R1. upgrade the existing `deepseek` shim to `dsh --profile headless [--json] … -- <task>`, with the task as a `--`-pinned positional; Spur never loads dsh plugins
- [ ] R2. emit `--json` only for `mode: 'json'`; the shim stays a pure argv builder and parses no events
- [ ] R3. success is dsh's exit status (0 only for a completed final turn); a fixture proves exit 0 ⇔ `final.reason.kind === "completed"`
- [ ] R4. resume with `--session-id <id>`, repeating the permission flags; the capability row sets `supportsResumeById: true`
- [ ] R5. always emit `--permission-mode workspace-write --approval-policy never` (PromptOptions has no permission field); `--add-dir` deferred to 1458 evidence
- [ ] R6. availability via `dsh --version`; no credential is read or stored
- [ ] R12. replay a recorded `--json` fixture from the pinned dsh version; `verifiedAgainst` names that version

### Acceptance Criteria

- [ ] AC1 — The runner builds a dsh headless one-shot command
- [ ] AC2 — The dsh shim emits --json only in json mode
- [ ] AC3 — Success requires exit zero and a completed final reason
- [ ] AC4 — A dsh run resumes by session id
- [ ] AC5 — dsh runs carry fixed unattended permission flags
- [ ] AC6 — dsh availability is detected without Spur storing credentials
- [ ] AC7 — The NDJSON contract is pinned to a dsh version

Capture the fixture from a real `dsh --json` run of the pinned version; do not hand-write it.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-26T20:36:32.444Z

- Pin the contract to the installed dsh release (0.2.2-rc.1 at planning time), not the vendored 0.2.3-alpha.2 preview. Reason: the vendored tree announces breaking changes.
- No ACP or SDK JSON-RPC transport. Reason: NDJSON headless already covers one-shot runs and resume (ADR-153).
- Publishing ts-ai-runner needs Robin's explicit authorization. Reason: publishing is an external action.

#### Q&A entry — 2026-11-26T21:29:19.605Z

#### Q&A entry — 2026-11-26 (refine --depth ready)

- Upgrade the existing `deepseek` shim; do not add a second one. Reason: ts-ai-runner 0.8.4 already registers `dshShim` (shims.ts:424, :504).
- No NDJSON event mapper. Reason: no ai-runner consumer parses agent stdout, and dsh's exit code already encodes the completed-turn predicate (headless README:134).
- Fixed permission flags; `--add-dir` deferred until 1458 shows it is needed. Reason: `PromptOptions` has no grant field.
- AC titles AC2/AC5 keep their identity keys; their wording now reads against the corrected R2/R5.

### Design

Approach: edit the existing `dshShim` (`shims.ts:424`) and its `deepseek` row in `AGENT_SESSION_CAPABILITY` (:634); `AGENT_SHIMS`, `TIER1_PRIORITY` and `DISPLAY_ORDER` already list `deepseek` and stay unchanged. `getPromptCommand` builds `['--profile','headless', …mode/session/permission flags, '--', input]`. `ShimCommand` is `{command, args}` only (`shims.ts:23-28`), so stdin is not available; `--` pins dash-leading prompts as the positional, the same as `fmShim`. Capability row: `supportsResumeById: true`, `supportsStructuredOutput: true`, `supportsSessionDir: false`, `supportsPersistentStdin: false`, `verifiedAgainst: '<installed dsh version>'`. Reason: the facade owns every shim, so Spur gets no workaround.
Rejected: a Spur-local dsh spawner (duplicates the runner seam); an NDJSON event mapper in ai-runner (no consumer; the exit code already carries success); the ACP or SDK JSON-RPC transport (out of scope).
Invariants: canonical id `deepseek`, binary `dsh`; the shim parses nothing; `--permission-mode workspace-write --approval-policy never` goes on every call, resume included.
Deferred: `--add-dir <git-common-dir>`. Condition: 1458 shows a dsh run must commit from a worktree; it then needs a `PromptOptions` grant field (a facade API addition).
Release: bump and publish ts-ai-runner, then bump the Spur catalog (`@gobing-ai/ts-ai-runner`, currently 0.8.4). Publishing needs Robin's explicit authorization.

### Plan

1. In ts-libs, read `packages/ai-runner/src/agents/shims.ts` `ShimCommand` (:24), `PromptOptions` (:32) and `dshShim` (:424); read the existing `deepseek shim (task 0066)` tests (`tests/agents/shims.test.ts:536`).
2. Capture real `dsh --profile headless --json` fixtures from the installed dsh (`dsh --version`), one completed and one non-completed run, under `packages/ai-runner/tests/fixtures/dsh/`, with each exit code recorded. dsh writes under `$DSH_HOME`; set `DSH_HOME` to a temp copy if the sandbox blocks `~/.dsh`.
3. Write the failing tests first: argv for one-shot (`--` then the task; check with a real run that dsh accepts `--`), json mode, resume (`--session-id` plus the repeated permission flags) and the fixed permission flags; the capability row; the fixture's exit-code ⇔ `final.reason.kind` agreement.
4. Update `dshShim` and the `deepseek` capability row with `verifiedAgainst` set to the installed version; replace the stale 0.1.5-rc.1 comments.
5. Run the ts-libs gates, then stop at the release: ask Robin to authorize the version bump and publish.
6. After the publish, bump the Spur catalog to the new ts-ai-runner version and run `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-26T21:03:52.262Z feature_id U → B81 (system)

