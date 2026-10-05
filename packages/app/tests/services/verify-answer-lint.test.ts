/**
 * verify-answer-lint — behavior cases for the pure lint (task 1003 R1/R4).
 *
 * Ported from the deleted plugin test `plugins/sp/tests/verify-answer-lint.test.ts`: the same
 * malformed-answer classes the pipeline used to reject through the script CLI are rejected by
 * `lintVerifyAnswer`, which `spur task verdict` now runs before `deriveVerdict` (1003 R2).
 * The CLI exit path (exit 1, `lintFindings`, no artifact) is covered by
 * apps/cli/tests/commands/task.test.ts and plugins/sp/tests/dispatch-handoff-contract.test.ts.
 */
import { describe, expect, test } from 'bun:test';
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

function answer(reqs: string[], acs: string[], verdict = 'Verdict: PASS', confidence = 'Confidence: HIGH'): string {
    return [
        verdict,
        confidence,
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

    test('missing `Verdict:` line is rejected', () => {
        const findings = lintVerifyAnswer(answer(CLEAN_REQS, CLEAN_ACS, 'no verdict line'), TASK, null);
        expect(findings.length).toBe(1);
        expect(findings[0]?.message).toContain('`Verdict:`');
    });

    test('invalid Verdict value is rejected with the line number', () => {
        const findings = lintVerifyAnswer(answer(CLEAN_REQS, CLEAN_ACS, 'Verdict: DONE'), TASK, null);
        expect(findings.length).toBe(1);
        expect(findings[0]?.line).toBe(1);
        expect(findings[0]?.message).toContain('invalid Verdict value "DONE"');
    });

    test('missing `Confidence:` line is rejected (1068 R2)', () => {
        const findings = lintVerifyAnswer(answer(CLEAN_REQS, CLEAN_ACS, 'Verdict: PASS', ''), TASK, null);
        expect(findings.length).toBe(1);
        expect(findings[0]?.rule).toBe('confidence-missing');
        expect(findings[0]?.message).toContain('`Confidence:`');
    });

    test('invalid Confidence value is rejected with the line number (1068 R2)', () => {
        const findings = lintVerifyAnswer(
            answer(CLEAN_REQS, CLEAN_ACS, 'Verdict: PASS', 'Confidence: SURE'),
            TASK,
            null,
        );
        expect(findings.length).toBe(1);
        expect(findings[0]?.rule).toBe('confidence-value');
        expect(findings[0]?.line).toBe(2);
        expect(findings[0]?.message).toContain('invalid Confidence value "SURE"');
    });

    test.each(['HIGH', 'MEDIUM', 'LOW'])('Confidence: %s is accepted (1068 R2)', (level) => {
        const findings = lintVerifyAnswer(
            answer(CLEAN_REQS, CLEAN_ACS, 'Verdict: PASS', `Confidence: ${level}`),
            TASK,
            null,
        );
        expect(findings).toEqual([]);
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
            'Confidence: HIGH',
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
 * (apps/cli/tests/commands/task.test.ts, "verdict exits 1 with an error when the answer file is missing").
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
        expect(findings.some((f) => f.rule === 'evidence-citation' && f.line === 7)).toBe(true);
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
        expect(findings[0]?.line).toBe(8);
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
