---
name: session-review
description: "Review the active coding-agent session: separate resolved from open issues with evidence, propose bounded improvements. With --triage, apply pure-doc / 1–2-line fixes inline and file the rest as one task. Triggers: review this session, wrap-up, triage findings."
license: Apache-2.0
version: 1.1.0
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
| `--triage` | Opt into bounded remediation after the report: apply direct fixes (pure docs / one-to-two-line fixes) inline, then file all remaining actionable findings as exactly one new task via the CLI-gated corpus surface. | off (report-only) |

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

## Triage mode (`--triage`)

Report-only stays the default. With `--triage`, run the same evidence pass, then remediate in
three buckets — never skip triage and start fixing from the raw findings list.

1. **Triage every finding into exactly one bucket:**
   - **Direct fix** — pure documentation work, or a one-to-two-line fix with obvious, local,
     low-risk scope. Read the root cause first; a "one-liner" that needs design or touches a
     shared write path is not direct.
   - **Task** — real, actionable, and not already owned by an existing task. Deferred
     requirements recorded inside their own task files are pointers, not duplicates.
   - **Note** — pre-existing, environmental, or ownerless observations; report only.
2. **Apply direct fixes inline** — smallest surgical diff, project style, and re-verify each
   with the targeted check (lint / test / the exact command that exhibited the issue).
3. **Create exactly one task** for the Task bucket through the CLI-gated corpus surface
   (`spur task create`, then `spur task update <wbs> --section <s> --from-file` per section).
   One task, not one per finding: each finding keeps its evidence, a suggested fix direction,
   and an AC where verifiable. Exclude what direct fixes already resolved — say so in the task
   Background instead.
4. **Report** — add a Triage section: applied fixes (path + one-line what + verification) and
   the created task WBS. The Resolved/Open tables keep their evidence rules unchanged.

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

### Triage (only when `--triage` was passed)

| Applied fix / created task | Bucket | What + verification |
| --- | --- | --- |

One row per applied fix and one per created task (with its WBS). Omit the section entirely when
`--triage` was not passed.

### Next actions

List only actions needed to finish partial scope, confirm a hypothesis, or preserve a demonstrated
improvement. Use `None` when the session is complete and no follow-up is justified.

## Boundaries

- Stay in the active host session. Do not delegate; a fresh context loses the evidence being reviewed.
- Do not launch a workflow, import history, append indexed-context memory, perform baseline
  comparison or recurrence classification, or emit a twelve-section forensic report; those belong
  to imported-history analysis.
- Report-only by default: do not create or update corpus items or edit files. The single exception
  is `--triage` mode, which permits exactly two mutation classes — direct fixes from the triage
  bucket, and the one triage task. Anything beyond that stays a proposal.
- Do not turn a single low-impact observation into a new policy. Report it as a candidate until it
  recurs or demonstrates a high-impact contract violation.

## Platform notes

On platforms without slash commands, invoke this skill directly before ending the active session.
