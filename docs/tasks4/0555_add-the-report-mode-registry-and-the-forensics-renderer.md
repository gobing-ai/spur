---
template: feature-impl
schema_version: 1
name: "Add the report mode registry and the forensics renderer"
description: ""
status: done
type: task
profile: standard
feature_id: E5
parent_wbs: null
priority: P2
tags: []
dependencies: ["0554"]
ac_numbering: task-local
created_at: "2026-08-14T01:01:43.605Z"
updated_at: "2026-08-14T17:45:13.446Z"
---

## 0555. Add the report mode registry and the forensics renderer

### Background
`spur history report` renders one fixed shape today (`renderReport`), described as a "spend +
forensic report". omp's step 10 needs a different assembly, and E2 settled how to get one: **built-in
named renderers selected by `report --mode`**, not file templates, not a new `spur history forensics`
verb (operator ruling 2026-08-09; E2 § Out of scope).

Ticket 0491 validated a forensics renderer against a synthetic artifact mirroring the omp sample and
found **8 of 16 sections derivable** from the artifact, 2 partial, 6 model-authored (the skill's job,
task 0556). It also deferred the TTFT/generation split — the artifact carries no intra-call latency
fields.

**One amendment supersedes E2 here.** E2 was charted while the report plane was "spend + forensic",
and left cost-model currency as a deferred concern: `MODEL_PRICING` falls back to
`UNKNOWN_MODEL_PRICING` at $3/$15 per 1M (`packages/domain/src/analytics/models.ts:31`), unmeasured.
The 2026-08-13 operator ruling removes rather than measures it — per-model pricing is too volatile to
hold correctly. omp's step 7 ("token cost + cache efficiency") is delivered as tokens and a cache-hit
ratio, both provider-reported facts needing no pricing table.
### Requirements
- [x] **R1.** Add a report mode registry: `report --mode <name>` resolves to a built-in TS renderer
      over the artifact. The registry subsumes today's `renderReport` and `renderMarkdown` rather than
      sitting beside them. No template engine, no variable-binding contract, no new config surface
      (operator ruling 2026-08-09). Measurable: existing report output is reproduced through the
      registry, and an unknown mode fails naming the registered modes.
- [x] **R2.** Implement the forensics renderer covering the 8 sections 0491 identified as derivable
      from the artifact's derived block (task 0554). Sections that are partial or model-authored are
      not faked here — they belong to the skill (task 0556). Measurable: rendering 0491's synthetic
      artifact reproduces the 8 sections; the other 8 are absent rather than stubbed.
- [x] **R3.** Report tokens and cache efficiency, and **no dollar figure**. Cache efficiency is a
      ratio over `cache_read` / `cache_write` / input tokens — provider-reported, no pricing needed.
      The existing `renderReport` spend output and `MODEL_PRICING` are left untouched; this task adds
      no new consumer of them. Measurable: the forensics renderer's output contains no currency
      value, asserted by test, and `MODEL_PRICING` gains no new call site.
- [x] **R4.** Wire `daily --mode` so the scheduled loop can select a renderer. `daily` otherwise stays
      exactly as it is — it owns per-source failure isolation, checkpoint self-heal, and 90-day
      report pruning, and re-creating that composition was explicitly ruled out (operator ruling
      2026-08-09). Measurable: `daily --mode forensics` produces the forensics artifact; `daily` with
      no mode behaves as before.
- [x] **R5.** A mode renders honestly over an incomplete artifact: a section whose derived inputs are
      missing states that rather than rendering zeros or omitting silently. Measurable: rendering an
      artifact with no derived block produces an explicit "not available" for those sections.
### Acceptance Criteria
Covers feature E4 scenarios:

- **R4 — Report renders by selected mode**
- **R5 — The forensics mode reproduces the derivable sections**

```gherkin
Scenario: R4 — Report renders by selected mode
  Given a generated artifact
  When report is invoked with a mode
  Then the named built-in renderer produces that mode's output
  And an unknown mode fails naming the registered modes

Scenario: R5 — The forensics mode reproduces the derivable sections
  Given an artifact with derived variables
  When report --mode forensics runs
  Then it renders the sections 0491 identified as derivable
  And it reports tokens and cache efficiency without any dollar figure
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

**Closed during refine (2026-08-13).**

- **Does the existing report output change?** No. `--mode default` preserves today's output; the
  registry folds `renderReport` in rather than replacing it. `[path]` and `--json` are untouched.
- **Does this task remove the dollar figures already in the report?** No. The 2026-08-13
  tokens-not-prices ruling governs **new** surfaces; the existing spend output and `MODEL_PRICING`
  stay. This task simply adds no new consumer of them.
- **Where does `--mode` go?** Both `report` and `daily`. `daily` gains a pass-through only
  (operator ruling 2026-08-09: `daily` stays, gains `--mode` wiring, nothing else).

**Deferred with owner.**

- **Removing the existing spend output and retiring `MODEL_PRICING`** — owner: operator. Deleting
  shipped output is a deliberate decision, not a side effect of adding a renderer. The `$3/$15`
  `UNKNOWN_MODEL_PRICING` fallback is unmeasured and is the reason the existing figures are already
  untrustworthy; raise it when this batch lands.
- **A third mode (e.g. `spend` as an explicit name)** — owner: operator. Only two modes are needed
  now; naming a third before a caller exists is speculative.
### Design
**Registry subsumes, not sits beside (R1).** If `renderReport` survives as a parallel path, there are
two rendering entry points and the next mode has to pick one. Fold the existing renderer into the
registry as a named mode.

**Built-in TS renderers, decided (R1).** File templates were considered and deferred until a second
template author exists (operator ruling 2026-08-09). Do not introduce a template engine, a
variable-binding contract, or a config surface for modes.

**Render only what is derivable (R2).** 0491's split is 8 derivable / 2 partial / 6 model-authored.
The 6 are the skill's contribution (task 0556). A renderer that emits plausible-looking placeholders
for them produces a report that reads complete and is not — the same failure class as reporting
unmeasured data as zero.

**Tokens, not prices (R3).** This supersedes E2's deferred cost-model-currency concern. Cache
efficiency is a ratio and needs no pricing. Leave `MODEL_PRICING` and the existing spend output
alone — deleting shipped output is a separate operator decision — but add no new consumer of them.

**`daily` gains wiring, nothing else (R4).** It already owns per-source failure isolation, checkpoint
self-heal, and report pruning. A task here that starts restructuring `daily` has misread its scope.

**Missing inputs are stated (R5).** A forensics report over an artifact with no derived block should
say the sections are unavailable, not render an empty table. The reader cannot otherwise distinguish
"nothing to report" from "the pipeline did not run".

**Not in scope:** the TTFT/generation split (deferred by 0491 — no intra-call latency fields exist),
a `spur history forensics` verb (E2 § Out of scope), and file-authored templates.


Verified against the current tree 2026-08-13.

| Frozen | Value | Location |
| --- | --- | --- |
| Existing renderer (folded in) | `renderReport(artifact: HistoryArtifact): string` | `packages/domain/src/analytics/render-report.ts:165` |
| Existing renderer (folded in) | `renderMarkdown(artifact: HistoryArtifact): string` | `render-report.ts:193` (calls `renderReport`) |
| Command entry | `runHistoryReport({ path, cwd, now })` → `{ report, artifactPath, resolution, artifact }` | `apps/cli/src/commands/history.ts:175` |
| Staleness helper (unchanged) | `stalenessBanner(generatedAt, now)` | `history.ts:191` |
| New CLI flag | `--mode <name>` on `spur history report` **and** on `spur history daily` | `history.ts:167` / `:203` |
| Mode names | `default` · `forensics` | `default` preserves today's output byte-for-byte |
| Registry | `REPORT_MODES: Readonly<Record<string, ReportRenderer>>` | new, in `packages/domain/src/analytics/` |
| Renderer type | `ReportRenderer = (artifact: HistoryArtifact) => string` | matches the existing signature |

**Existing surface that must not change:** `report`'s `[path]` argument and `--json` flag; the
pointer-vs-explicit-path `resolution` semantics and the staleness banner (R7 of the original task);
`renderReport`'s output under `--mode default`.


- Do **not** leave `renderReport` reachable as a second entry point beside the registry (R1) — one
  rendering path, or the next mode has to pick.
- Do **not** add a `spur history forensics` verb. Feature E2 § Out of scope routes forensics through
  `--mode`, keeping the noun's verb count flat.
- Do **not** introduce a template engine, variable-binding contract, or config surface for modes —
  built-in TS renderers only (operator ruling 2026-08-09).
- Do **not** call `getModelPricing` / `MODEL_PRICING` / `UNKNOWN_MODEL_PRICING`
  (`packages/domain/src/analytics/models.ts:31`) from any new renderer (R3). Leave the existing
  spend output alone; add no new consumer.
- Do **not** stub the 2 partial or 6 model-authored sections. They belong to task 0556.
- Do **not** restructure `daily` (R4) — it gains a `--mode` pass-through and nothing else.


**Assumes from 0554:** `artifact.derived` populated with `phases` / `phaseSupport`,
`timeDecomposition` (including `unattributedMs`), and `bottlenecks`. Renderers read those fields;
they do not compute metrics. A missing field renders as "not available" (R5), never as zero.

**Leaves for dependents:** task **0556** consumes `report --mode forensics` output as the CLI-derived
half of its report and supplies the model-authored half. The 8 derivable sections are this task's
contract to 0556 — their names and order are the interface.

#### Frozen names

Verified against the current tree 2026-08-13.

| Frozen | Value | Location |
| --- | --- | --- |
| Existing renderer (folded in) | `renderReport(artifact: HistoryArtifact): string` | `packages/domain/src/analytics/render-report.ts:165` |
| Existing renderer (folded in) | `renderMarkdown(artifact: HistoryArtifact): string` | `render-report.ts:193` (calls `renderReport`) |
| Command entry | `runHistoryReport({ path, cwd, now })` → `{ report, artifactPath, resolution, artifact }` | `apps/cli/src/commands/history.ts:175` |
| Staleness helper (unchanged) | `stalenessBanner(generatedAt, now)` | `history.ts:191` |
| New CLI flag | `--mode <name>` on `spur history report` **and** on `spur history daily` | `history.ts:167` / `:203` |
| Mode names | `default` · `forensics` | `default` preserves today's output byte-for-byte |
| Registry | `REPORT_MODES: Readonly<Record<string, ReportRenderer>>` | new, in `packages/domain/src/analytics/` |
| Renderer type | `ReportRenderer = (artifact: HistoryArtifact) => string` | matches the existing signature |

**Existing surface that must not change:** `report`'s `[path]` argument and `--json` flag; the
pointer-vs-explicit-path `resolution` semantics and the staleness banner (R7 of the original task);
`renderReport`'s output under `--mode default`.

#### Anti-patterns — what not to implement

- Do **not** leave `renderReport` reachable as a second entry point beside the registry (R1) — one
  rendering path, or the next mode has to pick.
- Do **not** add a `spur history forensics` verb. Feature E2 § Out of scope routes forensics through
  `--mode`, keeping the noun's verb count flat.
- Do **not** introduce a template engine, variable-binding contract, or config surface for modes —
  built-in TS renderers only (operator ruling 2026-08-09).
- Do **not** call `getModelPricing` / `MODEL_PRICING` / `UNKNOWN_MODEL_PRICING`
  (`packages/domain/src/analytics/models.ts:31`) from any new renderer (R3). Leave the existing
  spend output alone; add no new consumer.
- Do **not** stub the 2 partial or 6 model-authored sections. They belong to task 0556.
- Do **not** restructure `daily` (R4) — it gains a `--mode` pass-through and nothing else.

#### Cross-task contract

**Assumes from 0554:** `artifact.derived` populated with `phases` / `phaseSupport`,
`timeDecomposition` (including `unattributedMs`), and `bottlenecks`. Renderers read those fields;
they do not compute metrics. A missing field renders as "not available" (R5), never as zero.

**Leaves for dependents:** task **0556** consumes `report --mode forensics` output as the CLI-derived
half of its report and supplies the model-authored half. The 8 derivable sections are this task's
contract to 0556 — their names and order are the interface.
### Plan
- [x] Add the mode registry, fold `renderReport` + `renderMarkdown` in as named modes, and fail an unknown mode naming the registered set (R1)
- [x] Implement the forensics renderer for 0491's 8 derivable sections (R2)
- [x] Leave partial and model-authored sections to the skill rather than stubbing them (R2)
- [x] Report tokens and a cache-hit ratio; assert no currency value and no new `MODEL_PRICING` call site (R3)
- [x] Wire `daily --mode`, changing nothing else about `daily` (R4)
- [x] Render an explicit "not available" for sections whose derived inputs are missing (R5)
- [x] Add tests including 0491's synthetic artifact and an artifact with no derived block (R2, R5)
- [x] Update `docs/04_DESIGN.md` in the same commit (T3), then run `bun run autofix && bun run spur-check`
### Solution
Task 0555 — report mode registry + forensics renderer. All changes same-commit with this task record.

| File | What / why |
| --- | --- |
| `packages/domain/src/analytics/report-modes.ts` (new) | R1 registry: `REPORT_MODES` (report-modes.ts:26) `Record<string, ReportRenderer>` with `default → renderReport` (byte-identical legacy) and `forensics → renderForensics`; `resolveReportMode` (report-modes.ts:32) fails unknown names with `UnknownReportModeError` (report-modes.ts:13) naming the registered set. `renderMarkdown` (report-modes.ts:46) moved here, mode-aware fenced sidecar. No template engine, no config surface (operator ruling 2026-08-09). |
| `packages/domain/src/analytics/render-forensics.ts` (new) | R2–R5 renderer: `renderForensics` (render-forensics.ts:20) renders the 8 artifact-derivable sections (Session Data Summary + Tool Breakdown + Token Profile, Time Decomposition, Per-Phase Breakdown, Per-Tool Execution Time, Bottleneck Ranking, Raw Data). Tokens-only, no currency (R3); cache efficiency = `cacheRead / inputTokens`, `n/a` when `recordsWithUsage === 0`; `fmtWall` (render-forensics.ts:251) ms→human wall durations. Missing derived → honest `not available`; `phaseSupport: 'unsupported'` → phase placeholder (R5). Never-fabricate: all-NULL durations render `n/a` (R5). The 8 model-authored sections are absent, not stubbed (0556's job). |
| `packages/domain/src/analytics/render-report.ts` | `renderMarkdown` removed (moved to report-modes.ts); `fmtDur`/`fmtBytes` remain exported for reuse by the forensics renderer; `fmtBytes` TSDoc added (render-report.ts:63). |
| `packages/domain/src/analytics/index.ts` | Re-export surface: `renderForensics` (index.ts:61) + report-modes symbols so app/CLI import from `@gobing-ai/spur-domain` only. |
| `packages/app/src/services/history-service.ts` | `runHistoryReport` (history-service.ts:822) resolves via `resolveReportMode(opts.mode ?? 'default')` (history-service.ts:845) — registry subsumes the former direct call path. `daily` validates mode at entry (history-service.ts:356) so unknown names fail before the 10-min import fan-out, and writes the mode-rendered `.md` sidecar (history-service.ts:383) via `resolveArtifactPaths(artifact, {cwd})` + `.json→.md`. Result carries `reportPath` (0555 R4). |
| `apps/cli/src/commands/history.ts` | `report --mode <name>` (history.ts:174) registry-resolved; `analyze --mode <name>` (history.ts:219) + `daily --mode` render sidecar in the given mode. |
| `docs/04_DESIGN.md` §`spur history report` (:608–627) | T3 surface doc: registry, `UnknownReportModeError` fail-fast, forensics section list, tokens-only ruling. |
| `packages/domain/tests/analytics/derived.test.ts` | Setup now applies `applyCliMigrations` after `HISTORY_IMPORT_SCHEMA_SQL` — importer 0.4.32 schema lacks `args_raw`; migration 0012 adds it. Keeps the test on released importer versions. |

Out of scope (unchanged, by design): model-authored forensics sections (task 0556); TTFT/generation split (0491 deferral); template engines.
### Testing
- Domain analytics (report modes, renderers, derived, costs): `bun test packages/domain/tests/analytics` — 137 pass / 0 fail / 409 expect() calls.
  - `render-forensics.ts` coverage: **100.00% lines / 100.00% functions** (bunfig threshold 90/90).
  - `report-modes.ts`, `render-report.ts`: ≥90/90.
- App + CLI history surface: `bun test packages/app/tests/services/history-service.test.ts apps/cli/tests/commands/history.test.ts` — 49 pass / 0 fail / 185 expect() calls (mode validation, sidecar paths, unknown-mode errors, JSON envelope).
- Full monorepo: `bun run spur-check` — biome + all-workspace typecheck + **5090 pass / 0 fail** across 284 files, per-file 90/90 coverage thresholds met, tsdoc 2/2, transition-shim-check PASS.
- `bun run test-cf` exit 0 (Cloudflare Workers vitest).
- `bun run build` exit 0 (CLI bundle + server + web).
- `bun run corpus-check` OK — 2 baselined errors, 0 new/stale.

N/A: manual UI verification (no UI surface in this task).
### Review
L3 review (inline, model-authored). No P1/P2 findings.

| ID | Severity | Finding | Disposition |
| --- | --- | --- | --- |
| R-1 | P3 | `render-forensics.ts` `fmtWall` reimplements duration formatting near `fmtDur` (render-report.ts) — different output granularity (wall-clock ranges vs per-call durations), so they are not the same function; merging would special-case one of the two callers. | Accepted as-is; noted for 0556 revisit if a third formatter appears. |
| R-2 | P3 | `report-modes.ts` registry is a plain record — no registration API for plugin-supplied modes. | By design (operator ruling 2026-08-09: built-in TS renderers only). |
| R-3 | P4 | `daily` validates mode before import fan-out but `analyze --mode` validates via the same `resolveReportMode` at write time — two call sites could drift. | Both call `resolveReportMode` from the same module; drift would require editing the shared function. No action. |
| R-4 | P4 | `derived.test.ts` now applies the full `CLI_MIGRATIONS` chain (14 migrations) per test setup instead of only the importer schema — slightly slower fixture. | ~1ms per test measured; correctness (args_raw presence) beats fixture minimalism. No action. |
### References
- **Specification:** feature E2 § *Decisions so far* — "Report modes are built-in named renderers, not
  file templates" and "`spur history daily` stays and gains `--mode`" (operator, 2026-08-09);
  0491 (8 derivable / 2 partial / 6 model-authored; forensics renderer validated against a synthetic
  artifact)
- **Pricing amendment (R3):** feature J6 § *Tokens, not prices* (operator ruling 2026-08-13);
  `packages/domain/src/analytics/models.ts:31` (`UNKNOWN_MODEL_PRICING` $3/$15 per 1M — leave untouched)
- **Existing surface:** `apps/cli/src/commands/history.ts:169` (`report` description — "spend +
  forensic"), `:203-217` (`daily`); `renderReport` / `renderMarkdown`
- **Source material:** `.spur/run/sp-dev-findissue-20260806.md` (the 423-line output to reproduce);
  `docs/session-forensics-report-generation.md` (methodology; **not** transliterated)
- **Upstream dependency:** task 0554 (the derived block this renders)
- **Downstream consumer:** task 0556 (find-issue consumes this report)
- **Surface docs (T3, same commit):** `docs/04_DESIGN.md`
### History
- 2026-08-14T17:43:14.165Z todo → wip (system)
- 2026-08-14T17:44:46.064Z wip → testing (system)
- 2026-08-14T17:45:13.446Z testing → done (system)
