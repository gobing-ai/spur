/**
 * Thin-wrapper tests for `spur history anatomy` (script-absorption PR-6). The ops are pinned by
 * packages/app/tests/services/history-anatomy-cli.test.ts; this pins argv pass-through, the
 * HA_HELPER identity and exit codes.
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVars } from '@gobing-ai/spur-config';
import { spurEntryPath } from '../../../src/commands/history/anatomy';
import { main } from '../../../src/index';
import { createCapturedOutput } from '../../helpers';

async function run(argv: string[], cwd = tmpdir()) {
    const output = createCapturedOutput();
    const exitCode = await main(argv, { cwd, output, env: { PATH: getEnvVars().PATH, HOME: cwd } });
    return { exitCode, stdout: output.messages.join('\n'), stderr: output.errors.join('\n') };
}

describe('spur history anatomy', () => {
    test('digest passes through and prints the hex digest (exit 0)', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'cli-ha-'));
        try {
            const artifact = join(dir, 'a.json');
            writeFileSync(artifact, '{"totals":{"messages":1}}');
            const r = await run(['history', 'anatomy', 'digest', artifact]);
            expect(r.exitCode).toBe(0);
            expect(r.stdout).toMatch(/^[0-9a-f]{64}$/);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('an unknown op is a usage failure (exit 1) listing the ops', async () => {
        const r = await run(['history', 'anatomy', 'bogus']);
        expect(r.exitCode).toBe(1);
        expect(r.stderr).toContain('valid commands: digest, check, paths');
    });

    test('paths records the running spur entry as HA_HELPER and resolves the skill from cwd (HOME from the context)', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'cli-ha-paths-'));
        try {
            const out = join(dir, 'paths.env');
            const r = await run(['history', 'anatomy', 'paths', '--date', '2026-08-24', '--out', out], dir);
            expect(r.exitCode).toBe(0);
            const env = readFileSync(out, 'utf8');
            expect(env).toContain(`HA_HELPER=${spurEntryPath()}\n`);
            expect(env).toContain(`HA_SKILL=${join(dir, 'plugins', 'sp', 'skills', 'history-anatomy')}\n`);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('spurEntryPath prefers a script entry, else the executable', () => {
        expect(spurEntryPath(['bun', '/repo/apps/cli/src/index.ts'], '/usr/bin/bun')).toBe(
            '/repo/apps/cli/src/index.ts',
        );
        expect(spurEntryPath(['/usr/local/bin/spur'], '/usr/local/bin/spur')).toBe('/usr/local/bin/spur');
        expect(spurEntryPath(['spur', 'history'], '/opt/spur')).toBe('/opt/spur');
        expect(spurEntryPath()).toBeString();
    });
});
