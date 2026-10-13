---
schema_version: 1
name: "secrets-scanner: the bare pass keyword matches ordinary prose (PASS: token) and hard-fails the pre-check preset"
status: backlog
template: standard
created_at: 2026-10-13T21:14:56.228Z
updated_at: "2026-10-13T21:14:58.464Z"

priority: P2
estimate_hours: 4
---

## 1200. secrets-scanner: the bare pass keyword matches ordinary prose (PASS: token) and hard-fails the pre-check preset

### Background

`rule run --preset recommended-pre-check` failed the whole quality gate on a **doc comment** during batch `runall-1193-1195-1068` (2026-10-13):

```
ERROR no-hardcoded-secrets packages/app/src/workflow/feature-verification-receipt.ts:107 potential secret (password)
```

Line 107 was prose: `Derived confidence in a PASS: \`HIGH\` when the selected definition's own command exited 0 ...`.

Mechanism (upstream, `@gobing-ai/ts-rule-engine`): the `password` category is built by `keyworded('passw[o]rd|passwd|pwd|pass', '[^"\'`]{4,}')` at `../ts-libs/packages/rule-engine/src/evaluators/secrets-scanner-evaluator.ts:25`, where `keyworded(keywords, value)` builds `(?i)(<keywords>)\s*[=:]\s*["'\`]<value>["'\`]`. The bare keyword `pass` therefore matches the word **PASS** followed by a colon and any backticked/quoted token of 4+ characters — ordinary prose, ADR text and doc comments included. The value shape `[^"'\`]{4,}` accepts spaces and any 4 characters, so almost any `PASS: \`X\`` or `pass: "word"` sentence matches.

Impact: the rule is enabled in `config/rules/structure/protected-files.yaml` (`categories: [api-key, token, private-key, password, connection-string]`, scope `apps/`, `packages/`, `scripts/`) and `test-pre-check` runs with `--fail-on warning`, so a false positive is a **hard gate failure** that reports as "potential secret (password)" — indistinguishable from a real leak in the gate log, and it costs a full pipeline cycle (the batch's first gate run died here).

Workaround already applied in-tree: the comment was reworded (commit `351db01d5`). The false-positive class remains for any prose shaped `PASS: \`SOMETHING\``, which this repo's own vocabulary (verdicts are PASS/PARTIAL/FAIL) makes likely to recur.

### Requirements

- [ ] R1. The `password` category stops matching the word PASS (case-insensitively) followed by a colon and a 4-character token: the fixture line `Derived confidence in a PASS: \`HIGH\` when ...` produces no finding.
- [ ] R2. Real password assignments still match: `password = "hunter2hunter2"`, `passwd: 'x9fJ2kLm'`, `pwd: "correct horse"` (or whatever set the chosen rule keeps — state it explicitly).
- [ ] R3. The fix ships upstream from `../ts-libs` as a patch release and arrives here as a pinned `workspaces.catalog` version (the task 1195 shape), with the operator gate before publish.
- [ ] R4. No category is silently disabled in this repo's rule config: `protected-files.yaml` keeps scanning all five categories.

### Acceptance Criteria

- [ ] AC1 — The PASS-prose fixture yields no `no-hardcoded-secrets` finding (req: R1)
- [ ] AC2 — The true-positive fixture still yields a finding (req: R2)
- [ ] AC3 — `bun run test-pre-check` passes with the comment restored to its original wording (req: R1)
- [ ] AC4 — Installed `ts-rule-engine` in `packages/app/node_modules` carries the fix and the catalog pin names the released version (req: R3)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**Fix direction (upstream, `../ts-libs/packages/rule-engine/src/evaluators/secrets-scanner-evaluator.ts`).** Preferred: drop the bare `pass` keyword from the alternation (`passw[o]rd|passwd|pwd`), because a bare `pass` key is rare and its case-insensitive form collides with this ecosystem's PASS verdict vocabulary. Alternative if `pass` must stay: require a secret-shaped value (no whitespace, >=8 chars, at least two character classes) instead of `[^"'\`]{4,}` — either way the change must be accompanied by the two fixtures in R1/R2.

**Tests.** Add both fixtures to the evaluator's own test file in ts-libs (positive and negative), asserting the finding count, so the FP cannot return.

**Rejected alternatives.** (a) Narrowing this repo's rule scope to exclude `*.md` — docs can really leak secrets, and the FP also fires in `.ts` doc comments; it weakens a security rule to hide a matcher bug. (b) Removing `password` from `categories` here — silently disables password scanning. (c) Adding a per-line allowlist comment syntax to the scanner — new public surface for a matcher defect.

**Anti-patterns.** Do not "fix" this by rewording consumer prose again (the class recurs). Do not publish without the operator gate: `spur-new`'s pin cannot resolve until the patch is on the registry.

**Evidence.** `packages/app/src/workflow/feature-verification-receipt.ts:107` (pre-`351db01d5` wording), `.spur/run/1193-test-gate.log` first run, `config/rules/structure/protected-files.yaml:7-32`, `../ts-libs/packages/rule-engine/src/evaluators/secrets-scanner-evaluator.ts:17-28`.

### Plan

1. Reproduce upstream: in `../ts-libs`, add the PASS-prose fixture to the secrets-scanner test file and confirm it matches today (red).
2. Apply the chosen fix (drop `pass`, or require a secret-shaped value); both fixtures green.
3. Run the ts-libs package tests + its lint.
4. OPERATOR GATE: publish the patch release, then pin `@gobing-ai/ts-rule-engine` in `spur-new`'s root `workspaces.catalog` and `bun install`.
5. Verify here: `bun run test-pre-check` green with the original comment wording restored (revert the workaround to prove it), then `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
