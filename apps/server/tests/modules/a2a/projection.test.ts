/**
 * G9 task 1336 — the A2A wire projection.
 *
 * The failure modes that matter here are the ones with no server in front of them: a card that
 * advertises a capability this surface does not have, a state mapping that reads a cancel as a
 * failure (the run exits `errored` when stopped), and an error envelope a client cannot parse.
 */
import { describe, expect, test } from 'bun:test';
import {
    A2A_PROTOCOL_BINDING,
    A2A_PROTOCOL_VERSION,
    a2aError,
    agentCard,
    projectState,
    textParts,
} from '../../../src/modules/a2a/projection';

describe('A2A card', () => {
    test('advertises protocol 1.0 over HTTP+JSON and nothing it cannot do', () => {
        const card = agentCard({ instanceId: 'proj-coder', executor: 'claude', origin: 'http://localhost:3000' }) as {
            name: string;
            supportedInterfaces: { url: string; protocolBinding: string; protocolVersion: string }[];
            capabilities: {
                streaming: boolean;
                pushNotifications: boolean;
                extensions: Array<{ uri: string; description?: string }>;
            };
        };
        expect(A2A_PROTOCOL_VERSION).toBe('1.0');
        expect(A2A_PROTOCOL_BINDING).toBe('HTTP+JSON');
        expect(card.name).toBe('proj-coder');
        expect(card.supportedInterfaces).toEqual([
            {
                url: 'http://localhost:3000/a2a/members/proj-coder',
                protocolBinding: 'HTTP+JSON',
                protocolVersion: '1.0',
            },
        ]);
        expect(card.capabilities).toEqual({
            streaming: false,
            pushNotifications: false,
            extensions: [{ uri: 'urn:spur:write-fencing:v1', description: 'The member fences its own working tree' }],
        });
    });

    test('a member with no resolved executor still describes itself', () => {
        const card = agentCard({ instanceId: 'proj-coder', executor: '', origin: 'http://x' }) as {
            description: string;
        };
        expect(card.description).toBe('Spur fleet member proj-coder');
    });

    test('a declared role and purpose become the card skill (1421 R4)', () => {
        const card = agentCard({
            instanceId: 'proj-dev',
            executor: 'claude',
            origin: 'http://x',
            role: 'implementer',
            purpose: 'lands the feature tasks',
        }) as { skills: Array<{ id: string; name: string; description: string; tags: string[] }> };
        expect(card.skills).toEqual([
            { id: 'implementer', name: 'implementer', description: 'lands the feature tasks', tags: ['implementer'] },
        ]);
    });

    test('a member with no role still offers one general skill (1421 R4)', () => {
        const card = agentCard({ instanceId: 'proj-dev', executor: 'claude', origin: 'http://x' }) as {
            skills: Array<{ id: string; tags: string[] }>;
            description: string;
        };
        expect(card.skills).toHaveLength(1);
        expect(card.skills[0]?.id).toBe('general');
        expect(card.skills[0]?.tags).toEqual(['general']);
        expect(card.skills[0]).toMatchObject({ description: card.description });
    });
});

describe('A2A state projection', () => {
    test('a cancel outranks the errored exit a stopped run leaves behind', () => {
        expect(projectState({ canceled: true, runStatus: 'errored', messageStatus: 'failed' })).toBe(
            'TASK_STATE_CANCELED',
        );
    });

    test('maps every receipt status', () => {
        expect(projectState({ canceled: false, runStatus: 'exited', messageStatus: 'claimed' })).toBe(
            'TASK_STATE_COMPLETED',
        );
        expect(projectState({ canceled: false, runStatus: 'errored', messageStatus: 'claimed' })).toBe(
            'TASK_STATE_FAILED',
        );
        expect(projectState({ canceled: false, runStatus: 'running', messageStatus: 'claimed' })).toBe(
            'TASK_STATE_WORKING',
        );
    });

    test('with no run row the inbox status decides', () => {
        expect(projectState({ canceled: false, runStatus: null, messageStatus: 'failed' })).toBe('TASK_STATE_FAILED');
        expect(projectState({ canceled: false, runStatus: null, messageStatus: 'claimed' })).toBe('TASK_STATE_WORKING');
        expect(projectState({ canceled: false, runStatus: null, messageStatus: 'queued' })).toBe(
            'TASK_STATE_SUBMITTED',
        );
    });
});

describe('A2A message parts', () => {
    test('joins text parts and ignores everything else', () => {
        expect(textParts([{ text: 'a' }, { data: { x: 1 } }, { text: 'b' }])).toBe('a\nb');
        expect(textParts(undefined)).toBe('');
        expect(textParts([{ text: '   ' }])).toBe('');
    });
});

describe('A2A error envelope', () => {
    test('carries reason and metadata a client can parse', () => {
        const envelope = a2aError(400, 'FAILED_PRECONDITION', 'nope', { reason: 'TASK_NOT_CANCELABLE' }) as {
            error: { code: number; status: string; details: { reason: string }[] };
        };
        expect(envelope.error.code).toBe(400);
        expect(envelope.error.status).toBe('FAILED_PRECONDITION');
        expect(envelope.error.details[0]?.reason).toBe('TASK_NOT_CANCELABLE');
    });

    test('omits details when there is no reason', () => {
        const envelope = a2aError(401, 'UNAUTHENTICATED', 'token required') as { error: Record<string, unknown> };
        expect(envelope.error.details).toBeUndefined();
    });
});
