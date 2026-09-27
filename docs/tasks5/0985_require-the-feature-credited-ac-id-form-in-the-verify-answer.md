---
schema_version: 1
name: Require the feature-credited AC id form in the verify-answer lint
status: cancelled
template: feature-impl
created_at: 2026-09-27T07:21:48.389Z
updated_at: "2026-09-27T16:29:52.303Z"
feature_id: F91

ac_altitude: task-local
---

## 0985. Require the feature-credited AC id form in the verify-answer lint

### Background

Found during `/sp-dev-run 0966 … --worktree` at the feature close-out.

**Symptom.** `feature sync F41` denied the feature's `verifying → done` transition with five
`L4.scenario-unverified` errors plus `L4.verdict-rows-match-no-scenario`, for a task whose verdict was
PASS and whose five AC rows were each MET with executable evidence.

**Root cause.** Two consumers accept different AC-id sets. `verify-answer-lint.ts:391` resolves a bare
checklist ordinal (`/^AC-(\d+)$/i`) — and, before that, `byTitle` resolves it against the task's AC
checklist label — so `AC1` is accepted. `feature-check.ts:1266` builds the scenario alias as
`AC-${i + 1}` (hyphenated) and `rowMatchesScenario` (`feature-check.ts:1206`) matches only the
normalized scenario title or that alias. A row keyed `AC1` therefore lints clean, derives a PASS
verdict, and credits no scenario.

**Reproduction (deterministic).**

```bash
sed 's/| AC-\([0-9]\) |/| AC\1 |/' .spur/run/0966-verify-answer.txt > /tmp/ac1-form.txt
bun plugins/sp/scripts/verify-answer-lint.ts 0966 --answer /tmp/ac1-form.txt --spur-bin "$spurBin"
# verify-answer-lint: PASS — 5 requirement row(s), 5 AC row(s), verdict PASS
```

**Cost observed.** Lint PASS → `task verdict` → residual sweep PASS → proof binding → then the feature
gate denied, forcing an answer-file key normalization, a verdict re-derivation, a proof-binding
re-apply, a residual re-fold and a repeated feature sync.

The answer-contract reference now states the narrower credited form
(`plugins/sp/skills/code-verification/references/verdict-schema.md`, "Feature-credited AC ids are
narrower than the lint's accepted set") — this task makes the lint enforce it instead of only
documenting it.

AC altitude: task-local. This cancelled regression task does not add feature F91 ship criteria; 0958 owns the feature-crediting change.

### Requirements

- [x] R1. Superseded by task 0958; no independent work remains.

### Acceptance Criteria

- [x] AC1 — Superseded by task 0958 (req: R1)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

The lint already resolves an AC id to a canonical task AC identity (`resolveAcIdentity`,
`verify-answer-lint.ts:386`). The missing step is a second question about the SAME id: would the
feature L4 layer credit it? Today that lives only in `feature-check.rowMatchesScenario`.

Share the rule instead of copying it: expose the scenario-alias derivation (normalized title,
`AC-N`, `Scenario:`/bracket-tag stripping) from the feature-check surface as one exported helper and
call it from the lint for every AC row when the task declares a `feature_id`. Keep the existing
`byTitle` resolution as the identity check — the new check is additive and reports its own code, so
today's accepted-but-uncredited case becomes visible at the earliest gate rather than at the feature
transition.

Fail-soft vs fail-closed: the task is `done` only through the verdict gate, and the feature credit is
a separate gate. Report the uncredited form as an error for a linked-feature task (the row cannot
serve its purpose) and keep the unlinked case untouched.

### Plan

- [x] Superseded by task 0958.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

Duplicate of task 0958 R2: its verdict-time scenario-credit check catches the observed 0966 all-AC1 answer before feature close-out. Keep the plugin lint standalone; do not duplicate the feature gate's matching rule.

### History

- 2026-09-27T16:25:44.206Z backlog → cancelled (system)

