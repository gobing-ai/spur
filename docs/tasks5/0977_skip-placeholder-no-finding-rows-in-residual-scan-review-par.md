---
schema_version: 1
name: Skip placeholder no-finding rows in residual-scan review parsing
status: wip
template: standard
created_at: 2026-09-26T22:45:20.140Z
updated_at: "2026-09-26T23:03:27.434Z"
feature_id: F961
priority: P1
tags:
  - residual-scan
  - bugfix
estimate_hours: 1

---

## 0977. Skip placeholder no-finding rows in residual-scan review parsing

### Background

`residual-scan` treats every P1–P3 `## Review` row as a blocking residual unless its finding cell exactly matches `/^(none|—)$/i`. Clean-review rows such as "None found (3 independent review cycles)" or "No findings." therefore counted as blocking, and `fold` downgraded a clean verify to PARTIAL (observed on 0964). One task delivers all three F961 scenarios; they share one regex and one test file.

### Requirements

- [ ] R1. `parseReviewFindings` drops placeholder no-finding cells: `None`, `None found`, `No finding(s)`, `No issue(s)` with optional ` found`, optional trailing `(…)` note and optional period, case-insensitive, plus `—`.
- [ ] R2. Finding text that merely starts with "None" (e.g. "None of the callers validate input") is still returned as a finding, unchanged.
- [ ] R3. A regression test in `plugins/sp/tests/residual-scan.test.ts` pins R1 and R2, and `plugins/sp/scripts/residual-scan.mjs` is regenerated via `superskill script convert sp residual-scan.ts`.

### Acceptance Criteria

- [ ] AC1 — R1 — Placeholder no-finding rows are not residual findings (req: R1)
- [ ] AC2 — R2 — Real findings that start with None still count (req: R2)
- [ ] AC3 — R3 — Shipped script matches the tested source (req: R3)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-26T22:49:08.865Z

- **Why fix the regex instead of the callers?** `NONE_FINDING` is the single shared placeholder test. One edit covers scan, fold and settle. (closed)
- **Why not also match `N/A` or `Nothing to report`?** No observed occurrence, and unknown phrasings must fail safe toward blocking. Deferred until a real review emits one. (closed)
- **Is a note allowed after "None found"?** Yes, but only a parenthesized note that ends the cell. Any trailing prose makes the row a finding. (closed)

### Design

- **Chosen:** widen the single shared `NONE_FINDING` constant in `plugins/sp/scripts/residual-scan.ts`. Its only consumer is the row filter in `parseReviewFindings` (`!NONE_FINDING.test(finding)`), so `scan`, `fold` and `settle` all pick up the change with no other edit. Exact literal (frozen, do not reinvent):

  ```ts
  // Placeholder "no finding" cells, optionally with a trailing "(…)" note; "None of X…" is a real finding.
  const NONE_FINDING = /^(none( found)?|no (findings?|issues?)( found)?|—)\s*(\(.*\))?\.?$/i;
  ```

- **Behavior contract** (the finding cell is trimmed before the test):

  | Cell text | Result |
  | --- | --- |
  | `None`, `none.`, `None found`, `None found (3 independent review cycles)` | placeholder (dropped) |
  | `No findings.`, `No finding`, `No issues found`, `No issue`, `—` | placeholder (dropped) |
  | `None of the callers validate input` | finding (kept, text unchanged) |
  | `None found (x) but callers skip validation` | finding: the note must close the cell |
  | `No findings; see P2`, `Nothing to report`, `N/A` | finding: unknown phrasing fails safe toward blocking |

- **Invariants:**
  - The regex is anchored `^…$`. Nothing after the optional `(…)` note and optional `.` is allowed.
  - No other filter in `parseReviewFindings` changes: priority P1–P4, the empty-cell skip, and the RESOLVED/DEFERRED disposition handling stay as they are.
  - The shipped `plugins/sp/scripts/residual-scan.mjs` is generated, never hand-edited. It must carry the same literal (esbuild emits `—` as `—`).
- **Rejected:**
  - A structured no-findings marker in the Review schema. It changes the review coordinator contract and every existing task.
  - Also matching `N/A` / `Nothing …`. That is speculative, and widening the matcher risks hiding a real residual.
- **Pre-staged state:** the working tree already carries this exact literal at `plugins/sp/scripts/residual-scan.ts:67-68` and `plugins/sp/scripts/residual-scan.mjs:20`, plus a 3-row test at `plugins/sp/tests/residual-scan.test.ts:71`. All of it is uncommitted, drafted during the 0964 re-verify. Implement adopts it after checking it against this contract. It does not rewrite it.

### Plan

1. Confirm `NONE_FINDING` in `plugins/sp/scripts/residual-scan.ts` equals the frozen literal in Design. If it does not, set it to that literal.
2. Extend the test `skips placeholder no-finding rows but keeps findings that start with "None"` in `plugins/sp/tests/residual-scan.test.ts` to cover the whole Design behavior table in one Review table. Assert exactly the kept rows: `None of the callers validate input`, `None found (x) but callers skip validation`, `No findings; see P2`. Keep the existing `None` behavior pinned as well.
3. Regenerate the shipped twin with `superskill script convert sp residual-scan.ts`. Confirm with `rg -n 'NONE_FINDING =' plugins/sp/scripts/residual-scan.mjs` that it carries the same pattern.
4. Verify:
   - `(cd plugins/sp && bun test tests/residual-scan.test.ts)`, all pass
   - `bunx biome check plugins/sp/scripts/residual-scan.ts plugins/sp/tests/residual-scan.test.ts`
   - `bun plugins/sp/scripts/residual-scan.ts scan 0964` reports blocking=0 for the "None found" rows
5. Scope guard: the diff touches only the three files above. Do not edit `ci.yml` or any 0964 artifact.

### Solution

- `plugins/sp/scripts/residual-scan.ts:68` — confirmed the shared `NONE_FINDING` placeholder matcher already carries the frozen 0977 literal (adds `None`, `no finding(s)`/`no issue(s)` with optional ` found`, optional trailing `(…)` note, optional period; anchored, case-insensitive). Its only consumer is the row filter in `parseReviewFindings`, so `scan`/`fold`/`settle` all pick up the change with no other edit (pre-staged during the 0964 re-verify; adopted verbatim per Design).
- `plugins/sp/tests/residual-scan.test.ts:72-105` — extended `skips placeholder no-finding rows but keeps findings that start with "None"` to the full 0977 Design behavior table (one 14-row Review table): asserts exactly the 5 kept findings (`None of the callers validate input`, `None found (x) but callers skip validation`, `No findings; see P2`, `Nothing to report`, `N/A`) and drops the 9 placeholder cells, including the `None`/`none.` bare forms and `None found (3 independent review cycles)`.
- `plugins/sp/scripts/residual-scan.mjs:20` — regenerated via `superskill script convert sp residual-scan.ts`; carries the same pattern (esbuild emits the em-dash as `\u2014`).

Rationale: single-edit root cause per Q&A — one shared regex covers scan, fold and settle; unknown phrasings (`Nothing to report`, `N/A`) intentionally fail safe toward blocking (closed Q&A decision). Scope guard held: diff touches only the three declared files; no `ci.yml` or 0964 artifact edits. Probes: `bun test tests/residual-scan.test.ts` 21/21 pass; biome clean on both edited sources; `residual-scan.ts scan 0964` reports blocking=0.

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature: F961 (parent F96, residual sweep for task execution)
- Trigger: task 0964, whose `## Review` P1–P3 rows read "None found (3 independent review cycles)" (`docs/tasks5/0964_harden-windows-detached-serve-spawn-against-cmd-exe-var-expa.md:138`)
- Source: `plugins/sp/scripts/residual-scan.ts:68` (`NONE_FINDING`), consumed at `plugins/sp/scripts/residual-scan.ts:151`
- Shipped twin: `plugins/sp/scripts/residual-scan.mjs:20`
- Idea run: `.spur/run/0d3f3caa-a948-4d7f-8735-2a1f91b888bc-idea-handoff.md`

### History

- 2026-09-26T23:03:27.434Z todo → wip (system)

