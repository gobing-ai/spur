---
schema_version: 1
name: Identify history capabilities across native and converted agent formats
status: todo
template: feature-impl
created_at: 2026-09-30T20:26:19.390Z
updated_at: "2026-09-30T20:47:29.119Z"
feature_id: E93
priority: P1
tags:
  - history
  - capabilities
estimate_hours: 14

---

## 1028. Identify history capabilities across native and converted agent formats

### Background

The current importer loses the distinction between logical capability kind and its representation. Codex full-body wrappers and pi implicit file reads demonstrate missing evidence paths. This task is the cohesive upstream extraction deliverable for E93 R1–R7, implemented in /Users/robin/xprojects/ts-libs/packages/llm-jsonl-importer. The operator explicitly authorized necessary upstream enhancement. Schema, normalization, mappers and their fixtures must be reviewed together; estimate 14h exceeds the preferred 8h but remains below the 16h forced split ceiling. Splitting these into seven source or schema tasks would repeat ownership decisions and tests. Installed importer facts and upstream fixture locations are cited in the accepted design.

**Refine corrections (2026-09-30)**
- Original origin-resolution instruction left discovery to the implementer → Superskill adapt-command/adapt-subagent and install-manifest source do not expose a universal entity-kind field → freeze supplied digest-verified CapabilityOrigin input and null fallback in design section 8.1; no Superskill implementation work.
- Original logical fields allowed substitution and result handling was unspecified → mapper/DAO typed column lists and per-record split callers must evolve together; later results already use a source/session/call-id import map → freeze four nullable fact columns, complete caller list, stable identity, result pairing and incremental DB lookup.
- Original design treated Skill/file transport as sufficient to classify ordinary skills → command/subagent adapters share that transport → use native source identity, then unique artifact-digest origin, then unknown; never infer logical kind from a prefix or invocation restriction.
- Original temporal plan did not pin timestamps or per-bucket duplicate treatment → skillRecord starts with null timestamps and skillCallRollup excludes null started_at → retain native/parent event time, never imported_at, and preserve unknown-time coverage.
- Original verification named no executable observation homes → existing real-importer fixture/DAO tests and APIs were located in the authorized clean upstream checkout → name test files and expected cases; do not mock the classifier under test.

### Requirements

- [ ] R1. Recognize explicit commands from verified source user envelopes without treating request intent as execution.
- [ ] R2. Recognize model subagent delegation and retain native parent/child identity only when provided.
- [ ] R3. Record explicit and implicit ordinary skill loads across verified source formats, with failed and unknown outcomes preserved.
- [ ] R4. Preserve verifiable Superskill command/subagent origins through the additive importer-owned fact contract; retain unresolved historical identity honestly.
- [ ] R5. Deduplicate correlated representations deterministically while preserving distinct repeat invocations and append-only replay.
- [ ] R6. Exclude quoted examples, skill catalogs, tool-output wrappers, unrelated reads and unsafe dynamic tool expressions.
- [ ] R7. Audit every registered source route and establish fixture-backed coverage for claude, codex, pi, omp, agy and grok, keeping deferred-source limits explicit.

### Acceptance Criteria

- [ ] AC1 — Explicit user commands retain command identity (req: R1)
- [ ] AC2 — Model delegation identifies subagents separately from user requests (req: R2)
- [ ] AC3 — Ordinary skill loads include explicit and implicit use (req: R3)
- [ ] AC4 — Converted capabilities preserve verifiable origin kinds (req: R4)
- [ ] AC5 — Duplicate representations collapse without losing repeated invocations (req: R5)
- [ ] AC6 — Quoted examples and unrelated tool reads produce no invocation (req: R6)
- [ ] AC7 — Source coverage distinguishes verified extraction from unavailable evidence (req: R7)

Verification lens: Exercise the real runJsonlImport and typed DAO/schema test homes named in Design. Positive/negative source signatures, exact origin matching, null fallback, timestamps, idempotence and later-result pairing must be observable in persisted rows.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-30T20:27:30.208Z

Closed decisions: use the existing upstream importer and its schema owner; source envelopes are decoded before classification. The operator authorized necessary changes in /Users/robin/xprojects/ts-libs. Keep the logical three-kind taxonomy independent of user/model invoker and request/load/delegation evidence. Unknown historical origin or opaque nested-tool expressions stay explicit coverage limits. Current manifest metadata cannot prove changed historical identity. This task prepares tested upstream changes; lockstep release remains the upstream operator-run process.

#### Q&A entry — 2026-09-30T20:47:29.118Z

Ready-depth closure: producer columns and type/input names are frozen in design 8.1; event identity, result pairing, timestamps and literal grammar in 8.2. Superskill metadata absence is resolved by supplied exact-digest origin indices or null; no upstream Superskill changes are required. Keep extraction work cohesive because mapper/schema/DAO changes share the same review. Publication remains the ts-libs operator-run process. No unresolved design choice remains; fixture-supported format gaps use the specified unsupported behavior.

### Design

Implement E93 R1–R7 in /Users/robin/xprojects/ts-libs/packages/llm-jsonl-importer. Frozen contract: docs/design/history-capability-detection.md sections 8.1–8.2 and the per-agent matrix in 4.6. WHAT/WHY: extend the existing source-normalization, split and typed fact pipeline because it already owns canonical evidence and hashes; no Spur parser, new table, new package or automatic filesystem-origin resolver.

Frozen names:
- Four nullable TEXT fact columns: capability_kind, evidence_kind, invocation_id, origin_identity; existing invocation_kind remains user/model and existing status uses ok/error/unknown for new evidence.
- Export CapabilityKind, CapabilityEvidenceKind and interface CapabilityOrigin; optional ImportOptions.capabilityOrigins and TransformContext.capabilityOrigins carry the validated readonly index through existing split callers. Shape and digest matching are fixed in section 8.1. No new Spur command/flag.
- Keep canonicalizeSkillName, extractSkillCalls, skillCallEntry, runJsonlImport and the existing source split entrypoints. Extend both mapper and DAO typed columns, SkillCall/SkillCallSplitRecord, schema application/version and barrel exports together.

Algorithm:
1. Decode source envelope, role, content blocks and JSON arguments; match actual source command/user injection, skill read/load, or native delegation records.
2. Classify by authoritative native identity, then unique digest-verified supplied origin, then null. Conflicting/missing historical origin never becomes a guessed ordinary skill or subagent.
3. Derive versioned invocation_id from authoritative invocation/call identity, then record identity/local ordinal, then source_file/source_line/local ordinal. Never correlate names or timestamps across messages.
4. Persist immutable evidence with native or parent-message started_at and stable redacted identity; record requests and unpaired calls as unknown.
5. Pair later results by source/session/call-id, using the existing per-run map plus DB fallback across incremental runs. Status/completed_at/duration are import-owned derived values excluded from the evidence hash; update the same event on result arrival. A verified complete injected body is a successful load; delegation ok means dispatch accepted, not child completed.
6. Recognize only the literal shell/nested-tool grammar frozen in section 8.2; never evaluate transcript code. Retain every other current source path and deferred labels.

WHERE/callers: src/mappers.ts (all extractSkillCalls callers and per-source split normalization), src/types.ts, src/schema-sql.ts, src/jsonl-importer-dao.ts typed columns/inserts, src/importer.ts context/hash/result pairing, src/hash.ts only if required for the skill-specific immutable payload, src/index.ts, and affected source definitions. Audit src/opencode-importer.ts's separate existing skill path for additive compatibility, without promising expanded full-fidelity support. Update package README and existing upstream API/schema docs for the new optional input.

Observability: tests/skill-call-import.test.ts exercises runJsonlImport with real fixtures for claude/codex/pi/omp/agy/grok, full-body wrappers, array/string content, serialized arguments, literal nested calls and negative forms. tests/history-skill-call.test.ts plus schema-sql.test.ts prove columns, null legacy values and standalone upgrade. tests/importer.test.ts and forensic-contract.test.ts prove idempotence, append-only result arrival and linkage. A direct extractSkillCalls mock cannot prove extraction.

Handoff to 1029: verified upstream revision, actual schema version, exact exported API, fixture-backed per-source supported/unsupported signature matrix and gate receipts. Publication is operator-run; leave package availability explicit until verified. Handoff to 1030: full-mode/reconciliation and cross-run result fixture evidence. Separate real upstream source commits and task evidence; no invented Spur source diff. Step 0 verifies a clean owned upstream execution tree and package provenance. Recorded checkout at refinement was clean at ca3ddbacc7bd1b51bac2fe6bf211b8a395e5c088; recheck before editing. Time budget 14h; preserve partial fixtures/proof at the boundary rather than broaden scope. Non-goals: new Superskill APIs, general JS parsing/execution, prefix-origin guesses, remote sync and live history mutation.

### Plan

1. (R1–R7) Recheck ts-libs AGENTS.md, clean-tree ownership, package/lockfile version and caller inventory. Reproduce existing extraction tests before changing the producer; retain current supported paths.
2. (R4) Implement section 8.1's exact additive schema/types/typed-column/export contract and validated CapabilityOrigin option propagation. Test absent, exact-match, conflicting, mismatched-digest and historical-no-origin cases.
3. (R1, R3, R6, R7) Decode each source envelope and implement the fixed explicit/native/literal-read signatures with full-body Codex and pi content variants. Document unsupported formats rather than accept arbitrary prose.
4. (R2, R3, R5) Implement stable invocation identity, native/parent timestamps and source/session/call-id result pairing; verify success/error/unknown, distinct repeated calls and results arriving in a later incremental run.
5. (R1–R7) Extend named real-importer/DAO tests with positive/negative/malformed signatures, quoted or commented nested code, no origin inference, duplicate representations, unknown time and legacy schema behavior. Preserve other-source import behavior.
6. (R1–R7) From the importer workspace run focused Bun tests and package lint/typecheck; then upstream AGENTS.md full spur-check/build gates. Update owning upstream API/package docs and prepare separate repository commits.
7. (R1–R7) Record revision/schema/API/support matrix and check receipts for 1029/1030. An unavailable operator-run release stays an explicit downstream execution dependency, never a claimed published version.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
