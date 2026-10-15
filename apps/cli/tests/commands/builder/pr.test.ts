/**
 * Thin-wrapper tests for `spur builder pr` (script-absorption PR-7). The spine is pinned by
 * packages/app/tests/services/pr-review; this pins argv pass-through and exit codes.
 */
import { describe, expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { getEnvVars } from '@gobing-ai/spur-config';
import { main } from '../../../src/index';
import { createCapturedOutput } from '../../helpers';

async function run(argv: string[]) {
    const output = createCapturedOutput();
    const exitCode = await main(argv, { cwd: tmpdir(), output, env: { PATH: getEnvVars().PATH } });
    return { exitCode, stdout: output.messages.join('\n'), stderr: output.errors.join('\n') };
}

describe('spur builder pr', () => {
    test('help subcommand prints the spine usage (exit 0)', async () => {
        const r = await run(['builder', 'pr', 'help']);
        expect(r.exitCode).toBe(0);
        expect(r.stdout).toContain('spur builder pr');
    });

    test('an unknown subcommand is a usage error (exit 1)', async () => {
        const r = await run(['builder', 'pr', 'bogus']);
        expect(r.exitCode).toBe(1);
        expect(r.stderr).toContain('unknown subcommand: bogus');
    });

    test('unknown flags reach the spine parser instead of Commander', async () => {
        // Same as the retired script: a parser throw is a hard failure (exit 2) with the reason.
        const r = await run(['builder', 'pr', 'wait', '--bogus']);
        expect(r.exitCode).toBe(2);
        expect(r.stderr).toContain('unknown argument');
    });
});
