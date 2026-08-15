# 0548 — Incremental import & analyze cost on real data (E3 measurement)

Measured 2026-08-14, 12:54–13:04 local, on this machine's real agent session data. This artifact is
the citeable input to tasks 0549 (trigger design) and 0550 (trigger implementation); its figures are
the traceability source those tasks' coalescing-window requirements point back to.

## Provenance (R3 — applies to every figure below)

Every invocation used a **source-local binary** per the AGENTS.md mandate, never a bare global
`spur`:

```text
binary:   /Users/robin/xprojects/spur-new-runall-e3-ba534a7a/apps/cli/src/index.ts
importer: @gobing-ai/ts-llm-jsonl-importer@0.4.33
invoked:  bun run apps/cli/src/index.ts history <verb> …  (from the repo root)
```

Each measured run used `--json`, whose payload embeds the same `provenance` field
(`apps/cli/src/commands/history.ts:27-36`); the field resolved identically to the header above on
every run. Machine: Apple M5, 10 cores, 32 GB RAM, local SSD. Database: worktree-local
`.spur/spur.db` (SQLite + WAL). All imports were **real writes** (no `--dry-run`); see "Method".

## Method

- **Steady state (R1)** — the condition the trigger runs in: an import had completed seconds earlier
  (all ~4.6k source files checkpointed), then the same import was timed again. Measured per source
  (six separate invocations) and as one `--source all` fan-out (single process, ten sources).
- **Analyze (R2)** — `history analyze --out <tmp>` timed twice on the populated DB, never bundled
  with import in the same process.
- **Backlog (R4)** — two bounds. (a) *Maximal*: first import into an empty DB (every session
  unimported), timed per source. (b) *Realistic*: checkpoints deleted for every source file modified
  in the preceding 72 h (a long-weekend idle), then one `--source all` catch-up timed; backlog size
  recorded from the file count and line count deleted.
- Fixed process overhead isolated with `--source openclaw` (root absent on this machine → pure
  bun + CLI init + DB open cost).
- Wall clock via bash `time` (ms precision); corpus sizes from `du`/`find` over the six roots.

## Figures

### R1 — Steady-state incremental import (seconds after a previous import)

| Invocation | Wall | Files scanned | New records |
| --- | ---: | ---: | ---: |
| `--source claude` | 2.13 s | 320 | 0 |
| `--source codex` | 1.50 s | 1,370 | 0 |
| `--source pi` | 1.60 s | 1,318 | 24 |
| `--source omp` | 3.51 s | 874 | 30 |
| `--source agy` | 2.11 s | 185 | 231 |
| `--source grok` | 3.02 s | 494 | 24 |
| **six scoped runs, summed** | **13.87 s** | 4,561 | 309 |
| `--source all` (one process, 10 sources) | **20.64 s** | 4,593 | 24 |

Fixed overhead (`--source openclaw`, empty root): **0.59 s** — bun startup + CLI init + DB open.
The steady state is **scan-bound, not write-bound**: 20.6 s of fan-out produced only 24 inserts;
the cost is stat/realpath/checkpoint reads over ~4.6k files across ten roots, plus ~0.6 s fixed.

### R2 — Analyze pass (separate process, after import)

| Run | Wall | Corpus |
| --- | ---: | --- |
| 1 | 9.17 s | 1,534,579 records · 215,304 tool calls |
| 2 | 8.40 s | same |

Analyze is ~40 % of a steady-state all-fanout import — same order of magnitude, background-class.
It reads the whole DB and writes a versioned JSON artifact; it never opens source roots.

### R4 — Backlogged import (first firing after idle)

**(a) Maximal backlog — first import into an empty DB (real writes):**

| Source | Wall | Files | Records inserted |
| --- | ---: | ---: | ---: |
| claude | 10.70 s | 320 | 83,714 |
| codex | 34.48 s | 1,370 | 249,098 |
| pi | 32.81 s | 1,318 | 181,353 |
| omp | 75.67 s | 874 | 353,389 |
| agy | 11.92 s | 184 | 65,175 (degraded: 37 parse errors) |
| grok | 193.55 s | 494 | 785,548 |
| **total** | **359.1 s ≈ 6.0 min** | 4,560 | 1,718,277 |

**(b) Realistic backlog — 72 h idle simulated (checkpoints removed for files modified in the last
72 h):**

| Backlog size | Wall (`--source all` catch-up) | New records inserted |
| --- | ---: | ---: |
| 334 files / 248,156 lines (pi 57, claude 11, codex 23, omp 144, grok 99, agy 0) | **23.17 s** | 34 |

The ledger dedup (`record_hash` lookup, `history_import_ledger`) absorbed ~248k re-parsed lines into
34 inserts: a backlogged incremental costs ≈ steady state + parse time of the changed files, not a
re-import. Backlog cost therefore tracks *changed-file bytes*, bounded above by the maximal figure.

### Source corpus sizes (this machine)

| Source | Root | Files | MB |
| --- | --- | ---: | ---: |
| claude | `~/.claude/projects` | 320 | 203 |
| codex | `~/.codex/sessions` | 1,370 | 682 |
| pi | `~/.pi/agent/sessions` | 1,318 | 451 |
| omp | `~/.omp/agent/sessions` | 874 | 1,381 |
| agy | `~/.gemini/antigravity-cli/brain` | 184 | 634 |
| grok | `~/.grok/sessions` | 494 | 929 |

## Findings that shape the trigger

1. **No shape of this is sub-second.** Floor is 0.6 s fixed overhead; a scoped single source is
   1.5–3.5 s; the all-fanout steady state is ~21 s. A per-operation trigger firing synchronously in
   the operation path would add 14–21 s of work per agent op — unacceptable; even scoped-to-one
   -source it is 1.5–3.5 s of I/O in the hot path.
2. **Steady-state cost is scan-bound and idempotent-safe.** Writes are negligible (24 inserts in
   20.6 s); the ledger makes re-imports non-destructive. The trigger's cost risk is *serialized
   scans*, not DB mutation.
3. **Backlog is cheap beyond the first full import.** 72 h of idle cost 23.2 s to absorb (34 net new
   records). Only an empty DB pays the ~6 min maximal figure, and exactly once.
4. **The `all` fan-out includes gemini and opencode, which carry real data on this machine** (32
   files / 3,083 records and 1 file / 28,149 records imported on first run) despite the 2026-08-06
   unsupported-source ruling's "they import nothing". An `all`-scoped trigger pays their scan too;
   if the ruling stands, 0549 should scope the trigger to the six full-fidelity sources (six scoped
   runs ≈ 13.9 s incl. six 0.6 s process starts, vs 20.6 s for `all`). Deciding that is the
   operator's, not this measurement's.

## Design consequence (R5)

**Import: background-only, single-flight, with a coalescing window of 10 minutes (floor 5).**

- Per-operation firing is ruled out by R1 (≥14 s per firing in every shape; scan-bound).
- A 10-minute window bounds import duty to ≈ 3.4 % of wall clock (21 s per 600 s) during continuous
  activity, keeps worst-case staleness ≤ 10 min — far fresher than today's nightly `history daily` —
  and a single-flight guard (no concurrent import while one runs) caps queue depth at one: a burst
  of operations collapses into one scan. A 5-minute window doubles the duty to ≈ 7 % for ≤ 5 min
  staleness; below that the scans start back-to-backing (21 s run vs < 5 min window is fine, but the
  marginal freshness gain buys nothing the artifact consumers need).
- First firing after idle pays ≤ ~25 s (72 h idle, measured); after DB loss, ≤ ~6 min once — the
  window must not retry-queue additional runs while the recovery run is in flight (single-flight
  covers this).

**Analyze: decoupled — run chained after each *completed* import (or at a ≥ 30 min cadence if
chaining is awkward).** At 8.5 s it is the cheaper half, but it reads the full 1.5 M-record corpus
and nothing in the operation path reads the DB directly (consumers read the analyze artifact), so
its cadence should follow artifact-freshness needs, not import freshness. Chaining after import
completion keeps staleness == import staleness at zero extra scheduling.

**Scope: recommend the trigger import only the six full-fidelity sources** (finding 4) unless the
operator re-rules on gemini/opencode; the figures above support either a six-process loop (13.9 s)
or a single-process fan-out (20.6 s, simpler, pays two extra sources).
