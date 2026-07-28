---
template: brainstorm
schema_version: 1
name: "Verify Claude and Codex prompt-cache and usage telemetry semantics"
description: ""
status: done
type: brainstorm
profile: standard
feature_id: H5
parent_wbs: null
priority: P1
tags: ["wayfinder:research", "workstream:cache", "source-driven"]
dependencies: []
created_at: "2026-07-18T17:29:34.855Z"
updated_at: "2026-07-28T00:32:38.357Z"
---

## 0281. Verify Claude and Codex prompt-cache and usage telemetry semantics

### Background

Type: wayfinder:research. Establish source-first facts for Claude Code/Anthropic and Codex/OpenAI cache behavior before stage envelopes or telemetry normalization are specified. Use official product/API documentation and locally observable history payloads only. Cover cache-eligible prompt structure, prefix sensitivity, minimums, lifetime, invalidation, reported usage fields, tool/system/message ordering, and limitations of CLI surfaces. Separate API facts from inferences about the coding-agent products and record version/date. The output is a provider capability matrix and a set of design constraints, not code.

### Requirements

- R1. Cite current official sources for every provider-specific cache and usage claim, with verification date and product/API scope.
- R2. Document cache eligibility, stable-prefix requirements, invalidation behavior, minimum token rules, lifetime/retention, and explicit cache controls where applicable.
- R3. Document exact provider usage fields for uncached input, cache creation/write, cache read, output, and any unavailable dimensions.
- R4. Verify which fields are preserved by Spur history import and which are currently folded or lost.
- R5. Identify differences between direct API semantics and Claude Code/Codex CLI observability; label inferences and unknowns.
- R6. Produce normalized terminology and mapping recommendations without hiding provider-specific distinctions.
- R7. State testable implications for stable context envelopes and campaign telemetry.

### Acceptance Criteria

Scenario: R2 Provider cache semantics are verified for Claude and Codex
Given current official Claude and OpenAI/Codex documentation and locally observable usage records
When cache behavior and telemetry semantics are researched
Then claims about cache eligibility, prefix stability, invalidation, lifetime, accounting fields, and platform limitations cite primary sources with access dates
And a normalized cross-platform usage schema maps only semantically equivalent fields
And unknown or unavailable fields remain explicit
And a minimal probe plan distinguishes documented behavior from locally verified behavior

Scenario: Cache evidence cannot silently inflate fresh input
Given provider records separately expose fresh input, cache read, or cache creation
When normalized metrics are calculated
Then raw fields are retained
And fresh/uncached input per verified PASS is calculated without folding cache-read tokens into fresh input
And any provider-specific total is labeled with its exact definition

### Q&A

- Locked: use current primary provider documentation and schemas; secondary summaries may help discovery but cannot support the final contract.
- Locked: Claude Code and Codex are the first live targets; other platforms receive structural compatibility checks only in this feature.
- Locked: cache-hit percentage is diagnostic, not the optimization objective.
- Locked: primary metric is fresh/uncached input tokens per verified PASS, guarded by total input plus output tokens per PASS and unchanged quality gates.
- Question to resolve: which Codex surfaces expose prompt-cache reads or equivalent usage today, and at what aggregation level?
- Question to resolve: do provider-reported input totals include cache reads/creation, and does the answer differ across API, CLI, or history exports?
- Question to resolve: which prompt-prefix mutations are under plugin control versus host-agent control?

### Design

Selected method: produce a source-backed provider matrix plus a normalized event schema. The matrix covers cache key/prefix rules, minimums, TTL/lifetime, invalidators, accounting fields, model support, observability surface, and known host-agent mediation. Each cell is classified `documented`, `locally observed`, `inferred`, or `unknown`.

The normalized schema should retain raw provider payloads and expose conservative fields such as `fresh_input_tokens`, `cache_read_tokens`, `cache_create_tokens`, `output_tokens`, `model`, `stage_id`, `run_id`, `verdict`, and provenance. Derived metrics must declare denominators and missing-data policy.

Rejected shortcuts: assuming API cache semantics exactly describe hosted coding-agent behavior; translating one provider’s field names by analogy; or backfilling missing cache fields from prompt-size estimates.

### Plan

1. Capture current official documentation and schema references with publication/access dates.
2. Inspect actual Claude Code and Codex history/usage artifacts available in this workspace without exposing secrets.
3. Define minimal repeated-prompt probes that vary stable prefix, dynamic suffix, tool output, model, and elapsed time while holding task semantics constant.
4. Reconcile documented and observed semantics; record discrepancies and environment constraints rather than forcing equivalence.
5. Specify normalized raw and derived fields, including nullability, confidence, and stage/run correlation requirements.
6. Hand the verified contract to baseline analytics, context-envelope design, routing telemetry, dogfood campaigns, and final synthesis.

### Solution

Research/specification contract verified 2026-07-18 against current primary provider documentation,
Claude Code 2.1.214 and Codex CLI 0.144.6 local history shapes, and the installed
`@gobing-ai/ts-llm-jsonl-importer@0.4.10`. No paid provider probe was issued; the qualification probe
is specified below for the implementation phase.

**Primary sources**

| Scope                                   | Source                                                                                                                                                                        | Accessed   | Confidence                                                |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------- |
| Anthropic cache behavior and accounting | [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) and [Messages API](https://platform.claude.com/docs/en/api/typescript/messages/create) | 2026-07-18 | HIGH                                                      |
| Claude Code machine output              | [CLI reference](https://docs.anthropic.com/en/docs/claude-code/cli-usage)                                                                                                     | 2026-07-18 | HIGH for JSON output; local/versioned for history payload |
| OpenAI cache behavior and accounting    | [Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)                                                                                                | 2026-07-18 | HIGH                                                      |
| Codex machine output                    | [Codex developer commands](https://developers.openai.com/codex/cli/reference)                                                                                                 | 2026-07-18 | HIGH for NDJSON output; local/versioned for usage payload |

**Provider mapping**

| Surface                               | Stable-prefix/cache contract                                                                                                                                                                                                                       | Raw usage → normalized fields                                                                                                                                                                              | Explicit unknowns                                                                                                                     |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Anthropic Messages API                | Exact prefix over `tools` → `system` → `messages`; model/platform minimums currently span 512–4,096 tokens; `cache_control` is automatic or explicit with 5m default and documented 1h TTL. Changes invalidate at their hierarchy level and below. | `fresh_input_tokens = input_tokens`; reads = `cache_read_input_tokens`; writes = `cache_creation_input_tokens`; total input = fresh + read + write; preserve `output_tokens` and TTL write breakdown.      | Claude Code controls host prompt assembly, model routing, and cache controls unless its surface exposes them.                         |
| OpenAI API                            | Exact prefix; automatic eligibility begins at 1,024 tokens. Model-family behavior differs: pre-GPT-5.6 automatic/retention controls versus GPT-5.6+ implicit/explicit breakpoints and documented minimum TTL.                                      | API total input includes cache reads: `fresh_input_tokens = input_tokens - cached_tokens`; reads = `cached_tokens`; GPT-5.6+ writes = `cache_write_tokens`; older-family writes are unavailable, not zero. | Eviction/routing and host-selected cache keys/breakpoints are not inferable from a Codex CLI task alone.                              |
| Claude Code 2.1.214 local JSONL       | Locally observed `message.usage`, not a documented stable history schema.                                                                                                                                                                          | Preserves Anthropic-named input/read/create/output fields in the raw row.                                                                                                                                  | API-equivalent aggregation is MEDIUM confidence until request-level correlation exists.                                               |
| Codex CLI 0.144.6 local rollout JSONL | Locally observed `event_msg` / `token_count`, not a documented stable history schema.                                                                                                                                                              | `input_tokens`, `cached_input_tokens`, `output_tokens`, `reasoning_output_tokens`, `total_tokens`; use `fresh = input - cached` with locally-observed provenance. Cache writes are unavailable.            | `codex exec --json` is documented as NDJSON, but the public command reference does not guarantee the complete per-event usage schema. |

**Spur preservation audit**

- `@gobing-ai/ts-llm-jsonl-importer@0.4.10/src/sources.ts:68` maps only flat identifiers,
  timestamps, content, role, and model; it does not map raw payload or provider usage.
- `@gobing-ai/ts-llm-jsonl-importer@0.4.10/src/importer.ts:183` constructs a new allowlisted object,
  so nested Claude/Codex usage is dropped before schema passthrough.
- `packages/domain/src/analytics/query.ts:74` only reads a hypothetical top-level Claude-style
  `usage`, then sums fresh/read/write into one `inputTokens`, losing the primary distinction.
- Fresh dry-runs over locally selected files (aggregate output only) produced
  `claude: processed=150 imported=2 validation=148` and
  `codex: processed=65 imported=0 validation=65`. Current runtime support is therefore absent, not
  merely lossy; repair belongs to the dependency-ordered implementation backlog.

**Normalized contract**

Retain a redacted `provider_usage_json` plus provider/surface/version/event type, model, timestamp,
session, stage/run/verdict correlation, nullable fresh/read/write/output/reasoning/total fields,
mapping version, evidence kind (`documented`, `locally-observed`, `inferred`, `unknown`), confidence,
and missing-data reason. Null means unavailable; zero means measured zero. Reject negative fresh input,
inconsistent totals, missing raw usage, and silent null-to-zero coercion. The primary campaign metric is
`sum(fresh_input_tokens) / verified_PASS_count`, segmented by provider/surface/model/version; cache-hit
percentage remains diagnostic.

**Minimal qualification probe**

1. Record model/API/CLI versions and build a deterministic prefix above each model's documented
   minimum with stable system/tool content and a dynamic suffix after the intended breakpoint.
2. Execute cold A, identical-prefix B inside TTL, suffix-only C, then vary exactly one of system byte,
   tool schema/order, model, cache key/breakpoint, and elapsed time beyond TTL.
3. Capture raw provider usage and repeat the semantic task through `claude -p --output-format json`
   and `codex exec --json`; label host assembly/control as unknown unless directly observable.
4. Dry-run/import the files and assert zero validation errors, retained redacted raw usage, correct
   provider-specific formulas, explicit unavailable fields, and deterministic stage/run/PASS joins.
5. Accept lower fresh input only when all existing quality gates still PASS.

The expanded working matrix and command evidence remain in
`.spur/run/wayfinder-O/implementation-evidence.md:9`; this task section is the durable corpus summary.

### Testing
Coverage: N/A (research/specification change; no runtime code path added). Focused existing analytics
coverage remained 100% lines/functions for `packages/domain/src/analytics/query.ts`.

**Per-Requirement Traceability (re-verify 0281, 2026-07-18)**

| Req | Status | Evidence |
|---|---|---|
| R1 | MET | Current official Anthropic/OpenAI API and Claude Code/Codex command sources, access date, scope, and confidence are recorded in `docs/tasks2/0281_verify-claude-and-codex-prompt-cache-and-usage-telemetry-sem.md:86`. |
| R2 | MET | Provider mapping at `docs/tasks2/0281_verify-claude-and-codex-prompt-cache-and-usage-telemetry-sem.md:94` covers eligibility, exact-prefix ordering, invalidation, model-specific minimums, TTL/retention, and explicit/automatic controls without projecting API controls onto CLI hosts. |
| R3 | MET | The provider table maps Claude fresh/read/write/output and OpenAI total/cached/write/output semantics, including unavailable OpenAI-family/Codex write dimensions, at `docs/tasks2/0281_verify-claude-and-codex-prompt-cache-and-usage-telemetry-sem.md:96`. |
| R4 | MET | Static audit anchors importer allowlisting and analytics folding; fresh dry-runs found Claude `150/2/148` processed/imported/validation and Codex `65/0/65`, recorded at `docs/tasks2/0281_verify-claude-and-codex-prompt-cache-and-usage-telemetry-sem.md:103`. |
| R5 | MET | API facts are marked documented; Claude Code 2.1.214 and Codex CLI 0.144.6 payloads are marked locally observed/version-scoped; host prompt assembly/routing remains explicit unknown. |
| R6 | MET | The normalized contract retains raw usage and separates nullable fresh/read/write/output/reasoning/total fields with mapping version, evidence kind, confidence, and missing-data reason at `docs/tasks2/0281_verify-claude-and-codex-prompt-cache-and-usage-telemetry-sem.md:116`. |
| R7 | MET | The five-step qualification probe and reject/quality constraints at `docs/tasks2/0281_verify-claude-and-codex-prompt-cache-and-usage-telemetry-sem.md:126` are executable implications for context envelopes and campaign telemetry. |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|---|---|---|---|
| Scenario: R2 Provider cache semantics are verified for Claude and Codex | MET | command | `bun -e <0281 contract assertion>` exited 0: `0281 contract assertions: PASS (8 checks)`; official docs were opened on 2026-07-18 and local payload keys were extracted without content/secrets. |
| Scenario: Cache evidence cannot silently inflate fresh input | MET | command | Contract assertion verified raw-retention/null semantics and both provider formulas; dry-runs proved current import loss explicitly rather than treating it as zero; `bun test packages/domain/tests/analytics/query.test.ts` exited 0 with 19 pass, documenting current folding behavior as implementation debt. |

**Discrete checks**

| Check | Status | Evidence |
|---|---|---|
| design-conformance | pass | Source-backed provider matrix, conservative normalized schema, explicit unknowns, and probe plan implement the selected Design; no rejected shortcut was used. |
| scope-creep | pass | Durable task Solution + standalone Testing/verdict artifacts only; runtime importer repair remains in the implementation backlog. |
| evidence-rule-pass | pass | Both behavior-bearing AC rows have fresh command evidence from this run. |
| security | pass | Local JSONL inspection emitted only key names and aggregate token/import counts; no prompt content, credentials, or raw payload was copied. |
| efficiency | pass | Targeted local files and one focused test were used before the broad repository gate. |
| correctness | pass | Provider formulas retain different meanings; null is not zero; fresh input never includes cache reads. |
| usability | pass | Mapping, evidence class, confidence, and missing-data rules are explicit. |
| architecture | pass | Task produces a contract, not an out-of-scope importer workaround; app/domain runtime ownership remains unchanged. |
| strict-core | pass | `bun run apps/cli/src/index.ts task check 0281 --strict-core --json` returned `pass: true` before Testing refresh; only warning-level coverage/feature-AC findings remained. |

**Fresh command evidence**

- `bun -e <0281 contract assertion>` → `0281 contract assertions: PASS (8 checks)`.
- `bun test packages/domain/tests/analytics/query.test.ts` → 19 pass, 0 fail; query module 100% functions/lines.
- Claude importer dry-run → processed 150, imported 2, validation errors 148, checkpoint updates 0.
- Codex importer dry-run → processed 65, imported 0, validation errors 65, checkpoint updates 0.

Verdict: PASS
### Review

| Priority | Finding                                                                      | Disposition                                                                          |
| -------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| P1       | No unresolved implementation blocker in this specification artifact.         | Implementation is deferred to the synthesized build backlog.                         |
| P2       | Provider/platform evidence may remain unavailable for some telemetry fields. | Preserve explicit unavailable/estimated labels and re-qualify during implementation. |
| P3       | CLI dependency mutation remains a known follow-up surface.                   | Track through WBS 0290 and the implementation backlog.                               |
| P4       | Documentation and compatibility details may evolve during build.             | Recheck authoritative docs during implementation review.                             |

Review outcome: PASS for specification readiness. The evidence artifact provides the implementation handoff; runtime implementation and coding review belong to the dependency-ordered tasks produced by WBS 0291.

### References

- Official Anthropic prompt caching, usage, and Claude Code documentation current at execution time
- Official OpenAI prompt caching, usage, and Codex documentation current at execution time
- Local history/analytics parsing code that currently normalizes Claude token fields
- Task 0139: prior cache-proof limitation and terminology guardrail
- Ticket 0280 baseline schema and raw observations
- Feature O scenarios R1, R2, R5, R6, R8, and R12

### History

- 2026-07-18T18:24:07.100Z todo → done (system)
- 2026-07-18T18:27:40.087Z done → todo (system)
- 2026-07-18T18:35:15.434Z todo → done (system)
- 2026-07-18T18:37:50.325Z done → todo (system)
- 2026-07-19T02:50:03.736Z todo → wip (system)
- 2026-07-19T02:50:12.793Z wip → testing (system)
- 2026-07-19T03:36:38.076Z testing → done (system)
