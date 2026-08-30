---
doc: design/session-review
owns: SURFACE — active-session review command, evidence boundary, and compact report contract
authority: derived
updated_at: 2026-08-27
---

# Active session review

**Area:** `/sp:dev-review-session` and `sp:session-review`.
**Status:** built (ADR-089).

## Operator surface

```text
/sp:dev-review-session [<focus>]
```

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
stages derived only from visible active-session timestamps and tool-call records. Durations render
as `M:SS` below one hour and `H:MM:SS` at one hour or above; unavailable measurements render `n/a`.
Operator waits remain separate from execution bottlenecks. Improvements use the shared
environment-improvement placement rule and remain proposals only.

## Boundaries

- No workflow YAML, subprocess, subagent, history import, baseline, cache, or atomic publication.
- No source/doc edit, corpus task creation, or indexed-context append.
- No recurrence or trend claim from one session.
- Ended sessions, cross-agent windows, and quantitative forensics route to history-anatomy.
