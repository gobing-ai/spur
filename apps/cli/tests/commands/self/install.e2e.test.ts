import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { runCli } from '../../helpers';

/**
 * `spur self install` — convergent machine setup (A93 1353 R1-R4).
 *
 * Failure modes first, because a setup command that lies about them is worse than none:
 *   - it scaffolds the current directory, creates a project database, or edits a shell profile
 *   - it overwrites a user's custom global config
 *   - a rerun rewrites healthy seed files (bytes or mtimes) instead of reporting `unchanged`
 *   - a missing required seed asset reports success
 *   - an unknown `--with` tool mutates anything before exiting 2
 *   - a selected optional tool fails silently (exit 0) or rolls back the seeds it did write
 *
 * Every case runs the real source CLI in a subprocess with an isolated HOME, PATH, rules dir
 * and fixture installers, then compares the machine state before/after.
 */

interface Step {
    name: string;
    state: 'created' | 'unchanged' | 'skipped' | 'failed';
    required: boolean;
    message: string;
}

interface InstallJson {
    ok: boolean;
    changed: boolean;
    steps: Step[];
}

interface Fixture {
    root: string;
    cwd: string;
    home: string;
    bin: string;
    env: Record<string, string | undefined>;
    cleanup: () => Promise<void>;
}

/** A PATH directory holding fixture installers (`brew`, `npm`, `superskill`, `zg`, `a2a`). */
async function fixtureBin(root: string, name: string, body: string): Promise<void> {
    const path = join(root, 'bin', name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `#!/bin/sh\n${body}\n`);
    await chmod(path, 0o755);
}

async function fixture(): Promise<Fixture> {
    const root = await mkdtemp(join(tmpdir(), 'spur-self-install-'));
    const cwd = join(root, 'project');
    const home = join(root, 'home');
    const bin = join(root, 'bin');
    await mkdir(cwd, { recursive: true });
    await mkdir(home, { recursive: true });
    await mkdir(bin, { recursive: true });
    // The real bun must stay first so the CLI itself launches; fixtures shadow only installers.
    const env = {
        HOME: home,
        PATH: [dirname(process.execPath), bin, '/usr/bin', '/bin'].join(':'),
        SPUR_GLOBAL_RULES_DIR: join(home, '.config', 'spur'),
        SPUR_PROJECTS_FILE: join(home, 'projects.json'),
    };
    return { root, cwd, home, bin, env, cleanup: () => rm(root, { recursive: true, force: true }) };
}

/** Recursive listing of a tree with byte sizes — the seed-identity snapshot. */
async function tree(dir: string, prefix = ''): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    if (!existsSync(dir)) return out;
    for (const entry of await readdir(join(dir, prefix === '' ? '.' : prefix), { withFileTypes: true })) {
        const rel = prefix === '' ? entry.name : join(prefix, entry.name);
        if (entry.isDirectory()) Object.assign(out, await tree(dir, rel));
        else out[rel] = (await stat(join(dir, rel))).size;
    }
    return out;
}

const configRoot = (fx: Fixture): string => join(fx.home, '.config', 'spur');

describe('spur self install — bare invocation', () => {
    test('seeds machine assets, skips optional tools, and touches no project state', async () => {
        const fx = await fixture();
        try {
            const result = await runCli(['self', 'install', '--json'], fx.cwd, fx.env);
            expect(result.code).toBe(0);
            const json = result.json as InstallJson;
            expect(json.ok).toBe(true);
            expect(json.changed).toBe(true);
            const byName = Object.fromEntries(json.steps.map((step) => [step.name, step]));
            expect(byName.rules?.state).toBe('created');
            expect(byName.rules?.required).toBe(true);
            expect(byName.config?.state).toBe('created');
            for (const tool of ['zg', 'a2a', 'sp-plugin']) {
                expect(byName[tool]?.state).toBe('skipped');
                expect(byName[tool]?.required).toBe(false);
            }
            // Machine assets landed; the project directory and database did not.
            expect(existsSync(join(configRoot(fx), 'config.yaml'))).toBe(true);
            expect(existsSync(join(configRoot(fx), 'rules'))).toBe(true);
            expect(existsSync(join(fx.cwd, '.spur'))).toBe(false);
        } finally {
            await fx.cleanup();
        }
    });

    test('a rerun reports unchanged and rewrites nothing', async () => {
        const fx = await fixture();
        try {
            expect((await runCli(['self', 'install', '--json'], fx.cwd, fx.env)).code).toBe(0);
            const before = await tree(configRoot(fx));
            const second = await runCli(['self', 'install', '--json'], fx.cwd, fx.env);
            expect(second.code).toBe(0);
            const json = second.json as InstallJson;
            expect(json.changed).toBe(false);
            const byName = Object.fromEntries(json.steps.map((step) => [step.name, step]));
            expect(byName.rules?.state).toBe('unchanged');
            expect(byName.config?.state).toBe('unchanged');
            expect(await tree(configRoot(fx))).toEqual(before);
        } finally {
            await fx.cleanup();
        }
    });

    test('a custom global config is preserved byte for byte', async () => {
        const fx = await fixture();
        try {
            await mkdir(configRoot(fx), { recursive: true });
            const custom = 'project: mine\nworkflows:\n  hitlDecisionMaker: false\n';
            await writeFile(join(configRoot(fx), 'config.yaml'), custom);
            const result = await runCli(['self', 'install', '--json'], fx.cwd, fx.env);
            expect(result.code).toBe(0);
            expect(await readFile(join(configRoot(fx), 'config.yaml'), 'utf-8')).toBe(custom);
        } finally {
            await fx.cleanup();
        }
    });
});

describe('spur self install — usage validation', () => {
    test('an unknown tool exits 2 and mutates nothing', async () => {
        const fx = await fixture();
        try {
            const result = await runCli(['self', 'install', '--with', 'not-a-tool', '--json'], fx.cwd, fx.env);
            expect(result.code).toBe(2);
            expect(existsSync(configRoot(fx))).toBe(false);
        } finally {
            await fx.cleanup();
        }
    });
});

describe('spur self install — selected optional tools', () => {
    test('an absent tool is installed through the fixture package manager', async () => {
        const fx = await fixture();
        try {
            const record = join(fx.root, 'brew-argv.txt');
            // The installer must leave the tool resolvable — otherwise the step is not "created".
            await fixtureBin(
                fx.root,
                'brew',
                `printf '%s\\n' "$*" >> ${record}\nprintf '#!/bin/sh\\nexit 0\\n' > "$(dirname "$0")/zg"\nchmod +x "$(dirname "$0")/zg"`,
            );
            const result = await runCli(['self', 'install', '--with', 'zg', '--json'], fx.cwd, fx.env);
            expect(result.code).toBe(0);
            const byName = Object.fromEntries((result.json as InstallJson).steps.map((step) => [step.name, step]));
            expect(byName.zg?.state).toBe('created');
            expect(byName.a2a?.state).toBe('skipped');
            expect(await readFile(record, 'utf-8')).toContain('install zvec-grep');
        } finally {
            await fx.cleanup();
        }
    });

    test('an already healthy binary is not installed again', async () => {
        const fx = await fixture();
        try {
            await fixtureBin(fx.root, 'zg', 'exit 0');
            const record = join(fx.root, 'brew-argv.txt');
            // The installer must leave the tool resolvable — otherwise the step is not "created".
            await fixtureBin(
                fx.root,
                'brew',
                `printf '%s\\n' "$*" >> ${record}\nprintf '#!/bin/sh\\nexit 0\\n' > "$(dirname "$0")/zg"\nchmod +x "$(dirname "$0")/zg"`,
            );
            const result = await runCli(['self', 'install', '--with', 'zg', '--json'], fx.cwd, fx.env);
            expect(result.code).toBe(0);
            const byName = Object.fromEntries((result.json as InstallJson).steps.map((step) => [step.name, step]));
            expect(byName.zg?.state).toBe('unchanged');
            expect(existsSync(record)).toBe(false);
        } finally {
            await fx.cleanup();
        }
    });

    test('a failing selected tool exits 1 and keeps the seeds it wrote', async () => {
        const fx = await fixture();
        try {
            await fixtureBin(fx.root, 'brew', 'exit 7');
            const result = await runCli(['self', 'install', '--with', 'zg', '--json'], fx.cwd, fx.env);
            expect(result.code).toBe(1);
            const json = result.json as InstallJson;
            expect(json.ok).toBe(false);
            const byName = Object.fromEntries(json.steps.map((step) => [step.name, step]));
            expect(byName.zg?.state).toBe('failed');
            expect(byName.zg?.message).toContain('zvec-grep');
            // Convergence: the retry only has to redo the failed step.
            expect(byName.rules?.state).toBe('created');
            expect(existsSync(join(configRoot(fx), 'config.yaml'))).toBe(true);
        } finally {
            await fx.cleanup();
        }
    });

    test('sp-plugin delegates to superskill with the bundled marketplace directory', async () => {
        const fx = await fixture();
        try {
            const record = join(fx.root, 'superskill-argv.txt');
            await fixtureBin(fx.root, 'superskill', `printf '%s\\n' "$*" >> ${record}`);
            const result = await runCli(['self', 'install', '--with', 'sp-plugin', '--json'], fx.cwd, fx.env);
            expect(result.code).toBe(0);
            const argv = (await readFile(record, 'utf-8')).trim().split('\n').at(-1) ?? '';
            expect(argv.startsWith('install sp --marketplace ')).toBe(true);
            expect(argv).not.toContain('--json');
        } finally {
            await fx.cleanup();
        }
    });

    test('a missing superskill is an actionable failure, never a silent adapter copy', async () => {
        const fx = await fixture();
        try {
            const result = await runCli(['self', 'install', '--with', 'sp-plugin', '--json'], fx.cwd, fx.env);
            expect(result.code).toBe(1);
            const byName = Object.fromEntries((result.json as InstallJson).steps.map((step) => [step.name, step]));
            expect(byName['sp-plugin']?.state).toBe('failed');
            expect(byName['sp-plugin']?.message).toContain('superskill');
        } finally {
            await fx.cleanup();
        }
    });
});

describe('spur self install — required failures', () => {
    test('an unwritable global root fails the required step and exits 1', async () => {
        const fx = await fixture();
        try {
            const blocked = join(fx.root, 'blocked');
            await mkdir(blocked, { recursive: true });
            await chmod(blocked, 0o500);
            const result = await runCli(['self', 'install', '--json'], fx.cwd, {
                ...fx.env,
                SPUR_GLOBAL_RULES_DIR: join(blocked, 'rules'),
            });
            expect(result.code).toBe(1);
            const json = result.json as InstallJson;
            expect(json.ok).toBe(false);
            expect(json.steps.some((step) => step.required && step.state === 'failed')).toBe(true);
            await chmod(blocked, 0o700);
        } finally {
            await fx.cleanup();
        }
    });

    test('the text renderer names every step and the summary', async () => {
        const fx = await fixture();
        try {
            const result = await runCli(['self', 'install'], fx.cwd, fx.env);
            expect(result.code).toBe(0);
            expect(result.stdout).toContain('rules');
            expect(result.stdout).toContain('config');
            expect(result.stdout).toContain('zg');
            expect(result.stdout).toContain('changed');
        } finally {
            await fx.cleanup();
        }
    });
});
