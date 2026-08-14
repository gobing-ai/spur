## Testing

- **New suite**: `packages/domain/tests/analytics/derived.test.ts` — 11 tests, 11 pass / 0 fail:
  - `parseTodoItems` — Claude `{todos}` shape, codex `{plan:[{step}]}` shape, malformed JSON → `[]`, non-string/empty filtering.
  - `extractPhases` — started/ended from in_progress/completed, endedAt fallback to last todo-call ts, per-session grouping.
  - `computeDerived` via real in-memory SQLite (fresh schema incl. `args_raw`): fully-measured session decomposition sums to span (llm 5000 + tool 1500 + idle 103500 = 110000, unattributed 0); bottleneck order `['idle','llm','tool']` desc with `share = ms/spanMs`; phases from TodoWrite replay; unmeasured session → `unattributedMs = span`, warning `derived-unattributed-time`; zero-todo source → `phaseSupport: 'unsupported'`.
  - Artifact compat — v1 artifact without `derived` validates via `assertArtifactVersion`; `emptyDerived` shape.
- **Regression**: `packages/domain` + `packages/app` suites — 2453 pass / 0 fail across 119 files (includes R2 structural invariant tests on the three new SQL queries).
- **Coverage** (from derived.test.ts run): `derived.ts` 93.33% funcs / 100.00% lines.
- **Full monorepo gate**: `bun run test` — 5073 pass / 0 fail / 0 skip across 282 files; `bun run test-cf` green; `bun run build` green (all three workspace builds); `bun run lint` + per-workspace `tsc --noEmit` clean; `spur task check --corpus` OK (2 baselined, 0 new, 0 stale); `transition-shim-check` PASS (4/4 baselined).
- **Fixed during verification**: R24b `skill-structure.test.ts` regression — task 0553's committed session-formats.md reduction dropped the 0507 R3 selected-file bridge phrases (`spur history import`, `agent-sessions`, `--mode force-file`) pinned by the test; restored the section verbatim (plugins/sp/skills/issue-finding/references/session-formats.md:77-90).
