---
name: session-review
description: "Review the active coding-agent session: separate resolved from open issues with evidence, propose bounded improvements. With --fix auto (alias --triage), apply pure-doc / 1–2-line fixes inline and file the rest as tasks; with --fix all, fix every actionable finding inline and file none. Triggers: review this session, wrap-up, triage findings."
license: Apache-2.0
version: 1.2.0
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
| `--fix <none\|auto\|all>` | Remediation after the report. `none`: report-only. `auto`: apply direct fixes (pure docs / one-to-two-line fixes) inline, then file all remaining actionable findings as one or more implement-ready tasks via the CLI-gated corpus surface. `all`: fix every actionable finding inline and file no task. | `none` |
| `--triage` | `--triage` is an alias of `--fix auto`; an explicit `--fix` wins when both are passed. | off |

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
- Derive timing and tokens only from the host transcript measurement (Protocol step 1): the visible
  conversation carries no timestamps or usage, so never estimate them from it. Use non-overlapping
  stages whose durations sum to elapsed time; render a value as `n/a` only when the measurement
  reports `available: false` or omits it.

## Fix modes (`--fix auto|all`)

Report-only stays the default. With `--fix auto` or `--fix all`, run the same
evidence pass, then remediate in three buckets — never skip triage and start fixing from the raw
findings list. Steps 1–4 below are `--fix auto`; `--fix all` differs only as stated after them.

1. **Triage every finding into exactly one bucket:**
   - **Direct fix** — pure documentation work, or a one-to-two-line fix with obvious, local,
     low-risk scope. Read the root cause first; a "one-liner" that needs design or touches a
     shared write path is not direct.
   - **Task** — real, actionable, and not already owned by an existing task. Deferred
     requirements recorded inside their own task files are pointers, not duplicates.
   - **Note** — pre-existing, environmental, or ownerless observations; report only.
2. **Apply direct fixes inline** — smallest surgical diff, project style, and re-verify each
   with the targeted check (lint / test / the exact command that exhibited the issue).
3. **File the Task bucket as one or more tasks** by the shared filing rule in
   [dev-operations.md § 2. review](../spur-dev/references/dev-operations.md#2-review) (Triage
   step 3): one task per cohesive unit one agent can implement and verify in one run, under the
   existing feature that owns the surface (never a new root feature), implement-ready, written
   only through `spur task create --skip-ready` + `spur task update <wbs> --section <s> --from-file`.
   Not one task per finding: each finding keeps its evidence, fix direction, and an AC where
   verifiable. Exclude what direct fixes already resolved — say so in the task Background.
4. **Report** — add a Triage section: applied fixes (path + one-line what + verification) and
   each created task WBS. The Resolved/Open tables keep their evidence rules unchanged.

**`--fix all` (defer nothing).** Triage still runs, but the Task bucket is fixed inline instead of
filed, so the mode creates no task. Fix in dependency order with the same surgical-diff and
per-fix re-verification rule as direct fixes, then run the project gate once at the end. A finding
that needs a design or operator decision is asked through the host question tool, never deferred;
one that still cannot be fixed (failed re-verification, blocked by the environment) stays in Open
issues with its evidence. Notes stay report-only.

## Protocol

1. **Resolve scope.** Review the active session from the operator's initiating request through the
   latest result. Use `[focus]` only to rank relevant material. Measure it with
   `node "$(superskill script path sp session-timeline.mjs)" --group "<ranges>"`: one segment per
   operator prompt, read-only from the host transcript. Run it once without `--group` to list the
   segments, then map them to stages (`"1-3,4,5-6"`). It splits each segment into `work` and
   operator `wait` (idle before the next prompt plus AskUserQuestion answer time) and counts tokens
   once per message id.
2. **Inventory outcomes.** List requested outcomes and classify each as completed, partial, blocked,
   or not attempted. Collapse repeated attempts into one outcome.
3. **Classify issues.** For every material issue, distinguish resolved, open, or attempted. Record
   root cause only when the evidence boundary supports it.
4. **Select improvements.** Keep at most three changes that would prevent meaningful recurrence.
   Apply the placement rule in
   [the environment-improvement mapping](../../references/environment-lens.md): automate with a
   check when possible, place coding standards on the review path, and keep always-loaded steering
   as navigation pointers. When the session drove a task pipeline, at most three bounded
   diagnostic questions may be drawn from the supported observations (F1/F2) and measured
   overhead candidates (F3/F4) in the 0912 workflow baseline
   (`docs/reports/i31/0912-workflow-baseline.md`) — e.g. repeated gate runs (F4), full-loss
   test-fix timeouts (F3), or unemitted/non-terminal run rows (F1/F2) — each citing its artifact
   anchor and owner handoff (driver adoption D62, row-closure defect P). Areas the baseline marks
   INSUFFICIENT_EVIDENCE (token/USD, percentages, fleet) stay excluded; record the limitation
   instead of a performance conclusion.
5. **Render the report.** Use the exact compact output contract below. Omit empty table rows, not
   headings; write `None observed` when a section has no supported entry.

## Output contract

### Outcome

State the overall result in one to three sentences, including partial or blocked scope.

### Time breakdown

Summarize elapsed time and, when supported by evidence, productive work, avoidable setup/recovery,
and operator wait time. Then render non-overlapping stages:

| Stage | Time | Wait | Tool calls | Token | Assessment |
| --- | ---: | ---: | ---: | ---: | --- |

Format durations as `M:SS` below one hour and `H:MM:SS` at one hour or above (`1:44`, not `1m44s`;
`0:33`, not `33s`). Include a `Total` row when elapsed time is available. Keep operator approval
waits separate from execution bottlenecks. Time is the stage `work` and Wait its operator `wait`.
Token renders `<total> / <non-cached>` in compact units (`28.7M / 717k`) — the measurement's
`token` field: total = input + cache creation + cache read + output; non-cached = total minus cache
read (fresh input, cache writes and output). These are measured session counts, not the 0912 baseline token/USD claims that
step 4 excludes. Use `n/a` for any value not supported by the measurement.

### Resolved issues

| Issue | Root cause | Resolution | Evidence | Confidence |
| --- | --- | --- | --- | --- |

Evidence names the tool result, verification command, or concrete repository state visible in the
session. Do not list ordinary implementation steps as issues. **Confidence** is `HIGH`, `MEDIUM`, or
`LOW` for that row's claim, with its grounds in the cell (a level without grounds is not
verification); any API/library statement in a row cites the installed source as `path:line` or a URL,
and a claim the session could not ground is written `LOW` with the missing evidence named.

### Open issues and risks

| Issue or risk | State | Evidence or confirmation needed | Confidence |
| --- | --- | --- | --- |

### Process and environment improvements

For each supported proposal, name its owner surface, expected impact, verification method, and
reversibility. Proposals remain report-only: apply no change and create no task. A pipeline
observation adopted from the 0912 workflow baseline cites its anchor
(`docs/reports/i31/0912-workflow-baseline.md`) and owner handoff, and carries no unsupported
performance claim.

### Triage (only with `--fix auto|all`)

| Applied fix / created task | Bucket | What + verification |
| --- | --- | --- |

One row per applied fix and one per created task (with its WBS; `--fix all` has none). Omit the
section entirely under `--fix none`.

### Next actions

List only actions needed to finish partial scope, confirm a hypothesis, or preserve a demonstrated
improvement. Use `None` when the session is complete and no follow-up is justified.

## Boundaries

- Stay in the active host session. Do not delegate; a fresh context loses the evidence being reviewed.
- Do not launch a workflow, import history, append indexed-context memory, perform baseline
  comparison or recurrence classification, or emit a twelve-section forensic report; those belong
  to imported-history analysis.
- Report-only by default: do not create or update corpus items or edit files. The single exception
  is `--fix auto|all`: `auto` permits exactly two mutation classes — direct fixes from the triage
  bucket, and the triage tasks; `all` permits one — inline fixes of actionable findings. Anything
  beyond that stays a proposal.
- Do not turn a single low-impact observation into a new policy. Report it as a candidate until it
  recurs or demonstrates a high-impact contract violation.

## Platform notes

On platforms without slash commands, invoke this skill directly before ending the active session.
