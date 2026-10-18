/**
 * verify-answer-lint — behavior cases for the pure lint (task 1003 R1/R4).
 *
 * Ported from the deleted plugin test `plugins/sp/tests/verify-answer-lint.test.ts`: the same
 * malformed-answer classes the pipeline used to reject through the script CLI are rejected by
 * `lintVerifyAnswer`, which `spur task verdict` now runs before `deriveVerdict` (1003 R2).
 * The CLI exit path (exit 1, `lintFindings`, no artifact) is covered by
 * apps/cli/tests/commands/task/verdict.test.ts and plugins/sp/tests/dispatch-handoff-contract.test.ts.
 */
import { describe, expect, test } from 'bun:test';
import { deriveVerifyConfidence } from '../../src/services/answer-confidence';
import { ANSWER_LINT_MAX_FINDINGS, lintVerifyAnswer } from '../../src/services/verify-answer-lint';

const TASK = `
## 9001. Lint fixture task

### Requirements

- [ ] **R1. First requirement.** Guard the thing.
- [ ] **R2. Second requirement.** Log the thing.

### Acceptance Criteria

- [ ] AC1 (R1): the guard rejects an unsafe input.
- [ ] AC2 (R2): the log records the input.
`;

/** Feature content declaring one scenario title (scenario-titles source of AC identities). */
const FEATURE = `
## Feature F9 — Guard

### Acceptance Criteria

Scenario: Guard rejects unsafe input
Given an unsafe input
When the guard runs
Then the input is rejected
`;

/** Answer fixture. */
/**
 * Derive the level the fixture's own rows imply (ADR-141), so each test asserts the rule it targets
 * rather than tripping the confidence cross-check. The derivation itself is covered by
 * `answer-confidence.test.ts`, and the mismatch rejection has its own cases below.
 */
function impliedConfidence(reqs: string[], acs: string[], verdict: string): string {
    const cell = (row: string, i: number): string =>
        row
            .split('|')
            .map((c) => c.trim())
            .filter((c) => c.length > 0)[i] ?? '';
    return `Confidence: ${deriveVerifyConfidence({
        verdict: verdict.replace(/^Verdict:\s*/i, ''),
        requirements: reqs.map((row) => ({ status: cell(row, 1) })),
        acceptanceCriteria: acs.map((row) => ({ status: cell(row, 1), evidenceType: cell(row, 2) })),
    })}`;
}

function answer(reqs: string[], acs: string[], verdict = 'Verdict: PASS', confidence?: string): string {
    return [
        verdict,
        '',
        '### Per-Requirement Traceability',
        '| Req | Status | Evidence |',
        '| --- | --- | --- |',
        ...reqs,
        '',
        '### Acceptance Criteria Verification',
        '| AC | Status | Evidence Type | Evidence |',
        '| --- | --- | --- | --- |',
        ...acs,
        '',
        // The lint accepts the line at any top-level position; the fixture keeps it last so the
        // per-row line numbers the other cases assert stay stable.
        confidence ?? impliedConfidence(reqs, acs, verdict),
        '',
    ].join('\n');
}

const CLEAN_REQS = ['| R1 | MET | `src/guard.ts:42` |', '| R2 | PARTIAL | `src/log.ts:7` |'];
const CLEAN_ACS = [
    '| AC1 | MET | test | `tests/guard.test.ts:9` |',
    '| AC2 | PARTIAL | manual-review | log file reviewed |',
];

describe('lintVerifyAnswer (task 1003 R1)', () => {
    test('a contract-shaped answer lints clean', () => {
        expect(lintVerifyAnswer(answer(CLEAN_REQS, CLEAN_ACS), TASK, null)).toEqual([]);
    });

    // D65 1240: the review report spells the same table `| Item | State | Evidence |`. The lint used
    // to reject that header outright, so every review hop folded to FAIL and the pipeline looped
    // review -> remediate: an answer with real, cited rows was unverifiable by its header alone.
    test('an `Item | State | Evidence` table is the same table, not a malformed one', () => {
        const reply = [
            'Verdict: PASS',
            '',
            '| Item | State | Evidence |',
            '| --- | --- | --- |',
            '| R1 | MET | `src/guard.ts:42` |',
            '| R2 | MET | `src/log.ts:7` |',
            '',
        ].join('\n');
        expect(lintVerifyAnswer(reply, TASK, null)).toEqual([]);
    });

    test('missing `Verdict:` line is rejected', () => {
        const findings = lintVerifyAnswer(answer(CLEAN_REQS, CLEAN_ACS, 'no verdict line'), TASK, null);
        expect(findings.length).toBe(1);
        expect(findings[0]?.message).toContain('`Verdict:`');
    });

    // D65 1240: the live review hop writes `**Verdict: PASS** — <note>`, which the old
    // whole-line regex rejected as `verdict-missing` and folded a real PASS review to UNKNOWN.
    test('a markdown-wrapped Verdict line with a trailing note is accepted', () => {
        const reply = answer(CLEAN_REQS, CLEAN_ACS, '**Verdict: PASS** — 3 requirements, 2 ACs');
        expect(lintVerifyAnswer(reply, TASK, null)).toEqual([]);
    });

    test('invalid Verdict value is rejected with the line number', () => {
        const findings = lintVerifyAnswer(answer(CLEAN_REQS, CLEAN_ACS, 'Verdict: DONE'), TASK, null);
        expect(findings.length).toBe(1);
        expect(findings[0]?.line).toBe(1);
        expect(findings[0]?.message).toContain('invalid Verdict value "DONE"');
    });

    test('unknown requirement ID is rejected', () => {
        const findings = lintVerifyAnswer(answer(['| RX | MET | done |', ...CLEAN_REQS], CLEAN_ACS), TASK, null);
        expect(findings.some((f) => f.message.includes('unknown requirement ID "RX"'))).toBe(true);
    });

    test('a declared requirement with no row is rejected (completeness)', () => {
        const findings = lintVerifyAnswer(answer([CLEAN_REQS[0] ?? ''], CLEAN_ACS), TASK, null);
        expect(findings.some((f) => f.message.includes('missing requirement row for "R2"'))).toBe(true);
    });

    test('duplicate requirement rows are rejected', () => {
        const findings = lintVerifyAnswer(answer([CLEAN_REQS[0] ?? '', CLEAN_REQS[0] ?? ''], CLEAN_ACS), TASK, null);
        expect(findings.some((f) => f.message.includes('duplicate requirement row "R1"'))).toBe(true);
    });

    test('invalid requirement status (PASS / N/A) is rejected', () => {
        const findings = lintVerifyAnswer(
            answer(['| R1 | PASS | `src/guard.ts:42` |', '| R2 | N/A | `src/log.ts:7` |'], CLEAN_ACS),
            TASK,
            null,
        );
        expect(findings.filter((f) => f.message.includes('invalid status')).length).toBe(2);
    });

    test('empty requirement evidence is rejected', () => {
        const findings = lintVerifyAnswer(answer(['| R1 | MET |  |', CLEAN_REQS[1] ?? ''], CLEAN_ACS), TASK, null);
        expect(findings.some((f) => f.message.includes('"R1" has empty evidence'))).toBe(true);
    });

    test('an AC row matching no declared identity is rejected', () => {
        const findings = lintVerifyAnswer(answer(CLEAN_REQS, ['| AC9 | MET | test | `t.ts:1` |']), TASK, null);
        expect(findings.some((f) => f.message.includes('matches no task AC checklist label or scenario title'))).toBe(
            true,
        );
    });

    test('an ac-identity rejection names the declared identities (1091)', () => {
        const findings = lintVerifyAnswer(answer(CLEAN_REQS, ['| AC9 | MET | test | `t.ts:1` |']), TASK, FEATURE);
        const finding = findings.find((f) => f.rule === 'ac-identity');
        expect(finding).toBeDefined();
        expect(finding?.message).toContain('declared identities');
        expect(finding?.message).toContain('"AC1 (R1)"');
        expect(finding?.message).toContain('"Guard rejects unsafe input"');
    });

    test('a scenario title from the linked feature is a valid AC identity', () => {
        const findings = lintVerifyAnswer(
            answer(CLEAN_REQS, ['| Scenario: Guard rejects unsafe input | MET | test | `tests/guard.test.ts:9` |']),
            TASK,
            FEATURE,
        );
        expect(findings).toEqual([]);
    });

    test('duplicate AC rows are rejected (alias-equivalent message)', () => {
        const findings = lintVerifyAnswer(
            answer(CLEAN_REQS, [
                '| AC1 | MET | test | `tests/guard.test.ts:9` |',
                '| AC1 | MET | test | `tests/guard.test.ts:9` |',
            ]),
            TASK,
            null,
        );
        expect(findings.some((f) => f.message.includes('duplicate AC row "AC1"'))).toBe(true);
        expect(findings.some((f) => f.message.includes('alias-equivalent'))).toBe(true);
    });

    test('invalid AC status, evidence type, and empty evidence are rejected', () => {
        const findings = lintVerifyAnswer(
            answer(CLEAN_REQS, ['| AC1 | DONE | tests |  |', CLEAN_ACS[1] ?? '']),
            TASK,
            null,
        );
        expect(findings.some((f) => f.message.includes('invalid AC status "DONE"'))).toBe(true);
        expect(findings.some((f) => f.message.includes('invalid evidence type "tests"'))).toBe(true);
        expect(findings.some((f) => f.message.includes('has empty evidence'))).toBe(true);
    });

    test('compound evidence types stay valid', () => {
        const findings = lintVerifyAnswer(
            answer(CLEAN_REQS, ['| AC1 | MET | test + command | `bun test` |', CLEAN_ACS[1] ?? '']),
            TASK,
            null,
        );
        expect(findings).toEqual([]);
    });

    test('findings are capped at ANSWER_LINT_MAX_FINDINGS', () => {
        const reqs = Array.from({ length: 12 }, (_, i) => `| RX${i} | BAD |  |`);
        const findings = lintVerifyAnswer(answer(reqs, []), TASK, null);
        expect(ANSWER_LINT_MAX_FINDINGS).toBe(10);
        expect(findings.length).toBe(ANSWER_LINT_MAX_FINDINGS);
    });

    // Coverage-completion cases (task 1003 gate): each exercises a branch the ported
    // suite did not reach — static-ref evidence aliases, stateless stray tables, the
    // heading-less AC table that closes a req table, task-file bold identity forms,
    // and the AC-N positional alias resolution branches.

    test('static-ref evidence aliases lint clean', () => {
        const acs = ['| AC1 | MET | docs | `docs/guard.md:3` |', '| AC2 | PARTIAL | static | readme notes |'];
        expect(lintVerifyAnswer(answer(CLEAN_REQS, acs), TASK, null)).toEqual([]);
    });

    test('stray non-requirement table rows are ignored', () => {
        const stray = ['### Notes', '', '| Item | Detail |', '| --- | --- |', '| lint | clean |', ''];
        const body = answer(CLEAN_REQS, CLEAN_ACS).split('\n');
        expect(lintVerifyAnswer([...stray, ...body].join('\n'), TASK, null)).toEqual([]);
    });

    test('AC header row closes a requirement table without a heading between', () => {
        const body = [
            'Verdict: PASS',
            impliedConfidence(CLEAN_REQS, CLEAN_ACS, 'Verdict: PASS'),
            '',
            '### Per-Requirement Traceability',
            '| Req | Status | Evidence |',
            '| --- | --- | --- |',
            ...CLEAN_REQS,
            '| AC | Status | Evidence Type | Evidence |',
            '| --- | --- | --- | --- |',
            ...CLEAN_ACS,
            '',
        ].join('\n');
        expect(lintVerifyAnswer(body, TASK, null)).toEqual([]);
    });

    test('bold-head bullet and bold-paragraph AC identities resolve', () => {
        const task3 = [
            '## 9001. Lint fixture task',
            '',
            '### Requirements',
            '',
            '- [ ] **R1. First requirement.** Guard the thing.',
            '- [ ] **R2. Second requirement.** Log the thing.',
            '',
            '### Acceptance Criteria',
            '',
            '- [ ] AC1 (R1): the guard rejects an unsafe input.',
            '- **AC2 — Bold head form.** Given an input, when handled, then it is guarded.',
            '',
            '**AC3**',
            'The log records the input.',
            '',
        ].join('\n');
        const acs = [
            '| AC1 | MET | test | `tests/guard.test.ts:9` |',
            '| AC2 | MET | test | `tests/guard.test.ts:14` |',
            '| AC3 | PARTIAL | manual-review | log reviewed |',
        ];
        expect(lintVerifyAnswer(answer(CLEAN_REQS, acs), task3, null)).toEqual([]);
    });

    test('AC-N alias with no scenario at that ordinal is refused with the positional hint', () => {
        const findings = lintVerifyAnswer(answer(CLEAN_REQS, ['| AC-5 | MET | test | `t.ts:1` |']), TASK, null);
        expect(findings.some((f) => f.message.includes('uses the AC-5 positional alias but no scenario exists'))).toBe(
            true,
        );
    });

    test('AC-N alias is ambiguous when task and feature ordinals disagree', () => {
        const task2 = `${TASK}\n\nScenario: Task scenario one\nScenario: Task scenario two\n`;
        const findings = lintVerifyAnswer(answer(CLEAN_REQS, ['| AC-1 | MET | test | `t.ts:1` |']), task2, FEATURE);
        expect(findings.some((f) => f.message.includes('is ambiguous'))).toBe(true);
    });

    test('AC-N alias resolves to a single feature scenario', () => {
        expect(lintVerifyAnswer(answer(CLEAN_REQS, ['| AC-1 | MET | test | `t.ts:1` |']), TASK, FEATURE)).toEqual([]);
    });
});

/**
 * Behavior classes carried over verbatim from the deleted plugin suite (review of task 1003, R4).
 * The old suite drove the script CLI end-to-end; these re-express the same malformed-answer
 * classes against the ported pure lint. File-level cases (absent answer path) remain CLI-covered
 * (apps/cli/tests/commands/task/verdict.test.ts, "verdict exits 1 with an error when the answer file is missing").
 */
describe('ported behavior classes (task 1003 review: R4 port completion)', () => {
    // 0726 feature form: bare `Scenarios:` header with two scenario titles.
    const SCEN_FEATURE = `Scenarios:\n\nScenario: R1 — the importer guard rejects unsafe versions\nScenario: R2 — the precheck proves live evidence\n`;
    const SCEN_TITLE = 'R1 — the importer guard rejects unsafe versions';

    // 0727 form: checkbox requirements with wrapped continuation prose, no declared ACs.
    const TASK_0727 = `## 0727. Fixture task

### Requirements

- [ ] R1. Host-owned stage-todo reconciliation. The driver must reconcile the todo list at
  every transition so nothing is left stuck in_progress.
- [ ] R2. Inline-dispatch timeout and partial-work contract. A dispatch that hangs must time
  out and record the partial-work fate.
- [ ] R3. Run-log timestamps. Every transition entry is timestamped.

### Acceptance Criteria

- AC1: Given a run whose precheck stage finished, when the driver transitions, then the todo
  shows precheck completed.
- AC2: Given a dispatch that hangs, when the timeout fires, then the driver records the fate.
- AC3: Given a transition, when it is logged, then the log line carries a timestamp.
`;

    // 0728 form: four requirement declaration renderings + two AC renderings in one task.
    const TASK_MIXED = `## Mixed. Fixture task

### Requirements

- [x] **R1. Bold checkbox requirement.** Guard the thing.
- [ ] R2. Checkbox requirement. Lint the thing.
- R3. Plain bullet requirement. Trace the thing.
- R4: Colon-lead requirement.

### Acceptance Criteria

- [x] AC1 (R1): first acceptance criterion passes.
- AC2: second acceptance criterion passes.
`;

    const TASK_SUBIDS = `## Sub. Fixture task

### Requirements

- [ ] R1. Parent one.
- [ ] R1.1. Child in checkbox form.
- R2: Parent two.
- R2.1: Child in plain colon form.

### Acceptance Criteria

- [ ] AC1: sub-ID acceptance criterion.
`;

    // 0696 form: column-0 requirement IDs, no list marker, bold title after the ID — the
    // trailing prose pins the terminator rule (a bare `R4` must NOT be extracted).
    const TASK_LINESTART = `## 0696. Fixture task

### Requirements

R1. **Layer 1 comes from the CLI.** Rewrite the reference so layer 1 is obtained from
the todo projection.

R2. **Nothing else in the reference changes.** Layer 2 and the refresh cadence stay.

R3: Colon terminator at line start is also a declaration.

Prose mentioning R4 without a terminator is not a declaration.

### Acceptance Criteria

- AC1: line-start declarations are extracted.
`;

    // 0571 form: checkbox declarations with the list marker omitted; bare `R3` stays unextracted.
    const TASK_MARKERLESS = `## 0571. Fixture task

### Requirements

[x] R1. Engine fix. Accumulate setVars across the sequence.
[ ] R2. Engine regression tests covering the accumulated map.

R3 is mentioned in prose without a terminator and is not a declaration.

### Acceptance Criteria

- AC1: markerless checkbox declarations are extracted.
`;

    // 0817 R3: whole-line bold `**…**` is a declared identity; interpolated bold is not.
    const TASK_BOLD = `## Bold. Fixture task

### Requirements

- R1. Guard the thing.

### Acceptance Criteria

**AC-0817-HERM-SKIP: gains the full spelling.**
`;

    const TASK_BOLD_DOUBLE = `## Bold two. Fixture task

### Acceptance Criteria

**AC-ONE** is met, **AC-TWO** is not met.
`;

    // 0862 R4: single-line criterion bullet whose bold head is an id.
    const TASK_0862 = `## 0862. Fixture task

### Requirements

- [ ] **R1. First requirement.** Guard the thing.
- [ ] **R2. Second requirement.** Lint the thing.

### Acceptance Criteria

- [ ] AC1 (R1): first acceptance criterion passes.
- [ ] **AC2 — The roster runtime is gone (R3).** Given a fleet, when status is read, then no runtime.
`;
    const BOLD_AC_TITLE = 'AC2 — The roster runtime is gone (R3).';

    // 0809 R5: the removal set is exactly ASCII U+0027 + the four curly quotes; U+02BC is
    // a meaningful character and must NOT be treated as removable punctuation.
    const APOSTROPHE_TITLE = "R1 — the guard rejects unsafe user's input versions";
    const APOSTROPHE_FEATURE = `Scenarios:\n\nScenario: ${APOSTROPHE_TITLE}\n`;

    const answerWith = (reqs: string[], acs: string[]): string =>
        answer(
            reqs.map((id, i) => `| ${id} | MET | \`src/f${i}.ts:${i + 1}\` |`),
            acs.map((id, i) => `| ${id} | MET | test | \`tests/f${i}.test.ts:${i + 1}\` |`),
        );

    const AC1_ROW = '| AC1 | MET | test | `tests/f0.test.ts:1` |';
    const AC2_ROW = '| AC2 | MET | test | `tests/f1.test.ts:2` |';

    /** A complete answer whose first AC row is keyed by an arbitrary identity. */
    const acRow = (id: string): string =>
        answerWith(['R1', 'R2'], ['AC1']).replace(AC1_ROW, `| ${id} | MET | test | \`tests/f0.test.ts:1\` |`);

    test('0726-rendered fixture (bold reqs, checkbox ACs) still extracts IDs end-to-end', () => {
        expect(lintVerifyAnswer(answerWith(['R1', 'R2'], ['AC1', 'AC2']), TASK, SCEN_FEATURE)).toEqual([]);
    });

    test('a whitespace-only answer is rejected', () => {
        const findings = lintVerifyAnswer('   \n', TASK, null);
        expect(findings.length).toBeGreaterThan(0);
        expect(findings[0]?.message).toContain('`Verdict:`');
    });

    test('a complete answer using an exact task-local Gherkin scenario title passes', () => {
        const title = 'R1 — task-local behavior is verified';
        const task = `${TASK}\n\`\`\`gherkin\n  Scenario: ${title}\n\`\`\``;
        expect(lintVerifyAnswer(acRow(title), task, SCEN_FEATURE)).toEqual([]);
    });

    test('0727-rendered fixture (checkbox reqs with wrapped prose, no declared ACs) extracts all IDs and passes', () => {
        expect(
            lintVerifyAnswer(answerWith(['R1', 'R2', 'R3'], ['AC1', 'AC2', 'AC3']), TASK_0727, SCEN_FEATURE),
        ).toEqual([]);
    });

    test('mixed fixture (bold + checkbox + plain + colon reqs, checkbox + plain ACs) extracts all IDs', () => {
        expect(lintVerifyAnswer(answerWith(['R1', 'R2', 'R3', 'R4'], ['AC1', 'AC2']), TASK_MIXED, null)).toEqual([]);
    });

    test('line-start fixture (0696 form: column-0 IDs, no list marker) extracts via the terminator rule', () => {
        expect(lintVerifyAnswer(answerWith(['R1', 'R2', 'R3'], ['AC1']), TASK_LINESTART, null)).toEqual([]);
    });

    test('a bare line-start ID reference without a `.`/`:` terminator is not a declaration', () => {
        const findings = lintVerifyAnswer(answerWith(['R1', 'R2', 'R3', 'R4'], ['AC1']), TASK_LINESTART, null);
        expect(findings.some((f) => f.message.includes('unknown requirement ID "R4"'))).toBe(true);
        expect(findings.some((f) => f.message.includes('task declares: R1, R2, R3'))).toBe(true);
    });

    test('markerless checkbox fixture (0571 form: `[x] R1.` with no list marker) extracts IDs', () => {
        expect(lintVerifyAnswer(answerWith(['R1', 'R2'], ['AC1']), TASK_MARKERLESS, null)).toEqual([]);
    });

    test('marker and checkbox are never both optional — bare prose `R3` is not a declaration', () => {
        const findings = lintVerifyAnswer(answerWith(['R1', 'R2', 'R3'], ['AC1']), TASK_MARKERLESS, null);
        expect(findings.some((f) => f.message.includes('unknown requirement ID "R3"'))).toBe(true);
        expect(findings.some((f) => f.message.includes('task declares: R1, R2'))).toBe(true);
    });

    test('sub-ID R1.1 is recognized in checkbox and plain forms', () => {
        expect(lintVerifyAnswer(answerWith(['R1', 'R1.1', 'R2', 'R2.1'], ['AC1']), TASK_SUBIDS, null)).toEqual([]);
    });

    test('whole-line bold `**AC id**` paragraph declares the id (task 0817 R3)', () => {
        expect(lintVerifyAnswer(answerWith(['R1'], ['AC-0817-HERM-SKIP']), TASK_BOLD, null)).toEqual([]);
    });

    test('two bold spans on one line are not a bold-trajectory declaration (task 0817 R3)', () => {
        const findings = lintVerifyAnswer(answerWith([], ['AC-TWO']), TASK_BOLD_DOUBLE, null);
        expect(findings.some((f) => f.message.includes('matches no task AC checklist label or scenario title'))).toBe(
            true,
        );
    });

    test('the `Scenario:` prefix form resolves to the same identity as the bare title', () => {
        expect(lintVerifyAnswer(acRow(`Scenario: ${SCEN_TITLE}`), TASK, SCEN_FEATURE)).toEqual([]);
    });

    test('a bare scenario title from the linked feature resolves as an AC row key', () => {
        expect(lintVerifyAnswer(acRow(SCEN_TITLE), TASK, SCEN_FEATURE)).toEqual([]);
    });

    test('alias-equivalent spellings of one identity are duplicates (scenario + bare title)', () => {
        const dup = `| Scenario: ${SCEN_TITLE} | MET | test | \`tests/f0.test.ts:1\` |\n| ${SCEN_TITLE} | MET | test | \`tests/f0.test.ts:1\` |`;
        const findings = lintVerifyAnswer(answerWith(['R1', 'R2'], ['AC1']).replace(AC1_ROW, dup), TASK, SCEN_FEATURE);
        expect(findings.some((f) => f.message.includes('alias-equivalent'))).toBe(true);
    });

    test('an undeclared ACn token (no hyphen) is never a positional alias', () => {
        const findings = lintVerifyAnswer(acRow('AC3'), TASK, SCEN_FEATURE);
        expect(findings.some((f) => f.message.includes('matches no task AC checklist label or scenario title'))).toBe(
            true,
        );
    });

    test('AC-N with no scenario at that ordinal fails and the ambiguity message names both scenarios', () => {
        const task2 = `${TASK}\n\nScenario: task-first scenario about the guard\nScenario: task-second scenario about the lint\n`;
        const findings = lintVerifyAnswer(
            answer(CLEAN_REQS, ['| AC-1 | MET | test | `t.ts:1` |']),
            task2,
            SCEN_FEATURE,
        );
        expect(findings.some((f) => f.message.includes('ambiguous'))).toBe(true);
        expect(findings.some((f) => f.message.includes('task-first scenario about the guard'))).toBe(true);
        expect(findings.some((f) => f.message.includes(SCEN_TITLE))).toBe(true);
    });

    test('a paraphrase never resolves, even when it describes the same AC', () => {
        const findings = lintVerifyAnswer(acRow('the guard rejects bad importers overall'), TASK, SCEN_FEATURE);
        expect(findings.some((f) => f.message.includes('matches no task AC checklist label or scenario title'))).toBe(
            true,
        );
    });

    test('an explicitly declared AC-1 checklist token resolves exactly', () => {
        const task = TASK.replace(
            '- [ ] AC1 (R1): the guard rejects an unsafe input.',
            '- [ ] AC-1 (R1): the guard rejects an unsafe input.',
        );
        expect(lintVerifyAnswer(acRow('AC-1'), task, null)).toEqual([]);
    });

    test('the quote-normalized alias of an ASCII-apostrophe title passes (U+2019 answer vs U+0027 declared)', () => {
        expect(lintVerifyAnswer(acRow(APOSTROPHE_TITLE.replace("'", '\u2019')), TASK, APOSTROPHE_FEATURE)).toEqual([]);
    });

    test('quote-equivalent spellings of one identity are still duplicates', () => {
        const dup = `| ${APOSTROPHE_TITLE} | MET | test | \`tests/f0.test.ts:1\` |\n| ${APOSTROPHE_TITLE.replace("'", '\u2019')} | MET | test | \`tests/f0.test.ts:1\` |`;
        const findings = lintVerifyAnswer(
            answerWith(['R1', 'R2'], ['AC1']).replace(AC1_ROW, dup),
            TASK,
            APOSTROPHE_FEATURE,
        );
        expect(findings.some((f) => f.message.includes('alias-equivalent'))).toBe(true);
    });

    test('U+02BC is not treated as removable punctuation (negative case)', () => {
        const findings = lintVerifyAnswer(acRow(APOSTROPHE_TITLE.replace("'", '\u02bc')), TASK, APOSTROPHE_FEATURE);
        expect(findings.some((f) => f.message.includes('matches no task AC checklist label or scenario title'))).toBe(
            true,
        );
    });

    test('an answer row keyed by the bold head token resolves (0862 R4)', () => {
        expect(lintVerifyAnswer(answerWith(['R1', 'R2'], ['AC1', 'AC2']), TASK_0862, null)).toEqual([]);
    });

    test('an answer row keyed by the full bold title resolves', () => {
        const ans = answerWith(['R1', 'R2'], ['AC1', 'AC2']).replace(
            AC2_ROW,
            `| ${BOLD_AC_TITLE} | MET | test | \`tests/f0.test.ts:1\` |`,
        );
        expect(lintVerifyAnswer(ans, TASK_0862, null)).toEqual([]);
    });

    test('the bold title resolves without its sentence-final period', () => {
        const ans = answerWith(['R1', 'R2'], ['AC1', 'AC2']).replace(
            AC2_ROW,
            `| ${BOLD_AC_TITLE.replace(/\.$/, '')} | MET | test | \`tests/f0.test.ts:1\` |`,
        );
        expect(lintVerifyAnswer(ans, TASK_0862, null)).toEqual([]);
    });

    test('the refusal hint names the bold-head form', () => {
        const findings = lintVerifyAnswer(answerWith(['R1', 'R2'], ['AC1', 'AC9']), TASK_0862, null);
        expect(findings.some((f) => f.message.includes("a criterion bullet's bold head or full bold span"))).toBe(true);
    });
});

describe('evidence-hedged: uncertainty phrases in MET evidence are rejected', () => {
    test.each([
        ['likely', 'the guard likely prevents the leak'],
        ['unlikely', 'a rerun is unlikely to pass without the fix'],
        ['probably', 'the launcher probably inherits the env'],
        ['presumably', 'the twin presumably picked up the lib change'],
        ['apparently', 'the bundle is apparently stale'],
        ['seems to', 'the guard seems to block the stale path'],
        ['appears to', 'the receipt appears to be written'],
        ['it could', 'it could regress under load'],
    ])('%s in MET evidence is rejected, row-addressed', (phrase, evidence) => {
        const findings = lintVerifyAnswer(
            answer([`| R1 | MET | ${evidence} |`, '| R2 | MET | `src/log.ts:7` |'], CLEAN_ACS),
            TASK,
            null,
        );
        expect(findings.some((f) => f.rule === 'evidence-hedged' && f.line === 6 && f.message.includes(phrase))).toBe(
            true,
        );
    });

    test('case-insensitive: "Likely" is flagged', () => {
        const findings = lintVerifyAnswer(
            answer(['| R1 | MET | Likely fixed by the guard |', '| R2 | MET | `src/log.ts:7` |'], CLEAN_ACS),
            TASK,
            null,
        );
        expect(findings.some((f) => f.rule === 'evidence-hedged')).toBe(true);
    });

    test('hedge in an UNMET row lints clean — hedging a gap is honest', () => {
        expect(
            lintVerifyAnswer(
                answer(
                    [
                        '| R1 | UNMET | the stale path likely still loads the old bundle |',
                        '| R2 | MET | `src/log.ts:7` |',
                    ],
                    CLEAN_ACS,
                ),
                TASK,
                null,
            ),
        ).toEqual([]);
    });

    test('hedge inside a citation span or backticked code lints clean', () => {
        expect(
            lintVerifyAnswer(
                answer(
                    ['| R1 | MET | rerun per `src/likely-match.test.ts:9` passes |', '| R2 | MET | `src/log.ts:7` |'],
                    CLEAN_ACS,
                ),
                TASK,
                null,
            ),
        ).toEqual([]);
    });

    test('hedged AC MET evidence is rejected', () => {
        const findings = lintVerifyAnswer(
            answer(CLEAN_REQS, ['| AC1 | MET | test | the fixture likely covers the branch |', CLEAN_ACS[1] ?? '']),
            TASK,
            null,
        );
        expect(findings.some((f) => f.rule === 'evidence-hedged')).toBe(true);
    });

    test('the refusal names both remedies: deterministic anchor or PARTIAL', () => {
        const findings = lintVerifyAnswer(
            answer(['| R1 | MET | the guard likely prevents the leak |', '| R2 | MET | `src/log.ts:7` |'], CLEAN_ACS),
            TASK,
            null,
        );
        expect(findings.some((f) => f.message.includes('PARTIAL'))).toBe(true);
    });

    // The bare modal stays excluded by design (remediation prose is full of it), so the
    // phrase-level exception above cannot widen into "any sentence with 'could'".
    test('a bare modal with no subject construction is NOT a hedge', () => {
        for (const evidence of ['could regress under load', 'the guard could fail on the stale path']) {
            const findings = lintVerifyAnswer(
                answer([`| R1 | MET | ${evidence} |`, '| R2 | MET | `src/log.ts:7` |'], CLEAN_ACS),
                TASK,
                null,
            );
            expect(findings.filter((f) => f.rule === 'evidence-hedged')).toEqual([]);
        }
    });

    test('the phrase survives case and citation-span stripping rules', () => {
        const flagged = lintVerifyAnswer(
            answer(['| R1 | MET | It Could regress under load |', '| R2 | MET | `src/log.ts:7` |'], CLEAN_ACS),
            TASK,
            null,
        );
        expect(flagged.some((f) => f.rule === 'evidence-hedged' && f.message.includes('it could'))).toBe(true);
        // Inside a citation span it is a filename/quote, not an assertion.
        const cited = lintVerifyAnswer(
            answer(
                ['| R1 | MET | rerun per `src/it-could.test.ts:9` passes |', '| R2 | MET | `src/log.ts:7` |'],
                CLEAN_ACS,
            ),
            TASK,
            null,
        );
        expect(cited.filter((f) => f.rule === 'evidence-hedged')).toEqual([]);
    });
});

describe('evidence-citation (task 1070 R1-R4): API/library claims need a same-cell citation', () => {
    const cited = (evidence: string, reqs = ['R1', 'R2']) =>
        answer(
            [`| R1 | MET | ${evidence} |`, '| R2 | MET | `src/log.ts:7` |'].filter((_, i) => i < reqs.length),
            CLEAN_ACS,
        );

    test('scoped-package claim without a citation is rejected, row-addressed', () => {
        const findings = lintVerifyAnswer(
            cited('installed @gobing-ai/ts-llm-jsonl-importer exports the classifier'),
            TASK,
            null,
        );
        expect(findings.some((f) => f.rule === 'evidence-citation' && f.line === 6)).toBe(true);
    });

    test('node_modules claim without a citation is rejected', () => {
        const findings = lintVerifyAnswer(cited('node_modules/@scope/pkg ships the new API'), TASK, null);
        expect(findings.some((f) => f.rule === 'evidence-citation')).toBe(true);
    });

    test('semver version claim without a citation is rejected', () => {
        const findings = lintVerifyAnswer(cited('upstream 0.5.12 narrows name-to-path-to-digest'), TASK, null);
        expect(findings.some((f) => f.rule === 'evidence-citation')).toBe(true);
    });

    test('backticked function-call token without a citation is rejected', () => {
        const findings = lintVerifyAnswer(cited('`matchCapabilityOrigin(name)` never guesses a kind'), TASK, null);
        expect(findings.some((f) => f.rule === 'evidence-citation')).toBe(true);
    });

    test.each([
        ['backticked path:line', 'upstream 0.5.12 classifier at `src/capability.ts:83`'],
        ['backticked path:line-end', 'upstream 0.5.12 classifier at `src/capability.ts:83-115`'],
        ['external named-origin form', '@gobing-ai/ts-llm-jsonl-importer `src/capability.ts` line 83'],
        ['external form plural lines', '@gobing-ai/ts-llm-jsonl-importer `src/capability.ts` lines 83-115'],
        ['bare path.ext:line', 'installed 0.5.12 per packages/app/src/services/foo.ts:42'],
        ['URL', 'resolver semantics per https://example.com/spec#resolver for @scope/pkg'],
    ])('claim with a %s citation lints clean', (_label, evidence) => {
        expect(lintVerifyAnswer(cited(evidence), TASK, null)).toEqual([]);
    });

    test('marker-free receipts lint clean without a citation', () => {
        expect(lintVerifyAnswer(cited('bun test 398 pass / 0 fail this run'), TASK, null)).toEqual([]);
        expect(lintVerifyAnswer(cited('log file reviewed'), TASK, null)).toEqual([]);
    });

    test('time-like tokens are neither markers nor citations', () => {
        // `00:04` must not satisfy the citation requirement for a real claim…
        const findings = lintVerifyAnswer(cited('@scope/pkg bucket 00:04 materializes ok'), TASK, null);
        expect(findings.some((f) => f.rule === 'evidence-citation')).toBe(true);
        // …and a marker-free cell carrying times stays clean.
        expect(lintVerifyAnswer(cited('bucket 00:04 materializes ok; 8/3 oracle holds'), TASK, null)).toEqual([]);
    });

    test('citations do not leak across rows', () => {
        const findings = lintVerifyAnswer(
            answer(
                [
                    '| R1 | MET | upstream 0.5.12 at `src/capability.ts:83` |',
                    '| R2 | MET | upstream 0.5.12 also changed |',
                ],
                CLEAN_ACS,
            ),
            TASK,
            null,
        );
        expect(findings.length).toBe(1);
        expect(findings[0]?.rule).toBe('evidence-citation');
        expect(findings[0]?.line).toBe(7);
        expect(findings[0]?.message).toContain('"R2"');
    });

    test('AC evidence cells are checked too', () => {
        const findings = lintVerifyAnswer(
            answer(CLEAN_REQS, [
                '| AC1 | MET | test | `matchCapabilityOrigin(name)` narrows without guessing |',
                '| AC2 | PARTIAL | manual-review | log file reviewed |',
            ]),
            TASK,
            null,
        );
        expect(findings.some((f) => f.rule === 'evidence-citation' && f.message.includes('AC1'))).toBe(true);
    });
});

describe('AC identities containing colons (task 1118)', () => {
    const COLON_TASK = `
## 9002. Colon fixture task

### Requirements

- [ ] **R1. Inventory.** Name the anchor.

### Acceptance Criteria

- [ ] AC1 — The inventory names the \`file:line\` anchor for every surface (req: R1)
`;

    test('an AC title containing a colon resolves verbatim (0213 regression)', () => {
        const findings = lintVerifyAnswer(
            answer(
                ['| R1 | MET | done |'],
                [
                    '| AC1 — The inventory names the `file:line` anchor for every surface (req: R1) | MET | test | `t.ts:1` |',
                ],
            ),
            COLON_TASK,
            null,
        );
        expect(findings).toEqual([]);
    });

    test('every colon form resolves verbatim: backticks, URL, bare prose colon, (req:) suffix (1118 AC1)', () => {
        const task = `\n## 9003. Colon forms task\n\n### Requirements\n\n- [ ] **R1. Anchors.** Name them.\n\n### Acceptance Criteria\n\n- [ ] AC1 — The inventory names the \`file:line\` of each surface\n- [ ] AC2 — Docs link http://example.test/x\n- [ ] AC3 — Output shows: a summary\n- [ ] AC4 — Gate passes (req: R1)\n`;
        const acs = [
            '| AC1 — The inventory names the `file:line` of each surface | MET | test | `t.ts:1` |',
            '| AC2 — Docs link http://example.test/x | MET | test | `t.ts:2` |',
            '| AC3 — Output shows: a summary | MET | test | `t.ts:3` |',
            '| AC4 — Gate passes (req: R1) | MET | test | `t.ts:4` |',
        ];
        expect(lintVerifyAnswer(answer(['| R1 | MET | done |'], acs), task, null)).toEqual([]);
    });

    test('legacy colon-headed rows still resolve by their head', () => {
        const findings = lintVerifyAnswer(
            answer(CLEAN_REQS, ['| AC1 (R1) | MET | test | `t.ts:1` |', CLEAN_ACS[1] ?? '']),
            TASK,
            null,
        );
        expect(findings).toEqual([]);
    });

    test('the truncated pre-colon head is no longer a declared identity', () => {
        // Before 1118 the declared identity stopped at the first colon, so only the junk
        // truncated head resolved while the verbatim title did not. After the fix the full
        // title resolves and the junk head is gone — citing it is rejected.
        const junk = lintVerifyAnswer(
            answer(['| R1 | MET | done |'], ['| AC1 — The inventory names the `file | MET | test | `t.ts:1` |']),
            COLON_TASK,
            null,
        );
        expect(junk.some((f) => f.rule === 'ac-identity')).toBe(true);
    });

    test('the unbalanced parenthetical colon-head is no longer a declared identity (session 1209 garble)', () => {
        // The runall-1208/1209 verify answers cited `… every surface (req` — the head the old
        // first-colon split declared for `(req: R1)` labels. That garbled form must be rejected
        // so the lint steers the verifier to the verbatim label instead of blessing the truncation.
        const garbled = lintVerifyAnswer(
            answer(
                ['| R1 | MET | done |'],
                ['| AC1 — The inventory names the `file:line` anchor for every surface (req | MET | test | `t.ts:1` |'],
            ),
            COLON_TASK,
            null,
        );
        expect(garbled.some((f) => f.rule === 'ac-identity')).toBe(true);
    });

    test('the balanced `(req: R1)` head resolves for labels with a trailing Given-clause colon', () => {
        // Labels shaped like `AC1 — Title (req: R1): Given …` declare the balanced title-with-paren
        // form as a head, so the natural citation — label minus the scenario clause — resolves.
        const task = `
## 9004. Paren clause task

### Requirements

- [ ] **R1. Gate.** Pass it.

### Acceptance Criteria

- [ ] AC1 — Gate passes (req: R1): Given a thing, when checked, then it passes
`;
        const findings = lintVerifyAnswer(
            answer(['| R1 | MET | done |'], ['| AC1 — Gate passes (req: R1) | MET | test | `t.ts:1` |']),
            task,
            null,
        );
        expect(findings).toEqual([]);
    });
});

describe('confidence cross-check (ADR-141)', () => {
    const HIGH_ACS = ['| AC1 | MET | test | `tests/f0.test.ts:1` |'];
    const HIGH_REQS = ['| R1 | MET | `src/f0.ts:1` |', '| R2 | MET | `src/f1.ts:2` |'];

    test('a missing line is rejected and names the level the rows derive', () => {
        const noLine = answer(HIGH_REQS, HIGH_ACS).replace(/^Confidence:.*\n?/m, '');
        const findings = lintVerifyAnswer(noLine, TASK, null);
        expect(findings.map((f) => f.rule)).toContain('confidence-missing');
        expect(findings.find((f) => f.rule === 'confidence-missing')?.message).toContain('Confidence: HIGH');
    });

    test('a stated level the rows do not support is rejected, naming stated and derived', () => {
        const overstated = answer(
            HIGH_REQS,
            ['| AC1 | PARTIAL | manual-review | log reviewed |'],
            undefined,
            'Confidence: HIGH',
        );
        const mismatch = lintVerifyAnswer(overstated, TASK, null).find((f) => f.rule === 'confidence-mismatch');
        expect(mismatch).toBeDefined();
        expect(mismatch?.message).toContain('Confidence: HIGH');
        expect(mismatch?.message).toContain('derive LOW');
    });

    test('a MEDIUM answer whose ACs rest on citations is accepted as stated', () => {
        const medium = answer(
            HIGH_REQS,
            ['| AC1 | MET | static-ref | `src/f0.ts:1` |'],
            undefined,
            'Confidence: MEDIUM',
        );
        expect(lintVerifyAnswer(medium, TASK, null)).toEqual([]);
    });

    test('two lines are rejected as a duplicate', () => {
        const twice = answer(HIGH_REQS, HIGH_ACS) + '\nConfidence: HIGH\n';
        expect(lintVerifyAnswer(twice, TASK, null).map((f) => f.rule)).toContain('confidence-duplicate');
    });
});
