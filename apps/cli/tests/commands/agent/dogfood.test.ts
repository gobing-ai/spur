/**
 * Thin-wrapper tests for `spur agent dogfood gate|validate-report` (script-absorption PR-7).
 * Logic is pinned by packages/app/tests/services/dogfood; this pins flag mapping and exit codes.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVars } from '@gobing-ai/spur-config';
import { main } from '../../../src/index';
import { createCapturedOutput } from '../../helpers';

let cwd: string;
beforeAll(() => {
    cwd = mkdtempSync(join(tmpdir(), 'spur-dogfood-cli-'));
});
afterAll(() => rmSync(cwd, { recursive: true, force: true }));

async function run(argv: string[]) {
    const output = createCapturedOutput();
    const exitCode = await main(argv, { cwd, output, env: { PATH: getEnvVars().PATH } });
    return { exitCode, out: output.messages.join('\n'), err: output.errors.join('\n') };
}

describe('spur agent dogfood gate', () => {
    test('refuses a pipeline-driving testee without --max-retry-present (exit 2)', async () => {
        const r = await run(['agent', 'dogfood', 'gate', '--testee', '/sp:dev-run 0125 --auto']);
        expect(r.exitCode).toBe(2);
        expect(r.out).toContain('pipeline-driving testee detected');
    });

    test('positional testee, --max-retry-present, --steps and --json map onto the gate', async () => {
        const r = await run([
            'agent',
            'dogfood',
            'gate',
            '/sp:dev-verify 0277 --next',
            '--max-retry-present',
            '--steps',
            'load||verify',
            '--json',
        ]);
        expect(r.exitCode).toBe(0);
        const parsed = JSON.parse(r.out) as { refuse: boolean; exitCode: number };
        expect(parsed.refuse).toBe(false);
        expect(parsed.exitCode).toBe(0);
    });

    test('a missing testee is a usage error (exit 1)', async () => {
        const r = await run(['agent', 'dogfood', 'gate']);
        expect(r.exitCode).toBe(1);
        expect(r.err).toContain('spur agent dogfood gate');
    });
});

describe('spur agent dogfood validate-report', () => {
    test('a missing --file is a usage error (exit 1)', async () => {
        const r = await run(['agent', 'dogfood', 'validate-report']);
        expect(r.exitCode).toBe(1);
        expect(r.err).toContain('spur agent dogfood validate-report');
    });

    test('an incomplete report fails validation (exit 2) with --json and positional file', async () => {
        const file = join(cwd, 'bad.md');
        writeFileSync(file, '# not a dogfood report\n');
        const r = await run(['agent', 'dogfood', 'validate-report', file, '--json']);
        expect(r.exitCode).toBe(2);
        expect((JSON.parse(r.out) as { ok: boolean }).ok).toBe(false);
        const plain = await run(['agent', 'dogfood', 'validate-report', '--file', file]);
        expect(plain.exitCode).toBe(2);
        expect(plain.out.length).toBeGreaterThan(0);
    });

    test('the complete fixture validates clean (exit 0)', async () => {
        const fixture = join(
            import.meta.dir,
            '..',
            '..',
            '..',
            '..',
            '..',
            'packages',
            'app',
            'tests',
            'services',
            'dogfood',
            'fixtures',
            'report-complete.md',
        );
        const r = await run(['agent', 'dogfood', 'validate-report', '--file', fixture]);
        expect(r.exitCode).toBe(0);
        expect(r.out).toBe('ok');
    });
});
