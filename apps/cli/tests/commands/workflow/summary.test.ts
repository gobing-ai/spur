/**
 * Thin-wrapper tests for `spur workflow summary` (script-absorption PR-6). The summary is pinned by
 * packages/app/tests/workflow/run-summary-cli.test.ts; this pins flag forwarding and exit codes.
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../../../src/index';
import { createCapturedOutput } from '../../helpers';

async function run(argv: string[], cwd = tmpdir()) {
    const output = createCapturedOutput();
    const exitCode = await main(argv, { cwd, output, env: { HOME: tmpdir() } });
    return { exitCode, stdout: output.messages.join('\n'), stderr: output.errors.join('\n') };
}

describe('spur workflow summary', () => {
    test('with no input it is a usage error (exit 2)', async () => {
        const r = await run(['workflow', 'summary']);
        expect(r.exitCode).toBe(2);
        expect(r.stderr).toContain('usage: spur workflow summary');
    });

    test('--progress, --transcript, --since and --markdown are forwarded', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'cli-rs-'));
        try {
            const progress = join(dir, 'p.json');
            writeFileSync(progress, '{not json');
            const t = join(dir, 't.jsonl');
            writeFileSync(t, '');
            const r = await run([
                'workflow',
                'summary',
                '--progress',
                `a=${progress}`,
                '--progress',
                progress,
                '--transcript',
                t,
                '--since',
                '2026-01-01T00:00:00Z',
                '--markdown',
            ]);
            expect(r.exitCode).toBe(2);
            expect(r.stderr).toContain('spur workflow summary:');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('--rollup is forwarded (a missing file is reported, exit 2)', async () => {
        const r = await run(['workflow', 'summary', '--rollup', join(tmpdir(), 'no-such-summary.json')]);
        expect(r.exitCode).toBe(2);
        expect(r.stderr).toContain('spur workflow summary:');
    });

    test('a measured run prints the JSON summary to stdout (exit 0)', async () => {
        const fixtures = join(import.meta.dir, '../../fixtures/script-absorption-pr6');
        const r = await run([
            'workflow',
            'summary',
            '--progress',
            join(fixtures, 'progress-r1.json'),
            '--transcript',
            join(fixtures, 'transcript.jsonl'),
        ]);
        expect(r.exitCode).toBe(0);
        expect(JSON.parse(r.stdout)).toMatchObject({ available: true });
    });
});
