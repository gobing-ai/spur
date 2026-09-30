---
kind: design
title: History capability detection contract
status: accepted
created_at: 2026-09-30
updated_at: 2026-09-30
related:
  - E93
  - docs/design/history-data-processing.md
  - docs/design/history-incremental-materialization.md
  - docs/plans/2026-09-30-history-capability-detection-brainstorm.md
tags: [contract, E93, history, agent]
---

# History capability detection contract

## 1. Issue
Histories conflates commands, subagents, and ordinary skills and misses some skill-loading evidence. Superskill can represent commands and subagents as skills, so the transport mechanism alone cannot establish capability kind. A user request also cannot establish that an agent loaded a skill or delegated work.

## 2. Current behavior and ownership
The installed importer 0.5.11 owns source-specific extraction through `extractSkillCalls` in `src/mappers.ts:121`, canonicalization, core fact schema, and stable import identities. Its `history_skill_call` records user/model invocation kind but no capability kind or request/load/delegation distinction (`src/types.ts:176`, `src/schema-sql.ts:104`). pi extraction currently recognizes user wrappers only (`src/mappers.ts:217`). Codex's wrapper regex expects a closing wrapper immediately after the path (`src/mappers.ts:253`), missing full-body wrappers.

Spur owns application orchestration, board rollups, consumer indexes, and transport DTOs. Existing Summary load counts use `skillCallRollup` (`packages/domain/src/analytics/history-board-rollup.ts:268`); skill token dimensions derive from tool calls (`packages/domain/src/analytics/forensic-query.ts:1539`). These represent different measures.

Retain ADR-103/104/105: importer-produced fact columns stay upstream, Spur adopts them through its migration ledger, and derived query indexes/marts stay in Spur. No new package, parser service, CLI noun, or module ownership boundary is introduced. The operator accepted this design with the per-agent format requirements below. Implementation is pending.

The operator explicitly authorized necessary upstream enhancement in `/Users/robin/xprojects/ts-libs`. The producer implementation belongs in its `packages/llm-jsonl-importer`, including schema/types, source mappers, importer normalization and fixture tests. Follow that workspace's AGENTS.md and lifecycle/gates; retain separate commits and provenance for each repository. Package release remains the upstream operator-run workflow: do not substitute edits to Spur's installed dependency or hand-maintained generated adapters. Downstream adoption records the actual released version; missing release availability is a dependency, not permission to fork extraction into Spur.

## 3. Chosen solution
Extend the existing importer extraction and consume its released contract in Spur because it already owns the raw records, source adapters, stable identities, and fact writes. A regex-only fix leaves implicit loads and capability taxonomy unresolved; a Spur-side extractor duplicates the authoritative parser.

Extend `history_skill_call` and its exported row types additively, retaining the historical table and `skill_name` identity. Section 8 freezes the producer fields, input types, event algorithm and consumer behavior; this table summarizes their meaning:

| Value | Proposed meaning |
| --- | --- |
| `capability_kind` | `command\|subagent\|skill`, nullable when original kind cannot be verified |
| `invocation_kind` | Existing `user\|model`; source role establishes the invoker independently of capability kind |
| `evidence_kind` | `request\|load\|delegation`; null for legacy rows until reprocessed |
| `invocation_id` | Stable, source-scoped logical invocation identity for correlated representations |
| `origin_identity` | Nullable verifiable Superskill artifact identity and its provenance, with no origin inferred from naming prefixes |

Reuse existing message/source/call identity, path, args, status, and timestamp fields. Existing `status` distinguishes an observed successful load/delegation from a failed or unconfirmed attempt; absent confirmation remains unknown. Preserve source evidence that justified each classification. Do not store full skill bodies or unredacted tool arguments solely to classify capabilities.

Rows preserve individual evidence records. Consumer invocation counts group correlated records by `invocation_id`; request counts and confirmed-load/delegation counts are distinct. This preserves the earlier request while allowing a later observed action to establish what happened. Neither a command request nor a delegation request proves eventual completion.

## 4. Detection and identity contract

### 4.1 User inputs
Use verified source-specific invocation syntax in actual user inputs: commands, explicit skill markers, and injected skill wrappers. Parse Codex child-element wrappers with their full body and pi attribute wrappers using source record structure and role. Quoted examples, fenced examples, catalogs, tool output, and arbitrary mentions are negative evidence. If source rendering makes an injected wrapper indistinguishable from quoted content, mark that signature unverified rather than promise perfect detection.

A user request for a subagent retains request intent; only a verified adapter load or model delegation establishes the observed action. A normal skill can be user-requested or model-loaded.

### 4.2 Tool use
Each source adapter recognizes verified native skill-load tools, skill-file reads, and native delegation tools from assistant records. Keep source tool namespace, argument shape, role, call identity, result status, and native parent/child identity when present. Codex and pi file-loading tools must be covered alongside native Claude/OMP loads and agy/grok skill-file reads.

Only a structurally verified read of a known skill artifact establishes a skill-file load. Never execute historical shell text; accept statically demonstrable literal file reads only where a fixture verifies their source encoding. Opaque expressions are extraction limits. A tool call with a failed result records an attempt; an unpaired call retains unknown outcome rather than success. Invocation/delegation does not assert child completion.

### 4.3 Superskill conversion
Resolve logical kind through explicit generated origin metadata or deterministic manifest identity that ties the observed installed artifact to a command, subagent, or ordinary skill. Record the version/provenance used. A current manifest cannot retroactively prove historical origin after an identity changed; missing or ambiguous historical origin stays unresolved.

Native delegation is a subagent regardless of whether its skill file was read. A converted subagent loaded inline is a subagent capability represented as a skill; do not invent a child session or subprocess. A name such as `sp-super-coder` alone proves no origin kind. Do not hand-edit generated adapters.

The ready-depth audit established the available origin metadata and source fields in §8.1. Implement that supplied-index contract; exact historical origin without matching artifact evidence remains unresolved. Verified synthetic origin fixtures prove the supported resolution path. Missing metadata does not justify a second parser or a new Superskill public surface.

### 4.4 Correlation
Prefer native invocation/call identity and explicit source linkage. Within one source user record, correlated syntax and an injected wrapper for the same invocation share an identity. Connect a later load/delegation only through verified source linkage. Repeated calls with distinct call/source identities remain distinct even when their names, arguments, and timestamps match.

Never correlate solely by nearest timestamp or matching name across messages. Where linkage is unavailable, retain separate evidence identities and expose that coverage limit. Import hashing and deduplication must remain deterministic across full and incremental replay.

### 4.5 Coverage
Audit all registered source routes. Initial delivered full-fidelity sources remain `claude, codex, pi, omp, agy, grok`; each has positive and negative fixtures for its available signatures. Not every agent supports every native mechanism; distinguish a verified emulation path, a native signature, and unavailable evidence. Deferred sources keep their existing labels; this feature does not promise complete extraction for gemini/opencode/antigravity-ide/openclaw/hermes.

### 4.6 Per-agent record formats
Normalize each source's envelope, role, content representation, tool arguments, results, timestamps, and identity before classification. Share the capability contract and canonicalization, not one transcript regex across all agents. A registry entry is not proof that every mechanism is available for that agent. Fixtures must travel through the real importer, covering envelope variants rather than only calling a helper on pre-normalized data.

| Source | Formats and signals to cover | Required negative or degraded cases |
| --- | --- | --- |
| Codex | Response/event envelopes and structured content blocks; child-element skill wrappers containing a full skill body; explicit dollar/slash syntax; function/tool calls with JSON-string or object arguments; shell-backed literal skill reads; native delegation records where present | Assistant commentary, quoted wrappers, generic shell/file activity, failed or missing tool result, malformed arguments; duplicate representations of one user event |
| pi | Message envelopes with role and text/content-block forms; attribute-based skill wrappers with optional location; ordinary read-tool loads; installed extensions' tool records only when verified by fixtures | Skill catalogs, quoted wrapper fragments, reads of unrelated files, unknown extension tool signatures |
| Claude | Nested message content with native Skill/tool_use, caller provenance, user command expansion, and native delegation tool calls/results | Tool-result text resembling a user invocation; model invocation misidentified as user; duplicate command expansion |
| OMP | Message/content envelopes and normalized toolCall/functionCall forms; Skill invocations, tool reads, and verified delegation records | User wrappers ignored solely because a native skill tool also exists; missing role or result; unrelated tool names |
| agy | Planner response tool_calls, view_file arguments/action metadata and result records; source-specific user commands and delegation only where established | Unrelated view_file, different tool namespaces, unsupported native delegation |
| Grok | Normalized tool_call records and namespace metadata; read_file target_file skill reads; source-specific user/delegation shapes | Same tool name in another namespace, unrelated target_file, malformed metadata |
| Other registered sources | Audit actual importers and source fixture encodings, including OpenCode's separate skill-tool path; document verified signatures and explicit gaps | No blanket inference from similarity to another agent; preserve deferred full-fidelity scope |

Names in this matrix describe observed current routes or fixture targets; they do not assert that every target variant is already implemented. Resolve each signature against redacted source fixtures and record the format/version provenance. Avoid losing content when a source uses an array rather than a string, or arguments serialized as JSON text.

Codex or other agents may wrap tool use inside orchestration calls such as a functions.exec body that invokes exec_command. Statically decode only a fixture-backed literal subset; never evaluate JavaScript, shell, or expressions from history. Retain the outer record identity and nested literal call identity when extractable; opaque/dynamic bodies remain an explicit coverage limit. Supporting a native file-read tool alone must not be reported as full coverage for shell or nested-tool skill reads.

The source fixture matrix covers commands, native/converted subagents, and explicit/implicit ordinary skills wherever each format actually carries the relevant evidence. Each declared supported signature has positive, negative, repeated-call, and malformed-record cases. Unavailable signatures remain unsupported, independently of whether the source itself imports successfully.

## 5. Histories query and compatibility contract
Expose kind and invoker independently in existing Histories capability breakdowns, alongside request/load/delegation distinctions and unresolved classification. Extend existing DTOs additively; retain legacy fields with the corrected confirmed-load semantics frozen in section 8.3. Request-only evidence is reported separately. Counts for subagents do not imply successful completion.

Fresh materialized results and any supported bounded raw fallback use the same logical event population and filters. Retain current materialized-read policy and bounds; do not add an unbounded fallback. Repeated names group only after invocation identity has been resolved. Bump relevant definition versions and invalidate affected caches/marts when extraction/count semantics change.

Token totals, token allocation across tool calls, and unrelated Summary KPIs stay unchanged. New request-only events do not acquire inferred token costs. Changes to web presentation reuse current Histories components and root DESIGN.md during implementation; this design adds no independent UI system.

## 6. Migration and replay
Upstream owns producer-column schema changes and bumps its schema version. Spur consumes a released package and applies versioned migration through its ledger; preserve already-applied migrations. Old rows use null/unknown for new values until regenerated—never default historical kind to ordinary skill or outcome to success.

Extraction changes require deliberate checkpoint invalidation or a documented full replay; a package update with unchanged file size is insufficient to discover past events. Preserve unaffected source facts and rebuild only affected derived structures through existing import/analyze surfaces. Before live reprocessing, follow existing backup and dry-run contracts, record binary/importer provenance, and validate the procedure on an isolated database copy. Planning runs no live reimport.

Fixture and replay checks compare counts, identities, and outcomes after two imports, including append-only growth and repeated calls. Original database and raw history files must remain unchanged in the acceptance exercise.

## 7. Verification and tradeoffs
Cover all nine E93 scenarios with source fixtures and a consumer integration/replay exercise. Required cases include full-body Codex wrappers, pi implicit reads, native delegation, explicit commands, ordinary loads, verified converted origin, missing historical origin, false positives, correlated representations, repeated calls, failed/unconfirmed attempts, null legacy fields, and fresh/raw parity.

The cost is coordinated upstream contract adoption and safe rebuilding. The benefit is one extraction owner and explainable counts. No new ADR is needed for package ownership: existing ADR-103/104/105 already settle it. The additive fact and DTO shape remains reversible until implemented. Any requested departure from ownership, deferred-source scope, or token accounting needs separate design context.

Metadata availability and exact historical tool encodings have explicit unknown/unsupported behavior if absent. The task contracts and section 8 freeze the supported paths and checks; implementers must not guess identities or fabricate coverage.

## 8. Implementation-ready freeze (2026-09-30)

This section closes implementation choices for tasks 1028, 1029 and 1030. It refines the accepted behavior without expanding source scope, adding a public Spur command, or changing token allocation.

### 8.1 Producer contract and origin input — task 1028
Add exactly four nullable TEXT columns to importer-owned `history_skill_call`: `capability_kind`, `evidence_kind`, `invocation_id`, `origin_identity`. Constrain non-null kind to `command/subagent/skill` and evidence to `request/load/delegation`. Extend `SkillCall`, `SkillCallSplitRecord`, mapper typed columns, DAO typed columns, schema application, and package exports together. Keep `invocation_kind` as user/model. New events use `status=ok/error/unknown`; requests and unpaired attempts are unknown. Legacy status/null columns do not certify success. No new table or parser package is needed.

Export `CapabilityKind`, `CapabilityEvidenceKind`, and the object interface `CapabilityOrigin` from the existing importer barrel. Freeze `CapabilityOrigin` fields as:
- `source: string`, the matching source id;
- `skillName: string`, canonicalized through the existing helper;
- `skillPath?: string`, an optional exact slash-normalized observed artifact path;
- `artifactDigest: string`, SHA-256 of the complete observed artifact's UTF-8 bytes;
- `capabilityKind: CapabilityKind`;
- `originIdentity: string`, a versioned origin reference retaining plugin/source path and digest provenance.

Add optional `capabilityOrigins?: readonly CapabilityOrigin[]` to `ImportOptions` and `TransformContext`, propagate it through existing split calls, and validate its shape before schema/write activity. Empty/absent input preserves honest unresolved origins. No callback, filesystem scan, Superskill runtime dependency, new CLI flag, or environment-based lookup is introduced upstream.

Classification precedence is: authoritative source-native command/delegation identity; then a unique supplied origin whose source, canonical name, optional exact path and observed complete-artifact digest agree; otherwise null for a skill representation whose original kind is unknown. Conflicting matching origins yield null plus a bounded validation finding, never whichever entry appears first. Native slash command activation must be established by the source's command record/expansion, not the spelling of a skill marker. A native Skill/load tool alone does not prove that the logical kind is ordinary skill.

Verified Superskill facts: `adaptCommandToSkill` injects disable-model-invocation, `adaptSubagentToSkill` preserves fields without an explicit origin discriminator, and `InstallManifestV1` holds upstream/installed snapshots rather than an entity-kind mapping. The invocation restriction is not an origin identity. A trusted supplied snapshot can map explicit source directories commands/agents/skills to the observed generated artifact by digest; current installation metadata without matching historical artifact bytes is insufficient. Task 1028 tests this supplied-index resolution; task 1029 forwards a supplied index without inventing an automatic historical catalog. Enhancing Superskill itself is outside these tasks.

### 8.2 Source parsing, stable identity and result pairing — task 1028
Keep `extractSkillCalls` and all existing source split callers. Decode each source envelope and role before examining user text or tool records; preserve content arrays and parse serialized JSON arguments only as data. A full-body wrapper is a structured injection only when the source record identifies that form; quoted/fenced wrappers and catalogs are ignored. Native protocol/source identity outranks a user body's self-description.

For literal file reads, support verified native read tools plus literal shell `cat [--] <path...>` and `sed -n '<range>p' <path>` forms targeting SKILL.md. A shell lexer must honor quotes, skip comments, reject expansions/substitutions/redirections for this extraction path, and identify actual command segments rather than search command text for a path. Reading an unrelated file is not a load. Partial reads can establish observed load activity but cannot satisfy a complete-artifact origin digest.

Nested orchestration support is a bounded literal grammar: genuine `tools.exec_command({cmd: <string literal>, ...})` calls inside the source's functions.exec payload, with comments/quoted code excluded and no interpolation, identifier-valued cmd, aliases, eval, dynamic construction, or execution of code. Retain outer source/call identity and a local nested-call ordinal. Unsupported expressions remain unknown coverage. Extend this grammar only for a fixture-backed additional form; no general JavaScript interpreter or new dependency is required.

Compute `invocation_id` with the existing SHA-256/stableJson helpers over a version-1 tuple: source, session id, and authoritative invocation id when supplied; otherwise call id; otherwise native record id plus local invocation ordinal; otherwise normalized source_file/source_line/local ordinal. A wrapper and marker collapse only when the same source user event proves a shared invocation. Source-native request-to-call linkage can reuse that id; matching name/time alone cannot. Distinct same-name calls remain distinct.

Immutable evidence rows keep stable record/ledger identity. Treat result status, completed_at and duration as import-owned derived fields, analogous to existing tool-duration updates, rather than changing the record hash when a later result arrives. Pair results by source/session/call id only; use the existing importer's per-run call map plus DB lookup for results arriving in a later incremental run. Both paths must update the same pending skill event deterministically. A successful result marks its load/delegation ok; an error result marks error; missing result remains unknown. A verified injected complete skill body establishes a successful load separately from the user's request. For delegation, ok means accepted dispatch, never child completion.

Set event started_at from its native timestamp or linked parent-message timestamp; never from imported_at. Preserve missing time as null and report it as unbucketed coverage. Current skillRecord defaults started_at to null and several split callers forward it unchanged, while rollups exclude null times; timestamp retention is part of this root-cause fix. Redaction precedes hashing/persistence and no new classifier stores full skill bodies merely for origin lookup.

### 8.3 Consumer names and exact counts — task 1029
Add optional `capabilityOrigins?: readonly CapabilityOrigin[]` to internal `HistoryServiceContext` and forward it to `runJsonlImport`. Preserve the separate OpenCode importer route and its existing deferred scope. There is no new public Spur noun, verb or flag. A caller without a trusted snapshot uses an empty index and sees unresolved origin; fixture composition injects explicit verified indices.

Extend `history_board_skill_5m` at its existing minute grain with `capability_kind`, `evidence_kind` and `status`, retaining existing columns. Consumer index/migration changes live in Spur; take the next unused migration number at execution time. Update `HistoryBoardSkill5mRow`, `HistoryBoardSkillBreakdown`, `skillCallRollup`, `replaceHistoryBoardRollups`, `refreshHistoryBoardRollupsIncremental`, `historyBoardSkillBreakdownFromRollup` and every affected seed/write/read caller together. The table's name does not change its current minute-floor semantics.

Before bucket/window filtering, select one representative per source/session/logical invocation/invoker/evidence class. Use earliest valid event started_at, then stable record_hash for ties. A null legacy invocation_id uses record_hash and is never coalesced merely by name. Status precedence within a class is ok, then error, then unknown; multiple distinct dispatch attempts must carry different invocation ids. Preserve request and observed load/delegation classes separately. When a late result changes outcome, invalidate/rebuild the original event's bucket, not merely the result's timestamp bucket. Aggregate representatives once so combining minute buckets cannot double-count a correlated invocation.

Freeze additive `historySkillBreakdownSchema.byCapability` as an array of:
`{ skillName, capabilityKind: command|subagent|skill|null, invocationKind: user|model, evidenceKind: request|load|delegation|null, status: ok|error|unknown, calls: number }`.
Default the new array to [] at old payload/mock boundaries; retain fresh signaling. Extend matching domain/service response shapes. Existing bySkill/bySource/byInvocationKind/trend remain the confirmed `evidence_kind=load AND status=ok` measure, including converted loads regardless of their logical kind; new byCapability exposes requests, delegations, failures and unresolved identity separately. Legacy null evidence stays visible as unknown in byCapability, not fabricated as a confirmed load.

Use the existing SummaryTab Skill Load Breakdown area to expose the three kinds and request/load/delegation/outcome distinctions using native markup and existing components. No new navigation, global filter family, endpoint, chart library or token series. Counts for a name cannot imply successful completion. Preserve current Sources deferral labels and fresh=false behavior; show unresolved identity and unavailable coverage honestly.

The current breakdown uses COUNT(*) and no success predicate; prior prose calling it confirmed-load counting was inaccurate. The corrected measure is intentional and must be tested/documented. Both normal and stale service paths currently call the materialized breakdown helper; there is no independent runtime raw capability fallback to build. Verify parity against a direct SQL reference in tests and preserve any already-supported bounded fallback for other measures.

Use a test population with 2 user requests (command/subagent), 3 successful loads (two correlated representations of one converted command load, one ordinary skill load and one unresolved-origin load), 1 successful model delegation, 1 failed load and 1 unconfirmed load. byCapability totals are 8 logical evidence-class usages; confirmed legacy load count is 3. The two representations share invocation identity; other repeat calls have distinct identities. Token totals and tool-derived token allocation stay exactly equal to pre-change values. Partitioned buckets, source/range/name filters and a late-result incremental refresh must equal the SQL reference.

### 8.4 Adoption, replay and observability — tasks 1029 and 1030
Task 1028 hands task 1029 the upstream revision, schema version, source-support matrix, type/API contract and focused/full gate receipts. A release version is recorded only after the upstream operator-run lockstep process publishes it. Task 1029's step 0 requires that package to be available and its installed version to match dependency/lockfile provenance; do not manufacture a version or patch node_modules. That release dependency does not make the specification incomplete.

Task 1030 owns the operational replay check, not a second implementation of the classifier or query contract. Use in-memory/temporary SQLite and injected source roots/files/historyHome/getDb in tests, never ambient user history. The real-data procedure requires a SQLite-consistent backup, explicit isolated database target, binary/importer provenance and dry-run before writes. Existing DATABASE_URL composition can target the isolated copy; no new flag is needed. Never invoke history reset for these acceptance tests.

Use existing full mode to deliberately reprocess unchanged files and regenerate changed evidence; incremental mode alone short-circuits unchanged files. Full-mode reconciliation is source-scoped, so enumerate the complete fixture/file population for each tested source. Do not pass one file as a partial full population in a mixed source database: it can delete same-source rows absent from that list. Single-file force-file is an existing import mode, but it is not the procedure for retiring all old extraction hashes. No ad hoc ledger deletion or new public replay command.

Required replay cases: migrate an old-schema fixture; dry-run with zero mutations; full replay twice with stable logical identities/counts; append a result in a later incremental run and recompute its original bucket; append a second same-name invocation without collapsing it; skip unchanged files under incremental mode; preserve another source's sentinel rows and all raw files; reject unavailable/invalid importer provenance before writes. Compare both source evidence and consumer outcomes from task 1029. No receipt calls product behavior verified before the runnable checks actually pass.

Test homes are frozen:
- 1028: ts-libs packages/llm-jsonl-importer/tests/skill-call-import.test.ts, history-skill-call.test.ts, forensic-contract.test.ts, importer.test.ts and schema-sql.test.ts; add cases in these real importer/DAO paths rather than mock extractSkillCalls.
- 1029: packages/domain/tests/analytics/history-board-rollup.test.ts and history-board-marts.test.ts, packages/domain/tests/dao/migrations.test.ts, packages/app/tests/services/history-board-service.test.ts and history-response-shape.test.ts, apps/web/tests/modules/history/components.test.tsx.
- 1030: packages/app/tests/services/history-service.test.ts and history-analysis-service.test.ts plus one focused packages/app/tests/services/history-capability-replay.test.ts if the existing files would bury the complete replay scenario.

Run tests inside their owning workspace with its existing preload. Upstream completion requires ts-libs AGENTS.md checks/build; Spur tasks use task-local gates and the once-per-feature gate at completion. CLI-source changes additionally follow Spur's link/bundle rule. Preserve separate commits and proof per repository; a task with an upstream-only source diff records that real diff and checks, never fabricates a Spur production change.

Concurrency observed during refinement: Spur main has other staged product/doc work and two A9/I33 worktrees; no main-corpus wip task was returned. The ts-libs main checkout was clean at ca3ddbacc7bd1b51bac2fe6bf211b8a395e5c088. Before implementation each owner rechecks ownership and uses a clean execution tree; these observations are not permission to overwrite current work.
