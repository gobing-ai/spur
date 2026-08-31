import { describe, expect, test } from 'bun:test';
import {
    type AttributionEvidence,
    classifyTaskAttribution,
    emptyAttributionSummary,
} from '../../src/analytics/task-attribution';

function user(text: string, line = 1): AttributionEvidence {
    return {
        kind: 'user-message',
        text,
        recordHash: `hash-${line}`,
        sourceFile: '/home/u/.pi/sessions/a.jsonl',
        sourceLine: line,
    };
}

function tool(text: string, line = 9): AttributionEvidence {
    return {
        kind: 'tool-call',
        text,
        recordHash: `hash-t${line}`,
        sourceFile: '/home/u/.pi/sessions/a.jsonl',
        sourceLine: line,
    };
}

describe('classifyTaskAttribution (task 0722 R3)', () => {
    test('a task-scoped /sp:dev-* invocation yields a slash-command candidate (positive)', () => {
        const decision = classifyTaskAttribution([user('/sp:dev-run --mode implement 0703 --auto')]);
        expect(decision.candidates).toEqual([
            {
                wbs: '0703',
                mechanism: 'slash-command',
                evidenceKind: 'user-command',
                evidenceRef: 'a.jsonl#1',
            },
        ]);
        expect(decision.skipped).toBe(0);
        expect(decision.ambiguous).toBe(0);
    });

    test('a sp-dev (dash) invocation matches the same allowlist', () => {
        const decision = classifyTaskAttribution([user('/sp-dev-next 0507')]);
        expect(decision.candidates.map((c) => c.wbs)).toEqual(['0507']);
        expect(decision.candidates[0]?.mechanism).toBe('slash-command');
    });

    test('one session may yield several WBS links (multi-task, R2)', () => {
        const decision = classifyTaskAttribution([
            user('/sp:dev-run --mode implement 0703 --auto'),
            user('/sp:dev-run --mode implement 0704 --auto', 2),
            tool('bun run spur task update 0705 --solution done'),
        ]);
        expect(decision.candidates.map((c) => c.wbs)).toEqual(['0703', '0704', '0705']);
        expect(decision.candidates[2]?.evidenceKind).toBe('cli-tool');
        expect(decision.candidates[2]?.mechanism).toBe('spur-cli');
    });

    test('a structured spur task <verb> <wbs> tool operation is a spur-cli candidate', () => {
        const decision = classifyTaskAttribution([tool('bun run spur task check 0638')]);
        expect(decision.candidates).toHaveLength(1);
        expect(decision.candidates[0]).toMatchObject({ wbs: '0638', mechanism: 'spur-cli', evidenceKind: 'cli-tool' });
    });

    test('plain four-digit prose in a user message is skipped, never a link (R9)', () => {
        const decision = classifyTaskAttribution([user('task 0703 should have been finished last sprint')]);
        expect(decision.candidates).toEqual([]);
        expect(decision.skipped).toBe(1);
    });

    test('a pasted task specification is skipped, never a link (R9)', () => {
        const spec = [
            'Here is the specification I pasted:',
            '## 0703. Some task title',
            'wbs: 0704',
            'status: todo',
            'requirements R1 through R9 with numbers 2026 and 0.4.38 inline',
        ].join('\n');
        const decision = classifyTaskAttribution([user(spec)]);
        expect(decision.candidates).toEqual([]);
        expect(decision.skipped).toBe(1);
    });

    test('dates, versions, and paths inside a command never become candidates', () => {
        const decision = classifyTaskAttribution([user('/sp-dev-run --since 2026-08-30 --out /x/0.4.38.tar')]);
        expect(decision.candidates).toEqual([]);
    });

    test('conflicting extractor evidence in one record is ambiguous, never a link (R9)', () => {
        const decision = classifyTaskAttribution([user('/sp:dev-run 0703\nthen ran: spur task show 0704')]);
        expect(decision.candidates).toEqual([]);
        expect(decision.ambiguous).toBe(1);
    });

    test('agreeing extractors in one record produce one candidate per WBS', () => {
        const decision = classifyTaskAttribution([user('/sp:dev-run 0703\nthen ran: spur task show 0703')]);
        expect(decision.candidates.map((c) => c.wbs)).toEqual(['0703']);
        expect(decision.ambiguous).toBe(0);
    });

    test('a slash invocation without a WBS operand is not evidence at all', () => {
        const decision = classifyTaskAttribution([user('/sp-dev-next')]);
        expect(decision.candidates).toEqual([]);
        expect(decision.skipped).toBe(0);
    });

    test('tool-call records never count plain mentions (args legitimately contain numbers)', () => {
        const decision = classifyTaskAttribution([tool('bun run check 0703 0704 2026')]);
        expect(decision.candidates).toEqual([]);
        expect(decision.skipped).toBe(0);
    });

    test('the classifier is deterministic (dry-run and write share decisions, R3)', () => {
        const records = [user('/sp:dev-run --mode implement 0703 --auto'), tool('spur task show 0704')];
        const first = classifyTaskAttribution(records);
        const second = classifyTaskAttribution(records);
        expect(second).toEqual(first);
    });
});

describe('attribution summary accumulator', () => {
    test('emptyAttributionSummary zeroes every counter', () => {
        expect(emptyAttributionSummary()).toEqual({
            sessionsEvaluated: 0,
            linksCreated: 0,
            linksAlreadyPresent: 0,
            skippedEvidence: 0,
            ambiguousEvidence: 0,
        });
    });
});
