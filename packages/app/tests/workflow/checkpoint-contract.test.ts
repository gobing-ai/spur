import { describe, expect, test } from 'bun:test';
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    checkpointStaleness,
    isTerminalCheckpointStatus,
    parseCheckpointMetadata,
    TERMINAL_CHECKPOINT_STATUSES,
} from '../../src/workflow/checkpoint-contract';

function doc(overrides: Record<string, string> = {}, artifacts?: string[]): string {
    const base: Record<string, string> = {
        schema_version: '1',
        session_id: '2026-01-01-0703',
        workflow: 'task-pipeline',
        run_id: '5c0f7ab6-b2f4-4ab9-84be-f0294d00dc99',
        task_wbs: '0703',
        feature_id: 'A6',
        phase: 'done',
        status: 'running',
        last_gate: 'record',
        source_commit: '34302503e30c7de75e8d2c6ab437f0e04683399b',
        digest: 'sha256:0503223560f2dfe8f671efd981716d2a2d67954566b52ca052a4818f08903d36',
        generated_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        next_action: 'merge to main',
    };
    const scalars = { ...base, ...overrides };
    const lines = Object.entries(scalars)
        .filter(([, v]) => v !== '')
        .map(([k, v]) => `${k}: ${v}`);
    const artifactBlock = artifacts === undefined ? '' : `artifacts:\n${artifacts.map((a) => `  - ${a}`).join('\n')}\n`;
    return `---\n${lines.join('\n')}\n${artifactBlock}---\n`;
}

describe('parseCheckpointMetadata', () => {
    test('parses the canonical terminal checkpoint written by task-pipeline (0711 R1/R2)', () => {
        const meta = parseCheckpointMetadata(doc({ status: 'done' }));
        expect(meta).not.toBeNull();
        expect(meta?.schemaVersion).toBe(1);
        expect(meta?.sessionId).toBe('2026-01-01-0703');
        expect(meta?.workflow).toBe('task-pipeline');
        expect(meta?.runId).toBe('5c0f7ab6-b2f4-4ab9-84be-f0294d00dc99');
        expect(meta?.taskWbs).toBe('0703');
        expect(meta?.status).toBe('done');
        expect(meta?.sourceCommit).toBe('34302503e30c7de75e8d2c6ab437f0e04683399b');
        expect(meta?.nextAction).toBe('merge to main');
        expect(meta?.artifacts).toEqual([]);
    });

    test('parses quoted scalars and indented artifact lists', () => {
        const meta = parseCheckpointMetadata(
            doc({ next_action: '"fix test"' }, ['.spur/run/0703-verdict.json', 'docs/tasks4/0703.md']),
        );
        expect(meta?.nextAction).toBe('fix test');
        expect(meta?.artifacts).toEqual(['.spur/run/0703-verdict.json', 'docs/tasks4/0703.md']);
    });

    test('parses inline comma-separated artifacts (convention compact form)', () => {
        const meta = parseCheckpointMetadata(doc({ artifacts: 'a.json, b.md' }));
        expect(meta?.artifacts).toEqual(['a.json', 'b.md']);
    });

    test('rejects documents without frontmatter', () => {
        expect(parseCheckpointMetadata('no frontmatter here')).toBeNull();
        expect(parseCheckpointMetadata('# heading\n')).toBeNull();
    });

    test('rejects unterminated frontmatter', () => {
        expect(parseCheckpointMetadata('---\nschema_version: 1\n')).toBeNull();
    });

    test('rejects missing required scalars', () => {
        for (const key of [
            'schema_version',
            'session_id',
            'workflow',
            'task_wbs',
            'phase',
            'generated_at',
            'next_action',
        ]) {
            const rest = doc();
            const without = rest.replace(new RegExp(`^${key}: .*$`, 'm'), '');
            expect(parseCheckpointMetadata(without)).toBeNull();
        }
    });

    test('rejects unsupported schema versions', () => {
        expect(parseCheckpointMetadata(doc({ schema_version: '2' }))).toBeNull();
        expect(parseCheckpointMetadata(doc({ schema_version: 'x' }))).toBeNull();
    });

    test('tolerates garbage updated_at (cleanup falls back to mtime)', () => {
        const meta = parseCheckpointMetadata(doc({ updated_at: 'garbage' }));
        expect(meta).not.toBeNull();
        expect(meta?.updatedAt).toBe('garbage');
    });
});

describe('isTerminalCheckpointStatus', () => {
    test('accepts exactly the canonical terminal set', () => {
        expect(TERMINAL_CHECKPOINT_STATUSES).toEqual(['done', 'failed', 'cancelled', 'skipped']);
        for (const status of TERMINAL_CHECKPOINT_STATUSES) {
            expect(isTerminalCheckpointStatus(status)).toBe(true);
        }
        for (const status of ['running', 'pending', 'approved', 'DONE', '']) {
            expect(isTerminalCheckpointStatus(status)).toBe(false);
        }
    });
});

describe('checkpointStaleness (0711 R3)', () => {
    const input = { sourceCommit: 'c0ffee', taskWbs: '0703' };

    test('fresh matching checkpoint is not stale', () => {
        const meta = parseCheckpointMetadata(doc({ source_commit: 'c0ffee' }, ['.spur/run/0703-verdict.json']));
        if (!meta) throw new Error('parse failed');
        expect(
            checkpointStaleness(meta, {
                ...input,
                artifactExists: (p) => p === '.spur/run/0703-verdict.json',
            }),
        ).toEqual({ stale: false });
    });

    test('owner mismatch is stale', () => {
        const meta = parseCheckpointMetadata(doc());
        if (!meta) throw new Error('parse failed');
        expect(checkpointStaleness(meta, { ...input, taskWbs: '0704' })).toEqual({
            stale: true,
            reason: 'owner-mismatch: task_wbs=0703 != 0704',
        });
    });

    test('terminal status is stale (never resumed from a done/failed checkpoint)', () => {
        const meta = parseCheckpointMetadata(doc({ status: 'done' }));
        if (!meta) throw new Error('parse failed');
        expect(checkpointStaleness(meta, input)).toEqual({
            stale: true,
            reason: 'terminal: status=done',
        });
    });

    test('missing or mismatched source_commit is commit drift when HEAD is known', () => {
        const missing = parseCheckpointMetadata(doc({ source_commit: '' }));
        if (!missing) throw new Error('parse failed');
        expect(checkpointStaleness(missing, input)).toMatchObject({ stale: true });
        const drifted = parseCheckpointMetadata(doc({ source_commit: 'deadbeef' }));
        if (!drifted) throw new Error('parse failed');
        expect(checkpointStaleness(drifted, input)).toMatchObject({ stale: true });
        // Without a known HEAD the commit axis is skipped.
        expect(checkpointStaleness(drifted, { taskWbs: '0703', artifactExists: () => true })).toEqual({ stale: false });
    });

    test('missing referenced artifact is stale', () => {
        const meta = parseCheckpointMetadata(doc({ source_commit: 'c0ffee' }, ['.spur/run/gone.json']));
        if (!meta) throw new Error('parse failed');
        expect(checkpointStaleness(meta, { ...input, artifactExists: () => false })).toEqual({
            stale: true,
            reason: 'missing-artifact: .spur/run/gone.json',
        });
    });

    test('probe receives the raw stored artifact path (existsSync resolves relative paths)', () => {
        const meta = parseCheckpointMetadata(doc({ source_commit: 'c0ffee' }, ['relative.json']));
        if (!meta) throw new Error('parse failed');
        const seen: string[] = [];
        checkpointStaleness(meta, {
            ...input,
            artifactExists: (p) => {
                seen.push(p);
                return true;
            },
        });
        expect(seen).toEqual(['relative.json']);
    });

    test('default filesystem probe is used when artifactExists is omitted (0711 R3)', () => {
        const artifact = join(tmpdir(), `checkpoint-probe-${Date.now()}-${process.pid}.txt`);
        writeFileSync(artifact, 'x');
        try {
            const meta = parseCheckpointMetadata(doc({ source_commit: 'c0ffee' }, [artifact]));
            if (!meta) throw new Error('parse failed');
            expect(checkpointStaleness(meta, { sourceCommit: 'c0ffee', taskWbs: '0703' })).toEqual({ stale: false });
        } finally {
            rmSync(artifact, { force: true });
        }
    });
});
