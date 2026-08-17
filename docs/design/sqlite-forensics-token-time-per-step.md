# SQLite-Sourced Session Forensics — Token/Time Per Step Analysis

**Date:** 2026-08-17 · **Data source:** `.spur/spur.db` (imported history plane, all coding agents) · **Purpose:** prep for the new `/sp:dev-find-issue` (SQLite data plane, replacing ad-hoc JSONL parsing)

This replicates the issue + token/time-per-step analysis we ran yesterday (tasks 0568–0575) via the slash command, but **reads from SQLite** instead of raw JSONL. Every number below was derived directly from `history_message` / `history_tool_call` / `phase_runs`.

---

## 1. Data-plane coverage reality (what SQLite retains per source)

| Source | Msgs | Assistant steps | In tok | Out tok | Cache read | Cost | LLM time | Tool calls | Steps w/ duration | Steps w/ model |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **omp** | 267,969 | 89,662 | 803M | 34.5M | 11.56B | **$976.65** | **302h** | 101,785 | 99.6% | 100% |
| **opencode** | 11,609 | 11,034 | 776M | 1.73M | 744M | $23.66 | 131h | 16,540 | 99.9% | 99.9% |
| **pi** | 209,393 | 3,193 | 317M | 31.2M | 10.04B | $473.89 | 0h | 0 | **0%** | 100% |
| **grok** | 758,572 | 93,679 | 1.18B | 4.75M | 1.14B | $0 | 23.4h | 86,328 | **15.7%** | **0.5%** |
| **claude** | 95,050 | 35,766 | 100 | 50 | 0 | $0 | 76h* | 0 | **0%** | **0%** |
| **agy** | 58,670 | 28,345 | 0 | 0 | 0 | $0 | 0h | 26,522 | **0%** | **0%** |
| **codex** | 253,112 | **0** | 0 | 0 | 0 | $0 | 0h | 0 | — | — |
| **gemini** | 1,830 | 1,389 | 201M | 495K | 169M | $0 | 0h | 1,253 | **0%** | 100% |

\* claude `duration_ms` present on 76h aggregate but 0/35,766 steps individually have it → likely a sum artifact; treat as unverified.

**Fidelity tiers:**

- **High (usable for token+time per step):** `omp`, `opencode`
- **Medium (tokens only, no time):** `pi`, `gemini`, `grok` (partial)
- **Low (no token/time, counts only):** `claude`, `agy`, `codex`

## 2. Token/time per step findings (the core analysis)

### 2a. Heaviest steps — context bloat (omp)

Top steps run **~590K tokens each** (≈640K context ceiling) on `deepseek-v4-flash`, almost entirely **cache-read** (589–591K of ~590K). 8+ steps at 588–592K = the model re-feeds near-full context every step. This is the classic **context-window re-fill pattern** — expensive per step, and the *effective* fresh cost is low (mostly cached) but the *latency* and *input-batch* cost is maxed every turn.

### 2b. Longest steps — latency outliers (omp)

- Up to **1412s (23.5 min)** on `glm-5.1`, and 550–682s on `glm-5.2/5.3`.
- Notably the longest steps report `in 0 / out 0` — **usage missing on the slowest steps**, so cost attribution for them is blind.
- Slowest avg per-step models: `deepseek-v4-flash-ga-260731` 38.1s, `k3` 22.0s, `glm-5.2` 14.6s.

### 2c. Cache efficiency per step (fresh vs cached input)

| Source | Cache-hit ratio | Worst pattern |
| --- | --- | --- |
| omp | 93.5% | **2,478 steps** >100K fresh input with <10% cache reuse = **354M fresh tokens** re-sent |
| opencode | 48.9% | 89 steps >100K fresh / <10% cache |
| gemini | 45.7% | 112 steps same pattern |
| grok | 49.0% | 1 step |
| pi | 95.8% | (only 3,179 steps with usage) |

**The actionable waste is `omp`: 354M fresh tokens re-sent across 2,478 steps with no cache reuse** — a concrete, fixable context-management anti-pattern.

### 2d. Cost concentration (omp)

Top single step $0.52 (522K fresh input, only 38K cache) — heaviest steps are also the least cache-efficient. Cost driver is `glm-5.2` ($151) then `deepseek-v4-pro` ($83).

## 3. Issues identified (IDENTIFY)

> **Root-cause pass 2026-08-17.** The measurements in §1/§2 were re-derived against `.spur/spur.db`
> and all hold. **I1 and I3 were misdiagnosed** in the first pass and are corrected below; I0 and
> I7–I9 were missed entirely. Severity re-ranked accordingly.

| ID | Severity | Issue | Evidence | Where |
| --- | --- | --- | --- | --- |
| **I0** | **S0** | **Landed mapper fixes never reach the data plane.** Spur has `ts-llm-jsonl-importer@0.4.33`; ts-libs source is at **0.4.35** and already contains task 0564's omp tool-call timing (`call_id`, `details.wallTimeMs`). On top of that, `spur history import` is checkpoint-resumed and additive, so **rows imported before a mapper fix are never revisited**. Task 0553 (`done`) allowlists omp `todo` args: **3,237 eligible omp todo calls exist, 6 carry `args_raw`.** Tasks 0553 and 0564 are marked done and are ~0% effective on the corpus. | installed `0.4.33` vs ts-libs `0.4.35`; `args_raw` 6 / 232,429 | release + `bun update` + `--mode full` re-import |
| **I1** | **S0** | **Time decomposition is poisoned by epoch-0 timestamp sentinels — not a "scale bug".** The mappers write `new Date(0).toISOString()` when no timestamp parses (`mappers.ts` `defaultCreatedAt` / every `…?? new Date(0).toISOString()`), landing **39,783 rows at `1970-01-01T00:00:00.000Z`** (claude 16,743 · grok 20,189 · codex 2,289 · omp 560 · gemini 2). `decompositionMetric` takes `MAX(ts) − MIN(ts)` per session, so one sentinel row stretches a session to ~56 years. For omp: **558 of 917 sessions are poisoned and contribute 100.00 % of the 9.96e14 ms span**; the 359 clean sessions total **827 h** — the real number. Separately, pi stores **16,424 raw epoch-millis strings** (`"1786684271589"`), which `new Date(...)` parses as **Invalid Date → NaN**, and `MIN/MAX(ts)` is a **string** comparison across the two formats. | `SELECT source, COUNT(*) … WHERE ts LIKE '1970-%'`; span replay over omp sessions | `derived.ts:259-298` + mapper timestamp fallbacks |
| **I2** | **S1** | **Tool duration not captured** for omp/agy/gemini (0/101,785 omp tool calls) → `toolMs: 0`, Per-Tool exec time empty for the richest source. **Already fixed upstream in 0.4.35** — this is an instance of I0, not unwritten code. | `history_tool_call.duration_ms` null; installed `ompSplit` hard-codes `duration_ms: undefined` | gated on I0 |
| **I3** | **S1** | **Per-Phase unavailable — `phase_runs` is the wrong table.** `phase_runs` holds **2,065 rows** and belongs to the workflow FSM (`run_id`/`phase`/`status`), unrelated to history. `phaseSupport: 'unsupported'` comes from `ctx.todoCalls.length === 0` (`derived.ts:250`), and `todoToolCalls` requires `tc.args_raw IS NOT NULL` (`forensic-query.ts:458`) — satisfied by **6 of 232,429** tool calls. ~4,572 todo-named calls exist (`todo` 3,237 · `todo_write` 954 · `todowrite` 379 · `todoread` 2) but carry no raw args. Root cause is I0, not a missing signal. | `phase_runs` = 2,065 rows; `args_raw` non-null = 6 | gated on I0 |
| **I4** | **S1** | **Context re-send waste** — omp 2,478 steps re-send >100K fresh tokens with <10% cache reuse (**354,130,045** fresh tokens, exact). | per-step cache query (re-verified) | agent context mgmt |
| **I5** | **S1** | **codex has zero assistant messages.** 253,112 codex rows carry codex **record types** as roles (`response_item` 153,776 · `event_msg` 91,780 · `turn_context` 3,309 · `session_meta` 1,379 · `function_call` 429). Same defect class as pi (task 0577) — a mapper bug, not an upstream-data limitation. Every role-scoped metric silently reads 0 for codex. | `SELECT role, COUNT(*) … WHERE source='codex'` | `codexSplit` |
| **I6** | **S2** | **P2 watermark** collapses pi to 1 session; analysis under-reports pi. | analyze `--source pi`: 1 session, 16,424 of 209,393 msgs | `watermark.ts` degrade rule — **task 0576 (wip)** |
| **I7** | **S1** | **claude usage extraction is broken.** Roles are canonical, but 35,766 claude assistant messages carry **100 input tokens and 50 output tokens in total**, 0 cache-read, $0 cost. A distinct defect from codex/pi (role mapping is fine; the usage path is not). | per-source aggregate | `claudeSplit` usage extraction |
| **I8** | **S2** | **`tool_name` holds command text.** **7,407** `history_tool_call` rows have a `tool_name` longer than 80 chars — multi-KB shell scripts and heredocs stored as the tool name. Pollutes every per-tool grouping and Q4 loop detection. | `SELECT COUNT(*) … WHERE length(tool_name) > 80` | mapper tool-name extraction |
| **I9** | **S2** | **grok is 87 % meta.** 662,935 of 758,572 grok rows are `meta`/`meta`; model present on 0.5 % of assistant rows, duration on 15.7 %. The "758K messages" headline overstates grok's analytic value by ~8×. | role/disposition breakdown | `grokSplit` |

## 4. Proposed fixes (PROPOSE) + what the new command needs

Corrected for the root-cause pass. **F1 and F3 are re-aimed; F2 and F6 are re-scoped as consequences
of I0; F7 is already shipped.** Task column filled after conversion.

| ID | Fix | Target | Task |
| --- | --- | --- | --- |
| **F0** | **Close the release/re-import gap.** `bun update` to `ts-llm-jsonl-importer@0.4.35`, `--mode full` re-import, verify the landed 0553/0564 retention actually appears in the DB, and make "mapper task done" require data-plane evidence rather than a source diff. Gates F2, F3, F6, and task 0577. | `package.json` + `spur history import` + task-done contract | **0578** |
| **F1** | **Stop consuming sentinel timestamps in span math** — exclude `1970-01-01T00:00:00.000Z` and non-ISO `ts` from `MIN/MAX(ts)`, reject non-finite spans, and keep `unattributedMs` meaning "durations were unmeasured" (do **not** rebucket it — `derived.ts:354-361` depends on that signal). Do **not** clamp: clamping discards 61 % of omp sessions instead of repairing them. | `packages/domain/src/analytics/derived.ts` + `forensic-query.ts` span query | **0579** |
| **F2** | Tool `duration_ms` for omp/agy/gemini. **Already written upstream (0.4.35) for omp**; agy/gemini remain. Delivery is F0's job. | importer mappers | **0578** (omp) · **0580** (agy/gemini) |
| **F3** | Make Per-Phase render by getting `args_raw` onto todo calls — a re-import (F0), not a `phase_runs` population. Extend the todo allowlist to the tool names actually observed (`todo_write`, `todowrite`, `todoread`). | allowlist + F0 | **0578** |
| **F4** | Expose **per-step (per-message) token/time** in the analyze artifact: top-N steps by tokens and by duration, per model, plus per-step cache efficiency. SQLite already holds this at message granularity; the artifact aggregates it away. | `history-service.ts` analyze + artifact schema | **0581** |
| **F5** | Rank context-bloat: aggregate fresh-vs-cached input per session/step so I4's 354M-token waste surfaces as an ordered list rather than a one-off query. | analyze artifact + forensics renderer | **0581** |
| **F6** | Mapper fidelity for the broken sources: codex roles (I5), claude usage (I7), `tool_name` pollution (I8), grok meta ratio (I9), and the epoch-0 sentinel (I1 upstream half). | importer mappers | **0580** |
| **F7** | ~~Drive `/sp:dev-find-issue` from the typed data plane only.~~ **Already shipped** — task 0556 (`done`) made the command report-first over the data plane and removed `--use-history`; task 0492 (`done`) fixed the command/skill split. No task. | — | — |

## 5. Design notes for the new `/sp:dev-find-issue`

1. **Per-step granularity is the differentiator.** SQLite retains per-message tokens/duration/model/role — the analyze artifact currently aggregates them away. The new command should emit a per-step section (`top steps by tokens`, `by duration`, `cache-efficiency`), which is what makes this better than yesterday's JSONL approach (no raw parsing, typed and indexed).
2. **Honesty tiers by source** must be part of the report (High/Medium/Low fidelity per source) so the 8 sections don't silently show empty Tool/Time rows for claude/agy/codex.
3. **The forensics renderer's `derived` sections are only as good as the typed signals**: fix F1–F3 first, then the Bottleneck/Per-Phase/Per-Tool sections become real. Until then, the token-profile + per-step sections carry the analysis.
4. **Watermark P2 (I6) must be resolved before pi analysis is trustworthy** — task 0576 R1/R2 tracks it.
5. **A mapper fix is not done when the source diff is written.** I0 is the lesson: two tasks (0553, 0564) are `done` with correct upstream code and ~0 % effect on the corpus, because release → `bun update` → `--mode full` re-import never followed. Treat "measured against `.spur/spur.db`" as the only acceptance evidence for retention work — a source-read verdict is what let task 0489 mark pi **session-discovery ✅** while the data said otherwise.
6. **Sequence.** `0578` (release + re-import) unblocks the retention claims; `0579` (span sanitization) and `0581` (per-step artifact) are independent of it and can run in parallel; `0580` (mapper fidelity) needs `0578`'s re-import contract to be verifiable and shares the ts-libs release train with `0577`.

## 6. Raw evidence (SQL)

```sql
-- per-source aggregate
SELECT source, COUNT(*), SUM(role='assistant'), SUM(input_tokens), SUM(output_tokens),
       SUM(cache_read_tokens), SUM(cost_usd), SUM(duration_ms), COUNT(*) FILTER (WHERE duration_ms IS NULL)
FROM history_message GROUP BY source;

-- context re-send waste (omp)
SELECT COUNT(*), SUM(input_tokens) FROM history_message
WHERE source='omp' AND role='assistant' AND input_tokens>100000 AND cache_read_tokens < input_tokens*0.1;

-- tool duration coverage
SELECT source, COUNT(*), SUM(duration_ms IS NOT NULL) FROM history_tool_call GROUP BY source;

-- heaviest steps
SELECT model, input_tokens, cache_read_tokens, output_tokens, cost_usd, duration_ms
FROM history_message WHERE source='omp' AND role='assistant' ORDER BY (input_tokens+cache_read_tokens) DESC LIMIT 20;
```
