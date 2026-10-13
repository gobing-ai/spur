---
schema_version: 1
name: "secrets-scanner: the bare pass keyword matches ordinary prose (PASS: token) and hard-fails the pre-check preset"
status: todo
template: standard
created_at: 2026-10-13T21:14:56.228Z
updated_at: "2026-10-13T21:45:13.840Z"

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

**Refine corrections (2026-10-13)** — ready audit against HEAD `4a3649ae1` and `../ts-libs` HEAD `067b5f47`. The single issue is **valid**:

- The matcher is unchanged upstream (`secrets-scanner-evaluator.ts:18`, `:25`). The installed copy, `@gobing-ai/ts-rule-engine` 0.5.24, carries the same pattern (`node_modules/@gobing-ai/ts-rule-engine/dist/evaluators/secrets-scanner-evaluator.js:14`). The catalog pin is `^0.5.24` (`package.json:41`).
- The FP class is wider than the task says. The keyword group has no left word boundary, so `bypass: "…"` and `compass = '…'` match too. Dropping `pass` removes both shapes.
- Evidence: `.spur/run/1193-test-gate.log` was overwritten by later runs and has no `no-hardcoded-secrets` line now. The durable evidence is the `351db01d5` diff. The Design's Evidence line now cites that diff.
- The upstream test file is `../ts-libs/packages/rule-engine/tests/evaluators/secrets-scanner-evaluator.test.ts`. It has no `PASS:` fixture today.
- Release coordination: 1195 also needs a ts-libs patch release plus a catalog bump. When both are ready, ship one release and one pin bump.

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

**Fix direction (upstream, `../ts-libs/packages/rule-engine/src/evaluators/secrets-scanner-evaluator.ts:25`).** Drop the bare `pass` keyword: `keyworded('passw[o]rd|passwd|pwd', '[^"\'`]{4,}')`. The alternation has no left word boundary, so bare `pass` also matches `bypass:` and `compass =`. Its case-insensitive form also collides with this ecosystem's PASS verdict vocabulary. A real secret keyed `pass` is rare, and a real secret keyed `password`/`passwd`/`pwd` still matches. Keep the value shape `[^"'\`]{4,}` unchanged, so R2's three fixtures keep matching.

**Tests.** In `../ts-libs/packages/rule-engine/tests/evaluators/secrets-scanner-evaluator.test.ts`, add three negative fixtures and assert zero findings for each: the PASS-prose line, `bypass: "the cache"` and `compass = 'north'`. Add the three R2 positive fixtures and assert one `password` finding each. Build the fixture strings by concatenation, the same way the evaluator source does, so the test file does not trip the scanner when it scans itself.

**Rejected alternatives.**
- (a) Narrow this repo's rule scope to exclude `*.md`. Docs can leak real secrets, and the FP also fires in `.ts` doc comments. This weakens a security rule to hide a matcher bug.
- (b) Remove `password` from `categories` here. That silently disables password scanning.
- (c) Add a per-line allowlist comment to the scanner. That is new public surface for a matcher defect.
- (d) Keep `pass` and require a secret-shaped value. That shrinks R2's true-positive set (`pwd: "correct horse"` has a space), and the keyword collision stays.

**Anti-patterns.** Do not "fix" this by rewording consumer prose again; the class recurs. Do not publish without the operator gate: `spur-new`'s pin cannot resolve until the patch is on the registry.

**Evidence.** The `351db01d5` diff of `packages/app/src/workflow/feature-verification-receipt.ts` (original wording), `config/rules/structure/protected-files.yaml:7-13`, and `../ts-libs/packages/rule-engine/src/evaluators/secrets-scanner-evaluator.ts:16-25`.

### Plan

1. Reproduce upstream: add the negative fixtures to `../ts-libs/packages/rule-engine/tests/evaluators/secrets-scanner-evaluator.test.ts` and confirm they fail today.
2. Drop `pass` from the `password` keyword group. Negative and positive fixtures go green.
3. Run `(cd ../ts-libs/packages/rule-engine && bun run test && bun run lint)`.
4. OPERATOR GATE: publish the patch release (one release with 1195's clef fix if both are ready). Then pin `@gobing-ai/ts-rule-engine` in `spur-new`'s root `workspaces.catalog` and run `bun install`.
5. Verify here: restore the original wording from `351db01d5^` in `feature-verification-receipt.ts`, run `bun run test-pre-check` (green), then run `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-10-13T21:45:13.840Z backlog → todo (system)

