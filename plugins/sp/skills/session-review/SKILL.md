---
name: session-review
description: "Review the active coding-agent session, distinguish resolved and open issues with evidence, and propose bounded improvements. Triggers: review this session, session wrap-up, immediate retrospective, what happened, what was resolved."
license: Apache-2.0
version: 1.0.0
metadata:
  author: spur
  platforms: "claude-code,codex,openclaw,opencode,antigravity,pi"
  category: analysis-core
  interactions:
    - reviewer
see_also:
  - sp:history-anatomy
  - sp:indexed-context
  - sp:code-verification
---

# sp:session-review — Active Session Review

Review the active coding-agent session while its conversation context is still available. Produce a
compact, evidence-backed report of outcomes, resolved issues, remaining risks, and improvements.

## When to use

Use this skill immediately after focused operations when the operator asks what happened, what was
resolved, or how the session could improve. Use imported-history analysis for ended sessions,
cross-agent windows, recurrence, trends, or quantitative performance forensics.

## Arguments

| Argument | Description | Default |
| --- | --- | --- |
| `[focus]` | Question or operation to emphasize. It changes ordering, not evidence collection. | full active session |

## Evidence boundary

- Treat the active conversation as the primary evidence plane.
- Verify each material claim with source evidence from the conversation or a read-only repository
  check, and cite the exact result or path in the report.
- Use read-only repository checks only when they confirm a material claim; prefer existing tool
  results already visible in the session over rerunning commands.
- Mark an issue **resolved** only when the session shows the symptom, root cause, applied resolution,
  and verification evidence. Otherwise classify it as open or attempted.
- Separate observation from inference. Label an unsupported causal explanation as a hypothesis and
  name the confirmation needed.
- State `not available` when compaction or missing output removed evidence. Never reconstruct it from
  memory or claim a verification that did not run.

## Protocol

1. **Resolve scope.** Review the active session from the operator's initiating request through the
   latest result. Use `[focus]` only to rank relevant material.
2. **Inventory outcomes.** List requested outcomes and classify each as completed, partial, blocked,
   or not attempted. Collapse repeated attempts into one outcome.
3. **Classify issues.** For every material issue, distinguish resolved, open, or attempted. Record
   root cause only when the evidence boundary supports it.
4. **Select improvements.** Keep at most three changes that would prevent meaningful recurrence.
   Apply the placement rule in
   [the environment-improvement mapping](../../references/environment-lens.md): automate with a
   check when possible, place coding standards on the review path, and keep always-loaded steering
   as navigation pointers.
5. **Render the report.** Use the exact compact output contract below. Omit empty table rows, not
   headings; write `None observed` when a section has no supported entry.

## Output contract

### Outcome

State the overall result in one to three sentences, including partial or blocked scope.

### Resolved issues

| Issue | Root cause | Resolution | Evidence |
| --- | --- | --- | --- |

Evidence names the tool result, verification command, or concrete repository state visible in the
session. Do not list ordinary implementation steps as issues.

### Open issues and risks

| Issue or risk | State | Evidence or confirmation needed |
| --- | --- | --- |

### Process and environment improvements

For each supported proposal, name its owner surface, expected impact, verification method, and
reversibility. Proposals remain report-only: apply no change and create no task.

### Next actions

List only actions needed to finish partial scope, confirm a hypothesis, or preserve a demonstrated
improvement. Use `None` when the session is complete and no follow-up is justified.

## Boundaries

- Stay in the active host session. Do not delegate; a fresh context loses the evidence being reviewed.
- Do not launch a workflow, import history, create or update corpus items, or edit files.
- Do not append indexed-context memory.
- Do not perform baseline comparison, recurrence classification, cache publication, or a twelve-section
  forensic report; those belong to imported-history analysis.
- Do not turn a single low-impact observation into a new policy. Report it as a candidate until it
  recurs or demonstrates a high-impact contract violation.

## Platform notes

On platforms without slash commands, invoke this skill directly before ending the active session.
