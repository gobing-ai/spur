/**
 * `spur workflow eval` transport (A94 1413 R1).
 *
 * Failure modes first — each one would make a downstream comparison lie or fork unbounded work:
 *   - `--runs` outside 1-20 accepted (an unbounded comparison)
 *   - an unknown fixture reported as a clean run instead of a usage error listing the searched paths
 *   - `--dry-run` creating a worktree, a fixture or a report
 *   - an eval started inside an eval (the nesting refusal) resuming instead of refusing
 */
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVars, removeEnvVar, setEnvVar } from '@gobing-ai/spur-config';
import { main } from '../../../src';

interface Captured {
    code: number;
    messages: string[];
    json: unknown;
}

async function run(
    args: string[],
    cwd: string,
    env: Record<string, string | undefined> = getEnvVars(),
): Promise<Captured> {
    const messages: string[] = [];
    const code = await main(args, {
        cwd,
        env,
        output: { write: (m) => messages.push(m), error: (m) => messages.push(m) },
    });
    let json: unknown;
    try {
        json = JSON.parse(messages.at(-1) ?? '{}');
    } catch {
        json = undefined;
    }
    return { code, messages, json };
}

describe('spur workflow eval', () => {
    test('--dry-run prints the resolved plan and creates nothing', async () => {
        const cwd = mkdtempSync(join(tmpdir(), 'spur-eval-plan-'));
        try {
            const result = await run(['workflow', 'eval', '--dry-run', '--fixture', 'fixture-minimal'], cwd);
            const text = result.messages.join('\n');
            expect(result.code, text).toBe(0);
            expect(text).toContain('fixture-minimal');
            expect(text).toContain('runs: 1');
            // The plan names the worktree root but never creates it.
            expect(text).toContain('worktree root:');
        } finally {
            await rm(cwd, { recursive: true, force: true });
        }
    });

    test('an unknown fixture is a usage error naming the searched paths', async () => {
        const cwd = mkdtempSync(join(tmpdir(), 'spur-eval-fixture-'));
        try {
            const result = await run(['workflow', 'eval', '--dry-run', '--fixture', 'nope'], cwd);
            expect(result.code).toBe(2);
            expect(result.messages.join('\n')).toContain('unknown fixture: nope');
        } finally {
            await rm(cwd, { recursive: true, force: true });
        }
    });

    test('--runs outside 1-20 is a usage error', async () => {
        const cwd = mkdtempSync(join(tmpdir(), 'spur-eval-runs-'));
        try {
            for (const runs of ['0', '21']) {
                const result = await run(['workflow', 'eval', '--dry-run', '--runs', runs], cwd);
                expect([runs, result.code]).toEqual([runs, 2]);
                expect(result.messages.join('\n')).toContain('between 1 and 20');
            }
        } finally {
            await rm(cwd, { recursive: true, force: true });
        }
    });

    test('the nesting guard refuses and says why', async () => {
        const cwd = mkdtempSync(join(tmpdir(), 'spur-eval-nested-'));
        try {
            // The guard reads the process environment (it must reach forked children), so set it here
            // rather than through the injectable env bag.
            setEnvVar('SPUR_EVAL_PIPELINE_ACTIVE', '1');
            const result = await run(['workflow', 'eval', '--dry-run'], cwd);
            expect(result.code).toBe(1);
            expect(result.messages.join('\n')).toContain('REFUSING to run');
        } finally {
            removeEnvVar('SPUR_EVAL_PIPELINE_ACTIVE');
            await rm(cwd, { recursive: true, force: true });
        }
    });

    test('a text run reports each record and exits 1 when the pipeline failed', async () => {
        const root = mkdtempSync(join(tmpdir(), 'spur-eval-text-'));
        try {
            seedProject(root, { pipelineExit: 1 });
            const result = await run(['workflow', 'eval'], root);
            const text = result.messages.join('\n');
            expect(result.code, text).toBe(1);
            // The record line and the report path are the text contract.
            expect(text).toContain('[task-pipeline.yaml] verdict=');
            expect(text).toContain('report:');
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    }, 60_000);

    test('a harness failure is reported through the JSON error path', async () => {
        const root = mkdtempSync(join(tmpdir(), 'spur-eval-broken-'));
        try {
            seedProject(root, { pipelineExit: 1 });
            // Remove the stub CLI: `task create` cannot run, so the harness fails outside the
            // usage-error family and the verb reports a plain error (exit 1).
            writeFileSync(join(root, 'apps', 'cli', 'src', 'index.ts'), 'process.exit(2);\n');
            const result = await run(['workflow', 'eval', '--json'], root);
            expect(result.code).toBe(1);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    }, 60_000);

    test('the JSON plan is emitted through the envelope', async () => {
        const root = mkdtempSync(join(tmpdir(), 'spur-eval-envelope-'));
        try {
            seedProject(root);
            const result = await run(['workflow', 'eval', '--dry-run', '--json', '--json-envelope'], root);
            expect(result.code, result.messages.join('\n')).toBe(0);
            const payload = result.json as {
                ok: boolean;
                data?: { report: { runCount: number; records: unknown[] } };
            };
            expect(payload.data?.report.runCount).toBe(1);
            // One fixture record, and the pipeline itself was never spawned (a dry run).
            expect(payload.data?.report.records).toHaveLength(1);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    }, 60_000);
});

/**
 * A hermetic eval project: a git worktree-add target, a pipeline, `.spur/config.yaml`, and a stub
 * `apps/cli/src/index.ts` the harness spawns to seed fixtures (it answers with a synthetic WBS).
 */
function seedProject(root: string, options: { pipelineExit?: number } = {}): void {
    mkdirSync(join(root, 'config', 'workflows'), { recursive: true });
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    mkdirSync(join(root, '.spur'), { recursive: true });
    mkdirSync(join(root, 'apps', 'cli', 'src'), { recursive: true });
    writeFileSync(join(root, '.spur', 'config.yaml'), 'tasks:\n  folders: []\n\nfeatures:\n  folders: []\n');
    writeFileSync(
        join(root, 'config', 'workflows', 'task-pipeline.yaml'),
        'name: task-pipeline\ninitialState: s\nstates:\n  - id: s\ntransitions: []\n',
    );
    // The stub answers `task create` with a WBS and exits with `pipelineExit` for a pipeline run.
    writeFileSync(
        join(root, 'apps', 'cli', 'src', 'index.ts'),
        [
            'const argv = process.argv.slice(2);',
            `if (argv[0] === "workflow") process.exit(${String(options.pipelineExit ?? 0)});`,
            'console.log(JSON.stringify({ wbs: "9500" }));',
            '',
        ].join('\n'),
    );
    writeFileSync(join(root, '.gitignore'), '.spur/run\n.spur/spur.db\nnode_modules/\n');
    for (const argv of [
        ['init', '-q', '.'],
        ['add', '.'],
        ['-c', 'user.email=a@b', '-c', 'user.name=n', 'commit', '-qm', 'init'],
    ]) {
        expect(Bun.spawnSync(['git', ...argv], { cwd: root }).exitCode).toBe(0);
    }
}
