---
schema_version: 1
name: spur self search verb over the hybrid search service
status: done
template: feature-impl
created_at: 2026-11-03T16:50:38.253Z
updated_at: "2026-11-03T22:07:47.177Z"
feature_id: A34
priority: P2
tags:
  - search
  - cli

dependencies: ["1285"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1286-verdict.json
---

## 1286. spur self search verb over the hybrid search service

### Background

Feature A34 CLI surface. Covers R8. Agents, hooks and workflows need the normalized search contract as JSON. ADR-051 consent: the operator's premise permits one verb under `spur self` only, and the operator set the mode shape `exact|fuzzy|auto` during planning — consent covers exactly the synopsis below; any extra flag or verb needs fresh consent. Depends on 1285 (`searchProject`, `searchStatus`, `SearchError`). Design: docs/design/hybrid-search.md §4 CLI (ADR-147).

### Requirements

- [x] R8. spur self search exposes the search contract as JSON.

### Acceptance Criteria

- [x] AC1 — spur self search exposes the search contract as JSON

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-03T17:16:17.385Z

- Q: New noun or `self` verb? A: `spur self search` only (operator premise + ADR-051). No hidden top-level alias.
- Q: Default mode? A: `auto`; scope `all`; limit 20 (1–100).
- Q: Exit codes? A: 0 on results, empty results, or fuzzy degradation; 1 on `SearchError` (invalid request, rg missing/failed) with the hint in the message.
- Q: Raw zg/rg passthrough flags? A: rejected — leaks the adapter.
- Q: Does `spur self status` show search readiness? A: deferred; `--status` owns it.

### Design

Files:
- Create `apps/cli/src/commands/self/search.ts` exporting `registerSearchCommand(self: Command, context: CliContext): void`; register it in `apps/cli/src/commands/self/index.ts` (alphabetical, after `registerMigrateCommand`). Pattern: sibling `self/exec.ts`.
- Synopsis: `spur self search [query] --mode <exact|fuzzy|auto> --scope <docs|code|all> --glob <g...> --limit <n> --regex --status --json`. `query` optional only with `--status`.
- Action: build `{ query, mode, scope, globs, limit: Number(limit), regex }` and call `searchProject(req, context.cwd)` from `@gobing-ai/spur-app/search` (subpath added by 1285; precedent `self/exec.ts:2-3`); `--status` calls `searchStatus(context.cwd)`. Zod validation errors and `SearchError` → existing CLI error convention (actionable message, exit 1) — follow what `self/exec.ts` uses.
- `--json`: emit via the standard `toEnvelopeJson(...)` helper used by sibling commands (honours `--json-envelope`); payload is the `SearchResponse` / `SearchStatus` verbatim.
- Human output: per non-null group a header `exact (n)` / `fuzzy (n)`, each hit `path:start[-end]  [matchedBy]` + indented snippet (first 3 lines); then `skipped fuzzy: <reason> — <hint>`; zero hits prints `no matches`.
- Docs: add the verb to `plugins/sp/skills/spur-cli/references/self.md`, `docs/help/spur-cli-matrix.md`, and `docs/help/cmd_status.md` next to `spur self exec`; add a design §4 cross-link if wording drifts.
- After source change: `(cd apps/cli && bun link)` then `bun run --filter @gobing-ai/spur build:bundle`.

Rejected: top-level `search` noun; zg/rg passthrough flags; non-zero exit on degradation.
Invariants: never prints or runs install/index commands, only hints; no logic beyond flag mapping + rendering (ADR-021).

### Plan

1. Failure list first in `apps/cli/tests/commands/self/search.test.ts`: empty query; `--mode both` rejected; `--limit 0`/`101`/`abc`; `--status` without query OK; JSON shape parses with `searchResponseSchema`; degraded auto exits 0 with `skipped`; rg missing exits 1 with hint. Inject fake deps/PATH as `exec.test.ts` does.
2. Implement `self/search.ts` + registration.
3. Update spur-cli reference, CLI matrix, cmd_status help.
4. E2E (repeatable artifact): `bun run apps/cli/src/index.ts self search "how is a paused workflow resumed" --json > $TMPDIR/a34-auto.json` (expect both groups non-null in this repo); `--mode exact "Bun.which"`; `PATH=<dir without zg> … --mode auto --json` (expect `groups.fuzzy=null`, `skipped[0].reason="zg-not-installed"`, exit 0); `--status --json`. Record commands + `jq` checks in Testing.
5. `bun run spur-check`.

### Solution

`spur self search` is a thin transport over the 1285 service (ADR-021): flag mapping, rendering,
exit codes — no search logic in the CLI.

- `apps/cli/src/commands/self/search.ts:15` — `registerSearchCommand` declares the synopsis from
  `docs/design/hybrid-search.md` §4: `[query]`, `--mode` (registry entry), `--scope`, `--glob <g...>`,
  `--limit` (default `20`, pinned in the CLI because the app service defaults to 10), `--regex`,
  `--status`, `--json`, `--json-envelope`.
- `apps/cli/src/commands/self/search.ts:37` — `--status` short-circuits to `searchStatus(cwd)` and
  accepts no query; every other invocation builds the request object and calls `searchProject(req, cwd)`.
- `apps/cli/src/commands/self/search.ts:54` — request assembly: `limit: Number(opts.limit)` plus
  omitted-when-undefined `mode`/`scope`/`globs`/`regex`, so `searchRequestSchema.strict()` sees only
  supplied keys and rejects anything else.
- `apps/cli/src/commands/self/search.ts:63` — failure path delegates to `writeJsonError` and exits 1;
  `SearchError` already carries the actionable text (invalid request, missing rg + install hint).
- `apps/cli/src/commands/self/search.ts:80` — `formatSearchResponse`: `exact (n)` / `fuzzy (n)` headers
  per non-null group, `path:start[-end]  [matchedBy]` plus the first three snippet lines indented,
  `no matches` when both groups are empty, then one `skipped <route>: <reason> — <hint>` line each.
- `apps/cli/src/commands/self/search.ts:110` — `formatSearchStatus`: `rg:`/`zg:` readiness lines and
  the service's hint string, printed only.
- `apps/cli/src/commands/self/index.ts:21` — registered alphabetically after `migrate`.
- `apps/cli/src/commands/shared-options.ts:54` — `modeSearch` registry entry: `--mode <mode>` is a
  shared flag string (agent/history already declare it), so the search text needs its own entry to
  satisfy `shared-option-parity`. The boolean `--status` deliberately stays a literal declaration —
  registering the bare form makes every `--status <s>` literal read as a shared-flag re-declaration.
- Docs: `plugins/sp/skills/spur-cli/references/self.md` (verb map + `self search` section),
  `docs/help/spur-cli-matrix.md` (cell, `self` 6→7, unique verbs 79→80, cells 107→108),
  `docs/help/cmd_status.md` and `docs/help2/status.md` (search sections beside `self exec`).
- Tests: `apps/cli/tests/commands/self/search.test.ts` (rendering, in-process transport, PATH-degraded
  subprocess), plus two census bumps required by the new verb
  (`apps/cli/tests/shared-option-parity.test.ts` note only,
  `apps/cli/tests/json-envelope-inventory.test.ts` 80→81).

Invariants held: no install/index command is executed or suggested beyond the printed hint; no raw
zg/rg passthrough flag; degradation never changes the exit code.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R8 | MET | apps/cli/src/commands/self/search.ts:15 verb; tests apps/cli/tests/commands/self/search.test.ts:183 (schema parse of stdout), apps/cli/tests/commands/self/search.test.ts:198 (envelope), apps/cli/tests/commands/self/search.test.ts:271 (usage exit 2), apps/cli/tests/commands/self/search.test.ts:341 (rg absent exit 1 with hint) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R8 — spur self search exposes the search contract as JSON | MET | test | apps/cli/tests/commands/self/search.test.ts:183; cli suites 77 pass / 0 fail (2026-11-03); live self search --json on this repo exit 0, exact=8 fuzzy=20; --limit 0 exits 1 with Invalid search request |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

| Priority | Finding | Location | Disposition |
| --- | --- | --- | --- |
| P4 | none (no open findings; full traceability evidence in the review artifact) | .spur/run/b391a7f6-5013-4674-983a-254759c9fbc9-review-cert.md | Closed |

Review artifact: .spur/run/b391a7f6-5013-4674-983a-254759c9fbc9-review-cert.md (1/1 requirement MET, 1/1 AC MET). SECUA pass: no new process spawns, no shell interpolation, hints-only degradation (ADR-051 invariant). Thin transport confirmed — flag mapping and rendering only (ADR-021). Residual risk: none beyond the 1285 service surface this verb wraps; renderer output shape is pinned by renderer unit tests.
Confidence: HIGH

Verdict: PASS

### References

- Feature: docs/features/A34_local-first-hybrid-search-exact-rg-and-semantic-zg-over-docs-and-code.md (R8)
- Design: docs/design/hybrid-search.md §4 CLI; ADR-147, ADR-051
- Depends on: 1285
- Precedents: apps/cli/src/commands/self/index.ts, apps/cli/src/commands/self/exec.ts, apps/cli/tests/commands/self/exec.test.ts
- Docs: plugins/sp/skills/spur-cli/references/self.md, docs/help/spur-cli-matrix.md, docs/help/cmd_status.md

### History

- 2026-11-03T17:06:32.825Z feature_id Q → A34 (system)
- 2026-11-03T18:45:01.470Z todo → wip (system)
- 2026-11-03T18:54:04.927Z wip → testing (system)
- 2026-11-03T18:54:07.592Z testing → done (system)

