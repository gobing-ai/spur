---
schema_version: 1
name: Redact quoted JSON credentials before persisting tool summaries
status: done
template: feature-impl
created_at: 2026-10-10T07:29:39.093Z
updated_at: "2026-10-10T17:57:35.319Z"
feature_id: H21

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 3
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1158-verdict.json
---

## 1158. Redact quoted JSON credentials before persisting tool summaries

### Background

scrubSecrets misses quoted JSON keys, persisting plaintext password and token values in token-ledger.jsonl Evidence: `plugins/sp/hooks/context-post-tool.ts:93` and `plugins/sp/hooks/context-post-tool.ts:316`. Review a71c confirmed this using buildToolSummary with curl JSON password and token fields, using synthetic credential values only. Separate direct fixes already corrected gate-lock diagnostics, absolute file.read paths, and resumed-run analytics. This task carries task-local regression scenarios below feature ship criteria.

**Refine corrections (2026-10-10)**
- Current scrubSecrets generic key matcher at context-post-tool.ts:93 requires the separator immediately after the bare key, so a closing JSON key quote prevents matching. A synthetic buildToolSummary probe reproduced the leak (boolean-only output, no actual credentials).
- Tests live at plugins/sp/hooks/token-estimate.test.ts and context-hooks.test.ts, not plugins/sp/tests/hooks. The shared recorder also serves hooks/pi/guard-extension.ts, and scrubSecrets is shared by cappedByteLength/redactText.
- Hook adapters are Superskill-owned installation outputs; there is no tracked context-post-tool.mjs twin to hand-edit. Keep source hooks builtin/relative only and verify the existing portable hook path.

### Requirements

- [x] R1. Recognize quoted sensitive keys and redact complete quoted values, including escaped quotes, before summary truncation and ledger persistence
- [x] R2. Existing assignment, provider-token and authorization redaction remains effective and harmless command context remains readable
- [x] R3. Add the reproducing regression and validate the affected callers through the existing test seams.

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

`file:line` change map (task 1158):

- `plugins/sp/hooks/context-post-tool.ts:94` — quoted-JSON sensitive-field pass in `scrubSecrets`, placed before the Bearer/`key=value`/Authorization passes. Matches a sensitive key in all three real Bash spellings — plain `"key"`, single-quoted `'key'`, and shell-escaped `\"key\"` inside a double-quoted argument (`curl -d "{\"password\":\"…\"}"`) — keeping the key/colon and replacing the whole value with `"***"`. Escape-aware alternatives treat `\"`/`\\` as value content, never a terminator; in the shell-escaped opener form a JSON-level escaped quote (`\\\"` raw) is content and the value stops only at a clean `\"` terminator, failing closed to redact through end-of-input when no clean terminator follows (a bare `"` cannot end the value early). An unterminated plain value (including a trailing lone backslash) also redacts through end-of-input, and an unquoted scalar value (`{"password": 12345}`) is covered. Runs on the full summary text before `REDACTION_CAP_BYTES`/`SUMMARY_MAX_CHARS` truncation and ledger persistence. No new helper, dependency, or public surface.
- `plugins/sp/hooks/token-estimate.test.ts:81` — `scrubSecrets — quoted JSON sensitive fields (task 1158)` unit matrix: quoted password/token/api_key/API_KEY/TOKEN/authorization/private_key keys, whitespace, nested/repeated fields, an escaped-quote value with distinct prefix/mid/suffix markers, escaped backslashes/spaces, empty value, unterminated + trailing-backslash values, a secret crossing the 200-char summary limit and 4096-byte cap, and negative pins (`token_count`, `tokens`, `tokenizer`, `authorization_header`, filenames, harmless quoted command).
- `plugins/sp/hooks/token-estimate.test.ts:107` — regression pins for the three bypassing forms: (a) shell-escaped `\"password\"`, (b) single-quoted `'password'`, and the single-quoted-shell-wrapping form kept non-regressed, plus (c) unquoted value `{"password": 12345}`.
- `plugins/sp/hooks/token-estimate.test.ts:111` — regression pin for the escaped-opener value holding a JSON-level escaped quote (reviewer repro): the whole value is redacted, not merely its prefix up to the inner `\"`.
- `plugins/sp/hooks/token-estimate.test.ts:124` — regression pin for the fail-closed path (reviewer repro): an escaped opener with no clean `\"` terminator redacts through end-of-input, so the unterminated value cannot leak.
- `plugins/sp/hooks/token-estimate.test.ts:411` — `recordToolUseEvent` persisted-byte pin: synthetic quoted credentials never appear in the returned event or the raw `token-ledger.jsonl` bytes.
- `plugins/sp/hooks/token-estimate.test.ts:437` — `recordToolUseEvent` persisted-byte pin for the shell-escaped form: escaped-`\"` JSON credentials never appear in the returned event or the raw ledger bytes.
- `plugins/sp/hooks/context-hooks.test.ts:252` — spawned `context-post-tool` end-to-end pin: quoted JSON credentials are redacted from the Bash summary before the hook appends to the ledger.

Rationale: `scrubSecrets` runs on full summary text before truncation and storage, so one escape-aware pass there fixes every caller (`truncateSummary`/`redactText`/`cappedByteLength` and the Pi shared recorder in `hooks/pi/guard-extension.ts`) without widening the surface. Existing assignment/provider/Authorization/PEM/base64 passes are unchanged; the quoted pass only adds coverage for quoted/escaped/unquoted JSON keys. Bounded remediation (review round 2, P3 minor): the shell-escaped value alternative now consumes a JSON-level escaped quote as content and fails closed to end-of-input when no clean `\"` terminator follows, closing the two reviewer reproductions without adding a second pass, helper, dependency, or public surface.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/sp/hooks/context-post-tool.ts:95` escape-aware quoted-JSON sensitive-field pass in `scrubSecrets` replaces whole quoted values (plain/single/shell-escaped keys, escaped quotes/backslashes as content, fail-closed to end-of-input); runs before caps/ledger write. Unit matrix `plugins/sp/hooks/token-estimate.test.ts:81` (escaped-quote whole-value :149, unterminated + trailing backslash :165, pre-truncation 200-char/4096-byte :170). My own end-to-end `recordToolUseEvent` repro over synthetic markers produced 0 leaks in returned event and raw ledger bytes. |
| R2 | MET | Existing assignment/provider/authorization redaction tests remain unchanged and green: `plugins/sp/hooks/token-estimate.test.ts:60`; harmless-context pin `plugins/sp/hooks/token-estimate.test.ts:74`; shared Pi recorder path `plugins/sp/hooks/pi/guard-extension.test.ts:355`. Focused suite 140 pass / 0 fail; my repro confirmed ANTHROPIC_API_KEY/GITHUB_TOKEN/Bearer/PEM still scrubbed and `ls -la src/ && grep -r password .` byte-identical. |
| R3 | MET | Regression pins assert raw ledger bytes not just the returned object: `plugins/sp/hooks/token-estimate.test.ts:411` and `plugins/sp/hooks/token-estimate.test.ts:437`; spawned real-hook end-to-end pin `plugins/sp/hooks/context-hooks.test.ts:252`. All green under `bun test hooks/token-estimate.test.ts hooks/context-hooks.test.ts hooks/pi/guard-extension.test.ts`. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Reproducing edge case is safe (req: R1, R3) | MET | test | `plugins/sp/hooks/context-hooks.test.ts:252` spawns the real `context-post-tool` hook with a Bash command carrying spaced/escaped-quote JSON password, token and api_key fields and asserts the ledger bytes omit every synthetic marker; `plugins/sp/hooks/token-estimate.test.ts:411` pins the returned event AND raw `token-ledger.jsonl` bytes. Independently reproduced end-to-end with `recordToolUseEvent`: all SYN-PRE/SYN-MID/SYN-POST/SYN-TOKEN-VALUE/SYN-KEY markers absent from both surfaces. |
| AC2 — Existing behavior remains supported (req: R2, R3) | MET | test | `plugins/sp/hooks/token-estimate.test.ts:60` (assignment + provider-prefix samples still scrubbed) and `plugins/sp/hooks/token-estimate.test.ts:74` (harmless command context untouched); shared Pi recorder `plugins/sp/hooks/pi/guard-extension.test.ts:355`. Focused suite: 140 pass / 0 fail. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**Verdict: PASS** — three-round review; no blocking (P1-P3) findings on the final revision.

Round 1: `FAIL` — one P2 (major): the quoted-JSON pass matched only literal unescaped `"key"`, so the common Bash spellings `curl -d "{\"password\":\"…\"}"` (shell-escaped key), `{'password':'…'}` and `{"password": 12345}` persisted plaintext credentials. Closed by remediation hop 1.
Round 2: `PASS` with one open P3 (minor) — the shell-escaped value alternative treated an inner `\"` as the terminator, leaking the suffix of a quote-bearing or unterminated escaped value. Closed by remediation hop 2 (fail closed through end-of-input).
Round 3: `PASS`, no blocking findings.

| # | Priority | Dimension | Finding | Location | Disposition |
| --- | --- | --- | --- | --- | --- |
| 1 | P4 | correctness | Sensitive keys with an unquoted non-string scalar are also redacted (`{"token":true}` → `{"token":"***"}`). Intended by the design ("unquoted scalar value is covered") and harmless; a small readability cost on benign booleans/nulls. | `plugins/sp/hooks/context-post-tool.ts:95` | ACCEPTED |
| 2 | P4 | functional | The gitignored Superskill-owned installed adapter copy at `apps/cli/plugins/sp/hooks/context-post-tool.ts:73` still carries the pre-fix `scrubSecrets`; it is regenerated by install/Superskill, and hand-editing generated adapters is explicitly out of scope. | `apps/cli/plugins/sp/hooks/context-post-tool.ts:73` | ACCEPTED |
| 3 | P4 | security | Same bug class on an adjacent pre-existing redactor: `SECRET_PATTERN` behind `redactAndBound` also misses quoted JSON keys (`{"password":"SYN-PW"}`). Not on the token-ledger path (that text is scrubbed by `scrubSecrets` upstream); follow-up candidate. | `packages/app/src/observability/agent-execution.ts:7` | ACCEPTED |
| 4 | P4 | architecture | The four-alternative `scrubSecrets` regex is dense; correctness rides on subtle backreference/escape semantics. Well documented and covered by an extensive unit matrix, but a named sub-pattern would lower future maintenance risk. | `plugins/sp/hooks/context-post-tool.ts:95-99` | ACCEPTED |

Adversarial verification (round 3): both round-2 reproductions now redact the whole value; a 32-case fuzz over escaped quotes/backslashes, spaces, unterminated and trailing-lone-backslash inputs produced zero leaks; the fail-closed fallback does not over-redact a well-formed multi-field escaped body (`\"note\":\"ok\"` survives); the negative matrix (`token_count`, `tokens`, `tokenizer`, `authorization_header`, filenames, harmless quoted JSON) stays byte-identical; ReDoS on the `[\s\S]*$` fallback measured 4.1 ms on 50 KB pathological input. Focused suite: 140 pass / 0 fail.

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
- 2026-10-10T16:43:19.207Z todo → wip (system)
- 2026-10-10T17:57:23.181Z wip → testing (system)
- 2026-10-10T17:57:35.312Z testing → done (system)

