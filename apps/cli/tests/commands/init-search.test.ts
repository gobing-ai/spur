import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVars } from '@gobing-ai/spur-config';
import { main } from '../../src/index';
import type { CommandOutput } from '../../src/output';
import { createTempProject, runCli } from '../helpers';

function nullOutput(): CommandOutput {
    return { write: () => {}, error: () => {} };
}

/** Build main() options with the global rules seed redirected to an isolated temp dir. */
async function isolatedOptions(cwd: string) {
    const globalDir = await mkdtemp(join(tmpdir(), 'spur-glob-'));
    const env = { ...getEnvVars(), SPUR_GLOBAL_RULES_DIR: globalDir };
    return { options: { cwd, env, output: nullOutput(), dbUrl: ':memory:' as const }, globalDir };
}

describe('init — zg readiness and .zvec-grep gitignore (task 1289 / A34 R12)', () => {
    test('fresh init writes both gitignore entries — .spur/context/ and .zvec-grep/', async () => {
        const cwd = await createTempProject();
        const { options } = await isolatedOptions(cwd);

        expect(await main(['init'], options)).toBe(0);

        const gitignorePath = join(cwd, '.gitignore');
        expect(existsSync(gitignorePath)).toBe(true);
        const content = readFileSync(gitignorePath, 'utf-8');
        expect(content).toContain('# Spur indexed-context (machine-generated)\n.spur/context/');
        expect(content).toContain('# zg semantic-search index (operator-built)\n.zvec-grep/');
    });

    test('re-init does not duplicate either entry', async () => {
        const cwd = await createTempProject();
        const { options } = await isolatedOptions(cwd);

        expect(await main(['init'], options)).toBe(0);
        expect(await main(['init', '--force'], options)).toBe(0);

        const content = readFileSync(join(cwd, '.gitignore'), 'utf-8');
        expect((content.match(/\.spur\/context\//g) ?? []).length).toBe(1);
        expect((content.match(/\.zvec-grep\//g) ?? []).length).toBe(1);
    });

    test('existing .gitignore with .zvec-grep/ already present is left alone for that entry', async () => {
        const cwd = await createTempProject();
        writeFileSync(
            join(cwd, '.gitignore'),
            'node_modules/\n\n# zg semantic-search index (operator-built)\n.zvec-grep/\n',
            'utf-8',
        );
        const { options } = await isolatedOptions(cwd);

        expect(await main(['init'], options)).toBe(0);

        const content = readFileSync(join(cwd, '.gitignore'), 'utf-8');
        expect(content).toContain('node_modules/');
        expect((content.match(/\.zvec-grep\//g) ?? []).length).toBe(1);
        expect(content).toContain('.spur/context/');
    });

    test('--minimal still writes both entries', async () => {
        const cwd = await createTempProject();
        const { options } = await isolatedOptions(cwd);

        expect(await main(['init', '--minimal'], options)).toBe(0);

        const content = readFileSync(join(cwd, '.gitignore'), 'utf-8');
        expect(content).toContain('.spur/context/');
        expect(content).toContain('.zvec-grep/');
    });

    test('--json payload carries the search readiness field', async () => {
        const cwd = await createTempProject();
        const result = await runCli(['init', '--minimal', '--json'], cwd);
        expect(result.code).toBe(0);

        const payload = JSON.parse(result.stdout) as {
            search?: { rg: { available: boolean }; zg: { available: boolean; index: string } };
        };
        const search = payload.search;
        expect(search).toBeDefined();
        if (!search) throw new Error('search missing from init --json payload');
        expect(typeof search.rg.available).toBe('boolean');
        expect(['ready', 'stale', 'missing', 'unknown']).toContain(search.zg.index);
    });

    test('zg absent environment reports index unknown and init still exits 0', async () => {
        const cwd = await createTempProject();
        // PATH keeps the bun shim dir (runCli spawns `bun`) plus system dirs but drops the
        // bun global bin dir where zg lives, so `which zg` misses.
        const bunDir = join(Bun.which('bun') ?? '/usr/bin', '..');
        const result = await runCli(['init', '--minimal', '--json'], cwd, { PATH: `${bunDir}:/usr/bin:/bin` });
        expect(result.code).toBe(0);

        const payload = JSON.parse(result.stdout) as {
            search?: { zg: { available: boolean; index: string } };
        };
        const zg = payload.search?.zg;
        if (!zg) throw new Error('search.zg missing from init --json payload');
        expect(zg.available).toBe(false);
        expect(zg.index).toBe('unknown');
    });

    test('human output prints one search readiness line', async () => {
        const cwd = await createTempProject();
        const result = await runCli(['init', '--minimal'], cwd);
        expect(result.code).toBe(0);

        const lines = result.stdout.split('\n').filter((line) => line.startsWith('search: '));
        expect(lines.length).toBe(1);
        expect(lines[0]?.length).toBeGreaterThan('search: '.length);
    });

    // Regression (A34 dogfood): the converged re-run branch returned before the readiness
    // probe, so a second `spur init` silently dropped the R12 report in both output modes.
    test('converged re-init still reports search readiness in JSON and human output', async () => {
        const cwd = await createTempProject();
        expect((await runCli(['init', '--minimal'], cwd)).code).toBe(0);

        const jsonRun = await runCli(['init', '--minimal', '--json'], cwd);
        expect(jsonRun.code).toBe(0);
        const payload = JSON.parse(jsonRun.stdout) as { converged?: boolean; search?: { zg: { index: string } } };
        expect(payload.converged).toBe(true);
        expect(['ready', 'stale', 'missing', 'unknown']).toContain(payload.search?.zg.index ?? '<absent>');

        const humanRun = await runCli(['init', '--minimal'], cwd);
        expect(humanRun.code).toBe(0);
        expect(humanRun.stdout).toContain('Already initialized');
        expect(humanRun.stdout.split('\n').filter((line) => line.startsWith('search: ')).length).toBe(1);
    });
});
