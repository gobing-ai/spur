/**
 * 1277 failure-first E2E: the registered Pi driver, real child, warm dispatcher, AgentService
 * and workflow action validator. Only process launch is redirected to a captured RPC replay.
 * Acceptance/agent_end must not certify completion; bad framing cannot trigger replay; an
 * unqualified version must fall back once. Successful turns must keep one pid and distinct keys.
 */
import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMigratedDb } from '@gobing-ai/spur-domain';
import { AiRunner, type TurnOutcome, type TurnSession } from '@gobing-ai/ts-ai-runner';
import { NodeProcessExecutor, type PipeProcess, type PipeProcessOptions } from '@gobing-ai/ts-runtime';
import { type AgentRunDeps, AgentService } from '../../src/services/agent-service';
import { createWarmTurnDispatcher, type TurnReceipt } from '../../src/services/warm-turn-dispatch';
import { FRESH_SESSION_ROLES } from '../../src/workflow/fleet-dispatch';
import { readFleetWorkItemResult, runFleetWorkItem, writeFleetWorkItem } from '../../src/workflow/fleet-work-item';

class PiReplayExecutor extends NodeProcessExecutor {
    readonly launches: Array<{ command: string; args: string[]; pid: number | null }> = [];

    constructor(private readonly scenario: string) {
        super();
    }

    override runStreaming(options: PipeProcessOptions): PipeProcess {
        const child = super.runStreaming({
            ...options,
            command: process.execPath,
            args: [join(import.meta.dir, '../fixtures/pi-warm/replay.ts'), this.scenario],
        });
        this.launches.push({ command: options.command, args: options.args ?? [], pid: child.pid });
        return child;
    }
}

function resolutionDeps(runner: AiRunner): AgentRunDeps {
    return {
        runner,
        detector: {
            detectOne: async () => ({ name: 'pi', installed: true, version: '0.87.1', channels: [], error: null }),
        } as unknown as AgentRunDeps['detector'],
        doctorRunner: {
            runOne: async () => ({
                agent: 'pi',
                installed: true,
                version: '0.87.1',
                authenticated: 'authenticated',
                usable: true,
                tier: 1,
                channels: [],
                error: null,
            }),
        } as unknown as AgentRunDeps['doctorRunner'],
    };
}

for (const scenario of [
    'accepted-exit',
    'malformed',
    'rejected',
    'unqualified',
    'missing-artifact',
    'plain',
    'fragmented',
]) {
    test(`1277 keyed Pi work through the action contract: ${scenario}`, async () => {
        const cwd = mkdtempSync(join(tmpdir(), 'pi-warm-work-'));
        const db = await createMigratedDb({ url: ':memory:' });
        const executor = new PiReplayExecutor(scenario);
        const runner = new AiRunner({ processExecutor: executor });
        // The one-shot fallback is an IO boundary too: prove it runs exactly once, without a model.
        let fallbackCalls = 0;
        runner.runPromptCommand = async () => {
            fallbackCalls++;
            writeFileSync(join(cwd, 'artifact-1.txt'), 'fallback');
            return { exitCode: 0, stdout: 'fallback', stderr: '', durationMs: 1 };
        };
        const service = new AgentService({ cwd, env: {}, output: { write: () => {}, error: () => {} } });
        const binding = { memberId: 'member-pi', ownerEpoch: 4, occupantGeneration: 9 };
        let session: TurnSession | undefined;
        let openCalls = 0;
        const outcomes: TurnOutcome[] = [];
        const receipts: TurnReceipt[] = [];
        const turn = createWarmTurnDispatcher({
            openSession: async (agent, policy) => {
                expect(agent).toBe('pi');
                openCalls++;
                return runner.openTurnSession('pi', {
                    policy,
                    binary: { path: 'pi', version: scenario === 'unqualified' ? '1.4.0' : '0.87.1' },
                    handshakeTimeoutMs: 2_000,
                });
            },
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
        try {
            const count = ['plain', 'fragmented', 'missing-artifact'].includes(scenario) ? 2 : 1;
            for (let index = 1; index <= count; index++) {
                const state = `task-${index}`;
                const requestId = `request-${index}`;
                const artifact = `artifact-${index}.txt`;
                await writeFleetWorkItem(
                    cwd,
                    'parent',
                    state,
                    {
                        role: 'coder',
                        input: `Replay turn ${index}\nREPLAY_ARTIFACT ${join(cwd, artifact)}`,
                        expectFile: artifact,
                    },
                    {},
                );
                const result = await runFleetWorkItem({
                    cwd,
                    recipient: binding.memberId,
                    key: `parent/${state}`,
                    messageId: requestId,
                    flags: { agent: 'pi', 'run-id': `child-${index}`, 'execution-id': `execution-${index}` },
                    service,
                    runDeps: resolutionDeps(runner),
                    getDb: async () => db,
                    turn: {
                        ...turn,
                        dispatchTurn: async (context) => {
                            const dispatched = await turn.dispatchTurn(context);
                            if (dispatched.kind === 'warm') {
                                expect(dispatched.outcome.correlation).toMatchObject({
                                    runId: `child-${index}`,
                                    requestId,
                                    attempt: 0,
                                });
                                outcomes.push(dispatched.outcome);
                            } else {
                                expect(['unqualified', 'rejected']).toContain(scenario);
                                expect(dispatched.reason).toBe(
                                    scenario === 'unqualified' ? 'unqualified-version' : 'not-started',
                                );
                            }
                            return dispatched;
                        },
                    },
                });
                const succeeds =
                    ['plain', 'fragmented', 'unqualified', 'rejected'].includes(scenario) ||
                    (scenario === 'missing-artifact' && index === 1);
                expect(result?.ok).toBe(succeeds);
                expect(await readFleetWorkItemResult(cwd, 'parent', state)).toEqual(result);
                const receipt = turn.lastTurn();
                expect(receipt).toMatchObject({ ...binding, requestId, attempt: 0 });
                expect(result?.data?.turn).toEqual(receipt);
                if (receipt !== undefined) receipts.push(receipt);
                if (scenario === 'accepted-exit') {
                    expect(outcomes[0]?.kind).toBe('outcome-unknown');
                    expect(outcomes[0]?.acceptedAt).toBeDefined();
                } else if (scenario === 'malformed') {
                    expect(outcomes[0]?.kind).toBe('contract-violation');
                } else if (scenario === 'unqualified' || scenario === 'rejected') {
                    expect(receipt).toMatchObject({
                        mode: 'one-shot',
                        // The warm attempt settled not-started upstream; the fallback receipt
                        // carries that classification (outcomes[] stays empty — no warm result).
                        ...(scenario === 'rejected' ? { nativeOutcome: 'not-started' as const } : {}),
                        fallbackReason: scenario === 'unqualified' ? 'unqualified-version' : 'not-started',
                    });
                } else {
                    expect(receipt).toMatchObject({
                        mode: 'warm',
                        nativeOutcome: 'success',
                        acceptedAt: expect.any(String),
                    });
                    if (succeeds)
                        expect(readFileSync(join(cwd, artifact), 'utf8')).toBe(index === 1 ? 'alpha' : 'beta');
                    else expect(result?.data).toMatchObject({ outcome: 'contract-violation', contract: 'expectFile' });
                }
            }
            expect(openCalls).toBe(1);
            expect(fallbackCalls).toBe(['unqualified', 'rejected'].includes(scenario) ? 1 : 0);
            expect(executor.launches).toHaveLength(scenario === 'unqualified' ? 0 : 1);
            if (scenario !== 'unqualified') {
                expect(executor.launches[0]).toMatchObject({ command: 'pi', pid: expect.any(Number) });
                expect(executor.launches[0]?.args).toEqual(['--mode', 'rpc', '--no-session']);
            }
            if (count === 2) {
                expect(outcomes[0]?.turnId).not.toBe(outcomes[1]?.turnId);
                expect(receipts[0]?.policyDigest).toBe(receipts[1]?.policyDigest);
                // Pi's command echo supplies local correlation; no native session/turn id is invented.
                expect(outcomes.map((outcome) => outcome.nativeTurnId)).toEqual([undefined, undefined]);
            }
        } finally {
            await session?.close();
            db.close();
            rmSync(cwd, { recursive: true, force: true });
        }
    }, 15_000);
}
