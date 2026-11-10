/**
 * Task 1322 (feature H16) — affected-scope selection (R3) and the recheck light-tier triage
 * (P2). A real two-workspace monorepo fixture (`packages/shared-lib` depended on by
 * `apps/leaf-app`) pins: graph construction, selection over the workspace dependency graph, the
 * shared-package and unmapped-path fallback to the full suite, base-sha change sets, the light
 * receipt's selection rationale, and both recheck outcomes (a red tier fails the visit without
 * paying the full chain; a green tier or a fallback falls through to the full gate).
 */
import { describe, expect, test } from 'bun:test';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type BuilderConfig, BuilderConfigSchema } from '@gobing-ai/spur-config';
import {
    dependentsOf,
    lightScope,
    readBaseSha,
    readWorkspaceGraph,
    runLightGate,
    runQualityGate,
    runShellCommand,
    workspaceGraphFrom,
} from '../../src/services/quality-gate';

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
});

describe('affected-scope selection (1322 R3)', () => {
    test('a leaf-workspace change is selected: owning workspace, no fallback', () => {
        const { dir, cleanup } = monorepoFixture();
        try {
            const scope = lightScope(
                ['apps/leaf-app/src/index.ts', 'apps/leaf-app/tests/leaf-app.test.ts'],
                (p) => existsSync(join(dir, p)),
                readWorkspaceGraph(dir),
            );
            expect(scope.fallback).toBeUndefined();
            expect(scope.workspaces).toEqual(['apps/leaf-app']);
            expect(scope.tests).toEqual(['apps/leaf-app/tests/leaf-app.test.ts']);
        } finally {
            cleanup();
        }
    });

    test('a shared-package change falls back to the full suite, naming the dependent', () => {
        const { dir, cleanup } = monorepoFixture();
        try {
            const scope = lightScope(
                ['packages/shared-lib/src/index.ts'],
                (p) => existsSync(join(dir, p)),
                readWorkspaceGraph(dir),
            );
            expect(scope.fallback).toBe(
                'shared package packages/shared-lib (depended on by apps/leaf-app) — full suite required',
            );
        } finally {
            cleanup();
        }
    });

    test('a path no workspace owns falls back to the full suite', () => {
        const { dir, cleanup } = monorepoFixture();
        try {
            const scope = lightScope(['README.md'], (p) => existsSync(join(dir, p)), readWorkspaceGraph(dir));
            expect(scope.fallback).toBe(
                'unmapped path README.md (no owning workspace package.json) — full suite required',
            );
        } finally {
            cleanup();
        }
    });

    test('plugins/sp paths never trigger the fallback (the 1142 mapping owns them)', () => {
        const { dir, cleanup } = monorepoFixture();
        try {
            const scope = lightScope(['plugins/sp/skills/x/SKILL.md'], () => true, readWorkspaceGraph(dir));
            expect(scope.fallback).toBeUndefined();
            expect(scope.workspaces).toEqual(['plugins/sp']);
        } finally {
            cleanup();
        }
    });

    test('without a graph the mapping keeps legacy behavior (no fallback classification)', () => {
        const { dir, cleanup } = monorepoFixture();
        try {
            const scope = lightScope(['packages/shared-lib/src/index.ts', 'README.md'], (p) =>
                existsSync(join(dir, p)),
            );
            expect(scope.fallback).toBeUndefined();
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
            expect(result.fallback).toBeUndefined();
            const log = readFileSync(join(dir, result.logFile), 'utf8');
            expect(log.startsWith('--- light scope: selected — workspaces: apps/leaf-app;')).toBe(true);
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

    test('a shared-package change refuses the tier: BLOCKED with rationale, no checks, no receipt', () => {
        const { dir, base, cleanup } = monorepoFixture();
        try {
            recordBase(dir, '1322s', base);
            writeFileSync(join(dir, 'packages/shared-lib/src/index.ts'), 'export const one = 2;\n');
            const result = silenceStdout(() =>
                runLightGate({ wbs: '1322s' }, { cwd: dir, builder: leafBuilder('exit 0') }),
            );
            expect(result.status).toBe('FAIL');
            expect(result.fallback).toContain('shared package packages/shared-lib');
            expect(result.blocked).toBe(result.fallback);
            expect(result.checks).toEqual([]);
            const log = readFileSync(join(dir, result.logFile), 'utf8');
            expect(log).toContain('--- light scope: full-suite-fallback — shared package packages/shared-lib');
            expect(log).toContain('--- light gate BLOCKED: affected-scope fallback');
            // No tier receipt: the refusal must not overwrite standing boundary evidence.
            expect(existsSync(join(dir, '.spur/run/1322s-check-receipt.json'))).toBe(false);
            // And the light tier never writes the full gate's status token.
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
            expect(log).toContain('--- light scope: selected — workspaces: apps/leaf-app');
        } finally {
            cleanup();
        }
    });

    test('a full-suite fallback falls through to the full gate exactly as before', () => {
        const { dir, base, cleanup } = monorepoFixture();
        try {
            recordBase(dir, '1322u', base);
            writeFileSync(join(dir, 'packages/shared-lib/src/index.ts'), 'export const one = 2;\n');
            const sentinel = join(dir, 'full-ran');
            const full = silenceStdout(() =>
                runQualityGate(
                    'recheck',
                    { wbs: '1322u', qualityGateCmd: `touch "${sentinel}"`, runId: 'r1322' },
                    { cwd: dir, builder: leafBuilder('exit 0') },
                ),
            );
            expect(full.status).toBe('PASS');
            expect(existsSync(sentinel)).toBe(true);
            const log = readFileSync(join(dir, '.spur/run/1322u-test-gate.log'), 'utf8');
            expect(log).toContain('check.scope-fallback — shared package packages/shared-lib');
            expect(log).toContain('--- light gate BLOCKED: affected-scope fallback');
            const receipt = JSON.parse(readFileSync(join(dir, '.spur/run/1322u-check-receipt.json'), 'utf8')) as {
                tier: string;
            };
            expect(receipt.tier).toBe('full');
        } finally {
            cleanup();
        }
    });
});
