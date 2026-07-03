import { describe, expect, test } from 'bun:test';
import {
    type HitlResponder,
    MemoryWorkflowPersistenceAdapter,
    StateMachineDriver,
    WorkflowEngineHost,
} from '@gobing-ai/ts-dual-workflow-engine';
import type { AgentService } from '../../src/services/agent-service';
import type { RuleService } from '../../src/services/rule-service';
import { registerSpurBuiltins } from '../../src/workflow/builtins';

describe('registerSpurBuiltins', () => {
    test('registers all action kinds including http.request when requester provided', () => {
        const host = new WorkflowEngineHost();
        registerSpurBuiltins(host, {
            agentService: { run: async () => 0 } as unknown as AgentService,
            ruleService: { evaluate: async () => ({ exitCode: 0, findings: [] }) } as unknown as RuleService,
            hitlResponder: { respond: async () => ({ value: 'yes' }) } as unknown as HitlResponder,
            httpRequester: { rawRequest: async () => ({ status: 200, headers: {}, body: '' }) },
            hostAllowlist: new Set(['https://api.example.com']),
        });

        const actions = host.listActions();
        expect(actions).toContain('agent.run');
        expect(actions).toContain('rule.check');
        expect(actions).toContain('file.exists');
        expect(actions).toContain('file.read');
        expect(actions).toContain('file.read.into-var');
        expect(actions).toContain('http.request');
    });

    test('http.request is not registered when no requester provided', () => {
        const host = new WorkflowEngineHost();
        registerSpurBuiltins(host, {
            agentService: { run: async () => 0 } as unknown as AgentService,
            ruleService: { evaluate: async () => ({ exitCode: 0, findings: [] }) } as unknown as RuleService,
            hitlResponder: { respond: async () => ({ value: 'yes' }) } as unknown as HitlResponder,
        });

        const actions = host.listActions();
        expect(actions).not.toContain('http.request');
    });

    test('registers with origin builtin', () => {
        const host = new WorkflowEngineHost();
        registerSpurBuiltins(host, {
            agentService: { run: async () => 0 } as unknown as AgentService,
            ruleService: { evaluate: async () => ({ exitCode: 0, findings: [] }) } as unknown as RuleService,
            hitlResponder: { respond: async () => ({ value: 'yes' }) } as unknown as HitlResponder,
            httpRequester: { rawRequest: async () => ({ status: 200, headers: {}, body: '' }) },
            hostAllowlist: new Set(['https://api.example.com']),
        });

        expect(host.actionOrigin('agent.run')).toBe('builtin');
        expect(host.actionOrigin('rule.check')).toBe('builtin');
        expect(host.actionOrigin('file.exists')).toBe('builtin');
        expect(host.actionOrigin('file.read')).toBe('builtin');
        expect(host.actionOrigin('file.read.into-var')).toBe('builtin');
        expect(host.actionOrigin('http.request')).toBe('builtin');
    });

    test('agent.run resolves through host.runAction', async () => {
        const host = new WorkflowEngineHost();
        registerSpurBuiltins(host, {
            agentService: { run: async () => 0 } as unknown as AgentService,
            ruleService: { evaluate: async () => ({ exitCode: 0, findings: [] }) } as unknown as RuleService,
            hitlResponder: { respond: async () => ({ value: 'yes' }) } as unknown as HitlResponder,
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
            hitlResponder: { respond: async () => ({ value: 'yes' }) } as unknown as HitlResponder,
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

    test('hitl answer propagates to a later step via setVars end-to-end (R7)', async () => {
        // Prove a hitl.input answer is merged into run vars and is visible to a later
        // node's action — the cross-step path that unit tests (which only assert the
        // runner's setVars shape) cannot cover. Mirrors the 0032 latch e2e test.
        let resolvedInLaterStep: unknown;
        // A workflow template string the engine's resolveTemplates interprets at runtime — NOT a JS
        // template literal. Built by concatenation so the source doesn't contain a `${` that Biome's
        // noTemplateCurlyInString would (correctly, for JS) flag.
        const hitlInputTemplate = `$${'{vars.__hitlInput}'}`;
        const host = new WorkflowEngineHost();
        registerSpurBuiltins(host, {
            agentService: { run: async () => 0 } as unknown as AgentService,
            ruleService: { evaluate: async () => ({ exitCode: 0, findings: [] }) } as unknown as RuleService,
            // The responder supplies the human's answer; the action stores it in __hitlInput.
            hitlResponder: { respond: async () => ({ value: 'ship it' }) } as unknown as HitlResponder,
        });
        // A capture action records the template value it received, proving ${vars.__hitlInput}
        // resolved from the earlier hitl.input step's setVars.
        host.registerAction(
            {
                kind: 'capture',
                async execute(options: Record<string, unknown>) {
                    resolvedInLaterStep = options.seen;
                    return { ok: true };
                },
            },
            'extension',
        );

        const result = await new StateMachineDriver({
            host,
            persistence: new MemoryWorkflowPersistenceAdapter(),
        }).run(
            {
                name: 'hitl-e2e',
                initialState: 'ask',
                terminalStates: ['done'],
                states: [
                    { id: 'ask', onEnter: [{ kind: 'hitl.input', options: { prompt: 'Decision?' } }] },
                    { id: 'use', onEnter: [{ kind: 'capture', options: { seen: hitlInputTemplate } }] },
                    { id: 'done' },
                ],
                transitions: [
                    { from: 'ask', to: 'use' },
                    { from: 'use', to: 'done' },
                ],
            },
            { runId: 'hitl-e2e-1' },
        );

        expect(result.status).toBe('done');
        expect(resolvedInLaterStep).toBe('ship it');
    });
});
