---
schema_version: 1
name: Redact quoted JSON credentials before persisting tool summaries
status: todo
template: feature-impl
created_at: 2026-10-10T07:29:39.093Z
updated_at: "2026-10-10T16:29:42.554Z"
feature_id: H21

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 3
---

## 1158. Redact quoted JSON credentials before persisting tool summaries

### Background

scrubSecrets misses quoted JSON keys, persisting plaintext password and token values in token-ledger.jsonl Evidence: `plugins/sp/hooks/context-post-tool.ts:93` and `plugins/sp/hooks/context-post-tool.ts:316`. Review a71c confirmed this using buildToolSummary with curl JSON password and token fields, using synthetic credential values only. Separate direct fixes already corrected gate-lock diagnostics, absolute file.read paths, and resumed-run analytics. This task carries task-local regression scenarios below feature ship criteria.

**Refine corrections (2026-10-10)**
- Current scrubSecrets generic key matcher at context-post-tool.ts:93 requires the separator immediately after the bare key, so a closing JSON key quote prevents matching. A synthetic buildToolSummary probe reproduced the leak (boolean-only output, no actual credentials).
- Tests live at plugins/sp/hooks/token-estimate.test.ts and context-hooks.test.ts, not plugins/sp/tests/hooks. The shared recorder also serves hooks/pi/guard-extension.ts, and scrubSecrets is shared by cappedByteLength/redactText.
- Hook adapters are Superskill-owned installation outputs; there is no tracked context-post-tool.mjs twin to hand-edit. Keep source hooks builtin/relative only and verify the existing portable hook path.

### Requirements

- [ ] R1. Recognize quoted sensitive keys and redact complete quoted values, including escaped quotes, before summary truncation and ledger persistence
- [ ] R2. Existing assignment, provider-token and authorization redaction remains effective and harmless command context remains readable
- [ ] R3. Add the reproducing regression and validate the affected callers through the existing test seams.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Reproducing edge case is safe (req: R1, R3)
  Given a tool command containing JSON password, token and API-key fields with spaces and escaped quotes
  When a tool summary is built and persisted
  Then neither the returned event nor ledger bytes contains the synthetic credential values

Scenario: AC2 — Existing behavior remains supported (req: R2, R3)
  Given existing assignment and provider-prefix secret samples
  When the existing supported operation executes
  Then Existing assignment, provider-token and authorization redaction remains effective and harmless command context remains readable
```

### Q&A

- Closed: preserve JSON key context and redact the complete escape-aware quoted value before caps. Incomplete sensitive strings redact to end.
- Closed: use synthetic secrets in both helper and raw-ledger assertions; do not persist real credentials or rewrite historical ledgers.
- Closed: newly scrubbed byte lengths may change token estimates through the existing cascade; this is expected, not a token-accounting redesign.
- Closed: actual tests are under hooks/, and installed platform adapters remain Superskill-owned.

### Design

**Chosen fix / no new API.** Extend scrubSecrets in plugins/sp/hooks/context-post-tool.ts, before the existing generic bare key=value pass, with a quoted-JSON-field pass. Match double-quoted case-insensitive sensitive keys using the existing key family (optional namespace prefixes, api_key/api-key/apiKey, password/passwd, secret, token, access_key, private_key) plus authorization. Preserve the matched key and colon/spacing, replace the entire double-quoted value with "***". Scan JSON string escapes as one unit: an escaped quote or backslash is value content, never a terminator. Redact an unterminated sensitive string through end-of-input, including a trailing lone backslash, so malformed/truncated tool commands cannot leak a suffix. A compact escape-aware regex with a callback is sufficient; no full-command JSON.parse, parser dependency, recursive object walk or exported helper. Do not overmatch harmless keys such as token_count or filenames. Single-quoted shell wrapping of valid JSON needs no separate parser; its internal JSON double quotes remain visible.

**Ordering / callers.** scrubSecrets still runs on full summary text before REDACTION_CAP_BYTES / SUMMARY_MAX_CHARS truncation, and before storage. Keep assignment/provider/Bearer/Authorization/PEM/base64 passes and byte-safe truncation. No raw response or environment dump is persisted. Token estimates continue using the existing cascade and scrubbed length; do not assert identical numeric estimates for newly redacted input, because removing the leaked bytes correctly changes that estimate.

**Test matrix.** Add unit pins in plugins/sp/hooks/token-estimate.test.ts for password/token/API-key quoted fields, whitespace, case, nested/repeated fields, spaces, escaped quotes/backslashes, empty strings and incomplete strings. Synthetic markers include distinct prefix and suffix around an escaped quote; assert both disappear so a partial-value regex fails. Negative cases retain harmless command context and unrelated JSON keys. Test secret crossing both the 200-char summary limit and 4096-byte cap. Through recordToolUseEvent seed a temporary .session.json, call the real recorder and assert neither returned event nor raw token-ledger.jsonl bytes contain any marker or escaped suffix; use synthetic values only. Keep existing redaction/token cascade tests and add a pi tool_result shared-recorder pin if its current tests do not observe the summary path. Restore fixtures in finally.

**Scope/owners.** Hook source and existing hooks/token-estimate.test.ts, context-hooks.test.ts or pi/guard-extension.test.ts where needed. No new schema, dependency, public surface, unrelated event family or historical-ledger rewrite. 1159 owns pointer ownership in neighboring hooks; serialize changes but no logical prerequisite. Run focused hook/Pi tests from plugins/sp, plugin standalone/smoke and required gate. Generated installed adapters are regenerated only through Superskill if installation verification is needed; never edit them by hand.

### Plan

1. [ ] R1/R3: add quoted-JSON escape and truncation regressions plus a real recordToolUseEvent persisted-byte pin in hooks/token-estimate.test.ts; demonstrate current synthetic leak.
2. [ ] R1: implement one escape-aware quoted-sensitive-field pass in scrubSecrets before generic assignment matching; redact unterminated strings to end.
3. [ ] R2/R3: run existing provider/header/assignment and harmless-context matrix, cap-boundary cases and the shared Pi recorder pin.
4. [ ] Run (cd plugins/sp && bun test hooks/token-estimate.test.ts hooks/context-hooks.test.ts hooks/pi/guard-extension.test.ts), standalone/smoke and task gate; review/verify/record and commit only source hooks/tests/evidence.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

`plugins/sp/hooks/context-post-tool.ts:93` and `plugins/sp/hooks/context-post-tool.ts:316`

#### Readiness review (2026-10-10)

Outcome: refined; depth: ready; status: todo → todo; corrections: 3.

| id | pass | evidence |
| --- | --- | --- |
| requirements | true | Current-tree audit; observable R-items and explicit scope below. |
| design | true | Chosen seams, fixtures, edge behavior and non-goals frozen in Design. |
| plan | true | Ordered implementation and test plan linked to R-items. |
| ac | true | Task-local scenarios and req links; task check --as todo PASS, no errors. |
| decisions | true | Closed decisions in Q&A; no unresolved implementation decision. |
| dependencies | true | Prerequisite and sibling ownership recorded in Design; declared edges where needed. |
| premises | true | Source/callers/tests inspected; verified facts and corrected hypotheses recorded in Background. |

Planning-only receipt: no implementation pipeline or behavior-change verification PASS is claimed. Recheck source and ownership before implementation; batch began on main at 13da1554f with one worktree, no WIP tasks and a clean tree. Runtime Bun 1.3.14; no dependency install needed for refinement.

### History

- 2026-10-10T07:29:43.157Z backlog → todo (system)

