---
schema_version: 1
name: verify-answer-lint cannot match an AC title that contains a colon
status: done
template: feature-impl
created_at: 2026-10-07T20:52:29.516Z
updated_at: "2026-10-08T07:55:02.628Z"

feature_id: F91
priority: P2
ac_numbering: task-local
ac_altitude: task-local
estimate_hours: 1.5
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1118-verdict.json
---

## 1118. verify-answer-lint cannot match an AC title that contains a colon

### Background

Found 2026-10-07 while deriving the verdict for task 0213 (knowledge-kit).

`buildAcIdentityIndex` in `packages/app/src/services/verify-answer-lint.ts` declares each AC identity with:

```js
for (const m of section.matchAll(/^[-*]\s+(?:\[[ xX]\]\s+)?(.+?)\s*(?::|$)/gm)) {
```

The `(.+?)` is lazy and the terminator alternation includes `:`, so the match **stops at the first colon anywhere in the label** — including a colon inside a backtick span.

Task 0213's AC2 title names `` `file:line` ``, so the checker declared the truncated identity
`AC2 — The R1 inventory exists, one row per surface, each naming the \`file`
and could never match the full title a verifier quotes. `spur task verdict --from-answer` then refused with `AC ID "AC2 — …" matches no task AC checklist label or scenario title`. The task's AC2 title is byte-identical on both sides — verified by direct comparison — so the defect is purely in the index.

Impact: any task whose AC title contains a colon before its end is uncertifiable through the normal path. The workaround is to answer with the bare `AC-N` alias (which the lint documents as accepted), which is fine for the linter but loses the verbatim title the evidence convention asks for.

**Refine corrections (2026-10-07)**

- **Reproduced on the current tree.** A checklist AC whose title contains `` `file:line` `` declares only ``AC2 — The inventory names the `file`` and `AC2`; the verbatim title is refused with an `ac-identity` finding. The regex is at `packages/app/src/services/verify-answer-lint.ts:482` inside `buildAcIdentityIndex` (`:473`).
- **R1 answered: why `(?::|$)` exists.** It supports the legacy colon-headed row `- [ ] AC1 (R1): description`, where the text before the colon (and its leading token) is the identity (fixture in `packages/app/tests/services/verify-answer-lint.test.ts`). That head must keep resolving, so the fix is additive: also declare the full line, do not stop declaring the head.
- **The same truncation hits every checklist row with a `(req: R<n>)` suffix** (the documented AC form): today `- [ ] AC1 — Title (req: R1)` declares `AC1 — Title (req`. Declaring the full line fixes those too; scenario titles are already declared verbatim (`:515-516`), so this aligns the two forms.
- **R3 dropped — already shipped.** Task 1091 (commit c95c625e2, 2026-10-05) makes the rejection list the declared identities (`:119-133`). The downstream run used an older spur build.
- **Backtick-aware splitting is not needed.** Once the full line is declared, a colon anywhere in the title is harmless; quoting rules would add a parser for no extra resolution.
- **R4 kept** as a preservation requirement (bold head, bold trajectory, `AC-N` alias, legacy colon head).
- No sibling regex has this defect (`rg` over `packages/app/src`); the bold branches (`:492`, `:503`) already declare both the full span and the head.

### Requirements

- [x] R1. `buildAcIdentityIndex` declares the full single-line checklist label (text after the optional checkbox to end of line, trimmed) as an AC identity, in addition to the existing pre-colon head and leading token.
- [x] R2. An answer row citing a checklist AC by its verbatim title resolves when the title contains `` `file:line` ``, a URL such as `http://host/x`, a bare prose colon, or a `(req: R<n>)` suffix.
- [x] R3. Existing resolutions are preserved: the legacy `- [ ] AC1 (R1): description` head and its `AC1` token, the bold head (`- **AC2 — Title.** …`), the bold-trajectory paragraph, scenario titles and the `AC-N` alias all resolve exactly as before, a `- [ ] AC1: text` row still answers to `AC1`, and an undeclared paraphrase is still refused.

### Acceptance Criteria

```gherkin
Scenario: AC1 — A checklist AC title with a colon inside it resolves by its full title (req: R1, R2)
  Given task ACs `- [ ] AC1 — The inventory names the `file:line` of each surface`, `- [ ] AC2 — Docs link http://example.test/x`, `- [ ] AC3 — Output shows: a summary` and `- [ ] AC4 — Gate passes (req: R1)`
  When lintVerifyAnswer runs on an answer whose AC rows cite each title verbatim
  Then no ac-identity finding is reported for AC1–AC4

Scenario: AC2 — Legacy and alias forms keep resolving and paraphrases stay refused (req: R3)
  Given task ACs in the legacy `- [ ] AC1 (R1): description` form, a `- [ ] AC2: text` row, a bold head `- **AC3 — Title.** Given …`, a bold-trajectory paragraph and a Scenario block
  When lintVerifyAnswer runs on answers citing `AC1 (R1)`, `AC1`, `AC2`, the bold title, the trajectory id and `AC-1`
  Then all resolve, and an answer citing an invented paraphrase still yields an ac-identity finding
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-07T21:25:21.683Z

- **Additive declaration over a smarter terminator.** Declaring the full line plus the existing head keeps every legacy form working, and a colon anywhere in the title stops mattering. A backtick/quote-aware terminator would still truncate titles with a bare prose colon. Rejected.
- **Known limit:** a head-cited row and a full-title row for the same AC normalize to different keys, so duplicate detection does not merge them. This was already true for the bold forms; not worth a canonical-id rewrite here.
- **The rejection message (old R3) is out of scope** — task 1091 already lists the declared identities.

### Design

**Change (`packages/app/src/services/verify-answer-lint.ts`, `buildAcIdentityIndex` checklist loop at `:482`).**

```ts
for (const m of section.matchAll(/^[-*]\s+(?:\[[ xX]\]\s+)?(.+?)\s*$/gm)) {
    const full = (m[1] ?? '').trim();
    if (!full) continue;
    declareIdentity(full);
    // Legacy `AC1 (R1): description` head (pre-colon) stays declared, as before.
    const head = full.split(':')[0]?.trim() ?? '';
    if (head && head !== full) declareIdentity(head);
    const leading = head.split(/\s+/)[0] ?? '';
    if (leading && leading !== head) declareIdentity(leading);
}
```

**Invariants.**
- Every spelling declared before is still declared: the pre-colon head equals the old `label`, and the leading token is derived from it.
- `declareIdentity` is first-writer-wins per normalized key, so adding spellings never changes the canonical value of an existing key.
- Bold, bold-trajectory and scenario branches are untouched.
- Normalization (`normalizeAcTitle`, `:440`) is unchanged.

**Blast radius.** The lint becomes strictly more accepting for verbatim titles, and no less accepting for anything else. An undeclared paraphrase still fails, because only real lines are declared.

### Plan

1. Add AC1/AC2 cases to `packages/app/tests/services/verify-answer-lint.test.ts` through the exported `lintVerifyAnswer(answer, taskContent, featureContent)`; confirm AC1 fails on the current tree.
2. Replace the checklist loop as in Design.
3. Focused: `(cd packages/app && bun test tests/services/verify-answer-lint.test.ts)`.
4. E2E: on a scratch task whose AC title contains `` `file:line` ``, run `spur task verdict <wbs> --from-answer <answer>` with the verbatim title and record that it is accepted; save the output as `.spur/run/1118-verdict.json`.
5. `bun run spur-check`.

### Solution

- `packages/app/src/services/verify-answer-lint.ts` `buildAcIdentityIndex` (verify-answer-lint.ts:473): checklist regex now captures the full row text (`(.+?)\s*$`); declares full line + colon-whitespace head (legacy `AC1 (R1): …` form) + leading `AC-N` token. Scenario titles declare before checklist rows so the 1091 rejection sample (5 slots) leads with them instead of being crowded out by long full lines. Resolution is map-keyed, so reorder has no behavioral effect.
- Junk truncated heads (e.g. `AC1 — The inventory names the \`file`) are no longer declared — citing one is rejected, which is the regression proof.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | packages/app/src/services/verify-answer-lint.ts:473 declares the full checklist row text; commit c905d6d44 |
| R2 | MET | packages/app/tests/services/verify-answer-lint.test.ts test "every colon form resolves verbatim" covers backtick file:line, URL, bare prose colon and (req:) suffix; commit 36f274590 |
| R3 | MET | same file: legacy head and AC-N alias tests plus full downstream suites green — verify-answer-lint 71/71, apps/cli task commands 204/204, dispatch-handoff-contract 10/10, full gate rc=0 10485 pass / 0 fail |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — A checklist AC title with a colon inside it resolves by its full title (req: R1, R2) | MET | test | all four colon forms cited verbatim produce no ac-identity finding — packages/app/tests/services/verify-answer-lint.test.ts:696 |
| AC2 — Legacy and alias forms keep resolving and paraphrases stay refused (req: R3) | MET | test | legacy-head test plus junk-head refusal test — packages/app/tests/services/verify-answer-lint.test.ts:716; suites 71/71, 204/204, 10/10, full gate rc=0 |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- `packages/app/src/services/verify-answer-lint.ts:473-517` — `buildAcIdentityIndex`.
- `packages/app/src/services/verify-answer-lint.ts:416-455` — `stripAcWrappers` / `normalizeAcTitle`.
- `packages/app/src/services/verify-answer-lint.ts:119-133` — declared-identity rejection message (task 1091).
- `packages/app/tests/services/verify-answer-lint.test.ts` — legacy `AC1 (R1):` fixtures.
- Feature F91 (corpus gate integrity).

### History

- 2026-10-07T21:25:40.085Z backlog → todo (system)
- 2026-10-08T07:54:59.296Z todo → wip (system)
- 2026-10-08T07:55:00.698Z wip → testing (system)
- 2026-10-08T07:55:02.412Z testing → done (system)

