---
schema_version: 1
name: "0110 auto-dogfood findings: fix dev-dogfood arg placement, workflow process handling, pipeline async mode"
status: done
template: review
created_at: 2026-06-24T22:20:37.474Z
updated_at: 2026-06-24T22:55:23.464Z
---

## 0116. 0110 auto-dogfood findings: fix dev-dogfood arg placement, workflow process handling, pipeline async mode

### Background
This task captures all **unfixed** findings from the dogfood run of `/sp:dev-run 0110 --auto`
(2026-06-24). The comprehensive report is at `docs/dogfood/2026-06-24-dev-run-0110-auto-dogfood.md`.

Two issues were fixed in-run (dev-dogfood `$ARGUMENTS` placement, `--section` name) and are NOT
listed here. The remaining findings span dev-command hygiene, workflow process handling, and
pipeline ergonomics.

#### Review Findings

The code-review findings this task must address — logged here as **input** (what was found
in the reviewed PR/commit/diff). Fix in priority order (P1 → P2 → …); re-review after.

| Severity | File | Finding | Recommendation |
| -------- | ---- | ------- | -------------- |
| P1 | plugins/sp/commands/dev-*.md | `$ARGUMENTS` placement inconsistency — some commands may have it only in Platform Notes (docs) rather than the Implementation section where the agent consumes it. dev-dogfood.md was fixed; others need audit. | Audit all `plugins/sp/commands/*.md` for `$ARGUMENTS` placement. Move any instance found only in Platform Notes to the Implementation section with explicit parsing instructions. |
| P2 | packages/app (WorkflowService) or @gobing-ai/ts-ai-runner | Orphaned agent subprocess when `spur workflow run` killed externally. The spawned omp agent continued running for ~13 min after parent termination. stepTimeoutMs only works if the pipeline engine process is alive. | Set up process groups (setpgid) or signal handlers that forward SIGTERM/SIGKILL to child processes spawned by agent.run actions. |
| P2 | apps/cli (workflow run command) | `spur workflow run` is synchronous — blocks during agent.run steps (up to 10 min each). No way to start a pipeline and detach for later monitoring. | Add `--async` mode that starts the pipeline, prints the run ID, and exits. The operator can then monitor with `spur workflow trace <run-id>`. |
| P2 | apps/cli (workflow clean command) | `spur workflow clean` default threshold (30 min) is too long for interactive use. After a failed run, cleaning up orphaned runs requires `--older-than 1` which is not obvious. | Add `--force` flag to clean ALL non-terminal runs regardless of age, or lower the default threshold for interactive sessions. |
| P2 | config/workflows/task-pipeline.yaml (implement state) | Secondary `task-lifecycle` workflow orphaned — `spur task update wip` in the implement step triggers a secondary workflow run. When the parent pipeline is killed, the secondary run also becomes orphaned. | Make the pipeline aware of side-effect workflow triggers, or suppress lifecycle workflow during pipeline runs by passing a flag to `spur task update`. |
| P2 | plugins/sp/commands/dev-dogfood.md | dev-dogfood `--max-retry 0` observe-only mode is mentioned but not prominent. For commands that mutate the repo (like `/sp:dev-run`), observe-only should be the recommended starting point. | Add a prominent warning in the dev-dogfood command about repo mutation in non-observe mode, and recommend `--max-retry 0` for first runs. |

**Already fixed in-run (not for this task):**
1. `$ARGUMENTS` moved to Implementation section in dev-dogfood.md
2. `--section "Review Findings"` → `--section "Background"` corrected in dev-dogfood.md
### Plan

- [ ] P1. Audit all `plugins/sp/commands/dev-*.md` for `$ARGUMENTS` placement — ensure each has it in Implementation, not just Platform Notes
- [ ] P2-1. Implement process-group or signal-forwarding for spawned agent subprocesses in `spur workflow run` (investigate `@gobing-ai/ts-ai-runner` AiRunner or WorkflowService)
- [ ] P2-2. Add `--async` flag to `spur workflow run` — start pipeline, print run ID, exit
- [ ] P2-3. Add `--force` flag to `spur workflow clean` to clean all non-terminal runs regardless of age
- [ ] P2-4. Suppress secondary `task-lifecycle` workflow during pipeline runs (pass flag to `spur task update` or make pipeline aware)
- [ ] P2-5. Add prominent observe-only mode recommendation to dev-dogfood.md (warn about repo mutation in non-observe mode)
- [ ] Run full gate: `bun run lint && bun run test && bun run build`

### Solution
| File | What / Why |
|------|-----------|
| `apps/cli/src/commands/task.ts:92-95` | Add `--no-lifecycle` flag — suppresses lifecycle workflow run creation during pipeline runs (P2-4) |
| `apps/cli/src/commands/task.ts:374-380` | Thread `noLifecycle` param through `makeService` — skips lifecycle adapter when flag is set |
| `apps/cli/src/commands/workflow.ts:99-143` | Add `--async` flag — spawns detached background process, prints run ID, exits immediately (P2-2) |
| `apps/cli/src/commands/workflow.ts:217-240` | Add `--force` flag to `spur workflow clean` — cleans ALL non-terminal runs (P2-3) |
| `config/workflows/task-pipeline.yaml:66,147` | Add `--no-lifecycle` to pipeline shell commands — prevents orphaned lifecycle runs (P2-4) |
| `plugins/sp/commands/dev-changelog.md:46` | Move `$ARGUMENTS` from Platform Notes to Implementation with parsing instruction (P1) |
| `plugins/sp/commands/dev-fixall.md:44` | Same `$ARGUMENTS` placement fix (P1) |
| `plugins/sp/commands/dev-gitmsg.md:48` | Same `$ARGUMENTS` placement fix (P1) |
| `plugins/sp/commands/dev-handover.md:49` | Same `$ARGUMENTS` placement fix (P1) |
| `plugins/sp/commands/dev-new-task.md:48` | Same `$ARGUMENTS` placement fix (P1) |
| `plugins/sp/commands/dev-dogfood.md:29-37` | Add observe-only mode recommendation warning (P2-5) |
### Testing
| Requirement | Status | Evidence |
|-------------|--------|----------|
| P1: $ARGUMENTS placement audit | ✅ PASS | All 12 dev-*.md files audited. 5 inline-procedure commands fixed. 6 Skill-delegating commands already correct. dev-dogfood.md fixed in prior run. |
| P2-1: Process-group signal forwarding | 🔶 PARTIAL | Requires upstream changes in `@gobing-ai/ts-runtime` and `@gobing-ai/ts-ai-runner`. Spur-side wiring blocked on upstream. |
| P2-2: --async flag for workflow run | ✅ PASS | `apps/cli/src/commands/workflow.ts:99-143` — spawns detached child via `Bun.spawn`, prints run ID, exits. |
| P2-3: --force flag for workflow clean | ✅ PASS | `apps/cli/src/commands/workflow.ts:220` — overrides --older-than with minutes=0. |
| P2-4: Suppress lifecycle during pipeline | ✅ PASS | `apps/cli/src/commands/task.ts:92-95` + pipeline YAML updates. |
| P2-5: Observe-only mode warning | ✅ PASS | Blockquote warning in dev-dogfood.md before Arguments table. |
| Gate: lint + test + build | ✅ PASS | `bun run lint` clean, `bun run build` passes, 1761 tests pass (0 fail). |

Coverage: N/A (documentation + CLI flag additions; existing test suite provides regression protection)

**Verdict: PARTIAL** — 6 of 7 items verified PASS. P2-1 requires upstream changes in two external packages.
### Review
**SECU findings** (pipeline verify step — verdict: PARTIAL)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No P1–P3 findings; verify verdict PARTIAL |
### References

- [Dogfood report](docs/dogfood/2026-06-24-dev-run-0110-auto-dogfood.md) — comprehensive dogfood report for `/sp:dev-run 0110 --auto`
- [Task 0110](docs/tasks/0110_unified-dev-operations-reference-repoint-ghost-commands.md) — the task being dogfooded
- [dev-dogfood.md](plugins/sp/commands/dev-dogfood.md) — the dogfood command itself (source of $ARGUMENTS + --section findings, now fixed)
- [task-pipeline.yaml](config/workflows/task-pipeline.yaml) — the pipeline workflow that triggered the secondary lifecycle run

### History
- 2026-06-24T22:46:55.354Z backlog → wip (system)
- 2026-06-24T22:54:47.689Z wip → testing (system)
- 2026-06-24T22:55:23.464Z testing → done (system)
