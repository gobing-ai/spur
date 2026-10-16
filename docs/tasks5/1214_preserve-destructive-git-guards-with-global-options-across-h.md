---
schema_version: 1
name: Preserve destructive git guards with global options across hook hosts
status: todo
template: issue
created_at: 2026-10-16T01:39:36.480Z
updated_at: "2026-10-16T01:41:22.172Z"
feature_id: A91

---

## 1214. Preserve destructive git guards with global options across hook hosts

### Background

Review of packages/apps/plugins/scripts reproduced a gap in A91 hook preservation (feature R2/R7). `classifyCommand('git push --force')` returns a destructive label, but `git -C . push --force` and `git -c core.hooksPath=/tmp/hooks push -f` return null. No destructive command was executed. All host adapters share this classifier, so generic hook normalization cannot repair this policy miss. Existing tasks 0215 and 1211 are done; no active task owns this newly reproduced gap. The review already fixed malformed-URL error redaction and corrected the stale serial-test comment; neither belongs to this task.

### Requirements

- [ ] R1. Recognize destructive git invocations after supported global options, including -C, -c, --git-dir, --work-tree and their applicable equals forms, preserving quoted option values as one argument and command boundaries.
- [ ] R2. Keep one portable classifier shared by every hook host. A matched force push, hard reset, untracked-file deletion or working-tree discard must retain the existing ask decision; hosts without confirmation must retain their existing deny translation.
- [ ] R3. Preserve intentional safe cases, including ordinary push/status and force-with-lease, without evaluating shell expansions or invoking git during classification.
- [ ] R4. Keep bundled hook sources standalone, add regression coverage for option-prefixed forms and host output, and update the careful-guard guidance if the supported syntax contract needs clarification. No new public CLI verbs, hook identities, bypass flags or policy DSL.

### Acceptance Criteria

```gherkin
Feature: Guard git invocations with global options
  Scenario: R2 — Hook entries preserve behavior with helpers and tests in their owners
    Given the shared careful-guard policy and registered hook entry
    When git -C . push --force or git -c core.hooksPath=/tmp/hooks push -f is classified
    Then both produce a destructive decision without executing git
    And option-prefixed reset --hard, clean -fd and restore . preserve their existing guard behavior
    And quoted -C paths and --git-dir/--work-tree forms are covered
    And ordinary push, status and force-with-lease retain their existing safe decisions
    And host-conformance tests retain ask for confirmable hosts and deny for Codex
```
Verification: run `bun test tests/hooks/destructive-policy.test.ts tests/hooks/careful-guard.test.ts` inside plugins/sp, the existing hook-host conformance checks, and `bun run plugin-smoke`. Both line and function coverage must remain at least 90% per measured changed file.

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

Extend `plugins/sp/lib/destructive-policy.ts` at the command-recognition seam. Use a small pure lexical pass for git argument prefixes and supported option arity/quoting, then apply the existing destructive subcommand policy to the recognized invocation. Preserve shell segment boundaries; never expand substitutions or execute commands. Reuse a local tokenizer if one already satisfies this bounded contract. Keep implementation in the shared policy/helper rather than each host entry. Update `plugins/sp/tests/hooks/destructive-policy.test.ts` and `plugins/sp/tests/hooks/careful-guard.test.ts`; consult the installed Superskill host-conformance owner for Codex translation. Reject adding separate host regexes, a broad `git.*push` expression that crosses commands, a general shell parser dependency, or external value imports into installed hooks. Out of scope: changing safe-force-with-lease policy, arbitrary git aliases, other destructive tools, and changing the hook failure policy.

### Plan

1. Add failing policy cases for global-option force pushes, including quoted paths, and adjacent destructive subcommands; retain safe controls.
2. Implement bounded shared recognition; review option arity, separator and quote handling against the regression matrix.
3. Exercise the authored hook and existing host translation with synthetic payloads; never perform a real push or deletion.
4. Run focused tests, standalone/plugin smoke and the project gate; record per-file coverage and current-source anchors in Solution/Testing before verification. Keep this task independent of 1215.

### Root Cause

The git patterns require `git` immediately followed by the subcommand. Git global options between the executable and subcommand prevent a match. Evidence: `plugins/sp/lib/destructive-policy.ts:100` and `plugins/sp/lib/destructive-policy.ts:120`. The direct classifier replay is captured in the review report; confirm with a policy test before implementation.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

Feature A91 R2/R7; task 0215 historical policy owner; `plugins/sp/lib/destructive-policy.ts:100`; `plugins/sp/scripts/hooks/careful-guard.ts:82`; `plugins/sp/tests/hooks/destructive-policy.test.ts`; `plugins/sp/tests/hooks/careful-guard.test.ts`. Review command: `bun -e 'import {classifyCommand} from "./plugins/sp/lib/destructive-policy.ts"; console.log(classifyCommand("git -C . push --force"))'` currently prints null.

### History
