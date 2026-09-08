---
schema_version: 1
name: Safely update one existing project executor disabled flag
status: done
template: feature-impl
created_at: 2026-09-07T17:12:18.724Z
updated_at: "2026-09-08T05:56:35.590Z"
feature_id: B5
priority: P2
tags:
  - executor-availability

dependencies: ["0796"]
---

## 0797. Safely update one existing project executor disabled flag

### Background

Automation needs a reusable filesystem operation whose behavior is narrower than config loading: changing a single existing project entry must not serialize merged global config, create overrides, or overwrite concurrent edits. File-integrity review is independent of executor selection.

Implements:

- R7 — Project updates change only an exact existing entry
- R8 — Missing or invalid project targets never cause unintended writes
- R9 — Concurrent configuration writes preserve unrelated edits

Approved design: docs/design/executor-availability.md; ADR-111. Planning run: bd360df4-561f-40f5-94a7-ae7132c55984.
Rubric: E4 D1 L1 C1 R2 = 9; estimated 4h. Retain this cohesive deliverable; tests and doc sync are included rather than split into phase tasks.

### Requirements

- [x] R1. Export async setProjectExecutorDisabled(projectRoot, executorName, disabled) from the config loader surface; use exact case-sensitive name matching and modify only the existing project entry disabled attribute, preserving comments, ordering, file permissions and unrelated values. Persist explicit false when absent and avoid rewriting an already matching explicit value.
- [x] R2. Return unchanged with missing-file, missing-executors or missing-executor reasons without creating paths or editing global config; accept valid name-only project fragments, reject malformed/ambiguous YAML and escaping config symlinks with actionable stable errors, and leave original contents intact.
- [x] R3. Serialize updater read-modify-write operations per real project config path, detect observable external changes before commit, atomically replace the file, invalidate loader cache on success, and preserve both updater changes or report conflict rather than losing unrelated edits.

### Acceptance Criteria

```gherkin
Feature: Safely update one existing project executor disabled flag

  @core
  Scenario: R1 — Project updates change only an exact existing entry
    Given the project YAML contains executor alpha, executor alphabet, comments, and unrelated settings
    When the updater sets alpha disabled to false
    Then only alpha disabled becomes explicitly false, including for a name-only project fragment, and an already matching explicit value causes no rewrite

  @core
  Scenario: R2 — Missing or invalid project targets never cause unintended writes
    Given the project file, executor list, or exact name is absent, or the YAML has invalid or ambiguous duplicate entries
    When the updater is called
    Then absent targets return a structured no-op, invalid targets return an actionable error, and no file, section, entry, or global override is created

  @core
  Scenario: R3 — Concurrent configuration writes preserve unrelated edits
    Given two updater calls target different executors and an external editor may change the same file
    When updates attempt to commit
    Then updater writes serialize, detectable external changes cause conflict instead of overwrite, and failed atomic writes preserve the original file
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Implement the accepted design section 3 as one Bun-only config operation, with no new service interface or dependency. The exported result is {status:'updated'} or {status:'unchanged',reason:'already-set'|'missing-file'|'missing-executors'|'missing-executor'}; errors reject with INVALID_CONFIG, CONFIG_CONFLICT or CONFIG_WRITE_FAILED. Native argument validation rejects non-boolean values and empty names before filesystem work.

Owned files: packages/config/src/executor-update.ts (new), packages/config/src/loader.ts export/invalidation seam, and packages/config/tests/executor-update.test.ts (new). Reuse installed yaml parseDocument and its document-node mutation API after checking its local types. Load effective config only for validation; write the project document only. Explicit aliases/merge-key shapes whose edit could affect another entry are rejected rather than rewritten speculatively.

Use runtime filesystem operations where they exist plus minimal native exclusive lock, same-directory temp write/fsync/rename and permission preservation. Planning locks belong to the planning domain and must not be imported into config. Check current file identity/content immediately before rename. External editors do not honor our lock: document detectable conflict handling rather than claiming cross-editor transactions. Recover a lock only when its owner is confirmed dead, not merely slow. Cleanup only owned temp/lock files.

Decisions: no global mutation, insertion, fuzzy matching, whole-config stringify, or generic lock framework. An absent attribute on an existing entry is distinct from stored false because of inheritance. Dependencies: the availability task supplies schema support and merge tests. Premises: project writes target local Bun files; the installed yaml dependency supports preserving the document model; capability details must be checked in its local declarations before calling them.

Preserve unrelated/concurrent edits. Start implementation in a clean isolated working tree; one writer and one conventional commit per task. No .env, workflow, IAM or deployment changes are needed.

### Plan

1. [ ] Add temporary-file tests for exact vs prefix/case names, explicit false, name-only overrides, byte-stable no-op, comments and unrelated fields.
2. [ ] Implement document-targeted mutation and effective validation with the accepted structured result/error contract.
3. [ ] Add narrow exclusive locking and atomic commit; test concurrent updater calls, detectable editor conflicts, escaping symlinks, duplicate names, and injected write failures.
4. [ ] Invalidate config loader cache after success and verify a subsequent load returns the new merged value.
5. [ ] Run focused config tests/typecheck, then required repository gates on the final task diff; update the updater surface docs and record pipeline verify PASS.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `packages/config/src/loader.ts:270` |
| `packages/config/src/loader.ts:285` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
| ------------- | -------- | ---------- |
| R1 | MET | `packages/config/src/executor-update.ts:46-50` export; `108` exact scalar name match; `122-125` byte-stable already-set no-op; `125` persist explicit false; `packages/config/src/loader.ts:289` re-export; `packages/config/tests/executor-update.test.ts:76-101` alpha vs alphabet / case / prefix / name-only / comments+mode |
| R2 | MET | `packages/config/src/executor-update.ts:51-56` empty name / non-boolean reject before FS; `63` missing-file; `66-70` symlink; `85-87` missing-executors; `119` missing-executor; tests `105-178` structured no-ops and INVALID_CONFIG with contents preserved |
| R3 | MET | `packages/config/src/executor-update.ts:136-141` mtime/size/ino conflict; `143-151` tmp+fsync+rename+mode; `164` invalidateSpurConfig; `169-219` exclusive lock with dead-owner reclaim only; tests `184-237` concurrent serialize, live lock, dead reclaim, atomic failure, cache invalidation |

| Acceptance Criteria | Status | Evidence Type | Evidence |
| --------------------- | -------- | --------------- | ---------- |
| R7 — Project updates change only an exact existing entry | MET | test | `cd packages/config && bun test tests/executor-update.test.ts` R1 cases this run: alpha vs alphabet [false,true,true], case/prefix-free, name-only fragment, byte-stable no-op, comments/mode survive |
| R8 — Missing or invalid project targets never cause unintended writes | MET | test | Same file R2 cases this run: missing file/section/executor unchanged, malformed YAML INVALID_CONFIG, duplicates ambiguous, alias/symlink reject, empty/non-boolean pre-FS |
| R9 — Concurrent configuration writes preserve unrelated edits | MET | test | Same file R3 cases this run: concurrent serialize both edits survive, live owner never reclaimed, dead owner reclaimed, atomic failure preserves original, cache invalidation; 18/18 pass / 0 fail |

- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-07T23:35:11.914Z todo → done (system)
