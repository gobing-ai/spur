---
template: brainstorm
schema_version: 1
name: "Verify Claude and Codex prompt-cache and usage telemetry semantics"
description: ""
status: todo
type: brainstorm
profile: standard
feature_id: O
parent_wbs: null
priority: P1
tags: ["wayfinder:research", "workstream:cache", "source-driven"]
dependencies: []
created_at: "2026-07-18T17:29:34.855Z"
updated_at: "2026-07-18T18:28:06.719Z"
---

## 0281. Verify Claude and Codex prompt-cache and usage telemetry semantics

### Background

Type: wayfinder:research. Establish source-first facts for Claude Code/Anthropic and Codex/OpenAI cache behavior before stage envelopes or telemetry normalization are specified. Use official product/API documentation and locally observable history payloads only. Cover cache-eligible prompt structure, prefix sensitivity, minimums, lifetime, invalidation, reported usage fields, tool/system/message ordering, and limitations of CLI surfaces. Separate API facts from inferences about the coding-agent products and record version/date. The output is a provider capability matrix and a set of design constraints, not code.

### Requirements
R1. Cite current official sources for every provider-specific cache and usage claim, with verification date and product/API scope.
R2. Document cache eligibility, stable-prefix requirements, invalidation behavior, minimum token rules, lifetime/retention, and explicit cache controls where applicable.
R3. Document exact provider usage fields for uncached input, cache creation/write, cache read, output, and any unavailable dimensions.
R4. Verify which fields are preserved by Spur history import and which are currently folded or lost.
R5. Identify differences between direct API semantics and Claude Code/Codex CLI observability; label inferences and unknowns.
R6. Produce normalized terminology and mapping recommendations without hiding provider-specific distinctions.
R7. State testable implications for stable context envelopes and campaign telemetry.
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
Execution status: reopened. Prior charting/specification artifacts exist, but implementation/resolution work has not been completed. The task contract is in the corresponding WBS file under `docs/tasks2/:1`; Feature O is defined in `docs/features/O_sp-plugin-token-efficient-reliable-execution-architecture.md:1`; the reusable driver is `config/workflows/wayfinder-resolution.yaml:1`. Continue execution through the workflow before claiming completion. No plugin implementation has been changed yet.
### Testing
Not complete — only structural checks have run. `spur task check` and `spur workflow validate config/workflows/wayfinder-resolution.yaml` pass for the current artifacts, but no implementation/resolution evidence has been produced yet. Re-run substantive verification after execution.
### Review
| Priority | Finding | Disposition |
|---|---|---|
| P1 | No unresolved implementation blocker in this specification artifact. | Implementation is deferred to the synthesized build backlog. |
| P2 | Provider/platform evidence may remain unavailable for some telemetry fields. | Preserve explicit unavailable/estimated labels and re-qualify during implementation. |
| P3 | CLI dependency mutation remains a known follow-up surface. | Track through WBS 0290 and the implementation backlog. |
| P4 | Documentation and compatibility details may evolve during build. | Recheck authoritative docs during implementation review. |

Review outcome: OPEN — the prior status transition was reversed because implementation/resolution evidence is still missing. Re-review after the task's workflow execution completes.
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
