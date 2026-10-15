/**
 * Thin-wrapper tests for `spur history summary` (script-absorption PR-6). The report is pinned by
 * packages/app/tests/services/daily-summary.test.ts; this pins flag forwarding and the sink.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVars, removeEnvVar, setEnvVar } from '@gobing-ai/spur-config';
import { main } from '../../../src/index';
import { createCapturedOutput } from '../../helpers';

async function run(argv: string[]) {
    const output = createCapturedOutput();
    const exitCode = await main(argv, { cwd: tmpdir(), output, env: { PATH: getEnvVars().PATH } });
    return { exitCode, stdout: output.messages.join('\n'), stderr: output.errors.join('\n') };
}

beforeAll(() => setEnvVar('SP_DAILY_SUMMARY_NO_PROMPT', '1'));
afterAll(() => removeEnvVar('SP_DAILY_SUMMARY_NO_PROMPT'));

describe('spur history summary', () => {
    test('--dry-run --no-git --no-ccusage prints the summary and writes nothing', async () => {
        const r = await run(['history', 'summary', '--date', '2026-01-02', '--dry-run', '--no-git', '--no-ccusage']);
        expect(r.exitCode).toBe(0);
        expect(r.stdout).toContain('# Daily Summary — 2026-01-02');
        expect(r.stdout).toContain('(dry-run) Summary not written to file');
    });

    test('--output writes the file', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'cli-ds-'));
        try {
            const out = join(dir, 's.md');
            const r = await run([
                'history',
                'summary',
                '--date',
                '2026-01-02',
                '--output',
                out,
                '--no-git',
                '--no-ccusage',
            ]);
            expect(r.exitCode).toBe(0);
            expect(existsSync(out)).toBe(true);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('a write failure is reported on stderr (exit 1)', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'cli-ds-'));
        try {
            // A regular file as the parent directory makes the write fail deterministically.
            const blocker = join(dir, 'blocker');
            writeFileSync(blocker, '');
            const r = await run([
                'history',
                'summary',
                '--date',
                '2026-01-02',
                '--output',
                join(blocker, 's.md'),
                '--no-git',
                '--no-ccusage',
            ]);
            expect(r.exitCode).toBe(1);
            expect(r.stderr).toContain('Failed to generate summary');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
