---
schema_version: 1
name: "Script-absorption and hook-boundary handoff: finish PR-6..PR-9, retire Pi guard-extension, merge stack, comprehensive review"
status: done
template: meta
created_at: 2026-10-15T17:20:58.394Z
updated_at: "2026-10-15T23:14:34.570Z"
priority: P1
ac_numbering: task-local
ac_altitude: task-local

feature_id: A91
dependencies: ["1212", "1213"]
done_forced: "false"
done_reason: unforced close
---

## 1211. Script-absorption and hook-boundary handoff: finish PR-6..PR-9, retire Pi guard-extension, merge stack, comprehensive review

### Background

Handoff for the script-absorption programme (plan `docs/plans/2026-10-14-spur-script-absorption.md`, carried on #15, see its **Revision 2026-10-15**) and the plugin-hook boundary work shared with superskill (github.com/gobing-ai/superskill). The previous agent was interrupted twice; this task records the exact state at 2026-10-15 10:30 PT so the next agent can continue without drift. Quota is tight: finish, merge in order, then run the comprehensive review below and fix every finding.

**Owner decisions (binding; verbatim-ish)**

- superskill is the generic foundation for agent skills/hooks — it carries **no plugin- or spur-specific code**. spur is the harness toolkit.
- Hook logic stays in `plugins/sp`. Hooks call ordinary spur commands (e.g. `spur task resolve`). superskill only *runs* hooks, via `superskill hook run <plugin>/<id>` from `plugins/sp/hooks/hooks.json`.
- **Dropped:** `spur self hook`; lazy CLI command loading; npm `--splitting`; PRs #16, #17, #18, #19 (all closed, do not revive).
- PR ops go under `spur builder` (e.g. `spur builder pr preflight`, `spur builder pr request|wait|status|collect`). `builder publish` and `builder bump-ver --check` exist (PR-9).
- Skills **hard-require** spur on PATH. **Clean break in 0.5.0** (no compat layer beyond what is recorded). One-off tools are deleted, not absorbed. Root `bunfig.toml` untouched.
- Prefer folding commands into **existing nouns**. CLI surface is always `spur <noun> <verb>`; source modules are aligned with nouns.

**MUST rules**

- `bun run gate` passes 100%. Per-file **line AND function coverage >= 90%** for every file.
- Never change `bunfig.toml` (root or `scripts/`) without explicit owner approval.
- `plugins/sp/hooks` and `plugins/sp/scripts` contain only simple wrappers (< 5 lines), except hook logic, which lives in the plugin. `scripts/` holds only project-only scripts. Everything else is absorbed into the spur CLI. Any file kept at its old path needs a strong, recorded reason (plan §3 disposition table or this task).
- `[advisory]` / `[docs-only]` markers are added only via task files.
- `spur-check-feature` stays out of `gate` and CI.
- Conventional commits (commit-msg hook rejects type `wip`; use `chore(<scope>): WIP … (handoff, see task 1211)`). Merges are `chore: merge …`. **No rebase, no force-push, no `--no-verify`.** Use git worktrees; never `git checkout <ref> -- paths` in shared trees; never modify `/workspace/spur` or `/workspace/main-wt`.
- Run gates serialized: `flock /tmp/spur-gate.lock` with `~/.config/spur` backed up and restored **inside** the lock; logs to `/workspace/gate-logs/<name>.log` ending with `GATE_EXIT=<n> ELAPSED=<s>`. Template:
  `flock /tmp/spur-gate.lock bash -c 'cp -a ~/.config/spur /tmp/spur-config.bak.$$ && (cd <wt> && PATH=/home/box/.local/bun-1.4.3:$PATH bun run gate); rc=$?; rm -rf ~/.config/spur && mv /tmp/spur-config.bak.$$ ~/.config/spur; echo GATE_EXIT=$rc' > /workspace/gate-logs/<name>.log 2>&1`
- `gh pr edit` fails (Projects classic deprecation): use `gh api -X PATCH repos/<owner>/<repo>/pulls/<n> -F body=@file` (or `-f base=main` to retarget).

**Current state of every PR (2026-10-15 ~10:30 PT; re-check heads with `gh pr view <n> --json headRefOid`)**

| PR | Branch | Worktree | Head | Status | Content |
| --- | --- | --- | --- | --- | --- |
| spur [#15](https://github.com/gobing-ai/spur/pull/15) | chore/script-absorption-pr1 | /workspace/spur-pr1 | 377838a14 | open, ready | PR-1: deletes history-latency-measure, history-surface-freeze-check, run-storage-census; moves test shim `scripts/test-shims/spur` → `tests/shims/spur`; adds plan doc with Revision 2026-10-15 |
| spur [#20](https://github.com/gobing-ai/spur/pull/20) | feat/task-gate-residual-diffstat-v2 | /workspace/spur-pr3v2 | 6e3bc90f3 | open, ready | PR-3: `spur task gate|residual|diffstat` |
| spur [#21](https://github.com/gobing-ai/spur/pull/21) | feat/workflow-inline-absorb-v2 | /workspace/spur-pr4v2 | bc508a7ae | open, ready | PR-4: `spur workflow inline <op>` (11 ops) + `workflow commit-guard start|stage|check`; early dispatch in `apps/cli/src/index.ts` |
| spur [#22](https://github.com/gobing-ai/spur/pull/22) | feat/task-feature-verbs-absorb-v2 | /workspace/spur-pr5v2 | e303c4825 | open, ready | PR-5: `task wrapup|preflight|batch-plan`, `feature verify|handoff`; golden 43 cases |
| spur [#23](https://github.com/gobing-ai/spur/pull/23) | fix/sp-hook-conformance | /workspace/spur-hookfix | 6b823fcc8 | open, ready; body updated 10:2x PT | Hook entries moved to `plugins/sp/scripts/hooks/<id>.ts`; careful-guard declared PreToolUse Bash timeout 10; task-write-guard deny reason; silent allow; script-contract-check / plugin-install-smoke / surface-drift-inventory / task-triage updates; ADR-130 amendment. **Top commit 6b823fcc8 already retires `plugins/sp/hooks/pi/guard-extension.ts`** (+ test, `plugin.json extensions.pi`) — gate passed (`gate-logs/hookfix-pi-retire2.log`, 08:59 PT) |
| spur [#24](https://github.com/gobing-ai/spur/pull/24) | feat/builder-pr-dogfood-absorb | /workspace/spur-pr7 | cfe0e46b0 | open, ready; based on main | PR-7: `spur builder pr request|wait|status|collect|help`, `spur agent dogfood gate|validate-report`; deletes pr-reviewing + dogfood scripts/twins; gate exit 0 (`gate-logs/pr7d.log`, 09:32 PT) |
| spur [#25](https://github.com/gobing-ai/spur/pull/25) | feat/history-workflow-summary-absorb | /workspace/spur-pr6 | 305506463 | open, ready (opened this session) | PR-6: `spur history anatomy|timeline|summary`, `spur workflow summary|profile`; deletes the 4 remaining generated bundles, bundle-plugin-lib (+test), lib/inline-run-app.ts, transcript.ts, run-summary-core.ts. **Stacked**: contains `chore: merge` of #20, #21 and #22. Gate exit 0 (`gate-logs/pr6b.log`, 10:02 PT, 11135 pass) |
| spur [#26](https://github.com/gobing-ai/spur/pull/26) | feat/builder-publish-cost-migrate-absorb | /workspace/spur-pr9 | 05963c3ff | **DRAFT, WIP**, gate never run | PR-9: `spur workflow cost [--budget]`, `builder publish`, `builder bump-ver --check`, `self migrate --check`; deletes scripts/commands/{publish,real-run-cost,pipeline-budgets,importer-schema-check,check-marketplace-version}.ts; publish.yml → `builder publish`. **Branch was cut from PR-7 head cfe0e46b0, so it contains #24** |
| superskill [#3](https://github.com/gobing-ai/superskill/pull/3) | feat/spur-self-hook-delegate | /workspace/superskill-s1 (verify) | 4ef1fd1 | open, base main, clean | Generic hook runner: host-neutral `{decision: allow|deny|ask|block, reason}` rendered by `apps/cli/src/hook-host.ts`; lookup `hooks/<id>.ts|.mjs|.js` then `scripts/hooks/<id>.*`; plugin-root search SUPERSKILL_PLUGIN_ROOT, CLAUDE_PLUGIN_ROOT, Claude cache, omp cache, Grok installed-plugins, staged `.agents/scripts/<plugin>/hooks/`; bare allow never forwarded; errors fail open; timeout = hooks.json − 500 ms; **unconfirmable `ask` fails CLOSED as deny with reason on non-Claude hosts** |
| superskill [#4](https://github.com/gobing-ai/superskill/pull/4) | feat/pi-hook-adapter | /workspace/superskill-pi (verify) | aa211c9 | open, base feat/spur-self-hook-delegate (stacked) | Native Pi extension per hook in `~/.pi/agent/extensions/superskill-<plugin>-<hook>.ts`; verified e2e on Pi 1.2.0 and 0.85.1; UserPromptSubmit via beforeSubmitPrompt→input fix; structuredContent preserved. Gaps: no-UI ask blocks; SubagentStop/Notification skipped; no updatedInput/additionalContext; session/PreCompact not vetoable; existing Pi installs need reinstall. Retarget to main after #3 merges (CI only runs on PRs into main) |

Both superskill PR descriptions are **STALE** (they say "verified on 0.85.1 only" and "ask fails open").

Closed/abandoned (do not reuse): spur #16 (feat/spur-self-hook, /workspace/spur-pr2a), #17 (perf/cli-lazy-commands, /workspace/spur-prl), #18 (feat/sp-hooks-via-spur, /workspace/spur-pr2b), #19 (build/npm-bundle-splitting, /workspace/spur-split); old v1 branches feat/task-gate-residual-diffstat (/workspace/spur-pr3), feat/workflow-inline-absorb (/workspace/spur-pr4), feat/task-feature-verbs-absorb (/workspace/spur-pr5); detached worktrees /workspace/main-v2, /workspace/pr6-legacy, /workspace/pr9-legacy (golden-capture trees for PR-6/PR-9). No PR-8 or PR-10 branch exists.

**Merge order and known conflicts**

1. superskill #3 → retarget #4 to main (`gh api -X PATCH repos/gobing-ai/superskill/pulls/4 -f base=main`), wait for CI → merge #4. Both are clean. Release superskill (version containing #3+#4) before spur #23 merges.
2. spur #15 → #20 → #21 → #22 → #23 (owner order), then #25 → #24 → #26 (de-drafted) → PR-8.
3. After each merge, the next branch needs `chore: merge main into <branch>` (in its own worktree, no rebase). Resolve by **keeping both sides of additive rows** in: `config/plugin-scripts.json`; root and `packages/app` `package.json` (exports/scripts); `config/rules/surface/check-cli-surface.yaml`; `config/rules/strict/runtime-boundaries.yaml`; `docs/help/spur-cli-matrix.md` (re-add, then recompute the counts); `scripts/commands/bundle-plugin-lib.test.ts`; `plugins/sp/tests/bun-reentry-contract.test.ts` (both of the last two are deleted by #25 — take the deletion once #25 is in). #20 vs #23 also needs `bun run build:scripts` (regenerates `task-diffstat.mjs` and the generated bundles) after resolving.
4. #25 already contains #20–#22, so once those are on main its merge-main is mostly no-op. #26 contains #24; merge #24 first.
5. Re-run the gate (flock template) after every merge-main and before each merge.

**Plan PR status (plan §PR table, Revision 2026-10-15)**

| Plan PR | Scope | State |
| --- | --- | --- |
| PR-1 | delete one-off E71/E91 tools, move shim, plan doc | #15 |
| PR-2a / PR-2b / PR-L / S-1-as-designed | `spur self hook`, hooks via spur, lazy loading, spurDelegate | withdrawn (#16 #17 #18 #19 closed) |
| PR-3 / PR-4 / PR-5 | task gate/residual/diffstat; workflow inline + commit-guard; task/feature verbs | #20 / #21 / #22 |
| PR-6 | history anatomy/timeline/summary, workflow summary/profile; delete remaining bundles | #25 (gate green) |
| PR-7 | builder pr, agent dogfood | #24 (gate green) |
| PR-8 | retire script infrastructure | **not started** |
| PR-9 | self migrate --check, workflow cost [--budget], builder publish, bump-ver --check | #26 draft WIP |
| PR-10 | minCliVersion + context-shim removal | moot as designed; re-scope decision pending |

### Requirements

- [x] R1. Finish PR-9 (#26): gate green, coverage >= 90% per file, docs/help/matrix synced, de-drafted.
- [x] R2. Implement PR-8 (retire the script infrastructure) as a new PR on main after #20–#26 land.
- [x] R3. Record a PR-10 re-scope decision in the plan doc (declare minimum spur CLI version sp requires, or close it in the doc).
- [x] R4. Land the Pi guard-extension retirement only after superskill #3+#4 are released, with the Pi requirement documented.
- [x] R5. Update superskill #3 and #4 PR descriptions to match their current behaviour.
- [x] R6. Merge everything in the recorded order with `chore: merge` commits, gate green at each step.
- [x] R7. Plan doc carries a final status for every item (PR-1..PR-10, S-1, Q1–Q7, every §3 disposition).
- [x] R8. Clean up abandoned worktrees and closed branches.
- [x] R9. Run the comprehensive review checklist and fix every finding.
- [x] R10. Verify careful-guard on Codex blocks force pushes via superskill fail-closed ask after the superskill release.

### Acceptance Criteria

```gherkin
Scenario: AC1 — PR-9 is complete and green (req: R1)
Given branch feat/builder-publish-cost-migrate-absorb (#26, /workspace/spur-pr9, head 05963c3ff, contains #24)
When the gate runs under flock after `chore: merge main` (post #24 merge)
Then GATE_EXIT=0, every new module (apps/cli/src/commands/workflow/cost.ts, packages/app/src/workflow/run-cost.ts, release-ops publish/bump-ver --check paths, self migrate --check) has line and function coverage >= 90
And scripts/commands/{publish,real-run-cost,pipeline-budgets,importer-schema-check,check-marketplace-version}.ts (+tests) are deleted with no remaining reference (rg)
And publish.yml calls `bun apps/cli/src/index.ts builder publish apps/cli`, spur-dev.ts no longer forwards the absorbed verbs, workflow-promotion uses `spur workflow cost --json` (plan §3 workflow-promotion row)
And script-absorption-pr9 parity golden passes, docs/help/cmd_*.md, help2, spur-cli-matrix.md and plugins/sp/skills/spur-cli/references/*.md list the new verbs
And the PR is marked ready via `gh api -X PATCH` / `gh pr ready` and its body records the gate log

Scenario: AC2 — PR-8 retires the script infrastructure (req: R2)
Given #20–#26 are merged
When a new branch feat/retire-script-infrastructure off origin/main is gated
Then plugins/sp/scripts/script-root.ts, plugins/sp/lib/spur-bin.ts (+ tests), any remaining *.generated.{mjs,d.mts} and .mjs twins, config/plugin-scripts.json, config/script-placement-baseline.json and the build:plugin-lib / build:scripts package scripts are deleted
And scripts/commands/script-contract-check.ts plus the sp-script-placement rule are rewritten to the new contract (plugins/sp/scripts holds only hooks/<id>.ts per #23, each entry < 5 lines or hook logic; lib holds env.ts + hook-only libs; no `superskill script path sp` or `bun plugins/sp/` in shipped docs/YAML)
And plugin-install-smoke, verify-pack and bundle-plugins are simplified; surface-drift-inventory is deleted if I3 has closed (R11), otherwise kept with recorded reason
And bunfig.toml is unchanged and GATE_EXIT=0

Scenario: AC3 — PR-10 decision recorded (req: R3)
Given the plan marks PR-10 moot as designed
When the owner chooses (proposal: add `minCliVersion`/minimum spur CLI version that sp requires — 0.5.0 per Q4 hard cut — to hooks.json or plugin.json plus the consumer-compat diagnostic; else close in doc)
Then the plan's PR table and Revision section state the decision and, if implemented, a PR exists with gate green

Scenario: AC4 — Pi guard-extension retired safely (req: R4)
Given #23 head 6b823fcc8 already deletes plugins/sp/hooks/pi/guard-extension.ts
When superskill with #3+#4 is released
Then #23 merges and plugins/sp/README.md + docs state Pi needs that superskill version and a reinstall (`superskill install sp --targets pi`)
And if the owner wants #23 merged before the release, a new commit (not a revert-by-force) restores the extension and the follow-up PR removes it after release

Scenario: AC5 — superskill PR descriptions current (req: R5)
Given superskill #3 head 4ef1fd1 and #4 head aa211c9
When their bodies are PATCHed via gh api
Then #3 states unconfirmable ask fails CLOSED as deny with reason on non-Claude hosts, and #4 states e2e on Pi 1.2.0 and 0.85.1, the listed gaps, the reinstall requirement and the retarget-to-main step

Scenario: AC6 — Stack merged in order (req: R6)
Given the merge order in Background
When each PR is merged
Then main history shows `chore: merge main into <branch>` commits resolving additive conflicts by union (matrix counts recomputed), no rebase/force-push, and a GATE_EXIT=0 log per merge step in /workspace/gate-logs

Scenario: AC7 — Plan doc final status (req: R7) [docs-only]
Given docs/plans/2026-10-14-spur-script-absorption.md on main
When the programme closes
Then every PR row, S-1, Q1–Q7 and every §3 disposition has a final status (merged #n / withdrawn / moot / kept-with-reason)

Scenario: AC8 — Abandoned worktrees and branches cleaned (req: R8)
Given worktrees /workspace/spur-split, /workspace/main-v2, /workspace/spur-pr2a, /workspace/spur-pr2b, /workspace/spur-prl, /workspace/spur-pr3, /workspace/spur-pr4, /workspace/spur-pr5, /workspace/pr6-legacy, /workspace/pr9-legacy
When their work is confirmed merged or closed (owner OK for remote branch deletion)
Then `git worktree remove` them and delete local + remote branches of closed PRs #16 #17 #18 #19 and the v1 branches; `git worktree list` shows only live worktrees

Scenario: AC9 — Comprehensive review clean (req: R9)
Given everything merged
When the Review checklist below is executed
Then every finding is fixed in a PR (or recorded with owner-approved reason) and the Review section of this task lists each with disposition RESOLVED

Scenario: AC10 — careful-guard force-push block on Codex (req: R10)
Given the released superskill and sp installed on Codex
When an agent runs `git push --force`
Then careful-guard's ask is rendered as deny with a reason (fail-closed) and the push does not run
```

### Q&A

#### Q&A entry — 2026-10-15T17:30:00Z

Closed: task 1211 lives on its own branch `chore/task-1211-absorption-handoff` off origin/main (task files live in docs/tasks5 on main; #15 carries only the plan doc), so it can merge independently of the stack. Closed: #23's top commit already retires the Pi guard-extension; it is kept in #23 (gate green) rather than split, and #23 is gated on the superskill release. Open for owner: PR-10 re-scope (AC3); whether #23 may merge before superskill release (AC4).

#### Q&A entry — 2026-10-15T17:51:56.821Z

The operator changed landing to one reviewed dev branch, then main after integrated checks; remaining implementation is delegated later. Ready stack: #27, #15, #20, #21, #22, #25, #24, and release-dependent #23. Draft #26 remains unfinished and is owned by task 1212; task 1213 owns final infrastructure retirement and depends on 1212. Existing active A91 owns these records; task-local AC avoid redefining feature ship criteria. The parent remains wip until all original acceptance criteria are satisfied.

PR-10 is closed as originally designed. Record Spur >=0.5.0 as the documented plugin prerequisite; optional runtime minimum-version enforcement/diagnostics are explicitly deferred. No new manifest field is approved.

Independent review found artifact identity traversal, nested launch argv breakage for paths with spaces, stale fail-open ask claims, staged hook timeout metadata loss and current contract-doc drift. Integration fixes and repeat checks are required before accepting the ready stack. Superskill 0.3.38 published the initial generic/native-Pi implementation; use the subsequent verified corrected release for final staged timeout proof.

### Design

No new design. Follow plan §3/§4 dispositions and Revision 2026-10-15. Every absorbed script: logic + tests move to `packages/app`, a thin adapter under `apps/cli/src/commands/<noun>/`, a golden parity test captured from the legacy script on main (`apps/cli/tests/script-absorption-prN-parity.test.ts` + `fixtures/script-absorption-prN*`), then delete the script, its `.mjs` twin, its `plugin-scripts.json` row and baseline entry, and update skills/commands/help/matrix/design docs in the same PR.

### Plan

- [x] Re-check PR heads and worktree states; confirm no gate job is running (`pgrep -af spur-gate`) and `~/.config/spur` is intact.
- [x] superskill: correct #3/#4 bodies, land generic/native-Pi work through #5, publish verified 0.3.39 (AC5; combined landing supersedes original retarget sequence).
- [x] spur: land ready stack through reviewed integration #28 with integrated gate/CI (AC6; operator-approved replacement for per-PR choreography).
- [x] Finish #26 (AC1), merge.
- [x] PR-8 (AC2); PR-10 decision (AC3).
- [x] Plan doc final status (AC7); authorized cleanup complete, existing remote branches retained per operator restriction (AC8).
- [x] Comprehensive review (AC9); Codex force-push verification (AC10).

#### Comprehensive review checklist (owner requires this at the end; fix all findings; record each finding as a P1–P4 row in Review)

- Cross-repo contract: `plugins/sp/hooks/hooks.json` ids/events/matchers/timeouts vs superskill lookup (`hooks/<id>.*` then `scripts/hooks/<id>.*`) and staging (`.agents/scripts/<plugin>/hooks/`); every hook id resolves to a file on every install layout (Claude cache, omp cache, Grok installed-plugins, staged, Pi extensions).
- Hook output formats (allow silent / deny+reason / ask / block+reason) vs `apps/cli/src/hook-host.ts` renderers for Claude, Codex, omp, Grok, Pi, including fail-closed ask on non-Claude hosts and timeout = hooks.json − 500 ms.
- Stale references (rg across skills, commands, docs, README, ADRs, CHANGELOG, `.spur/rules`, config/rules): `spur self hook`, lazy loading, `--splitting`, old `hook run` naming, `superskill script path sp`, `bun plugins/sp/scripts/…`, `scripts/test-shims`, `guard-extension`.
- Deleted scripts referenced anywhere: rg every deleted path/basename from #15 #20–#26 and PR-8 (incl. `.mjs` twins and `*.generated.*`).
- `config/plugin-scripts.json` and `.mjs` twins consistent (until PR-8 deletes both); `script-placement-baseline.json` entries match reality.
- `spur <noun> --help`, `docs/help/cmd_*.md`, `docs/help2/*.md`, `docs/help/spur-cli-matrix.md` (counts), `plugins/sp/skills/spur-cli/references/*.md` and `check-cli-surface.yaml` all match registered commands (`help-docs-parity`, `cli-surface-parity` tests).
- Coverage: every new module from these PRs >= 90% line and function (check the gate's per-file table, not just totals).
- `config/transition-shims.json`: each remaining entry still needed; remove ones whose target no longer exists.
- Docs vs behaviour: plan doc, ADR-130 amendment, `docs/design/harness-surface-governance.md` noun freeze (builder: bump-ver, drop-tags, pr, publish), cli-contracts, plugins/sp/README.
- No TODO/FIXME/XXX added by these PRs (`git diff origin/main@{2026-10-14}..main | rg '^\+.*(TODO|FIXME|XXX)'`).
- superskill genericity: mapper, hook-host, Pi adapter and docs contain no `sp`/spur-specific references (rg `\bsp/|spur` in superskill apps/ and docs/).
- bunfig.toml (root, scripts/) unchanged vs main@2026-10-14.




#### Current execution contract — 2026-10-15

The operator now requires ready PRs to land together through a reviewed development branch, followed by main only after the integrated gate and CI pass. This replaces the earlier per-PR merge-main/full-gate choreography; original commits are preserved with merge commits, no rebase or force push.

Two cohesive implementation tasks remain; they are deliberately not executed by the landing reviewer:

1. Task 1212: complete draft PR #26 (PR-9), its four known CLI documentation/flag parity failures, coverage proof, release/migration safety tests and callers.
2. Task 1213 (depends on 1212): retire the exhausted script-root/generated/build/baseline infrastructure (PR-8), preserve plugin-owned hooks and required libs, and finalize the distribution/prerequisite documentation.

Both are linked to existing active feature A91. Their acceptance criteria are task-local refinements of its consolidation scope; A9 remains completed. The parent retains integration, cross-repo review, acceptance and final cleanup. Child submission requires the exact tested head, gate/coverage receipts and root reviewer acceptance before landing; no task is done merely because its PR exists.

PR-10's context-shim implementation is closed as obsolete. The plugin's documented minimum is Spur 0.5.0, following the approved clean break; optional runtime minimum-version enforcement and diagnostics are explicitly deferred. No unsupported manifest field or replacement compatibility layer is introduced. This resolves the handoff's explicit choice to re-scope or close PR-10.

Current layout supersedes historical plan summaries: `hooks/` retains the registry; registered executable entries live in `scripts/hooks/`, with plugin hook-only libs. Non-hook reusable scripts move to approved CLI nouns. The final retirement is task 1213, not a claim that the present integrated tree has no infrastructure remaining.

Remote deletion authorization covers the newly created integration dev branch after a successful landing. Keep pre-existing PR/abandoned remote branches unless the operator separately authorizes their deletion; historical `/workspace` worktrees do not exist in this checkout.

<!-- AUTO-GENERATED by spur task refresh-roster -->
| WBS | Sub-task | Status |
| --- | -------- | ------ |
| 1212 | Complete PR-9 release and workflow-cost CLI absorption | done |
| 1213 | Retire obsolete script infrastructure and finalize the sp CLI prerequisite | done |
<!-- END AUTO-GENERATED -->

### Root Cause

N/A — handoff/meta task.

### Solution

Ready-stack integration landed through Spur #28 after Superskill 0.3.39 publication; the completed children landed through #26 (merge 4c7808e62). Tasks 1212/1213 are done with PASS verdicts, no residual findings and a required full gate: 11,109 tests, zero failures, all typechecks, all 53 pre/post rules, unchanged coverage configuration. Final review repaired eager database boot writes before self migrate --check; actual CLI and bundle regressions now prove absence/schema preservation.

The operator-approved combined dev-branch landing replaces the original per-PR gate sequence. The children were implemented locally together before final acceptance; this historical ordering deviation is disclosed, and their combined result was accepted after fresh checks. Workflow-promotion intentionally retains its selected-run domain query: aggregate workflow cost output is not equivalent. This reconciles the original AC1 substitution wording with the ready-audit decision recorded in task 1212.

PR-8 and all final inventory dispositions are complete. The plan now records final PR/S-1/Q1–Q7 status and an explicit final checklist while preserving original proposals as history. PR-10 is closed; Spur >=0.5.0 is documented, optional runtime enforcement deferred, with no invented manifest field. I3 still verifying requires retaining its inventory tool/test. The live agent-bare-binary-name shim remains for its recorded caller compatibility.

Superskill #3/#4 descriptions accurately distinguish fail-closed unconfirmable asks from fail-open runtime failures and state native Pi capabilities and test limits. Pinned-runtime isolated Codex installation resolves seven hook identities and verifies timeout margins and inert force-push denial. Superskill hook renderer/runner/Pi/install/omp suites pass 109 tests; CLI parity/migration suites pass 24 tests. No real publication, force push or Pi TUI operation was performed.

Cleanup is complete within authorization: each repository has one live main worktree and temporary integration/fix branches are removed. Historical /workspace worktrees are absent. Existing remote PR/abandoned branches are retained under the explicit operator restriction, rather than deleted without consent. No implementation follow-up remains. Final acceptance record/doc changes are intentionally uncommitted for the operator's next step.

Concrete anchors: `apps/cli/src/index.ts:94` bypasses boot for migration checks; `docs/plans/2026-10-14-spur-script-absorption.md:30` records accepted PR-9.


Post-acceptance direct alignment (operator request): current plugin facade, skills, commands, subagents and all shared workflows were reviewed against CLI/application sources. Corrected flags/output/exit/receipt contracts, retired-script guidance and inline record lifecycle suppression; history rescue now handles the existing runtime-plus-entry invocation. `config/workflows/history-anatomy.yaml:259` is covered by the new behavioral regression. Full findings and verification: `docs/reports/2026-10-15-sp-plugin-workflow-alignment.md:15`. No new task or CLI surface. The existing spaced-launch-string restriction is documented, not claimed fixed.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Task1212 PASS and merged PR26; focused CLI parity/migration tests pass24, full gate11109/0 and changed measured coverage >=90%; migration startup fix has real CLI/bundle absence/schema proofs. Selected-run promotion query intentionally retained per ready-audit decision, reconciling original aggregate substitution wording. Evidence: @acceptance `.spur/run/1211-acceptance/acceptance-checks.json` lines 1-20; @gate `.spur/run/verifyall-1212-1213/full-gate-fixed.log` lines 38-595. |
| R2 | MET | Task1213 PASS; layout/checker assertions and isolated seven-hook installation pass. No resolver/manifest/twin/baseline/build machinery remains; I3 inventory kept with current reason. Evidence: @acceptance `.spur/run/1211-acceptance/acceptance-checks.json` lines 1-20; @gate `.spur/run/verifyall-1212-1213/full-gate-fixed.log` lines 38-595. |
| R3 | MET | Plan closes PR10 and documents Spur >=0.5.0; optional runtime enforcement explicitly deferred, no new manifest field. Evidence: @acceptance `.spur/run/1211-acceptance/acceptance-checks.json` lines 1-20; @gate `.spur/run/verifyall-1212-1213/full-gate-fixed.log` lines 38-595. |
| R4 | MET | Superskill0.3.39 published before #28 landing; native Pi adapter replaces plugin-owned extension; README documents supported release and reinstall. Actual Codex install and Pi generated-extension harness pass. Evidence: @acceptance `.spur/run/1211-acceptance/acceptance-checks.json` lines 1-20; @gate `.spur/run/verifyall-1212-1213/full-gate-fixed.log` lines 38-595. |
| R5 | MET | Fresh GitHub API confirms superskill PR3/4 merged and corrected bodies distinguish fail-closed ask, fail-open errors and Pi1.2.0/0.85.1 harness/history limits. No real Pi TUI run is asserted. Evidence: @acceptance `.spur/run/1211-acceptance/acceptance-checks.json` lines 1-20; @gate `.spur/run/verifyall-1212-1213/full-gate-fixed.log` lines 38-595. |
| R6 | MET | Owner-approved combined landing replaces historical per-PR choreography; #28 and #26 preserve ancestry, exact tested source cfa2d9719 passed full gate and CI. Both child tasks were implemented before final acceptance; this timing deviation is disclosed in Solution and accepted combined review. Evidence: @acceptance `.spur/run/1211-acceptance/acceptance-checks.json` lines 1-20; @gate `.spur/run/verifyall-1212-1213/full-gate-fixed.log` lines 38-595. |
| R7 | MET | Current plan frontmatter, PR/S-1/Q1-Q7 dispositions, inventory groups and final checklist now describe accepted implementation. Historical proposals explicitly remain superseded. Evidence: @acceptance `.spur/run/1211-acceptance/acceptance-checks.json` lines 1-20; @gate `.spur/run/verifyall-1212-1213/full-gate-fixed.log` lines 38-595. |
| R8 | MET | Fresh git worktree list in both repositories shows only live main trees; new integration/fix branches removed. Historical /workspace worktrees absent; existing remote branches retained under explicit owner restriction recorded in current execution contract. Evidence: @acceptance `.spur/run/1211-acceptance/acceptance-checks.json` lines 1-20; @gate `.spur/run/verifyall-1212-1213/full-gate-fixed.log` lines 38-595. |
| R9 | MET | Cross-repo109 tests, CLI parity24 tests, traversal regression and spaced argv regression pass; checker/shim scans pass. Review records every integration finding RESOLVED and documents approved design/cleanup/test boundaries. Evidence: @acceptance `.spur/run/1211-acceptance/acceptance-checks.json` lines 1-20; @gate `.spur/run/verifyall-1212-1213/full-gate-fixed.log` lines 38-595. |
| R10 | MET | Actual isolated pinned-runtime Codex install resolves all7 identities, verifies5/10/15-second deadline margins, inert git push --force yields exit2 with reason and safe git status is silent0. No real push executed. Evidence: @acceptance `.spur/run/1211-acceptance/acceptance-checks.json` lines 1-20; @gate `.spur/run/verifyall-1212-1213/full-gate-fixed.log` lines 38-595. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — PR-9 is complete and green (req: R1) | MET | command | Task1212 PASS and merged PR26; focused CLI parity/migration tests pass24, full gate11109/0 and changed measured coverage >=90%; migration startup fix has real CLI/bundle absence/schema proofs. Selected-run promotion query intentionally retained per ready-audit decision, reconciling original aggregate substitution wording. Evidence: @acceptance `.spur/run/1211-acceptance/acceptance-checks.json` lines 1-20; @gate `.spur/run/verifyall-1212-1213/full-gate-fixed.log` lines 38-595. |
| AC2 — PR-8 retires the script infrastructure (req: R2) | MET | command | Task1213 PASS; layout/checker assertions and isolated seven-hook installation pass. No resolver/manifest/twin/baseline/build machinery remains; I3 inventory kept with current reason. Evidence: @acceptance `.spur/run/1211-acceptance/acceptance-checks.json` lines 1-20; @gate `.spur/run/verifyall-1212-1213/full-gate-fixed.log` lines 38-595. |
| AC3 — PR-10 decision recorded (req: R3) | MET | command | Plan closes PR10 and documents Spur >=0.5.0; optional runtime enforcement explicitly deferred, no new manifest field. Evidence: @acceptance `.spur/run/1211-acceptance/acceptance-checks.json` lines 1-20; @gate `.spur/run/verifyall-1212-1213/full-gate-fixed.log` lines 38-595. |
| AC4 — Pi guard-extension retired safely (req: R4) | MET | command | Superskill0.3.39 published before #28 landing; native Pi adapter replaces plugin-owned extension; README documents supported release and reinstall. Actual Codex install and Pi generated-extension harness pass. Evidence: @acceptance `.spur/run/1211-acceptance/acceptance-checks.json` lines 1-20; @gate `.spur/run/verifyall-1212-1213/full-gate-fixed.log` lines 38-595. |
| AC5 — superskill PR descriptions current (req: R5) | MET | command | Fresh GitHub API confirms superskill PR3/4 merged and corrected bodies distinguish fail-closed ask, fail-open errors and Pi1.2.0/0.85.1 harness/history limits. No real Pi TUI run is asserted. Evidence: @acceptance `.spur/run/1211-acceptance/acceptance-checks.json` lines 1-20; @gate `.spur/run/verifyall-1212-1213/full-gate-fixed.log` lines 38-595. |
| AC6 — Stack merged in order (req: R6) | MET | command | Owner-approved combined landing replaces historical per-PR choreography; #28 and #26 preserve ancestry, exact tested source cfa2d9719 passed full gate and CI. Both child tasks were implemented before final acceptance; this timing deviation is disclosed in Solution and accepted combined review. Evidence: @acceptance `.spur/run/1211-acceptance/acceptance-checks.json` lines 1-20; @gate `.spur/run/verifyall-1212-1213/full-gate-fixed.log` lines 38-595. |
| AC7 — Plan doc final status (req: R7) [docs-only] | MET | command | Current plan frontmatter, PR/S-1/Q1-Q7 dispositions, inventory groups and final checklist now describe accepted implementation. Historical proposals explicitly remain superseded. Evidence: @acceptance `.spur/run/1211-acceptance/acceptance-checks.json` lines 1-20; @gate `.spur/run/verifyall-1212-1213/full-gate-fixed.log` lines 38-595. |
| AC8 — Abandoned worktrees and branches cleaned (req: R8) | MET | command | Fresh git worktree list in both repositories shows only live main trees; new integration/fix branches removed. Historical /workspace worktrees absent; existing remote branches retained under explicit owner restriction recorded in current execution contract. Evidence: @acceptance `.spur/run/1211-acceptance/acceptance-checks.json` lines 1-20; @gate `.spur/run/verifyall-1212-1213/full-gate-fixed.log` lines 38-595. |
| AC9 — Comprehensive review clean (req: R9) | MET | command | Cross-repo109 tests, CLI parity24 tests, traversal regression and spaced argv regression pass; checker/shim scans pass. Review records every integration finding RESOLVED and documents approved design/cleanup/test boundaries. Evidence: @acceptance `.spur/run/1211-acceptance/acceptance-checks.json` lines 1-20; @gate `.spur/run/verifyall-1212-1213/full-gate-fixed.log` lines 38-595. |
| AC10 — careful-guard force-push block on Codex (req: R10) | MET | command | Actual isolated pinned-runtime Codex install resolves all7 identities, verifies5/10/15-second deadline margins, inert git push --force yields exit2 with reason and safe git status is silent0. No real push executed. Evidence: @acceptance `.spur/run/1211-acceptance/acceptance-checks.json` lines 1-20; @gate `.spur/run/verifyall-1212-1213/full-gate-fixed.log` lines 38-595. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Scope: final integration of script absorption and hook portability across Spur and Superskill, including both accepted children; all SECUA dimensions reviewed. Final disposition: PASS, no open P1–P3 findings.

| Priority | Dimension | Location | Finding | Disposition |
| --- | --- | --- | --- | --- |
| P2 | Security | apps/cli/src/artifact-id.ts | Artifact identity traversal found during integration; input validation and regression tests landed in #28. | RESOLVED |
| P2 | Correctness | packages/app/src/workflow/wrapup/spur-command.ts | Nested launch argv failed for paths with spaces; argv preservation and regression checks landed in #28. | RESOLVED |
| P2 | Security | plugins/sp/hooks/hooks.json | Stale fail-open ask documentation conflicted with non-Claude deny policy; cross-repo docs and rendered behavior now agree. | RESOLVED |
| P2 | Correctness | plugins/sp/hooks/hooks.json | Staged installs lost declared deadlines; Superskill 0.3.39 metadata fix and actual isolated 5/10/15-second probes prove the 500 ms margin. | RESOLVED |
| P2 | Correctness | apps/cli/src/index.ts | Eager boot wrote DB before migration --check; fixed at cfa2d9719 with actual CLI absent/schema and bundle checks. | RESOLVED |
| P3 | Usability | docs/plans/2026-10-14-spur-script-absorption.md | Current plan still called accepted tasks/PR26 unfinished; final disposition/checklist now match delivered state. | RESOLVED |
| P4 | Architecture | scripts/commands/workflow-promotion.ts | Aggregate workflow cost cannot preserve promotion selected-run distribution; retain original domain query per ready-audit decision. | RESOLVED — documented design reconciliation |
| P4 | Operations | docs/plans/2026-10-14-spur-script-absorption.md | Original remote-branch deletion scope exceeds operator consent; temporary branches cleaned, original branches retained explicitly. | RESOLVED — owner-approved retention |
| P4 | Verification | plugins/sp/README.md | Native Pi behavior is proven by generated-extension harness; no fresh real Pi TUI run is claimed, matching corrected superskill PR4 description. | RESOLVED — documented test boundary |

Checklist: hook identities/layouts, neutral outputs/asks/errors/deadlines, genericity, deleted consumers, command/help/matrix parity, measured coverage, live shim need, contract docs and unchanged bunfig files checked. Retired-name matches in task/plan/ADR history and negative test fixtures are preserved as evidence. Added TODO matches are a test fixture variable, not unfinished production work. Receipts: .spur/run/1211-acceptance/ and .spur/run/verifyall-1212-1213/full-gate-fixed.log.


Direct plugin/workflow alignment after acceptance (operator-authorized):

| Priority | Dimension | Location | Finding | Disposition |
| --- | --- | --- | --- | --- |
| P2 | Correctness | config/workflows/history-anatomy.yaml | Whole-value quoting prevented multi-part CLI launch in rescue; runtime/entry behavioral regression now passes. | RESOLVED |
| P2 | Correctness | plugins/sp/skills/spur-check/SKILL.md | Gate exit and receipt claims diverged from application modes; current CLI contract restored. | RESOLVED |
| P3 | Usability | plugins/sp/skills/spur-cli/references/tasks.md | Unsupported global flag claims and missing absorbed cost/release guidance corrected across facade references. | RESOLVED |
| P3 | Architecture | plugins/sp/skills/code-implementation/SKILL.md | Worker and PR guidance invoked retired resolver/twin machinery; native CLI ownership restored. | RESOLVED |
| P3 | Correctness | plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md | Record snippet omitted lifecycle suppression; added no-lifecycle and matching workflow assertion. | RESOLVED |
| P4 | Compatibility | packages/app/src/workflow/split-launch-command.ts | Existing explicit spaced-launch-string ceiling retained; facade now documents it. No new runtime capability is asserted. | ACCEPTED — existing transport contract |

### References

- Plan: `docs/plans/2026-10-14-spur-script-absorption.md` (on #15; Revision 2026-10-15; PR table §9).
- spur PRs: https://github.com/gobing-ai/spur/pull/15, /20, /21, /22, /23, /24, /25, /26 (closed: /16, /17, /18, /19).
- superskill PRs: https://github.com/gobing-ai/superskill/pull/3, https://github.com/gobing-ai/superskill/pull/4.
- Gate logs: /workspace/gate-logs/{pr6b,pr7d,hookfix-pi-retire2}.log (GATE_EXIT=0).
- ADR-130 (script placement) and its amendment in #23; tasks 1173–1178 (A91), A9 plan.

### History

- 2026-10-15T17:50:40.395Z todo → wip (system)
- 2026-10-15T22:59:13.879Z wip → testing (system)
- 2026-10-15T22:59:14.611Z testing → done (system)

