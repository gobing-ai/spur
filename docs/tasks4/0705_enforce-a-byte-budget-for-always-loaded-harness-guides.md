---
schema_version: 1
name: "Enforce a byte budget for always-loaded harness guides"
status: done
template: issue
created_at: 2026-08-28T23:03:05.616Z
updated_at: "2026-08-29T21:12:29.155Z"
priority: P1
tags: ["harness", "guide", "sensor", "documentation"]
feature_id: A6
ac_altitude: task-local
---

## 0705. Enforce a byte budget for always-loaded harness guides

### Background

The direct documentation lane reduced the project `AGENTS.md` from 32,577 to 11,898 bytes and restored substantial
headroom below the platform's approximately 32 KiB load limit. Nothing currently prevents future additions from
consuming that headroom again. The constitution's 150-200 instruction guidance is intentionally approximate and is not
suitable for a brittle parser-based gate.

A deterministic UTF-8 byte sensor is sufficient for the observed size failure and can live in the existing portable
AGENTS contract test. This task establishes the post-compaction baseline as an enforceable ceiling without inventing
another guide format or maintenance script.

The post-compaction full-suite run also exposed a related stale contract:
`plugins/sp/tests/cli-surface-parity.test.ts` still requires a noun table immediately under `## Spur CLI surface`.
The compact guide intentionally replaced that duplicated catalog with a one-hop pointer to `sp:spur-cli`; the canonical
facade-vs-live parity tests already own noun/verb coverage. The implementation must reconcile this stale test without
putting the duplicate catalog back into the always-loaded guide.

### Requirements

- [x] R1. Enforce a 20 KiB UTF-8 byte ceiling for repository-root `AGENTS.md` and `config/templates/AGENTS.md`.
- [x] R2. Measure bytes with an encoding-correct primitive such as `Buffer.byteLength(text, 'utf8')`, not JavaScript character count, line count, token estimation, or an instruction parser.
- [x] R3. A failure message must name the file, actual byte count, configured limit, and the one-hop remediation owner.
- [x] R4. Reuse the existing `agents-md-portable-alignment` test/fixture surface so `bun run spur-check` enforces the budget; do not add a standalone CLI verb or package script.
- [x] R5. Keep the portable required-heading/routing/anchor assertions unchanged and green.
- [x] R6. Add one focused regression test proving multibyte UTF-8 content is measured correctly and an over-budget guide fails.
- [x] R7. Document the deterministic byte ceiling separately from the constitution's approximate instruction-budget guidance.
- [x] R8. Reconcile `cli-surface-parity.test.ts` with the compact guide contract: `AGENTS.md` must retain the `## Spur CLI surface` heading and one-hop `sp:spur-cli` ownership pointer, while noun/verb parity is validated from the canonical facade reference rather than a duplicated AGENTS noun table.
- [x] R9. The complete plugin/CLI test suite must pass after the reconciliation; deleting parity coverage or reintroducing a full noun catalog in `AGENTS.md` is not acceptable.

Non-goals: semantic quality scoring, tokenization by provider/model, automatic guide rewriting, or a new configuration
key for a value that does not currently vary.

### Acceptance Criteria

```gherkin
Feature: Always-loaded guide budget

  Scenario: R3 — Current guides retain headroom
    Given the compacted root guide and portable template
    When the portable alignment test runs
    Then both UTF-8 byte counts are at most 20480
    And all existing heading, routing, and anchor assertions still pass

  Scenario: Oversized guide fails clearly
    Given guide content whose UTF-8 size is 20481 bytes
    When the budget assertion runs
    Then it fails with path, actual bytes, and limit

  Scenario: Multibyte text is measured as bytes
    Given non-ASCII guide content
    When the assertion measures it
    Then the result equals its UTF-8 byte length rather than its character count

  Scenario: Compact CLI guidance keeps one parity authority
    Given AGENTS.md carries a one-hop sp:spur-cli pointer instead of a duplicate noun table
    When cli-surface-parity tests run
    Then the compact-guide ownership assertion passes
    And canonical facade nouns still match live root help
    And no copied noun catalog is required in AGENTS.md
```

### Q&A

**Q: Why 20 KiB rather than 32 KiB?** The gate needs operational headroom for platform-added instructions and future
critical rules. Both current guides fit comfortably. Twenty KiB also matches the approved compaction target.

**Q: Why not count instructions or model tokens?** The constitution labels instruction count approximate, and tokenizers
vary by model. UTF-8 byte count directly guards the observed hard-cap failure and is deterministic across environments.

**Q: Should the limit be configurable?** Not now. There is one repository contract and no demonstrated per-project
variation. A constant beside the existing fixture is smaller and harder to misconfigure.

**Q: Does passing the byte gate prove guide quality?** No. Existing routing/heading/anchor checks retain that role; the
byte gate is one sensor for one failure mode.

**Q: Why change the parity test instead of restoring the noun table?** The live CLI already has one canonical facade
inventory and a parity test. Restoring the table would recreate the duplication that caused guide growth. The guide's
contract is discoverability and routing; the facade owns exhaustive noun/verb semantics.

### Design

Add a small exported assertion/helper beside the existing portable AGENTS fixture, with one constant `20 * 1024`.
Invoke it for the root and portable template in the current alignment test. Keep the helper pure so a focused unit case
can pass a multibyte string without writing fixtures.

The 20 KiB ceiling leaves meaningful headroom below 32 KiB while accommodating both current files. The constant is a
repository contract, not user configuration. If an actual platform limit changes, update the constant and its
documentation in one change.

For CLI parity, keep the existing facade-vs-live noun/verb tests as the machine authority. Replace the stale AGENTS
table parser assertion with a compact-guide ownership assertion: the heading exists, it points one hop to `sp:spur-cli`,
and it does not become a second catalog. This removes redundant data rather than weakening coverage.

### Plan

1. Record current byte counts and reproduce both the missing budget and the failing `cli-surface-parity` AGENTS-table assertion.
2. Add the pure UTF-8 byte-budget assertion and fixed 20 KiB constant.
3. Apply it to root and portable template guide reads.
4. Add focused boundary/multibyte regression coverage.
5. Replace the stale AGENTS noun-table assertion with a one-hop ownership assertion while preserving existing canonical facade-vs-live parity tests.
6. Update the guide-governance design/process pointer with the exact deterministic ceiling and parity ownership.
7. Run the targeted alignment and CLI-surface parity tests, then `bun run test`, `bun run spur-check`, and guide byte-count comparison.

### Root Cause

The size contract is qualitative. `docs/99_PROJECT_CONSTITUTION.md` states the approximate instruction-budget and
perishability rules, while `apps/cli/tests/agents-md-portable-alignment.test.ts` validates headings, routing rows, and
anchors. No deterministic check measures the actual UTF-8 size of the two always-loaded guides. The previous root guide
therefore reached 32,577 bytes—191 bytes below the stated 32 KiB platform limit—without failing a repository gate.

The direct documentation lane established a stable measured baseline (11,898 bytes for root `AGENTS.md`; 10,650 bytes
for the portable template). The missing sensor is one cheap regression assertion at the existing contract-test seam.

A second root cause was verified by `bun run test`: `plugins/sp/tests/cli-surface-parity.test.ts:419-422` still parses a
table directly below `## Spur CLI surface`. The compacted guide retains the heading and canonical one-hop pointers but
deliberately removed the duplicated table. The test conflates discoverability with catalog ownership even though earlier
tests in the same file already compare the canonical facade noun inventory to live CLI help.

### Solution

- Byte budget: `apps/cli/tests/fixtures/agents-md-portable-contract.ts:49` — `PORTABLE_AGENTS_BYTE_BUDGET = 20 * 1024`, pure `agentsGuideUtf8Bytes` (Buffer.byteLength utf8, R2) and `assertAgentsGuideByteBudget` throwing file/bytes/limit/`sp:doc-evolve` owner (R3); applied to root + template in `apps/cli/tests/agents-md-portable-alignment.test.ts:139` (R1), with multibyte (10k chars = 30k bytes), over-budget and boundary regressions at `apps/cli/tests/agents-md-portable-alignment.test.ts:144-163` (R6).
- Compact-guide reconciliation: root `AGENTS.md` noun catalog + parity-authority sentence removed (F95 restoration reverted to the `2f4e729ff` compact contract; 13,660 → 12,556 bytes, heading + one-hop pointer retained at `AGENTS.md:195`); `plugins/sp/tests/cli-surface-parity.test.ts:423` R4 block replaced with the ownership assertion (heading exists, `sp:spur-cli` pointer, no noun-catalog table under the heading); facade-vs-live noun/verb parity tests untouched (R8/R9); stale `tierCNouns` dropped.
- Docs: `docs/99_PROJECT_CONSTITUTION.md:378` §6.7 rule 7 (deterministic 20480-byte ceiling, separate from rule 4's approximate instruction budget) mirrored in `config/templates/docs/99_PROJECT_CONSTITUTION.md` (R7); `docs/design/plugin-surface-parity.md:21` S4 row now names the ownership contract.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
| ------------- | -------- | ---------- |
| R1 | MET | `apps/cli/tests/fixtures/agents-md-portable-contract.ts:49` (`PORTABLE_AGENTS_BYTE_BUDGET = 20 * 1024`), applied to root + template at `apps/cli/tests/agents-md-portable-alignment.test.ts:139`; live run: 8 pass / 0 fail |
| R2 | MET | `apps/cli/tests/fixtures/agents-md-portable-contract.ts:52` (`agentsGuideUtf8Bytes` = `Buffer.byteLength(text, 'utf8')`); regression `apps/cli/tests/agents-md-portable-alignment.test.ts:144` proves 10k chars = 30000 bytes ≠ char count |
| R3 | MET | `apps/cli/tests/fixtures/agents-md-portable-contract.ts:60` throw message names file, actual bytes, limit, and `sp:doc-evolve` remediation owner; over-budget test `apps/cli/tests/agents-md-portable-alignment.test.ts:152` asserts all four parts |
| R4 | MET | Budget lives inside the existing `agents-md-portable-alignment` surface (fixture + test), no new CLI verb/script added (root help + package.json unchanged this run); `bun run spur-check` was green in the task's quality gate |
| R5 | MET | All pre-existing heading/routing/anchor assertions retained and green — full alignment file 8 pass / 0 fail (incl. R5 test at `apps/cli/tests/agents-md-portable-alignment.test.ts:131`) |
| R6 | MET | Focused regressions: multibyte 10k→30000-byte (`apps/cli/tests/agents-md-portable-alignment.test.ts:144`), over-budget 20481 fails (`:152`), boundary 20480 passes (`:159`) |
| R7 | MET | `docs/99_PROJECT_CONSTITUTION.md:379` rule 7 pins the deterministic 20480-byte ceiling, separate from rule 4's approximate instruction budget; mirrored at `config/templates/docs/99_PROJECT_CONSTITUTION.md:365` |
| R8 | MET | `plugins/sp/tests/cli-surface-parity.test.ts:423` new ownership assertion: heading exists, `sp:spur-cli` one-hop pointer, no duplicated noun catalog (`:435` negative regex); stale direct-table parser removed; `AGENTS.md:193` retains `## Spur CLI surface` + one-hop pointer, no noun table |
| R9 | MET | Canonical facade-vs-live noun/verb parity tests untouched and green: `plugins/sp/tests/cli-surface-parity.test.ts` 21 pass / 0 fail this run; full `bun run test` + `spur-check` green in the task's post-fix quality gate |

| Acceptance Criteria | Status | Evidence Type | Evidence |
| --------------------- | -------- | --------------- | ---------- |
| Scenario: R3 — Current guides retain headroom | MET | command | `wc -c`: AGENTS.md 12556 ≤ 20480; config/templates/AGENTS.md 10650 ≤ 20480; alignment test green this run (8 pass) |
| Scenario: Oversized guide fails clearly | MET | test | `apps/cli/tests/agents-md-portable-alignment.test.ts:152` — 20481-byte input throws naming path/bytes/limit/owner |
| Scenario: Multibyte text is measured as bytes | MET | test | `apps/cli/tests/agents-md-portable-alignment.test.ts:144` — 漢×10000 = 30000 UTF-8 bytes, ≠ 10000 chars |
| Scenario: Compact CLI guidance keeps one parity authority | MET | test | `plugins/sp/tests/cli-surface-parity.test.ts:423-439` ownership assertion + facade-vs-live parity tests green (21 pass) this run |

- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review
<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
| ---------- | ----------- | ---------- | ---------- |
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
| P4 | proof-input-digest | — | sha256:14e4beebd83a92b5ebbb3683909ab8b61333ec1ea5ac28fbb03355d6f92b6eb0 |

### References

- `docs/plans/2026-08-28-harness-documentation-immediate-enhancement.md` — measured before/after baseline.
- `docs/report/2026-08-28-harness-engineering-playbook-vs-spur.md` — M3 and Wave 1.
- `AGENTS.md` — compacted guide and `## Spur CLI surface` one-hop routing.
- `config/templates/AGENTS.md`
- `docs/99_PROJECT_CONSTITUTION.md` §6.7.
- `config/templates/docs/99_PROJECT_CONSTITUTION.md` §6.7.
- `apps/cli/tests/agents-md-portable-alignment.test.ts`
- `apps/cli/tests/fixtures/agents-md-portable-contract.ts`
- `plugins/sp/tests/cli-surface-parity.test.ts:419` — stale direct-table assertion.
- `plugins/sp/skills/spur-cli/SKILL.md` and noun references — canonical CLI facade inventory.

### History

- 2026-08-28 — created from the approved harness comparison implementation lane; researched, decomposed, linked to A6, and passed the task-local readiness gate.
- 2026-08-29T20:48:38.292Z todo → wip (system)
- 2026-08-29T21:12:28.846Z wip → testing (system)
- 2026-08-29T21:12:29.155Z testing → done (system)
