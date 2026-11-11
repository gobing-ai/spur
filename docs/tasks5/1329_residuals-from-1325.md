---
schema_version: 1
name: Residuals from 1325
status: done
template: standard
created_at: 2026-11-11T00:02:29.712Z
updated_at: "2026-11-11T17:58:21.822Z"

done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1329-verdict.json
---

## 1329. Residuals from 1325

### Background

Source task: 1325 (feature F22) — deferred residuals filed by residual-scan settle (unlinked: a deferral must not hold the completing feature open).

- review-finding:42e0ee35 — apps/cli/src/commands/task/create.ts:97: (Carried from visit 1, unchanged by 2ec3071ff.) The single `task create` CLI surface cannot author an oversize body (no body-input flag; template body is minimal), so its warning projection is near-unreachable for size advisories in practice. Harmless projection code; the service contract still reports.
- review-finding:823be33b — apps/cli/src/commands/task/show.ts:50: (Carried from visit 1, unchanged by 2ec3071ff.) `--sections ","` (only empty CSV entries) silently falls back to the full dump instead of erroring — the caller pays for the whole file. Edge case; full-dump fallback is the safer default.
- review-finding:d6c3c9c2 — plugins/sp/skills/spur-cli/references/tasks.md:63, packages/app/src/services/task-size-precheck.ts:99, plugins/sp/skills/spur-dev/references/execution-workflow.md:331: (Carried from visit 1; section rewritten at `tasks.md:63-72` in 2ec3071ff for rendering accuracy — Finding 1 — but the rewrite still carries the R3 "prefer phase-scoped task docs" preference via the warning text and pre-existing split guidance rather than a dedicated sentence. Corpus-level guidance chain satisfies R3; no behavior gap.)

### Requirements

- [x] R1. `task create` accepts `--requirements <text>` and `--plan <text>`, threading oversize bodies through the same candidate path batch items use, so the write-time size advisory is reachable on the single-create surface.
- [x] R2. `task show --sections` with a CSV containing zero usable names exits 2 as invalid usage instead of silently falling back to the full dump.
- [x] R3. The spur-cli tasks.md size-advisory section carries a dedicated split-guidance sentence (decompose instead of growing one oversized task).

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Keep empty if this task has no objective AC yet. -->

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen approach, key tradeoffs, invariants, and impacted surfaces. Keep snippets short. -->

### Plan

1. Add `requirements`/`plan` params to TaskService.create and thread to resolveCandidateShape; add the CLI flags.
2. Guard `--sections` in show.ts: explicitly passed but zero usable names → VALIDATION_FAILED, exit 2.
3. Add the split-guidance sentence to plugins/sp/skills/spur-cli/references/tasks.md.
4. CLI integration tests in create.test.ts / show.test.ts; `(cd apps/cli && bun test …)` green, fail-proofed by stashing src.

### Solution

- packages/app/src/services/task-create-ops.ts:330-333,363-364 — `create` params gain `requirements`/`plan`, threaded to `resolveCandidateShape` (the same path batch items take; normalization + size precheck apply unchanged).
- apps/cli/src/commands/task/create.ts:27-29,107-108 — `--requirements <text>` / `--plan <text>` flags passed to `svc.create`.
- apps/cli/src/commands/task/show.ts:50-62 — an explicitly passed `--sections` with zero usable names emits VALIDATION_FAILED and exits 2 instead of degrading to the full dump.
- plugins/sp/skills/spur-cli/references/tasks.md:75-78 — dedicated split-guidance sentence after the advisory paragraph.
- apps/cli/tests/commands/task/create.test.ts:665 — bodies authored + advisory fired; apps/cli/tests/commands/task/show.test.ts:234 — empty CSV errors in bare `--json` (stderr) and `--json --json-envelope` (ok:false envelope).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | packages/app/tests via apps/cli/tests/commands/task/create.test.ts:665 — create with 11 R-item requirements + plan authors both bodies and fires the R-items advisory on stderr; component in packages/app/src/services/task-create-ops.ts:330 |
| R2 | MET | apps/cli/tests/commands/task/show.test.ts:234 — `--sections ","` and `" , ,"` exit 2 with the no-usable-names error in bare --json and the ok:false envelope; apps/cli/src/commands/task/show.ts:50 |
| R3 | MET | plugins/sp/skills/spur-cli/references/tasks.md:75 — dedicated split-guidance sentence in the size-advisory section |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

| Priority | Finding | Disposition |
| --- | --- | --- |
| P4 | `--section ""` (repeatable form) still treats an empty value as a requested name; only the CSV form is guarded. Out of the finding's scope (823be33b names `--sections ","`); documented behavior unchanged. | Accepted. |

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-11-11T17:57:58.955Z backlog → todo (system)
- 2026-11-11T17:57:59.293Z todo → wip (system)
- 2026-11-11T17:58:21.775Z wip → done (system)

