import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    type AgentRunDeps,
    AgentService,
    createWarmTurnDispatcher,
    FRESH_SESSION_ROLES,
    runFleetWorkItem,
    writeFleetWorkItem,
} from '@gobing-ai/spur-app';
import { createMigratedDb } from '@gobing-ai/spur-domain';
import { type AgentName, AiRunner, type TurnOutcomeKind, type TurnSession } from '@gobing-ai/ts-ai-runner';
import { createFakeTurnSessionDriver } from '@gobing-ai/ts-ai-runner/testing';
import {
    NodeProcessExecutor,
    type PipeProcess,
    type PipeProcessOptions,
    type ProcessOptions,
    type ProcessResult,
} from '@gobing-ai/ts-runtime';
import type { PerfTrial } from './fleet-e2e';

export interface PerfMeasured {
    p50Ms?: number;
    p95Ms?: number;
    completionRate?: number;
    validatedPerHour?: number;
    status?: 'unsupported';
    reason?: string;
}

/** Nearest-rank percentiles retain failed trials in the completion-rate denominator. */
export function perfMeasured(trials: readonly PerfTrial[], mode: PerfTrial['mode']): PerfMeasured {
    const rows = trials.filter((trial) => trial.mode === mode);
    const values = rows
        .filter((trial) => trial.status === 'validated' && Number.isFinite(trial.durationMs))
        .map((trial) => trial.durationMs as number)
        .sort((a, b) => a - b);
    if (values.length === 0) return rows.length === 0 ? {} : { completionRate: 0 };
    const occupiedMs = rows.every((row) => Number.isFinite(row.durationMs))
        ? rows.reduce((sum, row) => sum + (row.durationMs ?? 0), 0)
        : undefined;
    return {
        p50Ms: values[Math.ceil(values.length * 0.5) - 1],
        p95Ms: values[Math.ceil(values.length * 0.95) - 1],
        completionRate: values.length / rows.length,
        ...(occupiedMs !== undefined && occupiedMs > 0
            ? { validatedPerHour: Math.round(((values.length * 3_600_000) / occupiedMs) * 1000) / 1000 }
            : {}),
    };
}

interface TurnPerfTrial extends PerfTrial {
    executionId: string;
    requestId: string;
    attempt: number;
    memberId: string;
    ownerEpoch: number;
    occupantGeneration: number;
    nativeOutcome?: TurnOutcomeKind;
    nativeSessionId?: string;
    nativeTurnId?: string;
    contractValidated: boolean;
    injected: boolean;
}

export interface TurnPerfComparison {
    lane: 'deterministic-fixture';
    workloadDigest: string;
    settings: { model: string; provider: string; reasoning: string };
    trials: TurnPerfTrial[];
    processes: Record<string, Record<PerfTrial['mode'], number>>;
    measured: Record<string, Record<PerfTrial['mode'], PerfMeasured>>;
}

const RESPONSE = 'fixture-ok';
const PROMPT = `Return exactly ${RESPONSE}.`;

// Only the model is a fixture. The shim, OS child, resumed state, turn session and action
// contract are real; no number from this lane is evidence of paid-model performance.
class FixtureExecutor extends NodeProcessExecutor {
    readonly processes = { cold: 0, resume: 0, warm: 0 };

    constructor(private readonly stateFile: string) {
        super();
    }

    override run(options: ProcessOptions): Promise<ProcessResult> {
        const args = options.args ?? [];
        const resume = args.some((arg) => ['--resume', '-r', 'resume'].includes(arg));
        this.processes[resume ? 'resume' : 'cold']++;
        return super.run({
            ...options,
            command: process.execPath,
            args: [
                '-e',
                "const p=process.argv[1]; if(process.argv[2]==='resume' && !(await Bun.file(p).exists())) process.exit(2); await Bun.write(p,'fixture-session'); console.log(process.argv[3]);",
                this.stateFile,
                resume ? 'resume' : 'cold',
                RESPONSE,
            ],
        });
    }

    override runStreaming(options: PipeProcessOptions): PipeProcess {
        this.processes.warm++;
        return super.runStreaming(options);
    }
}

/** Paired transport samples: identical keyed workload and validation in every mode and agent. */
export async function runPairedTurnPerf(
    agents: readonly string[],
    pairs: number,
    injectFailure: boolean,
): Promise<TurnPerfComparison> {
    const settings = { model: 'fixture-v1', provider: 'local-fixture', reasoning: 'none' };
    const comparison: TurnPerfComparison = {
        lane: 'deterministic-fixture',
        workloadDigest: `sha256:${createHash('sha256').update(PROMPT).digest('hex')}`,
        settings,
        trials: [],
        processes: {},
        measured: {},
    };
    for (const name of agents) {
        const agent = name as AgentName;
        const cwd = mkdtempSync(join(tmpdir(), 'spur-turn-perf-'));
        const db = await createMigratedDb({ url: ':memory:' });
        const executor = new FixtureExecutor(join(cwd, 'fixture-session'));
        const runner = new AiRunner({ processExecutor: executor });
        const service = new AgentService({ cwd, env: {}, output: { write: () => {}, error: () => {} } });
        const binding = { memberId: `perf-${name}`, ownerEpoch: 1, occupantGeneration: 1 };
        let session: TurnSession | undefined;
        const turn = createWarmTurnDispatcher({
            openSession: (selected, policy) =>
                runner.openTurnSession(selected as AgentName, {
                    policy,
                    binary: { path: process.execPath, version: Bun.version },
                    driver: createFakeTurnSessionDriver(
                        [{ op: 'accept' }, { op: 'terminal', kind: 'success', finalText: RESPONSE }],
                        { agent },
                    ),
                }),
            holder: {
                turnSession: () => session,
                turnBinding: () => (session === undefined ? undefined : binding),
                adoptTurnSession: (opened) => {
                    session = opened;
                },
                closeTurnSession: async () => {
                    await session?.close();
                    session = undefined;
                },
            },
            binding,
            freshRoles: FRESH_SESSION_ROLES,
        });
        const runDeps: AgentRunDeps = {
            runner,
            detector: {
                detectOne: async () => ({
                    name: agent,
                    installed: true,
                    version: Bun.version,
                    channels: [],
                    error: null,
                }),
            } as unknown as AgentRunDeps['detector'],
            doctorRunner: {
                runOne: async () => ({
                    agent,
                    installed: true,
                    version: Bun.version,
                    authenticated: 'authenticated',
                    usable: true,
                    tier: 1,
                    channels: [],
                    error: null,
                }),
            } as unknown as AgentRunDeps['doctorRunner'],
        };
        const sample = async (mode: PerfTrial['mode'], index: number, injected = false): Promise<void> => {
            const runId = crypto.randomUUID();
            const executionId = crypto.randomUUID();
            const requestId = crypto.randomUUID();
            const state = `${name}-${mode}-${index}`;
            const answer = `${state}.txt`;
            const phases: PerfTrial['phases'] = [{ phase: 'enqueue', at: new Date().toISOString(), executionId }];
            const started = performance.now();
            let ok = false;
            let reason: string | undefined;
            try {
                await writeFleetWorkItem(
                    cwd,
                    'paired-perf',
                    state,
                    {
                        role: 'coder',
                        input: PROMPT,
                        answerFile: answer,
                        expectFile: injected ? 'intentionally-missing.txt' : answer,
                    },
                    {},
                );
                const result = await runFleetWorkItem({
                    cwd,
                    recipient: binding.memberId,
                    key: `paired-perf/${state}`,
                    messageId: requestId,
                    flags: {
                        agent,
                        model: settings.model,
                        'run-id': runId,
                        'execution-id': executionId,
                        ...(mode === 'resume' ? { 'session-id': 'fixture-session' } : {}),
                    },
                    service,
                    runDeps,
                    getDb: async () => db,
                    ...(mode === 'warm' ? { turn } : {}),
                    emitPhase: (phase, payload) => phases.push({ phase, at: String(payload.at), executionId }),
                });
                ok = result?.ok === true && readFileSync(join(cwd, answer), 'utf8').trim() === RESPONSE;
                if (!ok) reason = result?.error ?? 'artifact did not contain the bounded response';
            } catch (error) {
                reason = error instanceof Error ? error.message : String(error);
            }
            phases.push({ phase: 'receipt', at: new Date().toISOString(), executionId });
            const observed = mode === 'warm' ? turn.lastTurn() : undefined;
            if (observed?.acceptedAt !== undefined) {
                phases.push({ phase: 'turn-accepted', at: observed.acceptedAt, executionId });
                phases.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
            }
            comparison.trials.push({
                agent: name,
                mode,
                ...settings,
                tokens: 'unavailable',
                resources: 'unavailable',
                status: ok ? 'validated' : 'failed',
                durationMs: performance.now() - started,
                runId,
                executionId,
                requestId,
                attempt: observed?.attempt ?? 0,
                ...binding,
                ...(observed?.nativeOutcome === undefined ? {} : { nativeOutcome: observed.nativeOutcome }),
                ...(observed?.nativeSessionId === undefined ? {} : { nativeSessionId: observed.nativeSessionId }),
                ...(observed?.nativeTurnId === undefined ? {} : { nativeTurnId: observed.nativeTurnId }),
                phases,
                binary: { path: process.execPath, version: Bun.version },
                contractValidated: ok,
                injected,
                ...(reason === undefined ? {} : { reason }),
            });
        };
        try {
            for (let index = 0; index < pairs; index++) {
                const modes: PerfTrial['mode'][] =
                    index % 2 === 0 ? ['cold', 'resume', 'warm'] : ['warm', 'cold', 'resume'];
                for (const mode of modes) await sample(mode, index);
            }
            if (injectFailure && name === agents[0]) await sample('warm', pairs, true);
            comparison.processes[name] = executor.processes;
            const rows = comparison.trials.filter((row) => row.agent === name);
            comparison.measured[name] = {
                cold: perfMeasured(rows, 'cold'),
                resume: perfMeasured(rows, 'resume'),
                warm: perfMeasured(rows, 'warm'),
            };
        } finally {
            await session?.close();
            db.close();
            rmSync(cwd, { recursive: true, force: true });
        }
    }
    return comparison;
}
