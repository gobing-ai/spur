---
template: feature-impl
schema_version: 1
name: "Harden dogfood-testing: always-on report delivery, cost honesty, minimal report upgrades"
description: ""
status: done
type: task
profile: standard
feature_id: null
parent_wbs: null
priority: P1
tags: []
dependencies: []
created_at: "2026-07-12T18:21:58.680Z"
updated_at: "2026-08-18T04:42:47.248Z"
---

## 0244. Harden dogfood-testing: always-on report delivery, cost honesty, minimal report upgrades

### Background
Operator-confirmed approach from `/sp:dev-brainstorm` (2026-07-12): **Approach 1 — Protocol hardening in skill + template**.

**Problem.** `sp:dogfood-testing` (backed by `/sp:dev-dogfood`) is the measurement loop for slash commands and skills. Three foundation gaps remain:

1. **Report delivery is best-effort.** The live ledger is working memory; the six-section report and summary footer are prompt-enforced. If Phase 4 is skipped, context is truncated, or the session dies, the operator gets **no report** — even when the testee run finished.
2. **Report quality drifts.** Historical artifacts range from contract-excellent to non-conforming / retrospective-shaped.
3. **Token cost is an admitted estimate.** `monitor-ledger.md` uses `ceil(chars/4)` rounded to 100; the skill cannot read a token meter. `ccusage` is daily aggregate only (task 0139). Numbers are often vibes-based despite anti-fiction rules.

**Goal.** Every dogfood run leaves a report (complete or explicitly partial/aborted) with honest cost labeling and minimal structural report upgrades — **delivery reliability first**.

**Chosen approach (Approach 1).** Keep dogfood skill-driven (no new runner process, no helper scripts this pass). Open dual artifacts in Phase 1, append ledger rows to disk live, make Phase 4 a non-skippable finalize-or-abort terminal gate, always write both `.spur/run/dogfood/<run_id>.md` and `docs/dogfood/YYYY-MM-DD-<slug>-dogfood.md`.

**Orthogonal work (do not fold in).**
- `docs/plans/2026-07-09-p3-mandatory-dogfood-design.md` — feature-level gate requiring a dogfood artifact to exist before feature `done`. That gate *consumes* reliable reports; this task *produces* them.
- Approach 2 (scripted ledger I/O) and Approach 3 (out-of-band driver) — deferred.

**Brainstorm SSOT.** `docs/plans/2026-07-12-dogfood-testing-hardening-brainstorm.md` (decision tree locked with operator).
### Requirements
R1. **Always-on dual artifacts.** On every dogfood invocation (with or without `--save`), Phase 1 MUST open:
   - Live file: `.spur/run/dogfood/<run_id>.md` (`run_id` = uuid or timestamp-slug)
   - Operator file: `docs/dogfood/YYYY-MM-DD-<testee-slug>-dogfood.md`
   Both start with shared YAML frontmatter (`status: running`, testee, mode, timestamps, paths) and an empty Monitor Ledger table.

R2. **Live ledger is disk SSOT.** On each step resolve in Phase 2/3, append/update exactly one ledger row in **both** files (every step, both files — not batch-at-end). The report is assembled from the on-disk ledger, never reconstructed from memory. Dual-write rule: prefer live file first if a write must fail partially; docs file is best-effort sync until finalize.

R3. **Partial-OK status model.** Frontmatter `status` is one of: `running` | `aborted` | `complete`. Mid-run death / early stop leaves a partial file valid if it has frontmatter + ledger rows so far. Unfinished narrative sections use `⚠ incomplete — not reached` — never invent What-We-Did / Issues / Findings fiction.

R4. **Terminal finalize-or-abort gate (non-skippable).** Before the skill may stop (PASS/PARTIAL/FAIL path, observe-only path, or abort), Phase 4 MUST:
   1. Set `status: complete` or `status: aborted`
   2. Ensure all six mandatory section headings exist (incomplete sections marked per R3)
   3. Write the Cost block (R6)
   4. Sync final content to `docs/dogfood/…`
   5. Print the mandatory summary footer with **both** `[Live: <path>]` and `[Report: <path>]` always
   Any early-exit / failure path still runs this checklist.

R5. **Minimal report structure upgrades.** Keep the six fixed sections (1 Testee … 6 Findings). Add:
   - YAML frontmatter (run_id, status, testee, mode, max_retry, started_at, finished_at, live_path, report_path)
   - **Repro** line under §1 Testee: exact invocation string
   - **Cost** subsection under §2 Execution Summary (or adjacent) per R6
   - Abort/partial markers when `status != complete`
   No full redesign of section order or severity scale.

R6. **Honest multi-source Cost block.** Always include ledger-derived `~estimate` total / cached / cache% with:
   - Method line (e.g. `chars/4 heuristic per monitor-ledger.md`)
   - Confidence: `LOW` (estimate only) or `MEDIUM` when a real meter is also present
   Optional when available (never invent):
   - `ccusage` session/daily delta (scope labeled: day/session, **not** per-step)
   - Agent usage fields if present in tool results
   If no meter: print `Meter: n/a` explicitly. Never present an unsubstantiated precise integer as billed/metered cost. Cache% must remain recomputable from ledger row sums (existing anti-fiction rule).

R7. **`--save` semantics.** Always writing `docs/dogfood/` makes `--save` redundant for delivery. Keep the flag for back-compat as a no-op that still documents/prints the report path. Update `dev-dogfood.md` Arguments table + Behavior accordingly. Do not require operators to pass `--save` to get a file.

R8. **Command + skill surface sync.** Update:
   - `plugins/sp/skills/dogfood-testing/SKILL.md` (phases 1–4, gotchas)
   - `plugins/sp/skills/dogfood-testing/references/report-template.md`
   - `plugins/sp/skills/dogfood-testing/references/monitor-ledger.md`
   - `plugins/sp/commands/dev-dogfood.md` (thin wrapper docs)
   Platform notes (Codex/etc. six headings + footer) must restate the new dual-path + status + Cost rules **verbatim**, not by pointer only.

R9. **Consumer gate tweak (optional but preferred).** Keep super-coder terminal `rg` checks for `### 3. Monitor Ledger` and `── Dogfood Summary ──`. Prefer also checking frontmatter `status: complete` or `status: aborted` on the report path when a path is known. Do not break existing dogfood-mode gates.

R10. **Dogfood-of-dogfood proof.** After protocol changes land, run one observe-only dogfood of a small, safe testee (e.g. a non-pipeline command or skill self-check) and verify:
   - Live file exists under `.spur/run/dogfood/`
   - Report exists under `docs/dogfood/` **without** relying on `--save`
   - Footer prints both paths
   - Frontmatter status is `complete` or `aborted`
   - Cost block has method + confidence
   Record paths + outcomes in this task's Testing section.

R11. **Out of scope (must not implement in this task).**
   - Helper scripts under `dogfood-testing/scripts/` (Approach 2)
   - Out-of-band dogfood runner / new CLI verb (Approach 3)
   - Per-step hard token instrumentation in `spur agent run` / packages/app
   - Mandatory feature-level dogfood gate (P3 design 2026-07-09)
   - Mass rewrite of historical non-conforming reports
   - Changes to apps/server/web TypeScript packages

R12. **Docs hygiene.** If surface behavior changes, update `docs/dogfood/README.md` (always-on reports) and any help row that still says reports only appear with `--save`. Same-commit design surface notes if `docs/04_DESIGN.md` / design satellite claims `--save`-only delivery (only if currently documented that way — verify before editing).
### Acceptance Criteria
```gherkin
@core
Scenario: R1 dual artifacts open at plan time
  Given a dogfood invocation without the --save flag
  When Phase 1 Plan completes
  Then a live file exists at .spur/run/dogfood/<run_id>.md with status running
  And a report skeleton exists at docs/dogfood/YYYY-MM-DD-<testee-slug>-dogfood.md with the same run_id

@core
Scenario: R2 ledger row written on each step resolve
  Given an open dogfood run with status running
  When a derived step resolves (PASS, FIXED, UNRESOLVED, or N/A)
  Then both the live file and the docs/dogfood file contain that step's ledger row
  And the row is not deferred until Phase 4

@core
Scenario: R4 terminal gate always prints footer with both paths
  Given a dogfood run that has finished execute/monitor (success, partial, or abort)
  When the skill stops
  Then the chat output includes the Dogfood Summary footer
  And the footer includes [Live: <path>] and [Report: <path>]
  And both files have status complete or aborted (never left as running after a normal stop)

@core
Scenario: R3 partial report on incomplete narrative
  Given a dogfood run that aborts before full narrative is written
  When finalize-or-abort runs
  Then unfinished sections use incomplete markers rather than invented narrative
  And existing ledger rows remain on disk

@core
Scenario: R6 cost block is honest
  Given a finalized dogfood report
  When the Cost block is read
  Then it includes ledger-derived ~estimate totals with a method line and confidence label
  And if no external meter is available it states Meter: n/a
  And it does not present unsubstantiated integers as metered billable cost

@core
Scenario: R7 save is not required for delivery
  Given a dogfood invocation that omits --save
  When the run finalizes
  Then docs/dogfood/YYYY-MM-DD-<slug>-dogfood.md still exists with the finalized report

@core
Scenario: R10 dogfood-of-dogfood proof
  Given the protocol changes from this task are in the skill and templates
  When an observe-only dogfood of a small safe testee is run without --save
  Then live and report paths exist, footer prints both, status is terminal, and Cost block is present
```
### Q&A
**Q: Which brainstorm approach was selected?**  
A: Approach 1 (protocol hardening in skill + template). Approach 2 (scripts) and Approach 3 (out-of-band driver) deferred.

**Q: Is dual-write every step or batched?**  
A: **Every step, both files** (brainstorm self-review resolution). Live file first if a write must fail partially.

**Q: Does `--save` go away?**  
A: Flag kept for back-compat as no-op / path documentation. Delivery no longer depends on it.

**Q: Does this include the mandatory feature-level dogfood gate (2026-07-09 P3 design)?**  
A: No. Orthogonal. That gate requires an artifact to exist; this task makes artifacts always exist.

**Q: Is real per-step token metering in scope?**  
A: No. Multi-source honesty + confidence labels only. Hard instrumentation is a separate feature.

**Q: Should historical non-conforming reports be rewritten?**  
A: No. New contract going forward only (0184 banner pattern remains valid for legacy).
### Design
**Chosen approach.** Approach 1 — Protocol hardening in skill + template (operator-confirmed 2026-07-12 brainstorm). No new runner process, no Bun helper scripts, no app/CLI package changes. The protocol contract is upgraded in markdown skill surfaces so any agent running `sp:dogfood-testing` opens dual artifacts, appends the ledger live, and cannot exit without finalize-or-abort.

**Locked decision tree (do not re-litigate).**

| Decision | Choice |
|----------|--------|
| Primary outcome | Always emit a report |
| Delivery | Live run file + always docs/dogfood |
| Partial | status running\|aborted\|complete; incomplete markers |
| Tokens | Multi-source + confidence labels |
| Content | Minimal structural upgrades |
| Enforcement | Hard terminal checklist in skill |

**Artifact layout.**

```
.spur/run/dogfood/<run_id>.md              # live SSOT mid-run (gitignored via /.spur/run)
docs/dogfood/YYYY-MM-DD-<slug>-dogfood.md  # operator artifact (gitignored; local only)
```

**Frontmatter (canonical fields — implement exactly).**

```yaml
---
run_id: <uuid-or-slug>
status: running | aborted | complete
testee: "<exact invocation string>"
classification: slash-command | agent-skill | cli
mode: observe-only | fix
max_retry: <n>
testee_agent: omitted | <name>
started_at: <ISO-8601>
finished_at: <ISO-8601 or null while running>
live_path: .spur/run/dogfood/<run_id>.md
report_path: docs/dogfood/YYYY-MM-DD-<slug>-dogfood.md
protocol: sp:dogfood-testing@1.1
---
```

**Dual-write algorithm.**

1. **Open (Phase 1):** mkdir -p both dirs; write identical skeleton (frontmatter + six headings stubs + empty ledger).
2. **Append (Phase 2/3):** on step resolve, write row to live file, then mirror to report path (every step). If report path write fails, record a P2 finding and continue — live file remains SSOT until finalize retries promote.
3. **Finalize (Phase 4):** set status; fill Cost; mark incomplete sections; rewrite both files to final content; print footer with both paths.

**Cost block shape (under §2 Execution Summary).**

```markdown
#### Cost
- **Ledger estimate:** ~N total | ~N cached (~X% hit rate)  `[~estimate]`
- **Method:** chars/4 heuristic (monitor-ledger.md); confidence: LOW
- **Meter:** n/a  |  ccusage <scope>: …  `[confidence: MEDIUM]`  |  agent-usage: …
```

**`--save` migration.**

| Before | After |
|--------|-------|
| `--save` required to write docs/dogfood | Always write docs/dogfood |
| Footer path line only with --save | Always `[Live:]` + `[Report:]` |
| `--save` off → chat only | `--save` kept as no-op / path documentation for back-compat |

**Impacted surfaces.**

| Path | Change |
|------|--------|
| `plugins/sp/skills/dogfood-testing/SKILL.md` | Phases 1–4, gotchas, platform notes |
| `plugins/sp/skills/dogfood-testing/references/report-template.md` | Frontmatter, Cost, Repro, footer paths, always-save semantics |
| `plugins/sp/skills/dogfood-testing/references/monitor-ledger.md` | Disk SSOT, dual-write, status model pointer |
| `plugins/sp/commands/dev-dogfood.md` | Args table for --save; always-on report behavior |
| `plugins/sp/agents/super-coder.md` (if dogfood gate present) | Optional status frontmatter check |
| `docs/dogfood/README.md` | Always-on reports |

**Invariants.**

- Verdict still grades the **testee**, not the driver (`PASS`/`PARTIAL`/`FAIL` only).
- Six section headings remain machine-parseable and ordered.
- Cache% still equals ledger formula or report is invalid.
- No apps/ packages; no new CLI verbs; no mandatory feature dogfood gate.

**Deferred (explicit).**

- Approach 2 scripts if format drift persists after dogfood-of-dogfood
- Approach 3 out-of-band driver for CI zero-cooperation
- Per-step hard telemetry product

**Discovery issues mapped to requirements.**

| ID | Severity | Maps to | Issue |
|----|----------|---------|-------|
| D1 | P1 | R1,R7 | Report only in chat unless --save; mid-run death loses all |
| D2 | P1 | R4 | Phase 4 not a hard terminal gate |
| D3 | P2 | R2 | Ledger working-memory vs SSOT claim |
| D4 | P2 | R6 | Token vibes despite anti-fiction |
| D5 | P2 | R7 | --save optional confuses delivery |
| D6 | P3 | R5 | No frontmatter/run-id |
| D7 | P3 | R6 | Cache-health often [unverifiable] — keep trend role + confidence |
| D8 | P3 | R8 | Command must document always-on paths |
| D9 | P3 | R5 | Stale command snapshot gotcha — keep; optional same-session note |
| D10 | P4 | R11 | No mass rewrite of historical reports |
| D11 | Info | R11 | Orthogonal to P3 mandatory-dogfood feature gate |
### Plan
- [x] **P0 — Read current contract.** Re-read skill, templates, command, super-coder gate, README.
- [x] **P1 — Frontmatter + skeleton contract.** `report-template.md` protocol@1.1 + frontmatter + skeleton.
- [x] **P2 — Phase 1 open dual artifacts.** `SKILL.md` Phase 1 always-on live + docs/dogfood.
- [x] **P3 — Phase 2/3 live dual-write.** `monitor-ledger.md` disk SSOT + every-step dual-write.
- [x] **P4 — Phase 4 finalize-or-abort.** Non-skippable terminal checklist in SKILL + template.
- [x] **P5 — Cost block multi-source honesty.** Template §2 Cost + monitor-ledger multi-source table.
- [x] **P6 — Command surface.** `dev-dogfood.md` `--save` no-op / always-on.
- [x] **P7 — Platform notes restatement.** SKILL Codex/etc. section dual-path + Cost + footer paths.
- [x] **P8 — Consumer gate.** super-coder terminal #5 adds status frontmatter.
- [x] **P9 — README.** `docs/dogfood/README.md` always-on.
- [x] **P10 — Dogfood-of-dogfood proof.** Observe-only CLI smoke without `--save` (paths in Testing).
- [x] **P11 — task check + handoff.** Solution/Testing/Review filled; task `done`.
### Solution
| File | What / Why |
|------|------------|
| `plugins/sp/skills/dogfood-testing/SKILL.md:43` | Protocol diagram: REPORT is finalize-or-abort with dual paths + footer. |
| `plugins/sp/skills/dogfood-testing/SKILL.md:55` | `--save` back-compat no-op; always-on dual write. |
| `plugins/sp/skills/dogfood-testing/SKILL.md:80-88` | Phase 1 opens live + docs/dogfood skeleton with `status: running` and protocol@1.1. |
| `plugins/sp/skills/dogfood-testing/SKILL.md:109-140` | Phase 3 dual-write + Phase 4 non-skippable finalize-or-abort checklist. |
| `plugins/sp/skills/dogfood-testing/SKILL.md:194-280` | Platform notes restate dual-path, status, Cost, footer with Live+Report paths. |
| `plugins/sp/skills/dogfood-testing/references/report-template.md:19-47` | Always-on dual artifacts + frontmatter schema. |
| `plugins/sp/skills/dogfood-testing/references/report-template.md:109-125` | Cost block multi-source honesty rules. |
| `plugins/sp/skills/dogfood-testing/references/report-template.md:239-280` | Footer always prints `[Live:]` + `[Report:]`. |
| `plugins/sp/skills/dogfood-testing/references/monitor-ledger.md:17-35` | Disk SSOT + dual-write every step (live first). |
| `plugins/sp/skills/dogfood-testing/references/monitor-ledger.md:75-90` | Multi-source Cost table for meters. |
| `plugins/sp/commands/dev-dogfood.md:36-53` | Command surface: always-on delivery; thin-wrapper Behavior. |
| `plugins/sp/agents/super-coder.md:198-260` | Dogfood mode dual artifacts; terminal gate #5 adds status frontmatter. |
| `docs/dogfood/README.md:1-32` | Operator-facing always-on delivery notes. |
| `docs/help/how_to_use_dev_slash_commands_for_daily_software_development.md:304` | Help example no longer implies `--save` is required for a report. |
| `.gitignore:156-158` | **Post-verify fix:** ignore report files under `docs/dogfood/*` but track `README.md` so R12 hygiene ships. |

**R10 proof run** (observe-only, **without** `--save`):
- Live: `.spur/run/dogfood/0244-proof-20260712T112609.md`
- Report: `docs/dogfood/2026-07-12-spur-task-check-0244-contract-smoke-dogfood.md`
- Testee: `spur task check 0244 --json`
- Verified: `### 3. Monitor Ledger`, `── Dogfood Summary ──`, `status: complete`, `#### Cost`, `[Live:]`, `[Report:]`
### Testing
**Re-verify:** `/sp:dev-verify 0244 --auto --focus all --fix all --force` (2026-07-12)
**Verdict: PASS** (post-fix)
**Coverage:** N/A (documentation-only / skill-protocol change; no runtime code path added).

**Per-requirement traceability**

| Req | Status | Evidence type | Evidence |
|-----|--------|---------------|----------|
| R1 dual artifacts Phase 1 | MET | static-ref | `plugins/sp/skills/dogfood-testing/SKILL.md:80-88` — open live + docs/dogfood, `status: running` |
| R2 disk dual-write every step | MET | static-ref | `plugins/sp/skills/dogfood-testing/references/monitor-ledger.md:17-35` Disk SSOT; `SKILL.md:109-116` mirror row to report path |
| R3 partial status model | MET | static-ref | `plugins/sp/skills/dogfood-testing/references/report-template.md:37` status enum; `:66` incomplete markers |
| R4 finalize-or-abort | MET | static-ref | `SKILL.md:124-140`; `plugins/sp/skills/dogfood-testing/references/report-template.md:241` non-skippable gate |
| R5 minimal structure | MET | static-ref | frontmatter + protocol@1.1 + **Repro** (`plugins/sp/skills/dogfood-testing/references/report-template.md:86`) + `#### Cost` (`:109`) |
| R6 Cost honesty | MET | static-ref | Method/confidence/Meter rules `plugins/sp/skills/dogfood-testing/references/report-template.md:111-122`; multi-source table `plugins/sp/skills/dogfood-testing/references/monitor-ledger.md:79-90` |
| R7 `--save` no-op | MET | static-ref | `plugins/sp/commands/dev-dogfood.md:36-42`; `SKILL.md:55`; gotcha #8 `:209` |
| R8 surface sync | MET | command | surfaces present: SKILL, report-template, monitor-ledger, dev-dogfood; platform notes restate dual-path (`SKILL.md:234-280`) |
| R9 consumer gate | MET | static-ref | `plugins/sp/agents/super-coder.md:260` rg status complete\|aborted + ledger + footer |
| R10 dogfood proof | MET | command | Live `.spur/run/dogfood/0244-proof-20260712T112609.md` + Report `docs/dogfood/2026-07-12-spur-task-check-0244-contract-smoke-dogfood.md` without `--save`; rg counts: ledger=1 footer=1 status=1 cost=1 Live=1 Report=1 Meter=1 |
| R11 out of scope | N/A | command | no `dogfood-testing/scripts/`; apps/packages dirty count=0; no runner language in skill |
| R12 docs hygiene | MET | static-ref + command | help `docs/help/...:304` always-on wording; README trackable after `.gitignore` un-ignore `!/docs/dogfood/README.md` (post-fix); reports still ignored via `/docs/dogfood/*` |

**Acceptance Criteria Verification**

| AC | Status | Evidence type | Evidence |
|----|--------|---------------|----------|
| Scenario: R1 dual artifacts open at plan time | MET | static-ref + command | Protocol `SKILL.md:80-88`; proof files both exist |
| Scenario: R2 ledger row written on each step resolve | MET | static-ref | Dual-write rules; proof ledger has step row before finalize |
| Scenario: R4 terminal gate footer both paths | MET | command | Proof contains `[Live:]` and `[Report:]` and summary footer |
| Scenario: R3 partial report incomplete markers | MET | static-ref | `report-template.md:66,175` incomplete markers (contract; no live abort this run) |
| Scenario: R6 cost block is honest | MET | command | Proof Cost Method LOW + Meter n/a |
| Scenario: R7 save not required for delivery | MET | command | Proof report exists; body notes open without --save |
| Scenario: R10 dogfood-of-dogfood proof | MET | command | Same as R10 |

**Design conformance**

| Claim | Status | Evidence |
|-------|--------|----------|
| Approach 1 skill+template only | DONE | No scripts/, no apps/packages, no new CLI verb |
| Live `.spur/run/dogfood/` + always docs/dogfood | DONE | SKILL Phase 1 + proof artifacts |
| Partial-OK status model | DONE | report-template status enum |
| Multi-source Cost + confidence | DONE | Cost block + monitor-ledger table |
| Terminal finalize-or-abort checklist | DONE | Phase 4 + gotchas 7–8 |
| `--save` back-compat no-op | DONE | command + skill args |
| Deferred Approach 2/3 | DONE | R11 N/A + explicit out-of-scope |

**Fix pass (`--fix all`)**

| Issue | Severity | Fix |
|-------|----------|-----|
| R12 README under `/docs/dogfood` was fully gitignored → always-on operator note could not ship | major (R12 PARTIAL) | `.gitignore`: `/docs/dogfood/*` + `!/docs/dogfood/README.md`; README now untracked-visible; report files still ignored |

**Commands run this verify**

```
spur task check 0244 --json          → pass:true (L4 feature_id advisory)
rg / ls evidence sweeps              → R1–R12 as tabled
git check-ignore docs/dogfood/*      → reports ignored; README not (after fix)
```
### Review
| Priority | Finding | Status | Notes |
|----------|---------|--------|-------|
| P1 | (none) | — | — |
| P2 | (none) | — | — |
| P3 | Residual: delivery still agent-cooperative (no hard runner). Approach 2 scripts deferred if format drift returns. | OPEN (deferred) | Expected; out of scope R11 |
| P4 | (none) | — | — |

**Residual risk:** Protocol is prompt-enforced; misbehaving sessions can still skip finalize-or-abort despite loud MUST language + super-coder rg gate.

**SECUA:** Correctness of contract language verified against R1–R12; no security/runtime surface in this docs-only change.

**Disposition:** PASS for scope of Approach 1.
### References
- Brainstorm (SSOT for decisions): `docs/plans/2026-07-12-dogfood-testing-hardening-brainstorm.md`
- Skill: `plugins/sp/skills/dogfood-testing/SKILL.md`
- Report template: `plugins/sp/skills/dogfood-testing/references/report-template.md`
- Monitor ledger: `plugins/sp/skills/dogfood-testing/references/monitor-ledger.md`
- Command: `plugins/sp/commands/dev-dogfood.md`
- Design extraction (0125): `docs/design/dev-agent-flag-and-dogfood-skill.md`
- Report contract enforcement: task `0184` / parent `0182`
- Cache estimate honesty: task `0139`
- Orthogonal mandatory-dogfood gate: `docs/plans/2026-07-09-p3-mandatory-dogfood-design.md`
- Local report dir README: `docs/dogfood/README.md`
### History
- 2026-07-12T18:22:58.397Z backlog → todo (system)
- 2026-07-12T18:26:21.879Z todo → wip (system)
- 2026-07-12T18:26:39.721Z wip → testing (system)
- 2026-07-12T18:27:11.912Z testing → done (system)
