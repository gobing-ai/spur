/**
 * Thin-wrapper tests for `spur feature verify` (apps/cli/src/commands/feature/verify.ts; script-absorption PR-5).
 * The app operation is pinned by packages/app tests and the golden parity test
 * (apps/cli/tests/script-absorption-pr5-parity.test.ts); this pins the flag/env mapping, the
 * message prefix and the exit codes through `main()`.
 */

import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getEnvVars } from '@gobing-ai/spur-config';
import { main } from '../../../src/index';
import { createCapturedOutput } from '../../helpers';

let cwd: string;

beforeAll(async () => {
    cwd = join(import.meta.dir, '..', '..', `.tmp-feature-verify-test-${Date.now()}`);
    await mkdir(join(cwd, 'docs', 'features'), { recursive: true });
});

afterAll(() => {
    rmSync(cwd, { recursive: true, force: true });
});

async function run(argv: string[], env: Record<string, string | undefined> = {}) {
    const output = createCapturedOutput();
    let stderr = '';
    const errSpy = spyOn(process.stderr, 'write').mockImplementation((chunk) => {
        stderr += String(chunk);
        return true;
    });
    try {
        const exitCode = await main(argv, { cwd, output, env: { PATH: getEnvVars().PATH, ...env } });
        return { exitCode, out: output.messages.join('\n'), err: output.errors.join('\n'), stderr };
    } finally {
        errSpy.mockRestore();
    }
}

describe('spur feature verify', () => {
    test('an unsafe feature id is refused with exit 1 and the verb prefix', async () => {
        const r = await run(['feature', 'verify', '../x', '--run-id', 'v1']);
        expect(r.exitCode).toBe(1);
        expect(r.err).toBe('feature verify: Error: refusing unsafe feature id: ../x');
    });

    test('ids, command and confidence fall back to the workflow env names', async () => {
        const unknown = await run(['feature', 'verify'], {
            featureId: 'D9',
            __runId: 'v2',
            verificationCmd: 'true',
            confidence: 'LOW',
            ackLowConfidence: 'true',
        });
        expect(unknown.exitCode).toBe(1);
        expect(unknown.err).toBe('feature verify: Error: feature D9 not found in the configured features directory');
        const noRun = await run([
            'feature',
            'verify',
            'D9',
            '--cmd',
            'true',
            '--confidence',
            'HIGH',
            '--ack-low-confidence',
        ]);
        expect(noRun.exitCode).toBe(1);
        expect(noRun.err).toBe('feature verify: Error: refusing unsafe run id: ');
    });
});
