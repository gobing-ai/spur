/**
 * Task 1276 / F1: compose keyed fleet work, the real AgentService, the warm dispatcher and
 * the REGISTERED Claude driver. Only process launch is redirected to a captured-transcript child.
 * Failure modes: opening a process per key, reusing correlation, losing the answer, or promoting
 * native success over a missing artifact. The second case pins that last failure explicitly.
 */
import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMigratedDb } from '@gobing-ai/spur-domain';
import { AiRunner, type TurnOutcome, type TurnSession } from '@gobing-ai/ts-ai-runner';
import { NodeProcessExecutor, type PipeProcess, type PipeProcessOptions } from '@gobing-ai/ts-runtime';
import { type AgentRunDeps, AgentService } from '../../src/services/agent-service';
import { createWarmTurnDispatcher, type TurnReceipt } from '../../src/services/warm-turn-dispatch';
import { FRESH_SESSION_ROLES } from '../../src/workflow/fleet-dispatch';
import { readFleetWorkItemResult, runFleetWorkItem, writeFleetWorkItem } from '../../src/workflow/fleet-work-item';

class ClaudeReplayExecutor extends NodeProcessExecutor {
    readonly launches: Array<{ command: string; args: string[]; pid: number | null }> = [];

    override runStreaming(options: PipeProcessOptions): PipeProcess {
        const child = super.runStreaming({
            ...options,
            command: process.execPath,
            args: [join(import.meta.dir, '../fixtures/claude-warm/replay.ts')],
        });
        this.launches.push({ command: options.command, args: options.args ?? [], pid: child.pid });
        return child;
    }
}

// Binary availability is deterministic; protocol qualification, framing, decoding and settlement
// still run through the installed runner. This does not probe or invoke the host's paid CLI.
function resolutionDeps(): AgentRunDeps {
    return {
        detector: {
            detectOne: async () => ({ name: 'claude', installed: true, version: '2.1.308', channels: [], error: null }),
        } as unknown as AgentRunDeps['detector'],
        doctorRunner: {
            runOne: async () => ({
                agent: 'claude',
                installed: true,
                version: '2.1.308',
                authenticated: 'authenticated',
                usable: true,
                tier: 1,
                channels: [],
                error: null,
            }),
        } as unknown as AgentRunDeps['doctorRunner'],
    };
}

for (const missingArtifact of [true, false]) {
    test(`1276 AC2: two keyed Claude turns reuse one child; missing artifact = ${missingArtifact}`, async () => {
        const cwd = mkdtempSync(join(tmpdir(), 'claude-warm-work-'));
        const db = await createMigratedDb({ url: ':memory:' });
        const executor = new ClaudeReplayExecutor();
        const runner = new AiRunner({ processExecutor: executor });
        const service = new AgentService({ cwd, env: {}, output: { write: () => {}, error: () => {} } });
        const binding = { memberId: 'member-claude', ownerEpoch: 4, occupantGeneration: 9 };
        let session: TurnSession | undefined;
        let openCalls = 0;
        const turns: TurnOutcome[] = [];
        const receipts: TurnReceipt[] = [];
        const turn = createWarmTurnDispatcher({
            openSession: async (agent, policy) => {
                expect(agent).toBe('claude');
                openCalls++;
                // No driver override: this must select TURN_SESSION_DRIVERS.get('claude').
                return runner.openTurnSession('claude', {
                    policy,
                    binary: { path: 'claude', version: '2.1.308' },
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
            for (const [index, answer] of ['alpha', 'beta'].entries()) {
                const state = `task-${index + 1}`;
                const runId = `child-${index + 1}`;
                const requestId = `request-${index + 1}`;
                const answerFile = `.spur/run/${state}-answer.txt`;
                await writeFleetWorkItem(
                    cwd,
                    'parent',
                    state,
                    {
                        role: 'coder',
                        input: `Return ${answer}`,
                        answerFile,
                        expectFile: missingArtifact && index === 1 ? 'missing-artifact.txt' : answerFile,
                    },
                    {},
                );
                const result = await runFleetWorkItem({
                    cwd,
                    recipient: binding.memberId,
                    key: `parent/${state}`,
                    messageId: requestId,
                    flags: { agent: 'claude', 'run-id': runId, 'execution-id': `execution-${index + 1}` },
                    service,
                    runDeps: resolutionDeps(),
                    getDb: async () => db,
                    turn: {
                        ...turn,
                        dispatchTurn: async (context) => {
                            const dispatched = await turn.dispatchTurn(context);
                            expect(dispatched.kind).toBe('warm');
                            if (dispatched.kind !== 'warm')
                                throw new Error(`Unexpected fallback: ${dispatched.reason}`);
                            expect(dispatched.outcome.correlation).toMatchObject({ runId, requestId, attempt: 0 });
                            turns.push(dispatched.outcome);
                            return dispatched;
                        },
                    },
                });
                expect(result).not.toBeNull();
                expect(result?.ok).toBe(!(missingArtifact && index === 1));
                if (missingArtifact && index === 1) {
                    expect(result?.data).toMatchObject({ outcome: 'contract-violation', contract: 'expectFile' });
                }
                expect(readFileSync(join(cwd, answerFile), 'utf8').trim()).toBe(answer);
                const receipt = turn.lastTurn();
                expect(receipt).toMatchObject({
                    ...binding,
                    requestId,
                    attempt: 0,
                    mode: 'warm',
                    nativeOutcome: 'success',
                    nativeSessionId: '<uuid>',
                    acceptedAt: expect.any(String),
                });
                if (receipt !== undefined) receipts.push(receipt);
                expect(result?.data?.turn).toEqual(receipt);
                expect(await readFleetWorkItemResult(cwd, 'parent', state)).toEqual(result);
                expect(session?.state).toBe('ready');
            }
            expect(openCalls).toBe(1);
            expect(executor.launches).toHaveLength(1);
            expect(executor.launches[0]).toMatchObject({ command: 'claude', pid: expect.any(Number) });
            expect(executor.launches[0]?.args).toContain('stream-json');
            expect(turns).toHaveLength(2);
            expect(turns.map((outcome) => outcome.finalText)).toEqual(['alpha', 'beta']);
            expect(turns.every((outcome) => outcome.kind === 'success')).toBe(true);
            expect(turns[0]?.turnId).not.toBe(turns[1]?.turnId);
            expect(receipts[0]?.nativeSessionId).toBe(receipts[1]?.nativeSessionId);
            expect(receipts[0]?.policyDigest).toBe(receipts[1]?.policyDigest);
            // Claude emits no native turn id; distinct facade turn ids above are not relabelled.
            expect(turns.map((outcome) => outcome.nativeTurnId)).toEqual([undefined, undefined]);
        } finally {
            await session?.close();
            db.close();
            rmSync(cwd, { recursive: true, force: true });
        }
    }, 15_000);
}
