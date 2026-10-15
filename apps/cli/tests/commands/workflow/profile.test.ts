/**
 * Thin-wrapper tests for `spur workflow profile` (script-absorption PR-6). The profile is pinned by
 * packages/app/tests/workflow/step-profile-cli.test.ts; this pins flag forwarding and exit codes.
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVars } from '@gobing-ai/spur-config';
import { main } from '../../../src/index';
import { createCapturedOutput } from '../../helpers';

async function run(argv: string[]) {
    const output = createCapturedOutput();
    const exitCode = await main(argv, { cwd: tmpdir(), output, env: { PATH: getEnvVars().PATH } });
    return { exitCode, stdout: output.messages.join('\n'), stderr: output.errors.join('\n') };
}

describe('spur workflow profile', () => {
    test('flags are forwarded to the profile against a stub spur (exit 0, JSON)', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'cli-sp-'));
        try {
            const stub = join(dir, 'spur-stub');
            writeFileSync(stub, '#!/bin/bash\necho \'{"entries":[],"total":0}\'\n', { mode: 0o755 });
            const r = await run([
                'workflow',
                'profile',
                'wf',
                '--last',
                '3',
                '--window',
                '120',
                '--spur-bin',
                stub,
                '--json',
            ]);
            expect(r.exitCode).toBe(0);
            const profile = JSON.parse(r.stdout) as { workflow: string; windowSec: number; sampledRuns: number };
            expect(profile).toMatchObject({ workflow: 'wf', windowSec: 120, sampledRuns: 0 });
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('a failing spur call exits 1 naming the command', async () => {
        const r = await run(['workflow', 'profile', 'wf', '--spur-bin', join(tmpdir(), 'no-such-spur')]);
        expect(r.exitCode).toBe(1);
        expect(r.stderr).toContain('spur workflow profile');
    });
});
