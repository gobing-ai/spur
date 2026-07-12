---
template: feature-impl
schema_version: 1
name: "Tool Using hooks: expand matchers to Bash/Grep/Glob with redaction"
description: ""
status: done
type: task
profile: standard
feature_id: J
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-12T22:48:21.764Z"
updated_at: "2026-07-12T23:04:17.076Z"
---

## 0248. Tool Using hooks: expand matchers to Bash/Grep/Glob with redaction

### Background
## Why

Token ledger only records Read/Write/Edit. Daily agent work is dominated by Bash and search tools.
Expand capture with **redaction** so the Tool Using board reflects real sessions without dumping
secrets or multi-MB stdout.

## Goal

Widen PostToolUse matcher to **Bash|Grep|Glob|Read|Write|Edit**, normalize event `type`/`summary`
fields, cap/redact large payloads; depends on **0246** field/token conventions.

## Source

Brainstorm Task C.
### Requirements
- [ ] R1. Update `hooks.json` PostToolUse matcher to `Bash|Grep|Glob|Read|Write|Edit` (and
      context-post-tool allowlist).
- [ ] R2. Event typing: map tools to `type` values (`bash`, `grep`, `glob`, keep `read`/`write`)
      and store a short **summary** (command truncated, pattern, path glob) — not full stdout by
      default.
- [ ] R3. **Redaction**: cap stored text (e.g. 2–4 KiB); strip obvious secret patterns; never log
      full env dumps.
- [ ] R4. Token estimate for Bash uses stdout/stderr length after cap; Grep/Glob use result size or
      null.
- [ ] R5. Tool Using table shows summary in File/Command column (header may become **Target** or
      keep File with title=summary) — document UX choice.
- [ ] R6. Tests for each tool payload shape; redaction unit tests.
- [ ] R7. Docs: indexed-context skill + design §7.8b tool set.
- [ ] R8. Out of scope: matcher `*` all tools; MCP tool names without allowlist.
### Acceptance Criteria
```gherkin
Feature: Expanded tool-use ledger capture

  @core
  Scenario: R1 Bash tool is logged
    Given SessionStart has created .session.json
    When a Bash PostToolUse fires with command "ls -la"
    Then token-ledger gains a bash event with a truncated command summary

  @core
  Scenario: R2 Grep and Glob are logged
    Given an active session
    When Grep and Glob tools complete
    Then ledger contains grep and glob events without full file dumps

  @core
  Scenario: R3 Large stdout is capped
    Given Bash tool_response exceeds the redaction cap
    When the event is recorded
    Then stored summary/tokens reflect the cap not the full output

  @edge
  Scenario: R4 Unknown tools still fail open
    Given matcher does not include ToolX
    When ToolX runs
    Then context-post-tool exits 0 without writing
```
### Q&A
| Q | A |
| --- | --- |
| Depends on | 0246 |
| Tools | Bash, Grep, Glob + R/W/E |
| Full stdout | No — cap/redact |
| All tools | Out of scope |
### Design
## Chosen approach

Widen allowlist + structured summary fields; reuse token cascade from 0246.

Privacy default: **summary over body**.
### Plan
1. [ ] Extend context-post-tool allowlist + summary builders
2. [ ] Update hooks.json matcher
3. [ ] UI column for summary/target
4. [ ] Tests + skill/design docs
### Solution
| File:line | What / why |
| --- | --- |
| `plugins/sp/hooks/hooks.json:18` | PostToolUse matcher → `Bash\|Grep\|Glob\|Read\|Write\|Edit` |
| `plugins/sp/hooks/context-post-tool.ts:1-300` | Allowlist, `mapToolType`, `buildToolSummary`, `scrubSecrets`/`redactText`/`cappedByteLength` (4 KiB); Bash/Grep/Glob ledger events with `summary` only |
| `plugins/sp/hooks/token-estimate.test.ts:1-120` | Unit tests for redaction, summary, Bash/Grep/Glob token cascade |
| `plugins/sp/hooks/context-hooks.test.ts:174-260` | Integration: bash/grep/glob log; large stdout capped; ToolX fail-open |
| `packages/app/src/services/token-ledger-service.ts:15-40,96-98,220` | Parse `summary`; sparse treats bash/grep/glob as activity |
| `packages/app/tests/services/token-ledger-service.test.ts` | summary parse + sparse with bash rows |
| `apps/web/src/modules/observability/ToolUsingTab.tsx` | **Target** column (file basename or summary); type badges; sparse set |
| `apps/web/tests/modules/observability/components.test.tsx:863-866` | Header Target order |
| `docs/04_DESIGN.md:907-930` | §7.8b capture tools, redaction, Target column |
| `plugins/sp/skills/indexed-context/SKILL.md:135-160` | Matcher + privacy + example bash/grep/glob lines |

**Why:** Widen PostToolUse capture so Tool Using reflects real sessions (Bash/search) without logging full stdout or secrets.
### Testing
**Commands (re-verify --force, this turn)**

```
bun test plugins/sp/hooks/context-hooks.test.ts \
  plugins/sp/hooks/token-estimate.test.ts \
  packages/app/tests/services/token-ledger-service.test.ts \
  apps/web/tests/modules/observability/components.test.tsx
→ 80 pass, 0 fail (317 expect calls)
```

Coverage: redaction/summary/token helpers unit-tested; hook integration covers Bash/Grep/Glob + fail-open; service parses `summary`; UI Target column.

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 Matcher + allowlist | MET | `hooks.json:18` `Bash\|Grep\|Glob\|Read\|Write\|Edit`; `context-post-tool.ts:26,261` `ALLOWED_TOOLS` |
| R2 Types + summary | MET | `mapToolType`/`buildToolSummary` `:123-165`; event.summary `:284`; tests `context-hooks.test.ts:174-216` |
| R3 Redaction | MET | `scrubSecrets`/`redactText` 4 KiB `:74-104`; body never written; `token-estimate.test.ts:26-41` |
| R4 Tokens after cap | MET | Bash/Grep/Glob use `cappedByteLength` `:205-212`; test `:100-105` + hooks `:223-241` (20k → 1024 tokens) |
| R5 Target column | MET | `ToolUsingTab.tsx:290,368-371` Target + formatTarget; UI test `:863-866` |
| R6 Tests | MET | 80 pass this turn across hooks unit + integration + service + UI |
| R7 Docs | MET | `docs/04_DESIGN.md:907-930` §7.8b; `indexed-context/SKILL.md:139-154` |
| R8 Out of scope | MET | no `*` matcher; ToolX fail-open `context-hooks.test.ts:246-260` |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| Scenario: R1 Bash tool is logged | MET | test | `context-hooks.test.ts:174-191` type=bash summary=`ls -la` |
| Scenario: R2 Grep and Glob are logged | MET | test | `context-hooks.test.ts:194-220` grep/glob summaries, no file dumps |
| Scenario: R3 Large stdout is capped | MET | test | `context-hooks.test.ts:223-241` 20k body → tokens 1024; body absent from JSONL |
| Scenario: R4 Unknown tools still fail open | MET | test | `context-hooks.test.ts:246-260` ToolX exit 0, ledger unchanged |

**Design conformance:** DONE — widen allowlist + summary-over-body privacy; 0246 token cascade reused with cap for Bash/search.

**SECUA (--focus all)**

| Sev | Finding |
| --- | --- |
| — | No blockers / majors |
| minor | Secret scrub is pattern-based (not a full DLP); intentional for local ledger |
| advisory | session_end totals still only count read/write row kinds (bash tokens still sum into totals.tokens) |

Security: fail-open, no hook HTTP, no full stdout, allowlist-only. Correctness: exclusive allowlist + empty-summary skip. Usability: Target column documents file vs summary. Architecture: logic stays in hook + thin parse/UI.
### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Depends on **0246**
- Sibling **0247**
- Parent **0245**
- `plugins/sp/hooks/hooks.json`, `context-post-tool.ts`
- Brainstorm: `docs/plans/2026-07-12-tool-using-followup-0245-brainstorm.md`
### History
- 2026-07-12T23:01:02.927Z todo → wip (system)
- 2026-07-12T23:03:04.527Z wip → testing (system)
- 2026-07-12T23:03:23.039Z testing → done (system)
