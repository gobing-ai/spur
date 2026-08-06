---
template: meta
schema_version: 1
name: "Pipeline performance optimization: model latency, task size precheck, progress visibility"
description: ""
status: backlog
type: meta
profile: standard
feature_id: null
parent_wbs: null
priority: P2
tags: ["meta"]
dependencies: []
created_at: "2026-08-06T10:54:14.344Z"
updated_at: "2026-08-06T11:57:01.039Z"
---

## 0454. Pipeline performance optimization: model latency, task size precheck, progress visibility

### Background
The 0452 task execution (Residual review cleanup) completed in ~75 minutes — significantly longer than expected. Forensic analysis of the OMP implement agent session (28.4 min, 69 turns, 85 tool calls) and the subsequent inline resume session (~30 min) identified 4 root causes:

1. **Model latency (S0):** The volc/deepseek-v4-flash provider degraded from 4-12s TTFB to 30-55s TTFB after 5 minutes of sustained use
2. **Task oversize (S1):** 9 requirements across 12 files exceeded the single implement pass budget, causing the 30-min pipeline timeout
3. **Pipeline overhead (S2):** `--follow` timeout at 600s required manual reconnection; no progress visibility
4. **Inline resume overhead (S2):** Partial work required manual resume with unintended changes to revert

Three alternative models (omp-zai/zai, codex-luna/gpt-5.6-luna, omp-zai-ollama/ollama) all hit API quota limits, leaving only the slow volc/deepseek-v4 model available.
### Requirements
- [ ] R1. Pipeline implement model optimization — configure the implement step to use the fastest available model with stable TTFB <5s. If no fast model is available (all quotas exhausted), document the fallback and add a pre-pipeline size check.
- [ ] R2. Task size precheck — add a pre-pipeline check that halts if a task has >5 requirements or changes files outside the corpus. Requires explicit confirmation before proceeding with a large task.
- [ ] R3. Pipeline progress visibility — add periodic progress output from the agent.run implement step so the operator can gauge progress without tailing the session log.
- [ ] R4. Partial-work artifact improvement — add a "completed requirements" section to the partial-work artifact that lists which task requirements the agent has finished, reducing resume time.
### Acceptance Criteria
Scenario: R1 — implement model optimization
Given the pipeline implement step
When configured with the fastest available model
Then the step should complete within 15 minutes (vs 30+ previously)

Scenario: R2 — task size precheck
Given a task with >5 requirements
When the pipeline precheck runs
Then it should halt with a warning suggesting decomposition

Scenario: R3 — pipeline progress visibility
Given the implement agent.run step
When it runs for more than 60 seconds
Then it should output periodic progress messages to stderr

Scenario: R4 — partial-work artifact improvement
Given a partial-work artifact is written
When the implement step fails
Then the artifact should include a "completed requirements" section
### Q&A
Q: Why not switch to a faster model for the implement step?
A: Three alternative models were tested (omp-zai/zai, codex-luna/gpt-5.6-luna, omp-zai-ollama/ollama) — all hit API quota limits. The only working model is volc/deepseek-v4-flash, which has 30-55s TTFB after sustained use.

Q: What is the expected time savings from the task size precheck?
A: ~45 minutes per oversized task (30 min implement timeout + 15 min resume overhead). This is the highest-impact fix.

Q: Can the precheck be implemented as a spur rule?
A: Yes. A pre-pipeline size check can be a shell step in the task-pipeline.yaml precheck phase, or a standalone spur rule.

Q: Is the model latency issue fixable without changing the model?
A: Partially. The task size precheck prevents the timeout cascade. The model latency can only be fixed by using a different provider/model with stable TTFB.
### Design

**Evidence from OMP agent session (2026-08-06T03:54-04:23):**
- 69 assistant turns, 28.4 min model duration
- First 5 min: TTFB 4-12s (28 calls)
- Last 23 min: 19 consecutive calls with TTFB >30s (worst: 54.5s at 04:21:40)
- Model: deepseek-v4-flash-ga-260731 @ volc provider
- All 3 alternatives (omp-zai/zai, codex-luna/gpt-5.6-luna, omp-zai-ollama/ollama) hit quota limits

**Fix:** Add pre-pipeline size check to prevent the timeout cascade. Keep volc/deepseek-v4 as default (only working model).


**Evidence:**
- Task 0452 had 9 requirements spanning 12 files
- Agent spent 5 min reading (29 reads, 23 greps) before first edit
- Pipeline timed out at 30 min exactly
- Result: ~45 min wasted (30 min implement timeout + 15 min resume)

**Fix:** Pre-pipeline size check: halt if >5 requirements or >8 files, suggest decomposition.


**Evidence:**
- `--follow` timed out at 600s default
- stderr only showed "Working..." with no progress
- Required manual reconnection

**Fix:** Increase follow timeout; add periodic progress output.


**Evidence:**
- Had to read partial artifact, revert unintended sessionDir `else` block
- 7 remaining requirements implemented manually
- `no-console-output` rule caught agent's `console.warn` calls

**Fix:** Add "completed requirements" section to partial-work artifact.
### Plan
- [ ] R1: Investigate fastest available model for implement step; configure pipeline default
- [ ] R2: Add pre-pipeline size check to task-pipeline.yaml precheck phase
- [ ] R3: Add periodic progress output to agent.run implement step
- [ ] R4: Add "completed requirements" section to partial-work artifact
### Solution

<!-- Filled during implementation: changed files/sections and concise rationale. -->

### Testing

<!-- Filled during verification: commands/checks run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to docs, tasks, decisions, or external references. -->

### History
