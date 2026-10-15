/**
 * Thin-wrapper tests for `spur feature handoff` (apps/cli/src/commands/feature/handoff.ts; script-absorption PR-5).
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
    cwd = join(import.meta.dir, '..', '..', `.tmp-feature-handoff-test-${Date.now()}`);
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

describe('spur feature handoff', () => {
    test('missing run id or feature id fails closed with exit 1', async () => {
        const r = await run(['feature', 'handoff']);
        expect(r.exitCode).toBe(1);
        expect(r.stderr).toBe('idea-handoff: __runId and featureId env vars are required\n');
    });

    test('flags and env carry the ids; missing run artifacts fail with exit 1 and no report', async () => {
        const flags = await run(['feature', 'handoff', 'F1', '--run-id', 'h1', '--spur-bin', 'false']);
        expect(flags.exitCode).toBe(1);
        expect(flags.stderr).toStartWith('idea-handoff: ');
        expect(flags.stderr).not.toContain('env vars are required');
        const env = await run(['feature', 'handoff'], { featureId: 'F1', __runId: 'h2', spurBin: 'false' });
        expect(env.exitCode).toBe(1);
        expect(env.stderr).not.toContain('env vars are required');
        const defaultBin = await run(['feature', 'handoff', 'F1', '--run-id', 'h3']);
        expect(defaultBin.exitCode).toBe(1);
    });
});
