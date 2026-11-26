---
schema_version: 1
name: "dsh E2E proof: skill discovery and a real task run record"
status: todo
template: feature-impl
created_at: 2026-11-26T20:35:39.278Z
updated_at: "2026-11-26T21:29:26.085Z"
feature_id: B81
priority: P2
tags:
  - dsh
  - agent
  - e2e

dependencies: ["1457"]
estimate_hours: 3
---

## 1458. dsh E2E proof: skill discovery and a real task run record

### Background

Covers R10, R11. Proves the whole path on a real host: dsh discovers the sp skills Superskill installed, and a Spur task dispatched to the dsh executor completes and leaves a run record. Design: docs/design/dsh-agent-integration.md §4 and §6.

**Refine corrections (2026-11-26)**

- "dsh lists the sp-* skills" → dsh has no skill-listing CLI verb (`dsh --profile headless --help` shows only task/--json/--session-id/--permission-mode/--approval-policy/--add-dir); skills reach the model through the `skill` tool (`vendors/deepseek-harness/packages/skill/tool-skill/src/index.ts:94`) from `<agentsHome>/skills` (`vendors/deepseek-harness/packages/skill/skill-filesystem/README.md:54`) → the proof asks dsh to load one named sp skill and asserts a `tool_call` event for `skill` with that name, followed by a non-error `tool_result`, in the `--json` stream.
- `~/.agents/skills` presence → 91 `sp-*` skills are installed there now (`ls ~/.agents/skills`) → the E2E reads the real root and never writes it.
- Executor id → the executor is `deepseek` (binary `dsh`), per 1457's correction.
- Heavy-test convention → heavy suites are `*.heavy.test.ts` run by `test:heavy` (`package.json` scripts, `bunfig.heavy.toml`), e.g. `apps/cli/tests/workflow/grok-bot-notify-recipe.heavy.test.ts` → the E2E lives at `apps/cli/tests/workflow/dsh-executor-e2e.heavy.test.ts`.
- Sandbox → dsh writes under `$DSH_HOME` (default `~/.dsh`); a sandboxed run cannot write `~/.dsh/profiles/headless` (observed EPERM on 2026-11-26) → run the E2E outside the agent sandbox, or report it unrun.

### Requirements

- [ ] R10. a dsh `--json` run loads a named `sp-*` skill from ~/.agents/skills through the `skill` tool (a `tool_call` + non-error `tool_result` in the stream)
- [ ] R11. one bounded task runs through the `deepseek` executor, exits 0, leaves a Spur run record naming it, and writes a repeatable receipt (dsh version, session id, run id)

### Acceptance Criteria

- [ ] AC1 — sp skills are discovered by dsh
- [ ] AC2 — A real task runs through dsh and leaves a Spur run record

After this passes, decide whether dsh joins a default tier (ADR-153 moves to Accepted).

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-26T20:36:34.278Z

- No mocked dsh. Reason: only a real binary proves the NDJSON contract.
- The model provider comes from the operator's dsh profile. Reason: Spur stores no agent API keys.

#### Q&A entry — 2026-11-26T21:29:20.276Z

#### Q&A entry — 2026-11-26 (refine --depth ready)

- Prove skill discovery with a `skill` tool_call in the `--json` stream, not with model prose. Reason: dsh has no list verb, and prose is non-deterministic.
- Run outside the agent sandbox. Reason: dsh must write `$DSH_HOME` (EPERM observed in the sandbox).

### Design

Approach: one heavy E2E, `apps/cli/tests/workflow/dsh-executor-e2e.heavy.test.ts`, skipped with a stated reason when `dsh` is not on PATH. Case 1 runs `dsh --profile headless --json -` in a temp git project with a prompt to load one named sp skill, and asserts the `skill` tool_call/tool_result pair. Case 2 dispatches one bounded task through `spur agent run` with the `deepseek` executor and asserts exit 0 plus a run record. The receipt goes to `.spur/run/e2e/dsh-executor-receipt.json`. Reason: AGENTS testing policy prefers E2E with a repeatable artifact.
Rejected: mocked dsh, which proves nothing about the real contract; asserting on model prose to show skill discovery, which is non-deterministic.
Invariants: the test never reads dsh credentials; the model provider comes from the operator's dsh profile; ~/.agents/skills is read-only to the test.

### Plan

1. Requires 1457.
2. Write `apps/cli/tests/workflow/dsh-executor-e2e.heavy.test.ts`, modelled on `grok-bot-notify-recipe.heavy.test.ts`, skipping with a stated reason when `dsh` is not on PATH.
3. Skill discovery: in a temp git project, run `dsh --profile headless --json -` asking it to load one named sp skill; assert the `skill` tool_call naming it, a non-error tool_result, and exit 0.
4. Dispatch one bounded task to the `deepseek` executor and assert exit 0 plus a Spur run record that names it.
5. Write the receipt JSON (dsh version, session id, run id) to `.spur/run/e2e/dsh-executor-receipt.json`.
6. Run `bun run test:heavy` outside the agent sandbox, then record the decision on dsh tier membership and ADR-153 acceptance.

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

