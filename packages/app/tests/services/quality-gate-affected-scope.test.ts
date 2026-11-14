/**
 * Task 1322 (feature H16) — affected-scope selection (R3) and the recheck light-tier triage
 * (P2). A real two-workspace monorepo fixture (`packages/shared-lib` depended on by
 * `apps/leaf-app`) pins: graph construction, selection over the workspace dependency graph
 * (a shared package pulls its dependents into the typecheck set; the tier never refuses a scope),
 * base-sha change sets, the changed-file coverage floor, and both recheck outcomes (a red tier
 * fails the visit without paying the full chain; a green tier falls through to the full gate).
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type BuilderConfig, BuilderConfigSchema } from '@gobing-ai/spur-config';
import {
    changedCoverageShortfalls,
    dependentsOf,
    lightScope,
    readBaseSha,
    readWorkspaceGraph,
    runLightGate,
    runQualityGate,
    runShellCommand,
    workspaceGraphFrom,
} from '../../src/services/quality-gate';

/**
 * The fixture never writes under the repo tree (its monorepo lives in a /tmp dir removed in a
 * `finally`), but scratch from any other run path must not survive either: a leftover under
 * `packages/app/.spur/run/` (the 1322-biome-probe dir the implement worker's manual `bunx biome`
 * probe left) trips `require-corresponding-test` at `test-pre-check` and fails the gate. Remove
 * it after every run.
 */
afterAll(() => {
    rmSync(join(import.meta.dir, '..', '..', '.spur', 'run', '1322-biome-probe'), {
        recursive: true,
        force: true,
    });
});

/** Silence the gate's stdout tee (the log file carries the same lines). */
function silenceStdout<T>(run: () => T): T {
    const originalWrite = process.stdout.write;
    process.stdout.write = () => true;
    try {
        return run();
    } finally {
        process.stdout.write = originalWrite;
    }
}

function sh(cmd: string, cwd: string): void {
    const result = runShellCommand(cmd, cwd);
    if (result.code !== 0) throw new Error(`fixture: ${cmd} failed: ${result.output}`);
}

/**
 * A mid-size monorepo fixture (AC3): `apps/leaf-app` depends on `packages/shared-lib`, so the
 * graph's dependents edge is the fallback tripwire. Everything is committed at a base ref, the
 * way a pipeline visit starts.
 */
function monorepoFixture(): { dir: string; base: string; cleanup: () => void } {
    const dir = mkdtempSync(join(tmpdir(), 'spur-1322-monorepo-'));
    sh('git init -q -b main', dir);
    sh('git config user.email fixture@spur.dev', dir);
    sh('git config user.name fixture', dir);
    writeFileSync(join(dir, '.gitignore'), '.spur/\n');
    writeFileSync(
        join(dir, 'package.json'),
        `${JSON.stringify({ name: 'fixture-root', private: true, workspaces: ['apps/*', 'packages/*'] }, null, 4)}\n`,
    );
    for (const [ws, name, deps] of [
        ['packages/shared-lib', '@fix/shared-lib', {}],
        ['apps/leaf-app', '@fix/leaf-app', { '@fix/shared-lib': 'workspace:*' }],
    ] as const) {
        mkdirSync(join(dir, ws, 'src'), { recursive: true });
        mkdirSync(join(dir, ws, 'tests'), { recursive: true });
        writeFileSync(join(dir, ws, 'package.json'), `${JSON.stringify({ name, dependencies: deps }, null, 4)}\n`);
        writeFileSync(join(dir, ws, 'src/index.ts'), 'export const one = 1;\n');
        const suite = ws.split('/')[1];
        writeFileSync(
            join(dir, ws, 'tests', `${suite}.test.ts`),
            'import { test, expect } from "bun:test";\ntest("one", () => { expect(1).toBe(1); });\n',
        );
    }
    writeFileSync(join(dir, 'README.md'), '# fixture\n');
    sh('git add . && git commit -qm base', dir);
    const base = execSync('git rev-parse HEAD', { cwd: dir }).toString().trim();
    return { dir, base, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function recordBase(dir: string, wbs: string, base: string): void {
    mkdirSync(join(dir, '.spur', 'run'), { recursive: true });
    writeFileSync(join(dir, '.spur', 'run', `${wbs}-base.sha`), `${base}\n`);
}

/** Every scoped action bound, with `test-changed` under the test's control. */
function leafBuilder(testCmd: string): BuilderConfig {
    return BuilderConfigSchema.parse({
        preset: 'none',
        actions: {
            'lint-changed': 'exit 0',
            'rules-pre': 'exit 0',
            'rules-post': 'exit 0',
            'typecheck-changed': 'exit 0',
            'test-changed': testCmd,
        },
    });
}

describe('workspace dependency graph (1322 R3)', () => {
    test('dependentsOf answers which workspaces consume a package', () => {
        const graph = workspaceGraphFrom([
            { dir: 'packages/shared-lib', name: '@fix/shared-lib', dependencies: [] },
            { dir: 'apps/leaf-app', name: '@fix/leaf-app', dependencies: ['@fix/shared-lib', 'left-pad'] },
        ]);
        expect(graph.byName.get('@fix/shared-lib')).toBe('packages/shared-lib');
        expect(dependentsOf(graph, 'packages/shared-lib')).toEqual(['apps/leaf-app']);
        expect(dependentsOf(graph, 'apps/leaf-app')).toEqual([]);
        expect(dependentsOf(graph, 'nowhere')).toEqual([]);
    });

    test('readWorkspaceGraph expands root workspaces globs and folds internal dependency edges', () => {
        const { dir, cleanup } = monorepoFixture();
        try {
            const graph = readWorkspaceGraph(dir);
            expect([...graph.byName.entries()].sort()).toEqual([
                ['@fix/leaf-app', 'apps/leaf-app'],
                ['@fix/shared-lib', 'packages/shared-lib'],
            ]);
            expect(dependentsOf(graph, 'packages/shared-lib')).toEqual(['apps/leaf-app']);
            expect(dependentsOf(graph, 'apps/leaf-app')).toEqual([]);
        } finally {
            cleanup();
        }
    });

    test('an unreadable root yields an empty graph (legacy behavior, no fallback classification)', () => {
        const graph = readWorkspaceGraph(join(tmpdir(), `spur-1322-no-root-${crypto.randomUUID()}`));
        expect(graph.byName.size).toBe(0);
        expect(graph.dependents.size).toBe(0);
    });

    test('an unsupported glob shape is recorded on the graph (1326)', () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-1326-glob-'));
        try {
            writeFileSync(
                join(dir, 'package.json'),
                `${JSON.stringify({ name: 'fixture-root', private: true, workspaces: ['packages/**'] }, null, 4)}\n`,
            );
            mkdirSync(join(dir, 'packages/shared-lib'), { recursive: true });
            writeFileSync(
                join(dir, 'packages/shared-lib/package.json'),
                `${JSON.stringify({ name: '@fix/shared-lib' }, null, 4)}\n`,
            );
            const graph = readWorkspaceGraph(dir);
            expect(graph.byName.size).toBe(0);
            expect(graph.unsupported).toContain('packages/**');
            const scope = lightScope(['packages/shared-lib/src/index.ts'], (p) => existsSync(join(dir, p)), graph);
            expect(scope.workspaces).toEqual(['packages/shared-lib']);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('a mixed supported/unsupported workspaces list is recorded too (1326)', () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-1326-glob-'));
        try {
            writeFileSync(
                join(dir, 'package.json'),
                `${JSON.stringify({ name: 'fixture-root', private: true, workspaces: ['apps/*', 'packages/**'] }, null, 4)}\n`,
            );
            const graph = readWorkspaceGraph(dir);
            expect(graph.unsupported).toContain('packages/**');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('affected-scope selection (1322 R3)', () => {
    test('a leaf-workspace change selects its owning workspace', () => {
        const { dir, cleanup } = monorepoFixture();
        try {
            const scope = lightScope(
                ['apps/leaf-app/src/index.ts', 'apps/leaf-app/tests/leaf-app.test.ts'],
                (p) => existsSync(join(dir, p)),
                readWorkspaceGraph(dir),
            );
            expect(scope.workspaces).toEqual(['apps/leaf-app']);
            expect(scope.tests).toEqual(['apps/leaf-app/tests/leaf-app.test.ts']);
        } finally {
            cleanup();
        }
    });

    test('a shared-package change adds its dependents to the typecheck set', () => {
        const { dir, cleanup } = monorepoFixture();
        try {
            const scope = lightScope(
                ['packages/shared-lib/src/index.ts'],
                (p) => existsSync(join(dir, p)),
                readWorkspaceGraph(dir),
            );
            expect(scope.workspaces).toEqual(['apps/leaf-app', 'packages/shared-lib']);
        } finally {
            cleanup();
        }
    });

    test('a path no workspace owns gets lint + rules only', () => {
        const { dir, cleanup } = monorepoFixture();
        try {
            const scope = lightScope(['README.md'], (p) => existsSync(join(dir, p)), readWorkspaceGraph(dir));
            expect(scope).toEqual({ files: ['README.md'], workspaces: [], tests: [] });
        } finally {
            cleanup();
        }
    });

    test('plugins/sp paths map to the plugin workspace (the 1142 mapping owns them)', () => {
        const { dir, cleanup } = monorepoFixture();
        try {
            const scope = lightScope(['plugins/sp/skills/x/SKILL.md'], () => true, readWorkspaceGraph(dir));
            expect(scope.workspaces).toEqual(['plugins/sp']);
        } finally {
            cleanup();
        }
    });

    test('without a graph only owning workspaces are selected', () => {
        const { dir, cleanup } = monorepoFixture();
        try {
            const scope = lightScope(['packages/shared-lib/src/index.ts', 'README.md'], (p) =>
                existsSync(join(dir, p)),
            );
            expect(scope.workspaces).toEqual(['packages/shared-lib']);
        } finally {
            cleanup();
        }
    });
});

describe('light gate selection evidence and base-sha change sets (1322 R3/P5)', () => {
    test('the light log opens with the selection rationale and the receipt rows point at it', () => {
        const { dir, base, cleanup } = monorepoFixture();
        try {
            recordBase(dir, '1322r', base);
            writeFileSync(join(dir, 'apps/leaf-app/src/index.ts'), 'export const one = 2;\n');
            const result = silenceStdout(() =>
                runLightGate({ wbs: '1322r' }, { cwd: dir, builder: leafBuilder('exit 0') }),
            );
            expect(result.status).toBe('PASS');
            const log = readFileSync(join(dir, result.logFile), 'utf8');
            expect(log.startsWith('--- light scope: workspaces: apps/leaf-app;')).toBe(true);
            expect(log).toContain('--- light scope files (1): apps/leaf-app/src/index.ts');
            const receipt = JSON.parse(readFileSync(join(dir, '.spur/run/1322r-check-receipt.json'), 'utf8')) as {
                schemaVersion: string;
                tier: string;
                checks: Array<{ logPath: string }>;
            };
            expect(receipt.tier).toBe('light');
            expect(receipt.schemaVersion.length).toBeGreaterThan(0);
            expect(receipt.checks.length).toBeGreaterThan(0);
            for (const row of receipt.checks) expect(row.logPath).toBe(result.logFile);
        } finally {
            cleanup();
        }
    });

    test('a shared-package change runs the tier and typechecks the dependent', () => {
        const { dir, base, cleanup } = monorepoFixture();
        try {
            recordBase(dir, '1322s', base);
            writeFileSync(join(dir, 'packages/shared-lib/src/index.ts'), 'export const one = 2;\n');
            const result = silenceStdout(() =>
                runLightGate({ wbs: '1322s' }, { cwd: dir, builder: leafBuilder('exit 0') }),
            );
            expect(result.status).toBe('PASS');
            expect(result.checks.map((check) => check.id)).toContain('typecheck:apps/leaf-app');
            // The light tier never writes the full gate's status token.
            expect(existsSync(join(dir, '.spur/run/1322s-test-gate.status'))).toBe(false);
        } finally {
            cleanup();
        }
    });

    test('a recorded base folds commits since the base into the change set', () => {
        const { dir, base, cleanup } = monorepoFixture();
        try {
            recordBase(dir, '1322b', base);
            writeFileSync(join(dir, 'apps/leaf-app/src/index.ts'), 'export const two = 2;\n');
            sh('git add . && git commit -qm leaf-fix', dir);
            const result = silenceStdout(() =>
                runLightGate({ wbs: '1322b' }, { cwd: dir, builder: leafBuilder('exit 0') }),
            );
            const log = readFileSync(join(dir, result.logFile), 'utf8');
            // HEAD-diff alone would see nothing: the tree is clean after the commit, so seeing the
            // file proves the base ref folded the commit into the change set.
            expect(log).toContain('--- light scope files (1): apps/leaf-app/src/index.ts');
            expect(result.status).toBe('PASS');
        } finally {
            cleanup();
        }
    });

    test('readBaseSha accepts only a sha-shaped line and refuses everything else', () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-1322-sha-'));
        try {
            const path = join(dir, 'base.sha');
            writeFileSync(path, '1234567890abcdef\n');
            expect(readBaseSha(path)).toBe('1234567890abcdef');
            writeFileSync(path, 'not-a-sha; rm -rf /\n');
            expect(readBaseSha(path)).toBeNull();
            expect(readBaseSha(join(dir, 'missing.sha'))).toBeNull();
            expect(readBaseSha(undefined)).toBeNull();
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('recheck visits triage through the light tier (1322 P2/AC3)', () => {
    test('a red light tier fails the recheck without paying the full chain, no full receipt minted', () => {
        const { dir, base, cleanup } = monorepoFixture();
        try {
            recordBase(dir, '1322f', base);
            // A changed test file maps onto itself, so the tier's `test:apps/leaf-app` row runs.
            writeFileSync(join(dir, 'apps/leaf-app/tests/leaf-app.test.ts'), 'export const broken = 1;\n');
            const sentinel = join(dir, 'full-ran');
            const full = silenceStdout(() =>
                runQualityGate(
                    'recheck',
                    { wbs: '1322f', qualityGateCmd: `touch "${sentinel}"`, runId: 'r1322' },
                    // The failure carries a file:line anchor so findings extraction has a
                    // repair target (an anchor-less failure yields an empty findings file, as a
                    // coverage-only full-gate failure does today).
                    {
                        cwd: dir,
                        builder: leafBuilder(
                            "echo 'apps/leaf-app/tests/leaf-app.test.ts:1:1: assertion failed' >&2; exit 7",
                        ),
                    },
                ),
            );
            expect(full.status).toBe('FAIL');
            // The full chain never ran: the sentinel the gate command writes is absent, and the
            // standing receipt is the tier's own — no full-tier receipt was minted for a chain
            // that did not execute.
            expect(existsSync(sentinel)).toBe(false);
            const receipt = JSON.parse(readFileSync(join(dir, '.spur/run/1322f-check-receipt.json'), 'utf8')) as {
                tier: string;
            };
            expect(receipt.tier).toBe('light');
            const log = readFileSync(join(dir, '.spur/run/1322f-test-gate.log'), 'utf8');
            expect(log).toContain('--- gate visit recheck: affected-scope light tier (1322) — FAIL');
            expect(log).toContain('--- light test:apps/leaf-app: FAIL');
            expect(log).toContain('git-tree:');
            expect(readFileSync(join(dir, '.spur/run/1322f-test-gate.status'), 'utf8')).toBe('FAIL\n');
            expect(readFileSync(join(dir, '.spur/run/1322f-test-gate.findings'), 'utf8')).toContain(
                'apps/leaf-app/tests/leaf-app.test.ts:1 ',
            );
        } finally {
            cleanup();
        }
    });

    test('a green light tier falls through: the full gate runs and the full receipt lands', () => {
        const { dir, base, cleanup } = monorepoFixture();
        try {
            recordBase(dir, '1322g', base);
            writeFileSync(join(dir, 'apps/leaf-app/tests/leaf-app.test.ts'), 'export const ok = 1;\n');
            const sentinel = join(dir, 'full-ran');
            const full = silenceStdout(() =>
                runQualityGate(
                    'recheck',
                    { wbs: '1322g', qualityGateCmd: `touch "${sentinel}"`, runId: 'r1322' },
                    { cwd: dir, builder: leafBuilder('exit 0') },
                ),
            );
            expect(full.status).toBe('PASS');
            expect(existsSync(sentinel)).toBe(true);
            const receipt = JSON.parse(readFileSync(join(dir, '.spur/run/1322g-check-receipt.json'), 'utf8')) as {
                tier: string;
            };
            expect(receipt.tier).toBe('full');
            const log = readFileSync(join(dir, '.spur/run/1322g-test-gate.log'), 'utf8');
            expect(log).toContain('--- gate visit recheck: affected-scope light tier (1322) — PASS');
            expect(log).toContain('--- light scope: workspaces: apps/leaf-app');
        } finally {
            cleanup();
        }
    });
});

describe('incremental coverage floor on changed files', () => {
    const FLOOR =
        '[test]\ncoverageThreshold = { lines = 0.9, functions = 0.9 }\ncoveragePathIgnorePatterns = ["**/gen/**"]\n';
    const low = "echo ' src/index.ts | 50.00 | 50.00 | 3-4'";

    /** Change a source file and its suite so `test:apps/leaf-app` runs, under a 90/90 root floor. */
    function gate(wbs: string, testCmd: string) {
        const { dir, base, cleanup } = monorepoFixture();
        try {
            recordBase(dir, wbs, base);
            writeFileSync(join(dir, 'bunfig.toml'), FLOOR);
            writeFileSync(join(dir, 'apps/leaf-app/src/index.ts'), 'export const one = 2;\n');
            writeFileSync(join(dir, 'apps/leaf-app/tests/leaf-app.test.ts'), 'export const ok = 1;\n');
            const result = silenceStdout(() => runLightGate({ wbs }, { cwd: dir, builder: leafBuilder(testCmd) }));
            return { result, log: readFileSync(join(dir, result.logFile), 'utf8') };
        } finally {
            cleanup();
        }
    }

    test('only changed, non-ignored files are judged, re-rooted to repo paths', () => {
        const table = [
            ' src/a.ts | 50.00 | 100.00 | 7',
            ' src/b.ts | 10.00 | 10.00 |',
            ' src/gen/c.ts | 0.00 | 0.00 |',
        ];
        expect(
            changedCoverageShortfalls(
                table.join('\n'),
                'apps/x',
                ['apps/x/src/a.ts', 'apps/x/src/gen/c.ts'],
                { functions: 0.9, lines: 0.9 },
                ['**/gen/**'],
            ),
        ).toEqual(['quality gate: coverage shortfall apps/x/src/a.ts:7 funcs=50.00 lines=100.00']);
    });

    test('a changed file still below the floor after the workspace-wide run fails the tier', () => {
        const { result, log } = gate('covfail', low);
        expect(result.status).toBe('FAIL');
        expect(result.checks.at(-1)).toMatchObject({ id: 'coverage:apps/leaf-app', status: 'FAIL' });
        expect(log).toContain('quality gate: coverage shortfall apps/leaf-app/src/index.ts:3 funcs=50.00 lines=50.00');
    });

    test('a shortfall the workspace-wide run covers passes', () => {
        const { result } = gate(
            'covpass',
            `case "{paths}" in ./) echo 'All files | 100.00 | 100.00 |' ;; *) ${low} ;; esac`,
        );
        expect(result.status).toBe('PASS');
        expect(result.checks.at(-1)).toMatchObject({ id: 'coverage:apps/leaf-app', status: 'PASS' });
    });

    test('a workspace-wide run that prints no coverage table cannot clear the shortfall', () => {
        const { result, log } = gate('coverr', `case "{paths}" in ./) exit 3 ;; *) ${low} ;; esac`);
        expect(result.checks.at(-1)).toMatchObject({ id: 'coverage:apps/leaf-app', status: 'FAIL' });
        expect(log).toContain('no coverage table from the workspace-wide run');
    });

    test('a red workspace-wide run is still judged by its table', () => {
        const table = "echo 'All files | 100.00 | 100.00 |'; echo ' src/index.ts | 100.00 | 100.00 |'; exit 1";
        const { result } = gate('covred', `case "{paths}" in ./) ${table} ;; *) ${low} ;; esac`);
        expect(result.checks.at(-1)).toMatchObject({ id: 'coverage:apps/leaf-app', status: 'PASS' });
    });

    test('sibling suites of a changed source file join the related tests', () => {
        const { dir, base, cleanup } = monorepoFixture();
        try {
            recordBase(dir, 'covsib', base);
            writeFileSync(join(dir, 'apps/leaf-app/tests/index-extra.test.ts'), 'export const ok = 1;\n');
            sh('git add . && git commit -qm sibling', dir);
            writeFileSync(join(dir, 'apps/leaf-app/src/index.ts'), 'export const one = 2;\n');
            const result = silenceStdout(() =>
                runLightGate({ wbs: 'covsib' }, { cwd: dir, builder: leafBuilder('echo ran {paths}') }),
            );
            expect(readFileSync(join(dir, result.logFile), 'utf8')).toContain('ran tests/index-extra.test.ts');
        } finally {
            cleanup();
        }
    });

    test('no floor configured means nothing to judge', () => {
        const { dir, base, cleanup } = monorepoFixture();
        try {
            recordBase(dir, 'covnone', base);
            writeFileSync(join(dir, 'apps/leaf-app/tests/leaf-app.test.ts'), 'export const ok = 1;\n');
            const result = silenceStdout(() =>
                runLightGate({ wbs: 'covnone' }, { cwd: dir, builder: leafBuilder(low) }),
            );
            expect(result.checks.some((check) => check.id.startsWith('coverage:'))).toBe(false);
        } finally {
            cleanup();
        }
    });
});
