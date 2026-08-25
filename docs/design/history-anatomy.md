# History anatomy: daily cache, ad-hoc diagnosis, and bounded migration

**Area:** sp plugin > `sp:history-anatomy` skill, `/sp:dev-find-issue` command, `history-anatomy.yaml` workflow, `docs/report` daily cache, and the HA-S1 correction to the history analyze artifact + forensics renderer.
**Status:** built (I8 HA-S1; 0657–0661 — ADR-079 cache, ADR-080 bounded rankings).
**Authority:** decisions in `00` (ADR-079 cache, ADR-080 bounded rankings); command/flag shapes in `04`; this satellite owns the report contract, cache contract, workflow shape, and migration gate. The history data plane itself remains [`history-data-processing.md`](history-data-processing.md) and [`sqlite-forensics-token-time-per-step.md`](sqlite-forensics-token-time-per-step.md); shared flag semantics remain `plugins/sp/skills/spur-dev/references/flag-glossary.md`.

Baseline artifacts: `.spur/run/7fa52fa5-…-idea-eval-report.md` (idea evaluation) and
`docs/plans/2026-08-24-history-anatomy-brainstorm.md` (approach + trade-offs).

## Invariants

1. **Report-only.** The skill and workflow never mutate the task, feature, rule, or workflow corpus,
   never edit source or docs, and never import history. Every remediation ends at a proposal.
2. **The deterministic half always reruns** (ADR-079). Only model-authored judgment is cacheable.
3. **A bounded ranking is never a population** (ADR-080). Unknown populations render `not available`.
4. **Evidence over assertion.** Observation and inference are separate fields; causality needs two
   independent signals; unsupported dimensions read `not available`, never zero, never omitted.
5. **No new `spur history` verb or flag.** HA-S1 is additive work inside the shipped `analyze`
   artifact and `report --mode forensics` renderer. A new verb or flag is a separate consent decision.
6. **Import stays where it is.** `bun run load-history` and the History module's **Import & Analyze**
   action remain the only import owners, unchanged.

## Ownership

| Component | Owns | Does not own |
| --- | --- | --- |
| `/sp:dev-find-issue` | Discoverability, argument hint, `reviewer` role, one skill invocation | Any analysis logic |
| `sp:history-anatomy` | Mode validation, evidence policy, finding taxonomy, comparison semantics, report contract, `enrich` and `validate` rubrics | Cache branching, retry policy, publication |
| `history-anatomy.yaml` | Cache decision, stage ordering, executor dispatch, one bounded correction loop, terminal status, atomic publication | Any finding, severity, or remediation judgment |
| Cache helper (`.mjs` twin per ADR-065) | Normalized semantic digest, metadata comparison, structural checks, atomic replace | Anything interpretive |
| `spur history analyze` | DB aggregation → versioned JSON artifact | Rendering |
| `spur history report --mode forensics <path>` | Deterministic rendering of one explicit artifact | DB access |
| `bun run load-history` / History UI | Import freshness | Reporting |

## Operator surface

```text
/sp:dev-find-issue [--mode daily] [--date YYYY-MM-DD] [--recompute] [--agent <inline|auto|name>]
/sp:dev-find-issue "<focus>" --mode ad-hoc --since <RFC3339> --until <RFC3339>
                   [--agent <inline|auto|name>] [--output <path>]
```

`--mode <daily|ad-hoc>` replaces `--full`. The replaced flag conflated *report intent* with
*verbosity*; mode names the intent, and because intent is part of the cache identity tuple, `--full`
could not have keyed the cache at all.

| Argument | Daily | Ad-hoc |
| --- | --- | --- |
| focus text | rejected (daily is unfocused by definition) | **required**, non-empty |
| `--date <YYYY-MM-DD>` | optional; defaults to today | rejected |
| `--since` / `--until` | rejected | **both required**, ordered, inclusive |
| `--recompute` | optional | rejected (ad-hoc is never cached) |
| `--output <path>` | rejected (path is the cache path) | optional; defaults to the run directory |
| `--agent` | optional | optional |

Every conflict fails loud, naming the offending argument. Dropped from the previous 17-option
surface: `--full`, `--save`, `--source`, `--sessions`, `--feature`, `--template`, `--priority`,
`--severity`, `--category`, `--top`, `--min-cost`, `--strict-topic`, `--create-task`, `--json`. The
artifact still reports every selected source and its coverage; narrowing that cannot be expressed as
focus plus a time window is not re-added without a demonstrated case.

`--date` becomes a canonical shared entry in the flag glossary because it is also meaningful to
`dev-daily`. `--agent`, `--since`, `--until`, and `--output` are referenced mechanically.

## Cache contract

Path: `docs/report/YYYY-MM-DD-history-anatomy.md`. Daily only — ad-hoc reports are never cached.

**Identity tuple:** `(report contract version, mode=daily, calendar date, timezone, normalized
bounds, source scope)`.

**Frontmatter provenance** every published report carries:

- `report_contract_version`, `mode`, `date`, `timezone`, normalized inclusive `bounds`
- `window_state: provisional | closed`, `generated_at`, `validated_at`
- per-source coverage, status, and `last_imported_at`
- current and baseline artifact paths plus their normalized semantic SHA-256 digests
- Spur/schema version, skill digest, workflow digest, executor and model identity, run id
- `cache_disposition: hit | miss | forced-recompute`

**The semantic digest** is SHA-256 over the artifact JSON normalized to exclude only volatile
generation fields (`generatedAt`, absolute paths, the artifact's own digest field). It deliberately
does not include corpus state; a corpus-version field is added only if this proves inadequate, under
separate consent.

**Invalidation matrix** — a cache is reusable only when every row passes:

| Signal | Reused when | Invalidated by |
| --- | --- | --- |
| Identity tuple | all fields equal | any field differs (date, timezone, bounds, scope, contract version) |
| Semantic artifact digest | freshly derived digest equals recorded digest | any change to imported data in the window, including a late import for a closed day |
| Logic digests | skill + workflow + contract digests all equal | any change to report logic, even with identical data |
| Provenance | present and parsable | absent, truncated, or unparsable frontmatter → miss, never a crash |
| Coverage | equal or broader | strictly narrower source coverage than the cached report claimed |
| Window state | equal | a `provisional` cache read after the local day has closed |
| Operator override | — | `--recompute` |

**Current-day semantics** are strict. Today's window is local midnight through invocation time and
is always `provisional`. Every invocation still runs the deterministic probe; an unchanged digest may
reuse enrichment, but `validated_at` and the visible *imported snapshot as of* banner refresh, and
the report never claims a source was imported after that source's recorded timestamp. The first
invocation after the local day closes analyzes the complete DST-aware calendar interval, flips
`window_state` to `closed`, and invalidates the provisional cache.

**Publication is atomic and never destructive.** A candidate reaches `docs/report/` only after
passing both the deterministic structure gate and independent evidence validation. A failed candidate
leaves any previously published report byte-identical.

## Workflow shape

```text
resolve scope
  → deterministic cache probe            (helper: digest + metadata comparison)
      → valid daily hit: refresh validation provenance → publish/return
      → miss or --recompute:
          analyze selected window + previous comparable window   (explicit paths)
          → render both artifacts        (report --mode forensics <explicit-path>)
          → model enrichment             (sp:history-anatomy enrich)
          → deterministic structure gate (helper)
          → independent evidence validation (sp:history-anatomy validate)
              → PASS: atomic publish
              → FAIL: one correction pass → PASS publish | terminal failure
```

The workflow calls the same skill in explicit `enrich` and `validate` operations; those operations
never launch another workflow, which keeps the rubric single-sourced and prevents recursion. No stage
reads the mutable `latest.json` pointer — every analyze writes, and every render names, an explicit
run-scoped path.

Correction is capped at exactly one pass. A second validation failure terminates the run.

## Report contract

Every published report, in both modes, contains these eleven sections:

1. **Scope and provenance** — selector, normalized bounds, timezone, window state, cache
   disposition, source coverage, and artifact digests.
2. **Executive summary** — observations stated separately from interpretations.
3. **Baseline comparison** — with an explicit comparability verdict.
4. **Findings** — the table below.
5. **Recurrence ledger** — `new` · `recurring` · `regressed` · `improved` · `resolved` ·
   `not-comparable`, matched on stable key.
6. **Telemetry gaps** — every dimension that read `not available`, and why.
7. **Remediation options** — owner surface, expected impact, verification method, reversibility.
8. **Performance analysis** — wall time, LLM/tool/unattributed time split, tool errors,
   tokens and cache waste, per-step outliers, repeated work.
9. **Workflow and process improvements** — gated (below).
10. **Positive patterns** — same evidence standard as problems.
11. **Evidence ledger** — every claim to its anchor.

Daily mode additionally compares the immediately preceding local calendar day. Ad-hoc mode opens with
the operator's question and builds a bounded causal narrative, comparing the immediately preceding
equal-duration window.

### Finding fields

| Field | Rule |
| --- | --- |
| `key` | `<category>:<owner-surface>:<signal>` — stable across runs; prose titles may change freely |
| `category` | `reliability` · `repetition` · `workflow` · `performance` · `coverage` · `telemetry` · `positive` |
| `impact` | what it costs, in the artifact's own units |
| `trend` | from the recurrence ledger |
| `observation` | directly present in an artifact field or a cited repository authority |
| `inference` | names the observations supporting it |
| `confidence` | `high` · `medium` · `low`, **per finding** — never one blanket report score |
| `contradictions` | shown beside the finding, lowering confidence; never silently reconciled |
| `evidence` | ≥1 anchor: artifact field + selector, or repo-relative `file:line` |

### Evidence rules

- **Causality needs two independent signals.** One signal is a hypothesis, and must state what would
  confirm it.
- **A process or workflow change** is promoted only on recurrence across two independent sessions, or
  one explicit high-impact contract violation cited at `file:line`. A single-session low-impact
  observation stays a finding.
- **Unsupported reads `not available`** — never zero, never omitted, and always mirrored into §6.
- **Focus biases ranking, not collection.** Material off-topic findings in the window stay visible.
- **Not comparable is a verdict, not a gap.** No trend, delta, or percentage is stated against a
  baseline marked not comparable.

## HA-S1 — artifact and renderer correction

Operator-approved 2026-08-24 under the ADR-051 surface-consent gate. Additive only; no new verb, no
new flag.

**The defect.** `render-forensics.ts:54` prints `artifact.bySession.length` as the total `Sessions`
count, and `:381` does the same for sessions, tools, loops, and warnings. `analyze --top` (default
20) bounds `bySession` and `byTool` at `history-service.ts:439-440`. A day with 35 sessions therefore
renders `Sessions | 20` — a false coverage claim, and one a daily report would inherit.

**The change.**

- `analyze` records the true selection population for each bounded leaderboard, plus the applied
  depth. Bounded arrays keep their existing shape and cap.
- The forensics renderer reports the true population and labels each leaderboard `top N of M`.
- The existing coverage section gains per-source `lastImportedAt`, parse-error and validation-error
  counts, a sample-truncation indicator, and warning detail — all of which the artifact already
  carries and the template silently drops.
- **Backward compatibility:** an artifact written before these fields existed still renders; absent
  population and depth read `not available`, and no figure is reconstructed from an array length.

## Bounded coexistence and retirement

Launch ships `sp:history-anatomy` and repoints `/sp:dev-find-issue`. `sp:issue-finding` stays
packaged and directly invocable, documented as the legacy path. No logic is copied from it into the
new skill.

**Parity fixtures** the new contract must cover before retirement is considered: typed history
analysis; daily and focused range selection; repeated-work and error reporting; evidence and
confidence; remediation proposals; performance analysis; process observations; positive patterns.
Raw JSONL parsing and task creation are intentional exclusions, not parity gaps.

**Adoption evidence** comes from successful `history-anatomy.yaml` run records across both modes and
the available source families. No bespoke telemetry is added to count adoption.

**Gate.** Review after one minor release or 30 days, whichever is later. Retirement requires parity
PASS, demonstrated use of both modes, no open high-impact regression, and explicit operator approval.
A failed gate records the missing evidence and one dated extension — coexistence does not silently
become permanent. Retirement is a separate change.

## Removed surfaces

`/sp:dev-history-load` is removed along with its plugin helper script, `.mjs` twin, test,
build-conversion entry, and `config/plugin-scripts.json` declaration — its two supported import
owners (`bun run load-history`, History UI **Import & Analyze**) remain. `package.json`'s
`load-history` script is preserved exactly.

`spur history analyze`, `report`, and `daily` are all preserved. The workflow composes `analyze` and
explicit-path `report`; it does not repurpose the import-owning `history daily` verb.
