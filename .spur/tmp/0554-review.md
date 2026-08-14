## Review

**L3 review — P1–P4 findings:**

| # | Severity | File | Finding |
|---|----------|------|---------|
| 1 | P3 | packages/domain/src/analytics/forensic-query.ts:391 | `todoToolCalls` `LIMIT ?` default 5000 — a session set with more todo calls silently truncates phase replay; ceiling acceptable for forensics (0556 report labels data bounds), no pagination warranted until a real corpus exceeds it. |
| 2 | P3 | packages/domain/src/analytics/derived.ts:196 | `extractPhases` matched by todo *name* equality; agents that rewrite the same todo name with changed scope conflate phases. Matches importer allowlist semantics; revisit only if real sessions show name churn. |
| 3 | P4 | packages/domain/src/analytics/derived.ts:344 | `idleMs` attribution assumes llm/tool durations are non-overlapping; concurrent tool batches can double-count against wall-clock span, inflating `unattributedMs` (never fabricating the other way). Correct conservative direction. |
| 4 | P4 | packages/domain/src/analytics/artifact.ts:136 | `derived` is additive-optional; consumers must treat absent `derived` as "not computed", not "zero". Documented in 04_DESIGN.md §analyze. |

No P1/P2 findings. All four accepted as-is with rationale; none block done.
