/**
 * Thin-wrapper tests for `spur history timeline` (script-absorption PR-6). The timeline is pinned
 * by packages/app/tests/services/session-timeline.test.ts; this pins flag forwarding and exit codes.
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../../../src/index';
import { createCapturedOutput } from '../../helpers';

async function run(argv: string[]) {
    const output = createCapturedOutput();
    const exitCode = await main(argv, { cwd: tmpdir(), output, env: { HOME: tmpdir() } });
    return { exitCode, stdout: output.messages.join('\n'), stderr: output.errors.join('\n') };
}

describe('spur history timeline', () => {
    test('no host session → available:false, exit 0', async () => {
        const r = await run(['history', 'timeline']);
        expect(r.exitCode).toBe(0);
        expect(JSON.parse(r.stdout).available).toBe(false);
    });

    test('--transcript and --group are forwarded', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'cli-tl-'));
        try {
            const t = join(dir, 't.jsonl');
            writeFileSync(t, '');
            writeFileSync(
                t,
                '{"type":"user","timestamp":"2026-01-01T00:00:00Z","message":{"role":"user","content":"hi"}}\n',
            );
            const ok = await run(['history', 'timeline', '--transcript', t]);
            expect(ok.exitCode).toBe(0);
            expect(JSON.parse(ok.stdout)).toHaveProperty('available');
            const bad = await run(['history', 'timeline', '--transcript', t, '--group', 'x-y']);
            expect(bad.exitCode).toBe(2);
            expect(bad.stderr).toContain('spur history timeline');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
