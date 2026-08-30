import { describe, expect, test } from 'bun:test';
import {
    buildEscalationPacket,
    decisionKindForGate,
    escalationFingerprint,
    extractProofDigest,
    renderEscalationMarkdown,
} from '../../src/workflow/escalation-packet';

const NOW = '2026-08-29T22:00:00.000Z';

function tripwireInput(overrides: Partial<Parameters<typeof buildEscalationPacket>[0]> = {}) {
    return {
        trigger: 'tripwire' as const,
        runId: 'run-42',
        workflowName: 'task-pipeline',
        node: 'test',
        actionId: 'run-42:test',
        gateId: 'hard-budget',
        gateKind: 'agent.run',
        observed: 'tokens used 120000',
        threshold: 'max-tokens 100000',
        response: 'fail' as const,
        evidenceRefs: ['.spur/run/run-42-budget.json', 'sha256:abcdef0123456789abcd'],
        decisionReason: 'An operator must raise the declared budget or trim the stage scope.',
        identity: { wbs: '0709', task: 'Render canonical escalation packets', feature: 'A6' },
        now: NOW,
        ...overrides,
    };
}

describe('escalationFingerprint', () => {
    test('is deterministic for the same failure identity and differs otherwise', () => {
        const parts = { runId: 'r1', trigger: 'tripwire' as const, gateId: 'hard-budget', evidenceRefs: ['a'] };
        expect(escalationFingerprint(parts)).toBe(escalationFingerprint(parts));
        expect(escalationFingerprint({ ...parts, gateId: 'retry-exhausted' })).not.toBe(escalationFingerprint(parts));
    });
});

describe('decisionKindForGate', () => {
    test('maps the closed trip-wire catalog and defaults unknowns to inspection', () => {
        expect(decisionKindForGate('retry-exhausted')).toBe('retry');
        expect(decisionKindForGate('hard-budget')).toBe('raise_budget');
        expect(decisionKindForGate('capability-denied')).toBe('grant_capability');
        expect(decisionKindForGate('proof-invalidated')).toBe('inspect_failure');
        expect(decisionKindForGate('output-drop')).toBe('inspect_failure');
        expect(decisionKindForGate('terminal-failure')).toBe('inspect_failure');
        expect(decisionKindForGate('never-seen')).toBe('inspect_failure');
    });
});

describe('extractProofDigest', () => {
    test('finds a sha256 digest among evidence refs', () => {
        expect(extractProofDigest(['a.json', 'digest sha256:0123456789abcdef0123'])).toBe(
            'sha256:0123456789abcdef0123',
        );
        expect(extractProofDigest(['a.json'])).toBeUndefined();
    });
});

describe('buildEscalationPacket', () => {
    test('projects the versioned packet with goal, ids, gate, evidence refs, and decision (R1)', () => {
        const packet = buildEscalationPacket(tripwireInput());
        expect(packet.schemaVersion).toBe(1);
        expect(packet.trigger).toBe('tripwire');
        expect(packet.lifecycleState).toBe('tripwire-fail');
        expect(packet.goal).toEqual({ workflow: 'task-pipeline', node: 'test' });
        expect(packet.identity).toEqual({ wbs: '0709', task: 'Render canonical escalation packets', feature: 'A6' });
        expect(packet.ids).toEqual({ runId: 'run-42', actionId: 'run-42:test' });
        expect(packet.lastFailedGate.id).toBe('hard-budget');
        expect(packet.lastFailedGate.kind).toBe('agent.run');
        expect(packet.attempts).toEqual({ observed: 'tokens used 120000', threshold: 'max-tokens 100000' });
        expect(packet.proofDigest).toBe('sha256:abcdef0123456789abcd');
        expect(packet.decision.kind).toBe('raise_budget');
        expect(packet.decision.reason).toContain('raise the declared budget');
        expect(packet.evidence.artifactRefs).toContain('.spur/run/run-42-budget.json');
        expect(packet.fingerprint).toBe(
            escalationFingerprint({
                runId: 'run-42',
                trigger: 'tripwire',
                gateId: 'hard-budget',
                evidenceRefs: ['.spur/run/run-42-budget.json', 'sha256:abcdef0123456789abcd'],
            }),
        );
    });

    test('carries references only — never raw payloads — and redacts + bounds strings (R2/R3)', () => {
        const packet = buildEscalationPacket(
            tripwireInput({
                observed: `secret token=super-secret-value ${'x'.repeat(5000)}`,
                decisionReason: 'api_key=sk-1234567890abcdef must rotate',
            }),
        );
        const serialized = JSON.stringify(packet);
        expect(serialized).not.toContain('super-secret-value');
        expect(serialized).not.toContain('sk-1234567890abcdef');
        expect(serialized).not.toContain('x'.repeat(1000));
        expect(serialized).toContain('[REDACTED]');
        expect(packet.evidence.artifactRefs.every((ref) => ref.length <= 201)).toBe(true);
    });

    test('terminal failure packets use the failed lifecycle and inspection default', () => {
        const packet = buildEscalationPacket(
            tripwireInput({
                trigger: 'terminal-failure',
                gateId: 'terminal-failure',
                gateKind: 'workflow.run.finalized',
                response: undefined,
                evidenceRefs: [],
                decisionReason: 'verify gate failed twice',
            }),
        );
        expect(packet.lifecycleState).toBe('failed');
        expect(packet.decision.kind).toBe('inspect_failure');
        expect(packet.proofDigest).toBeUndefined();
    });
});

describe('renderEscalationMarkdown', () => {
    test('renders the optional human view from the packet (R4)', () => {
        const md = renderEscalationMarkdown(buildEscalationPacket(tripwireInput()));
        expect(md).toContain('# Escalation ');
        expect(md).toContain('**Task:** 0709');
        expect(md).toContain('**Feature:** A6');
        expect(md).toContain('**raise_budget**');
        expect(md).toContain('.spur/run/run-42-budget.json');
    });
});
