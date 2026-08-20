import { describe, expect, test } from 'bun:test';
import { systemEventCatalogEntry } from '../../src/services/event-names';
import {
    buildSystemEventEnvelope,
    isSystemEventEnvelopeV2,
    projectStoredSystemEventEnvelope,
    systemEventProjectContext,
} from '../../src/services/system-event-envelope';

function requireEntry(name: string) {
    const entry = systemEventCatalogEntry(name);
    if (!entry) throw new Error(`catalog entry missing: ${name}`);
    return entry;
}

const project = systemEventProjectContext('/workspace/acme');

describe('buildSystemEventEnvelope', () => {
    test('builds the canonical v2 project, producer, correlation, and presentation shape', () => {
        const envelope = buildSystemEventEnvelope(
            requireEntry('workflow.action.done'),
            {
                runId: 'run-42',
                executionId: 'exec-7',
                actionId: 'act-3',
                node: 'verify',
                kind: 'agent.run',
                durationMs: 125,
                ok: true,
                outcome: 'done',
            },
            project,
        );

        expect(envelope.schemaVersion).toBe(2);
        expect(envelope.context.project).toEqual({ name: 'acme', root: '/workspace/acme' });
        expect(envelope.context.producer).toEqual({
            package: '@gobing-ai/ts-dual-workflow-engine',
            subsystem: 'workflow',
        });
        expect(envelope.context.correlation).toEqual({
            runId: 'run-42',
            executionId: 'exec-7',
            actionId: 'act-3',
        });
        expect(envelope.presentation.action).toEqual({
            label: 'Trace workflow run',
            kind: 'command',
            value: 'spur workflow trace run-42',
        });
        expect(envelope.presentation.fields).toContainEqual({ label: 'Node', value: 'verify' });
    });

    test('presentation severity is taken from the producer payload, not inferred from drained', () => {
        const entry = requireEntry('queue.consumer.stopped');

        const fromProducer = buildSystemEventEnvelope(
            entry,
            { stoppedAt: 1, drainTimeoutMs: 30_000, inFlightAtStop: 0, drained: true, severity: 'info' },
            project,
        );
        expect(fromProducer.presentation.severity).toBe('info');

        const incompleteDrain = buildSystemEventEnvelope(
            entry,
            { stoppedAt: 1, drainTimeoutMs: 30_000, inFlightAtStop: 2, drained: false, severity: 'warning' },
            project,
        );
        expect(incompleteDrain.presentation.severity).toBe('warning');

        const explicit = buildSystemEventEnvelope(entry, { drained: false, severity: 'error' }, project);
        expect(explicit.presentation.severity).toBe('error');
        expect(fromProducer.data?.severity).toBe('info');
    });

    test('metadata-only is a bounded allow-list and redacts before projection bounds', () => {
        const secret = 'local-secret-value';
        const envelope = buildSystemEventEnvelope(
            requireEntry('queue.job.failed'),
            {
                jobId: 'job-1',
                type: 'task-action',
                attempt: 3,
                maxRetries: 3,
                error: `authorization=Bearer ${secret}`,
                payload: { prompt: secret },
                details: [{ body: secret }],
                stdout: secret.repeat(200),
                metadata: { apiKey: secret, note: `prefix ${secret}` },
                rawCommand: 'spur task update 0526 done',
                commandEnvironment: { PATH: '/unsafe' },
                promptText: 'private prompt',
                messageBody: 'private message',
                businessRecord: { customer: 'private' },
                stdoutChunk: 'unbounded output',
                findingDetails: [{ path: '/private' }],
            },
            project,
            [secret],
        );

        expect(envelope.context.correlation.jobId).toBe('job-1');
        expect(envelope.data?.payload).toBeUndefined();
        expect(envelope.data?.details).toBeUndefined();
        expect(envelope.data?.stdout).toBeUndefined();
        expect(envelope.data?.rawCommand).toBeUndefined();
        expect(envelope.data?.commandEnvironment).toBeUndefined();
        expect(envelope.data?.promptText).toBeUndefined();
        expect(envelope.data?.messageBody).toBeUndefined();
        expect(envelope.data?.businessRecord).toBeUndefined();
        expect(envelope.data?.stdoutChunk).toBeUndefined();
        expect(envelope.data?.findingDetails).toBeUndefined();
        expect(JSON.stringify(envelope)).not.toContain(secret);
        expect(JSON.stringify(envelope)).toContain('[REDACTED]');
    });

    test('normalizes nested agent correlation without retaining raw command material', () => {
        const envelope = buildSystemEventEnvelope(
            requireEntry('agent.invoke.exit'),
            {
                agent: 'codex',
                operation: 'run',
                correlation: { runId: 'run-9', executionId: 'exec-2', actionId: 'act-1' },
                command: 'codex --dangerous',
                env: { TOKEN: 'unsafe' },
                exitCode: 1,
            },
            project,
        );

        expect(envelope.context.correlation).toEqual({
            runId: 'run-9',
            executionId: 'exec-2',
            actionId: 'act-1',
        });
        expect(envelope.data?.command).toBeUndefined();
        expect(envelope.data?.env).toBeUndefined();
    });

    test('re-projects only the derived presentation on a valid v2 history row (R1/R9)', () => {
        const original = buildSystemEventEnvelope(
            requireEntry('task.updated'),
            { entity: { kind: 'task', id: '0526' } },
            project,
        );
        expect(isSystemEventEnvelopeV2(original)).toBe(true);
        const projected = projectStoredSystemEventEnvelope(requireEntry('task.updated'), original, project);
        // schemaVersion, data, and context are preserved byte-for-byte; only the
        // derived presentation is recomputed by the current exhaustive presenter.
        expect(projected.schemaVersion).toBe(original.schemaVersion);
        expect(projected.data).toBe(original.data);
        expect(projected.context).toBe(original.context);
        expect(projected.presentation.summary).toBe('[task] 0526'); // old-row fallback without mutation data
        expect(projected.presentation.description).toBe(original.presentation.description);
        expect(projected.presentation.severity).toBe(original.presentation.severity);
    });

    test('0545 R3 — rows written before routing attribution project cleanly without it', () => {
        // Pre-0545 agent.invoke rows carry no `routing` metadata. Both the
        // raw-stored legacy shape (rebuilt through the builder) and a canonical
        // v2 envelope must read back without error and without fabricating a
        // routing block — absence stays absent (R2/R3).
        const legacyRaw = {
            agent: 'pi',
            operation: 'prompt',
            label: 'ai-runner.pi.prompt',
            exitCode: 0,
        };
        const fromRaw = projectStoredSystemEventEnvelope(requireEntry('agent.invoke.start'), legacyRaw, project);
        expect(fromRaw.schemaVersion).toBe(2);
        expect(fromRaw.data?.routing).toBeUndefined();
        expect(fromRaw.data?.agent).toBe('pi');

        const storedV2 = buildSystemEventEnvelope(requireEntry('agent.invoke.start'), legacyRaw, project);
        expect(isSystemEventEnvelopeV2(storedV2)).toBe(true);
        const projected = projectStoredSystemEventEnvelope(requireEntry('agent.invoke.start'), storedV2, project);
        // Stored data/context survive byte-for-byte; absence of routing stays absent.
        expect(projected.data).toBe(storedV2.data);
        expect(projected.context).toBe(storedV2.context);
        expect((projected.data as Record<string, unknown> | null)?.routing).toBeUndefined();
    });

    test('omits command remediation when a payload-derived run id is not a conservative identifier', () => {
        const envelope = buildSystemEventEnvelope(
            requireEntry('workflow.action.failed_continue'),
            { runId: '$(touch /tmp/spur-review-should-not-exist)', outcome: 'failed' },
            project,
        );

        expect(envelope.context.correlation.runId).toBe('$(touch /tmp/spur-review-should-not-exist)');
        expect(envelope.presentation.action).toBeUndefined();
        expect(JSON.stringify(envelope)).not.toContain('spur workflow trace');
    });

    test('rejects malformed v2-shaped stored rows instead of trusting unsafe fields', () => {
        const malformed = {
            schemaVersion: 2,
            data: { message: 'must-not-survive' },
            context: {
                project,
                producer: { package: 'evil', subsystem: 'fake' },
                correlation: {},
            },
            presentation: { severity: 'fatal', summary: 'fake', description: 'fake', fields: [] },
        };

        expect(isSystemEventEnvelopeV2(malformed)).toBe(false);
        expect(projectStoredSystemEventEnvelope(requireEntry('task.updated'), malformed, project)).toEqual(
            expect.objectContaining({
                schemaVersion: 2,
                data: null,
                context: expect.objectContaining({ producer: { package: 'spur', subsystem: 'unknown' } }),
                presentation: expect.objectContaining({ severity: 'warning', summary: 'Unknown system event' }),
            }),
        );
    });

    test('fresh event construction does not trust a payload that impersonates envelope v2', () => {
        const forged = buildSystemEventEnvelope(
            requireEntry('task.updated'),
            {
                schemaVersion: 2,
                data: { message: 'must-not-survive' },
                context: { project, producer: { package: 'spur', subsystem: 'fake' }, correlation: {} },
                presentation: { summary: 'fake', description: 'fake', fields: [] },
            },
            project,
        );
        expect(JSON.stringify(forged)).not.toContain('must-not-survive');
        expect(forged.context.producer.subsystem).toBe('planning');
    });

    test('unknown and circular malformed payloads fail safe with bounded generic output', () => {
        const circular: Record<string, unknown> = { label: 'unknown' };
        circular.self = circular;
        const envelope = buildSystemEventEnvelope(undefined, circular, project);

        expect(envelope.schemaVersion).toBe(2);
        expect(envelope.context.producer).toEqual({ package: 'spur', subsystem: 'unknown' });
        expect(envelope.presentation.summary).toBe('Unknown system event');
        expect(JSON.stringify(envelope).length).toBeLessThan(2_000);
    });

    test('hostile stored getters cannot escape failure isolation', () => {
        const hostile = new Proxy(
            {},
            {
                get() {
                    throw new Error('hostile getter');
                },
            },
        );

        expect(isSystemEventEnvelopeV2(hostile)).toBe(false);
        expect(projectStoredSystemEventEnvelope(requireEntry('task.updated'), hostile, project)).toEqual(
            expect.objectContaining({ schemaVersion: 2, data: null }),
        );
    });

    test('projectTablePresentation derives correlators, actionLabel, and agent without opaque IDs', async () => {
        const { projectTablePresentation } = await import('../../src/services/system-event-envelope');
        const entry = requireEntry('workflow.action.start');
        const result = projectTablePresentation({
            entry,
            data: {
                workflowName: 'task-pipeline',
                nodeLabel: 'Implement Task',
                kind: 'agent.run',
                routing: { executor: 'sp:super-coder' },
            },
            correlation: {
                runId: '123e4567-e89b-12d3-a456-426614174000',
                entityKind: 'task',
                entityId: '0605',
                sequence: 3,
            },
            presentation: {
                severity: 'info',
                summary: '[workflow] task-pipeline · Implement Task',
                description: 'test',
                fields: [],
            },
            actor: 'system',
        });

        expect(result.correlators).toBe('task-pipeline · Implement Task · agent.run · task:0605 · #3');
        expect(result.actionLabel).toBe('agent.run');
        expect(result.agent).toBe('sp:super-coder');
    });

    test('projectTablePresentation omits Agent for pure engine rows even with actor present', async () => {
        const { projectTablePresentation } = await import('../../src/services/system-event-envelope');
        const entry = requireEntry('workflow.transition');
        const result = projectTablePresentation({
            entry,
            data: {
                workflowName: 'task-pipeline',
                from: 'precheck',
                to: 'implement',
            },
            correlation: { sequence: 1 },
            presentation: {
                severity: 'info',
                summary: '[workflow] task-pipeline · precheck -> implement',
                description: 'test',
                fields: [],
            },
            actor: '@gobing-ai/ts-dual-workflow-engine',
        });

        expect(result.agent).toBeUndefined();
    });

    test('buildSystemEventEnvelope and projectStoredSystemEventEnvelope project agent from actor when appropriate', () => {
        const entry = requireEntry('task.updated');
        const envelope = buildSystemEventEnvelope(
            entry,
            { entity: { kind: 'task', id: '0605' } },
            project,
            [],
            'sp:super-planner',
        );
        expect(envelope.presentation.agent).toBe('sp:super-planner');

        const reprojected = projectStoredSystemEventEnvelope(entry, envelope, project, [], 'sp:super-planner');
        expect(reprojected.presentation.agent).toBe('sp:super-planner');
    });
});
