---
schema_version: 1
name: "spur init: zg readiness report and .zvec-grep gitignore entry"
status: todo
template: feature-impl
created_at: 2026-11-03T16:56:58.316Z
updated_at: "2026-11-03T17:16:21.756Z"
feature_id: A34
priority: P3
tags:
  - search
  - zg
  - init

dependencies: ["1285"]
---

## 1289. spur init: zg readiness report and .zvec-grep gitignore entry

### Background

Feature A34 R12. Operators asked whether zg should be installed with spur or by `spur init`. Rejected: zg 0.2.2 requires Node >=22 with heavy runtime deps (@huggingface/transformers, tree-sitter-wasms, MCP SDK, optional node-llama-cpp), downloads embedding models (~32 MB here) and builds per-project indexes (~300 MB for this repo); the spur CLI ships no postinstall and only two runtime deps, the standalone install.sh path has no package manager, and rg/sg are likewise detected, never installed. Accepted refinement: init makes the project zg-ready without side effects — gitignore the index dir and report readiness with hints. Depends on 1285 (`searchStatus`). Design: docs/design/hybrid-search.md §4 Init (ADR-147).

### Requirements

- [ ] R12. spur init reports zg readiness and ignores the zg index.

### Acceptance Criteria

- [ ] AC1 — spur init reports zg readiness and ignores the zg index

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-03T17:16:21.507Z

- Q: Install zg from spur/init? A: no (see Background); hints only.
- Q: New `--with-search` init flag? A: rejected — public-surface change for no gain over a printed hint.
- Q: `--minimal`? A: still writes the `.zvec-grep/` gitignore entry and prints the readiness line.
- Q: Probe failure? A: `index: 'unknown'`, informational line, init exit code unchanged.
- Q: JSON field name? A: `search` holding `SearchStatus`.

### Design

Edits in `apps/cli/src/commands/init.ts` (the `spur self init` builder; `spur init` is the hidden alias):
- Gitignore (beside lines 384–402): generalise the existing append to a list `[{ entry: '.spur/context/', comment: '# Spur indexed-context (machine-generated)' }, { entry: '.zvec-grep/', comment: '# zg semantic-search index (operator-built)' }]`; for each, append only when `existing` lacks the entry; create the file with all entries when absent. Keep the exact current `.spur/context/` output byte-identical.
- Readiness: after scaffolding call `searchStatus(context.cwd)` from `@gobing-ai/spur-app/search`, wrapped so any throw yields `{ rg: { available: false }, zg: { available: false, index: 'unknown' } }`. Overall bound: the probe's own 5 s timeouts.
- `--json` payload (lines ~463–476): add `search: <SearchStatus>` to the `toEnvelopeJson({...})` object.
- Human output: one line after the existing summary — `search: zg ready` | `search: zg index stale — run: zg index` | `search: zg index missing — run: zg index --embedding local/potion-code-16m-v2` | `search: zg not installed (optional) — install: bun add -g @zvec/zvec-grep` | `search: zg status unknown`.
- Template parity: if init templates under `config/templates` carry a `.gitignore`, add `.zvec-grep/` there too (check `apps/cli/tests/init-templates.test.ts`).

Rejected: zg as a spur package dependency/postinstall; init-time `bun add -g` or `zg index`; a new init flag.
Invariants: init never spawns an installer, `zg index` or a model download; missing zg never fails init; idempotent on re-run.

### Plan

1. Failure list first in `apps/cli/tests/init-templates.test.ts` (or a new `apps/cli/tests/commands/init-search.test.ts`): no .gitignore; .gitignore without entries; already containing `.zvec-grep/` (no duplicate on re-run); `--minimal`; zg absent; zg present + index missing; probe throws → unknown; `--json` contains `search`.
2. Implement gitignore list + readiness line + JSON field.
3. E2E (repeatable artifact): `mkdir -p $TMPDIR/a34-init && cd $TMPDIR/a34-init && git init -q && bun run <repo>/apps/cli/src/index.ts self init --json > init.json`; assert `grep -c '^.zvec-grep/$' .gitignore` = 1 after two runs and `jq .search init.json`; repeat with PATH stripped of zg.
4. `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature: docs/features/A34_local-first-hybrid-search-exact-rg-and-semantic-zg-over-docs-and-code.md (R12)
- Design: docs/design/hybrid-search.md §4 Init; ADR-147
- Depends on: 1285
- Seams: apps/cli/src/commands/init.ts:384-402 (gitignore), apps/cli/src/commands/init.ts:463-476 (JSON payload), apps/cli/tests/init-templates.test.ts

### History

- 2026-11-03T17:06:32.825Z feature_id Q → A34 (system)

