---
schema_version: 1
name: dsh agent shim in ts-ai-runner with a pinned NDJSON contract
status: done
template: feature-impl
created_at: 2026-11-26T20:35:39.274Z
updated_at: "2026-11-27T06:23:06.974Z"
feature_id: B81
priority: P2
tags:
  - dsh
  - agent
  - ts-libs

estimate_hours: 3
done_forced: "false"
done_reason: unforced close
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

- [x] R1. upgrade the existing `deepseek` shim to `dsh --profile headless [--json] … -- <task>`, with the task as a `--`-pinned positional; Spur never loads dsh plugins
- [x] R2. emit `--json` only for `mode: 'json'`; the shim stays a pure argv builder and parses no events
- [x] R3. success is dsh's exit status (0 only for a completed final turn); a fixture proves exit 0 ⇔ `final.reason.kind === "completed"`
- [x] R4. resume with `--session-id <id>`, repeating the permission flags; the capability row sets `supportsResumeById: true`
- [x] R5. always emit `--permission-mode workspace-write --approval-policy never` (PromptOptions has no permission field); `--add-dir` deferred to 1458 evidence
- [x] R6. availability via `dsh --version`; no credential is read or stored
- [x] R12. replay a recorded `--json` fixture from the pinned dsh version; `verifiedAgainst` names that version

### Acceptance Criteria

- [x] AC1 — The runner builds a dsh headless one-shot command
- [x] AC2 — The dsh shim emits --json only in json mode
- [x] AC3 — Success requires exit zero and a completed final reason
- [x] AC4 — A dsh run resumes by session id
- [x] AC5 — dsh runs carry fixed unattended permission flags
- [x] AC6 — dsh availability is detected without Spur storing credentials
- [x] AC7 — The NDJSON contract is pinned to a dsh version

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

#### Q&A entry — 2026-11-27T06:22:59.877Z

Residual closed (B81 verifyall, 2026-11-27): the `--add-dir <git-common-dir>` deferral's trigger cannot fire in Spur. A dispatched executor never runs `git commit`; worktree commits belong to the batch driver (WT-3b in `plugins/sp/skills/spur-dev/references/execution-worktree.md:381-396`, staged through `spur workflow commit-guard-stage`), and `packages/app/src` has no executor-side commit path. No shim emits a git-common-dir grant for any agent. Decision: no `PromptOptions` grant field and no ts-ai-runner release. Reopen only if an executor is ever made to commit.

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

No Spur-source or ts-libs change was required: the delivered work already exists in the released
`@gobing-ai/ts-ai-runner@0.8.5` (ts-libs commit `26a09d56 feat(ai-runner): upgrade the dsh shim to
the 0.2.x headless contract`, an ancestor of the 0.8.5 release bump `b0612dca`), and the Spur
catalog already pins `0.8.5` (`package.json:32`). The implement step is therefore a certification
pass (`requireDiffAllowCleanCheck`, task 0976) rather than a code change.

| File | Lines | What / why |
| --- | --- | --- |
| `../ts-libs/packages/ai-runner/src/agents/shims.ts` | 426-449 | `dshShim.getPromptCommand` builds `--profile headless [--json] [--session-id <id>] --permission-mode workspace-write --approval-policy never -- <task>` — the 0.2.x headless contract (R1/R2/R4/R5); input is a `--`-pinned positional because `ShimCommand` has no stdin channel |
| `../ts-libs/packages/ai-runner/src/agents/shims.ts` | 647-655 | `deepseek` capability row: `supportsResumeById: true`, `supportsStructuredOutput: true`, `supportsSessionDir: false`, `supportsPersistentStdin: false`, `verifiedAgainst: '0.2.2-rc.1'` (R4/R6/R12) |
| `../ts-libs/packages/ai-runner/src/agents/shims.ts` | 449 | `getAuthCommand: () => null` — dsh has no auth subcommand; no credential is read or stored (R6) |
| `../ts-libs/packages/ai-runner/tests/agents/shims.test.ts` | 530-552 | Replays the recorded `--json` fixtures and asserts `exit 0 ⇔ final.reason.kind === "completed"` (R3/R12) |
| `../ts-libs/packages/ai-runner/tests/agents/shims.test.ts` | 554-633 | argv/capability coverage: one-shot, json-mode gating, resume-with-repeated-permission-flags, fixed grants, version command, capability row |
| `../ts-libs/packages/ai-runner/tests/fixtures/dsh/completed.jsonl` | — | Real `dsh 0.2.2-rc.1` capture, exit 0 (completed final turn) |
| `../ts-libs/packages/ai-runner/tests/fixtures/dsh/not-completed.jsonl` | — | Real `dsh 0.2.2-rc.1` capture, exit 1 (unknown `--session-id`, `error` event, no `final`) |
| `package.json` | 32 | Spur catalog already at `@gobing-ai/ts-ai-runner: 0.8.5`, so the release hop of the task Design is already landed |

Deferred as designed: `--add-dir <git-common-dir>` stays out of the shim until 1458 shows a dsh run
must commit from a worktree (`PromptOptions` carries no grant field).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | @gobing-ai/ts-ai-runner `packages/ai-runner/src/agents/shims.ts` line 433-447 — `getPromptCommand` builds `--profile headless … -- <input>`; installed 0.8.5 dist carries it (`node_modules/@gobing-ai/ts-ai-runner/dist/agents/shims.js`); ts-libs commit 26a09d56 is an ancestor of release b0612dca (git merge-base, 2026-11-26 re-verify) |
| R2 | MET | @gobing-ai/ts-ai-runner `packages/ai-runner/src/agents/shims.ts` line 435 — `--json` only when `mode === 'json'`; no event parsing in the shim |
| R3 | MET | @gobing-ai/ts-ai-runner `packages/ai-runner/tests/agents/shims.test.ts` line 530-552 replays `tests/fixtures/dsh/{completed,not-completed}.jsonl`; `bun test tests/agents/shims.test.ts -t "deepseek\|dsh"` → 11 pass / 0 fail (this run) |
| R4 | MET | @gobing-ai/ts-ai-runner `packages/ai-runner/src/agents/shims.ts` line 440, 445 (`--session-id` + permission flags on every call) and line 647-655 (`supportsResumeById: true`); covered by the same 11-test run |
| R5 | MET | @gobing-ai/ts-ai-runner `packages/ai-runner/src/agents/shims.ts` line 445 — `--permission-mode workspace-write --approval-policy never` unconditional; `--add-dir` deferred per Design |
| R6 | MET | @gobing-ai/ts-ai-runner `packages/ai-runner/src/agents/shims.ts` line 432 (`dsh --version`) and line 449 (`getAuthCommand: () => null`); `dsh --version` → `0.2.2-rc.1` (this run) |
| R12 | MET | @gobing-ai/ts-ai-runner `packages/ai-runner/src/agents/shims.ts` line 652 `verifiedAgainst: '0.2.2-rc.1'` equals installed `dsh --version`; fixtures are real 0.2.2-rc.1 captures (`tests/fixtures/dsh/README.md`); Spur pins 0.8.5 at `package.json:32` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | @gobing-ai/ts-ai-runner `packages/ai-runner/tests/agents/shims.test.ts` line 554-633 — one-shot argv; 11 pass / 0 fail (this run) |
| AC2 | MET | test | @gobing-ai/ts-ai-runner `packages/ai-runner/tests/agents/shims.test.ts` line 554-633 — json-mode gating case; 11 pass / 0 fail |
| AC3 | MET | test | @gobing-ai/ts-ai-runner `packages/ai-runner/tests/agents/shims.test.ts` line 530-552 — exit 0 ⇔ `final.reason.kind === "completed"` over real fixtures |
| AC4 | MET | test | @gobing-ai/ts-ai-runner `packages/ai-runner/tests/agents/shims.test.ts` line 554-633 — resume repeats permission flags; capability row `supportsResumeById: true` |
| AC5 | MET | test | @gobing-ai/ts-ai-runner `packages/ai-runner/tests/agents/shims.test.ts` line 554-633 — fixed grant flags asserted on one-shot and resume |
| AC6 | MET | test | @gobing-ai/ts-ai-runner `packages/ai-runner/tests/agents/shims.test.ts` line 554-633 — version command + null auth command; `dsh --version` → 0.2.2-rc.1 |
| AC7 | MET | test | @gobing-ai/ts-ai-runner `packages/ai-runner/tests/agents/shims.test.ts` line 530-552 — fixture replay pinned to `verifiedAgainst: '0.2.2-rc.1'` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

# Review — task 1456 (dsh shim in ts-ai-runner, pinned NDJSON contract)

Scope note: the deliverable lives in the sibling ts-libs repo (released `@gobing-ai/ts-ai-runner@0.8.5`,
commit `26a09d56`, ancestor of the 0.8.5 release bump `b0612dca`); this task's implement step was a
certification pass with no diff in this repo (`requireDiffAllowCleanCheck`, task 0976). Citations
outside this repo are root-relative with `../`.

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `../ts-libs/packages/ai-runner/src/agents/shims.ts:432-446` builds `--profile headless … -- <task>`; tested by `../ts-libs/packages/ai-runner/tests/agents/shims.test.ts:569` (`getPromptCommand builds the 0.2.x headless one-shot argv (R1)`) and `:576` (task is the last argv element, after `--`) |
| R2 | MET | `../ts-libs/packages/ai-runner/src/agents/shims.ts:434` pushes `--json` only when `mode === 'json'`; `../ts-libs/packages/ai-runner/tests/agents/shims.test.ts:590` (`emits --json only for mode: json (R2)`); the shim returns `{command,args}` and parses no events (`shims.ts:23-28`, `:432-447`) |
| R3 | MET | Exit status is authoritative — no event parsing in the shim; `../ts-libs/packages/ai-runner/tests/agents/shims.test.ts:644` (`a recorded fixture ties exit 0 to a completed final reason (R3)`) replays `../ts-libs/packages/ai-runner/tests/fixtures/dsh/completed.jsonl` (exit 0) and `not-completed.jsonl` (exit 1) |
| R4 | MET | `../ts-libs/packages/ai-runner/src/agents/shims.ts:437-443`: `--session-id <id>` then the repeated permission flags; capability row `:647-655` sets `supportsResumeById: true`; `../ts-libs/packages/ai-runner/tests/agents/shims.test.ts:608` |
| R5 | MET | `../ts-libs/packages/ai-runner/src/agents/shims.ts:443` always emits `--permission-mode workspace-write --approval-policy never` (resume included); asserted by `../ts-libs/packages/ai-runner/tests/agents/shims.test.ts:556` / `:570`; `--add-dir` intentionally deferred (note at `shims.ts:417-424`, Q&A 2026-11-26) |
| R6 | MET | `../ts-libs/packages/ai-runner/src/agents/shims.ts:448` `getAuthCommand: () => null`, version probe `dsh --version` (`shims.ts:431`); `../ts-libs/packages/ai-runner/tests/agents/shims.test.ts:622`; live probe `dsh --version` → `0.2.2-rc.1` |
| R12 | MET | Capability `verifiedAgainst: '0.2.2-rc.1'` (`../ts-libs/packages/ai-runner/src/agents/shims.ts:652`) equals the installed `dsh --version`; fixtures captured from that binary (`../ts-libs/packages/ai-runner/tests/fixtures/dsh/README.md`); `verifiedAgainst` asserted at `../ts-libs/packages/ai-runner/tests/agents/shims.test.ts:628-641` |

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| AC1 | MET | static-ref+test | `../ts-libs/packages/ai-runner/src/agents/shims.ts:432-446`; `../ts-libs/packages/ai-runner/tests/agents/shims.test.ts:569` |
| AC2 | MET | static-ref+test | `../ts-libs/packages/ai-runner/src/agents/shims.ts:434`; `../ts-libs/packages/ai-runner/tests/agents/shims.test.ts:590` |
| AC3 | MET | test | `../ts-libs/packages/ai-runner/tests/agents/shims.test.ts:644` over `../ts-libs/packages/ai-runner/tests/fixtures/dsh/completed.jsonl` + `not-completed.jsonl` |
| AC4 | MET | test | `../ts-libs/packages/ai-runner/tests/agents/shims.test.ts:608`; capability row `../ts-libs/packages/ai-runner/src/agents/shims.ts:647-655` |
| AC5 | MET | test | `../ts-libs/packages/ai-runner/tests/agents/shims.test.ts:556`, `:570`; `../ts-libs/packages/ai-runner/src/agents/shims.ts:443` |
| AC6 | MET | test+command | `../ts-libs/packages/ai-runner/tests/agents/shims.test.ts:622`; `dsh --version` → `0.2.2-rc.1`; `getAuthCommand` null |
| AC7 | MET | static-ref+command | `verifiedAgainst: '0.2.2-rc.1'` (`../ts-libs/packages/ai-runner/src/agents/shims.ts:652`) against installed `dsh 0.2.2-rc.1`; fixture provenance in `../ts-libs/packages/ai-runner/tests/fixtures/dsh/README.md` |

## Findings

| Severity | Finding | Disposition |
| --- | --- | --- |
| P3 | The capability row's `verifiedAgainst` pins `0.2.2-rc.1`, a release candidate; a future dsh GA could shift the headless flag set. | Accepted, as designed: pinning to the installed release is the task's explicit Q&A decision (2026-11-26), and the fixtures record the exact probed binary. |
| P3 | `continue: true` and `sessionDir` silently degrade to a fresh dispatch because dsh has no matching flag. | Accepted and documented in the capability note (`shims.ts:647-655`) and tested at `../ts-libs/packages/ai-runner/tests/agents/shims.test.ts:614-619`; no silent capability claim. |
| P4 | `--add-dir <git-common-dir>` (worktree commits) is not emitted. | Deferred by the task Design until 1458 shows a dsh run must commit from a worktree. |

Gate evidence: `spur task gate 1456` light/full receipt for this tree passed (pipeline `gate` state,
run `9d4987d6`). ts-libs `bun test tests/agents/shims.test.ts` → 80 pass / 0 fail.

Verdict: PASS

**Residual closure (2026-11-27):** the P4 `--add-dir` deferral is closed as not needed — executors never commit; worktree commits are driver-owned (`plugins/sp/skills/spur-dev/references/execution-worktree.md:381-396`). See the Q&A entry of 2026-11-27.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-26T21:03:52.262Z feature_id U → B81 (system)
- 2026-11-27T00:12:58.467Z todo → wip (system)
- 2026-11-27T00:13:44.601Z wip → testing (system)
- 2026-11-27T00:13:46.734Z testing → done (system)

