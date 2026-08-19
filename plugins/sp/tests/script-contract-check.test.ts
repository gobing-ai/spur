import { expect, spyOn, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadManifest, parseArgs, run, type ScriptManifest, validateContract } from '../scripts/script-contract-check';

const SCRIPT = join(import.meta.dir, '..', 'scripts', 'script-contract-check.ts');

function createTempEnv() {
    const root = mkdtempSync(join(tmpdir(), 'script-contract-test-'));
    const configDir = join(root, 'config');
    const scriptsDir = join(root, 'plugins', 'sp', 'scripts');
    const commandsDir = join(root, 'plugins', 'sp', 'commands');
    const skillsDir = join(root, 'plugins', 'sp', 'skills');
    const agentsDir = join(root, 'plugins', 'sp', 'agents');
    const pluginDir = join(root, 'plugins', 'sp');

    mkdirSync(configDir, { recursive: true });
    mkdirSync(scriptsDir, { recursive: true });
    mkdirSync(commandsDir, { recursive: true });
    mkdirSync(skillsDir, { recursive: true });
    mkdirSync(agentsDir, { recursive: true });

    writeFileSync(join(pluginDir, 'README.md'), '# Plugin\n');

    return {
        root,
        configDir,
        scriptsDir,
        pluginDir,
        cleanup: () => rmSync(root, { recursive: true, force: true }),
    };
}

test('parseArgs parses custom flags', () => {
    const res = parseArgs(['--manifest', 'foo.json', '--scripts-dir', 'bar', '--plugin-dir', 'baz']);
    expect(res.manifest).toBe('foo.json');
    expect(res.scriptsDir).toBe('bar');
    expect(res.pluginDir).toBe('baz');
});

test('loadManifest handles missing, malformed, and valid files', () => {
    const env = createTempEnv();
    try {
        const missing = loadManifest(join(env.root, 'missing.json'));
        expect(missing.manifest).toBeNull();
        expect(missing.error).toContain('not found');

        const badJson = join(env.root, 'bad.json');
        writeFileSync(badJson, '{ bad json');
        const malformed = loadManifest(badJson);
        expect(malformed.manifest).toBeNull();
        expect(malformed.error).toContain('malformed JSON');

        const noEntries = join(env.root, 'no-entries.json');
        writeFileSync(noEntries, JSON.stringify({ note: 'no entries' }));
        const missingEntries = loadManifest(noEntries);
        expect(missingEntries.manifest).toBeNull();
        expect(missingEntries.error).toContain('missing "entries" array');

        const goodJson = join(env.root, 'good.json');
        writeFileSync(goodJson, JSON.stringify({ entries: [{ rel: 'a.ts', contract: 'repo-only' }] }));
        const good = loadManifest(goodJson);
        expect(good.manifest?.entries.length).toBe(1);
    } finally {
        env.cleanup();
    }
});

test('R1 — missing .mjs twin for a standard script fails the gate', () => {
    const env = createTempEnv();
    try {
        writeFileSync(join(env.scriptsDir, 'my-tool.ts'), 'console.log("hello");\n');
        const manifest: ScriptManifest = {
            entries: [{ rel: 'my-tool.ts', contract: 'standard', twin: 'my-tool.mjs' }],
        };
        const violations = validateContract(manifest, env.scriptsDir, env.pluginDir);
        expect(violations.some((v) => v.kind === 'missing_twin' && v.target === 'my-tool.ts')).toBe(true);
    } finally {
        env.cleanup();
    }
});

test('R1 — stale .mjs twin older than .ts source fails the gate', () => {
    const env = createTempEnv();
    try {
        const tsPath = join(env.scriptsDir, 'tool.ts');
        const mjsPath = join(env.scriptsDir, 'tool.mjs');
        writeFileSync(tsPath, 'console.log("new");\n');
        writeFileSync(mjsPath, 'console.log("old");\n');

        // Set mtime of mjs to 100 seconds in the past
        const past = (Date.now() - 100000) / 1000;
        utimesSync(mjsPath, past, past);

        const manifest: ScriptManifest = {
            entries: [{ rel: 'tool.ts', contract: 'standard', twin: 'tool.mjs' }],
        };
        const violations = validateContract(manifest, env.scriptsDir, env.pluginDir);
        expect(violations.some((v) => v.kind === 'stale_twin')).toBe(true);
    } finally {
        env.cleanup();
    }
});

test('R2 — repo-only script with a .mjs twin fails unexpected_twin', () => {
    const env = createTempEnv();
    try {
        writeFileSync(join(env.scriptsDir, 'internal.ts'), 'console.log("internal");\n');
        writeFileSync(join(env.scriptsDir, 'internal.mjs'), 'console.log("internal mjs");\n');
        const manifest: ScriptManifest = {
            entries: [{ rel: 'internal.ts', contract: 'repo-only' }],
        };
        const violations = validateContract(manifest, env.scriptsDir, env.pluginDir);
        expect(violations.some((v) => v.kind === 'unexpected_twin')).toBe(true);
    } finally {
        env.cleanup();
    }
});

test('R2 — unexpected .mjs twin with no corresponding ts entry fails unexpected_twin', () => {
    const env = createTempEnv();
    try {
        writeFileSync(join(env.scriptsDir, 'orphan.mjs'), 'console.log("orphan");\n');
        const manifest: ScriptManifest = {
            entries: [],
        };
        const violations = validateContract(manifest, env.scriptsDir, env.pluginDir);
        expect(violations.some((v) => v.kind === 'unexpected_twin' && v.target === 'orphan.mjs')).toBe(true);
    } finally {
        env.cleanup();
    }
});

test('R3 — unlisted script on disk fails unregistered_script', () => {
    const env = createTempEnv();
    try {
        writeFileSync(join(env.scriptsDir, 'rogue.ts'), 'console.log("rogue");\n');
        const manifest: ScriptManifest = {
            entries: [],
        };
        const violations = validateContract(manifest, env.scriptsDir, env.pluginDir);
        expect(violations.some((v) => v.kind === 'unregistered_script' && v.target === 'rogue.ts')).toBe(true);
    } finally {
        env.cleanup();
    }
});

test('R3 — manifest entry not present on disk fails unregistered_script', () => {
    const env = createTempEnv();
    try {
        const manifest: ScriptManifest = {
            entries: [{ rel: 'missing.ts', contract: 'repo-only' }],
        };
        const violations = validateContract(manifest, env.scriptsDir, env.pluginDir);
        expect(violations.some((v) => v.kind === 'unregistered_script' && v.target === 'missing.ts')).toBe(true);
    } finally {
        env.cleanup();
    }
});

test('Incomplete manifest entry without rel or contract fails incomplete', () => {
    const env = createTempEnv();
    try {
        const manifest: ScriptManifest = {
            // @ts-expect-error
            entries: [{ contract: 'standard' }],
        };
        const violations = validateContract(manifest, env.scriptsDir, env.pluginDir);
        expect(violations.some((v) => v.kind === 'incomplete')).toBe(true);
    } finally {
        env.cleanup();
    }
});

test('R4 — forbidden invocation in shipped command/skill/agent/README fails', () => {
    const env = createTempEnv();
    try {
        writeFileSync(join(env.scriptsDir, 'tool.ts'), 'console.log("tool");\n');
        writeFileSync(join(env.scriptsDir, 'tool.mjs'), 'console.log("tool");\n');
        writeFileSync(
            join(env.pluginDir, 'commands', 'bad-command.md'),
            '# Bad Command\n\nRun `bun plugins/sp/scripts/tool.ts` here\n',
        );
        const manifest: ScriptManifest = {
            entries: [{ rel: 'tool.ts', contract: 'standard', twin: 'tool.mjs' }],
        };
        const violations = validateContract(manifest, env.scriptsDir, env.pluginDir);
        expect(violations.some((v) => v.kind === 'forbidden_invocation' && v.message.includes('bad-command.md'))).toBe(
            true,
        );
    } finally {
        env.cleanup();
    }
});

test('Clean setup with standard twins and repo-only scripts passes', () => {
    const env = createTempEnv();
    try {
        writeFileSync(join(env.scriptsDir, 'ship.ts'), 'console.log("ship");\n');
        writeFileSync(join(env.scriptsDir, 'ship.mjs'), 'console.log("ship");\n');
        writeFileSync(join(env.scriptsDir, 'local.ts'), 'console.log("local");\n');
        writeFileSync(
            join(env.pluginDir, 'commands', 'good-command.md'),
            '# Good Command\n\nRun `node "$(superskill script path sp ship.mjs)"` here\n',
        );
        const manifest: ScriptManifest = {
            entries: [
                { rel: 'ship.ts', contract: 'standard', twin: 'ship.mjs' },
                { rel: 'local.ts', contract: 'repo-only' },
            ],
        };
        const violations = validateContract(manifest, env.scriptsDir, env.pluginDir);
        expect(violations).toEqual([]);
    } finally {
        env.cleanup();
    }
});

test('CLI runner exits 0 for live repo manifest and scripts', () => {
    const proc = Bun.spawnSync(['bun', SCRIPT], {
        cwd: join(import.meta.dir, '../../..'),
        stdout: 'pipe',
        stderr: 'pipe',
    });
    const stdout = new TextDecoder().decode(proc.stdout);
    expect(proc.exitCode).toBe(0);
    expect(stdout).toContain('PASS');
});

test('in-process run() handles success, manifest error, and validation failure', () => {
    const logSpy = spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = spyOn(console, 'error').mockImplementation(() => {});
    const env = createTempEnv();
    try {
        const errCode = run(['--manifest', join(env.root, 'nonexistent.json')]);
        expect(errCode).toBe(1);

        writeFileSync(join(env.scriptsDir, 'ship.ts'), 'console.log("ship");\n');
        writeFileSync(join(env.scriptsDir, 'ship.mjs'), 'console.log("ship");\n');
        const manifestPath = join(env.configDir, 'plugin-scripts.json');
        writeFileSync(
            manifestPath,
            JSON.stringify({ entries: [{ rel: 'ship.ts', contract: 'standard', twin: 'ship.mjs' }] }),
        );

        const successCode = run([
            '--manifest',
            manifestPath,
            '--scripts-dir',
            env.scriptsDir,
            '--plugin-dir',
            env.pluginDir,
        ]);
        expect(successCode).toBe(0);

        writeFileSync(join(env.scriptsDir, 'untracked.ts'), 'console.log("untracked");\n');
        const failCode = run([
            '--manifest',
            manifestPath,
            '--scripts-dir',
            env.scriptsDir,
            '--plugin-dir',
            env.pluginDir,
        ]);
        expect(failCode).toBe(1);
    } finally {
        logSpy.mockRestore();
        errSpy.mockRestore();
        env.cleanup();
    }
});
