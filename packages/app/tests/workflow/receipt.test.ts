import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import {
    readReceipt,
    readWorkItem,
    receiptPath,
    validateWorkItemReceipt,
    type WorkItem,
    type WorkItemReceipt,
    workItemPath,
    writeReceipt,
    writeWorkItem,
} from '../../src/workflow/receipt';

const TASK_FILE = 'docs/tasks5/1232_task.md';

const TASK_BODY = `### Background

Filled.

### Solution

Changed receipt.ts:12 to validate the receipt.
`;

function workdir(): string {
    return mkdtempSync(join(tmpdir(), 'spur-receipt-'));
}

function workItem(overrides: Partial<WorkItem> = {}): WorkItem {
    return {
        runId: 'run-1',
        state: 'implement',
        skill: 'sp-code-implementation',
        prompt: 'Implement task 1232',
        inputs: [{ path: TASK_FILE, kind: 'task' }],
        expectFiles: ['.spur/run/out.txt'],
        ownedSections: ['Solution'],
        ...overrides,
    };
}

function receipt(overrides: Partial<WorkItemReceipt> = {}): WorkItemReceipt {
    return {
        runId: 'run-1',
        state: 'implement',
        executor: 'host',
        outcome: 'done',
        startedAt: '2026-10-17T10:00:00.000Z',
        finishedAt: '2026-10-17T10:05:00.000Z',
        files: ['.spur/run/out.txt'],
        reason: null,
        ...overrides,
    };
}

/** Seed a workdir with the task file and the artifact the receipt claims. */
function seeded(): string {
    const dir = workdir();
    mkdirSync(dirname(join(dir, TASK_FILE)), { recursive: true });
    writeFileSync(join(dir, TASK_FILE), TASK_BODY, 'utf8');
    mkdirSync(dirname(join(dir, '.spur/run/out.txt')), { recursive: true });
    writeFileSync(join(dir, '.spur/run/out.txt'), 'implemented', 'utf8');
    return dir;
}

describe('work item', () => {
    test('writes and reads the §4.1 shape at one durable path per run', async () => {
        const dir = workdir();
        const fs = createNodeFileSystem(dir);
        const target = await writeWorkItem(fs, dir, workItem());

        expect(target).toBe(workItemPath(dir, 'run-1'));
        expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual(workItem());
        expect(await readWorkItem(fs, dir, 'run-1')).toEqual(workItem());
    });

    test('a second host pause overwrites the run work item — one current work item per run', async () => {
        const dir = workdir();
        const fs = createNodeFileSystem(dir);
        await writeWorkItem(fs, dir, workItem());
        await writeWorkItem(fs, dir, workItem({ state: 'review', prompt: 'Review task 1232' }));

        expect(await readWorkItem(fs, dir, 'run-1')).toEqual(workItem({ state: 'review', prompt: 'Review task 1232' }));
    });

    test('a missing or malformed work item reads as null instead of throwing', async () => {
        const dir = workdir();
        const fs = createNodeFileSystem(dir);
        expect(await readWorkItem(fs, dir, 'run-1')).toBeNull();

        mkdirSync(dirname(workItemPath(dir, 'run-1')), { recursive: true });
        writeFileSync(workItemPath(dir, 'run-1'), '{"runId":"run-1"}', 'utf8');
        expect(await readWorkItem(fs, dir, 'run-1')).toBeNull();
    });

    test('refuses to build a path from a run id that is not a single segment', () => {
        expect(() => workItemPath('/tmp/p', '../escape')).toThrow(/single path segment/);
        expect(() => receiptPath('/tmp/p', 'run-1', 'a/b')).toThrow(/single path segment/);
    });
});

describe('receipt', () => {
    test('writes the §4.2 shape at the run receipts path and reads it back', async () => {
        const dir = workdir();
        const fs = createNodeFileSystem(dir);
        const target = await writeReceipt(fs, dir, receipt());

        expect(target).toBe(receiptPath(dir, 'run-1', 'implement'));
        expect(await readReceipt(fs, dir, target)).toEqual(receipt());
    });

    test('reads a receipt from a path outside the run receipts dir — the host owns its file', async () => {
        const dir = workdir();
        const fs = createNodeFileSystem(dir);
        const staged = join(dir, '.spur', 'run', 'host-receipt.json');
        mkdirSync(dirname(staged), { recursive: true });
        writeFileSync(staged, JSON.stringify(receipt()), 'utf8');

        expect(await readReceipt(fs, dir, '.spur/run/host-receipt.json')).toEqual(receipt());
    });
});

describe('host receipt validation', () => {
    const fs = () => createNodeFileSystem();

    test('accepts a done receipt whose expectFiles exist and whose owned sections are written', async () => {
        const dir = seeded();
        const check = await validateWorkItemReceipt(fs(), dir, workItem(), receipt());
        expect(check).toEqual({ ok: true });
    });

    // Failure mode 1: the host never produced a receipt.
    test('refuses a missing receipt', async () => {
        const dir = seeded();
        const check = await validateWorkItemReceipt(fs(), dir, workItem(), null);
        expect(check.ok).toBe(false);
        expect(check.ok ? '' : check.error).toMatch(/receipt .*could not be read/);
    });

    // Failure mode 2: the receipt is for another run or state (stale).
    test('refuses a receipt from another run and one from another state', async () => {
        const dir = seeded();
        const otherRun = await validateWorkItemReceipt(fs(), dir, workItem(), receipt({ runId: 'run-2' }));
        expect(otherRun.ok).toBe(false);
        expect(otherRun.ok ? '' : otherRun.error).toMatch(/runId 'run-2' does not match run 'run-1'/);

        const otherState = await validateWorkItemReceipt(fs(), dir, workItem(), receipt({ state: 'precheck' }));
        expect(otherState.ok).toBe(false);
        expect(otherState.ok ? '' : otherState.error).toMatch(
            /state 'precheck' does not match paused state 'implement'/,
        );
    });

    // Failure mode 3: the host produced only part of the declared files.
    test('refuses a receipt whose expectFiles are only partly present, naming the missing file', async () => {
        const dir = seeded();
        const item = workItem({ expectFiles: ['.spur/run/out.txt', '.spur/run/summary.md'] });
        const check = await validateWorkItemReceipt(fs(), dir, item, receipt());
        expect(check.ok).toBe(false);
        expect(check.ok ? '' : check.error).toMatch(
            /expected file\(s\) missing after the host run: \.spur\/run\/summary\.md/,
        );
    });

    // ADR-126 A4: every outcome other than `done` refuses, and names the outcome.
    test('refuses every non-done outcome, naming it (a timeout is outcome-unknown, never failure)', async () => {
        const dir = seeded();
        for (const outcome of ['failed', 'not-started', 'outcome-unknown', 'contract-violation'] as const) {
            const check = await validateWorkItemReceipt(fs(), dir, workItem(), receipt({ outcome }));
            expect(check.ok).toBe(false);
            expect(check.ok ? '' : check.error).toContain(`'${outcome}'`);
        }
    });

    test('refuses a declared owned section left empty, naming the section and the file', async () => {
        const dir = seeded();
        writeFileSync(join(dir, TASK_FILE), '### Background\n\nonly background\n', 'utf8');
        const check = await validateWorkItemReceipt(fs(), dir, workItem(), receipt());
        expect(check.ok).toBe(false);
        expect(check.ok ? '' : check.error).toMatch(
            /owned section\(s\) empty in docs\/tasks5\/1232_task\.md: Solution/,
        );
    });

    test('refuses owned sections with no task input to prove them against', async () => {
        const dir = seeded();
        const check = await validateWorkItemReceipt(fs(), dir, workItem({ inputs: [] }), receipt());
        expect(check.ok).toBe(false);
        expect(check.ok ? '' : check.error).toMatch(/no 'task' input is declared for owned section\(s\): Solution/);
    });

    test('an HTML comment does not count as a written section', async () => {
        const dir = seeded();
        writeFileSync(join(dir, TASK_FILE), '### Solution\n\n<!-- filled during implementation -->\n', 'utf8');
        const check = await validateWorkItemReceipt(fs(), dir, workItem(), receipt());
        expect(check.ok).toBe(false);
        expect(check.ok ? '' : check.error).toMatch(/owned section\(s\) empty/);
    });
});
