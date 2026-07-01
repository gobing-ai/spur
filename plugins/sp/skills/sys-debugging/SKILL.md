---
name: sys-debugging
description: "The systematic debugging protocol — reproduce → isolate → identify root cause → fix → regression test. A disciplined alternative to ad-hoc debugging; teaches the agent to ask the debugger before the LLM, apply the 15-minute escalation rule, and create issue tasks from debugging sessions. Use when hitting a runtime error, test failure, build break, or any unexpected behavior. Triggers on \"debug this\", \"why is this failing\", \"fix this error\", \"what caused this\", \"trace this bug\", \"root cause\"."
license: Apache-2.0
metadata:
  author: spur
  version: "1.0"
  platforms: "claude-code,codex,openclaw,opencode,antigravity"
  category: execution
  interactions:
    - technique
  operations:
    - debug
    - isolate
    - root-cause
    - fix-and-regress
see_also:
  - sp:code-implementation
  - sp:code-testing
---

# sp:sys-debugging — Systematic Debugging Protocol

A disciplined debugging protocol: reproduce → isolate → identify root cause → fix → regression test. This skill teaches the agent to debug methodically rather than flailing with print statements or guessing at fixes.

## The protocol

### Phase 1 — Reproduce

Can you reliably trigger the failure? If not, you don't have a bug — you have a symptom.

1. Capture the exact error message, stack trace, and context (file:line, command, input).
2. Try to reproduce with the same inputs. If it reproduces → proceed to Isolate. If not → document the reproduction gap and treat as intermittent.
3. For flaky failures: run N times (N ≥ 5). Note the failure rate.

**Gate:** reproduction confirmed → proceed. Cannot reproduce → document as `INTERMITTENT` with failure rate and conditions.

### Phase 2 — Isolate

Narrow the failure to the smallest reproducing case.

1. **Binary search the change space.** If the failure appeared after a batch of changes, bisect (`git bisect` or manual half-removal) to find the trigger commit.
2. **Minimize the input.** What's the smallest input that still triggers the failure?
3. **Eliminate dependencies.** Can you reproduce without the database, network, file system, or other external state?

**The debugger-first rule:** Before asking an LLM what's wrong, run the actual debugger or diagnostic tool:
- Bun/TS: `bun --inspect`, `console.trace()`, type-check the failing file
- Go: `dlv`, `go test -v -run <test>`
- Python: `pdb`, `pytest --pdb`, `traceback.print_exc()`

The debugger output is ground truth; the LLM's guess is not. Always prefer diagnostic tool output over inference.

### Phase 3 — Root Cause

Identify the **underlying cause**, not the symptom. The root cause must be expressible as a single sentence with a `file:line` anchor.

- **Not root cause:** "The variable was undefined." (symptom)
- **Root cause:** "`src/auth.ts:42` — `getUser()` returns `null` when the session is expired, but the caller `src/login.ts:18` doesn't handle the null case."

**15-minute escalation rule:** If you've been debugging the same failure for 15 minutes without identifying the root cause, escalate:
1. Document what you've tried (the `## Q&A` section of the task).
2. Widen the search: ask a peer, search the codebase for similar patterns, or create an issue task.
3. Don't loop — 15 minutes of unproductive debugging is a signal that the problem is architectural or requires domain knowledge you don't have.

### Phase 4 — Fix

Apply the minimal fix that addresses the root cause. No drive-by refactors, no "while I'm here" improvements (R3 — surgical changes only).

### Phase 5 — Regression Test

Add a test that fails before the fix and passes after. This proves:
1. The root cause was correctly identified.
2. The fix addresses the root cause.
3. The fix won't be silently reverted.

If the bug cannot be regression-tested (e.g., a race condition, external service failure), document why in the test's `N/A` rationale.

## Creating issue tasks from debugging sessions

When a debugging session reveals a bug that's larger than the current task, create an **issue task** (`spur task create --template issue`):

1. **Background** ← the reproduction steps and error context.
2. **Root Cause** ← the identified underlying cause with `file:line` anchor (if known).
3. **Plan** ← the proposed fix steps.

This turns debugging sessions into executable work items instead of lost context.

## When to use

- A test is failing and you don't know why.
- A runtime error appears in logs or CI.
- You're investigating a flaky test.
- The operator says "debug this", "why is this broken", or "find the root cause."

Do **not** use this skill for:
- Writing new code — that is `sp:code-implementation`.
- Running the test suite — that is `sp:code-testing`.
- Architectural investigation — that is `sp:sys-architecture`.

## References

| Reference | Covers |
|-----------|--------|
| [debugging-protocol.md](references/debugging-protocol.md) | Full protocol with per-phase decision gates, failure-mode signatures, per-language diagnostic commands |

## See also

- **`sp:code-implementation`** — the implement step that follows after root cause is found.
- **`sp:code-testing`** — test runner and coverage measurement for regression tests.
- **`/sp:dev-debug`** — the slash-command entry point for structured debugging.

---

**Template type**: technique
**Purpose**: Structured debugging — a disciplined alternative to ad-hoc error investigation.
