---
schema_version: 1
id: "A34"
name: "Local-first hybrid search: exact (rg) and semantic (zg) over docs and code"
status: backlog
priority: P2
tags: []
created_at: "2026-11-03T16:48:14.451Z"
updated_at: "2026-11-03T17:13:51.303Z"
---

# A34: Local-first hybrid search: exact (rg) and semantic (zg) over docs and code

## Goal

Spur downstream projects get one local-first search capability that returns exact matches and fuzzy/semantic (vector) matches over both documents and source code. Spur stays a thin adapter: `zg` (`@zvec/zvec-grep`) is an optional external dependency — detected on PATH like `rg` and `sg`, never bundled or reimplemented — that owns embeddings and the index, while `rg` remains the exact-match baseline. The same normalized search contract serves agents and workflows (one `spur self search` verb) and operators (a Board search surface), and degrades to exact-only search when zg or its index is unavailable.

## Scope

- In:
  - zg detection and index-readiness probing (binary on PATH, `zg status` for `<root>/.zvec-grep`), reported with an actionable hint when absent.
  - `spur init` readiness: append `.zvec-grep/` to `.gitignore` (idempotent) and print zg/index hints; never install or index.
  - One `packages/app` search service: exact mode (rg), fuzzy mode (zg hybrid/vector), and auto mode (default: both routes when zg and its index are ready, otherwise exact only); one normalized result DTO (path, line range, snippet, route, rank, matchedBy).
  - A single zg adapter that isolates zg's CLI/output contract (zg 0.2.x prints agent markdown; no `--json`) and fails loudly on unparseable output.
  - Graceful degradation: no zg or no index → exact-only results plus a reason, never a crash.
  - Scope filters: docs vs code vs all, path globs, result limit.
  - One public verb `spur self search` with `--json` (ADR-051 consent granted conditionally by the operator's "if needed" premise; confirmed by the operator during planning with the exact|fuzzy|auto shape).
  - Local Bun server route + typed oRPC contract + Board search module offering auto / exact / fuzzy.
  - sp:* skill guidance to prefer semantic search when available with rg fallback; docs (design satellite, help, prerequisites).
- Out:
  - Implementing embeddings, chunking, vector storage, ranking internals, or any index format (zg owns them).
  - Building, rebuilding, or dropping persistent indexes automatically; `zg index` stays operator-driven.
  - Bundling or auto-installing zg (no package dependency, postinstall, install.sh step, or init-time install); running `zg install` agent integrations on the operator's behalf.
  - Remote embedding providers / credentials (local models only; Spur stores no API keys).
  - The Cloudflare Worker deployment path (no local filesystem).
  - New public nouns or verbs outside `spur self`.

## Acceptance Criteria

```gherkin
Feature: Local-first hybrid search: exact (rg) and semantic (zg) over docs and code

  @core
  Scenario: R1 — Fuzzy mode returns semantic matches from the zg index
    # covers: I1, I3, I6
    Given zg is on PATH and `zg status` reports a ready index for the project root
    When the search service runs query "how is a paused workflow resumed" in fuzzy mode
    Then results come from zg hybrid/vector retrieval
    And each result carries path, start line, end line, snippet, mode "fuzzy" and rank
    And Spur computes no embeddings and reads or writes no file under .zvec-grep

  @core
  Scenario: R2 — Exact mode returns literal matches through ripgrep
    # covers: I2
    Given rg is on PATH
    When the search service runs query "Bun.which" in exact mode
    Then results come from ripgrep with fixed-string matching
    And each result carries path, line, snippet, mode "exact" and rank
    And the result works without zg installed

  @core
  Scenario: R3 — Auto mode returns exact and fuzzy groups side by side
    # covers: I2, I3
    Given zg and rg are available and the index is ready
    When the search service runs a query in auto mode
    Then the response contains an exact group and a fuzzy group, each keeping its own rank
    And a fuzzy hit whose line range contains an exact hit on the same path is marked as matched by both

  @core
  Scenario: R4 — Search scope filters docs, code, or both
    # covers: I4
    Given an indexed project containing Markdown docs and TypeScript sources
    When the search runs with scope "docs", then "code", then "all"
    Then scope "docs" returns only documentation paths
    And scope "code" returns only source-code paths
    And scope "all" may return both
    And path globs and a result limit narrow every mode

  @core
  Scenario: R5 — zg is detected as an optional external dependency
    # covers: I5, I9
    Given zg is absent from PATH
    When the search capability reports its status
    Then it reports zg unavailable with the install hint "bun add -g @zvec/zvec-grep"
    And when zg is present but the project has no index it reports the hint "zg index --embedding local/potion-code-16m-v2"
    And Spur never runs zg index, never bundles zg, and never installs it

  @core
  Scenario: R6 — Missing zg or index degrades to exact-only search
    # covers: I5
    Given zg is unavailable or the index is not ready
    When an auto search runs
    Then exact results are still returned
    And an explicit fuzzy search returns no fuzzy hits instead of failing
    And the response states why the fuzzy route was skipped
    And the command exits zero

  @core
  Scenario: R7 — The zg adapter fails loudly on unrecognized output
    # covers: I10
    Given zg returns output the adapter cannot parse
    When a fuzzy search runs
    Then the fuzzy route reports a named zg-output error that includes the zg version
    And no partial or guessed results are presented as fuzzy matches

  @core
  Scenario: R8 — spur self search exposes the search contract as JSON
    # covers: I7, I1, I2
    Given the search service exists in packages/app
    When an agent runs spur self search "<query>" --mode exact|fuzzy|auto --json
    Then stdout is the normalized search response
    And the verb is the only new public command and lives under spur self
    And invalid flags or a failed search exit nonzero with an actionable message

  @core
  Scenario: R9 — The Board offers auto, exact, and fuzzy search
    # covers: I8, I4
    Given the local Board server is running for an indexed project
    When the operator searches from the Board with mode auto, exact, or fuzzy
    Then results render grouped by mode with path, line range and snippet
    And the Board shows zg and index status with the same hints as the CLI
    And the Board request goes through a typed oRPC contract served by the local Bun server

  @core
  Scenario: R10 — sp skills prefer semantic search with rg fallback
    # covers: I1, I5
    Given the sp plugin skills that locate workspace context
    When zg search is available
    Then their guidance routes concept and cross-file questions to semantic search first
    And exact lookups and zg-absent environments keep using rg

  @edge
  Scenario: R11 — Agent integrations stay owned by zg
    # covers: I11
    Given a downstream project adopts the search capability
    When the operator wants agents to call zg directly
    Then Spur documentation points to zg install and does not register integrations itself

  @core
  Scenario: R12 — spur init reports zg readiness and ignores the zg index
    # covers: I5, I9
    Given a project is initialized with spur init
    When init completes
    Then .gitignore contains the .zvec-grep/ entry exactly once
    And init reports zg as available, missing with the hint "bun add -g @zvec/zvec-grep", or present without an index with the hint "zg index --embedding local/potion-code-16m-v2"
    And init never installs zg, never runs zg index, and never downloads an embedding model
    And a missing zg never fails init
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 1285 | Hybrid search core: contracts DTO, SearchService, ZgAdapter, probe and degradation | todo |
| 1286 | spur self search verb over the hybrid search service | todo |
| 1287 | Board hybrid search: local-server search contract and web module | todo |
| 1288 | sp skill guidance and docs for semantic-first search with rg fallback | todo |
| 1289 | spur init: zg readiness report and .zvec-grep gitignore entry | todo |
<!-- END AUTO-GENERATED -->

## Notes

- Placement (2026-11-03): created as root `Q`, moved to `A34` under A3 by the operator's decision. Root A ("Agent harness & CLI capabilities") is the right theme but is at the DD-14 9-child cap; A3 created and owns the `spur self` noun, and this feature's only public verb is `spur self search`. Moving A9 under A3 to free a root slot was rejected (renames 3 done features, ~30 tasks, ~100 doc references).
- Mode naming: `auto` replaces the earlier `both` (operator proposal). `auto` is the default — both routes when zg and its index are ready, otherwise exact only with a `skipped` reason; `exact`/`fuzzy` are explicit overrides.
- ADR-051 consent: the operator's premise ("if needed, add a command under `spur self`") plus the operator-requested `--mode exact|fuzzy|auto` shape constitute consent for exactly `spur self search`; any other new verb/flag needs fresh consent.
- zg grammar correction: zg 0.2.2 output has no `source:` block and no freshness/results trailer; the observed grammar and exit codes are pinned in docs/design/hybrid-search.md §2.
- Install posture (R12): zg is never installed by spur or `spur init` — see task 1289 Background and design §4 Init.

## History

- 2026-11-03T17:06:32.825Z moved Q → A34 (system)

