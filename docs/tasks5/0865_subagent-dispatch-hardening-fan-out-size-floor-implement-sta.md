---
schema_version: 1
name: "Subagent dispatch hardening: fan-out size floor, implement-stage handoff contract, pre-dispatch permission check, cheap-model fan-out hint"
status: done
template: standard
created_at: 2026-09-16T02:53:37.141Z
updated_at: "2026-09-16T05:20:21.172Z"

---

## 0865. Subagent dispatch hardening: fan-out size floor, implement-stage handoff contract, pre-dispatch permission check, cheap-model fan-out hint

### Background

Spur-dev's `--agent inline` path (tasks 0508/0687/0818) dispatches eligible pipeline stages to native subagents, but four robustness/cost gaps remain after the first fix round. This task bundles them.

**Origin.** On 2026-09-15 an evaluation compared an external subagent best-practices survey against the spur codebase. Three items were fixed immediately (size-based dispatch bypass via `estimate_hours`, fork-dispatch guidance, resume-same-subagent for continuation stages). This task carries the remaining four. The external source document is deleted; every practice statement below is self-contained and was verified against Claude Code harness behavior and this repository on that date.

**Verified practice basis (do not re-litigate):**

- A subagent's assignment should carry acceptance criteria, source-of-truth references, and the evidence format it must return (file:line citations, pasted test output). A silent success line is not a handoff.
- Fanning out below a minimum work size wastes the dispatch: for a ~20-line change, one thorough inline pass beats 3 shallow parallel ones.
- A dispatched subagent that hits a permission prompt stalls with no host visibility until join; read-only workers avoid writes by construction.
- Routing cheap models to high-volume read-only workers is the standard cost lever; on Claude Code the Agent tool accepts a per-invocation `model` override, so no definition-file change is needed.

**Explicitly rejected during evaluation (do not resurrect):**

- Hard per-worker timeouts for native subagents — the Claude Code Agent tool has no timeout parameter; the inline driver already records the governing timeout boundary (task 0727). A TaskStop-style watchdog adds a moving part for no proven need.
- Harness env-var caps (`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`, `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`) — real (v2.1.217+, defaults 3/20) but operator harness config, not plugin scope.
- Subagent definition-file composition (frontmatter `tools`/`skills`/`memory`/`model`, description authoring) — owned by superskill, never this plugin.
- Non-Claude-Code platform-specific mechanics (Codex TOML agents, Antigravity `/boost`, OMP Isolation Mode, Pi extensions, ZCode Goal Mode).

**Current contract locations (all edits stay inside these owners):**

- `plugins/sp/skills/parallel-execution/references/fan-out-patterns.md` — the when-to-use decision table and token-budget guard.
- `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md` — the 0818 five-field dispatch payload and per-stage artifact contracts.
- `plugins/sp/skills/parallel-execution/references/dispatch-surface.md` — SSOT for native-subagent vs `spur agent run` surface choice.
- `plugins/sp/skills/spur-dev/references/cross-cutting.md` — SSOT for `--agent` semantics; other files link, never restate.
- Contract tests that assert doc contents: `plugins/sp/tests/inline-execution-contract.test.ts`, `plugins/sp/tests/skill-structure.test.ts`, `plugins/sp/scripts/validate-flag-contracts.ts`.

### Requirements

- [x] R1. **Fan-out size floor (dev-parallel).** `fan-out-patterns.md` currently notes "for a 20-line change, one thorough review beats 3 shallow ones" only as an anti-pattern remark under pattern 2 (file line ~45). Promote it to a pre-dispatch gate: add a decision-table row and a short `## Size floor` rule stating that when the scope is below a deterministic floor (a single file, or an estimated diff under ~50 lines, or one focused question), the driver MUST NOT fan out and executes inline instead. The floor values live in the reference as constants — no config knob (a value that never changes is a constant).
- [x] R2. **Implement-stage handoff contract (0818 payload extension).** The five-field dispatch payload in `inline-pipeline-driver.md` (stage id, exact slash command, no-recursion notice, execution-tree cwd + resolved Spur invocation, resolved output path + artifact contract) carries an artifact contract only for the verify and review stages. Add a sixth field for the implement stage: a compact acceptance-evidence requirement naming (a) the task's AC identities the implementation must satisfy (verbatim scenario titles / checklist text from the task file), (b) the evidence the delegate must produce (pasted test output for the narrow targeted tests, `file:line` citations in the Solution change-map), and (c) the existing reminder that a delegate success message is not evidence — post-join validation reads artifacts, not claims. Wording must reuse the task file's own AC text; the driver reads it from the task, never paraphrases.
- [x] R3. **Pre-dispatch permission check.** Before dispatching a stage to a native subagent, the driver names the stage's required capabilities (the slash command, the resolved Spur invocation, any declared shell actions) in the dispatch payload and instructs the delegate to return a blocker immediately — rather than stalling — when it hits a missing permission (Claude Code exposes no dry-run permission API). Record the outcome as one run-log line per dispatch: `stage <id> permission precheck: ok | <missing capability>`. Read-only investigation fan-out (`dev-parallel` investigation mode) dispatches read-only worker shapes by construction.
- [x] R4. **Cheap-model hint for read-only fan-out.** On hosts whose native subagent invocation accepts a per-call model override (Claude Code: Agent tool `model` parameter), investigation/research fan-out workers (`dev-parallel` investigation mode, competency-lens review's read-only lenses) SHOULD be dispatched with the host's cheapest capable model. This is an invocation-side hint recorded in `fan-out-patterns.md` and `dispatch-surface.md` — never a definition-file edit (those belong to superskill) and never a hard pin (the host may ignore it). Pipeline stage dispatch under `sp:spur-dev` is unaffected: tier routing there is ADR-033/ADR-078's job via `roles.md`.

**Non-goals:** no timeout/watchdog machinery; no harness env-var or settings.json changes; no edits to `plugins/sp/agents/*.md`; no workflow YAML, CLI verb/flag, or schema changes; no `estimate_hours` work (landed in sibling commit `0e1f25691`); no restructuring of workflow definitions (deferred by the operator).

### Acceptance Criteria

```gherkin
Scenario: R1 — fan-out floor documented and wired

- `plugins/sp/skills/parallel-execution/references/fan-out-patterns.md` contains a "Size floor" rule with concrete constant thresholds AND a matching row in the when-to-use decision table whose guidance is "do not fan out — execute inline".
- The anti-pattern remark under pattern 2 is replaced by a link to the new rule (no duplicated thresholds).
- Evidence: `rg -n "Size floor" plugins/sp/skills/parallel-execution/references/fan-out-patterns.md` exits 0; `bun test` for `plugins/sp/tests` passes.

Scenario: R2 — implement-stage payload carries AC + evidence requirements

- `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md` dispatch-payload section lists the implement-stage evidence field with the three components (AC identities verbatim, required evidence form, success-message-is-not-evidence reminder).
- `plugins/sp/tests/inline-execution-contract.test.ts` is extended with an assertion pinning the new field's presence, and passes.
- Evidence: `cd plugins/sp && bun test tests/inline-execution-contract.test.ts` exits 0.

Scenario: R3 — pre-dispatch permission check documented with run-log provenance

- `inline-pipeline-driver.md` (pipeline stage dispatch) and `fan-out-patterns.md` (ad-hoc fan-out) each state the pre-dispatch permission rule, the blocker-on-missing-permission delegate instruction, and the exact run-log line format.
- Read-only dispatch shapes are named for investigation fan-out.
- Evidence: `rg -n "permission" plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md plugins/sp/skills/parallel-execution/references/fan-out-patterns.md` shows the new rules; plugin tests pass.

Scenario: R4 — cheap-model fan-out hint recorded with scope limits

- `fan-out-patterns.md` and `dispatch-surface.md` state the invocation-side cheap-model hint for read-only fan-out, the two prohibitions (never a definition-file edit — superskill owns those; never a hard pin), and the exemption of `sp:spur-dev` pipeline stage dispatch (ADR-033/ADR-078 tier routing owns that axis).
- Evidence: `rg -n "model" plugins/sp/skills/parallel-execution/references/dispatch-surface.md` shows the hint; `plugins/sp/scripts/validate-flag-contracts.ts` and plugin tests pass.

Scenario: R5 — contract SSOT hygiene preserved

- `cross-cutting.md` remains the only restatement of `--agent` semantics; new text in other files links to the owning section instead of duplicating it.
- `bun run spur-check` passes with no new suppressions.
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-16T03:22:14.599Z

#### Q&A entry — 2026-09-15T00:00:00Z

- **Floor as constants vs config knob → constants.** The evaluation's "config only when behavior must vary" rule: floor values (single file, <50-line diff, one question) never change per project, so they live as constants in `fan-out-patterns.md`. Revisit only if a project demonstrates a real divergent floor.
- **R3 as name-capabilities + fail-fast blocker vs permission-probing subsystem → blocker.** Claude Code exposes no dry-run permission API; a probing subsystem would invent platform surface that does not exist. The delegate fails fast with a named blocker instead of stalling; the host sees it at join.
- **R4 as invocation-side hint vs definition-file model pin → invocation-side.** Subagent definition files belong to superskill's lifecycle; this plugin never edits them. A per-invocation model override needs no definition change.
- **Bundle of four items in one task vs four tasks → one task.** All four edit the same three reference files' dispatch contract; cohesion rule (cross-cutting § task sizing) makes them one review unit.
- **Deferred:** workflow-definition structural performance (state count, guard shape) — operator deferred to a later step, not this task.

### Design

All four items are prompt-contract edits in plugin reference Markdown plus their pinning tests. **No new API**: no workflow YAML, no CLI verbs/flags, no schema changes, no new config keys. Frozen names per item below; every insertion point was re-verified against the tree on 2026-09-15.

**WHAT / WHY.** R1 stops wasteful fan-out of sub-floor scopes; R2 closes the implement-stage handoff gap (verify/review stages carry artifact contracts since 0818, implement carries only `requireDiff`); R3 prevents silent subagent stalls on permission prompts the host cannot see; R4 cuts fan-out cost on hosts with per-invocation model overrides.

**WHERE — frozen insertion points (verified this refine):**

- R1: `plugins/sp/skills/parallel-execution/references/fan-out-patterns.md` — new `## Size floor` section after `## Token-budget guard` (line ~93); one row in `## When-to-use decision table` (line ~81); replace anti-pattern remark at line ~45 with a link.
- R2: `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md` § "Dispatch payload (task 0818 R2)" (line ~263) — new field 6; pin in `plugins/sp/tests/inline-execution-contract.test.ts`.
- R3: `inline-pipeline-driver.md` near "Dispatch and join"; run-log line format `stage <id> permission precheck: ok | <missing capability>`; same rule + read-only worker shapes in `fan-out-patterns.md`.
- R4: one paragraph in `fan-out-patterns.md`; one cross-linking paragraph in `plugins/sp/skills/parallel-execution/references/dispatch-surface.md`.

**R2 field-6 content (frozen):** (a) the task's AC identities verbatim — exact `Scenario:` titles / checklist text read from the task file by the driver, never paraphrased; (b) required evidence — pasted narrow-test output and `file:line` Solution change-map citations; (c) reminder that a delegate success message is not evidence — post-join validation reads artifacts. Applies to implement and any stage whose YAML action declares `requireDiff`. It extends the payload contract; it is NOT a new YAML key.

**R3 runtime contract (frozen):** Claude Code exposes no dry-run permission API, so the contract is: driver names the stage's required capabilities (slash command, resolved Spur invocation, declared shell actions) in the dispatch payload; the delegate returns a blocker immediately on first denial instead of waiting; the driver records one run-log line per dispatch. Do not invent a permission-probing subsystem.

**R4 scope fence (frozen):** invocation-side hint only. Never edit `plugins/sp/agents/*.md` (superskill's lifecycle). Never a hard pin — the host may ignore it. `sp:spur-dev` pipeline stage dispatch is exempt: ADR-033/ADR-078 tier routing via `plugins/sp/references/roles.md` owns that axis.

**Anti-patterns (do not implement):** no config knobs or env vars for the floor values (constants in the reference); no model-based size estimation (the floor uses observable scope: files touched, diff lines, single question); no timeout/watchdog machinery (rejected in evaluation — the Agent tool has no timeout parameter and 0727 already records the governing boundary); no duplicating `--agent` semantics outside `cross-cutting.md`; no restating threshold numbers in two places (R1's pattern-2 remark becomes a link).

**Dependencies / handoff.** No `dependencies[]`; assumes the sibling commit `0e1f25691` (estimate_hours field + driver condition 5 + resume/fork guidance) — landed on main 2026-09-15, verified this refine. No downstream task depends on this one; nothing to leave for dependents.

**Verification.** Focused: `cd plugins/sp && bun test tests/inline-execution-contract.test.ts tests/skill-structure.test.ts` and `plugins/sp/scripts/validate-flag-contracts.ts` (via its owning test if not directly runnable). Final gate: `bun run spur-check`.

**Out of scope (record to prevent drift).** Subagent definition files (`plugins/sp/agents/*.md`) — superskill's lifecycle. Harness env vars and settings.json — operator config. Workflow definitions' structural performance (state count, guard shape) — operator deferred to a later step. Batch-schema or frontmatter additions — `estimate_hours` landed in the sibling fix.

### Plan

1. **R1 — fan-out-patterns.md size floor.** Add a `## Size floor` section after the existing `## Token-budget guard` (currently the last rule section, file line ~93): constants = single-file scope, OR estimated diff < 50 lines, OR one focused question → execute inline, do not fan out. Add one row to the `## When-to-use decision table` (file line ~81) with guidance "do not fan out — execute inline". Replace the pattern-2 anti-pattern remark (file line ~45) with a link to the new section. Verify: `rg -n "Size floor" plugins/sp/skills/parallel-execution/references/fan-out-patterns.md`.
2. **R2 — implement-stage payload field 6.** In `inline-pipeline-driver.md` § "Dispatch payload (task 0818 R2)" (file line ~263), add field 6 scoped to implement (and any stage whose YAML action declares `requireDiff`): (a) task AC identities verbatim, (b) required evidence (narrow-test output + file:line Solution change-map citations), (c) success-message-is-not-evidence reminder. Extend `plugins/sp/tests/inline-execution-contract.test.ts` with a `toContain` assertion pinning the new field. Verify: `cd plugins/sp && bun test tests/inline-execution-contract.test.ts`.
3. **R3 — pre-dispatch permission rule.** `inline-pipeline-driver.md` near "Dispatch and join": driver names required capabilities in the payload; delegate returns a blocker on first denial instead of stalling; run-log line `stage <id> permission precheck: ok | <missing capability>`. Same blocker instruction + read-only worker shapes for investigation fan-out in `fan-out-patterns.md`. State plainly: Claude Code exposes no dry-run permission API, so the contract is name-capabilities + fail-fast blocker. Verify: `rg -n "permission precheck" plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md`.
4. **R4 — cheap-model hint.** One paragraph in `fan-out-patterns.md` (global, near Size floor) + one cross-linking paragraph in `dispatch-surface.md`: invocation-side cheap-model hint for read-only fan-out; prohibitions (no definition-file edits, no hard pin); exemption of spur-dev pipeline stage dispatch (ADR-033/ADR-078 own tier routing). Verify: `rg -n "cheap" plugins/sp/skills/parallel-execution/references/dispatch-surface.md`.
5. **Contract hygiene sweep (R5).** Confirm new text links to cross-cutting.md instead of restating `--agent` semantics. Run `plugins/sp/scripts/validate-flag-contracts.ts` (via its owning test if not directly runnable), `cd plugins/sp && bun test tests/inline-execution-contract.test.ts tests/skill-structure.test.ts`, then the full gate `bun run spur-check`. No new suppressions; commit per file-group with conventional message.

### Solution

Prompt-contract batch: six-field dispatch payload, fan-out size floor, pre-dispatch permission
check, and the invocation-side cheap-model hint. No new API — no workflow YAML, CLI verb/flag,
schema, or config key changed; all four items are reference-Markdown edits plus their pinning tests.
R5 hygiene holds: cross-cutting.md is untouched and stays the only restatement of `--agent`
semantics; every new paragraph links to its owning rule instead of duplicating it.

| Req | Change | Anchor |
| --- | --- | --- |
| R1 | `Size floor` rule — constants (single file / under ~50 lines / one focused question) mean execute inline, never fan out; the floor decides whether to fan out, the existing tables decide which pattern | `plugins/sp/skills/parallel-execution/references/fan-out-patterns.md:104-119` |
| R1 | Decision-table row for a below-floor scope: do not fan out — execute inline | `plugins/sp/skills/parallel-execution/references/fan-out-patterns.md:92` |
| R1 | Pattern-2 anti-pattern remark replaced by a link to the rule so the thresholds are stated once | `plugins/sp/skills/parallel-execution/references/fan-out-patterns.md:45` |
| R2 | Dispatch payload grows from five to six fields; field 6 is the implement/`requireDiff` acceptance-evidence requirement carrying AC identities verbatim, the required evidence (pasted narrow-test output and the Solution `file:line` change map), and the success-message-is-not-evidence reminder | `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:296-306` |
| R2 | Resume-over-re-dispatch paragraph now cites the six-field payload | `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:359` |
| R2 | Contract test pinning the sixth field | `plugins/sp/tests/inline-execution-contract.test.ts:347-364` |
| R3 | `Pre-dispatch permission check` rule — name-capabilities + fail-fast blocker, plus the exact run-log line | `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:256-270` |
| R3 | Same rule for ad-hoc fan-out, with the read-only worker shapes named for investigation fan-out | `plugins/sp/skills/parallel-execution/references/fan-out-patterns.md:121-138` |
| R3 | Contract test pinning the driver's permission rule and run-log line | `plugins/sp/tests/inline-execution-contract.test.ts:366-375` |
| R4 | `Cheap-model hint` for read-only fan-out — invocation-side, two prohibitions, pipeline exemption | `plugins/sp/skills/parallel-execution/references/fan-out-patterns.md:140-155` |
| R4 | Cross-linking paragraph recording the hint on the dispatch-surface reference | `plugins/sp/skills/parallel-execution/references/dispatch-surface.md:68-81` |
| R5 | SSOT hygiene verified by the existing gate: `checkAgentSsotIntegrity` finds no restated value table outside the SSOT; new links resolve | `plugins/sp/scripts/validate-flag-contracts.ts:620` |
| R5 | Structure test pinning the floor, permission rule, and cheap-model hint | `plugins/sp/tests/skill-structure.test.ts:332-364` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Rule present with constant thresholds and no config knob: `plugins/sp/skills/parallel-execution/references/fan-out-patterns.md:104-119` (`## Size floor`; "single file", "under ~50 lines", "one focused question"; "never exposed as a config knob"). Decision-table row with the required guidance: `plugins/sp/skills/parallel-execution/references/fan-out-patterns.md:92` (`**Do not fan out — execute inline**`). Pattern-2 anti-pattern remark replaced by a link, thresholds not duplicated: `plugins/sp/skills/parallel-execution/references/fan-out-patterns.md:45` (links `#size-floor`, quotes no numbers). Command: `rg -n "Size floor" plugins/sp/skills/parallel-execution/references/fan-out-patterns.md` → `:45`, `:92`, `:104`, exit 0. Pins: `plugins/sp/tests/skill-structure.test.ts:340-345`; each pinned string scored 0 matches at base `89259d7df^` (`git show 89259d7df^:<file> \| grep -cF <string>`), so the pins are load-bearing. |
| R2 | MET | Payload extended from five to six fields: `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:279` ("Send exactly these six fields"). Field 6 scoped to the implement/`requireDiff` stage at `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:296-306` with all three components — (a) AC identities verbatim read from the task file (`:299-300`), (b) required evidence = pasted narrow-test output plus a `file:line` change map into `## Solution` (`:301-302`), (c) "a delegate success message is not evidence" (`:303-304`) — and the explicit "NOT a new YAML key" fence (`:305-306`). Resume paragraph now cites the six-field payload: `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:359`. Pins: `plugins/sp/tests/inline-execution-contract.test.ts:347-364` (7 new assertions, incl. the negative `not.toContain('Send exactly these five fields')`); 6 of 7 scored 0 at base, the bare `` `requireDiff` `` pin scored 3 at base (non-discriminating — see P3 finding). |
| R3 | MET | Driver states name-capabilities + fail-fast blocker, no dry-run API, no probing subsystem, and the exact run-log line: `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:256-270`, run-log line at `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:265`. Ad-hoc fan-out states the same three-part rule plus the read-only worker shapes for investigation fan-out: `plugins/sp/skills/parallel-execution/references/fan-out-patterns.md:121-138` (rule `:123-134`, read-only shapes `:136-138`). Commands: `rg -n "permission" plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md` → 6 hits `:256-269`; `rg -n "permission" plugins/sp/skills/parallel-execution/references/fan-out-patterns.md` → 6 hits `:121-136`; both exit 0. Live format corroboration from this run's own driver log: `.spur/run/4f1527e0-cc59-415f-ada6-3654bdb58141.log` line 18 emits `stage verify permission precheck: ok (slash command /sp:dev-verify 0865 --auto --fix none --focus all; …)` in the documented shape (format corroboration only — the line is written by the orchestrator, not proof the new prose was obeyed). Pins: `plugins/sp/tests/inline-execution-contract.test.ts:366-375`, `plugins/sp/tests/skill-structure.test.ts:349-352`; all pinned strings 0 at base. |
| R4 | MET | Hint recorded on both owners with both prohibitions and the pipeline exemption: `plugins/sp/skills/parallel-execution/references/fan-out-patterns.md:140-155` ("cheapest capable model" `:144`; "Never a definition-file edit" `:147-148`; "Never a hard pin" `:149-150`; `sp:spur-dev` stage dispatch exempt via ADR-033/ADR-078 at `:151-152`). Cross-link paragraph on the dispatch-surface owner: `plugins/sp/skills/parallel-execution/references/dispatch-surface.md:68-79` (names the hint, defers the rule to the patterns anchor `:75`, keeps surface choice on its own axis). Commands: `rg -n "model" plugins/sp/skills/parallel-execution/references/dispatch-surface.md` → hint at `:68-79`; `bun plugins/sp/scripts/validate-flag-contracts.ts` → "All 72 contract surfaces agree across all claims.", exit 0. Pins: `plugins/sp/tests/skill-structure.test.ts:355-366`; all 0 at base. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R1 — fan-out floor documented and wired | MET | test | Rule with concrete constants at `plugins/sp/skills/parallel-execution/references/fan-out-patterns.md:104-119`; matching decision-table row "do not fan out — execute inline" at `plugins/sp/skills/parallel-execution/references/fan-out-patterns.md:92`; anti-pattern remark replaced by a link at `plugins/sp/skills/parallel-execution/references/fan-out-patterns.md:45`. Command: `rg -n "Size floor" plugins/sp/skills/parallel-execution/references/fan-out-patterns.md` → `:45`, `:92`, `:104`, exit 0. Test: `cd plugins/sp && bun test tests/` → 1151 pass / 0 fail, 5072 expect() calls, exit 0 (includes `plugins/sp/tests/skill-structure.test.ts:340-345`). |
| Scenario: R2 — implement-stage payload carries AC + evidence requirements | MET | test | Driver lists field 6 with all three components: `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:296-306`. Test: `cd plugins/sp && bun test tests/inline-execution-contract.test.ts` → 17 pass / 0 fail, 210 expect() calls, exit 0; the new assertions are `plugins/sp/tests/inline-execution-contract.test.ts:347-364` (6 of 7 pins score 0 at base `89259d7df^`; the `` `requireDiff` `` pin scores 3 at base — see P3). |
| Scenario: R3 — pre-dispatch permission check documented with run-log provenance | MET | test | Rule + fail-fast blocker + exact run-log line in the driver at `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:256-270` (line text `:265`); same in `plugins/sp/skills/parallel-execution/references/fan-out-patterns.md:121-138`; read-only worker shapes named at `plugins/sp/skills/parallel-execution/references/fan-out-patterns.md:136-138`. Commands: `rg -n "permission" <driver>` → 6 hits `:256-269`; `rg -n "permission" <fan-out-patterns>` → 6 hits `:121-136`; live run-log line 18 of `.spur/run/4f1527e0-cc59-415f-ada6-3654bdb58141.log` matches the documented format. Test: `cd plugins/sp && bun test tests/inline-execution-contract.test.ts tests/skill-structure.test.ts` → 101 pass / 0 fail, 1046 expect() calls, exit 0. |
| Scenario: R4 — cheap-model fan-out hint recorded with scope limits | MET | test | Hint + both prohibitions + exemption at `plugins/sp/skills/parallel-execution/references/fan-out-patterns.md:140-155`; committing cross-link at `plugins/sp/skills/parallel-execution/references/dispatch-surface.md:68-79`. Commands: `rg -n "model" plugins/sp/skills/parallel-execution/references/dispatch-surface.md` → hits `:68-79`; `bun plugins/sp/scripts/validate-flag-contracts.ts` → "All 72 contract surfaces agree across all claims.", exit 0. Test: `cd plugins/sp && bun test tests/` → 1151 pass / 0 fail, exit 0 (includes `plugins/sp/tests/skill-structure.test.ts:355-366`). |
| Scenario: R5 — contract SSOT hygiene preserved | MET | command | `git show --name-only --format="" 89259d7df` → 6 files, `cross-cutting.md` not among them; new paragraphs link to owners (`fan-out-patterns.md:134`, `:152`; `dispatch-surface.md:75`) and add no `--agent` value text. Command: `bun run spur-check` → exit 0 (biome 996 files clean, 7 workspace typechecks, 45 pre-check + 2 post-check rules pass, 8396 pass / 0 fail across 475 files, 34235 expect() calls); no new suppressions in the diff. Static-ref: `plugins/sp/scripts/validate-flag-contracts.ts` C4/C5 pass inside that run. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0865

**Scope:** commit `89259d7df` (`git show 89259d7df`, base `8aa91ead9`) — 6 files, +188/−6: four plugin reference-Markdown contracts, two contract tests, plus the task file's Solution change map. Review-only: this review modified no production or test file.
**Dimensions:** functional traceability, correctness, security, efficiency, usability, architecture
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location |
| --- | --- | --- | --- | --- |
| 1 | P3 (minor) | usability | The new MUST-level gate states its own trigger with inverted polarity: "**The floor is met** — and the driver MUST **not** fan out" for a sub-floor scope, while the same file names that identical condition as *below* the floor in the decision-table row ("Scope below the [Size floor]") and in the pattern-2 link ("A sub-floor scope"). An applying agent can read "floor is met" as "minimum size satisfied → fan out", i.e. the opposite of the rule. One-sentence reword: "When any of these constants holds, the scope is below the floor and the driver MUST NOT fan out, executing inline instead." | `plugins/sp/skills/parallel-execution/references/fan-out-patterns.md:107` |
| 2 | P3 (minor) | functional | The skill front door does not surface the new gate: SKILL.md's pre-fan-out gate table plus its "**Hard rule:** if ANY question in rows 1-3 is Yes, serialize. Rows 4-5 are advisory — … don't block fan-out" sentence enumerate the blocking rules with no size-floor row, and its reference index still describes the reference as "Four fan-out patterns, per-pattern token-cost estimates, when-to-use decision table". A reader who stops at SKILL.md fans out a single-file scope — the exact waste R1 exists to stop. The fix lands outside this task's frozen edit owners (`SKILL.md` is not one of the four declared contract files), so this is recorded as follow-up, not a defect in the delivered scope. | `plugins/sp/skills/parallel-execution/SKILL.md:33-43`, `:130` |
| 3 | P3 (minor) | architecture | The sibling 0818 payload pin still frames the contract as five fields and asserts nothing about field 6, so the two payload tests now disagree with each other: its module doc says "the driver reference carries the five payload fields", while `inline-execution-contract.test.ts:356` pins "Send exactly these six fields". Hygiene fix: update the doc line (and optionally extend the assertion set) when the payload contract is next touched. | `plugins/sp/tests/dispatch-handoff-contract.test.ts:5` |
| 4 | P4 (advisory) | correctness | Precedence is unstated between the dispatch-eligibility sentence "All five pass → dispatch. Any pre-dispatch failure → execute the stage **once** in the host session" and the new name-capabilities / fail-fast-blocker rule: whether the driver must fall back inline or stop on a *known* missing capability is not said. The same paragraph forward-references "the slash command (field 2)" / "the resolved Spur invocation (field 4)" about twenty lines before those fields are defined in the payload list. One clause each resolves both. | `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:248`, `:256-270` |
| 5 | P4 (advisory) | efficiency | One of the seven new R2 assertions is vacuous: `` `requireDiff` `` already appeared three times in the driver at the base commit, so that assertion passes without any of field 6 existing. The other six pinned strings were checked against the base file (zero matches there) and are genuine regression pins. | `plugins/sp/tests/inline-execution-contract.test.ts:358` |

##### Functional Traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `fan-out-patterns.md:104-117` `## Size floor` with the three constants (single file / estimated diff under ~50 lines / one focused question), explicit "never exposed as a config knob", and the floor-decides-whether/table-decides-which split; decision-table row at `:92` (`**Do not fan out — execute inline**`); pattern-2 remark at `:45` replaced by a `#size-floor` link with no duplicated thresholds. `rg -n "Size floor"` → 3 hits, exit 0. Pinned by `plugins/sp/tests/skill-structure.test.ts:332-364`; every pinned string returns 0 matches at base `89259d7df^`, so the pins are load-bearing. |
| R2 | MET | `inline-pipeline-driver.md:279` "Send exactly these six fields"; field 6 at `:296-306` scoped to the implement stage and any `requireDiff` stage, carrying (a) AC identities verbatim read by the driver from the task file, (b) required evidence — pasted narrow-test output plus a `file:line` change map into `## Solution`, (c) success-message-is-not-evidence; `:359` updated to "six-field payload"; explicit "NOT a new YAML key". Pinned by `plugins/sp/tests/inline-execution-contract.test.ts:347-364` (7 assertions, incl. the negative `not.toContain('Send exactly these five fields')`). |
| R3 | MET | Driver `:256-270`: name-capabilities in the payload (slash command field 2, resolved invocation field 4, declared shell actions), delegate returns a blocker immediately on the first missing permission, exact run-log line `stage <id> permission precheck: ok \| <missing capability>`; read-only investigation fan-out named as read-only worker shapes. `fan-out-patterns.md:121-138` states the same three-part rule for ad-hoc fan-out plus the ledger-id reference for `<id>`. Pinned by `inline-execution-contract.test.ts:366-375` and `skill-structure.test.ts:348-352`. Live corroboration: this run's driver log already emits `stage implement permission precheck: ok (slash command …; spur invocation …; declared shell actions: none in this stage)` and the same for `stage review` — the documented format matches what the running orchestrator writes (format corroboration only; the implement line predates the commit, so it is not proof the new prose was followed). |
| R4 | MET | `fan-out-patterns.md:140-155` `## Cheap-model hint for read-only fan-out`: invocation-side hint for `dev-parallel --mode investigation` + competency-lens read-only lenses, both prohibitions ("Never a definition-file edit", "Never a hard pin") and the exemption (spur-dev pipeline stage dispatch; ADR-033 `model_policy` / ADR-078 role config via `plugins/sp/references/roles.md`). `dispatch-surface.md:68-81` records the same hint, defers ownership to the patterns file with an anchor link, and keeps surface choice on its own axis. `rg -n "model" dispatch-surface.md` shows the hint; ADR-033/078 text verified in `docs/00_ADR.md` (`model_policy` at `:262-266`, role→tier SSOT at `:943`). |
| R5 | MET | `cross-cutting.md` is absent from the diff (0 files) and the new prose never restates `--agent` semantics — it links instead (`fan-out-patterns.md:141` → `dispatch-surface.md`, `:126` → the ledger section, `:151` → `roles.md`; `dispatch-surface.md:75` → the patterns anchor). `bun plugins/sp/scripts/validate-flag-contracts.ts` → "All 72 contract surfaces agree across all claims." exit 0, including `checkAgentSsotIntegrity` (C4) and `checkSsotAnchorsResolve` (C5). `bun run spur-check` exit 0 with no new suppressions (the diff adds no `biome-ignore` / `eslint-disable` / `.skip`). |

##### Dimension verdicts

| Dimension | Verdict | Note |
| --- | --- | --- |
| Functional traceability | PASS | All five Scenario ACs MET; every AC evidence command re-run green in this review. |
| Correctness | PASS | Doc-contract + test-only change; no runtime path altered. F4 records one unstated precedence in the driver prose. |
| Security | PASS | Adds no unsafe instruction; the permission rule removes silent-stall exposure; no secrets, env, CI, or `.env*` surface touched; no new suppression. |
| Efficiency | PASS | The floor is a constant pre-dispatch check with no new knob; the cheap-model hint is scoped to read-only fan-out with the pipeline tier-routing axis explicitly exempted. F5 notes one vacuous test assertion. |
| Usability | PASS | Rules are placed next to the surfaces they govern and link rather than restate. F1 (inverted floor wording) and F2 (front-door omission) are the localizable clarity gaps. |
| Architecture | PASS | Owner boundaries held: superskill owns definition files, ADR-033/078 own tier routing, `cross-cutting.md` stays the `--agent` SSOT; the new dispatch-surface paragraph reconciles surface choice with model choice instead of folding the axes. F3 is test-doc hygiene. |

##### Verification evidence (fresh, this review run)

- `git show --stat 89259d7df` → 6 files changed, 188 insertions(+), 6 deletions(-); `git status --short` empty; nothing staged.
- `rg -n "Size floor" plugins/sp/skills/parallel-execution/references/fan-out-patterns.md` → `:45`, `:92`, `:104`; exit 0.
- `rg -c "permission" plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md plugins/sp/skills/parallel-execution/references/fan-out-patterns.md` → 6 / 6 hits (new rule present in both owners).
- `rg -n "model" plugins/sp/skills/parallel-execution/references/dispatch-surface.md` → hint at `:68-78`.
- `cd plugins/sp && bun test tests/inline-execution-contract.test.ts tests/skill-structure.test.ts` → 101 pass / 0 fail, 1046 expect() calls.
- `bun plugins/sp/scripts/validate-flag-contracts.ts` → "All 72 contract surfaces agree across all claims.", exit 0.
- `bun test ./plugins` (repo-root cwd) → 1452 pass / 0 fail, 5548 expect() calls.
- `bun run spur-check` (repo root) → exit 0: biome 996 files clean, 7 workspace typechecks clean, 45 pre-check rules + 2 post-check rules pass, then 8396 pass / 0 fail (475 files), 34235 expect() calls — identical to the test stage's recorded proof for this run.
- Base-vs-head string audit `git show 89259d7df^:<file> | grep -cF <string>`: every R1/R3/R4 pinned string = 0 at base; `` `requireDiff` `` = 3 at base (see F5).

##### Residual risk

- Runtime adherence to the size floor, permission precheck, and cheap-model hint is prose-level by design (the task forbids new API surface); nothing mechanically enforces them, and no test can observe a driver that ignores them.
- R3's driver paragraph is only exercised if a delegate actually meets a permission prompt; this run never hit one, so the fail-fast path is unverified in practice.
- `bun test` run from inside `plugins/sp/` fails 2 cases in `plugins/sp/hooks/task-file-policy.test.ts` (relative `docs/tasks` and `packages/app/...` paths resolve against cwd). Pre-existing and unrelated to 0865 — the repo-root run is green; recorded so the verify stage does not misread it.

**Next:** accept 0865 (no blocker/major); route to verify. Optional: fold F1's one-sentence reword into this task (it sits inside the task's own frozen file), and record F2/F3 as follow-ups.

### References

- Sibling fix (landed, assumed by this task): commit `0e1f25691` — `estimate_hours` field, driver condition 5 dispatch floor, resume-over-re-dispatch, fork-dispatch guidance.
- `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md` — dispatch payload (0818), eligibility (0508), timeout boundary (0727).
- `plugins/sp/skills/parallel-execution/references/fan-out-patterns.md` — decision table, token-budget guard, pattern anti-patterns.
- `plugins/sp/skills/parallel-execution/references/dispatch-surface.md` — native-subagent vs `spur agent run` SSOT; fork dispatch section.
- `plugins/sp/skills/spur-dev/references/cross-cutting.md` — `--agent` semantics SSOT (link, never restate).
- `plugins/sp/references/roles.md` — role→tier table; ADR-033 (model-tier routing), ADR-078 (role config SSOT).
- Contract tests: `plugins/sp/tests/inline-execution-contract.test.ts`, `plugins/sp/tests/skill-structure.test.ts`, `plugins/sp/scripts/validate-flag-contracts.ts`.
- Tasks 0508 / 0687 / 0818 / 0727 — prior dispatch-contract decisions this task extends.

### History

- 2026-09-16T03:33:06.954Z backlog → todo (system)
- 2026-09-16T03:42:43.273Z todo → wip (system)
- 2026-09-16T05:20:03.602Z wip → testing (system)
- 2026-09-16T05:20:21.172Z testing → done (system)

