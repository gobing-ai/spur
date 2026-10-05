---
schema_version: 1
name: Identify history capabilities across native and converted agent formats
status: done
template: feature-impl
created_at: 2026-09-30T20:26:19.390Z
updated_at: "2026-10-05T18:22:32.239Z"
feature_id: E93
priority: P1
tags:
  - history
  - capabilities
estimate_hours: 14

done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1028-verdict.json
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

- [x] R1. Recognize explicit commands from verified source user envelopes without treating request intent as execution.
- [x] R2. Recognize model subagent delegation and retain native parent/child identity only when provided.
- [x] R3. Record explicit and implicit ordinary skill loads across verified source formats, with failed and unknown outcomes preserved.
- [x] R4. Preserve verifiable Superskill command/subagent origins through the additive importer-owned fact contract; retain unresolved historical identity honestly.
- [x] R5. Deduplicate correlated representations deterministically while preserving distinct repeat invocations and append-only replay.
- [x] R6. Exclude quoted examples, skill catalogs, tool-output wrappers, unrelated reads and unsafe dynamic tool expressions.
- [x] R7. Audit every registered source route and establish fixture-backed coverage for claude, codex, pi, omp, agy and grok, keeping deferred-source limits explicit.

### Acceptance Criteria

- [x] AC1 — Explicit user commands retain command identity (req: R1)
- [x] AC2 — Model delegation identifies subagents separately from user requests (req: R2)
- [x] AC3 — Ordinary skill loads include explicit and implicit use (req: R3)
- [x] AC4 — Converted capabilities preserve verifiable origin kinds (req: R4)
- [x] AC5 — Duplicate representations collapse without losing repeated invocations (req: R5)
- [x] AC6 — Quoted examples and unrelated tool reads produce no invocation (req: R6)
- [x] AC7 — Source coverage distinguishes verified extraction from unavailable evidence (req: R7)

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

**Scope statement:** the code diff for this task lives in `/Users/robin/xprojects/ts-libs` (the task-authorized upstream tree, per Background/Q&A: "The operator explicitly authorized necessary upstream enhancement" in packages/llm-jsonl-importer). The spur worktree intentionally carries **no code diff** — this task file is its only change. The additive fact contract implemented here is frozen in `docs/design/history-capability-detection.md:36` (`capability_kind` and companion fact columns, design sections 8.1–8.2).

**Change map (upstream `@gobing-ai/ts-llm-jsonl-importer`):**

- `sha256Text` — raw UTF-8 SHA-256 for content digests (distinct from the stableJson-based `sha256`). Evidence: @gobing-ai/ts-llm-jsonl-importer `src/hash.ts` line 32.
- New `capability.ts` — `validateCapabilityOrigins` (rejects malformed origin indexes before any write, schema included); `matchCapabilityOrigin` (name → path narrowing → digest; conflict/mismatch classifies unknown, never guesses); `capabilityInvocationId` (versioned domain-hash identity; correlated representations share one id); `parseLiteralReadTargets` (quote/token-safe `cat`/`sed -n '<range>p'` parsing; rejects expansions, redirections, escapes, quoted code); `extractNestedExecCommandLiterals` (strict `tools.exec_command({cmd: <literal>, ...})` shape, statement-start check, comment stripping, ordinal offset 1000+). Evidence: @gobing-ai/ts-llm-jsonl-importer `src/capability.ts` line 1.
- Capability types and transport — `CapabilityKind`, `CapabilityEvidenceKind`, `CapabilityOrigin`; `capabilityOrigins` on `ImportOptions` + `TransformContext`; four nullable fact fields + `_capabilityConflict` transport key on `SkillCall`/`SkillCallSplitRecord`. Evidence: @gobing-ai/ts-llm-jsonl-importer `src/types.ts` line 1.
- Schema — four nullable TEXT fact columns on `history_skill_call`; schema version `0.5.12` (digest pinned in tests). Evidence: @gobing-ai/ts-llm-jsonl-importer `src/schema-sql.ts` line 123.
- DAO — `ensureSkillCallCapabilityColumns` guarded ALTER-TABLE upgrade (idempotent; legacy rows NULL; absent-table no-op), `skillCallOutcomeUpdateOp` and `resolveSkillCallRows` DB-fallback pairing lookup later in the same file, typed columns + `_capabilityConflict` ignored key. Evidence: @gobing-ai/ts-llm-jsonl-importer `src/jsonl-importer-dao.ts` line 163.
- `extractSkillCalls` E93 rewrite: claude (Skill tool_use, Task delegation, Read on SKILL.md, Bash literal reads, command-expansion envelope with dedupe), pi/omp (signature wrapper loads + Read-family implicit loads), codex (`$`/`/` markers as requests — never capability-from-spelling — full-body `<skill>` blocks with trimmed-body digest, marker+wrapper correlation via shared invocation id, shell argv + nested literal reads), agy (`slash_command` native command requests gated on display payload, `INVOKE_SUBAGENT` delegation), gemini (request evidence; deferred-origin limit documented), grok (only natively-present inline status rides; absent stays unknown). Default row status `unknown`; `ok` only on verified harness injection or paired result.
- Importer wiring — origins validated before `applyHistoryImportSchema` (next statement): capability origins threaded into both transform contexts; per-run skill-row registration; result pairing (claude tool_result timing + `is_error`, omp/pi timing, codex `function_call_output` ⇒ ok) via in-run map then DB fallback for later-incremental arrival; `_capabilityConflict` surfaced as bounded (cap 10), deduplicated validation findings. Evidence: @gobing-ai/ts-llm-jsonl-importer `src/mappers.ts` line 134 and `src/importer.ts` line 215.
- Barrel exports for capability types and helpers. Evidence: @gobing-ai/ts-llm-jsonl-importer `src/index.ts` line 1.
- Package README — new "Skill-Call Capability Facts (E93)" section documenting the fact contract, origin index usage, and limits. Evidence: @gobing-ai/ts-llm-jsonl-importer `README.md` line 222.
- Remediation (test-fix hops, R6/AC6): quoted-signature exclusion grammar — `isQuotedSignatureContext` + `leadingInjectionMatch` (`src/mappers.ts` lines 453/487) reject complete wrapper/envelope shapes that are fenced, inline-quoted, or not at the text position real harness injections carry; after hop 2 the position invariant holds at all four seams (claude envelope, pi/omp wrappers, codex `<skill>` blocks via `isCodexWrapperLeadPosition`: text start, directly below a single invocation-marker line, or contiguous with an accepted block) with CommonMark fence-length matching (a 4-backtick outer fence is not closed by an inner ``` fence); repeat same-name codex wrappers get per-occurrence ordinals (distinct invocation ids, marker correlation preserved); codex `function_call_output` pairing reads structural failure signals (`metadata.exit_code` non-zero, explicit `is_error`/`error`) instead of unconditional ok. Evidence: @gobing-ai/ts-llm-jsonl-importer `src/mappers.ts` line 453 and `src/importer.ts` line 120.
- Tests — `tests/skill-call-import.test.ts` (34 tests: origin matrix absent/unique/conflict/digest-mismatch/matching, malformed-origins rejection, command expansion + dedupe, delegation, implicit reads incl. nested literals + argv, negatives, pairing same-event + later-incremental + idempotence), plus `tests/history-skill-call.test.ts` (guarded column upgrade), `tests/schema-version.test.ts` (`0.5.12` pin), `tests/mappers.test.ts` (field-map keys), `tests/importer.test.ts` (0063 agy fixture: native `slash_command` now yields a command row). Evidence: @gobing-ai/ts-llm-jsonl-importer `tests/skill-call-import.test.ts` line 1.
- OpenCode importer — audited only (additive compatibility: writes legacy columns; new facts NULL), per the WHERE contract; expansion deferred.

**Rationale:** logical capability kind (skill/command/subagent) is classified from authoritative native source identity first, then a unique digest-verified supplied origin, then null — never from name spelling or invocation restriction, so quoted examples and opaque expressions cannot fabricate invocations. The four fact columns are additive and nullable so legacy rows and unpaired attempts stay honest (`unknown` until a paired result or verified harness injection upgrades them), while `invocation_id` gives correlated representations (codex marker + wrapper) one stable identity without collapsing distinct repeats. Result pairing rides the existing per-run map plus a DB fallback so results arriving in later incremental runs upgrade the same event in place without touching the evidence hash.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Re-verified this run (force re-audit). Claude leading-envelope gate @gobing-ai/ts-llm-jsonl-importer `src/mappers.ts` line 398 (`leadingInjectionMatch(text, CLAUDE_COMMAND_NAME_ANCHORED)` — request evidence, never auto-execution); source dispatch claude/codex/pi/omp/agy/gemini/grok at `src/mappers.ts` lines 141-158 with default `[]`. Upstream suite green this run: `bun test` 398 pass / 0 fail in ts-libs/packages/llm-jsonl-importer. |
| R2 | MET | Model delegation separate from user requests; native identity retained only when provided. Suite green this run incl. claude Task tool_use delegation and agy INVOKE_SUBAGENT cases (tests/skill-call-import.test.ts). |
| R3 | MET | Explicit + implicit loads with failed/unknown outcomes: literal-read grammar @gobing-ai/ts-llm-jsonl-importer `src/capability.ts` line 286 (`parseLiteralReadTargets`), nested exec literals line 345 (`extractNestedExecCommandLiterals`); result pairing status derivation `src/importer.ts` lines 103/113 (`timing.isError ? 'error' : 'ok'`), codex `function_call_output` structural signals line 120; later-incremental DB fallback `src/jsonl-importer-dao.ts` line 200 (`resolveSkillCallRows`). Suite green this run. |
| R4 | MET | Four nullable fact columns @gobing-ai/ts-llm-jsonl-importer `src/schema-sql.ts` lines 126-129 (capability_kind/evidence_kind/invocation_id/origin_identity), schema version `0.5.12` line 7; pre-write validation before schema apply `src/importer.ts` lines 215-216 (`validateCapabilityOrigins` ahead of `applyHistoryImportSchema`); name→path→digest matching `src/capability.ts` line 83 (`matchCapabilityOrigin`, zero-match → undefined, never guessed); guarded idempotent column upgrade `src/jsonl-importer-dao.ts` lines 163-174 (`ensureSkillCallCapabilityColumns`). |
| R5 | MET | Deterministic dedupe + distinct repeats: versioned invocation identity @gobing-ai/ts-llm-jsonl-importer `src/capability.ts` line 119 (`capabilityInvocationId`); codex marker+wrapper correlation with per-occurrence ordinals `src/mappers.ts` lines 808-820. Idempotence/replay cases green in this run's suite. |
| R6 | MET | Quoted/fenced exclusion re-read at @gobing-ai/ts-llm-jsonl-importer `src/mappers.ts` lines 453/487 (quoted-signature context + leading-injection match) applied at the claude envelope seam line 398 comment ("fenced or quoted mid-text is an example, not a command (E93 R6)"); literal-only grammar rejects expansions/redirections `src/capability.ts` lines 286/345. Negative-signature tests green in this run's suite (398 pass). Known disclosed residual from prior verify (CommonMark-invalid fence closer, P3, ≤1 fabricated row) unchanged — not in this AC's named fixture classes. |
| R7 | MET | All six in-scope sources routed at @gobing-ai/ts-llm-jsonl-importer `src/mappers.ts` lines 141-158; gemini deferred as documented no-op (default `[]` line 156); capability fact contract documented `README.md` line 222 ("Skill-Call Capability Facts (E93)"); schema version pinned 0.5.12 (`src/schema-sql.ts` line 7); opencode additive-compat retained. Suite 398 pass / 0 fail this run. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — Explicit user commands retain command identity | MET | test | Upstream `bun test` 398 pass / 0 fail this run (claude envelope, agy slash_command, codex marker request cases in tests/skill-call-import.test.ts); envelope gate re-read at @gobing-ai/ts-llm-jsonl-importer `src/mappers.ts` line 398. |
| R2 — Model delegation identifies subagents separately from user requests | MET | test | Delegation cases green in this run's suite; request vs delegation rows distinct (prior fresh e2e recorded in task Testing; anchors re-read this run). |
| R3 — Ordinary skill loads include explicit and implicit use | MET | test | pi/omp wrapper loads, claude Read/Bash literal reads, codex argv + nested literal reads green in this run's suite; pairing upgrade (unknown → error via later-incremental function_call_output) covered by resolveSkillCallRows re-read at @gobing-ai/ts-llm-jsonl-importer `src/jsonl-importer-dao.ts` line 200. |
| R4 — Converted capabilities preserve verifiable origin kinds | MET | test | Origin matrix (absent/unique/conflict/digest-mismatch/malformed) green in this run's suite; contract re-read at @gobing-ai/ts-llm-jsonl-importer `src/capability.ts` line 83 and `src/importer.ts` lines 215-216. |
| R5 — Duplicate representations collapse without losing repeated invocations | MET | test | Correlation + ordinal + idempotent replay cases green in this run's suite; identity + ordinal code re-read at @gobing-ai/ts-llm-jsonl-importer `src/capability.ts` line 119 and `src/mappers.ts` lines 808-820. |
| R6 — Quoted examples and unrelated tool reads produce no invocation | MET | test | 14 quoted-signature regression tests incl. V1–V10 green in this run's suite (398 pass / 0 fail); exclusion seams re-read at @gobing-ai/ts-llm-jsonl-importer `src/mappers.ts` lines 398/453/487. |
| R7 — Source coverage distinguishes verified extraction from unavailable evidence | MET | test | All six sources exercised by suite fixtures this run; dispatch re-read at @gobing-ai/ts-llm-jsonl-importer `src/mappers.ts` lines 141-158; deferred-source limits documented `README.md` line 222. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-03T07:38:25.540Z todo → wip (system)
- 2026-10-03T15:04:46.800Z wip → testing (system)
- 2026-10-03T15:04:59.516Z testing → done (system)

