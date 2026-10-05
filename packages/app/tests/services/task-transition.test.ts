import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { GuardDeniedError } from '../../src/errors';
import type { GuardedTransitionDeps } from '../../src/services/task-transition';
import { projectRelativeArtifactPath, transitionTaskGuarded } from '../../src/services/task-transition';

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
    calls: { updateStatus: string[]; updateField: string[]; fieldValues: Record<string, string> };
    cleanup(): void;
}

/** Seed a temp project with a task file, an optional verdict artifact, and a check gate. */
function makeHarness(opts: {
    task: string;
    verdict?: unknown;
    withCheckGate?: boolean;
    checkServiceThrows?: boolean;
    updateFieldThrows?: boolean;
    showStatus?: string;
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

    const calls = {
        updateStatus: [] as string[],
        updateField: [] as string[],
        fieldValues: {} as Record<string, string>,
    };
    const current = { filePath: taskPath, frontmatter: { status: opts.showStatus ?? 'testing' } };

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
            updateField: async (wbs: string, key: string, value?: string) => {
                if (opts.updateFieldThrows === true) throw new Error('audit write failed');
                const callKey = `${wbs}:${key}`;
                calls.updateField.push(callKey);
                if (value !== undefined) calls.fieldValues[callKey] = value;
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
    test('denial names the selected durable verdict instead of the scratch fallback', async () => {
        const h = makeHarness({ task: GATED_TASK, verdict: { ...PASS_ARTIFACT, verdict: 'FAIL' } });
        const evidenceDir = join(h.deps.runDir, '..', 'memory', 'evidence');
        const evidencePath = join(evidenceDir, '0001-verdict.json');
        try {
            mkdirSync(evidenceDir, { recursive: true });
            renameSync(join(h.deps.runDir, '0001-verdict.json'), evidencePath);
            await expect(transitionTaskGuarded(h.deps, { wbs: '0001', toStatus: 'done' })).rejects.toThrow(
                evidencePath,
            );
            expect(h.calls.updateStatus).toEqual([]);
        } finally {
            h.cleanup();
        }
    });

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

describe('1042 — foreign-task verdict artifact is rejected at the shared reader (R1)', () => {
    const FOREIGN_ARTIFACT = { ...PASS_ARTIFACT, wbs: '9999' };

    test('denies an unforced done when the artifact names a different WBS, writing nothing', async () => {
        const h = makeHarness({ task: GATED_TASK, verdict: FOREIGN_ARTIFACT });
        await expect(transitionTaskGuarded(h.deps, { wbs: '0001', toStatus: 'done' })).rejects.toThrow(
            GuardDeniedError,
        );
        await expect(transitionTaskGuarded(h.deps, { wbs: '0001', toStatus: 'done' })).rejects.toThrow(
            /identity mismatch/,
        );
        // The denial names both identities and the artifact path.
        await expect(transitionTaskGuarded(h.deps, { wbs: '0001', toStatus: 'done' })).rejects.toThrow(
            /0001-verdict\.json.*'0001'.*"9999"/s,
        );
        expect(h.calls.updateStatus).toEqual([]);
        expect(h.calls.updateField).toEqual([]);
        h.cleanup();
    });

    test('forced done over a foreign artifact transitions with UNKNOWN verdict attribution', async () => {
        const h = makeHarness({ task: GATED_TASK, verdict: FOREIGN_ARTIFACT });
        const out = await transitionTaskGuarded(h.deps, {
            wbs: '0001',
            toStatus: 'done',
            forceDone: true,
            reason: 'operator override after identity mismatch',
        });
        expect(out.kind).toBe('transitioned');
        if (out.kind === 'transitioned') {
            // The foreign PASS must not be attributed to this task.
            expect(out.forced?.verdict).toBe('UNKNOWN');
        }
        expect(h.calls.updateStatus).toEqual(['0001:done']);
        expect(h.calls.updateField).toEqual(['0001:done_forced', '0001:done_reason']);
        h.cleanup();
    });
});

describe('1040 — close-audit reconciliation on unforced done (R2)', () => {
    test('unforced done over a PASS artifact clears stale forced metadata and names the PASS artifact', async () => {
        const h = makeHarness({ task: GATED_TASK, verdict: PASS_ARTIFACT });
        const out = await transitionTaskGuarded(h.deps, { wbs: '0001', toStatus: 'done' });
        expect(out.kind).toBe('transitioned');
        expect(h.calls.updateStatus).toEqual(['0001:done']);
        expect(h.calls.updateField).toContain('0001:done_forced');
        expect(h.calls.updateField).toContain('0001:done_reason');
        // Stale forced flag cleared; reason describes the accepted PASS artifact.
        expect(h.calls.fieldValues['0001:done_forced']).toBe('false');
        expect(h.calls.fieldValues['0001:done_reason']).toContain('PASS artifact at');
        expect(h.calls.fieldValues['0001:done_reason']).toContain('0001-verdict.json');
        // Not an override: no forced attribution on the result.
        if (out.kind === 'transitioned') expect(out.forced).toBeUndefined();
        h.cleanup();
    });

    test('forced done keeps the supplied reason and the true flag (current behavior preserved)', async () => {
        const h = makeHarness({ task: GATED_TASK });
        const out = await transitionTaskGuarded(h.deps, {
            wbs: '0001',
            toStatus: 'done',
            forceDone: true,
            reason: 'operator emergency close',
        });
        expect(out.kind).toBe('transitioned');
        expect(h.calls.fieldValues['0001:done_forced']).toBe('true');
        expect(h.calls.fieldValues['0001:done_reason']).toBe('operator emergency close');
        h.cleanup();
    });

    test('same-status done no-op writes no close-audit fields', async () => {
        const h = makeHarness({ task: GATED_TASK, verdict: PASS_ARTIFACT, showStatus: 'done' });
        const out = await transitionTaskGuarded(h.deps, { wbs: '0001', toStatus: 'done' });
        expect(out.kind).toBe('noop');
        expect(h.calls.updateStatus).toEqual([]);
        expect(h.calls.updateField).toEqual([]);
        h.cleanup();
    });

    test('audit-write failure on an unforced close is reported via closeAuditError, not thrown', async () => {
        const h = makeHarness({ task: GATED_TASK, verdict: PASS_ARTIFACT, updateFieldThrows: true });
        const out = await transitionTaskGuarded(h.deps, { wbs: '0001', toStatus: 'done' });
        expect(out.kind).toBe('transitioned');
        if (out.kind === 'transitioned') {
            expect(out.closeAuditError).toContain('audit write failed');
        }
        h.cleanup();
    });
});

describe('1089 R2 — the close reason records a repo-relative artifact path', () => {
    test('the scratch verdict is recorded relative to the project root', async () => {
        const h = makeHarness({ task: GATED_TASK, verdict: PASS_ARTIFACT });
        const out = await transitionTaskGuarded(h.deps, { wbs: '0001', toStatus: 'done' });
        expect(out.kind).toBe('transitioned');
        // A committed absolute path is machine-specific and stops resolving once the
        // tree that produced it is removed (the `--worktree` close case).
        expect(h.calls.fieldValues['0001:done_reason']).toBe(
            'unforced close; PASS artifact at .spur/run/0001-verdict.json',
        );
        h.cleanup();
    });

    test('the durable evidence copy is recorded relative too', async () => {
        const h = makeHarness({ task: GATED_TASK, verdict: PASS_ARTIFACT });
        const evidenceDir = join(h.deps.runDir, '..', 'memory', 'evidence');
        try {
            mkdirSync(evidenceDir, { recursive: true });
            renameSync(join(h.deps.runDir, '0001-verdict.json'), join(evidenceDir, '0001-verdict.json'));
            await transitionTaskGuarded(h.deps, { wbs: '0001', toStatus: 'done' });
            expect(h.calls.fieldValues['0001:done_reason']).toBe(
                'unforced close; PASS artifact at .spur/memory/evidence/0001-verdict.json',
            );
        } finally {
            h.cleanup();
        }
    });

    test('a forced close keeps the operator rationale verbatim', async () => {
        const h = makeHarness({ task: GATED_TASK });
        await transitionTaskGuarded(h.deps, {
            wbs: '0001',
            toStatus: 'done',
            forceDone: true,
            reason: 'operator emergency close',
        });
        expect(h.calls.fieldValues['0001:done_reason']).toBe('operator emergency close');
        h.cleanup();
    });

    test('projectRelativeArtifactPath keeps a foreign artifact path as-is', () => {
        const root = join(tmpdir(), 'spur-relroot');
        const runDir = join(root, '.spur', 'run');
        expect(projectRelativeArtifactPath(runDir, join(runDir, '0001-verdict.json'))).toBe(
            '.spur/run/0001-verdict.json',
        );
        expect(projectRelativeArtifactPath(runDir, join(root, '.spur', 'memory', 'evidence', 'x.json'))).toBe(
            '.spur/memory/evidence/x.json',
        );
        // Outside the project root: recorded as-is rather than rewritten into `../..`.
        const foreign = join(tmpdir(), 'spur-foreign-evidence', '0001-verdict.json');
        expect(projectRelativeArtifactPath(runDir, foreign)).toBe(foreign);
        // The root itself has no meaningful relative form.
        expect(projectRelativeArtifactPath(runDir, root)).toBe(root);
    });
});
