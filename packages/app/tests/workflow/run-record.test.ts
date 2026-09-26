import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SpurConfig } from '@gobing-ai/spur-config';
import {
    InvalidWorkflowRunIdError,
    readWorkflowRunRecord,
    resolveOutputLogConfig,
    resolveWorkflowLogRetentionDays,
    stateReadFailureReason,
} from '../../src/workflow/run-record';

// 0962: the run-record reader is a filesystem module with no service dependency. These drive it
// directly over a temp run dir; the WorkflowAppService surfaces that wrap it stay covered by
// tests/services/workflow-service.test.ts.

function runDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'run-record-'));
    mkdirSync(dir, { recursive: true });
    return dir;
}

describe('readWorkflowRunRecord (E7 / 0926 R3)', () => {
    test('reports a missing record when neither the pair nor a legacy log exists', () => {
        expect(readWorkflowRunRecord(runDir(), 'r1')).toEqual({ kind: 'missing' });
    });

    test('serves a valid pair as parsed machine state', () => {
        const dir = runDir();
        writeFileSync(join(dir, 'r1.md'), '# run\n', 'utf8');
        writeFileSync(join(dir, 'r1.state.json'), JSON.stringify({ runId: 'r1', status: 'done' }), 'utf8');
        const read = readWorkflowRunRecord(dir, 'r1');
        expect(read.kind).toBe('pair');
        expect(read.kind === 'pair' && read.state.status).toBe('done');
    });

    test('a markdown record with no state file is incomplete, never synthesized', () => {
        const dir = runDir();
        writeFileSync(join(dir, 'r2.md'), '# run\n', 'utf8');
        const read = readWorkflowRunRecord(dir, 'r2');
        expect(read.kind).toBe('incomplete');
        expect(read.kind === 'incomplete' && read.reason).toBe('state-missing');
    });

    test('an unparseable state file is explicitly invalid', () => {
        const dir = runDir();
        writeFileSync(join(dir, 'r3.md'), '# run\n', 'utf8');
        writeFileSync(join(dir, 'r3.state.json'), '{not json', 'utf8');
        const read = readWorkflowRunRecord(dir, 'r3');
        expect(read.kind).toBe('incomplete');
        expect(read.kind === 'incomplete' && read.reason).toBe('state-invalid');
    });

    test('a historical log-only run stays readable in place', () => {
        const dir = runDir();
        writeFileSync(join(dir, 'r4.log'), 'legacy\n', 'utf8');
        const read = readWorkflowRunRecord(dir, 'r4');
        expect(read.kind).toBe('legacy-log');
    });

    test('rejects a traversal-shaped run id before any path is built', () => {
        expect(() => readWorkflowRunRecord(runDir(), '../escape')).toThrow(InvalidWorkflowRunIdError);
    });
});

describe('stateReadFailureReason (0948 R6)', () => {
    test('ENOENT is missing; anything else is invalid', () => {
        expect(stateReadFailureReason(Object.assign(new Error('nope'), { code: 'ENOENT' }))).toBe('state-missing');
        expect(stateReadFailureReason(new SyntaxError('bad json'))).toBe('state-invalid');
    });
});

describe('retention and output-log resolvers (D2 / 0429)', () => {
    test('a null config degrades to the 30-day default and empty output limits', () => {
        expect(resolveWorkflowLogRetentionDays(null)).toBe(30);
        expect(resolveOutputLogConfig(null)).toEqual({});
    });

    test('reads the threaded config sections when present', () => {
        const config = {
            workflow: { logRetentionDays: 7 },
            agent: { output: { 'max-bytes': 1024, 'max-lines': 50 } },
        } as unknown as SpurConfig;
        expect(resolveWorkflowLogRetentionDays(config)).toBe(7);
        expect(resolveOutputLogConfig(config)).toEqual({ maxBytes: 1024, maxLines: 50 });
    });
});
