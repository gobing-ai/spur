# E5 Batch Execution — Forensic Report (Session Forensics)

**Date:** 2026-08-14 · **Feature:** E5 — Session forensics (import retention, derived variables, report modes, find-issue rewrite)
**Tasks:** 0553 · 0554 · 0555 · 0556 (all PASS, done) · **Feature status:** done on `main`
**Commits:** 0553 `6df7c1a4` · 0554 `492983d3` (+`32da928b`,`8b42f2a2` done-chore) · 0555 `19a5d8e8` · 0556 `99fc4072`
**Report source:** omp session log `~/.omp/agent/sessions/-xprojects-spur-new/2026-08-14T05-08-50-313Z_019ffeac-4409-7000-b24a-e83e8ede74bb.jsonl` (9.9 MB)
**Analysis artifacts:** `.spur/reports/history/2026-08-14/analyze-2f1a310f.{json,md}` (day window); `/tmp/e5-assistant.tsv` (1,112-line assistant-event extraction)
**Confidence:** High for aggregate token/cost/model figures (data plane); Medium for per-task boundaries (derived from commit timestamps + manual gap analysis, because task↔session structured linkage did not exist at analysis time — the capability E6 subsequently shipped).

---

## Executive Summary

The E5 batch (4 tasks, sequential inline) completed with all PASS verdicts in a **~14.2h wall-clock window** containing roughly **3.9h of active agent compute**. Model spend for the window was **~$5.3** across three models (deepseek-v4-flash, glm-5.2, glm-5.3), dominated by **136M cache-read tokens** — a 6,258% cache-hit ratio against 2.17M billed input tokens, i.e. full-context re-send per turn. The single largest measurement defect: **82% of wall time (14.7h) is unattributable** because omp toolResult records carry no durations, so only assistant-LLM latency (3.1h) is measurable.

Cross-check against the E6 follow-up (tasks 0557–0559, feature "Run-to-session correlation and cost-path repair", commit `4a10fa12`) showed **two of the four S1/S2 findings were already fixed by E6** after this analysis ran: F2 (task↔session join) and the cost-attribution path. The remaining open findings — F1 (toolResult durations), F3 (`report` flag passthrough), F4 (omp `arguments` vs fixture `input` drift) — are filed as task **0564** with full fix detail.

---

## 1 · Time / Token / Cost per Step

### Window aggregates (04:00Z → session end)

| Metric | Value |
| --- | --- |
| Sessions in window | 14 |
| Messages | 4,635 |
| Tool calls | 1,570 |
| Billed input tokens | 2.17M |
| Output tokens | 627K |
| Cache-read tokens | **136M** (cache-hit ratio 6,258% vs billed input) |
| Approximate spend | **~$5.3** — deepseek-v4-flash $2.25 · glm-5.2 $2.02 · glm-5.3 $1.04 |
| LLM latency (measurable) | 3.1h — **18%** of window |
| Unattributed wall time | **14.7h — 82%** (no toolResult durations; see F1) |
| Idle gaps > 10m | 4 (see §1.3) |
| Test/build commands | 183 |
| Compactions | 30 |

### History import (data-plane foundation)

| Source | Files | Messages | Parse errors | Duration |
| --- | --- | --- | --- | --- |
| omp | 872 | 352,731 | 19 | 187s |
| agy | — | — | degraded | — |

Mode: `full` (real write, no `--dry-run` — dry-run writes nothing; provenance header recorded per task-0504 contract, source-local binary `bun run apps/cli/src/index.ts`).

### Per-task breakdown (UTC; boundaries = commit timestamps, PDT = UTC−7)

| Task | Active | Window | Notes |
| --- | --- | --- | --- |
| 0553 import retention | ~63m | 126m | Commit `6df7c1a4` 07:16Z; includes migration 0012 `args_raw` + session-formats reduction |
| 0554 MetricRegistry | ~45m | 545m | Commit `492983d3` 16:19Z; window includes **496m operator absence** 07:37→15:53Z |
| 0555 report modes | ~83m | ~83m | Commit `19a5d8e8` 17:45Z; densest task — 89 test commands/hour |
| 0556 find-issue rewrite | ~42m | ~42m | Commit `99fc4072` 18:25Z; cleanest/fastest run of the batch |
| **Total active** | **~3.9h** | **~14.2h** | |

### Idle gaps > 10 minutes

| Gap (UTC) | Length | Attribution |
| --- | --- | --- |
| 06:11 → 07:14 | 63m | Unexplained (no operator input, no tool activity) |
| 07:37 → 15:53 | 496m | Operator absence |
| 16:35 → 16:59 | 25m | Partially operator-side |
| 18:25 → 18:37 | 12m | Wrap-up spacing |

---

## 2 · Issues Found (status after E6 cross-check)

| ID | Severity | Issue | Evidence | Status |
| --- | --- | --- | --- | --- |
| **F1** | S1 | omp toolResult records carry **no durations** → 82% of window wall time unattributed; analytics can only measure assistant-LLM latency (3.1h) | `run-cost.ts:189` hardcodes `durationMs: 0` + `durationUnmeasured` counter; schema column `history_message.duration_ms` exists and is aggregated (`forensic-query.ts:153`) but omp importer never populates it for tool results | **OPEN → task 0564 R1** |
| **F2** | S1 | `history analyze --task 0556` returned 0 records despite recorded run-link | Analyze ran before any run→session linkage existed; inline runs emit no env/run-id stamps | **FIXED by E6** — 0557 `run-session-observer.ts` (invoke-boundary mapping), 0558 `retro-correlation.ts` (time-window correlation), 0559 provenance alignment; `--task` selector live (`history.ts:135`) |
| **F3** | S2 | `history report` (pure renderer) lacks `--task` / `--top` flags present on `analyze` | `history report --help`: only `--json`, `--mode <name>` | **OPEN → task 0564 R2** |
| **F4** | S3 | Fallback test fixture parses `block.input.command`; live omp schema emits `block.arguments.command` → categorizer blind on real omp logs | `plugins/sp/tests/issue-finding-fallback.test.ts:55` reads `block.input`; live log `content[]:{type:"toolCall", name, arguments:{command,…}}` | **OPEN → task 0564 R3** |

### Minor findings (recorded, no dedicated fix)

- **Stale installed skill copy:** the `sp-dev-find-issue` invocation during analysis came from `~/.agents/skills/sp-dev-find-issue` which still carried pre-0556 flags (`--use-history` / `--no-task`). The repo rewrite does not update installed copies — reinstall/sync needed to dogfood new surfaces.
- **agy importer degraded:** 872-file omp import clean (19 parse errors), agy path degraded — consistent with agy having no discoverable on-disk session format (`session-formats.md` "agy" row).
- **Commit-timestamp boundary fallback:** task↔session correlation had to be reconstructed manually from commit times + gap analysis. E6's retro-correlator now automates this class; note for future forensics: run `analyze` **after** importing, never mid-batch.

---

## 3 · Performance Observations (measurement, not tasked)

1. **Cache-read dominance (136M vs 2.17M billed):** expected — full context re-sent each turn. The lever is fewer/smaller context re-sends (indexed-context lookups, `.spur/context/anatomy.md`), **not** code changes.
2. **Test-command density:** 0555 peaked at 89 test commands/hour; 183 total across the batch. Targeted-test-first (`bun test <file> --test-name-pattern`) was already followed — the density is the suite being exercised, not waste.
3. **30 compactions:** context churn from full-file reads. Same lever as (1).
4. **0556 was fastest (42m)** despite being the largest surface rewrite — attributable to the handoff-summary discipline (prior-session summary carried forward, minimal re-reading). This is the process pattern to replicate.

---

## 4 · Process / Workflow Enhancements

Observed friction, with disposition. Concrete code-fixable items landed in task **0564**; behavioral items recorded here for replication.

| Observation | Disposition |
| --- | --- |
| FSM vocabulary re-learned each session — 0553 `done` took 5 attempts, 10 `--help` lookups; 0554 verdict drafted 3× | Recorded; the FSM constraint (`todo→testing` denied; must go `wip→testing→done`) is in AGENTS.md and task-pipeline docs. A resume-banner ("you are at X, valid next: Y") is a cheap future enhancement — not tasked (UI surface, low ROI) |
| Handoff summaries work — 0556 (fastest, cleanest) reused the prior session's structured summary | **Replicate:** always carry forward the prior-session summary block when continuing a batch |
| Mixed binaries early in batch (global `spur` vs source-local) | Already contract (AGENTS.md 0504 rule): source-local binary for history verbs. Held throughout E5 after initial correction |
| Verdict answer format (Req/AC evidence tables + gates line) | Proven across 0553–0556 — keep as the standard shape |
| Data-plane-primary dogfood (`import` → `analyze` → `report --mode forensics`; raw JSONL only where the data plane can't split) | Followed; the one gap (per-step timing) is exactly F1/0564-R1 |

---

## 5 · What Worked Well

- **Report-first discipline held under dogfood:** E5's own forensics ran through the surface E5 built (`history import` → `analyze` → `report --mode forensics`), falling back to raw JSONL only for per-step timing the data plane couldn't express.
- **Deterministic verdicts:** `spur task verdict --from-answer` kept all four verdicts authoritative; the Req/AC evidence-table answer shape parsed cleanly every time after 0553's learning.
- **Gates all green at each done:** coverage 90/90 per-file, biome format, linters (ts-no-tiny-functions, ts-set-map, ts-import-type, tsdoc-export), corpus-check two-sided, transition-shim 4/4 — no `--no-verify` or silent `biome-ignore` anywhere in the batch.
- **0556 shipped the sanctioned minimal removed-flag surface** (SKILL.md:117 table + command Report-first para + red-flag list) with sync surfaces landed same-commit (expected-findings.json, session-formats.md, dev-operations.md, docs/help, 04_DESIGN.md).
- **Commit scope discipline:** task files only; `.spur/tmp/` scratch and the operator's unrelated dirty files excluded — matched the `19a5d8e8` pattern on every commit.

---

## 6 · Follow-ups

| WBS | Title | Covers | Priority | Status |
| --- | --- | --- | --- | --- |
| 0564 | Fix E5 forensic-report findings: toolResult durations, report flag passthrough, omp arguments-shape drift | F1 (S1), F3 (S2), F4 (S3) | P2 | backlog |
| — | F2 task↔session join | **already shipped** as E6 (0557/0558/0559, `4a10fa12`) | — | done |

Related but separate: E6's own forensic report is `docs/report/2026-08-14-E6-batch-forensic-report.md` (tasks 0560–0563 track its findings).

---

## Appendix A — Evidence Anchors

```
F1  packages/domain/src/analytics/run-cost.ts:189          durationMs: 0 (hardcoded)
    packages/domain/src/analytics/forensic-query.ts:153    SUM(m.duration_ms IS NULL) tracked
    schema: history_message.duration_ms (importer-owned HISTORY_IMPORT_SCHEMA_SQL)
F2  packages/app/src/services/run-session-observer.ts      (E6 0557 — invoke-boundary mapping)
    packages/domain/src/analytics/retro-correlation.ts     (E6 0558 — time-window correlation)
    packages/domain/src/dao/run-session-dao.ts:144–176     (E6 0559 — provenance alignment)
    apps/cli/src/commands/history.ts:135                   --task selector live
F3  apps/cli/src/commands/history.ts:117–124 (report cmd)  only --json / --mode
    vs analyze: history.ts:134–136                          --run / --task / --top
F4  plugins/sp/tests/issue-finding-fallback.test.ts:44–58  parseToolCalls reads block.input.command
    live omp: content[] toolCall blocks use .arguments.{command,path,pattern,...}
```

## Appendix B — Reference Links

- Session log: `~/.omp/agent/sessions/-xprojects-spur-new/2026-08-14T05-08-50-313Z_019ffeac-4409-7000-b24a-e83e8ede74bb.jsonl`
- Feature: `docs/features/E5_session-forensics-implementation-retention-derived-variables-report-modes-find-issue-rewrite.md`
- Analyze artifacts: `.spur/reports/history/2026-08-14/analyze-2f1a310f.{json,md}`
- Assistant-event extraction: `/tmp/e5-assistant.tsv` (scratch, may be reclaimed)
- Task 0564: `docs/tasks4/0564_fix-e5-forensic-report-findings-toolresult-durat.md`
- E6 report (parallel session): `docs/report/2026-08-14-E6-batch-forensic-report.md`
