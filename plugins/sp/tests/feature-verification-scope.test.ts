/**
 * Feature-scoped verification split (task 0872, ADR-119, feature D62).
 *
 * Contract regression for the scope split the task introduces:
 *   R2 — the per-task gate (`spur self exec check`, task-pipeline `qualityGateCmd`)
 *        no longer runs any repo-wide check;
 *   R3 — the repo-wide set lives in `spur self exec check-feature`, owned by the
 *        `feature-verification` workflow (shell-only, no `agent.run`);
 *   R4 — `feature-lifecycle`'s verifying→done guard refuses to complete a
 *        feature until the pass records PASS;
 *   R5 — task-local checks (including the task-local `test` script) do not
 *        consult the feature pass or the relocated repo-wide test tree.
 */
import { describe, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
    'inline-pipeline-parity-check',
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

    test('R3: feature-verification is a gate-only pass with no agent.run nodes', () => {
        const wf = readWorkflow('feature-verification.yaml');
        expect(wf.name).toBe('feature-verification');
        expect(wf.vars).toMatchObject({ verificationCmd: 'spur self exec check-feature' });

        const actionKinds: unknown[] = [];
        for (const state of (wf.states as Array<{ onEnter?: Array<{ kind: unknown }> }>) ?? []) {
            for (const action of state.onEnter ?? []) actionKinds.push(action.kind);
        }
        // Script-absorption PR-5 left one `shell` action running `spur feature verify`; D65 1238 R1
        // moved it to the typed `command.gate` builtin (same argv, `softFail` instead of `exit 0`)
        // so the step's outcome is a PASS/FAIL/BLOCKED record in the trace rather than an exit code.
        expect(actionKinds).toEqual(['command.gate']);
        expect(actionKinds).not.toContain('agent.run');

        const guardKinds = new Set<unknown>();
        for (const t of (wf.transitions as Array<{ guard?: { kind: unknown } }>) ?? []) {
            if (t.guard) guardKinds.add(t.guard.kind);
        }
        expect([...guardKinds].sort()).toEqual(['always', 'shell']);
    });

    test('0960 R7 / 1238 R1: a pass that cannot run leaves FAIL and never aborts the graph', () => {
        // The workflow's `${vars.x}` template reference, assembled so a plain string literal in this
        // assertion is not mistaken for one.
        const varRef = (name: string): string => ['$', '{vars.', name, '}'].join('');
        const wf = readWorkflow('feature-verification.yaml');
        const verify = (
            wf.states as Array<{
                id: string;
                onEnter?: Array<{
                    kind?: string;
                    options?: { executable?: string; args?: string[]; resultFile?: string; softFail?: boolean };
                }>;
            }>
        ).find((s) => s.id === 'verify');
        const action = verify?.onEnter?.[0];
        // The step is the typed gate builtin over the SAME argv the shell ran, so the pass — not a
        // shell pipeline — owns the status file the guards read.
        expect(action?.kind).toBe('command.gate');
        expect(action?.options?.executable).toBe(varRef('spurBin'));
        expect(action?.options?.args?.slice(0, 2)).toEqual(['feature', 'verify']);
        expect(action?.options?.args).toContain('--run-id');
        // The old `|| printf … ; exit 0` is now `softFail`: a non-running pass is a RECORDED
        // outcome, so the run still reaches the guard below instead of aborting at the action.
        expect(action?.options?.softFail).toBe(true);
        // …and the typed token is written BESIDE the pass's own status file, never over it: the gate
        // exits 0 for a completed FAIL pass, so sharing the path would overwrite the FAIL evidence.
        expect(action?.options?.resultFile).not.toBe(`.spur/run/${varRef('__runId')}-feature-verification.status`);

        const dir = mkdtempSync(join(tmpdir(), 'spur-0960-fv-'));
        try {
            // The pass cannot run (this project has no features directory at all): it must still
            // leave the coarse FAIL the guards route on, and exit nonzero to the gate.
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

            // The fail-closed routing the status file drives: done requires PASS, so FAIL (or an
            // absent file) can only reach `failed`.
            const guard = (
                wf.transitions as Array<{
                    from: string;
                    to: string;
                    guard?: { kind?: string; options?: { command?: string } };
                }>
            ).find((t) => t.from === 'verify' && t.to === 'done');
            const doneGuard = guard?.guard?.options?.command ?? '';
            expect(doneGuard).toContain('-feature-verification.status');
            expect(doneGuard).toContain('= PASS');
            // With the FAIL the cannot-run pass just wrote, the done edge cannot match.
            expect(Bun.spawnSync(['sh', '-c', doneGuard], { cwd: dir }).exitCode).not.toBe(0);
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

    test('R5 (0880): feature-lifecycle verifying entry invokes the feature-verification workflow', () => {
        const wf = readWorkflow('feature-lifecycle.yaml');
        const verifying = (
            wf.states as Array<{ id: string; onEnter?: Array<{ options?: { command?: string } }> }>
        ).find((s) => s.id === 'verifying');
        const commands = (verifying?.onEnter ?? []).map((a) => a.options?.command ?? '');
        expect(commands.some((c) => c.includes('workflow run feature-verification.yaml'))).toBe(true);
        const caller = commands.find((c) => c.includes('workflow run feature-verification.yaml')) ?? '';
        expect(caller).toContain('featureId\\":\\"$featureId');
        expect(caller).toContain('spurBin\\":\\"$spurBin');
    });

    test('1147 AC4: the nested caller clears the marker that refuses nested runs, so nested == standalone', () => {
        const wf = readWorkflow('feature-lifecycle.yaml');
        const verifying = (
            wf.states as Array<{ id: string; onEnter?: Array<{ options?: { command?: string } }> }>
        ).find((s) => s.id === 'verifying');
        const caller =
            (verifying?.onEnter ?? [])
                .map((a) => a.options?.command ?? '')
                .find((c) => c.includes('workflow run feature-verification.yaml')) ?? '';
        // A workflow-spawned `spur workflow run` inherits the outer run's
        // SPUR_WORKFLOW_RUN_ACTIVE marker, and the CLI's nested-run refusal (0610 R4) turns that
        // into `exit 1` with nothing else on stderr — the pass that succeeds standalone failed
        // under a wrapup. The shared invocation path clears the marker for this bounded child.
        expect(caller).toContain('env -u SPUR_WORKFLOW_RUN_ACTIVE');

        const dir = mkdtempSync(join(tmpdir(), 'spur-1147-nested-marker-'));
        try {
            const stub = join(dir, 'stub-spur');
            writeFileSync(
                stub,
                `#!/bin/sh\nprintf "%s" "\${SPUR_WORKFLOW_RUN_ACTIVE-unset}" > "$PWD/spur-bin-env.txt"\nexit 0\n`,
            );
            chmodSync(stub, 0o755);
            const result = Bun.spawnSync(['sh', '-c', caller], {
                cwd: dir,
                env: {
                    ...getEnvVars(),
                    SPUR_WORKFLOW_RUN_ACTIVE: '1',
                    spurBin: stub,
                    featureId: 'H1',
                },
            });
            expect(result.exitCode).toBe(0);
            // The child invocation the lifecycle hands the nested pass sees no marker.
            expect(readFileSync(join(dir, 'spur-bin-env.txt'), 'utf8')).toBe('unset');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
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
