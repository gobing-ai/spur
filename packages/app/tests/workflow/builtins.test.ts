import { describe, expect, test } from 'bun:test';
import {
    MemoryWorkflowPersistenceAdapter,
    StateMachineDriver,
    WorkflowEngineHost,
} from '@gobing-ai/ts-dual-workflow-engine';
import type { AgentService } from '../../src/services/agent-service';
import type { RuleService } from '../../src/services/rule-service';
import { registerSpurBuiltins } from '../../src/workflow/builtins';

describe('registerSpurBuiltins', () => {
    test('registers all four action kinds', () => {
        const host = new WorkflowEngineHost();
        registerSpurBuiltins(host, {
            agentService: { run: async () => 0 } as unknown as AgentService,
            ruleService: { evaluate: async () => ({ exitCode: 0, findings: [] }) } as unknown as RuleService,
        });

        const actions = host.listActions();
        expect(actions).toContain('agent.run');
        expect(actions).toContain('rule.check');
        expect(actions).toContain('file.exists');
        expect(actions).toContain('file.read');
    });

    test('registers with origin builtin', () => {
        const host = new WorkflowEngineHost();
        registerSpurBuiltins(host, {
            agentService: { run: async () => 0 } as unknown as AgentService,
            ruleService: { evaluate: async () => ({ exitCode: 0, findings: [] }) } as unknown as RuleService,
        });

        expect(host.actionOrigin('agent.run')).toBe('builtin');
        expect(host.actionOrigin('rule.check')).toBe('builtin');
        expect(host.actionOrigin('file.exists')).toBe('builtin');
        expect(host.actionOrigin('file.read')).toBe('builtin');
    });

    test('agent.run resolves through host.runAction', async () => {
        const host = new WorkflowEngineHost();
        registerSpurBuiltins(host, {
            agentService: { run: async () => 0 } as unknown as AgentService,
            ruleService: { evaluate: async () => ({ exitCode: 0, findings: [] }) } as unknown as RuleService,
        });

        const result = await host.runAction(
            'agent.run',
            { input: 'hello' },
            {
                runId: 'r1',
                stateOrNodeId: 's1',
                workdir: '/tmp',
                vars: {},
                env: {},
            },
        );
        expect(result.ok).toBe(true);
    });

    test('session latch propagates across steps end-to-end through the engine (F1 setVars)', async () => {
        // Capture the `continue` flag each agent.run receives, in order, while a real
        // two-step workflow runs through the engine. This proves the latch's setVars is
        // actually merged into the next step's vars (the behavior that is inert on a
        // pre-0.3.9 engine without ActionResult.setVars).
        const continueSeen: Array<boolean | undefined> = [];
        const agentService = {
            run: async (_input: string | undefined, flags: Record<string, string | boolean>) => {
                continueSeen.push(flags.continue as boolean | undefined);
                return 0;
            },
        } as unknown as AgentService;

        const host = new WorkflowEngineHost();
        registerSpurBuiltins(host, {
            agentService,
            ruleService: { evaluate: async () => ({ exitCode: 0, findings: [] }) } as unknown as RuleService,
        });

        const result = await new StateMachineDriver({
            host,
            persistence: new MemoryWorkflowPersistenceAdapter(),
        }).run(
            {
                name: 'latch-e2e',
                initialState: 'first',
                terminalStates: ['done'],
                states: [
                    { id: 'first', onEnter: [{ kind: 'agent.run', options: { input: '/step-one' } }] },
                    { id: 'second', onEnter: [{ kind: 'agent.run', options: { input: '/step-two' } }] },
                    { id: 'done' },
                ],
                transitions: [
                    { from: 'first', to: 'second' },
                    { from: 'second', to: 'done' },
                ],
            },
            { runId: 'latch-e2e-1' },
        );

        expect(result.status).toBe('done');
        // First agent.run opens the session (latch unset → continue not forced true);
        // second inherits it (latch set by step 1's setVars → continue true).
        expect(continueSeen).toEqual([undefined, true]);
    });
});
