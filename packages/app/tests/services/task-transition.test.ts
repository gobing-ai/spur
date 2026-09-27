import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { GuardDeniedError } from '../../src/errors';
import type { GuardedTransitionDeps } from '../../src/services/task-transition';
import { transitionTaskGuarded } from '../../src/services/task-transition';

const PASS_ARTIFACT = {
    wbs: '0001',
    verdict: 'PASS' as const,
    requirements: [{ id: 'R1', status: 'MET' as const, evidence: 'a' }],
    acceptanceCriteria: [],
    source: 'test',
};

const TASK_HEAD = [
    '---',
    'schema_version: 1',
    'name: "Gate subject"',
    'status: testing',
    'created_at: 2026-06-13T00:00:00.000Z',
    'updated_at: 2026-06-13T00:00:00.000Z',
    '---',
    '',
    '## 0001. Gate subject',
    '',
];

const GATED_TASK = [
    ...TASK_HEAD,
    '### Background',
    '',
    'Text',
    '',
    '### Solution',
    '',
    '| Req | Status | Evidence |',
    '| R1 | MET | `packages/app/src/gate.ts:1-3` (`gate`) |',
    '',
    '### Testing',
    '',
    '`bun test` — 1 passing',
    '',
].join('\n');

const UNGATED_TASK = [...TASK_HEAD, '### Background', '', 'Text', ''].join('\n');

interface Harness {
    deps: GuardedTransitionDeps;
    calls: { updateStatus: string[]; updateField: string[] };
    cleanup(): void;
}

/** Seed a temp project with a task file, an optional verdict artifact, and a check gate. */
function makeHarness(opts: {
    task: string;
    verdict?: unknown;
    withCheckGate?: boolean;
    checkServiceThrows?: boolean;
    updateFieldThrows?: boolean;
}): Harness {
    const root = mkdtempSync(join(tmpdir(), 'spur-transition-test-'));
    const taskPath = join(root, '0001_task.md');
    writeFileSync(taskPath, opts.task);
    const runDir = join(root, '.spur', 'run');
    const fs = createNodeFileSystem(root);
    if (opts.verdict !== undefined) {
        const { mkdirSync } = require('node:fs') as typeof import('node:fs');
        mkdirSync(runDir, { recursive: true });
        writeFileSync(join(runDir, '0001-verdict.json'), JSON.stringify(opts.verdict));
    }

    const calls = { updateStatus: [] as string[], updateField: [] as string[] };
    const current = { filePath: taskPath, frontmatter: { status: 'testing' } };

    const checkGate =
        opts.withCheckGate === true
            ? {
                  service: {
                      check: async () => {
                          if (opts.checkServiceThrows === true) throw new Error('check exploded');
                          return { pass: opts.task === GATED_TASK, findings: [] };
                      },
                  },
              }
            : undefined;

    const deps: GuardedTransitionDeps = {
        tasks: {
            show: async () => current as never,
            updateStatus: async (wbs: string, status: string) => {
                calls.updateStatus.push(`${wbs}:${status}`);
                return {
                    ref: { id: wbs, filePath: taskPath, kind: 'task', folder: '.' },
                    fromStatus: 'testing',
                    toStatus: status,
                } as never;
            },
            updateField: async (wbs: string, key: string) => {
                if (opts.updateFieldThrows === true) throw new Error('audit write failed');
                calls.updateField.push(`${wbs}:${key}`);
                return undefined as never;
            },
        } as unknown as GuardedTransitionDeps['tasks'],
        fs,
        runDir,
        ...(checkGate !== undefined ? { checkGate: checkGate as never } : {}),
    };
    return { deps, calls, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe('transitionTaskGuarded — structural check gate (R1)', () => {
    test('denies `done` when the supplied check gate fails, with the CLI-identical message', async () => {
        const h = makeHarness({ task: UNGATED_TASK, withCheckGate: true, verdict: PASS_ARTIFACT });
        await expect(transitionTaskGuarded(h.deps, { wbs: '0001', toStatus: 'done' })).rejects.toThrow(
            GuardDeniedError,
        );
        await expect(transitionTaskGuarded(h.deps, { wbs: '0001', toStatus: 'done' })).rejects.toThrow(
            'Lifecycle transition blocked: `spur task check 0001 --as done` failed',
        );
        // The gate denies before the write.
        expect(h.calls.updateStatus).toEqual([]);
        h.cleanup();
    });

    test('runs the check gate for `testing` too (target-aware `--as testing`)', async () => {
        const h = makeHarness({ task: UNGATED_TASK, withCheckGate: true });
        await expect(transitionTaskGuarded(h.deps, { wbs: '0001', toStatus: 'testing' })).rejects.toThrow(
            '`spur task check 0001 --as testing` failed',
        );
        expect(h.calls.updateStatus).toEqual([]);
        h.cleanup();
    });

    test('passes a `testing` transition through when the gate passes and writes no verdict read', async () => {
        const h = makeHarness({ task: GATED_TASK, withCheckGate: true });
        const out = await transitionTaskGuarded(h.deps, { wbs: '0001', toStatus: 'testing' });
        expect(out.kind).toBe('transitioned');
        expect(h.calls.updateStatus).toEqual(['0001:testing']);
        h.cleanup();
    });

    test('omits the check gate when the caller supplies none (lifecycle FSM owns it)', async () => {
        const h = makeHarness({ task: UNGATED_TASK, verdict: PASS_ARTIFACT });
        const out = await transitionTaskGuarded(h.deps, { wbs: '0001', toStatus: 'done' });
        expect(out.kind).toBe('transitioned');
        h.cleanup();
    });
});

describe('transitionTaskGuarded — done verdict gate (R1)', () => {
    test('denies `done` with no verdict artifact', async () => {
        const h = makeHarness({ task: GATED_TASK });
        await expect(transitionTaskGuarded(h.deps, { wbs: '0001', toStatus: 'done' })).rejects.toThrow(
            'missing verify verdict artifact',
        );
        expect(h.calls.updateStatus).toEqual([]);
        h.cleanup();
    });

    test('denies `done` on a non-PASS verdict', async () => {
        const h = makeHarness({ task: GATED_TASK, verdict: { ...PASS_ARTIFACT, verdict: 'PARTIAL' } });
        await expect(transitionTaskGuarded(h.deps, { wbs: '0001', toStatus: 'done' })).rejects.toThrow(
            GuardDeniedError,
        );
        expect(h.calls.updateStatus).toEqual([]);
        h.cleanup();
    });

    test('allows `done` on a PASS verdict', async () => {
        const h = makeHarness({ task: GATED_TASK, verdict: PASS_ARTIFACT, withCheckGate: true });
        const out = await transitionTaskGuarded(h.deps, { wbs: '0001', toStatus: 'done' });
        expect(out.kind).toBe('transitioned');
        expect(h.calls.updateStatus).toEqual(['0001:done']);
        h.cleanup();
    });

    test('alias-canonicalizes the target, so `DONE` is gated like `done`', async () => {
        const h = makeHarness({ task: GATED_TASK });
        await expect(transitionTaskGuarded(h.deps, { wbs: '0001', toStatus: 'DONE' })).rejects.toThrow(
            'missing verify verdict artifact',
        );
        h.cleanup();
    });

    test('same-status `done` is a no-op with no write', async () => {
        const h = makeHarness({ task: GATED_TASK, verdict: PASS_ARTIFACT });
        const h2 = makeHarness({ task: GATED_TASK, verdict: PASS_ARTIFACT });
        // A task already at `done`: no-op short-circuits before any gate.
        (h2.deps.tasks as unknown as { show: () => Promise<unknown> }).show = async () => ({
            filePath: 'x',
            frontmatter: { status: 'done' },
        });
        const out = await transitionTaskGuarded(h2.deps, { wbs: '0001', toStatus: 'done' });
        expect(out.kind).toBe('noop');
        expect(h2.calls.updateStatus).toEqual([]);
        h.cleanup();
        h2.cleanup();
    });
});

describe('transitionTaskGuarded — forced override audit trail (R1)', () => {
    test('forced `done` without an artifact writes the transition and the audit fields', async () => {
        const h = makeHarness({ task: GATED_TASK });
        const out = await transitionTaskGuarded(h.deps, {
            wbs: '0001',
            toStatus: 'done',
            forceDone: true,
            reason: 'operator emergency close',
        });
        expect(out.kind).toBe('transitioned');
        if (out.kind === 'transitioned') {
            expect(out.forced?.verdict).toBe('UNKNOWN');
        }
        expect(h.calls.updateStatus).toEqual(['0001:done']);
        expect(h.calls.updateField).toEqual(['0001:done_forced', '0001:done_reason']);
        h.cleanup();
    });

    test('an audit-write failure is reported on the result, never thrown', async () => {
        const h = makeHarness({ task: GATED_TASK, updateFieldThrows: true });
        const out = await transitionTaskGuarded(h.deps, {
            wbs: '0001',
            toStatus: 'done',
            forceDone: true,
            reason: 'why',
        });
        expect(out.kind).toBe('transitioned');
        if (out.kind === 'transitioned') {
            expect(out.forced?.auditError).toContain('audit write failed');
        }
        h.cleanup();
    });
});
