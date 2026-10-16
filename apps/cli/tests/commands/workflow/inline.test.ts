/**
 * `spur workflow inline <op>` — in-process coverage of the thin Commander adapter
 * (script-absorption PR-4). The app runners are stubbed through the `loadApp` seam so every argv
 * branch is asserted without a database; `workflow-inline-parity.test.ts` replays the real
 * runners end to end against the retired scripts' golden output.
 */
import { describe, expect, spyOn, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from '@commander-js/extra-typings';
import type { SpurConfig } from '@gobing-ai/spur-config';
import { registerWorkflowInlineCommand, type WorkflowInlineDeps } from '../../../src/commands/workflow/inline';
import { main } from '../../../src/index';

type Calls = Array<[string, unknown]>;

/** A stub app: each runner records its input and answers `code` (or throws `boom`). */
function stubApp(calls: Calls, behaviour: { code?: number; boom?: string; inventoryError?: string } = {}) {
    const answer = (name: string) => async (input: unknown) => {
        calls.push([name, input]);
        if (behaviour.boom !== undefined) throw new Error(behaviour.boom);
        return behaviour.code ?? 0;
    };
    return {
        readInstalledInventory: async (input: unknown) => {
            calls.push(['readInstalledInventory', input]);
            if (behaviour.inventoryError !== undefined) throw new Error(behaviour.inventoryError);
            return { inventory: true };
        },
        writeInlineRunOutcome: (runId: string, outcome: unknown) => {
            calls.push(['writeInlineRunOutcome', { runId, outcome }]);
        },
        runInlineRunSetup: answer('runInlineRunSetup'),
        runInlineRunFingerprint: answer('runInlineRunFingerprint'),
        runInlineRunTraceMode: async (input: { summarize?: (run: unknown) => Promise<string> }) => {
            calls.push(['runInlineRunTraceMode', input]);
            if (behaviour.boom !== undefined) throw new Error(behaviour.boom);
            if (input.summarize !== undefined) {
                calls.push([
                    'summary',
                    await input.summarize({
                        runId: 'r1',
                        startedAt: undefined,
                        completedAt: '2026-10-09T00:00:00Z',
                        progress: {},
                    }),
                ]);
            }
            return behaviour.code ?? 0;
        },
        runInlineRunDecide: answer('runInlineRunDecide'),
        runInlineRunPersistOut: answer('runInlineRunPersistOut'),
        runInlineRunDispatchFailure: answer('runInlineRunDispatchFailure'),
        recordInlineRunAttribution: (cwd: string, runId: string, entry: unknown) => {
            calls.push(['recordInlineRunAttribution', { cwd, runId, entry }]);
            if (behaviour.boom !== undefined) throw new Error(behaviour.boom);
        },
    } as unknown as Awaited<ReturnType<NonNullable<WorkflowInlineDeps['loadApp']>>>;
}

interface Run {
    code: number;
    out: string[];
    err: string[];
    calls: Calls;
}

/** Drive `main()` (the early dispatch) inside a scratch cwd with the stub app. */
async function inline(
    args: string[],
    behaviour: Parameters<typeof stubApp>[1] = {},
    extra: { env?: Record<string, string>; deps?: Partial<WorkflowInlineDeps> } = {},
): Promise<Run> {
    const cwd = mkdtempSync(join(tmpdir(), 'spur-wf-inline-'));
    const previous = process.cwd();
    process.chdir(cwd);
    const calls: Calls = [];
    const out: string[] = [];
    const err: string[] = [];
    try {
        const code = await main(['workflow', 'inline', ...args], {
            cwd,
            env: { SPUR_SKIP_GLOBAL_CONFIG: 'true', ...extra.env },
            output: { write: (m) => out.push(m), error: (m) => err.push(m) },
            workflowTransport: {
                loadApp: async () => stubApp(calls, behaviour),
                selfArgv: ['spur-self'],
                ...extra.deps,
            },
        });
        // The transports never boot the CLI database in the cwd.
        expect(existsSync(join(cwd, '.spur', 'spur.db'))).toBe(false);
        return { code, out, err, calls };
    } finally {
        process.chdir(previous);
        rmSync(cwd, { recursive: true, force: true });
    }
}

const names = (r: Run): string[] => r.calls.map(([name]) => name);
const input = (r: Run, name: string): Record<string, unknown> =>
    (r.calls.find(([n]) => n === name)?.[1] ?? {}) as Record<string, unknown>;
const UNSAFE = 'inline-run-setup: refusing unsafe run id: ../x';

describe('spur workflow inline begin', () => {
    test('resolves the definition through the running spur and creates the run', async () => {
        const r = await inline(['begin', '--run-id', 'r1', '--file', 'wf.yaml']);
        expect(r.code).toBe(0);
        expect(names(r)).toEqual(['readInstalledInventory', 'runInlineRunSetup']);
        expect(input(r, 'readInstalledInventory')).toMatchObject({
            file: 'wf.yaml',
            spurBin: '',
            launchArgv: ['spur-self'],
        });
        expect(input(r, 'runInlineRunSetup')).toMatchObject({
            runId: 'r1',
            file: 'wf.yaml',
            inventory: { inventory: true },
        });
        expect(input(r, 'runInlineRunSetup').embeddedSchemas).toBeDefined();
    });

    test('--spur-bin beats SPUR_BIN, which beats the running spur', async () => {
        const env = { SPUR_BIN: 'from-env' };
        const viaEnv = await inline(['begin', '--run-id', 'r1', '--file', 'f'], {}, { env });
        expect(input(viaEnv, 'readInstalledInventory').spurBin).toBe('from-env');
        const viaFlag = await inline(['begin', '--run-id', 'r1', '--file', 'f', '--spur-bin', 'flag'], {}, { env });
        expect(input(viaFlag, 'readInstalledInventory').spurBin).toBe('flag');
    });

    test('a definition that cannot resolve records the failure and exits 1', async () => {
        const r = await inline(['begin', '--run-id', 'r1', '--file', 'f'], { inventoryError: 'nope' });
        expect(r.code).toBe(1);
        expect(input(r, 'writeInlineRunOutcome')).toEqual({
            runId: 'r1',
            outcome: { ok: false, runId: 'r1', error: 'could not resolve the workflow definition: nope' },
        });
        expect(r.err).toEqual(['inline-run-setup: FAIL — could not resolve the workflow definition: nope']);
    });

    test('missing flags are usage (exit 2); an unsafe id refuses (exit 1) before any work', async () => {
        const usage = await inline(['begin', '--run-id', 'r1']);
        expect(usage.code).toBe(2);
        expect(usage.err.join('\n')).toContain('Usage: spur workflow inline begin');
        const unsafe = await inline(['begin', '--run-id', '../x', '--file', 'f']);
        expect([unsafe.code, unsafe.err[0], unsafe.calls]).toEqual([1, UNSAFE, []]);
    });

    test('a Commander parse error (unknown flag) is a usage error, exit 2; --help exits 0', async () => {
        expect((await inline(['begin', '--bogus'])).code).toBe(2);
        expect((await inline(['--help'])).code).toBe(0);
    });
});

describe('spur workflow inline fingerprint / persist-out / decide', () => {
    test('fingerprint passes the spec files through; a missing --task-file is usage', async () => {
        const r = await inline(['fingerprint', '--task-file', 't.md', '--feature-file', 'f.md'], { code: 0 });
        expect([r.code, input(r, 'runInlineRunFingerprint')]).toEqual([0, { taskFile: 't.md', featureFile: 'f.md' }]);
        const bare = await inline(['fingerprint', '--task-file', 't.md']);
        expect(input(bare, 'runInlineRunFingerprint')).toEqual({ taskFile: 't.md', featureFile: '' });
        expect((await inline(['fingerprint'])).code).toBe(2);
    });

    test('persist-out collects repeatable task files; a blank one is usage', async () => {
        const r = await inline(['persist-out', '--from', 'wt', '--task-file', 'a.md', '--task-file', 'b.md'], {
            code: 1,
        });
        expect([r.code, input(r, 'runInlineRunPersistOut')]).toEqual([1, { from: 'wt', taskFiles: ['a.md', 'b.md'] }]);
        expect((await inline(['persist-out', '--from', 'wt', '--task-file', ' '])).code).toBe(2);
        expect((await inline(['persist-out'])).code).toBe(2);
        // `--run-id` belongs to persist-check only (1089 driver note).
        expect((await inline(['persist-out', '--from', 'wt', '--run-id', 'r1'])).code).toBe(2);
    });

    test('decide threads the loaded config and its decideDecisionMaker switch', async () => {
        const config = { workflows: { decideDecisionMaker: true } } as unknown as SpurConfig;
        const r = await inline(
            ['decide', '--run-id', 'r1', '--node', 'triage', '--options-json', 'o.json'],
            {},
            { deps: { loadConfig: async () => config } },
        );
        expect(r.code).toBe(0);
        expect(input(r, 'runInlineRunDecide')).toEqual({
            runId: 'r1',
            node: 'triage',
            optionsFile: 'o.json',
            enabled: true,
            spurConfig: config,
        });
        const off = await inline(
            ['decide', '--run-id', 'r1', '--node', 'n', '--options-json', 'o'],
            {},
            {
                deps: { loadConfig: async () => ({}) as SpurConfig },
            },
        );
        expect(input(off, 'runInlineRunDecide').enabled).toBe(false);
    });

    test('decide failures print the JSON verdict and exit 1; bad argv is usage or refusal', async () => {
        const r = await inline(['decide', '--run-id', 'r1', '--node', 'n', '--options-json', 'o'], {
            boom: 'bad config',
        });
        expect([r.code, r.out]).toEqual([1, ['{"ok":false,"runId":"r1","error":"bad config"}']]);
        expect((await inline(['decide', '--run-id', 'r1', '--node', 'n'])).code).toBe(2);
        const unsafe = await inline(['decide', '--run-id', '../x', '--node', 'n', '--options-json', 'o']);
        expect([unsafe.code, unsafe.err[0]]).toEqual([1, UNSAFE]);
    });

    test('the live loader reads the project config (no project file → defaults)', async () => {
        const r = await inline(['decide', '--run-id', 'r1', '--node', 'n', '--options-json', 'o'], {}, { deps: {} });
        // `deps.loadConfig` is not overridden here, so the transport's real loader ran.
        expect([r.code, input(r, 'runInlineRunDecide').enabled]).toEqual([0, false]);
    });
});

describe('spur workflow inline trace ops', () => {
    test('action forwards every flag to the trace dispatcher', async () => {
        const r = await inline([
            'action',
            '--run-id',
            'r1',
            '--node',
            'implement',
            '--kind',
            'shell',
            '--status',
            'done',
            '--ok',
            'true',
            '--duration-ms',
            '12',
            '--estimated',
            '--project-root',
            '/tree',
        ]);
        expect(r.code).toBe(0);
        expect(input(r, 'runInlineRunTraceMode')).toMatchObject({
            mode: 'action',
            runId: 'r1',
            node: 'implement',
            kind: 'shell',
            status: 'done',
            ok: 'true',
            durationMs: '12',
            projectRoot: '/tree',
            estimated: true,
            noSummary: false,
        });
    });

    test('node-enter, actions and close map onto their modes', async () => {
        const enter = await inline(['node-enter', '--run-id', 'r1', '--node', 'n']);
        expect(input(enter, 'runInlineRunTraceMode')).toMatchObject({
            mode: 'node-enter',
            node: 'n',
            estimated: false,
        });
        const batch = await inline(['actions', '--run-id', 'r1', '--file', 'a.json']);
        expect(input(batch, 'runInlineRunTraceMode')).toMatchObject({ mode: 'actions-file', actionsFile: 'a.json' });
        const close = await inline(['close', '--run-id', 'r1', '--status', 'failed', '--reason', 'failed-check']);
        expect(input(close, 'runInlineRunTraceMode')).toMatchObject({
            mode: 'close',
            status: 'failed',
            reason: 'failed-check',
        });
        // Without --no-summary the close summarizes; with no transcript that is the n/a file.
        expect(close.calls.find(([n]) => n === 'summary')?.[1]).toBe(join('.spur', 'run', 'r1-summary.md'));
    });

    test('--no-summary skips the summarizer', async () => {
        const r = await inline(['close', '--run-id', 'r1', '--status', 'done', '--no-summary']);
        expect(input(r, 'runInlineRunTraceMode')).toMatchObject({ noSummary: true });
        expect(names(r)).not.toContain('summary');
        expect('summarize' in input(r, 'runInlineRunTraceMode')).toBe(false);
    });

    test('a dispatcher 2 is usage (help on stderr); 1 passes through; a throw is FAIL', async () => {
        const usage = await inline(['action', '--run-id', 'r1'], { code: 2 });
        expect(usage.code).toBe(2);
        expect(usage.err.join('\n')).toContain('Usage: spur workflow inline action');
        expect((await inline(['node-enter', '--run-id', 'r1'], { code: 1 })).code).toBe(1);
        const boom = await inline(['close', '--run-id', 'r1', '--status', 'done'], { boom: 'db gone' });
        expect([boom.code, boom.err]).toEqual([1, ['inline-run-setup: FAIL — db gone']]);
    });

    test('an unsafe or missing run id refuses before the dispatcher runs', async () => {
        const r = await inline(['action', '--run-id', '../x']);
        expect([r.code, r.err[0], r.calls]).toEqual([1, UNSAFE, []]);
        expect((await inline(['close'])).err[0]).toBe('inline-run-setup: refusing unsafe run id: ');
    });
});

describe('spur workflow inline attribution / dispatch-failure', () => {
    test('attribution records the identity (empty executor → explicit null marker)', async () => {
        const r = await inline([
            'attribution',
            '--run-id',
            'r1',
            '--stage',
            'implement',
            '--executor',
            'codex',
            '--model',
            'm',
        ]);
        expect([r.code, r.out]).toEqual([0, ['{"ok":true,"runId":"r1","stage":"implement"}']]);
        expect(input(r, 'recordInlineRunAttribution')).toMatchObject({
            runId: 'r1',
            entry: { stage: 'implement', executor: 'codex', agent: null, model: 'm' },
        });
        const none = await inline(['attribution', '--run-id', 'r1', '--stage', 's', '--executor', ' ']);
        expect(input(none, 'recordInlineRunAttribution')).toMatchObject({ entry: { executor: null } });
        expect('model' in (input(none, 'recordInlineRunAttribution').entry as object)).toBe(false);
    });

    test('attribution: missing stage or unsafe id is usage; a throw is FAIL', async () => {
        expect((await inline(['attribution', '--run-id', 'r1'])).code).toBe(2);
        expect((await inline(['attribution', '--run-id', '../x', '--stage', 's'])).code).toBe(2);
        const boom = await inline(['attribution', '--run-id', 'r1', '--stage', 's'], { boom: 'disk full' });
        expect([boom.code, boom.err]).toEqual([1, ['inline-run-dispatch: FAIL — disk full']]);
    });

    test('dispatch-failure threads text or text-file plus the loaded config', async () => {
        const config = { agent: {} } as unknown as SpurConfig;
        const deps = { loadConfig: async () => config };
        const viaText = await inline(
            [
                'dispatch-failure',
                '--run-id',
                'r1',
                '--stage',
                's',
                '--decision',
                'stop',
                '--text',
                'quota',
                '--agent',
                'a',
            ],
            { code: 0 },
            { deps },
        );
        expect(viaText.code).toBe(0);
        expect(input(viaText, 'runInlineRunDispatchFailure')).toEqual({
            runId: 'r1',
            stage: 's',
            decision: 'stop',
            text: 'quota',
            executor: null,
            agent: 'a',
            spurConfig: config,
        });
        const viaFile = await inline(
            ['dispatch-failure', '--run-id', 'r1', '--stage', 's', '--decision', 'escalate', '--text-file', 'f.txt'],
            { code: 1 },
            { deps },
        );
        expect([viaFile.code, input(viaFile, 'runInlineRunDispatchFailure').textFile]).toEqual([1, 'f.txt']);
    });

    test('dispatch-failure: exactly one of --text / --text-file, a decision and a safe id', async () => {
        const base = ['dispatch-failure', '--run-id', 'r1', '--stage', 's'];
        expect((await inline([...base, '--decision', 'stop'])).code).toBe(2);
        expect((await inline([...base, '--decision', 'stop', '--text', 'a', '--text-file', 'b'])).code).toBe(2);
        expect((await inline([...base, '--text', 'a'])).code).toBe(2);
        expect((await inline(['dispatch-failure', '--run-id', '../x', '--stage', 's'])).code).toBe(2);
    });
});

describe('spur workflow inline persist-check', () => {
    test('runs in-process against the trees and keeps the script exit codes', async () => {
        const usage = await inline(['persist-check']);
        expect(usage.code).toBe(2);
        expect(usage.err[0]).toContain('usage: spur workflow inline persist-check');
        const dir = mkdtempSync(join(tmpdir(), 'spur-wf-persist-check-'));
        try {
            const r = await inline([
                'persist-check',
                '--from',
                dir,
                '--task-file',
                '/t/1058_a.md',
                '--root',
                dir,
                '--success-json',
                join(dir, 'none.json'),
            ]);
            expect(r.code).toBe(0);
            expect(r.out.join('\n')).toContain('persist-out-check: ok');
            const runs = await inline(['persist-check', '--from', dir, '--run-id', 'r1', '--run-id', 'r2']);
            expect(runs.code).toBe(0);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('registerWorkflowInlineCommand defaults', () => {
    test('without deps it uses the context config and the app barrel', async () => {
        let exitCode = 0;
        const program = new Command().exitOverride();
        program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
        registerWorkflowInlineCommand(program.command('workflow'), {
            cwd: process.cwd(),
            env: {},
            output: { write: () => {}, error: () => {} },
            setExitCode: (code) => {
                exitCode = code;
            },
            spurConfig: { workflows: { decideDecisionMaker: false } } as unknown as SpurConfig,
        });
        const cwd = mkdtempSync(join(tmpdir(), 'spur-wf-inline-defaults-'));
        const previous = process.cwd();
        process.chdir(cwd);
        const stdout = spyOn(process.stdout, 'write').mockImplementation(() => true);
        try {
            // A real decide with no options file and no run row: the app fails closed (exit 1).
            await program.parseAsync(
                ['workflow', 'inline', 'decide', '--run-id', 'r1', '--node', 'n', '--options-json', 'missing.json'],
                {
                    from: 'user',
                },
            );
            expect(exitCode).toBe(1);
            // Without any config on the context the default loader yields an empty config.
            const bare = new Command().exitOverride();
            registerWorkflowInlineCommand(bare.command('workflow'), {
                cwd,
                env: {},
                output: { write: () => {}, error: () => {} },
                setExitCode: (code) => {
                    exitCode = code;
                },
            });
            await bare.parseAsync(
                ['workflow', 'inline', 'decide', '--run-id', 'r2', '--node', 'n', '--options-json', 'missing.json'],
                {
                    from: 'user',
                },
            );
            expect(exitCode).toBe(1);
            const verdicts = stdout.mock.calls.map(([chunk]) => JSON.parse(String(chunk)));
            expect(verdicts).toEqual(
                ['r1', 'r2'].map((runId) => ({
                    ok: false,
                    runId,
                    error: expect.stringContaining('decide: unreadable options file missing.json:'),
                })),
            );
        } finally {
            stdout.mockRestore();
            process.chdir(previous);
            rmSync(cwd, { recursive: true, force: true });
        }
    });
});
