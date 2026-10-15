import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runDogfoodValidateCli } from '../../../src/services/dogfood/validate-cli';

const passFixture = readFileSync(join(import.meta.dir, 'fixtures', 'report-complete.md'), 'utf8');

/** `spur agent dogfood validate-report` argv contract (script-absorption PR-7). */
describe('dogfood validate-report CLI', () => {
    test('validate CLI — pass fixture exits 0; §-style exits 2 (task 0278 R6)', async () => {
        const files = new Map<string, string>([
            ['pass.md', passFixture],
            ['bad.md', '## §1 Summary\nprotocol: sp:dogfood-testing@1.2\n'],
        ]);
        const read = (p: string) => {
            const v = files.get(p);
            if (v === undefined) throw new Error(`missing ${p}`);
            return v;
        };
        const ok = await runDogfoodValidateCli(['--file', 'pass.md'], read);
        expect(ok.exitCode).toBe(0);
        expect(ok.stdout.trim()).toBe('ok');

        const badJson = await runDogfoodValidateCli(['--file', 'bad.md', '--json'], read);
        expect(badJson.exitCode).toBe(2);
        const parsed = JSON.parse(badJson.stdout) as { ok: boolean; errors: string[] };
        expect(parsed.ok).toBe(false);
        expect(parsed.errors.length).toBeGreaterThan(0);

        const badPlain = await runDogfoodValidateCli(['bad.md'], read);
        expect(badPlain.exitCode).toBe(2);
        expect(badPlain.stdout).toContain('missing_footer');

        const help = await runDogfoodValidateCli(['--help'], read);
        expect(help.exitCode).toBe(0);
        expect(help.stderr).toContain('Usage:');

        const usage = await runDogfoodValidateCli([], read);
        expect(usage.exitCode).toBe(1);
        expect(usage.stderr).toContain('Usage:');

        const missing = await runDogfoodValidateCli(['--file', 'nope.md'], read);
        expect(missing.exitCode).toBe(1);
        expect(missing.stderr).toContain('Failed to read');

        // An async reader (the CLI's FileSystem seam) and its rejection are awaited too.
        const asyncOk = await runDogfoodValidateCli(['--file', 'pass.md'], async (p) => read(p));
        expect(asyncOk.stdout).toBe('ok\n');
        const rejected = await runDogfoodValidateCli(['--file', 'x.md'], () => Promise.reject('boom'));
        expect(rejected.stderr).toBe('Failed to read x.md: boom');
    });
});
