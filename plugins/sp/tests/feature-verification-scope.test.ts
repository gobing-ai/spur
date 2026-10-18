/**
 * Feature-scoped verification split (task 0872, ADR-119, feature D62).
 *
 * Contract regression for the scope split the task introduces:
 *   R2 — the per-task gate (`spur self exec check`, task-pipeline `qualityGateCmd`)
 *        no longer runs any repo-wide check;
 *   R3 — the repo-wide set lives in `spur self exec check-feature`. It was owned by the
 *        `feature-verification` wrapper workflow until 1246 retired that file; today
 *        `feature-lifecycle`'s verifying entry runs `spur feature verify` directly (1246 R1);
 *   R4 — `feature-lifecycle`'s verifying→done guard refuses to complete a
 *        feature until the pass records PASS;
 *   R5 — task-local checks (including the task-local `test` script) do not
 *        consult the feature pass or the relocated repo-wide test tree.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVars } from '@gobing-ai/ts-utils';
import ts from 'typescript';
import { parse as parseYaml } from 'yaml';

const REPO_ROOT = join(import.meta.dir, '../../..');

/** The repo-wide check names relocated out of the per-task gate (task 0872 R2/R3). */
const REPO_WIDE_CHECKS = [
    'link-check',
    'transition-shim-check',
    'script-contract-check',
    'dependency-drift-check',
    'importer-schema-check',
] as const;

function readScripts(): Record<string, string> {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
        scripts: Record<string, string>;
    };
    return pkg.scripts;
}

function readWorkflow(name: string): Record<string, unknown> {
    return parseYaml(readFileSync(join(REPO_ROOT, 'config', 'workflows', name), 'utf8')) as Record<string, unknown>;
}

describe('feature-verification scope split (task 0872)', () => {
    test('R2: the per-task gate (spur-check) runs no repo-wide check and no feature pass', () => {
        const scripts = readScripts();
        const taskGate = scripts['spur-check'];
        for (const check of REPO_WIDE_CHECKS) {
            expect(taskGate, `spur-check must not run ${check}`).not.toContain(check);
        }
        expect(taskGate).not.toContain('test-repo-wide');
        expect(taskGate).not.toContain('spur-check-feature');
    });

    test('R3: the feature pass (spur-check-feature) owns every repo-wide check', () => {
        const scripts = readScripts();
        const featureGate = scripts['spur-check-feature'];
        for (const check of REPO_WIDE_CHECKS) {
            expect(featureGate, `spur-check-feature must run ${check}`).toContain(check);
        }
        expect(featureGate).toContain('test-repo-wide');
    });

    test('R5: the task-local test script excludes the relocated repo-wide test tree', () => {
        const scripts = readScripts();
        expect(scripts.test).not.toContain('repo-wide-tests');
        expect(scripts['test-repo-wide']).toContain('repo-wide-tests');
    });

    test('1154 R3: the gate test script runs --parallel; coverage/full scripts stay serial', () => {
        // Upgrade bar met on Bun 1.4.3: --parallel (implies --isolate) passes the full suite and
        // merges per-worker coverage correctly (per-file numbers match the serial run; 1.3.14
        // undercounted functions split across workers, failing 219 files spuriously). The
        // earlier TDZ/wedge failures were top-level await, guarded below.
        const scripts = readScripts();
        expect(scripts.test).toContain('--parallel');
        for (const key of ['test:coverage', 'test:full']) {
            expect(scripts[key], `${key} must not pass --parallel`).not.toContain('--parallel');
        }
    });

    test('1154 R3: no top-level await in the test preload or app sources (breaks --isolate)', () => {
        const files = ['tests/setup.ts', ...new Bun.Glob('{packages,apps}/*/src/**/*.{ts,tsx}').scanSync(REPO_ROOT)];
        const offenders = files.filter((f) => hasTopLevelAwait(f, readFileSync(join(REPO_ROOT, f), 'utf8')));
        expect(offenders).toEqual([]);
    });

    test('1154 R3: the top-level-await detector catches every form, including multiline destructures', () => {
        // The exact shape that broke --isolate (inline-run-setup.ts before the fix).
        expect(
            hasTopLevelAwait('a.ts', "const {\n    mkdirSync,\n    readFileSync,\n} = await import('node:fs');"),
        ).toBe(true);
        expect(hasTopLevelAwait('a.ts', 'await reset();')).toBe(true);
        expect(hasTopLevelAwait('a.ts', 'export const x = (await load()).y;')).toBe(true);
        expect(hasTopLevelAwait('a.ts', 'for await (const x of xs) {}')).toBe(true);
        expect(hasTopLevelAwait('a.ts', 'if (ok) { const m = await import("m"); }')).toBe(true);
        // Awaits inside functions, methods, and arrows are fine.
        expect(hasTopLevelAwait('a.ts', 'async function f() { await g(); }')).toBe(false);
        expect(hasTopLevelAwait('a.ts', 'const f = async () => {\n    const { a } = await import("m");\n};')).toBe(
            false,
        );
        expect(hasTopLevelAwait('a.ts', 'class C { async m() { for await (const x of y) {} } }')).toBe(false);
        expect(hasTopLevelAwait('a.ts', 'if (import.meta.main) {\n    process.exitCode = await runCli();\n}')).toBe(
            false,
        );
        expect(hasTopLevelAwait('a.ts', 'if (import.meta.main) {} else { await x(); }')).toBe(true);
        expect(hasTopLevelAwait('a.ts', '// await in a comment\nconst s = "await x";')).toBe(false);
    });

    test('R3: the feature-verification wrapper is retired; feature-lifecycle stays agent-free (1246)', () => {
        // 1246 R5: the one-state wrapper workflow is deleted from the shipped catalog.
        expect(existsSync(join(REPO_ROOT, 'config', 'workflows', 'feature-verification.yaml'))).toBe(false);

        const wf = readWorkflow('feature-lifecycle.yaml');
        expect(wf.name).toBe('feature-lifecycle');
        const actionKinds: unknown[] = [];
        for (const state of (wf.states as Array<{ onEnter?: Array<{ kind: unknown }> }>) ?? []) {
            for (const action of state.onEnter ?? []) actionKinds.push(action.kind);
        }
        expect(actionKinds).not.toContain('agent.run');

        const guardKinds = new Set<unknown>();
        for (const t of (wf.transitions as Array<{ guard?: { kind: unknown } }>) ?? []) {
            if (t.guard) guardKinds.add(t.guard.kind);
        }
        expect([...guardKinds].sort()).toEqual(['always', 'shell']);
    });

    test('0960 R7: a pass that cannot run leaves FAIL and exits nonzero', () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-0960-fv-'));
        try {
            // The pass cannot run (this project has no features directory at all): it must still
            // leave the coarse FAIL the guards route on, and exit nonzero.
            const result = Bun.spawnSync(
                [
                    process.execPath,
                    join(REPO_ROOT, 'apps/cli/src/index.ts'),
                    'feature',
                    'verify',
                    'F1',
                    '--run-id',
                    'r0960',
                    '--no-logo',
                ],
                {
                    cwd: dir,
                    env: {
                        ...getEnvVars(),
                        // Never read or lock the operator's global registry from a test.
                        SPUR_PROJECTS_FILE: join(dir, 'projects.json'),
                        SPUR_SLASH_COMMANDS_FILE: join(dir, 'slash_commands.json'),
                    },
                },
            );
            expect(result.exitCode).toBe(1);
            const status = readFileSync(join(dir, '.spur/run/r0960-feature-verification.status'), 'utf8');
            expect(status).toStartWith('FAIL');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('R4: feature-lifecycle verifying→done requires the strict done check (bound receipt, 0915)', () => {
        const wf = readWorkflow('feature-lifecycle.yaml');
        const edge = (
            wf.transitions as Array<{ from: string; to: string; guard?: { options?: { command?: string } } }>
        ).find((t) => t.from === 'verifying' && t.to === 'done');
        expect(edge).toBeDefined();
        // D63 task 0915: the old `.status`-only precondition collapsed into the
        // strict `feature check --as done`, whose L4 layer validates the bound
        // verification receipt (verdict, identity, contract, input digest).
        expect(edge?.guard?.options?.command ?? '').toContain('feature check');
        expect(edge?.guard?.options?.command ?? '').toContain('--as done');
    });

    test('R5 (0880) / 1246 R1: feature-lifecycle verifying entry runs the verb directly, no nested run', () => {
        const wf = readWorkflow('feature-lifecycle.yaml');
        const verifying = (
            wf.states as Array<{ id: string; onEnter?: Array<{ options?: { command?: string } }> }>
        ).find((s) => s.id === 'verifying');
        const commands = (verifying?.onEnter ?? []).map((a) => a.options?.command ?? '');
        // 1246 R1: one shell action calling the verb — no nested `workflow run`, and no
        // recursion-marker clearing (the 1147 R4 workaround retired with the nested run).
        expect(commands.some((c) => c.includes('workflow run'))).toBe(false);
        expect(commands.some((c) => c.includes('SPUR_WORKFLOW_RUN_ACTIVE'))).toBe(false);
        // `__runId` IS unset: it is the env fallback behind the verb's `--run-id`, so an outer
        // workflow run's id would otherwise hijack the pass's own run row (1246 R2).
        expect(commands).toContain('env -u __runId $spurBin feature verify $featureId --no-logo');
    });
});

/**
 * True when the module evaluates an `await` outside any function (top-level await, including
 * `for await`). Bun 1.3.14 leaves such modules uninitialized under `bun test --isolate`.
 * Awaits guarded by `if (import.meta.main)` are exempt: they never run when imported.
 * AST-based, so multiline destructures, comments and strings are handled exactly.
 */
function hasTopLevelAwait(fileName: string, source: string): boolean {
    const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node): boolean => {
        if (ts.isFunctionLike(node) || ts.isClassStaticBlockDeclaration(node)) return false;
        // `if (import.meta.main) { await main(); }` entry points never evaluate the await on import.
        if (ts.isIfStatement(node) && node.expression.getText(sf) === 'import.meta.main') {
            return node.elseStatement !== undefined && visit(node.elseStatement);
        }
        if (ts.isAwaitExpression(node)) return true;
        if (ts.isForOfStatement(node) && node.awaitModifier !== undefined) return true;
        return ts.forEachChild(node, visit) === true;
    };
    return ts.forEachChild(sf, visit) === true;
}
