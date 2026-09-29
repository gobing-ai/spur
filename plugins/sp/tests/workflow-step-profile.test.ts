/**
 * workflow-step-profile script contract (task 0827, feature I21; task 1005 R1/R4).
 *
 * The builder-level cases moved to packages/app/tests/workflow/step-profile.test.ts; this suite
 * keeps the thin script pins — argv parsing, CLI exit codes and `main`'s stdout/stderr contract
 * against a canned spur stub (the idea-handoff script-test pattern for ADR-065 glue over the
 * generated lib bundle `plugins/sp/lib/step-profile.generated.mjs`).
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVar, getEnvVars, removeEnvVar, setEnvVar } from '@gobing-ai/ts-utils';
import {
    type ActionCostAttributionLike,
    buildStepProfile,
    defaultSpurBin,
    formatStepProfileHuman,
    main,
    parseStepProfileCliArgs,
    runStepProfileCli,
    STEP_PROFILE_USAGE,
    type StepProfileRow,
    type StepProfileRun,
    type TraceActionEvent,
} from '../scripts/workflow-step-profile';

const SCRIPT = join(import.meta.dir, '..', 'scripts', 'workflow-step-profile.ts');
const T0 = Date.parse('2026-09-11T10:00:00.000Z');

function at(sec: number): string {
    return new Date(T0 + sec * 1000).toISOString();
}

interface ActionSpec {
    node: string;
    actionKind: string;
    startSec: number;
    endSec: number;
    invocation?: Record<string, string | number | boolean> | null;
    /** `undefined` = the executor computed no cost attribution at all (live `cost` absent). */
    cost?: ActionCostAttributionLike | null;
}

function actionEvent(spec: ActionSpec): TraceActionEvent {
    return {
        kind: 'action',
        node: spec.node,
        actionKind: spec.actionKind,
        durationMs: (spec.endSec - spec.startSec) * 1000,
        startedAt: at(spec.startSec),
        completedAt: at(spec.endSec),
        invocation: spec.invocation ?? null,
        cost: spec.cost === undefined ? null : spec.cost,
    };
}

/** A run carries non-action events too; only `kind: 'action'` is evidence. */
const PHASE_EVENT: TraceActionEvent = { kind: 'phase' };

function run(runId: string, actions: ActionSpec[]): StepProfileRun {
    return { runId, events: [PHASE_EVENT, ...actions.map(actionEvent)] };
}

function cost(cacheHit: number | null, estimatedHit?: number): ActionCostAttributionLike {
    return {
        exact: cacheHit === null ? null : { cacheHit },
        estimated: estimatedHit === undefined ? null : { cacheHit: estimatedHit },
    };
}

function rowFor(rows: StepProfileRow[], node: string, actionKind: string): StepProfileRow {
    const row = rows.find((r) => r.node === node && r.actionKind === actionKind);
    if (row === undefined) throw new Error(`no row for ${node}/${actionKind}`);
    return row;
}

// ── fixtures: three runs, one node executed twice in run A ──────────────────────────────

const AGENT_FRESH: ActionSpec = {
    node: 'implement',
    actionKind: 'agent.run',
    startSec: 0,
    endSec: 20,
    invocation: { continue: false, skill: 'sp:super-coder' },
    cost: cost(0.8),
};
const AGENT_RESUMED: ActionSpec = {
    node: 'implement',
    actionKind: 'agent.run',
    startSec: 30,
    endSec: 34,
    invocation: { continue: true },
    // `estimated` is retroactive evidence and must never mix into the reported cacheHit.
    cost: cost(0.4, 0.0),
};

const RUNS: StepProfileRun[] = [
    run('run-a', [AGENT_FRESH, { node: 'test', actionKind: 'shell', startSec: 25, endSec: 28 }, AGENT_RESUMED]),
    run('run-b', [
        {
            node: 'implement',
            actionKind: 'agent.run',
            startSec: 0,
            endSec: 30,
            invocation: { continue: true },
            cost: cost(0.2),
        },
        { node: 'test', actionKind: 'shell', startSec: 30, endSec: 31 },
    ]),
    // Old event: no `invocation` recorded at all → session unknown, never "fresh".
    run('run-c', [
        {
            node: 'implement',
            actionKind: 'agent.run',
            startSec: 0,
            endSec: 1,
            invocation: null,
            cost: cost(null),
        },
    ]),
];

const PROFILE = buildStepProfile({ workflow: 'idea-pipeline', windowSec: 300, runs: RUNS });

// ── CLI contract ───────────────────────────────────────────────────────────────────────

describe('task 0827 R1 — CLI flags, defaults and exit codes', () => {
    test('defaults are last 20 runs and a 300 s window', () => {
        const args = parseStepProfileCliArgs(['idea-pipeline']);
        expect(args).toMatchObject({ workflow: 'idea-pipeline', last: 20, windowSec: 300, json: false, help: false });
        expect(typeof args.spurBin).toBe('string');
    });

    test('--last, --window, --json and --spur-bin are parsed', () => {
        const args = parseStepProfileCliArgs([
            'idea-pipeline',
            '--last',
            '5',
            '--window',
            '600',
            '--json',
            '--spur-bin',
            '/x/spur',
        ]);
        expect(args).toMatchObject({
            workflow: 'idea-pipeline',
            last: 5,
            windowSec: 600,
            json: true,
            spurBin: '/x/spur',
        });
    });

    test('--help prints usage and exits 0', () => {
        const out = runStepProfileCli(['--help']);
        expect(out.exitCode).toBe(0);
        expect(out.stdout).toContain(STEP_PROFILE_USAGE);
    });

    test('a missing workflow argument exits 1 with a stderr message', () => {
        const out = runStepProfileCli(['--json']);
        expect(out.exitCode).toBe(1);
        expect(out.stderr).toContain('workflow');
        expect(out.stdout).toBe('');
    });

    test('an unparsable spur response exits 1 with a stderr message', () => {
        const out = runStepProfileCli(['idea-pipeline', '--spur-bin', 'true']);
        expect(out.exitCode).toBe(1);
        expect(out.stderr).toContain('workflow-step-profile');
    });

    test('defaultSpurBin resolves SPUR_BIN before the monorepo entry and PATH', () => {
        const previous = getEnvVar('SPUR_BIN');
        setEnvVar('SPUR_BIN', '/custom/spur');
        try {
            expect(defaultSpurBin()).toBe('/custom/spur');
        } finally {
            if (previous === undefined) removeEnvVar('SPUR_BIN');
            else setEnvVar('SPUR_BIN', previous);
        }
    });

    test('human output is one line per row: one-decimal seconds and ? for unknown', () => {
        const text = formatStepProfileHuman(PROFILE);
        const lines = text.trimEnd().split('\n');
        expect(lines).toHaveLength(1 + PROFILE.rows.length);
        expect(text).toContain('implement');
        expect(text).toContain('4.0s');
        expect(text).toContain('30.0s');
        // `test/shell` has one measured idle gap of 0.0s and no cache evidence at all.
        expect(text).toContain('0.0s');
        expect(text).toContain('0.40 (3/4)');
        expect(text).toContain('? (0/2)');
    });
});

// ── end to end: main against a canned spur stub ─────────────────────────────────────────

const SCRATCH = mkdtempSync(join(tmpdir(), 'workflow-step-profile-'));
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

const STUB = `#!/bin/bash
if [ "$1 $2" != "workflow trace" ]; then echo "stub: unsupported: $*" >&2; exit 64; fi
case "$3" in
  --workflow) cat "$STUB_DIR/list.json" ;;
  run-a) cat "$STUB_DIR/run-a.json" ;;
  *) echo "stub: unknown run: $3" >&2; exit 65 ;;
esac
`;

function installStub(name: string, body: string): string {
    const path = join(SCRATCH, name);
    writeFileSync(path, body, { mode: 0o755 });
    return path;
}

function spawnScript(stub: string): { exitCode: number; stdout: string; stderr: string } {
    const proc = Bun.spawnSync(['bun', SCRIPT, 'idea-pipeline', '--json', '--spur-bin', stub], {
        cwd: SCRATCH,
        env: { ...getEnvVars(), STUB_DIR: SCRATCH },
        stdout: 'pipe',
        stderr: 'pipe',
    });
    return { exitCode: proc.exitCode ?? -1, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

describe('task 0827 R1 — main runs end to end against a spur stub', () => {
    test('canned list + per-run JSON parse into a profile, dry entries dropped', () => {
        mkdirSync(SCRATCH, { recursive: true });
        writeFileSync(
            join(SCRATCH, 'list.json'),
            JSON.stringify({
                entries: [
                    { runId: 'run-a', workflowName: 'idea-pipeline', status: 'done', isDryRun: false },
                    { runId: 'run-dry', workflowName: 'idea-pipeline', status: 'done', isDryRun: true },
                ],
                total: 2,
            }),
        );
        writeFileSync(
            join(SCRATCH, 'run-a.json'),
            JSON.stringify({
                run: { runId: 'run-a', workflowName: 'idea-pipeline', status: 'done', isDryRun: false },
                events: [
                    { kind: 'phase', phase: 'implement', status: 'done', startedAt: at(0), completedAt: at(20) },
                    {
                        kind: 'action',
                        actionId: 'a1',
                        node: 'implement',
                        actionKind: 'agent.run',
                        status: 'done',
                        durationMs: 20000,
                        startedAt: at(0),
                        completedAt: at(20),
                        invocation: { continue: true },
                        cost: { exact: { totals: {}, cacheHit: 0.3, estimated: false }, estimated: null },
                    },
                ],
            }),
        );
        const out = spawnScript(installStub('spur-stub', STUB));
        expect(out.stderr).toBe('');
        expect(out.exitCode).toBe(0);
        const profile = JSON.parse(out.stdout) as {
            workflow: string;
            windowSec: number;
            sampledRuns: number;
            rows: StepProfileRow[];
        };
        expect(profile.workflow).toBe('idea-pipeline');
        expect(profile.windowSec).toBe(300);
        expect(profile.sampledRuns).toBe(1);
        expect(profile.rows.map((r) => `${r.node}/${r.actionKind}`)).toEqual(['implement/agent.run']);
        expect(profile.rows[0]?.cacheHit).toEqual({ p50: 0.3, known: 1, of: 1 });
        expect(profile.rows[0]?.flags).toEqual(['resume-cold-cache']);
    });

    test('a failing spur stub exits 1 with a stderr message and no stdout profile', () => {
        const failing = installStub('spur-failing', '#!/bin/bash\necho "stub: boom" >&2\nexit 3\n');
        const out = spawnScript(failing);
        expect(out.exitCode).toBe(1);
        expect(out.stdout).toBe('');
        expect(out.stderr).toContain('workflow-step-profile');
    });
});

// ── in-process I/O layer: runStepProfileCli + main against a spur stub ──────────────────
//
// The group above spawns the script, so its lines count against the child process, not this
// one. These cases drive the same list → per-run timeline loop inside this process (temp-dir
// stub scripts, no spawn mocking) so the success path, the two failure branches and `main`'s
// stdout/stderr writes are exercised here.

/** Capture stdout/stderr.write during a callback. */
function captureOutput<T>(fn: () => T): { out: string; err: string; result: T } {
    const realOut = process.stdout.write.bind(process.stdout);
    const realErr = process.stderr.write.bind(process.stderr);
    let out = '';
    let err = '';
    process.stdout.write = ((s: string) => {
        out += s;
        return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((s: string) => {
        err += s;
        return true;
    }) as typeof process.stderr.write;
    try {
        const result = fn();
        return { out, err, result };
    } finally {
        process.stdout.write = realOut;
        process.stderr.write = realErr;
    }
}

const IO_LIST = join(SCRATCH, 'io-list.json');
const IO_RUN_A = join(SCRATCH, 'io-run-a.json');

/** Canned `spur workflow trace`: the run list for `--workflow`, one timeline for `run-a`. */
function ioStubBody(): string {
    return `#!/bin/bash
if [ "$1 $2" != "workflow trace" ]; then echo "stub: unsupported: $*" >&2; exit 64; fi
case "$3" in
  --workflow) cat "${IO_LIST}" ;;
  run-a) cat "${IO_RUN_A}" ;;
  *) echo "stub: unknown run: $3" >&2; exit 65 ;;
esac
`;
}

function writeIoFixtures(): void {
    mkdirSync(SCRATCH, { recursive: true });
    writeFileSync(
        IO_LIST,
        JSON.stringify({
            entries: [
                { runId: 'run-a', workflowName: 'idea-pipeline', status: 'done', isDryRun: false },
                { runId: 'run-dry', workflowName: 'idea-pipeline', status: 'done', isDryRun: true },
            ],
            total: 2,
        }),
    );
    writeFileSync(
        IO_RUN_A,
        JSON.stringify({
            run: { runId: 'run-a', workflowName: 'idea-pipeline', status: 'done' },
            events: [
                { kind: 'phase', phase: 'implement', status: 'done' },
                {
                    kind: 'action',
                    node: 'implement',
                    actionKind: 'agent.run',
                    durationMs: 20000,
                    startedAt: at(0),
                    completedAt: at(20),
                    invocation: { continue: true },
                    cost: { exact: { cacheHit: 0.3 }, estimated: null },
                },
            ],
        }),
    );
}

/** Stub that serves the run list, then plays `body` for the per-run timeline call. */
function timelineStub(name: string, body: string): string {
    return installStub(
        name,
        `#!/bin/bash
if [ "$1 $2" != "workflow trace" ]; then echo "stub: unsupported: $*" >&2; exit 64; fi
if [ "$3" = "--workflow" ]; then cat "${IO_LIST}"; exit 0; fi
${body}`,
    );
}

describe('task 0827 R1 — runStepProfileCli and main against a spur stub (in process)', () => {
    test('the run list plus each non-dry timeline is sampled into a human profile', () => {
        writeIoFixtures();
        const stub = installStub('io-stub', ioStubBody());
        const out = runStepProfileCli(['idea-pipeline', '--spur-bin', stub]);
        expect(out.exitCode).toBe(0);
        expect(out.stderr).toBe('');
        expect(out.stdout).toContain('step profile — idea-pipeline (window 300s, 1 sampled runs)');
        expect(out.stdout).toContain('implement');
        expect(out.stdout).toContain('20.0s');
        expect(out.stdout).toContain('cacheHit=0.30 (1/1)');
    });

    test('--json emits the profile envelope the doctor consumes', () => {
        writeIoFixtures();
        const stub = installStub('io-stub-json', ioStubBody());
        const out = runStepProfileCli(['idea-pipeline', '--json', '--spur-bin', stub]);
        expect(out.exitCode).toBe(0);
        expect(out.stderr).toBe('');
        const profile = JSON.parse(out.stdout) as { sampledRuns: number; rows: StepProfileRow[] };
        expect(profile.sampledRuns).toBe(1);
        expect(rowFor(profile.rows, 'implement', 'agent.run')).toMatchObject({
            executions: 1,
            session: 'resumed',
            cacheHit: { p50: 0.3, known: 1, of: 1 },
            flags: ['resume-cold-cache'],
        });
    });

    test('a failing timeline call exits 1 naming the command and the last stderr line', () => {
        writeIoFixtures();
        const stub = timelineStub('io-stub-run-fails', 'echo "stub: timeline exploded" >&2\nexit 7\n');
        const out = runStepProfileCli(['idea-pipeline', '--spur-bin', stub]);
        expect(out.exitCode).toBe(1);
        expect(out.stdout).toBe('');
        expect(out.stderr).toContain('spur workflow trace run-a --json failed (exit 7: stub: timeline exploded)');
        expect(out.stderr).toContain(stub);
    });

    test('a spur binary that cannot spawn at all exits 1 naming the command (task 1005 R4)', () => {
        writeIoFixtures();
        const out = runStepProfileCli(['idea-pipeline', '--spur-bin', join(SCRATCH, 'no-such-spur-bin')]);
        expect(out.exitCode).toBe(1);
        expect(out.stdout).toBe('');
        expect(out.stderr).toContain('spur workflow trace --workflow idea-pipeline');
        expect(out.stderr).toContain('no-such-spur-bin');
    });

    test('a failure with no stderr detail still reports the command and exit code', () => {
        writeIoFixtures();
        const out = runStepProfileCli(['idea-pipeline', '--spur-bin', timelineStub('io-stub-silent', 'exit 9\n')]);
        expect(out.exitCode).toBe(1);
        expect(out.stderr).toContain('spur workflow trace run-a --json failed (exit 9)');
        expect(out.stderr).not.toContain('(exit 9:');
    });

    test('a timeline that is not JSON exits 1 and names the run', () => {
        writeIoFixtures();
        const out = runStepProfileCli([
            'idea-pipeline',
            '--spur-bin',
            timelineStub('io-stub-bad-json', 'echo "not json"\nexit 0\n'),
        ]);
        expect(out.exitCode).toBe(1);
        expect(out.stdout).toBe('');
        expect(out.stderr).toContain('spur workflow trace run-a output did not parse as JSON');
    });

    test('main writes the profile to stdout and returns 0', () => {
        writeIoFixtures();
        const stub = installStub('io-stub-main', ioStubBody());
        const { out, err, result } = captureOutput(() => main(['idea-pipeline', '--json', '--spur-bin', stub]));
        expect(result).toBe(0);
        expect(err).toBe('');
        expect(JSON.parse(out).workflow).toBe('idea-pipeline');
    });

    test('main writes the failure to stderr with a trailing newline and returns 1', () => {
        const { out, err, result } = captureOutput(() => main(['--json']));
        expect(result).toBe(1);
        expect(out).toBe('');
        expect(err.endsWith('\n')).toBe(true);
        expect(err).toContain('workflow-step-profile: a workflow name is required');
    });
});
