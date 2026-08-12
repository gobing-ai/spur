import { describe, expect, test } from 'bun:test';
import type { SystemEventCatalogEntry } from '../../src/services/event-names';
import {
    normalizeSystemEventPayload,
    PLANNING_EVENT_NAMES,
    SYSTEM_EVENT_CATALOG,
    SYSTEM_EVENT_CATALOG_METADATA,
    SYSTEM_EVENT_DEFAULT_NAMES,
    SYSTEM_EVENT_DIAGNOSTIC_NAMES,
    SYSTEM_EVENT_NAMES,
    SYSTEM_EVENT_PERSISTED_NAMES,
    SYSTEM_EVENT_PREFIXES,
    SYSTEM_EVENT_STREAMED_NAMES,
    systemEventCatalogEntry,
} from '../../src/services/event-names';

/** Fail-loud catalog lookup so tests get a definite entry without the non-null assertion
 * (forbidden by biome lint/style/noNonNullAssertion under --error-on-warnings). */
function requireEntry(name: string): SystemEventCatalogEntry {
    const entry = systemEventCatalogEntry(name);
    if (!entry) throw new Error(`catalog entry missing: ${name}`);
    return entry;
}

describe('SYSTEM_EVENT_CATALOG', () => {
    test('includes the core task lifecycle events', () => {
        expect(SYSTEM_EVENT_NAMES).toContain('task.created');
        expect(SYSTEM_EVENT_NAMES).toContain('task.updated');
        expect(SYSTEM_EVENT_NAMES).toContain('task.transitioned');
    });

    test('includes the core feature lifecycle events', () => {
        expect(SYSTEM_EVENT_NAMES).toContain('feature.created');
        expect(SYSTEM_EVENT_NAMES).toContain('feature.updated');
        expect(SYSTEM_EVENT_NAMES).toContain('feature.transitioned');
    });

    test('includes queue and scheduler lifecycle events', () => {
        expect(SYSTEM_EVENT_NAMES).toContain('queue.job.enqueued');
        expect(SYSTEM_EVENT_NAMES).toContain('queue.job.completed');
        expect(SYSTEM_EVENT_NAMES).toContain('queue.job.failed');
        expect(SYSTEM_EVENT_NAMES).toContain('scheduler.job.executed');
    });

    test('includes message lifecycle events (task 0193/0204 — inbox IPC)', () => {
        // Adding these here flows to BOTH the system_events tap (persistence) and the
        // SSE stream (live board) — one source for both consumers.
        expect(SYSTEM_EVENT_NAMES).toContain('message.sent');
        expect(SYSTEM_EVENT_NAMES).toContain('message.replied');
    });

    test('includes workflow and HITL lifecycle events', () => {
        expect(SYSTEM_EVENT_NAMES).toContain('workflow.run.started');
        expect(SYSTEM_EVENT_NAMES).toContain('workflow.run.finalized');
        expect(SYSTEM_EVENT_NAMES).toContain('workflow.phase');
        expect(SYSTEM_EVENT_NAMES).toContain('workflow.transition');
        expect(SYSTEM_EVENT_NAMES).toContain('workflow.action.started');
        expect(SYSTEM_EVENT_NAMES).toContain('workflow.action.finished');
        expect(SYSTEM_EVENT_NAMES).toContain('workflow.hitl.ask');
        expect(SYSTEM_EVENT_NAMES).toContain('workflow.hitl.response');
    });

    test('has unique names and exposes DEFAULT/DIAGNOSTIC partition from the catalog', () => {
        expect(SYSTEM_EVENT_CATALOG.length).toBeGreaterThan(0);
        expect(new Set(SYSTEM_EVENT_NAMES).size).toBe(SYSTEM_EVENT_NAMES.length);
        // Diagnostic events are excluded from the persisted/streamed sets so the
        // tap and SSE filter them out by default (R5).
        expect(SYSTEM_EVENT_PERSISTED_NAMES.length).toBeLessThan(SYSTEM_EVENT_NAMES.length);
        expect(SYSTEM_EVENT_STREAMED_NAMES).toEqual(SYSTEM_EVENT_PERSISTED_NAMES);
        expect(PLANNING_EVENT_NAMES).toEqual(SYSTEM_EVENT_NAMES);
        // Diagnostic tier names are non-empty and disjoint from defaults.
        expect(SYSTEM_EVENT_DIAGNOSTIC_NAMES.length).toBeGreaterThan(0);
        const defaultSet = new Set(SYSTEM_EVENT_DEFAULT_NAMES);
        for (const name of SYSTEM_EVENT_DIAGNOSTIC_NAMES) expect(defaultSet.has(name)).toBe(false);
    });

    test('exposes prefix / renderer / tier metadata for the board', () => {
        expect(SYSTEM_EVENT_PREFIXES).toContain('task');
        expect(SYSTEM_EVENT_PREFIXES).toContain('workflow');
        expect(SYSTEM_EVENT_PREFIXES).toContain('rule');
        expect(SYSTEM_EVENT_PREFIXES).toContain('agent');
        expect(SYSTEM_EVENT_PREFIXES).toContain('bus');
        expect(SYSTEM_EVENT_CATALOG_METADATA).toContainEqual(
            expect.objectContaining({
                name: 'workflow.action.started',
                prefix: 'workflow',
                source: 'workflow',
                tier: 'default',
                renderer: 'workflow-action',
            }),
        );
        expect(SYSTEM_EVENT_CATALOG_METADATA).toContainEqual(
            expect.objectContaining({
                name: 'bus.handler.error',
                prefix: 'bus',
                source: 'bus',
                tier: 'diagnostic',
                renderer: 'bus',
            }),
        );
        for (const entry of SYSTEM_EVENT_CATALOG) {
            expect(entry.prefix.length).toBeGreaterThan(0);
            expect(entry.renderer.length).toBeGreaterThan(0);
            expect(entry.tier === 'default' || entry.tier === 'diagnostic').toBe(true);
            // `persisted` and `streamed` flags now describe catalog capability
            // (true for any tier that the runtime *can* persist or stream when
            // its tier gate is on). Tier is the runtime switch — diagnostic
            // entries' flags stay `true` so the tap can subscribe when the
            // `SPUR_DIAGNOSTIC_EVENTS` toggle fires.
            expect(entry.persisted).toBe(true);
            expect(entry.streamed).toBe(true);
            expect(entry.producerPackage.length).toBeGreaterThan(0);
            expect(entry.subsystem.length).toBeGreaterThan(0);
            expect(entry.description.length).toBeGreaterThan(0);
            expect(entry.metadataFields.length).toBeGreaterThan(0);
            expect(entry.remediationKind.length).toBeGreaterThan(0);
        }
    });

    test('covers the new agent / rule / workflow engine / diagnostic families (task 0221)', () => {
        // agent.* (R3 producer wiring)
        for (const name of [
            'agent.invoke.start',
            'agent.invoke.exit',
            'agent.started',
            'agent.stopped',
            'agent.message.sent',
        ]) {
            expect(SYSTEM_EVENT_NAMES).toContain(name);
        }
        // rule.* (R3 producer wiring)
        for (const name of [
            'rule.run.start',
            'rule.eval.start',
            'rule.eval.done',
            'rule.eval.error',
            'rule.run.done',
        ]) {
            expect(SYSTEM_EVENT_NAMES).toContain(name);
        }
        // workflow.* native engine names (R4 alias policy)
        for (const name of [
            'workflow.run.started',
            'workflow.run.done',
            'workflow.run.failed',
            'workflow.run.paused',
            'workflow.run.resumed',
            'workflow.run.reseeded',
            'workflow.node.enter',
            'workflow.node.transition',
            'workflow.action.start',
            'workflow.action.done',
            'workflow.action.failed_continue',
            'workflow.guard.evaluated',
            'workflow.transition.requested',
            'workflow.transition.denied',
            'workflow.hitl.note',
            'workflow.custom',
        ]) {
            expect(SYSTEM_EVENT_NAMES).toContain(name);
        }
        // process.started via runtime executor (R3 process wiring)
        expect(SYSTEM_EVENT_NAMES).toContain('process.started');
        // api + bus diagnostic entries
        expect(SYSTEM_EVENT_NAMES).toContain('api.request.error');
        expect(SYSTEM_EVENT_DIAGNOSTIC_NAMES).toContain('bus.handler.error');
        expect(SYSTEM_EVENT_DIAGNOSTIC_NAMES).toContain('bus.emit.done');
        expect(SYSTEM_EVENT_DIAGNOSTIC_NAMES).toContain('bus.emit.noop');
        expect(SYSTEM_EVENT_DIAGNOSTIC_NAMES).toContain('bus.handler.async.enqueued');
    });

    test('registers workflow.agent and workflow.steering catalog entries (task 0367 R1/R2)', () => {
        // R1: unified agent execution lifecycle — single entry, kind-discriminated
        const agentEntry = SYSTEM_EVENT_CATALOG.find((e) => e.name === 'workflow.agent');
        expect(agentEntry).toBeDefined();
        expect(agentEntry?.source).toBe('workflow');
        expect(agentEntry?.renderer).toBe('workflow-agent');
        expect(agentEntry?.payloadPolicy).toBe('redacted');
        // R5: diagnostic tier — output/heartbeat are high-volume
        expect(agentEntry?.tier).toBe('diagnostic');
        expect(SYSTEM_EVENT_DIAGNOSTIC_NAMES).toContain('workflow.agent');

        // R2: steering acknowledgements — default tier, redacted
        const steeringEntry = SYSTEM_EVENT_CATALOG.find((e) => e.name === 'workflow.steering');
        expect(steeringEntry).toBeDefined();
        expect(steeringEntry?.source).toBe('workflow');
        expect(steeringEntry?.renderer).toBe('workflow-steering');
        expect(steeringEntry?.payloadPolicy).toBe('redacted');
        expect(steeringEntry?.tier).toBe('default');
        expect(SYSTEM_EVENT_DEFAULT_NAMES).toContain('workflow.steering');
    });

    test('registers team.* catalog entries (task 0371 R1)', () => {
        const names = [
            'team.up',
            'team.down',
            'team.member.assigned',
            'team.member.started',
            'team.member.stopped',
        ] as const;
        for (const name of names) {
            const entry = requireEntry(name);
            expect(entry.source).toBe('team');
            expect(entry.renderer).toBe('team');
            expect(entry.payloadPolicy).toBe('metadata-only');
            expect(entry.tier).toBe('default');
            expect(SYSTEM_EVENT_DEFAULT_NAMES).toContain(name);
            expect(SYSTEM_EVENT_PREFIXES).toContain('team');
        }
    });

    test('registers history.* catalog entries (task 0471 R1)', () => {
        const cases = [
            { name: 'history.import.completed', renderer: 'history-import' },
            { name: 'history.analyze.completed', renderer: 'history-analyze' },
            { name: 'history.daily.failed', renderer: 'history-daily' },
        ] as const;
        for (const { name, renderer } of cases) {
            const entry = requireEntry(name);
            expect(entry.source).toBe('history');
            expect(entry.renderer).toBe(renderer);
            // R1 + Design: metadata-only, never raw-safe (history payloads quote source paths).
            expect(entry.payloadPolicy).toBe('metadata-only');
            expect(entry.tier).toBe('default');
            expect(SYSTEM_EVENT_DEFAULT_NAMES).toContain(name);
            expect(SYSTEM_EVENT_PERSISTED_NAMES).toContain(name);
            expect(SYSTEM_EVENT_STREAMED_NAMES).toContain(name);
            expect(SYSTEM_EVENT_PREFIXES).toContain('history');
        }
    });
});

describe('normalizeSystemEventPayload (task 0367 R3/R4)', () => {
    test('preserves 0365 envelope correlation fields under redacted policy (R3)', () => {
        const entry = requireEntry('workflow.agent');
        const payload = {
            schemaVersion: 1,
            eventId: 'evt-001',
            sequence: 42,
            runId: 'run-001',
            executionId: 'exec-001',
            actionId: 'act-001',
            node: 'step-3',
            kind: 'started',
            metadata: { correlationId: 'corr-1' },
            durationMs: 1500,
            usage: 'unavailable',
            outcome: 'success',
            reason: 'completed',
            body: 'agent output text',
        };
        const result = normalizeSystemEventPayload(entry, payload);
        expect(result).not.toBeNull();
        // Envelope fields survive (R3)
        expect(result?.schemaVersion).toBe(1);
        expect(result?.eventId).toBe('evt-001');
        expect(result?.sequence).toBe(42);
        expect(result?.runId).toBe('run-001');
        expect(result?.executionId).toBe('exec-001');
        expect(result?.actionId).toBe('act-001');
        expect(result?.node).toBe('step-3');
        expect(result?.kind).toBe('started');
        expect(result?.metadata).toEqual({ correlationId: 'corr-1' });
        expect(result?.durationMs).toBe(1500);
        expect(result?.usage).toBe('unavailable');
        expect(result?.outcome).toBe('success');
        expect(result?.reason).toBe('completed');
        // High-risk bodies are omitted rather than retained in the envelope.
        expect(result?.body).toBeUndefined();
    });

    test('preserves 0365 envelope fields under raw-safe policy (R3)', () => {
        const entry = requireEntry('workflow.steering');
        // raw-safe is not used by these entries, but test the path anyway
        const rawSafeEntry = { ...entry, payloadPolicy: 'raw-safe' as const };
        const payload = {
            schemaVersion: 1,
            commandId: 'cmd-1',
            runId: 'run-001',
            actionId: 'act-001',
            operation: 'continue',
            actor: 'operator',
            accepted: true,
            state: 'running',
            version: 2,
            note: 'proceed with caution',
        };
        const result = normalizeSystemEventPayload(rawSafeEntry, payload);
        expect(result).not.toBeNull();
        expect(result?.schemaVersion).toBe(1);
        expect(result?.commandId).toBe('cmd-1');
        expect(result?.runId).toBe('run-001');
        expect(result?.actionId).toBe('act-001');
        expect(result?.operation).toBe('continue');
        expect(result?.actor).toBe('operator');
        expect(result?.accepted).toBe(true);
        expect(result?.state).toBe('running');
        expect(result?.version).toBe(2);
        expect(result?.note).toBe('proceed with caution');
    });

    test('redacts 0365 SECRET_PATTERN matches in string values (R4)', () => {
        const entry = requireEntry('workflow.agent');
        const payload = {
            kind: 'output',
            runId: 'run-001',
            body: 'the api_key=sk-live-abc1234567890 was leaked',
            reason: 'bearer token=abc123 in stderr',
            arbitraryCustomerRecord: { account: 'must not persist' },
        };
        const result = normalizeSystemEventPayload(entry, payload);
        expect(result).not.toBeNull();
        // body is excluded entirely.
        expect(result?.body).toBeUndefined();
        expect(result?.arbitraryCustomerRecord).toBeUndefined();
        // reason is not in the fixed-key list → secret scan applies
        expect(result?.reason).not.toContain('bearer');
        expect(result?.reason).not.toContain('abc123');
        expect(result?.reason).toContain('[REDACTED]');
    });

    test('redacts secrets in nested objects under raw-safe policy (R4)', () => {
        const entry = requireEntry('workflow.agent');
        const rawSafeEntry = { ...entry, payloadPolicy: 'raw-safe' as const };
        const payload = {
            kind: 'output',
            metadata: {
                correlationId: 'corr-1',
                secret: 'password=hunter2',
            },
        };
        const result = normalizeSystemEventPayload(rawSafeEntry, payload);
        expect(result).not.toBeNull();
        const metadata = result?.metadata as { correlationId: string; secret: string };
        expect(metadata.correlationId).toBe('corr-1');
        expect(metadata.secret).toContain('[REDACTED]');
        expect(metadata.secret).not.toContain('hunter2');
    });

    test('redacts configured secrets in primitive payloads and nested arrays (R4)', () => {
        const entry = requireEntry('workflow.agent');
        const configuredSecret = 'local-config-secret';

        const primitive = normalizeSystemEventPayload(entry, configuredSecret, [configuredSecret]);
        expect(primitive).toEqual({ value: '[REDACTED]' });

        const rawSafeEntry = { ...entry, payloadPolicy: 'raw-safe' as const };
        const nested = normalizeSystemEventPayload(
            rawSafeEntry,
            { metadata: { values: ['plain', `prefix:${configuredSecret}:suffix`] } },
            [configuredSecret],
        );
        expect(JSON.stringify(nested)).toContain('[REDACTED]');
        expect(JSON.stringify(nested)).not.toContain(configuredSecret);
    });

    test('bounds long string values to prevent truncation exposing redacted material (R4)', () => {
        const entry = requireEntry('workflow.agent');
        const rawSafeEntry = { ...entry, payloadPolicy: 'raw-safe' as const };
        const longText = 'x'.repeat(500);
        const payload = { kind: 'output', reason: longText };
        const result = normalizeSystemEventPayload(rawSafeEntry, payload);
        expect(result).not.toBeNull();
        expect((result?.reason as string).length).toBeLessThanOrEqual(257); // 256 + ellipsis
    });

    test('returns null for null/undefined payloads', () => {
        const entry = requireEntry('workflow.agent');
        expect(normalizeSystemEventPayload(entry, null)).toBeNull();
        expect(normalizeSystemEventPayload(entry, undefined)).toBeNull();
    });

    test('wraps primitive payloads in { value }', () => {
        const entry = requireEntry('workflow.agent');
        const result = normalizeSystemEventPayload(entry, 42);
        expect(result).toEqual({ value: 42 });
    });
});

describe('normalizeSystemEventPayload — history.* (task 0471 R1/R2)', () => {
    test('metadata-only strips text fields and redacts secrets from history payloads', () => {
        const entry = requireEntry('history.import.completed');
        const configuredSecret = 'sk-ant-supersecret-9876543210';
        const payload = {
            sources: 10,
            files: 42,
            messages: 1337,
            durationMs: 52_400,
            // High-risk text fields must be stripped to [redacted].
            message: 'imported from /Users/robin/.claude/projects',
            content: `raw body quoting secret ${configuredSecret}`,
            // Safe metadata survives.
            cwd: '/Users/robin/xprojects/spur-new',
            artifactPath: '/tmp/x/analyze.json',
        };
        const result = normalizeSystemEventPayload(entry, payload, [configuredSecret]);
        expect(result).not.toBeNull();
        expect(result?.sources).toBe(10);
        expect(result?.files).toBe(42);
        expect(result?.messages).toBe(1337);
        expect(result?.durationMs).toBe(52_400);
        expect(result?.message).toBeUndefined();
        expect(result?.content).toBeUndefined();
        expect(JSON.stringify(result)).not.toContain(configuredSecret);
        expect(result?.cwd).toBe('/Users/robin/xprojects/spur-new');
    });

    test('history.daily.failed keeps detail (bounded) and outcome, strips message', () => {
        const entry = requireEntry('history.daily.failed');
        const payload = {
            exitCode: 2,
            detail: 'codex import timed out after 600000ms',
            message: 'Error: ECONNREFUSED redis://localhost:6379',
        };
        const result = normalizeSystemEventPayload(entry, payload);
        expect(result).not.toBeNull();
        expect(result?.exitCode).toBe(2);
        expect(result?.detail).toBe('codex import timed out after 600000ms');
        expect(result?.message).toBeUndefined();
    });
});
