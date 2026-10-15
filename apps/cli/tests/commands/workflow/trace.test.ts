/**
 * Thin-wrapper integration tests for `spur workflow trace` (apps/cli/src/commands/workflow/trace.ts).
 * Behavioral tests for WorkflowAppService live in packages/app/tests/services/workflow-service.test.ts.
 */
import { beforeEach, describe, expect, test } from 'bun:test';
import { appendFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
    _resetAgentServiceShimsForTest,
    type TimelineActionDecision,
    type TimelineEvent,
    type WorkflowTraceTimeline,
} from '@gobing-ai/spur-app';
import type { ActionCost, ActionCostAttribution } from '@gobing-ai/spur-domain';
import { createMigratedDb } from '@gobing-ai/spur-domain';
import { followRunLog, followTrace, formatActionCost, formatTraceTimeline } from '../../../src/commands/workflow';
import { main } from '../../../src/index';
import type { CommandOutput } from '../../../src/output';
import { createCapturedOutput, createTempProject } from '../../helpers';

// Warn-once shim markers (bare-binary, legacy executor) are process-global; bun
// batches test files per worker process — never inherit another file's state.
beforeEach(() => {
    _resetAgentServiceShimsForTest();
});

const ACTION_WORKFLOW_YAML = `name: cli-action-flow
kind: state-machine
initialState: start
states:
  - id: start
    onEnter:
      - kind: note
        options:
          message: trace me
  - id: done
transitions:
  - from: start
    to: done
terminalStates:
  - done
`;

function nullOutput(): CommandOutput {
    return { write: () => {}, error: () => {} };
}

// ---------------------------------------------------------------------------
// Trace cost rendering (task 0311) — formatActionCost / formatTraceTimeline.
// These are pure presentation helpers; unit-tested directly since producing a
// real agent.run row requires spawning an agent.
// ---------------------------------------------------------------------------

function makeCost(overrides: Partial<ActionCost> = {}): ActionCost {
    return {
        totals: {
            inputTokens: 12500,
            outputTokens: 3200,
            cacheReadTokens: 2000,
            cacheWriteTokens: 500,
            costUsd: 0,
            records: 1,
            recordsWithUsage: 1,
            messages: 1,
            toolCalls: 0,
            durationMs: 0,
            durationUnmeasured: 0,
        },
        cacheHit: 0.25,
        estimated: false,
        ...overrides,
    };
}

const UNJOINED_COST: ActionCostAttribution = {
    exact: null,
    estimated: null,
};

function makeActionEvent(cost?: ActionCostAttribution): TimelineEvent {
    return {
        kind: 'action',
        actionId: 'act-1',
        node: 'n1',
        actionKind: 'agent.run',
        status: 'done',
        duration: '120ms',
        durationMs: 120,
        startedAt: '2026-01-15T10:00:00.000Z',
        completedAt: '2026-01-15T10:00:00.120Z',
        ok: true,
        outcome: 'success',
        result: null,
        invocation: null,
        error: null,
        artifacts: [],
        label: ' ✓',
        cost,
    };
}

describe('workflow command (main)', () => {
    test('trace subcommand (json) returns 0', async () => {
        const exitCode = await main(['workflow', 'trace', '--json'], { output: nullOutput(), dbUrl: ':memory:' });
        expect(exitCode).toBe(0);
    });
    test('trace subcommand (plain) shows empty run list', async () => {
        const lines: string[] = [];
        const exitCode = await main(['workflow', 'trace'], {
            output: { write: (m) => lines.push(m), error: () => {} },
            dbUrl: ':memory:',
        });
        expect(exitCode).toBe(0);
        expect(lines).toContain('No workflow runs.');
    });
    test('trace subcommand rejects invalid --last', async () => {
        const exitCode = await main(['workflow', 'trace', '--last', '0'], { output: nullOutput(), dbUrl: ':memory:' });
        expect(exitCode).toBe(1);
    });
    test('trace validates follow target, JSON compatibility, and poll interval', async () => {
        expect(await main(['workflow', 'trace', '--follow'], { output: nullOutput(), dbUrl: ':memory:' })).toBe(1);
        expect(
            await main(['workflow', 'trace', 'run-1', '--follow', '--json'], {
                output: nullOutput(),
                dbUrl: ':memory:',
            }),
        ).toBe(1);
        expect(
            await main(['workflow', 'trace', 'run-1', '--follow', '--poll', '10'], {
                output: nullOutput(),
                dbUrl: ':memory:',
            }),
        ).toBe(1);
    });
    test('0930 R2 — trace rejects --timeout without --follow (VALIDATION_FAILED)', async () => {
        const output = createCapturedOutput();
        expect(await main(['workflow', 'trace', 'run-1', '--timeout', '5000'], { output, dbUrl: ':memory:' })).toBe(1);
        expect(output.errors.join('')).toContain('--timeout requires --follow');

        const jsonOutput = createCapturedOutput();
        expect(
            await main(['workflow', 'trace', 'run-1', '--timeout', '5000', '--json', '--json-envelope'], {
                output: jsonOutput,
                dbUrl: ':memory:',
            }),
        ).toBe(1);
        expect(JSON.parse(jsonOutput.messages.at(-1) ?? '{}')).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    });
    test('0930 R2 — trace rejects a --timeout that is not a positive integer of milliseconds', async () => {
        for (const bad of ['0', '-5', 'abc', '1.5', '']) {
            const output = createCapturedOutput();
            // Omit --json: --follow --json is rejected first and would hide this guard.
            expect(
                await main(['workflow', 'trace', 'run-1', '--follow', '--timeout', bad], {
                    output,
                    dbUrl: ':memory:',
                }),
            ).toBe(1);
            expect(output.errors.join('')).toContain('--timeout must be a positive integer of milliseconds');
        }
    });
    test('trace subcommand rejects invalid --status', async () => {
        const exitCode = await main(['workflow', 'trace', '--status', 'bogus'], {
            output: nullOutput(),
            dbUrl: ':memory:',
        });
        expect(exitCode).toBe(1);
    });
    test('trace --output requires --follow and rejects --json', async () => {
        expect(
            await main(['workflow', 'trace', 'run-1', '--output'], { output: nullOutput(), dbUrl: ':memory:' }),
        ).toBe(1);
        expect(
            await main(['workflow', 'trace', 'run-1', '--follow', '--output', '--json'], {
                output: nullOutput(),
                dbUrl: ':memory:',
            }),
        ).toBe(1);
        // --follow --output without a run-id is rejected by the shared follow rule.
        expect(
            await main(['workflow', 'trace', '--follow', '--output'], { output: nullOutput(), dbUrl: ':memory:' }),
        ).toBe(1);
    });
    test('trace subcommand accepts --status done', async () => {
        const exitCode = await main(['workflow', 'trace', '--status', 'done'], {
            output: nullOutput(),
            dbUrl: ':memory:',
        });
        expect(exitCode).toBe(0);
    });
    test('trace subcommand (plain) lists runs and shows run-id timeline', async () => {
        const dir = await createTempProject();
        const wfDir = join(dir, '.spur', 'workflows');
        await mkdir(wfDir, { recursive: true });
        const workflowFile = join(wfDir, 'test.yaml');
        await writeFile(workflowFile, ACTION_WORKFLOW_YAML);
        const output = createCapturedOutput();
        const dbUrl = join(dir, '.spur', 'test.sqlite');

        await main(['workflow', 'run', '--run-id', 'trace-test-run', workflowFile], { output, cwd: dir, dbUrl });
        output.messages.length = 0;

        const exitCode = await main(['workflow', 'trace'], { output, cwd: dir, dbUrl });
        expect(exitCode).toBe(0);
        expect(output.messages.some((m) => m.includes('trace-test-run'))).toBe(true);
        expect(output.messages.some((m) => m.includes(dir.slice(dir.lastIndexOf('/') + 1)))).toBe(true);

        output.messages.length = 0;
        const exitCode2 = await main(['workflow', 'trace', 'trace-test-run'], { output, cwd: dir, dbUrl });
        expect(exitCode2).toBe(0);
        expect(output.messages.some((m) => m.includes('trace-test-run'))).toBe(true);
        expect(output.messages.some((m) => m.includes('note'))).toBe(true);
        expect(output.messages.some((m) => m.includes('Project:'))).toBe(true);
        expect(output.messages.some((m) => m.includes('started=') && m.includes('outcome='))).toBe(true);

        output.messages.length = 0;
        const jsonExit = await main(['workflow', 'trace', 'trace-test-run', '--json'], {
            output,
            cwd: dir,
            dbUrl,
        });
        expect(jsonExit).toBe(0);
        const trace = JSON.parse(output.messages.join('')) as WorkflowTraceTimeline;
        expect(trace.run.runId).toBe('trace-test-run');
        expect(trace.run.workflowName).toBe('cli-action-flow');
        expect(trace.run.project).toEqual({ name: dir.slice(dir.lastIndexOf('/') + 1), root: dir });
        expect(trace.run).toHaveProperty('durationMs');
        expect(trace.run).toHaveProperty('outcome');
        expect(trace.events.find((event) => event.kind === 'transition')).toMatchObject({
            from: 'start',
            to: 'done',
        });
        expect(trace.events.find((event) => event.kind === 'action')).toMatchObject({
            actionKind: 'note',
            startedAt: expect.any(String),
            completedAt: expect.any(String),
            outcome: 'success',
        });
        await rm(dir, { recursive: true, force: true });
    });
    test('trace --follow writes timeline for an already-terminal run and exits', async () => {
        const cwd = await createTempProject();
        const dbPath = join(cwd, '.spur', 'spur.db');
        await mkdir(join(cwd, '.spur'), { recursive: true });
        const db = await createMigratedDb({ url: dbPath });
        const now = Date.now();
        await db.run(
            'INSERT INTO runs (id, workflow_name, mode, status, started_at, completed_at, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            ['terminal-run-1', 'test-flow', 'sync', 'done', now, now, '{}', now, now],
        );
        db.close();

        const output = createCapturedOutput();
        const exitCode = await main(['workflow', 'trace', '--follow', 'terminal-run-1', '--poll', '50'], {
            output,
            cwd,
            dbUrl: dbPath,
        });

        expect(exitCode).toBe(0);
        expect(output.messages.length).toBeGreaterThan(0);
        await rm(cwd, { recursive: true, force: true });
    });
    test('trace --json surfaces the run terminal reason (cancel parity)', async () => {
        const cwd = await createTempProject();
        const dbPath = join(cwd, '.spur', 'spur.db');
        await mkdir(join(cwd, '.spur'), { recursive: true });
        const db = await createMigratedDb({ url: dbPath });
        const now = Date.now();
        await db.run(
            'INSERT INTO runs (id, workflow_name, mode, status, started_at, completed_at, terminal_reason, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            ['cancelled-run-1', 'test-flow', 'sync', 'failed', now, now, 'cancelled', '{}', now, now],
        );
        db.close();

        const output = createCapturedOutput();
        const exitCode = await main(['workflow', 'trace', 'cancelled-run-1', '--json'], {
            output,
            cwd,
            dbUrl: dbPath,
        });

        expect(exitCode).toBe(0);
        const parsed = JSON.parse(output.messages.at(-1) ?? '{}') as {
            run?: { status?: string; terminalReason?: string };
        };
        expect(parsed.run?.status).toBe('failed');
        expect(parsed.run?.terminalReason).toBe('cancelled');
        await rm(cwd, { recursive: true, force: true });
    });
    test('trace --follow --output emits no-log message for a terminal run without a log file', async () => {
        const cwd = await createTempProject();
        const dbPath = join(cwd, '.spur', 'spur.db');
        await mkdir(join(cwd, '.spur'), { recursive: true });
        const db = await createMigratedDb({ url: dbPath });
        const now = Date.now();
        await db.run(
            'INSERT INTO runs (id, workflow_name, mode, status, started_at, completed_at, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            ['terminal-run-2', 'test-flow', 'sync', 'done', now, now, '{}', now, now],
        );
        db.close();

        const output = createCapturedOutput();
        const exitCode = await main(['workflow', 'trace', '--follow', '--output', 'terminal-run-2', '--poll', '50'], {
            output,
            cwd,
            dbUrl: dbPath,
        });

        expect(exitCode).toBe(0);
        expect(output.messages.some((m) => m.includes('No run log') && m.includes('--no-log'))).toBe(true);
        await rm(cwd, { recursive: true, force: true });
    });
    test('0948 R6 — an empty legacy .log reports an empty record, not the --no-log hint', async () => {
        const cwd = await createTempProject();
        const dbPath = join(cwd, '.spur', 'spur.db');
        await mkdir(join(cwd, '.spur', 'run'), { recursive: true });
        await writeFile(join(cwd, '.spur', 'run', 'empty-legacy-run.log'), '');
        const db = await createMigratedDb({ url: dbPath });
        const now = Date.now();
        await db.run(
            'INSERT INTO runs (id, workflow_name, mode, status, started_at, completed_at, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            ['empty-legacy-run', 'test-flow', 'sync', 'done', now, now, '{}', now, now],
        );
        db.close();

        const output = createCapturedOutput();
        const exitCode = await main(['workflow', 'trace', '--follow', '--output', 'empty-legacy-run', '--poll', '50'], {
            output,
            cwd,
            dbUrl: dbPath,
        });

        expect(exitCode).toBe(0);
        expect(output.messages.some((m) => m.includes('is empty'))).toBe(true);
        expect(output.messages.some((m) => m.includes('--no-log'))).toBe(false);
        await rm(cwd, { recursive: true, force: true });
    });
    test('0930 R1/AC1 — trace --follow --timeout stops at the deadline: checkpoint, exit 1, run untouched', async () => {
        const cwd = await createTempProject();
        const dbPath = join(cwd, '.spur', 'spur.db');
        await mkdir(join(cwd, '.spur'), { recursive: true });
        const db = await createMigratedDb({ url: dbPath });
        const now = Date.now();
        await db.run(
            'INSERT INTO runs (id, workflow_name, mode, status, started_at, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            ['timeout-run-1', 'test-flow', 'sync', 'running', now, '{}', now, now],
        );
        db.close();

        const output = createCapturedOutput();
        const exitCode = await main(
            ['workflow', 'trace', 'timeout-run-1', '--follow', '--poll', '50', '--timeout', '60'],
            {
                output,
                cwd,
                dbUrl: dbPath,
            },
        );

        expect(exitCode).toBe(1);
        const checkpoints = output.messages.filter((m) => m.startsWith('Follow timed out'));
        expect(checkpoints).toHaveLength(1);
        expect(checkpoints[0]).toContain('run timeout-run-1');
        expect(checkpoints[0]).toContain('status=running');
        expect(checkpoints[0]).toContain('resume with spur workflow trace timeout-run-1 --follow');

        // The timeout is the watcher's, never the run's: the run row stays `running`.
        const after = createCapturedOutput();
        await main(['workflow', 'trace', 'timeout-run-1', '--json'], { output: after, cwd, dbUrl: dbPath });
        const trace = JSON.parse(after.messages.at(-1) ?? '{}') as { run: { status: string } };
        expect(trace.run.status).toBe('running');
        await rm(cwd, { recursive: true, force: true });
    });
});

describe('formatActionCost', () => {
    test('returns empty string for non-action events', () => {
        const event: TimelineEvent = { kind: 'transition', from: 'a', to: 'b', trigger: null, at: '1' };
        expect(formatActionCost(event)).toBe('');
    });

    test('returns empty string when cost is undefined (non-agent.run action)', () => {
        expect(formatActionCost(makeActionEvent(undefined))).toBe('');
    });

    test('renders `cost n/a` for an unjoinable step — never $0.00 (R3, 0281/0284)', () => {
        const rendered = formatActionCost(makeActionEvent(UNJOINED_COST));
        expect(rendered).toBe(' · cost n/a');
        expect(rendered).not.toContain('$0.00');
        expect(rendered).not.toContain('0%');
    });

    test('renders token figures and cache-hit for an exact mapping (R1)', () => {
        expect(formatActionCost(makeActionEvent({ exact: makeCost(), estimated: null }))).toBe(
            ' · 12.5k in / 3.2k out · cache 25%',
        );
    });

    test('marks estimated mappings with the ~ prefix (R2)', () => {
        const est = makeCost({
            estimated: true,
            totals: { ...makeCost().totals, inputTokens: 5000, outputTokens: 1100 },
        });
        expect(formatActionCost(makeActionEvent({ exact: null, estimated: est }))).toBe(
            ' · ~5.0k in / ~1.1k out · cache ~25%',
        );
    });

    test('renders exact and estimated figures apart — never summed (R2)', () => {
        const est = makeCost({
            estimated: true,
            totals: { ...makeCost().totals, inputTokens: 5000, outputTokens: 1100 },
        });
        expect(formatActionCost(makeActionEvent({ exact: makeCost(), estimated: est }))).toBe(
            ' · 12.5k in / 3.2k out · cache 25% · ~5.0k in / ~1.1k out · cache ~25%',
        );
    });

    test('renders `cache n/a` when records matched but carry no cache dimensions', () => {
        const cost = makeCost({ cacheHit: null });
        expect(formatActionCost(makeActionEvent({ exact: cost, estimated: null }))).toBe(
            ' · 12.5k in / 3.2k out · cache n/a',
        );
    });

    test('never emits a currency value (R3)', () => {
        const rendered = formatActionCost(makeActionEvent({ exact: makeCost(), estimated: null }));
        expect(rendered).not.toMatch(/\$|USD|cost_usd/i);
    });

    test('renders `cost n/a` for matched rows without token data (0281/0284 never-fabricate)', () => {
        const noUsage = makeCost({ cacheHit: null, totals: { ...makeCost().totals, recordsWithUsage: 0 } });
        expect(formatActionCost(makeActionEvent({ exact: noUsage, estimated: null }))).toBe(' · cost n/a');
    });
});

describe('formatTraceTimeline cost footer', () => {
    function makeTimeline(events: TimelineEvent[]): WorkflowTraceTimeline {
        return {
            run: {
                runId: 'r1',
                workflowName: 'wf',
                mode: 'sync',
                status: 'done',
                startedAt: '2026-01-15T10:00:00.000Z',
                completedAt: '2026-01-15T10:05:00.000Z',
                isDryRun: false,
                project: { name: 'project', root: '/project' },
                durationMs: 300000,
                outcome: 'success',
            },
            events,
        };
    }

    test('appends a `history import` hint when a step has no joinable usage (R6, AC2)', () => {
        const out = formatTraceTimeline(makeTimeline([makeActionEvent(UNJOINED_COST)]));
        expect(out).toContain('spur history import');
    });

    test('omits the hint when every agent.run step is joined', () => {
        const out = formatTraceTimeline(makeTimeline([makeActionEvent({ exact: makeCost(), estimated: null })]));
        expect(out).not.toContain('spur history import');
    });
});

describe('formatTraceTimeline decision provenance (task 0911 R6)', () => {
    test('renders the persisted decision provenance on the action row', () => {
        const decision: TimelineActionDecision = {
            mode: 'evidence',
            outcome: 'deferred',
            reason: 'stale-evidence',
            provider: null,
            confidence: null,
            selectedProbability: null,
            evidenceActionIds: ['act-producer'],
            evidenceDigest: 'sha256:abc',
            artifactId: null,
            durationMs: 12,
        };
        const out = formatTraceTimeline({
            run: {
                runId: 'r1',
                workflowName: 'wf',
                mode: 'sync',
                status: 'done',
                startedAt: '2026-01-15T10:00:00.000Z',
                completedAt: '2026-01-15T10:05:00.000Z',
                isDryRun: false,
                project: { name: 'project', root: '/project' },
                durationMs: 300000,
                outcome: 'success',
            },
            events: [
                {
                    ...(makeActionEvent() as Extract<TimelineEvent, { kind: 'action' }>),
                    actionKind: 'hitl.select',
                    decision,
                },
            ],
        });
        expect(out).toContain('decision=mode:evidence outcome:deferred reason:stale-evidence');
        expect(out).toContain('evidence:[act-producer]');
        expect(out).toContain('digest:sha256:abc');
    });

    test('omits the decision line for rows without provenance', () => {
        const out = formatTraceTimeline({
            run: {
                runId: 'r1',
                workflowName: 'wf',
                mode: 'sync',
                status: 'done',
                startedAt: '2026-01-15T10:00:00.000Z',
                completedAt: '2026-01-15T10:05:00.000Z',
                isDryRun: false,
                project: { name: 'project', root: '/project' },
                durationMs: 300000,
                outcome: 'success',
            },
            events: [makeActionEvent()],
        });
        expect(out).not.toContain('decision=');
    });
});

describe('formatTraceTimeline output artifact (task 0414)', () => {
    function makeTimeline(overrides: Partial<WorkflowTraceTimeline> = {}): WorkflowTraceTimeline {
        return {
            run: {
                runId: 'r1',
                workflowName: 'wf',
                mode: 'sync',
                status: 'running',
                startedAt: '2026-01-15T10:00:00.000Z',
                completedAt: null,
                isDryRun: false,
                project: { name: 'project', root: '/project' },
                durationMs: null,
                outcome: 'running',
            },
            events: [],
            ...overrides,
        };
    }

    test('points the operator at the live run log when present', () => {
        const out = formatTraceTimeline(makeTimeline({ outputArtifact: '.spur/run/r1.log' }));
        expect(out).toContain('Run log: .spur/run/r1.log');
        expect(out).toContain('tail -f');
    });

    test('omits the artifact line when no capture exists', () => {
        const out = formatTraceTimeline(makeTimeline());
        expect(out).not.toContain('Agent output');
    });

    test('renders allow-listed result, invocation, error, artifact, and next action (0528)', () => {
        const action = makeActionEvent();
        if (action.kind !== 'action') throw new Error('expected action event');
        const out = formatTraceTimeline(
            makeTimeline({
                run: {
                    ...makeTimeline().run,
                    nextAction: { label: 'Follow run', kind: 'command', value: 'spur workflow trace r1 --follow' },
                },
                events: [
                    {
                        ...action,
                        result: { agent: 'codex', exitCode: 1 },
                        invocation: { command: 'codex', model: 'gpt-5' },
                        error: 'failed safely',
                        artifacts: ['.spur/run/r1-work-partial.md'],
                        nextAction: {
                            label: 'Inspect partial work',
                            kind: 'path',
                            value: '.spur/run/r1-work-partial.md',
                        },
                    },
                ],
            }),
        );
        expect(out).toContain('result=agent=codex exitCode=1');
        expect(out).toContain('invocation=command=codex model=gpt-5');
        expect(out).toContain('error=failed safely');
        expect(out).toContain('artifact=.spur/run/r1-work-partial.md');
        expect(out).toContain('Next: Inspect partial work');
        expect(out).toContain('Next: Follow run');
    });
});

describe('followTrace', () => {
    test('replays persisted events, emits action updates, and stops at terminal status', async () => {
        const running: WorkflowTraceTimeline = {
            run: {
                runId: 'r1',
                workflowName: 'wf',
                mode: 'sync',
                status: 'running',
                startedAt: '2026-01-15T10:00:00.000Z',
                completedAt: null,
                isDryRun: false,
                project: { name: 'project', root: '/project' },
                durationMs: null,
                outcome: 'running',
            },
            events: [
                {
                    kind: 'action',
                    actionId: 'a1',
                    node: 'work',
                    actionKind: 'agent.run',
                    status: 'running',
                    duration: '',
                    durationMs: null,
                    startedAt: '2026-01-15T10:00:00.000Z',
                    completedAt: null,
                    ok: null,
                    outcome: 'running',
                    result: null,
                    invocation: null,
                    error: null,
                    artifacts: [],
                    label: ' (in-flight)',
                },
            ],
        };
        const done: WorkflowTraceTimeline = {
            run: {
                ...running.run,
                status: 'done',
                completedAt: '2026-01-15T10:01:00.000Z',
                durationMs: 60000,
                outcome: 'success',
            },
            events: [
                {
                    kind: 'action',
                    actionId: 'a1',
                    node: 'work',
                    actionKind: 'agent.run',
                    status: 'done',
                    duration: '60000ms',
                    durationMs: 60000,
                    startedAt: '2026-01-15T10:00:00.000Z',
                    completedAt: '2026-01-15T10:01:00.000Z',
                    ok: true,
                    outcome: 'success',
                    result: null,
                    invocation: null,
                    error: null,
                    artifacts: [],
                    label: ' ✓',
                },
            ],
        };
        let call = 0;
        const writes: string[] = [];
        await followTrace(
            { trace: async () => (call++ === 0 ? running : done) } as never,
            'r1',
            50,
            (line) => writes.push(line),
            async () => undefined,
        );

        expect(writes[0]).toContain('agent.run');
        expect(writes.some((line) => line.includes('60000ms'))).toBe(true);
        expect(writes.at(-1)).toBe('Run finalized: done — outcome=success duration=60000ms');
    });

    /** Minimal non-terminal timeline fixture for the 0930 deadline tests. */
    function runningTimeline(runId: string): WorkflowTraceTimeline {
        return {
            run: {
                runId,
                workflowName: 'wf',
                mode: 'sync',
                status: 'running',
                startedAt: '2026-01-15T10:00:00.000Z',
                completedAt: null,
                isDryRun: false,
                project: { name: 'project', root: '/project' },
                durationMs: null,
                outcome: 'running',
            },
            events: [],
        };
    }

    test('0930 R1 — deadline hit on a non-terminal run writes one checkpoint, never cancels, and reports timeout', async () => {
        let traceCalls = 0;
        let clock = 1000;
        const writes: string[] = [];
        const timedOut = await followTrace(
            {
                trace: async () => {
                    traceCalls++;
                    return runningTimeline('r1');
                },
            } as never,
            'r1',
            2000,
            (line) => writes.push(line),
            async () => {
                clock += 2000;
            },
            () => clock,
            5000,
        );

        expect(timedOut).toBe(true);
        expect(writes.filter((line) => line.startsWith('Follow timed out'))).toEqual([
            'Follow timed out after 6000ms: run r1 status=running — run continues; resume with spur workflow trace r1 --follow',
        ]);
        // Deadline checks ride the poll cycle: observe → wait → observe → wait → observe → stop.
        expect(traceCalls).toBe(4);
    });

    test('0930 R2 — without a deadline the follow stays unbounded until terminal', async () => {
        let polls = 0;
        let clock = 0;
        const writes: string[] = [];
        const timedOut = await followTrace(
            {
                trace: async () => {
                    polls++;
                    if (polls <= 8) return runningTimeline('r2');
                    const done = runningTimeline('r2');
                    return { ...done, run: { ...done.run, status: 'done', outcome: 'success', durationMs: 1 } };
                },
            } as never,
            'r2',
            1,
            (line) => writes.push(line),
            async () => {
                clock += 1_000_000;
            },
            () => clock,
        );

        expect(timedOut).toBe(false);
        expect(writes.some((line) => line.startsWith('Follow timed out'))).toBe(false);
        expect(writes.at(-1)).toBe('Run finalized: done — outcome=success duration=1ms');
    });

    test('0930 R1 — the Run-not-found retry window counts against the deadline', async () => {
        let attempts = 0;
        let clock = 0;
        const writes: string[] = [];
        const timedOut = await followTrace(
            {
                trace: async () => {
                    attempts++;
                    throw new Error(`Run not found: ghost-run (attempt ${attempts})`);
                },
            } as never,
            'ghost-run',
            500,
            (line) => writes.push(line),
            async () => {
                clock += 500;
            },
            () => clock,
            1200,
        );

        expect(timedOut).toBe(true);
        expect(writes).toEqual([
            'Follow timed out after 1500ms: run ghost-run status=pending — run continues; resume with spur workflow trace ghost-run --follow',
        ]);
        expect(attempts).toBeLessThan(20);
    });
});

describe('followRunLog', () => {
    /** status: 'running' until `terminal` flips true. */
    function serviceTrace(terminal: () => boolean) {
        return async () => ({ run: { status: terminal() ? 'done' : 'running' } }) as never;
    }

    test('tails appended lines and exits at terminal status', async () => {
        const dir = await createTempProject();
        await mkdir(join(dir, '.spur', 'run'), { recursive: true });
        const logPath = join(dir, '.spur', 'run', 'r9.log');
        await writeFile(logPath, 'first\n');

        const writes: string[] = [];
        let appended = false;
        const wait = async () => {
            if (!appended) {
                appended = true;
                await appendFile(logPath, 'second\n\nthird\n');
            }
        };
        let traceCalls = 0;
        const trace = async () => {
            traceCalls++;
            return { run: { status: traceCalls >= 3 ? 'done' : 'running' } } as never;
        };

        await followRunLog({ trace }, 'r9', dir, 5, (line) => writes.push(line), wait);

        expect(writes).toEqual(['first', 'second', '', 'third']);
        await rm(dir, { recursive: true, force: true });
    });

    test('holds back a trailing partial line until a newline lands', async () => {
        const dir = await createTempProject();
        await mkdir(join(dir, '.spur', 'run'), { recursive: true });
        const logPath = join(dir, '.spur', 'run', 'r10.log');
        await writeFile(logPath, 'complete\npartial');

        const writes: string[] = [];
        let appended = false;
        const wait = async () => {
            if (!appended) {
                appended = true;
                await appendFile(logPath, '-finished\n');
            }
        };
        let traceCalls = 0;
        const trace = async () => {
            traceCalls++;
            return { run: { status: traceCalls >= 3 ? 'done' : 'running' } } as never;
        };

        await followRunLog({ trace }, 'r10', dir, 5, (line) => writes.push(line), wait);

        expect(writes).toEqual(['complete', 'partial-finished']);
        await rm(dir, { recursive: true, force: true });
    });

    test('emits a clear message when the log never appears and the run ends terminal', async () => {
        const dir = await createTempProject();
        const writes: string[] = [];
        await followRunLog({ trace: serviceTrace(() => true) }, 'r11', dir, 5, (line) => writes.push(line));

        expect(writes).toHaveLength(1);
        expect(writes[0]).toContain('.spur/run/r11.md');
        expect(writes[0]).toContain('--no-log');
        await rm(dir, { recursive: true, force: true });
    });

    test('0926 AC2 — switches from a legacy .log to the resumed run .md when it appears mid-follow', async () => {
        const dir = await createTempProject();
        await mkdir(join(dir, '.spur', 'run'), { recursive: true });
        await writeFile(join(dir, '.spur', 'run', 'r12.log'), 'legacy\n');

        const writes: string[] = [];
        let stepped = false;
        const wait = async () => {
            if (!stepped) {
                stepped = true;
                // The continue of the legacy run creates the pair under the same id.
                await writeFile(join(dir, '.spur', 'run', 'r12.md'), 'resumed section\n');
                await writeFile(join(dir, '.spur', 'run', 'r12.state.json'), '{"runId":"r12"}');
            }
        };
        let traceCalls = 0;
        const trace = async () => {
            traceCalls++;
            return { run: { status: traceCalls >= 4 ? 'done' : 'running' } } as never;
        };

        await followRunLog({ trace }, 'r12', dir, 5, (line) => writes.push(line), wait);

        // The tail moved to the new record instead of tracking the stale legacy file.
        expect(writes).toEqual(['legacy', 'resumed section']);
        await rm(dir, { recursive: true, force: true });
    });

    test('0948 R6 — a legacy→md switch does not reprint a shared prefix', async () => {
        const dir = await createTempProject();
        await mkdir(join(dir, '.spur', 'run'), { recursive: true });
        await writeFile(join(dir, '.spur', 'run', 'r15.log'), 'legacy\n');

        const writes: string[] = [];
        let stepped = false;
        const wait = async () => {
            if (!stepped) {
                stepped = true;
                await writeFile(join(dir, '.spur', 'run', 'r15.md'), 'legacy\nresumed section\n');
                await writeFile(join(dir, '.spur', 'run', 'r15.state.json'), '{"runId":"r15"}');
            }
        };
        let traceCalls = 0;
        const trace = async () => {
            traceCalls++;
            return { run: { status: traceCalls >= 4 ? 'done' : 'running' } } as never;
        };

        await followRunLog({ trace }, 'r15', dir, 5, (line) => writes.push(line), wait);

        expect(writes).toEqual(['legacy', 'resumed section']);
        await rm(dir, { recursive: true, force: true });
    });

    test('0948 R6 — an empty legacy log is not described as --no-log', async () => {
        const dir = await createTempProject();
        await mkdir(join(dir, '.spur', 'run'), { recursive: true });
        await writeFile(join(dir, '.spur', 'run', 'r16.log'), '');

        const writes: string[] = [];
        await followRunLog({ trace: serviceTrace(() => true) }, 'r16', dir, 5, (line) => writes.push(line));

        expect(writes).toHaveLength(1);
        expect(writes[0]).toContain('is empty');
        expect(writes[0]).not.toContain('--no-log');
        await rm(dir, { recursive: true, force: true });
    });

    test('0926 AC2 — reports a missing pair state as an incomplete record, never as success', async () => {
        const dir = await createTempProject();
        await mkdir(join(dir, '.spur', 'run'), { recursive: true });
        await writeFile(join(dir, '.spur', 'run', 'r13.md'), 'record body\n');
        // No state file: the pair is incomplete by definition.

        const writes: string[] = [];
        await followRunLog({ trace: serviceTrace(() => true) }, 'r13', dir, 5, (line) => writes.push(line));

        expect(writes).toEqual([
            'record body',
            `Run record incomplete (state-missing) at ${join(dir, '.spur', 'run', 'r13.state.json')} — the workflow DB trace remains the completion authority.`,
        ]);
        await rm(dir, { recursive: true, force: true });
    });

    test('0930 R1 — deadline hit on a non-terminal run writes one checkpoint and reports timeout', async () => {
        const dir = await createTempProject();
        await mkdir(join(dir, '.spur', 'run'), { recursive: true });
        await writeFile(join(dir, '.spur', 'run', 'r14.md'), 'section one\n');

        const writes: string[] = [];
        let clock = 0;
        const timedOut = await followRunLog(
            { trace: async () => ({ run: { status: 'running' } }) as never },
            'r14',
            dir,
            1,
            (line) => writes.push(line),
            async () => {
                clock += 2000;
            },
            () => clock,
            5000,
        );

        expect(timedOut).toBe(true);
        expect(writes).toEqual([
            'section one',
            'Follow timed out after 6000ms: run r14 status=running — run continues; resume with spur workflow trace r14 --follow',
        ]);
        await rm(dir, { recursive: true, force: true });
    });
});

describe('formatTraceTimeline executor/session columns (task 0895 R2)', () => {
    function timeline(events: TimelineEvent[]): WorkflowTraceTimeline {
        return {
            run: {
                runId: 'r1',
                workflowName: 'wf',
                mode: 'sync',
                status: 'done',
                startedAt: '2026-01-15T10:00:00.000Z',
                completedAt: '2026-01-15T10:05:00.000Z',
                isDryRun: false,
                project: { name: 'project', root: '/project' },
                durationMs: 300000,
                outcome: 'success',
            },
            events,
        };
    }

    test('renders the executor, session id, session mode, and pin re-resolution on the action row', () => {
        const event = makeActionEvent() as Extract<TimelineEvent, { kind: 'action' }>;
        event.result = {
            agent: 'claude',
            exitCode: 0,
            executor: 'claude-b',
            sessionId: 'sess-1',
            session: 'fresh',
            pinReresolved: true,
            pinReresolvedFrom: 'claude-a',
            pinReresolvedOwner: 'drain',
            pinReresolvedReason: 'quota exhausted',
        };
        const out = formatTraceTimeline(timeline([event]));
        expect(out).toContain('executor=claude-b');
        expect(out).toContain('sessionId=sess-1');
        expect(out).toContain('session=fresh');
        expect(out).toContain('pinReresolved=true');
        expect(out).toContain('pinReresolvedFrom=claude-a');
        expect(out).toContain('pinReresolvedOwner=drain');
        expect(out).toContain('pinReresolvedReason=quota exhausted');
    });
});
