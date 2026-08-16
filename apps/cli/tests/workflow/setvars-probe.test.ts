/**
 * Probe for the setVars engine contract fix (spur task 0571, engine 0.4.35):
 * `file.read.into-var` in state s1 followed by a shell step in the SAME state
 * and a `${vars.*}` template in the NEXT state must all resolve the captured
 * value. Pre-0.4.35 the state-machine dialect dropped mid-sequence setVars
 * twice (intra-state stale snapshot; inter-state last-result-only merge), so
 * the idea-pipeline feature-create `$featureId` guards evaluated against "".
 *
 * Proven positions, mirroring R3's acceptance scenarios:
 *   1. same-state shell env — `$myId` exported into the child process
 *   2. next-state engine template — `${vars.myId}` resolved before the shell runs
 *   3. transition guard — `${vars.myId}` resolved in guard options
 */
import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerSpurBuiltins } from '@gobing-ai/spur-app';
import {
    MemoryWorkflowPersistenceAdapter,
    StateMachineDriver,
    WorkflowEngineHost,
} from '@gobing-ai/ts-dual-workflow-engine';

type BuiltinsOptions = Parameters<typeof registerSpurBuiltins>[1];

function makeStubOptions(): BuiltinsOptions {
    return {
        agentService: {
            runTraced: async () => ({ exitCode: 0, stdout: '' }),
        } as unknown as BuiltinsOptions['agentService'],
        ruleService: {
            evaluate: async () => ({ exitCode: 0, findings: [] }),
        } as unknown as BuiltinsOptions['ruleService'],
        hitlResponder: { respond: async () => ({ value: 'yes' }) } as unknown as BuiltinsOptions['hitlResponder'],
    };
}

describe('setVars probe — file.read.into-var reaches shell env, templates, and guards (0571)', () => {
    test('value captured in s1 is visible in same-state shell, next-state template, and guard', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'setvars-probe-'));
        try {
            await writeFile(join(dir, 'id.txt'), 'L\n', 'utf8');

            const host = new WorkflowEngineHost();
            registerSpurBuiltins(host, makeStubOptions());
            const driver = new StateMachineDriver({ host, persistence: new MemoryWorkflowPersistenceAdapter() });

            const result = await driver.run(
                {
                    name: 'setvars-probe',
                    initialState: 's1',
                    terminalStates: ['done', 'failed'],
                    states: [
                        {
                            id: 's1',
                            onEnter: [
                                { kind: 'file.read.into-var', options: { path: 'id.txt', var: 'myId' } },
                                // Same-state env handoff: $myId must already be exported.
                                { kind: 'shell', options: { command: 'printf %s "$myId" > same-state.txt' } },
                            ],
                        },
                        {
                            id: 's2',
                            // Next-state engine template: ${vars.myId} resolves before the shell runs.
                            onEnter: [
                                { kind: 'shell', options: { command: `printf %s "\${vars.myId}" > next-state.txt` } },
                            ],
                        },
                        { id: 'done' },
                    ],
                    transitions: [
                        { from: 's1', to: 's2' },
                        // Guard visibility: only passes when the template resolved to L.
                        {
                            from: 's2',
                            to: 'done',
                            guard: { kind: 'shell', options: { command: `test "\${vars.myId}" = "L"` } },
                        },
                        { from: 's2', to: 'failed', guard: { kind: 'always' } },
                    ],
                },
                { runId: 'setvars-probe-1', workdir: dir },
            );

            expect(result.status).toBe('done');
            expect(result.finalState).toBe('done');
            expect(await readFile(join(dir, 'same-state.txt'), 'utf8')).toBe('L');
            expect(await readFile(join(dir, 'next-state.txt'), 'utf8')).toBe('L');
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
});
