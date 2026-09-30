import { expect, spyOn, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    checkPlacement,
    loadManifest,
    loadPlacementBaseline,
    parseArgs,
    run,
    type ScriptManifest,
    spawnConvertTwin,
    validateContract,
} from './script-contract-check';

const SCRIPT = join(import.meta.dir, 'script-contract-check.ts');

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

/** Deterministic stand-in for the real `superskill script convert` output. */
const twinOf = (source: string): string => `// twin\n${source}`;

/** A fake converter that regenerates a fixture twin exactly as the real one would. */
const fakeConvert =
    (scriptsDir: string) =>
    (rel: string, outPath: string): boolean => {
        writeFileSync(outPath, twinOf(readFileSync(join(scriptsDir, rel), 'utf8')));
        return true;
    };

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

test('R5 — @gobing-ai value import in a bundled surface fails the gate', () => {
    const env = createTempEnv();
    try {
        writeFileSync(
            join(env.scriptsDir, 'my-tool.ts'),
            "import { getEnvVar } from '@gobing-ai/ts-utils';\nconsole.log(getEnvVar('X'));\n",
        );
        const manifest: ScriptManifest = {
            entries: [{ rel: 'my-tool.ts', contract: 'standard', twin: 'my-tool.mjs' }],
        };
        const violations = validateContract(manifest, env.scriptsDir, env.pluginDir);
        expect(violations.some((v) => v.kind === 'gobing_ai_import' && v.target.includes('my-tool.ts'))).toBe(true);
    } finally {
        env.cleanup();
    }
});

test('R5 — type-only @gobing-ai imports are exempt (erased at bundle)', () => {
    const env = createTempEnv();
    try {
        writeFileSync(
            join(env.scriptsDir, 'my-tool.ts'),
            "import type { WorkflowActionTraceWriter } from '@gobing-ai/app';\nimport { join } from 'node:path';\nconsole.log(join('a', 'b'));\n",
        );
        const manifest: ScriptManifest = {
            entries: [{ rel: 'my-tool.ts', contract: 'standard', twin: 'my-tool.mjs' }],
        };
        const violations = validateContract(manifest, env.scriptsDir, env.pluginDir);
        expect(violations.some((v) => v.kind === 'gobing_ai_import')).toBe(false);
    } finally {
        env.cleanup();
    }
});

test('R1 — twin content differing from a fresh convert fails stale_twin, even with a newer mtime', () => {
    const env = createTempEnv();
    try {
        const tsPath = join(env.scriptsDir, 'tool.ts');
        const mjsPath = join(env.scriptsDir, 'tool.mjs');
        writeFileSync(tsPath, 'A\n');
        writeFileSync(mjsPath, twinOf('B\n'));

        // The twin is 100s NEWER than its source: the old mtime rule passed this, which is
        // exactly the committed-stale-twin case the gate exists to catch.
        const future = (Date.now() + 100_000) / 1000;
        utimesSync(mjsPath, future, future);

        const manifest: ScriptManifest = {
            entries: [{ rel: 'tool.ts', contract: 'standard', twin: 'tool.mjs' }],
        };
        const violations = validateContract(manifest, env.scriptsDir, env.pluginDir, {
            convertTwin: fakeConvert(env.scriptsDir),
        });
        expect(violations.some((v) => v.kind === 'stale_twin' && v.target === 'tool.ts')).toBe(true);
    } finally {
        env.cleanup();
    }
});

test('R1 — twin content matching a fresh convert passes, even with an older mtime', () => {
    const env = createTempEnv();
    try {
        const tsPath = join(env.scriptsDir, 'tool.ts');
        const mjsPath = join(env.scriptsDir, 'tool.mjs');
        writeFileSync(tsPath, 'A\n');
        writeFileSync(mjsPath, twinOf('A\n'));

        const past = (Date.now() - 100_000) / 1000;
        utimesSync(mjsPath, past, past);

        const manifest: ScriptManifest = {
            entries: [{ rel: 'tool.ts', contract: 'standard', twin: 'tool.mjs' }],
        };
        const violations = validateContract(manifest, env.scriptsDir, env.pluginDir, {
            convertTwin: fakeConvert(env.scriptsDir),
        });
        expect(violations.some((v) => v.kind === 'stale_twin')).toBe(false);
    } finally {
        env.cleanup();
    }
});

test('R3 — a converter that cannot run reports one converter_unavailable and no stale_twin', () => {
    const env = createTempEnv();
    try {
        writeFileSync(join(env.scriptsDir, 'a.ts'), 'A\n');
        writeFileSync(join(env.scriptsDir, 'a.mjs'), 'old-a\n');
        writeFileSync(join(env.scriptsDir, 'b.ts'), 'B\n');
        writeFileSync(join(env.scriptsDir, 'b.mjs'), 'old-b\n');
        const manifest: ScriptManifest = {
            entries: [
                { rel: 'a.ts', contract: 'standard', twin: 'a.mjs' },
                { rel: 'b.ts', contract: 'standard', twin: 'b.mjs' },
            ],
        };
        const violations = validateContract(manifest, env.scriptsDir, env.pluginDir, {
            convertTwin: () => false,
        });
        expect(violations.filter((v) => v.kind === 'converter_unavailable')).toHaveLength(1);
        expect(violations.some((v) => v.kind === 'stale_twin')).toBe(false);
    } finally {
        env.cleanup();
    }
});

test('R3 — the default converter fails loudly when its binary is missing', () => {
    const env = createTempEnv();
    try {
        writeFileSync(join(env.scriptsDir, 'tool.ts'), 'A\n');
        writeFileSync(join(env.scriptsDir, 'tool.mjs'), 'old\n');
        const manifest: ScriptManifest = {
            entries: [{ rel: 'tool.ts', contract: 'standard', twin: 'tool.mjs' }],
        };
        const convert = spawnConvertTwin(env.root, 'superskill-not-installed');
        expect(convert('tool.ts', join(env.root, 'out.mjs'))).toBe(false);
        expect(convert.lastError ?? '').toContain('superskill-not-installed');

        const violations = validateContract(manifest, env.scriptsDir, env.pluginDir, {
            convertTwin: convert,
        });
        expect(violations.some((v) => v.kind === 'converter_unavailable')).toBe(true);
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
        writeFileSync(join(env.scriptsDir, 'tool.mjs'), twinOf('console.log("tool");\n'));
        writeFileSync(
            join(env.pluginDir, 'commands', 'bad-command.md'),
            '# Bad Command\n\nRun `bun plugins/sp/scripts/tool.ts` here\n',
        );
        const manifest: ScriptManifest = {
            entries: [{ rel: 'tool.ts', contract: 'standard', twin: 'tool.mjs' }],
        };
        const violations = validateContract(manifest, env.scriptsDir, env.pluginDir, {
            convertTwin: fakeConvert(env.scriptsDir),
        });
        expect(violations.some((v) => v.kind === 'forbidden_invocation' && v.message.includes('bad-command.md'))).toBe(
            true,
        );
    } finally {
        env.cleanup();
    }
});

test('R5 — an ungated project-first probe in a workflow YAML fails; a guarded probe passes', () => {
    const env = createTempEnv();
    try {
        const wfDir = join(env.root, 'config', 'workflows');
        mkdirSync(wfDir, { recursive: true });
        writeFileSync(join(env.scriptsDir, 'tool.ts'), 'console.log("tool");\n');
        writeFileSync(join(env.scriptsDir, 'tool.mjs'), twinOf('console.log("tool");\n'));
        const manifest: ScriptManifest = { entries: [{ rel: 'tool.ts', contract: 'standard', twin: 'tool.mjs' }] };

        const command = (guard: string): string =>
            [
                'name: fixture',
                'kind: state-machine',
                'states:',
                '  - id: start',
                '    onEnter:',
                '      - kind: shell',
                '        options:',
                '          command: >-',
                `            ${guard}`,
                '            [ -f "$S" ] || S="$(superskill script path sp tool.mjs 2>/dev/null)";',
                '            bun "$S"',
                '',
            ].join('\n');

        // Ungated: the probe names the project tree with no source-repo marker in the block.
        writeFileSync(join(wfDir, 'ungated.yaml'), command('S=plugins/sp/scripts/tool.ts;'));
        const ungated = validateContract(manifest, env.scriptsDir, env.pluginDir, {
            convertTwin: fakeConvert(env.scriptsDir),
        });
        expect(ungated.some((v) => v.kind === 'forbidden_invocation' && v.target.includes('ungated.yaml'))).toBe(true);

        // Guarded: the same probe, marker on the guard line — the folded block is legal.
        // Remove the ungated fixture first: the scanner covers the whole workflows dir.
        rmSync(join(wfDir, 'ungated.yaml'), { force: true });
        writeFileSync(
            join(wfDir, 'guarded.yaml'),
            command('S=; [ -f config/plugin-scripts.json ] && S=plugins/sp/scripts/tool.ts;'),
        );
        const guarded = validateContract(manifest, env.scriptsDir, env.pluginDir, {
            convertTwin: fakeConvert(env.scriptsDir),
        });
        expect(guarded.filter((v) => v.kind === 'forbidden_invocation')).toEqual([]);
    } finally {
        env.cleanup();
    }
});

test('Clean setup with standard twins and repo-only scripts passes', () => {
    const env = createTempEnv();
    try {
        writeFileSync(join(env.scriptsDir, 'ship.ts'), 'console.log("ship");\n');
        writeFileSync(join(env.scriptsDir, 'ship.mjs'), twinOf('console.log("ship");\n'));
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
        const violations = validateContract(manifest, env.scriptsDir, env.pluginDir, {
            convertTwin: fakeConvert(env.scriptsDir),
        });
        expect(violations).toEqual([]);
    } finally {
        env.cleanup();
    }
});

test('CLI runner exits 0 for live repo manifest and scripts', () => {
    const proc = Bun.spawnSync(['bun', SCRIPT], {
        cwd: join(import.meta.dir, '../..'),
        stdout: 'pipe',
        stderr: 'pipe',
    });
    const stdout = new TextDecoder().decode(proc.stdout);
    expect(proc.exitCode).toBe(0);
    expect(stdout).toContain('PASS');
}, 30_000);

test('in-process run() handles success, manifest error, and validation failure', () => {
    const logSpy = spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = spyOn(console, 'error').mockImplementation(() => {});
    const env = createTempEnv();
    try {
        const errCode = run(['--manifest', join(env.root, 'nonexistent.json')]);
        expect(errCode).toBe(1);

        // repo-only: run() supplies the real spawn-based converter, so a standard entry here
        // would need a genuine `superskill script convert` twin. Rule 1's content check is
        // covered by the validateContract tests and the live-repo runner test.
        writeFileSync(join(env.scriptsDir, 'ship.ts'), 'console.log("ship");\n');
        const manifestPath = join(env.configDir, 'plugin-scripts.json');
        writeFileSync(manifestPath, JSON.stringify({ entries: [{ rel: 'ship.ts', contract: 'repo-only' }] }));

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

// ---- Placement scan (task 1000: --placement-only, baseline, plan §2 reconcile) ----

function createPlacementFixture(): string {
    const root = mkdtempSync(join(tmpdir(), 'placement-test-'));
    const scriptsDir = join(root, 'plugins', 'sp', 'scripts');
    const hooksDir = join(root, 'plugins', 'sp', 'hooks');
    const repoCommandsDir = join(root, 'scripts', 'commands');
    const cliCommandsDir = join(root, 'apps', 'cli', 'src', 'commands');
    for (const dir of [scriptsDir, hooksDir, repoCommandsDir, cliCommandsDir]) mkdirSync(dir, { recursive: true });
    writeFileSync(join(scriptsDir, 'big.ts'), `${Array.from({ length: 301 }, (_, i) => `// line ${i}`).join('\n')}\n`);
    writeFileSync(join(scriptsDir, 'db.ts'), `import { Database } from 'bun:sqlite';\nexport const db = 1;\n`);
    writeFileSync(join(scriptsDir, 'corpus.ts'), `export const path = 'docs/tasks/0099_task.md';\n`);
    writeFileSync(join(scriptsDir, 'typed.ts'), `import type { Database } from 'bun:sqlite';\nexport const t = 1;\n`);
    writeFileSync(join(repoCommandsDir, 'task.ts'), 'export const glue = 1;\n');
    writeFileSync(join(cliCommandsDir, 'task.ts'), 'export const noun = 1;\n');
    writeFileSync(join(hooksDir, 'fine.ts'), 'export const fine = 1;\n');
    writeFileSync(join(scriptsDir, 'skipped.test.ts'), `import { test } from 'bun:test';\ntest('skip', () => {});\n`);
    return root;
}

test('checkPlacement reports each finding kind once per file', () => {
    const root = createPlacementFixture();
    try {
        const findings = checkPlacement({ repoRoot: root, baselinePath: join(root, 'config', 'missing.json') });
        const byFile = new Map(findings.map((f) => [f.file, f.kind]));
        expect(byFile.get('plugins/sp/scripts/big.ts')).toBe('budget');
        expect(findings.find((f) => f.file === 'plugins/sp/scripts/big.ts')?.detail).toContain('301');
        expect(byFile.get('plugins/sp/scripts/db.ts')).toBe('db-import');
        expect(byFile.get('plugins/sp/scripts/corpus.ts')).toBe('corpus-parse');
        expect(byFile.get('scripts/commands/task.ts')).toBe('noun-clash');
        expect(findings.some((f) => f.file.endsWith('typed.ts'))).toBe(false);
        expect(findings.some((f) => f.file.endsWith('skipped.test.ts'))).toBe(false);
        expect(findings.some((f) => f.file.endsWith('fine.ts'))).toBe(false);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('baseline suppresses listed kinds and flags stale entries', () => {
    const root = createPlacementFixture();
    try {
        const baselinePath = join(root, 'config', 'script-placement-baseline.json');
        mkdirSync(join(root, 'config'), { recursive: true });
        writeFileSync(
            baselinePath,
            JSON.stringify({
                schemaVersion: 1,
                entries: {
                    'plugins/sp/scripts/big.ts': { kinds: ['budget'] },
                    'plugins/sp/scripts/db.ts': { kinds: ['budget', 'db-import'] },
                    'plugins/sp/hooks/fine.ts': { kinds: ['budget'] },
                },
            }),
        );
        const findings = checkPlacement({ repoRoot: root, baselinePath });
        expect(findings.some((f) => f.file === 'plugins/sp/scripts/big.ts')).toBe(false);
        expect(
            findings.find((f) => f.file === 'plugins/sp/scripts/db.ts' && f.kind === 'stale-baseline'),
        ).toBeDefined();
        expect(
            findings.find((f) => f.file === 'plugins/sp/hooks/fine.ts' && f.kind === 'stale-baseline'),
        ).toBeDefined();
        expect(findings.some((f) => f.file === 'plugins/sp/scripts/corpus.ts')).toBe(true);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('--placement-only run() exits 1 with findings and 0 when fully suppressed', () => {
    const root = createPlacementFixture();
    try {
        expect(run(['--placement-only', '--repo-root', root, '--baseline', join(root, 'config', 'none.json')])).toBe(1);
        const baselinePath = join(root, 'config', 'b.json');
        mkdirSync(join(root, 'config'), { recursive: true });
        writeFileSync(
            baselinePath,
            JSON.stringify({
                schemaVersion: 1,
                entries: {
                    'plugins/sp/scripts/big.ts': { kinds: ['budget'] },
                    'plugins/sp/scripts/db.ts': { kinds: ['db-import'] },
                    'plugins/sp/scripts/corpus.ts': { kinds: ['corpus-parse'] },
                    'scripts/commands/task.ts': { kinds: ['noun-clash'] },
                },
            }),
        );
        expect(run(['--placement-only', '--repo-root', root, '--baseline', baselinePath])).toBe(0);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('placement baseline reconciles with plan §2 (task 1000 R7)', () => {
    const repoRoot = join(import.meta.dir, '..', '..');
    const section: string[] = [];
    let inSection = false;
    for (const line of readFileSync(join(repoRoot, 'docs', 'plans', 'A9-script-placement-migration.md'), 'utf8').split(
        '\n',
    )) {
        if (line.startsWith('## 2.')) inSection = true;
        else if (line.startsWith('## 3.')) inSection = false;
        else if (inSection) section.push(line);
    }
    const loaded = loadPlacementBaseline(join(repoRoot, 'config', 'script-placement-baseline.json'));
    if (!loaded.baseline) throw new Error(loaded.error ?? 'placement baseline missing');
    const entries = loaded.baseline.entries;
    const keys = Object.keys(entries);

    const rows = section
        .map((line) => line.match(/^\| ([a-z0-9-]+) \| (\d+|—) \| .* \| (.+) \| ([A-Z0-9—-]+) \|$/))
        .filter((m): m is RegExpMatchArray => m !== null)
        .map((m) => ({ name: m[1] ?? '', loc: m[2] ?? '—', target: m[3] ?? '' }));
    expect(rows.length).toBeGreaterThan(20);
    const scriptNames = new Set(rows.map((m) => m.name));

    // direction B: every baseline key is accounted for by plan §2
    const hookCell = section.find((line) => line.startsWith('| context-post-tool'));
    const hookNames = new Set(hookCell?.match(/[a-z][a-z0-9-]+/g) ?? []);
    for (const key of keys) {
        expect(key.startsWith('plugins/sp/')).toBe(true);
        const inScripts =
            key.startsWith('plugins/sp/scripts/') &&
            scriptNames.has(key.replace('plugins/sp/scripts/', '').replace(/\.ts$/, ''));
        const underDirs = /^(plugins\/sp\/scripts\/)?(daily-summary|dogfood-testing)\//.test(key);
        const hookFile = key.split('/').at(-1)?.replace(/\.ts$/, '') ?? '';
        const inHooks =
            (key.startsWith('plugins/sp/hooks/') && hookNames.has(hookFile)) ||
            key === 'plugins/sp/hooks/pi/guard-extension.ts';
        expect(inScripts || underDirs || inHooks).toBe(true);
    }
    const dirKeys = keys.filter((k) => /^(plugins\/sp\/scripts\/)?(daily-summary|dogfood-testing)\//.test(k));
    expect(dirKeys).toHaveLength(3);

    // direction A: plan §2 Move/Delete/→scripts/over-budget rows are all baselined
    // (script-contract-check excluded: task 1000 itself moved it to scripts/commands)
    const expected = rows
        .filter((m) => m.name !== 'script-contract-check')
        // task 1005 R6 / 1006 R5: the W3 scripts' logic moved into packages/app lib bundles; the
        // ≤250 glue stays, so their plan-§2 rows left the baseline instead of their files.
        .filter(
            (m) =>
                !['history-anatomy-cache', 'workflow-step-profile', 'quality-gate', 'inline-run-setup'].includes(
                    m.name,
                ),
        )
        .filter(
            (m) =>
                /Delete|→scripts|Move→CLI/.test(m.target) ||
                (m.loc !== '—' && Number(m.loc) > 250 && !/within budget/.test(m.target)),
        )
        .map((m) => `plugins/sp/scripts/${m.name}.ts`)
        .filter((p) => existsSync(join(repoRoot, p)))
        .sort();
    const actual = keys
        .filter(
            (k) =>
                k.startsWith('plugins/sp/scripts/') &&
                !/^(daily-summary|dogfood-testing)\//.test(k.replace('plugins/sp/scripts/', '')),
        )
        .sort();
    expect(actual).toEqual(expected);

    // exempt: true is exactly the five over-budget Keep files (task-frozen list)
    const exempt = keys.filter((k) => entries[k]?.exempt === true).sort();
    expect(exempt).toEqual(
        [
            'plugins/sp/hooks/context-post-tool.ts',
            'plugins/sp/scripts/batch-preflight.ts',
            'plugins/sp/scripts/feature-verification-steps.ts',
            'plugins/sp/scripts/wrapup-drift-probe.ts',
            'plugins/sp/scripts/wrapup-steps.ts',
        ].sort(),
    );
});
