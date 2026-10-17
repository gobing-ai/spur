/**
 * E2E for task 1224 (feature A92, design `docs/design/sdlc-actions.md` §3.4): the light gate
 * resolves every scoped command in-process from the project action map, so a non-bun project
 * runs its own declared commands and an unbound action is skipped instead of silently replaced
 * by a preset literal. R8 is pinned as the pre-change plan bytes for a fixed scope.
 */
import { describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type BuilderConfig, BuilderConfigSchema } from '@gobing-ai/spur-config';
import { planLightChecks, runLightGate, runShellCommand } from '../../src/services/quality-gate';

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

/** The fixed scope both the pre-change baseline and the current planner use (R8). */
const FIXED_SCOPE = {
    files: ['packages/app/src/services/quality-gate.ts', 'apps/cli/src/commands/task/gate.ts'],
    workspaces: ['packages/app', 'apps/cli'],
    tests: ['packages/app/tests/services/quality-gate-receipt.test.ts'],
};
const HAS_TYPECHECK = (workspace: string): boolean => workspace === 'packages/app';

/**
 * The plan captured from `planLightChecks` BEFORE task 1224 touched the planner, rendered with
 * `JSON.stringify(plans, null, 2)`. This is the R8 artifact, not a reconstruction: the bun preset
 * must keep producing these exact bytes.
 */
const PRE_CHANGE_PLAN_JSON = `[
  {
    "id": "format-lint:changed",
    "cmd": "bunx biome check packages/app/src/services/quality-gate.ts apps/cli/src/commands/task/gate.ts"
  },
  {
    "id": "rules:pre",
    "cmd": "bun run test-pre-check"
  },
  {
    "id": "rules:post",
    "cmd": "bun run test-post-check"
  },
  {
    "id": "typecheck:packages/app",
    "cmd": "cd packages/app && bun run typecheck"
  },
  {
    "id": "test:packages/app",
    "cmd": "cd packages/app && bun test tests/services/quality-gate-receipt.test.ts"
  }
]`;

describe('light-tier action resolution (1224 R1/R2/R8)', () => {
    test('R8 — the bun preset renders the pre-change plan bytes for a fixed scope', () => {
        const plans = planLightChecks(FIXED_SCOPE, HAS_TYPECHECK);
        expect(JSON.stringify(plans, null, 2)).toBe(PRE_CHANGE_PLAN_JSON);
    });

    test('R2 — plan ids are unchanged and the preset keeps gating typecheck on package.json', () => {
        const withTypecheck = planLightChecks(FIXED_SCOPE, HAS_TYPECHECK).map((plan) => plan.id);
        const withoutTypecheck = planLightChecks(FIXED_SCOPE, () => false).map((plan) => plan.id);
        expect(withTypecheck).toEqual([
            'format-lint:changed',
            'rules:pre',
            'rules:post',
            'typecheck:packages/app',
            'test:packages/app',
        ]);
        expect(withoutTypecheck).not.toContain('typecheck:packages/app');
    });

    test('R2 — a declared typecheck owns its scope, so package.json no longer gates it', () => {
        const builder = declaredBuilder({
            'typecheck-changed': 'mypy {workspace}',
        });
        const plans = planLightChecks(FIXED_SCOPE, () => false, builder);
        expect(plans.find((plan) => plan.id === 'typecheck:packages/app')).toEqual({
            id: 'typecheck:packages/app',
            cmd: 'mypy packages/app',
        });
    });

    test('R2 — an unbound scoped action is planned as skipped:unbound with no fallback command', () => {
        const builder = declaredBuilder({ 'lint-changed': 'ruff check {files}' });
        const plans = planLightChecks(FIXED_SCOPE, HAS_TYPECHECK, builder);
        for (const id of ['typecheck:packages/app', 'test:packages/app']) {
            expect(plans.find((plan) => plan.id === id)).toEqual({ id, cmd: '', skipped: 'unbound' });
        }
        // `rules-pre`/`rules-post` are the reserved stack-neutral pair: they resolve a Spur-owned
        // default under `preset: none`, so only the genuinely unbound actions are skipped.
        expect(plans.find((plan) => plan.id === 'rules:pre')?.cmd).toContain('rule run --preset recommended-pre-check');
        expect(plans.find((plan) => plan.id === 'rules:post')?.cmd).toContain(
            'rule run --preset recommended-post-check',
        );
    });
});

/** `preset: none` plus the given actions — a non-bun project's binding. */
function declaredBuilder(actions: Record<string, string>): BuilderConfig {
    return BuilderConfigSchema.parse({ preset: 'none', actions });
}

/** A python-shaped git fixture: no bun, no biome; the recorded stubs stand in for the tools. */
function pythonFixture(): { dir: string; bin: string; cleanup: () => void } {
    const dir = mkdtempSync(join(tmpdir(), 'spur-py-light-'));
    const bin = join(dir, 'bin');
    mkdirSync(bin, { recursive: true });
    // Each stub records its argv into bin/calls.log — the evidence the gate ran the declared tool.
    for (const tool of ['ruff', 'mypy', 'pytest']) {
        const path = join(bin, tool);
        writeFileSync(
            path,
            '#!/bin/sh\nprintf \'%s %s\\n\' "$(basename "$0")" "$*" >> "$(dirname "$0")/calls.log"\nexit 0\n',
        );
        chmodSync(path, 0o755);
    }
    const sh = (cmd: string): void => {
        const result = runShellCommand(cmd, dir);
        if (result.code !== 0) throw new Error(`fixture: ${cmd} failed: ${result.output}`);
    };
    sh('git init -q -b main');
    sh('git config user.email fixture@spur.dev');
    sh('git config user.name fixture');
    writeFileSync(join(dir, '.gitignore'), '.spur/\n');
    writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ name: 'py-root' }, null, 4)}\n`);
    // The workspace marker the (bun-shaped, out-of-scope) scope discovery keys on.
    mkdirSync(join(dir, 'pkg-a/src'), { recursive: true });
    mkdirSync(join(dir, 'pkg-a/tests'), { recursive: true });
    writeFileSync(join(dir, 'pkg-a/package.json'), `${JSON.stringify({ name: 'pkg-a' }, null, 4)}\n`);
    writeFileSync(join(dir, 'pkg-a/src/m.py'), 'def one():\n    return 1\n');
    // The test file lives at the path the frozen `<ws>/tests/<name>` mapping probes.
    writeFileSync(join(dir, 'pkg-a/tests/m.py'), 'def test_one():\n    assert True\n');
    sh('git add .');
    sh('git commit -qm init');
    writeFileSync(join(dir, 'pkg-a/src/m.py'), 'def one():\n    return 2\n');
    return { dir, bin, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function calls(dir: string): string[] {
    try {
        return readFileSync(join(dir, 'bin/calls.log'), 'utf8').trim().split('\n');
    } catch {
        return [];
    }
}

describe('light gate on a python-shaped fixture (1224 R1/R2, AC1)', () => {
    test('runs the declared ruff/mypy/pytest stubs and never a bun or biome command', () => {
        const { dir, bin, cleanup } = pythonFixture();
        try {
            const builder = declaredBuilder({
                'lint-changed': `${bin}/ruff check {files}`,
                'rules-pre': `${bin}/ruff rules-pre`,
                'rules-post': `${bin}/ruff rules-post`,
                'typecheck-changed': `${bin}/mypy {workspace}`,
                'test-changed': `${bin}/pytest {paths}`,
            });
            const result = silenceStdout(() => runLightGate({ wbs: '1224a' }, { cwd: dir, builder }));
            expect(result.status).toBe('PASS');
            expect(result.checks.map((check) => check.id)).toEqual([
                'format-lint:changed',
                'rules:pre',
                'rules:post',
                'typecheck:pkg-a',
                'test:pkg-a',
            ]);
            expect(calls(dir)).toEqual([
                'ruff check pkg-a/src/m.py',
                'ruff rules-pre',
                'ruff rules-post',
                'mypy pkg-a',
                'pytest tests/m.py',
            ]);
            const log = readFileSync(join(dir, result.logFile), 'utf8');
            expect(log).not.toMatch(/\bbunx?\b|biome/);
        } finally {
            cleanup();
        }
    });

    test('an unbound typecheck action is skipped, logged, and runs nothing', () => {
        const { dir, bin, cleanup } = pythonFixture();
        try {
            const builder = declaredBuilder({
                'lint-changed': `${bin}/ruff check {files}`,
                'rules-pre': `${bin}/ruff rules-pre`,
                'rules-post': `${bin}/ruff rules-post`,
                'test-changed': `${bin}/pytest {paths}`,
            });
            const result = silenceStdout(() => runLightGate({ wbs: '1224b' }, { cwd: dir, builder }));
            expect(result.status).toBe('PASS');
            expect(result.checks.map((check) => check.id)).not.toContain('typecheck:pkg-a');
            expect(calls(dir).some((call) => call.startsWith('mypy'))).toBe(false);
            expect(readFileSync(join(dir, result.logFile), 'utf8')).toContain(
                '--- light typecheck:pkg-a: skipped:unbound',
            );
        } finally {
            cleanup();
        }
    });
});
