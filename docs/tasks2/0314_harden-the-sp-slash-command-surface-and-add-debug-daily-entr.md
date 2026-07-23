---
template: feature-impl
schema_version: 1
name: "Harden the sp slash-command surface and add debug/daily entry points"
description: ""
status: done
type: task
profile: standard
feature_id: O
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-22T23:19:26.674Z"
updated_at: "2026-07-23T11:31:50.000Z"
---

## 0314. Harden the sp slash-command surface and add debug/daily entry points

### Background
The `sp` plugin currently ships 28 hand-authored thin command wrappers, 25 skills, 3 specialist agents, 10 project workflows, hooks, executable helpers, and behavioral/contract tests. `superskill install sp --targets codex --dry-run --verbose` detects all 28 commands and stages all 28 command-derived Codex skills; the conversion boundary is healthy.

The wrappers themselves are already minimal (18–22 lines) and pass the four thin-wrapper gates. The remaining friction is semantic and discoverability drift, evidenced against the current tree:

- `dev-review` advertises `[<wbs|path>]`, `--fix`, and `--next` (`commands/dev-review.md`), but its backing `sp:super-reviewer` is explicitly no-implementation ("You **never** implement fixes" — `agents/super-reviewer.md`), and its three backing skills have different mutation and target contracts. Path mode cannot run task-requirements traceability, and `--fix` has no backing owner that can honor it.
- `dev-handover`'s inline procedure (`dev-operations.md` §11) writes the full handover into the task's `## Notes` via `spur task update <wbs> --section Notes --from-file`. **`Notes` *is* a supported universal section** (`UNIVERSAL_SECTIONS = ['History','References','Notes']`, `planning-write-service.ts`) and the write upserts, so the call succeeds — the real defect is that a full-section replace clobbers any pre-existing `Notes` content, and that the `sp:spur-cli` section docs (`references/tasks/section-editing.md`) omit `Notes`/`Requirements`/`Q&A`/`Design`, so the reference and the live matrix disagree. Frame the fix as destructive-overwrite avoidance plus doc reconciliation, not "unsupported section."
- `plugins/sp/README.md` reports plugin version `0.3.18` while `plugin.json` is `0.3.20`, and README's `dev-review` line describes it as SECUA-only while the command file claims functional + SECUA + architecture — surface docs have drifted from the wrappers. Note `dev-operations.md` intentionally covers only the 16 numbered spine operations (not all 28 commands); the full 28-command inventory lives in README. The two are complementary, not a single broken inventory — reconcile them into one non-overlapping taxonomy rather than treating `dev-operations.md` as the failed full index.
- The mature `sp:sys-debugging` and `sp:daily-summary` skills represent frequent, explicit daily jobs but have no discoverable `/sp:dev-*` entry points. The `daily-summary` script still honors the stale `RD3_DAILY_SUMMARY_NO_PROMPT` env var (`scripts/daily-summary/daily-summary.ts`), and its SKILL.md carries a stale script link (`scripts/daily-summary.ts` vs the real `scripts/daily-summary/daily-summary.ts`).
- The `sp:spur-cli` facade is incomplete relative to the monorepo CLI: the task reference omits the shipped `task deps`, `task sections`, and `task run-link` verbs (`references/tasks/verbs.md` has no entries for them, though all three exist in `apps/cli/src/commands/task.ts`), and documents an obsolete section-name set. Agents following the skill fall back to `spur --help` / per-verb help, which burns tokens, drifts across sessions, and invites invented flags when help output is skimmed poorly.

This task hardens the public command surface without count-driven deletion, without moving lifecycle prose back into wrappers, and without committing per-platform adapters. Existing commands stay unless a specific flag is proven redundant and receives a compatibility path. For `sp:spur-cli`, the goal is **bounded**: close the evidenced gaps (missing verbs, stale sections) and make the four high-frequency nouns executable from the reference alone — not to mirror the entire CLI surface.
### Requirements
- R1. Preserve commands-as-SSOT and the thin-wrapper architecture. Every command file must contain only frontmatter, H1, `Usage`, and `Implementation`; domain behavior remains in skills, workflows, CLI, or the existing authoritative reference. Do not commit generated Codex/platform adapters.

- R2. Audit all 28 command contracts against their backing skill/workflow/reference — target modes, flags, mutation behavior, allowed tools, and output ownership — and fix every mismatch the audit **evidences**. Only `dev-review` and `dev-handover` are pre-evidenced mismatches (see Background); `dev-fixall`, `dev-plan`, `dev-run`, `dev-runall`, `dev-wrap`, and `dev-wrapall` are *candidates to check*, not known-bad — change one only if the audit (Plan step 1) produces file/CLI/test evidence. Retain an existing command or flag unless removal has subsumption evidence, a migration note, and at least one-release compatibility behavior.

- R3. Simplify `dev-review` into deterministic modes. WBS mode runs functional traceability + SECUA + architecture and may write `Review`; path mode skips task-only functional traceability and emits an advisory report without task mutation. Resolve the current `--fix`/`--next` contradictions explicitly: recommended disposition is to deprecate them on `dev-review`, route task remediation through `dev-verify --fix` or a task pipeline, and route progression through `dev-next`. Any different disposition must preserve `sp:super-reviewer`'s no-implementation contract and be tested.

- R4. Repair `dev-handover` so it never overwrites unrelated durable content and so its reference docs match the live section matrix. The handover MUST land in a standalone `docs/handover/<YYYY-MM-DD>-<slug>.md` artifact (the durable SSOT). Any task association is an **append-only pointer**: write a one-line reference into the task's `References` section (or append to `Notes` without replacing existing content) rather than replacing `Notes` wholesale — `spur task update --section Notes --from-file` upserts and would clobber pre-existing `Notes` body. (`Notes` itself is a supported universal section; the defect is the destructive full-section replace plus `references/tasks/section-editing.md` omitting `Notes`/`Requirements`/`Q&A`/`Design`, not an unsupported target.) Preserve redaction and no-duplication rules; add a test proving an existing `Notes`/`References` body survives a handover.

- R5. Add a thin `dev-debug` command backed by `sp:sys-debugging`. Define a small explicit input contract for a symptom or failing command plus optional scope/task capture. The backing skill remains the SSOT for reproduce → isolate → root cause → minimal fix → regression test, and issue-task creation goes through `spur task create --template issue` plus CLI-gated section writes.

- R6. Add a thin `dev-daily` command backed by `sp:daily-summary`, exposing the script's existing `--date`, `--dry-run`, `--output`, `--no-git`, and `--no-ccusage` modes. Normalize the stale `RD3_DAILY_SUMMARY_NO_PROMPT` environment variable to an SP-owned name (e.g. `SP_DAILY_SUMMARY_NO_PROMPT`) with a documented compatibility window where the old name still works, fix the stale SKILL.md script link, and keep missing optional telemetry tools (ccusage, etc.) graceful.

- R7. Close the evidenced `sp:spur-cli` gaps and make the four high-frequency nouns executable from the reference alone — not a thin pointer that forces agents to re-query `spur --help`. Scope is the **evidenced delta, not a full CLI mirror**.
  - **Tier A — executable without `--help`:** `task`, `feature`, `rule`, `workflow`. For `task`, add the currently-missing `deps`, `sections`, and `run-link` verbs and correct the canonical section set (`references/tasks/section-editing.md` today lists `Background, Acceptance Criteria, Plan, Solution, Testing, Review, References, History` and omits `Requirements`, `Q&A`, `Design`, and universal `Notes`). Each shipped verb gets a copy-pasteable invocation, key flags, `--json` shape where it emits JSON, exit codes, and the CLI-gated write contract. Document from `apps/cli/src/commands/*.ts` / live `--help`; do not invent flags.
  - **Tier B — light index (invoke-level, not encyclopedia):** `status` and `init` (flags + when-to-use), plus a one-line router for the remaining top-level nouns (`agent`, `history`, `message`, `team`, `migrate`, `serve`) pointing to `--help` for deep flags.
  - **Tier C — last-resort `--help`:** deep long-tail for the Tier B nouns; do not dump raw full-tree help prose into any reference.
  - **Layering:** `SKILL.md` stays a lean noun router; catalogs live under `references/`. Update `tasks.md`, `tasks/verbs.md`, `tasks/section-editing.md`, and peer noun references only as the delta requires.
  - **Agent contract:** load `sp:spur-cli` → execute; shell `spur <noun> <verb> --help` only for version skew, unlisted long-tail, or a failing parity assertion — not as the default per-turn lookup.

- R8. Replace stale surface prose with one consistent taxonomy: golden path (`dev-next`, `dev-idea`, `dev-plan`), explicit pipeline controls, verification/quality, diagnostic/recovery, wrap/close, utilities, and authoring. Update `dev-operations.md`, `plugins/sp/README.md`, and any stage-registry mappings/count assertions so every command appears exactly once in the primary inventory and deliberate aliases are labeled rather than double-counted. Keep the `dev-operations.md` 16-spine-operation scope and the README 28-command inventory complementary — reconcile, do not merge one into the other.

- R9. Extend automated contracts beyond structural thinness: verify command filename/frontmatter/Usage parity, README inventory parity (updated count including `dev-debug`/`dev-daily`), target-mode dispatch for `dev-review`, safe handover destination behavior (existing-content preservation), `dev-debug`/`dev-daily` dispatch, converter staging of every command-derived Codex skill, and (where practical) spur-cli reference ↔ live CLI verb coverage for the Tier A noun set. Keep tests implementation-independent where Superskill owns conversion.

- R10. Apply least privilege to command `allowed-tools` after tracing actual wrapper behavior. Direct workflow wrappers must not retain Write/Edit solely because spawned workflow steps mutate; interactive surfacing may retain the minimum required HITL tool. Explicitly re-check `dev-review` (currently `Write`) and `dev-handover` (currently `Write`) against their post-R3/R4 behavior. Record any exception.

- R11. Update same-commit surface documentation required by T3 (`docs/04_DESIGN.md`, `plugins/sp/README.md`, and relevant AGENTS command index/count text) and add a changelog entry. Keep `plugin.json`, marketplace metadata, and documented version synchronized if this work changes the plugin version. Align AGENTS / skill wording so agents treat `sp:spur-cli` as the execute-from-reference path and `--help` as last-resort, not the default lookup.

- R12. Verify the result through the command validator, plugin tests/hooks, full project quality gate, and `superskill install sp --targets codex --dry-run --verbose`. Fresh-session dogfood both new commands; do not claim conversion coverage from counts alone — assert the expected staged command-derived skill names. For spur-cli, dogfood that a cold agent can run at least one each of `task`/`feature`/`rule`/`workflow` Tier A recipes using only the skill references (no `--help`).
### Acceptance Criteria
```gherkin
Feature: Coherent and discoverable sp command surface

  Scenario: R2/R12 - Audit is evidence-grounded and gates are green
    Given the current command, skill, agent, workflow, hook, script, and test inventory
    When the command surface audit is completed
    Then every mismatch is tied to current file, CLI help, or executable-test evidence
    And the command validator, plugin tests, hooks tests, lint, test, test-cf, and build gates exit zero
    And git status contains only intentional changes

  Scenario: R3/R5/R6 - Hardened surface delegates to real backing owners
    Given the current 28 command wrappers and the mature sys-debugging and daily-summary skills
    When the operator surface is hardened
    Then every retained command resolves to its real backing skill, workflow, or procedure
    And dev-debug delegates the reproduce-isolate-root-cause-fix-regress protocol without copying it into the wrapper
    And dev-daily delegates the existing date, dry-run, output, no-git, and no-ccusage modes
    And dev-review resolves WBS mode to task traceability plus SECUA plus architecture with CLI-gated writeback
    And dev-review resolves path mode to advisory SECUA plus architecture without task mutation
    And dev-next remains the primary one-dispatch lifecycle facade

  Scenario: R2 - Compatibility retirement is controlled
    Given an existing command or flag is redundant or contradicts its backing owner
    When its disposition is implemented
    Then removal requires subsumption evidence and an actionable migration note
    And compatibility behavior remains for at least one release
    And no surface is removed merely to reduce the command count

  Scenario: R4 - Handover stays harness-gated and non-destructive
    Given a blocked task or session and the current task CLI section matrix
    When dev-handover creates and associates a durable handover
    Then the handover lands in docs/handover/<YYYY-MM-DD>-<slug>.md as the durable artifact
    And any task association is an append-only pointer via a supported CLI-gated section (References or Notes)
    And existing unrelated task content is preserved, never replaced wholesale

  Scenario: R7 - sp:spur-cli is an executable surface SSOT
    Given the monorepo spur CLI verbs for task, feature, rule, and workflow
    When an agent loads sp:spur-cli references without running spur --help
    Then high-frequency verbs (including task deps, sections, and run-link) have copy-pasteable recipes, key flags, --json shapes, and exit codes
    And the canonical task section contract matches the live matrix (including Requirements, Q&A, Design, and universal sections)
    And SKILL.md stays a lean router while references hold the catalogs
    And long-tail nouns are lightly indexed or last-resort --help only — not a raw full-tree help dump
    And AGENTS/skill prose directs agents to execute from the skill first and use --help only for skew or unlisted long-tail

  Scenario: R9/R1 - Converter staging covers every command
    Given the updated plugin command directory
    When superskill install sp --targets codex --dry-run --verbose runs
    Then every command basename has a corresponding staged sp-prefixed Codex skill
    And dev-debug and dev-daily are included
    And no generated platform adapter is committed in plugins/sp
    And a converter defect is fixed in Superskill rather than worked around in this plugin
```
### Q&A
**Q: Should `sp:spur-cli` embed the useful CLI surface so LLMs execute without `spur --help`?**

**A (2026-07-22): Yes.** Reframe R7 from "patch missing task verbs" to "executable CLI surface SSOT."

Rationale:

- The skill already claims to be the verb SSOT ("if a flag isn't listed, it doesn't exist"), but incomplete/stale references force help re-queries and invent-flags failure modes.
- Help-as-primary is costly (tokens/latency), session-fragile, and poorly structured for copy-paste execution compared with curated recipes + JSON shapes.
- Lifecycle agents (`sp:super-coder`, `sp:expert-spur`, spine) need deterministic invoke paths for corpus mutation; those should not depend on parsing Commander help text.

Scoped so it stays maintainable:

- **Deep embed:** `task` / `feature` / `rule` / `workflow` high-frequency verbs (full useful surface).
- **Light index:** `status`, `init`, and a one-line router for other top-level nouns.
- **Last-resort `--help`:** deep long-tail for `agent` / `history` / `message` / `team` / `migrate` / `serve`.
- Authority remains the live monorepo CLI; skill mirrors it with parity checks where practical — never invent flags, never dump raw full-tree help into SKILL.md.
### Design
Keep the current three-layer ownership model: commands are hand-editable entry adapters; skills/references own reasoning and procedures; Spur CLI/workflows own deterministic mutation, gates, and sequencing. Superskill remains the only platform-conversion owner.

Add only two command entry points because they expose distinct, frequent operator jobs with stable argument contracts: `dev-debug` for incident/root-cause work and `dev-daily` for end-of-day reporting. Do not add wrappers for `spur-tdd`, `source-driven-development`, `indexed-context`, `doubt-driven-development`, or `doc-evolve`: they are composed disciplines, automatically triggered context, or intentionally direct skills and would add names without a distinct command contract.

Retain the established overlapping commands where the boundary is real:

- `dev-idea` vs `dev-plan`: vague discovery intake vs already-written feature description.
- `dev-arch` vs `dev-reverse`: standing deep-module upkeep survey vs general reverse-engineering/audit package.
- `dev-review` vs `dev-verify`: advisory/mid-pipeline quality review vs requirements/AC completion verdict and done gate.
- `dev-runall` vs `dev-parallel`: dependency-ordered batch pipeline vs explicitly requested general fan-out/review/investigation.

The simplification target is contract ambiguity, not raw command count. Resolve path/WBS mode before dispatch, remove or deprecate flags whose backing owner cannot honor them, centralize the definitive inventory/taxonomy, and test behavior at the adapter seam. Any surface change follows T3 and the ADR-032 commands-as-SSOT decision.

**`sp:spur-cli` as executable surface SSOT**

`sp:spur-cli` is the **execute-from-reference** path for the useful `spur` CLI surface. Design constraints:

1. **Layering stays:** `SKILL.md` = noun router + conventions; `references/<noun>.md` + `references/<noun>/*` = verb catalogs with recipes, flags, `--json` shapes, exit codes. Do not bloat the skill frontmatter body with full catalogs.
2. **Coverage tiers:**
   - **Tier A (must run without `--help`):** `task`, `feature`, `rule`, `workflow` — all useful shipped verbs, including currently missing task `deps` / `sections` / `run-link` and the live canonical section matrix.
   - **Tier B (light index):** `status`, `init`, and a short top-level noun map for remaining commands.
   - **Tier C (last-resort `--help`):** deep long-tail for agent/history/message/team/migrate/serve.
3. **Evidence-backed, curated:** document from monorepo CLI source/`--help`; prefer worked examples over help-transcript dumps. Unknown flags are not invented.
4. **Parity where cheap:** tests or a small check that Tier A verb names in references ⊆ live CLI help (and critical missing verbs fail loud). Full flag-matrix generation is optional if maintenance cost dominates; verb presence + critical flag smoke is enough for this task.
5. **Agent contract:** AGENTS / skill prose say: load `sp:spur-cli` and execute; use `spur … --help` only for version skew, unlisted long-tail, or when a parity assertion fails — not as the default lookup every turn.
### Plan
1. Re-run the command/skill/workflow inventory and produce a 28-command parity table: operator job, target, supported modes/flags, mutation class, and disposition. Use current source/`--help`, not task 0283's historical counts.
2. Define and implement deterministic `dev-review` WBS/path routing; deprecate or otherwise reconcile `--fix` and `--next`; add behavior tests for both modes and mutation boundaries.
3. Fix `dev-handover` durable output and task-link behavior against current `task sections`/`task update` capabilities; add preservation/redaction tests.
4. Add thin `commands/dev-debug.md`; update `sp:sys-debugging` only for the minimal public argument/output contract and task-capture path; add command and behavior tests.
5. Add thin `commands/dev-daily.md`; normalize the daily-summary environment/resource naming with backward compatibility; reuse the existing tested script rather than duplicating it.
6. Reconcile the remaining evidenced flag/backing drift (`dev-fixall`, plan/run/runall/wrap variants) and trim `allowed-tools` to the traced minimum.
7. **Expand `sp:spur-cli` into an executable surface SSOT (R7):**
   - Inventory live monorepo verbs for Tier A nouns (`task`/`feature`/`rule`/`workflow`) and Tier B light-index (`status`/`init` + top-level map).
   - Update task references for `deps`, `sections`, `run-link`, current canonical sections, JSON shapes, exit codes; fix obsolete section-name sets.
   - Refresh peer noun references so high-frequency recipes are complete enough to execute without `--help`.
   - Keep SKILL.md as lean routing; add explicit "execute from skill; `--help` last-resort" contract.
   - Add practical reference↔CLI parity assertions (at least Tier A verb coverage); avoid raw full-tree help dumps.
8. Refresh the single command taxonomy/inventory, README counts/version, stage-registry mappings, command-count tests, and T3 docs/AGENTS/changelog surfaces (including the spur-cli execute-first wording).
9. Run targeted tests and the thin-wrapper validator; run Superskill Codex dry-run and compare staged command basenames, not only aggregate counts.
10. Start a fresh session and dogfood `dev-debug` and `dev-daily` in observe-only/dry-run-safe scenarios; dogfood that Tier A spur-cli recipes can be executed from the skill alone; fix bounded findings; then run the full repository verification gate and inspect git status.

<!-- AUTO-GENERATED by spur task refresh-roster -->
| WBS | Sub-task | Status |
| --- | -------- | ------ |
| 0315 | Harden sp command contracts — dev-review modes, safe handover, least-privilege tools | done |
| 0316 | Add dev-debug and dev-daily thin commands and normalize daily-summary env/links | done |
| 0317 | Make sp:spur-cli an executable surface SSOT — add missing task verbs, fix section set | done |
| 0318 | Complete the R10 least-privilege allowed-tools sweep across all sp command wrappers | done |
<!-- END AUTO-GENERATED -->
### Solution

Parent umbrella task 0314 successfully executed through four decomposed child subtasks (0315, 0316, 0317, 0318):

1. **Task 0315** (`cad0223`): Hardened `dev-review` into deterministic WBS/Path modes, deprecated `--fix`/`--next` flags with warning guidance, trimmed `allowed-tools` to least privilege, and updated `dev-handover` SSOT & pointer append contract.
2. **Task 0316** (`50d13c3`): Added `/sp:dev-debug` (backed by `sp:sys-debugging`) and `/sp:dev-daily` (backed by `sp:daily-summary`) thin entry point commands. Renamed `RD3_DAILY_SUMMARY_NO_PROMPT` → `SP_DAILY_SUMMARY_NO_PROMPT` with dual-read deprecation warning fallback, fixed stale `SKILL.md` script link, bumped command count 28 → 30, and synchronized plugin version `0.3.21` across `plugin.json`, `.claude-plugin/marketplace.json`, and README.
3. **Task 0317** (`53966e9`): Made `sp:spur-cli` an executable surface SSOT by documenting missing task verbs (`deps`, `sections`, `run-link`), updating the complete canonical section matrix, establishing the **Execute-First Contract** in `AGENTS.md` and `SKILL.md`, and adding a reference↔CLI parity assertion test suite.
4. **Task 0318** (`dc6762d`): Completed R10 least-privilege `allowed-tools` sweep across all 30 command wrappers, trimming `Write`/`Edit` from 9 redundant wrappers and adding regression test coverage in `command-contract.test.ts`.

### Testing

- `bun test plugins/sp/tests/command-contract.test.ts` — PASS (49/49 tests passing).
- `bun test plugins/sp/tests/spur-cli-parity.test.ts` — PASS (7/7 tests passing, 110 assertions).
- `bun test plugins/sp/tests/daily-summary/daily-summary.test.ts` — PASS (57/57 tests passing).
- `superskill install sp --targets codex --dry-run --verbose` — PASS (30 commands processed, 33 Codex skills staged).
- `bun run lint` — PASS (biome check + typecheck clean across all 7 workspaces).
- `bun run test` — PASS (3504 tests across 216 files passing).

### Review

- P1–P4 Findings: None.
- Residual Risk: None. Full test suite, validator, and Codex dry-run confirm zero regressions.



### References
**Decomposition (this ticket is now an umbrella).** 0314 is split into three focused, independently-delegable subtasks; 0314 keeps the full audit + evidence as shared context. Cross-cutting requirements (R1/R8/R9/R11/R12) are sliced into each child.

- **0315** — Harden sp command contracts (R2/R3/R4/R10 + slices). dev-review deterministic modes, safe non-destructive handover, least-privilege `allowed-tools`. Owns no count/version change. *No dependency — start first.*
- **0316** — Add `dev-debug` + `dev-daily` thin commands and normalize daily-summary env/links (R5/R6 + slices). Owns the command-count 28→30 and the plugin version bump. *Depends on 0315* (shared README inventory + command-contract test).
- **0317** — Make `sp:spur-cli` an executable surface SSOT (R7 + slices). Adds missing task verbs, corrects the section set, adds parity assertion. *Independent* — touches `skills/spur-cli/`, not `commands/`.

---

- Feature O and WBS 0283 (golden-path command surface), 0309 (ADR-032 commands-as-SSOT / Superskill ownership), and 0313 (structured command-output contract)
- `plugins/sp/commands/*.md`
- `plugins/sp/skills/spur-dev/references/dev-operations.md`
- `plugins/sp/skills/sys-debugging/SKILL.md`
- `plugins/sp/skills/daily-summary/SKILL.md`
- `plugins/sp/skills/spur-cli/references/tasks.md`
- `plugins/sp/skills/spur-cli/references/tasks/{verbs,section-editing}.md`
- `plugins/sp/agents/super-reviewer.md`
- `plugins/sp/scripts/validate-commands.ts`
- `plugins/sp/tests/{command-contract,skill-structure}.test.ts`
- `docs/00_ADR.md` ADR-032 and `docs/04_DESIGN.md` command-surface contract
### History
