---
schema_version: 1
name: Fix history-anatomy render sidecar double-write
status: done
template: issue
created_at: 2026-11-15T17:52:11.415Z
updated_at: "2026-11-15T18:16:20.295Z"

ac_altitude: task-local
ac_numbering: task-local
done_forced: "false"
done_reason: unforced close
---

## 1338. Fix history-anatomy render sidecar double-write

### Background

Captured from the creation title: "Fix history-anatomy render sidecar double-write".

### Requirements

- [x] R1. In `config/workflows/history-anatomy.yaml`, the render stage must not redirect `spur history report` stdout into the same sidecar path that the command writes.
- [x] R2. A regression in `plugins/sp/tests/skill-structure.test.ts` must reject same-path render redirection, and `apps/cli/tests/commands/history/report.test.ts` must prove the real CLI sidecar has one title and balanced fences.
- [x] R3. Update `docs/design/history-anatomy.md` to name the single-writer render contract.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Render has one sidecar writer (req: R1)
Given the current and baseline commands in the history-anatomy render stage
When they invoke `spur history report`
Then neither redirects stdout into the `.md` sidecar path written by that command.

Scenario: AC2 — Forensics sidecar is well-formed (req: R2)
Given a real history artifact
When `history report --mode forensics` runs through the CLI
Then its sidecar contains exactly one forensics title and two balanced fences, and the workflow regression rejects the former redirection.

Scenario: AC3 — Design records the boundary (req: R3)
Given the history-anatomy design document
When the render contract is reviewed
Then it names `spur history report` as the sole sidecar writer and stdout as run-log output only.
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

Remove only the same-path stdout redirection from the current and baseline render commands. Keep the existing baseline fallback semantics and all later enrichment/validation stages unchanged. Pin the workflow command shape, and strengthen the existing real-CLI sidecar test to assert one title and two fences. No CLI flag, schema, renderer, minimax, or project-selector change.

### Plan

- [x] Add failing render single-writer and sidecar-format regressions.
- [x] Remove same-path redirection from current and baseline render commands.
- [x] Run focused real-CLI and workflow tests; update the design owner.

### Root Cause

`runHistoryReport` writes `<artifact>.md` through `renderMarkdown`, while the history-anatomy render shell command independently opens that same path for stdout redirection. The CLI also writes the unfenced report and artifact footer to stdout, so the two writers race and produce duplicated prefixes, missing fences, and mixed content. The defect is in `config/workflows/history-anatomy.yaml`, not the pure renderer.

### Solution

| File | Change | Why |
| --- | --- | --- |
| `config/workflows/history-anatomy.yaml:167-168` | Removed stdout redirection into the current and baseline sidecars. | `spur history report` is again the sole sidecar writer; stdout remains run-log output. |
| `plugins/sp/tests/skill-structure.test.ts:1047-1055` | Added a workflow command-shape regression rejecting same-path redirects. | Failed before the fix on the current render command; passes after it. |
| `apps/cli/tests/commands/history/report.test.ts:170-182` | Added a real CLI forensics sidecar contract for one title and two fences. | Pins the user-visible Markdown result independently of the workflow regression. |
| `docs/design/history-anatomy.md:157-160` | Documented the single-writer render boundary. | Keeps the owning design synchronized with the fixed workflow. |

Probe: `probe: real CLI current+baseline render commands — PASS; /tmp/1338-render-e2e.json records one title and two fences per sidecar.`

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `config/workflows/history-anatomy.yaml:167-168`; `plugins/sp/tests/skill-structure.test.ts:1047-1055` |
| R2 | MET | `plugins/sp/tests/skill-structure.test.ts:1047-1055`; `apps/cli/tests/commands/history/report.test.ts:170-182` |
| R3 | MET | `docs/design/history-anatomy.md:157-160` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `plugins/sp/tests/skill-structure.test.ts:1047-1055` rejects same-path redirects; 95/95 plugin tests passed. |
| AC2 | MET | command | Real current+baseline CLI render probe PASS with one title/two fences each; `apps/cli/tests/commands/history/report.test.ts:170-182`; 16/16 report tests passed. |
| AC3 | MET | command | `rg -n '\*\*Render sidecars have one writer\.\*\* |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

| Priority | Finding | Disposition | Evidence |
| --- | --- | --- | --- |
| P4 (advisory) | The pre-existing baseline `|| true` fallback is unchanged; its policy is outside this task. | ACCEPTED | `config/workflows/history-anatomy.yaml:168` |

| Check | Status | Evidence |
| --- | --- | --- |
| design-conformance | pass | 3/3 design claims DONE: redirects removed, baseline fallback retained, renderer untouched. |
| SECUA | pass | No new input, secret, process, schema, or trust-boundary surface; the change removes a write race. |
| scope | pass | Only the approved workflow, two tests, and owning design document changed. |

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `config/workflows/history-anatomy.yaml:167-168`; `plugins/sp/tests/skill-structure.test.ts:1047-1055` |
| R2 | MET | `plugins/sp/tests/skill-structure.test.ts:1047-1055`; `apps/cli/tests/commands/history/report.test.ts:170-182` |
| R3 | MET | `docs/design/history-anatomy.md:157-160` |

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| AC1 | MET | test | `plugins/sp/tests/skill-structure.test.ts:1047-1055` rejects same-path redirects; 95/95 plugin tests passed. |
| AC2 | MET | command | Real current+baseline CLI render probe PASS with one title/two fences each; `apps/cli/tests/commands/history/report.test.ts:170-182`; 16/16 report tests passed. |
| AC3 | MET | command | `rg -n '\*\*Render sidecars have one writer\.\*\*|stdout is run-log output only' docs/design/history-anatomy.md` exited 0 at lines 157-158. |

| Verification | Result |
| --- | --- |
| `bun run spur-check` | PASS — 12,201 tests, 0 failures; both post-check rules passed (`.spur/run/1338-full-gate.log`). |
| `task gate 1338 light` | PASS — 6 changed files, 6 checks, 0 skipped. |

Verdict: PASS

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-11-15T18:01:49.992Z todo → wip (system)
- 2026-11-15T18:16:19.360Z wip → testing (system)
- 2026-11-15T18:16:20.197Z testing → done (system)

