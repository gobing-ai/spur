import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WorkflowTraceEntry } from '../../src/services/workflow-service';
import {
    actionOutcome,
    outputArtifactForRun,
    partialArtifactForAction,
    persistedTimestamp,
    projectActionTraceResult,
    rowToTraceEntry,
    traceNextAction,
    traceTimestamp,
} from '../../src/services/workflow-trace-projection';

const roots: string[] = [];
function project(): string {
    const root = mkdtempSync(join(tmpdir(), 'spur-trace-proj-'));
    mkdirSync(join(root, '.spur', 'memory', 'runs'), { recursive: true });
    mkdirSync(join(root, '.spur', 'run'), { recursive: true });
    roots.push(root);
    return root;
}
afterAll(() => {
    for (const r of roots) rmSync(r, { recursive: true, force: true });
});

const baseRow = {
    id: 'run-1',
    workflow_name: 'wf',
    mode: 'auto',
    status: 'done',
    started_at: '2026-10-14T10:00:00.000Z',
    completed_at: '2026-10-14T10:00:02.500Z',
    metadata_json: '{}',
};

describe('rowToTraceEntry', () => {
    test('projects a completed row with recorded identity and lineage', () => {
        const entry = rowToTraceEntry(
            {
                ...baseRow,
                terminal_reason: 'completed',
                metadata_json: JSON.stringify({
                    dryRun: true,
                    failureReason: 'boom',
                    workflowVersion: null,
                    definitionDigest: 'sha256:abc',
                    startState: 'review',
                    continuedFrom: 'run-0',
                }),
            },
            '/work/proj',
        );
        expect(entry).toEqual({
            runId: 'run-1',
            workflowName: 'wf',
            mode: 'auto',
            status: 'done',
            startedAt: baseRow.started_at,
            completedAt: baseRow.completed_at,
            isDryRun: true,
            project: { name: 'proj', root: '/work/proj' },
            durationMs: 2500,
            outcome: 'success',
            failureReason: 'boom',
            terminalReason: 'completed',
            version: null,
            definitionDigest: 'sha256:abc',
            startState: 'review',
            continuedFrom: 'run-0',
        });
    });
    test('legacy/unparseable metadata omits identity; running rows get a follow action', () => {
        const entry = rowToTraceEntry(
            { ...baseRow, status: 'running', completed_at: null, metadata_json: 'not json', terminal_reason: '' },
            '/p',
        );
        expect(entry.isDryRun).toBe(false);
        expect(entry.durationMs).toBeNull();
        expect(entry.completedAt).toBeNull();
        expect(entry.outcome).toBe('running');
        expect('version' in entry).toBe(false);
        expect('terminalReason' in entry).toBe(false);
        expect(entry.nextAction).toEqual({
            label: 'Follow run',
            kind: 'command',
            value: 'spur workflow trace run-1 --follow',
        });
        const versioned = rowToTraceEntry(
            { ...baseRow, metadata_json: JSON.stringify({ workflowVersion: '1.2.0', failureReason: '' }) },
            '/p',
        );
        expect(versioned.version).toBe('1.2.0');
        expect('failureReason' in versioned).toBe(false);
        expect(rowToTraceEntry({ ...baseRow, metadata_json: '{"workflowVersion":3}' }, '/p').version).toBeUndefined();
    });
    test('bad timestamps and reversed spans render as unavailable/null', () => {
        const entry = rowToTraceEntry({ ...baseRow, started_at: 'garbage', status: 'weird' }, '/p');
        expect(entry.startedAt).toBe('unavailable');
        expect(entry.durationMs).toBeNull();
        expect(entry.outcome).toBe('unavailable');
        const reversed = rowToTraceEntry(
            { ...baseRow, started_at: baseRow.completed_at, completed_at: baseRow.started_at, status: 'failed' },
            '/p',
        );
        expect(reversed.durationMs).toBeNull();
        expect(reversed.outcome).toBe('failure');
        for (const s of ['pending', 'paused']) expect(rowToTraceEntry({ ...baseRow, status: s }, '/p').outcome).toBe(s);
    });
});

describe('timestamps and outcomes', () => {
    test('traceTimestamp / persistedTimestamp', () => {
        expect(traceTimestamp('2026-10-14T00:00:00Z')).toBe('2026-10-14T00:00:00Z');
        expect(traceTimestamp('nope')).toBe('unavailable');
        expect(persistedTimestamp(0)).toBe('1970-01-01T00:00:00.000Z');
        expect(persistedTimestamp(Number.NaN)).toBe('unavailable');
    });
    test('actionOutcome', () => {
        expect(actionOutcome('running', null)).toBe('running');
        expect(actionOutcome('pending', true)).toBe('pending');
        expect(actionOutcome('done', true)).toBe('success');
        expect(actionOutcome('done', false)).toBe('failure');
        expect(actionOutcome('done', null)).toBe('unavailable');
    });
});

describe('traceNextAction', () => {
    const run = (over: Partial<WorkflowTraceEntry>) => ({ runId: 'r1', status: 'done', ...over }) as WorkflowTraceEntry;
    test('per-status suggestions; unsafe ids get none', () => {
        expect(traceNextAction(run({ runId: 'bad id', status: 'running' }))).toBeUndefined();
        expect(traceNextAction(run({ status: 'pending' }))?.label).toBe('Follow run');
        expect(traceNextAction(run({ status: 'paused' }))?.value).toBe('spur workflow continue r1');
        expect(traceNextAction(run({ status: 'interrupted' }))?.label).toBe('Continue run');
        expect(traceNextAction(run({ status: 'failed' }), '.spur/memory/runs/r1.md')).toEqual({
            label: 'Inspect run log',
            kind: 'path',
            value: '.spur/memory/runs/r1.md',
        });
        expect(traceNextAction(run({ status: 'failed' }))).toBeUndefined();
        expect(traceNextAction(run({ status: 'done' }))).toBeUndefined();
    });
});

describe('projectActionTraceResult', () => {
    const empty = { result: null, invocation: null, decision: null, error: null };
    test('null, unparseable, and non-object payloads project to empty', () => {
        expect(projectActionTraceResult(null)).toEqual(empty);
        expect(projectActionTraceResult('{')).toEqual(empty);
        expect(projectActionTraceResult('[1]')).toEqual(empty);
        expect(projectActionTraceResult('{"data":[1]}')).toEqual(empty);
    });
    test('projects allow-listed result/invocation fields with redaction and bounds', () => {
        const projected = projectActionTraceResult(
            JSON.stringify({
                error: `failed with hunter2 ${'x'.repeat(600)}`,
                data: {
                    agent: 'claude',
                    exitCode: 0,
                    pinReresolved: false,
                    sessionId: 'sess-hunter2',
                    ignored: 'drop me',
                    nested: { a: 1 },
                    invocation: { command: 'run hunter2', timeoutMs: 1000, continue: true, extra: 'x', model: {} },
                },
            }),
            ['hunter2'],
        );
        expect(projected.result).toEqual({
            agent: 'claude',
            exitCode: 0,
            pinReresolved: false,
            sessionId: 'sess-[REDACTED]',
        });
        expect(projected.invocation).toEqual({ command: 'run [REDACTED]', timeoutMs: 1000, continue: true });
        expect(projected.error?.startsWith('failed with [REDACTED]')).toBe(true);
        expect(projected.error?.endsWith('…')).toBe(true);
        expect(projected.decision).toBeNull();
    });
    test('shell actions carry byte tails and truncation flags (kind from row or payload)', () => {
        const payload = { data: { stdout: 'out', stderr: 'err', stdoutTruncated: true, stderrTruncated: 'no' } };
        expect(projectActionTraceResult(JSON.stringify(payload), [], 'shell').result).toEqual({
            stdoutTail: 'out',
            stderrTail: 'err',
            stdoutTruncated: true,
        });
        expect(projectActionTraceResult(JSON.stringify({ ...payload, kind: 'shell' })).result?.stdoutTail).toBe('out');
        expect(projectActionTraceResult(JSON.stringify({ data: { stdout: 1 } }), [], 'shell').result).toBeNull();
        expect(projectActionTraceResult(JSON.stringify(payload), [], 'agent').result).toBeNull();
    });
    test('decision provenance is projected only for the closed v1 shape', () => {
        const decision = {
            schemaVersion: 1,
            mode: 'llm',
            outcome: 'selected',
            reason: 'best-fit',
            provider: 'p',
            confidence: 0.9,
            selectedProbability: 0.7,
            evidenceActionIds: ['a1', 2, 'a2'],
            evidenceDigest: 'sha256:d',
            artifactId: 'art',
            durationMs: 12,
        };
        expect(projectActionTraceResult(JSON.stringify({ data: { decision } })).decision).toEqual({
            mode: 'llm',
            outcome: 'selected',
            reason: 'best-fit',
            provider: 'p',
            confidence: 0.9,
            selectedProbability: 0.7,
            evidenceActionIds: ['a1', 'a2'],
            evidenceDigest: 'sha256:d',
            artifactId: 'art',
            durationMs: 12,
        });
        const minimal = { schemaVersion: 1, mode: 'rule', outcome: 'o', reason: 'r' };
        expect(projectActionTraceResult(JSON.stringify({ data: { decision: minimal } })).decision).toEqual({
            mode: 'rule',
            outcome: 'o',
            reason: 'r',
            provider: null,
            confidence: null,
            selectedProbability: null,
            evidenceActionIds: [],
            evidenceDigest: null,
            artifactId: null,
            durationMs: 0,
        });
        for (const bad of [[], { ...minimal, schemaVersion: 2 }, { ...minimal, reason: 1 }, null]) {
            expect(projectActionTraceResult(JSON.stringify({ data: { decision: bad } })).decision).toBeNull();
        }
    });
});

describe('artifact lookups', () => {
    test('outputArtifactForRun prefers .md, falls back to legacy .log, else undefined', async () => {
        const root = project();
        expect(await outputArtifactForRun(root, 'r1')).toBeUndefined();
        writeFileSync(join(root, '.spur', 'memory', 'runs', 'r1.log'), 'log');
        expect(await outputArtifactForRun(root, 'r1')).toBe(join('.spur', 'memory', 'runs', 'r1.log'));
        writeFileSync(join(root, '.spur', 'memory', 'runs', 'r1.md'), 'md');
        expect(await outputArtifactForRun(root, 'r1')).toBe(join('.spur', 'memory', 'runs', 'r1.md'));
    });
    test('partialArtifactForAction: failed actions only, retained copy first, then scratch', async () => {
        const root = project();
        expect(await partialArtifactForAction(root, 'r2', 'build', true)).toBeUndefined();
        expect(await partialArtifactForAction(root, 'r2', 'build', null)).toBeUndefined();
        expect(await partialArtifactForAction(root, 'bad id', 'build', false)).toBeUndefined();
        expect(await partialArtifactForAction(root, 'r2', 'bad/node', false)).toBeUndefined();
        expect(await partialArtifactForAction(root, 'r2', 'build', false)).toBeUndefined();
        writeFileSync(join(root, '.spur', 'run', 'r2-build-partial.md'), 'scratch');
        expect(await partialArtifactForAction(root, 'r2', 'build', false)).toBe(
            join('.spur', 'run', 'r2-build-partial.md'),
        );
        const retainedDir = join(root, '.spur', 'memory', 'runs', 'r2', 'artifacts');
        mkdirSync(retainedDir, { recursive: true });
        writeFileSync(join(retainedDir, 'r2-build-partial.md'), 'retained');
        expect(await partialArtifactForAction(root, 'r2', 'build', false)).toBe(
            join('.spur', 'memory', 'runs', 'r2', 'artifacts', 'r2-build-partial.md'),
        );
    });
});
