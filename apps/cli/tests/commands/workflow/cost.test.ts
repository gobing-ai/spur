/**
 * Thin-wrapper tests for `spur workflow cost` (script-absorption PR-9). Output parity with the
 * retired dev-scripts is pinned by script-absorption-pr9-parity.test.ts; this pins the
 * remaining adapter branches.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVars } from '@gobing-ai/spur-config';
import { main } from '../../../src/index';
import { createCapturedOutput } from '../../helpers';

const FIX = join(import.meta.dir, '../../fixtures/script-absorption-pr9');
let scratch = '';

async function run(argv: string[]) {
    const output = createCapturedOutput();
    const exitCode = await main(argv, { cwd: scratch, output, env: { PATH: getEnvVars().PATH, HOME: scratch } });
    return { exitCode, stdout: output.messages.join('\n'), stderr: output.errors.join('\n') };
}

beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), 'cli-cost-'));
    mkdirSync(join(scratch, 'config'), { recursive: true });
    cpSync(join(FIX, 'workflows'), join(scratch, 'config/workflows'), { recursive: true });
    cpSync(join(FIX, 'pipeline-budgets.json'), join(scratch, 'config/pipeline-budgets.json'));
});

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe('spur workflow cost', () => {
    test('--measured-file without --budget is a usage error (exit 1)', async () => {
        const r = await run(['workflow', 'cost', '--measured-file', 'x.json']);
        expect(r.exitCode).toBe(1);
        expect(r.stderr).toContain('spur workflow cost: --measured-file requires --budget');
    });

    test('--budget --json emits the gate result as stable JSON', async () => {
        const r = await run(['workflow', 'cost', '--budget', 'config/pipeline-budgets.json', '--json']);
        expect(r.exitCode).toBe(1);
        const parsed = JSON.parse(r.stdout) as { ok: boolean; errors: string[]; exitCode: number };
        expect(parsed.ok).toBe(false);
        expect(parsed.exitCode).toBe(1);
        expect(parsed.errors[0]).toContain('MISSING BUDGET: pipeline=zz-unbudgeted');
    });

    test('a missing budget file is reported (exit 1)', async () => {
        const r = await run(['workflow', 'cost', '--budget', 'nope.json']);
        expect(r.exitCode).toBe(1);
        expect(r.stderr).toContain('spur workflow cost:');
    });

    test('an absolute --budget path is accepted', async () => {
        const r = await run([
            'workflow',
            'cost',
            '--budget',
            join(FIX, 'pipeline-budgets.json'),
            '--workflow',
            'pr-review',
        ]);
        // zz-unbudgeted still fails coverage; the point here is the absolute budget path is accepted.
        expect(r.stdout).toContain('workflow cost --budget: FAIL (1 failure(s))');
    });
});
