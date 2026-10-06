---
kind: design
title: "Active session review"
status: implemented
created_at: 2026-08-27
updated_at: 2026-10-06
related: ["0913"]
tags: [system, plugin]
doc: design/session-review
owns: SURFACE — active-session review command, evidence boundary, and compact report contract
authority: derived
---

# Active session review

**Area:** `/sp:dev-review-session` and `sp:session-review`.
**Status:** built (ADR-089; triage exception clarified 2026-09-22, task 0913).

## Operator surface

```text
/sp:dev-review-session [<focus>] [--fix <none|auto|all>] [--triage]
```

`--fix` defaults to `none` (report-only); `--triage` is an alias of `--fix auto`, and an explicit
`--fix` wins when both are passed.

`focus` changes ordering only. The command runs in the active host session and delegates once to
`sp:session-review`; it exposes no `--agent` selector because subprocess or subagent execution would
discard the evidence plane being reviewed.

## Ownership

| Surface | Owns | Excludes |
| --- | --- | --- |
| `/sp:dev-review-session` | Discoverability, optional focus, one inline skill invocation | Review logic, history import, persistence |
| `sp:session-review` | Evidence rules, issue-state classification, compact report contract | Workflow launch, delegation, mutation |
| `sp:history-anatomy` / `/sp:dev-find-issue` | Imported-history daily/ad-hoc forensics | Active-conversation review |
| `wrapup-pipeline.yaml` / `/sp:dev-wrap` | Task lifecycle wrap-up | Arbitrary session review |

## Evidence and report contract

The active conversation is the primary evidence plane. Read-only repository checks may confirm a
material claim; existing session results are reused before rerunning a command. `resolved` requires
symptom, root cause, applied resolution, and verification evidence. Missing evidence renders `not
available`; unsupported causality is a hypothesis with a confirmation path.

The report has six sections in order: Outcome; Time breakdown; Resolved issues; Open issues and
risks; Process and environment improvements; Next actions. The time breakdown uses non-overlapping
stages measured from the host transcript by the read-only `plugins/sp/scripts/session-timeline.ts`
(the visible conversation carries no timestamps or token usage): per stage, work time, operator wait,
tool calls and tokens (total / non-cached, where non-cached excludes cache reads; deduplicated by
message id). The sibling `plugins/sp/scripts/run-summary.ts` reuses the same measurement (`plugins/sp/lib/transcript.ts`)
for the `/sp:dev-run` / `/sp:dev-runall` execution summary, windowed by workflow progress attempts. Durations render
as `M:SS` below one hour and `H:MM:SS` at one hour or above; unavailable measurements render `n/a`.
Operator waits remain separate from execution bottlenecks. Improvements use the shared
environment-improvement placement rule and remain proposals only.

## Boundaries

- No workflow YAML, subprocess, subagent, history import, baseline, cache, or atomic publication.
- Report-only by default: no source/doc edit, no corpus task creation, and no indexed-context
  append, except the explicit bounded `--fix` exception (shipped as `--triage`, documented here
  since task 0913). `--fix auto` permits exactly two mutation classes — pure-doc / one-to-two-line direct fixes
  applied inline with re-verification, and one or more implement-ready triage tasks created
  through the CLI-gated corpus surface (one per cohesive unit, under existing features; the filing
  rule is shared with `/sp:dev-review --triage`, `plugins/sp/skills/spur-dev/references/dev-operations.md`
  § 2. review). `--fix all` defers nothing and permits one class — every actionable finding fixed
  inline with re-verification, no task filed; decisions are asked, not deferred. Anything else
  stays a proposal.
- No recurrence or trend claim from one session.
- Ended sessions, cross-agent windows, and quantitative forensics route to history-anatomy.
