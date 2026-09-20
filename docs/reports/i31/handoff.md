# I31 delegation handoff and next batch

Prepared 2026-09-19. This is a task-readiness freeze, not execution of the investigations or approval of their eventual product changes.

## Ready delegation batch

| Task | Deliverable | Prerequisite | Estimate | State |
| --- | --- | --- | --- | --- |
| [0903 — Contract adoption and ownership audit](../../tasks5/0903_audit-post-delivery-cli-plugin-workflow-contract-adoption-an.md) | CLI/plugin/workflow comparison, four operator journeys, residual ownership and scenario JSON | None | 2 hours | Ready to investigate |
| [0904 — Usage-to-availability validation](../../tasks5/0904_validate-usage-to-availability-decisions-with-sanitized-fixt.md) | Fourteen synthetic case groups; preview versus actual disposable apply; isolation, freshness and timing evidence | None | 2 hours | Ready to investigate |
| [0905 — Complete-run reliability and cost baseline](../../tasks5/0905_measure-complete-run-reliability-and-execution-cost-across-i.md) | Bounded historical cohort, eight fixed scenarios plus 0903 additions, coverage and proposed remediation batch | 0903 done and its report available | 2 hours | Specification ready; execution waits |

Each task has seven requirement/AC pairs, a frozen Design and ordered Plan, closed investigation decisions, source references, a 90-minute investigation checkpoint limit, 60-second child-process deadlines, exact artifact names/schemas, and production mutation policy `none`. Estimates include follow-up verification outside the bounded investigation pass.

Delegation order: 0903 and 0904 are independent and may be assigned to separate isolated worktrees; 0905 follows the accepted 0903 result. One writer per worktree and one wayfinder ticket per session. The safe sequential order is 0903 → 0904 → 0905.

Give each delegate this instruction, substituting the task number:

> Resolve I31 task 0903 using sp-wayfinder's Work Through the Map procedure and the task's frozen Design/Plan. Read it with `bun run apps/cli/src/index.ts task show 0903 --json`. Check dependencies, claim before investigation, and use the existing wayfinder-resolution research/verification route. Produce only the named evidence artifacts and CLI-owned task sections. Do not use task-pipeline, dev-run, or dev-runall; do not implement proposed product fixes. Stop after this ticket and report its verdict and artifacts.

Use the same instruction for 0904 and then 0905. The delegated investigator/reviewer sessions are expected; the prohibition on new paid runs refers to benchmark subjects and provider experiments inside the investigation. No fresh CodexBar/network polling, production config writes, live DB mutations, or new benchmark pipelines are required.

Readiness evidence: [readiness.json](./readiness.json), seven passing checklist rows per task, bound to current planning-section digests. `task check --as todo` passes for all three; I31 feature check passes. The sole warning is 0905's unfinished 0903 prerequisite. Digests must be regenerated after planning-section edits; these are preparation receipts, not implementation PASS verdicts.

## Next batch: adoption and availability correctness

**Sync-first finding:** one read-only `feature sync --all --dry-run --json` evaluated 138 of 147 features and proposed 36 transitions: 35 to done and H1 to blocked. No transitions were applied. In particular, D62, E6, D3 and I12 should not be treated as new implementation work solely because their frontmatter is still open.

After excluding I31, structural containers, and the post-sync closed view, there is no additional immediately executable task batch. I7, P and E7 have zero linked tasks in both the active folder and the all-folder metadata lookup. All three feature checks pass with orphan-scenario warnings. They are **T3 — specify first**, not a ready execution frontier.

The recommended next planning batch is:

| Proposed slice | Owner | Start condition | Concrete scope |
| --- | --- | --- | --- |
| Wayfinder operand correction and semantic parity | Existing [I7](../../features/I7_semantic-class-drift-layer-and-wayfinder-section-tags-fix.md) | Can be planned now; coordinate findings with 0903 | Replace the still-present `--section tags` recipe with the supported field update; extend existing parity checks to detect frontmatter keys used as body sections; carry the corrected source through Superskill installation surfaces. No new CLI verb. |
| Accurate quota preview and availability decisions | B6 follow-up; allocate a residual task after 0904 | 0904 accepted fixture evidence | Make preview agree with protected/applicable/persisted outcomes; include no-usage/stale/mapping fixes only when reproduced. Reuse the single updater, with focused regressions. Do not build a second producer or scheduler. |
| Remaining plugin/dispatch contract adoption | I3/P residual ownership, as established by 0903 | 0903 accepted inventory; use 0905 to justify performance changes | Correct stale runtime guidance and close demonstrated receipt/freshness/recovery gaps. Preserve already-shipped auto-selection and mutation-policy behavior. Avoid a broad CLI/workflow rewrite. |

Suggested I7 planning entry: `/sp-dev-plan --feature I7`, then `/sp-dev-refineall --feature I7 --auto --depth ready`. This handoff identifies the next batch; it does not pretend those new implementation tasks already exist.

Evidence supporting this recommendation:

- `plugins/sp/skills/wayfinder/SKILL.md:123` still prescribes `--section tags`; I7 already has three AC scenarios and no tasks.
- `packages/app/src/services/agent-usage-producer.ts:317` calculates preview changes before the consumer's ownership decision. The prior live dry run reported an operator-owned executor as `would-apply`; `agent-quota-updates.ts:297` protects it. Only the preview discrepancy was observed, not an actual re-enable.
- `config/workflows/task-pipeline.yaml:64` already documents auto selection, and `:355` already blocks automatic code repair when run/task mutation policy disallows it. `plugins/sp/tests/task-pipeline-resilience.test.ts:78` covers that boundary. P's three scenarios require residual reconciliation before decomposition, not wholesale reimplementation.
- `packages/contracts/src/history.ts` already exists, contradicting E7's old absence premise. E7's five-scenario run-record/retention migration stays lower priority until its current remaining scope is audited; it is not part of this next batch.
- Archived H1 task 0142 is blocked and still cites legacy workspace/team prerequisites. Revalidate and route any surviving scope to the current owner; do not launch its stale design.

The 40-day source-churn probes (since 2026-08-10, HEAD d8ff752b2) counted I7 scope 315 commits, P scope 581, E7 scope 475. These measure exposure, not priority scores or independent effort. All three are directly connected to the harness, so dogfood proximity does not discriminate this small set; AC counts are 3/3/5 and do not overcome the zero-task gate. P is named in ADR-121; authority mentions do not make a stale spec executable.

No feature-tree restructuring, public CLI change, scheduler installation, source implementation, or status-sync apply was performed. Task readiness edits and this report remain reviewable working-tree changes.
