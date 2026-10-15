import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/index';
import { createCapturedOutput } from './helpers';

const commands = [
    ['task', 'diffstat', '../../outside'],
    ['task', 'gate', '../../outside', 'run', '--cmd', 'touch should-not-run'],
    ['task', 'residual', '../../outside', 'fold'],
    ['task', 'wrapup', 'drift-probe', '--run-id', '../../outside'],
    ['workflow', 'commit-guard', 'start', '--run', '../../outside'],
    ['workflow', 'commit-guard', 'stage', '--run', '../../outside', 'file.txt'],
    ['workflow', 'commit-guard', 'check', '--run', '../../outside'],
    ['feature', 'handoff', 'A9', '--run-id', '../../outside'],
    ['history', 'anatomy', 'paths', '--out', 'should-not-write.env', '--run-id', '../../outside'],
];

describe('public artifact identity validation', () => {
    for (const argv of commands) {
        test(`${argv.join(' ')} refuses before writing or running a command`, async () => {
            const cwd = mkdtempSync(join(tmpdir(), 'spur-artifact-id-'));
            const output = createCapturedOutput();
            try {
                expect(await main(argv, { cwd, output, env: {} })).toBe(2);
                expect(output.errors.join('\n')).toContain('refusing unsafe');
                expect(existsSync(join(cwd, '.spur', 'run'))).toBe(false);
                expect(readdirSync(cwd).filter((name) => name !== '.spur')).toEqual([]);
                expect(existsSync(join(cwd, '.spur', 'run'))).toBe(false);
            } finally {
                rmSync(cwd, { recursive: true, force: true });
            }
        });
    }

    for (const op of ['resolve', 'drift-probe']) {
        test(`wrapup ${op} validates the environment run id`, async () => {
            const cwd = mkdtempSync(join(tmpdir(), 'spur-artifact-env-'));
            try {
                const output = createCapturedOutput();
                expect(await main(['task', 'wrapup', op], { cwd, output, env: { __runId: '..\\outside' } })).toBe(2);
                expect(output.errors.join('\n')).toContain('refusing unsafe run id');
                expect(readdirSync(cwd).filter((name) => name !== '.spur')).toEqual([]);
                expect(existsSync(join(cwd, '.spur', 'run'))).toBe(false);
            } finally {
                rmSync(cwd, { recursive: true, force: true });
            }
        });
    }

    test('handoff validates the environment run id before loading task evidence', async () => {
        const cwd = mkdtempSync(join(tmpdir(), 'spur-artifact-handoff-'));
        try {
            const output = createCapturedOutput();
            expect(await main(['feature', 'handoff', 'A9'], { cwd, output, env: { __runId: '/outside' } })).toBe(2);
            expect(output.errors.join('\n')).toContain('refusing unsafe run id');
            expect(readdirSync(cwd).filter((name) => name !== '.spur')).toEqual([]);
            expect(existsSync(join(cwd, '.spur', 'run'))).toBe(false);
        } finally {
            rmSync(cwd, { recursive: true, force: true });
        }
    });
});
