import { expect, spyOn, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    checkHookLayout,
    checkPlacement,
    GLUE_BUDGET_LINES,
    parseArgs,
    run,
    validateScriptLayout,
} from './script-contract-check';

function createTempEnv() {
    const root = mkdtempSync(join(tmpdir(), 'script-contract-test-'));
    const scriptsDir = join(root, 'plugins', 'sp', 'scripts');
    const hooksDir = join(root, 'plugins', 'sp', 'hooks');
    const pluginDir = join(root, 'plugins', 'sp');

    mkdirSync(scriptsDir, { recursive: true });
    mkdirSync(hooksDir, { recursive: true });
    writeFileSync(join(hooksDir, 'hooks.json'), JSON.stringify({ hooks: {} }));
    writeFileSync(join(pluginDir, 'README.md'), '# Plugin\n');

    return { root, scriptsDir, pluginDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function writeEntry(root: string, name: string, body = 'export {};\n'): void {
    const dir = join(root, 'plugins', 'sp', 'scripts', 'hooks');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${name}.ts`), body);
}

function writeHooksJson(root: string, identities: string[]): void {
    writeFileSync(
        join(root, 'plugins', 'sp', 'hooks', 'hooks.json'),
        JSON.stringify({
            hooks: Object.fromEntries(
                identities.map((id) => ['SessionStart', [{ hooks: [{ command: `superskill hook run sp ${id}` }] }]]),
            ),
        }),
    );
}

// ---- flags ----

test('parseArgs parses custom flags', () => {
    const res = parseArgs(['--scripts-dir', 'bar', '--plugin-dir', 'baz', '--placement-only', '--repo-root', 'zed']);
    expect(res.scriptsDir).toBe('bar');
    expect(res.pluginDir).toBe('baz');
    expect(res.placementOnly).toBe(true);
    expect(res.repoRoot).toBe('zed');
});

test('parseArgs defaults to the real plugin layout', () => {
    const res = parseArgs([]);
    expect(res.scriptsDir).toBe('plugins/sp/scripts');
    expect(res.pluginDir).toBe('plugins/sp');
    expect(res.placementOnly).toBe(false);
    expect(res.repoRoot).toBe('.');
});

// ---- rule 1: hook-only layout under plugins/sp/scripts ----

test('a registered hook entry with hooks.json is clean', () => {
    const env = createTempEnv();
    try {
        writeHooksJson(env.root, ['loop-safety']);
        writeEntry(env.root, 'loop-safety');
        expect(validateScriptLayout({ scriptsDir: env.scriptsDir, pluginDir: env.pluginDir })).toEqual([]);
    } finally {
        env.cleanup();
    }
});

test('a non-hook script under plugins/sp/scripts is a violation', () => {
    const env = createTempEnv();
    try {
        writeFileSync(join(env.scriptsDir, 'stray-skill.ts'), 'console.log(1);\n');
        const violations = validateScriptLayout({ scriptsDir: env.scriptsDir, pluginDir: env.pluginDir });
        expect(violations.map((v) => v.kind)).toContain('stray_script');
        expect(violations.find((v) => v.kind === 'stray_script')?.target).toBe('stray-skill.ts');
    } finally {
        env.cleanup();
    }
});

test('an .mjs twin anywhere under plugins/sp/scripts is a violation', () => {
    const env = createTempEnv();
    try {
        const hooksDir = join(env.scriptsDir, 'hooks');
        mkdirSync(hooksDir, { recursive: true });
        writeFileSync(join(hooksDir, 'loop-safety.mjs'), '// generated twin\n');
        const violations = validateScriptLayout({ scriptsDir: env.scriptsDir, pluginDir: env.pluginDir });
        expect(violations.map((v) => v.kind)).toContain('stray_twin');
    } finally {
        env.cleanup();
    }
});

// ---- rule 2: hook identity/layout (ADR-129) ----

test('a registered identity without an authored entry fails hook layout', () => {
    const env = createTempEnv();
    try {
        writeHooksJson(env.root, ['missing-entry']);
        const violations = validateScriptLayout({ scriptsDir: env.scriptsDir, pluginDir: env.pluginDir });
        expect(violations.map((v) => v.kind)).toContain('hook-layout');
        expect(violations.find((v) => v.kind === 'hook-layout')?.message).toContain('missing-entry');
    } finally {
        env.cleanup();
    }
});

test('an unregistered entry and a shadow entry in plugins/sp/hooks fail hook layout', () => {
    const env = createTempEnv();
    try {
        writeEntry(env.root, 'unregistered');
        writeFileSync(join(env.root, 'plugins', 'sp', 'hooks', 'shadow.ts'), 'export {};\n');
        const violations = validateScriptLayout({ scriptsDir: env.scriptsDir, pluginDir: env.pluginDir });
        const hookLayout = violations.filter((v) => v.kind === 'hook-layout').map((v) => v.target);
        expect(hookLayout).toContain('plugins/sp/scripts/hooks/unregistered.ts');
        expect(hookLayout).toContain('plugins/sp/hooks/shadow.ts');
    } finally {
        env.cleanup();
    }
});

test('hook tests under the entries tree are misplaced (ADR-129 test owner)', () => {
    const env = createTempEnv();
    try {
        writeHooksJson(env.root, ['loop-safety']);
        writeEntry(env.root, 'loop-safety');
        writeFileSync(
            join(env.root, 'plugins', 'sp', 'scripts', 'hooks', 'loop-safety.test.ts'),
            'test("x", () => {});\n',
        );
        expect(checkHookLayout({ repoRoot: env.root }).map((f) => f.file)).toContain(
            'plugins/sp/scripts/hooks/loop-safety.test.ts',
        );
    } finally {
        env.cleanup();
    }
});

// ---- rule 3: bundled surfaces must not value-import @gobing-ai/* ----

test('a value import of @gobing-ai/* in a bundled surface is a violation', () => {
    const env = createTempEnv();
    try {
        writeHooksJson(env.root, ['loop-safety']);
        writeEntry(env.root, 'loop-safety', "import { x } from '@gobing-ai/ts-utils';\nexport {};\n");
        const violations = validateScriptLayout({ scriptsDir: env.scriptsDir, pluginDir: env.pluginDir });
        expect(violations.map((v) => v.kind)).toContain('gobing_ai_import');
    } finally {
        env.cleanup();
    }
});

test('import type of @gobing-ai/* is exempt', () => {
    const env = createTempEnv();
    try {
        writeHooksJson(env.root, ['loop-safety']);
        writeEntry(env.root, 'loop-safety', "import type { Foo } from '@gobing-ai/ts-utils';\nexport {};\n");
        expect(validateScriptLayout({ scriptsDir: env.scriptsDir, pluginDir: env.pluginDir })).toEqual([]);
    } finally {
        env.cleanup();
    }
});

// ---- rule 4: shipped surfaces must not invoke retired script machinery ----

test('a skill invoking bun plugins/sp/scripts/… is a violation', () => {
    const env = createTempEnv();
    try {
        const skills = join(env.pluginDir, 'skills', 'demo');
        mkdirSync(skills, { recursive: true });
        writeFileSync(join(skills, 'SKILL.md'), 'run: bun plugins/sp/scripts/demo.ts\n');
        const violations = validateScriptLayout({ scriptsDir: env.scriptsDir, pluginDir: env.pluginDir });
        expect(violations.map((v) => v.kind)).toContain('forbidden_invocation');
    } finally {
        env.cleanup();
    }
});

test('`superskill script path` in README is a violation', () => {
    const env = createTempEnv();
    try {
        writeFileSync(join(env.pluginDir, 'README.md'), 'node "$(superskill script path sp demo.mjs)"\n');
        const violations = validateScriptLayout({ scriptsDir: env.scriptsDir, pluginDir: env.pluginDir });
        expect(violations.map((v) => v.kind)).toContain('forbidden_invocation');
    } finally {
        env.cleanup();
    }
});

test('a retired probe inside a workflow command block is a violation', () => {
    const env = createTempEnv();
    try {
        const workflowsDir = join(env.root, 'config', 'workflows');
        mkdirSync(workflowsDir, { recursive: true });
        writeFileSync(
            join(workflowsDir, 'p.yaml'),
            [
                'states:',
                '  - id: precheck',
                '    onEnter:',
                '      - kind: shell',
                '        options:',
                '            command: >-',
                '                S=plugins/sp/scripts/script-root.ts; [ -f "$S" ] && bun "$S"',
                '      - kind: shell',
                '        options:',
                '            command: >-',
                '                # a comment naming bun plugins/sp/scripts/x.ts is skipped',
                '                spur task check "$WBS" --precheck',
            ].join('\n'),
        );
        const violations = validateScriptLayout({ scriptsDir: env.scriptsDir, pluginDir: env.pluginDir });
        expect(violations).toHaveLength(1);
        expect(violations[0]?.kind).toBe('forbidden_invocation');
        expect(violations[0]?.target).toContain('p.yaml:7');
    } finally {
        env.cleanup();
    }
});

// ---- placement scan (--placement-only, ADR-130) ----

test('placement scan reports line budget, db-import, corpus-parse and noun-clash findings', () => {
    const root = mkdtempSync(join(tmpdir(), 'script-placement-test-'));
    try {
        const scriptsDir = join(root, 'plugins', 'sp', 'scripts');
        mkdirSync(join(scriptsDir, 'hooks'), { recursive: true });
        mkdirSync(join(root, 'scripts', 'commands'), { recursive: true });
        mkdirSync(join(root, 'apps', 'cli', 'src', 'commands', 'shared'), { recursive: true });
        writeFileSync(join(root, 'apps', 'cli', 'src', 'commands', 'shared', 'index.ts'), 'export const shared = 1;\n');
        writeFileSync(join(root, 'scripts', 'commands', 'shared.ts'), 'export {};\n');
        writeFileSync(join(scriptsDir, 'fat.ts'), `${'const x = 1;\n'.repeat(GLUE_BUDGET_LINES + 1)}`);
        writeFileSync(
            join(scriptsDir, 'db.ts'),
            [
                '// import { Database } from "bun:sqlite"; — comment is exempt',
                "import { Database } from 'bun:sqlite';",
                "const mod = await import('drizzle-orm/bun-sqlite');",
                "const p = 'docs/tasks/0001.md';",
            ].join('\n'),
        );
        writeFileSync(join(scriptsDir, 'hooks', 'entry.ts'), 'const q = "docs/features/x.md";\n');
        const findings = checkPlacement({ repoRoot: root });
        const byKind = Object.groupBy(findings, (f) => f.kind);
        expect(byKind.budget?.map((f) => f.file)).toContain('plugins/sp/scripts/fat.ts');
        expect(byKind['db-import']?.map((f) => f.file)).toEqual(['plugins/sp/scripts/db.ts']);
        expect(byKind['db-import']?.every((f) => !f.detail.includes('comment'))).toBe(true);
        expect(byKind['corpus-parse']?.map((f) => f.file).sort()).toEqual([
            'plugins/sp/scripts/db.ts',
            'plugins/sp/scripts/hooks/entry.ts',
        ]);
        expect(byKind['noun-clash']?.map((f) => f.file)).toEqual(['scripts/commands/shared.ts']);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('placement scan holds scripts/commands to the domain DB boundary (ADR-130, 2026-10-16)', () => {
    const root = mkdtempSync(join(tmpdir(), 'script-placement-test-'));
    try {
        const commands = join(root, 'scripts', 'commands');
        mkdirSync(commands, { recursive: true });
        writeFileSync(join(commands, 'raw-sqlite.ts'), "import { Database } from 'bun:sqlite';\n");
        writeFileSync(join(commands, 'raw-adapter.ts'), "import { createDbAdapter } from '@gobing-ai/ts-db';\n");
        writeFileSync(join(commands, 'drizzle.ts'), "const m = await import('drizzle-orm');\n");
        // Legal: type-only adapter import, DB through the domain owner, corpus reads by repo gates,
        // and test fixtures that build a SQLite file.
        writeFileSync(join(commands, 'typed.ts'), "import type { DbAdapter } from '@gobing-ai/ts-db';\n");
        writeFileSync(
            join(commands, 'via-domain.ts'),
            "import { openExistingDb } from '../../packages/domain/src/db';\nconst d = 'docs/tasks';\n",
        );
        writeFileSync(join(commands, 'fixture.test.ts'), "import { Database } from 'bun:sqlite';\n");
        writeFileSync(join(commands, 'patcher.ts'), `const s = "await import('@gobing-ai/ts-db')";\n`);
        const dbFindings = checkPlacement({ repoRoot: root }).filter((f) => f.kind === 'db-import');
        expect(dbFindings.map((f) => f.file).sort()).toEqual([
            'scripts/commands/drizzle.ts',
            'scripts/commands/raw-adapter.ts',
            'scripts/commands/raw-sqlite.ts',
        ]);
        expect(checkPlacement({ repoRoot: root }).some((f) => f.kind === 'corpus-parse')).toBe(false);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('placement scan reports a double-registered hook identity once per registration', () => {
    const root = mkdtempSync(join(tmpdir(), 'script-placement-test-'));
    try {
        const hooksDir = join(root, 'plugins', 'sp', 'hooks');
        mkdirSync(hooksDir, { recursive: true });
        writeFileSync(
            join(hooksDir, 'hooks.json'),
            JSON.stringify({
                hooks: {
                    PreToolUse: [
                        { matcher: 'Bash', hooks: [{ command: 'superskill hook run sp loop-safety' }] },
                        { matcher: 'Edit', hooks: [{ command: 'superskill hook run sp loop-safety' }] },
                    ],
                },
            }),
        );
        const findings = checkPlacement({ repoRoot: root });
        const dup = findings.filter((f) => f.kind === 'hook-layout' && f.detail.includes('registered twice'));
        expect(dup).toHaveLength(1);
        expect(dup[0]?.detail).toContain('loop-safety');
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

// ---- real tree: the shipped plugin is clean end to end (1213) ----

test('run() passes over the real tree in both modes', () => {
    const log = spyOn(console, 'log').mockImplementation(() => {});
    const error = spyOn(console, 'error').mockImplementation(() => {});
    try {
        expect(run([])).toBe(0);
        expect(run(['--placement-only'])).toBe(0);
        expect(log.mock.calls).toEqual([
            ['script-contract-check: hook-only script layout over plugins/sp — 0 violation(s) — PASS'],
            ['script-contract-check: placement scan over plugins/sp + scripts/commands — 0 finding(s) — PASS'],
        ]);
        expect(error).not.toHaveBeenCalled();
    } finally {
        log.mockRestore();
        error.mockRestore();
    }
});

test('run() fails with violations under a fixture root', () => {
    const env = createTempEnv();
    const log = spyOn(console, 'log').mockImplementation(() => {});
    const error = spyOn(console, 'error').mockImplementation(() => {});
    try {
        writeFileSync(join(env.scriptsDir, 'db.ts'), "import { Database } from 'bun:sqlite';\n");
        expect(run(['--repo-root', env.root, '--placement-only'])).toBe(1);
        expect(log.mock.calls).toEqual([
            ['script-contract-check: placement scan over plugins/sp + scripts/commands — 1 finding(s) — FAIL'],
        ]);
        expect(error.mock.calls).toEqual([
            ['script-contract-check: FAIL (db-import) - plugins/sp/scripts/db.ts: value-import of bun:sqlite'],
        ]);
    } finally {
        log.mockRestore();
        error.mockRestore();
        env.cleanup();
    }
});

test('the real plugin is hook-only: retired machinery is gone (spec R1/R3)', () => {
    const pluginDir = join(import.meta.dir, '..', '..', 'plugins', 'sp');
    const scriptsDir = join(pluginDir, 'scripts');
    const entries = Array.from(new Bun.Glob('**/*').scanSync({ cwd: scriptsDir })).sort();
    for (const rel of entries) {
        expect(rel.startsWith('hooks/') && rel.endsWith('.ts')).toBe(true);
        expect(rel.endsWith('.mjs')).toBe(false);
    }
    expect(entries).toContain('hooks/careful-guard.ts');
    expect(entries).not.toContain('script-root.ts');
    expect(entries).not.toContain('script-root.mjs');
    expect(entries.filter((rel) => rel.endsWith('.mjs'))).toEqual([]);

    const lib = Array.from(new Bun.Glob('*.ts').scanSync({ cwd: join(pluginDir, 'lib') })).sort();
    expect(lib).not.toContain('spur-bin.ts');

    const root = join(import.meta.dir, '..', '..');
    for (const retired of ['config/plugin-scripts.json', 'config/script-placement-baseline.json']) {
        expect(existsSync(join(root, retired)), `${retired} must not exist`).toBe(false);
    }
    const pkg = readFileSync(join(root, 'package.json'), 'utf8');
    expect(pkg.includes('build:scripts')).toBe(false);
    expect(pkg.includes('superskill script convert')).toBe(false);
});
