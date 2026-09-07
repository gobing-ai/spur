/**
 * Unit coverage for the ready-by-default creation orchestration (F21 0788).
 * Covers the preparation stages (dispatch/run/post-check/promotion), batch
 * preparation (capture → extract → strict schema), the planning digest
 * boundary (execution-owned sections and timestamps excluded), checklist
 * verification, and the fence-tolerant batch extraction.
 */
import { describe, expect, test } from 'bun:test';
import type { AgentRunCaptureResult, AgentRunTracedResult } from '../../src/services/agent-service';
import { FINDING_CODES } from '../../src/services/finding-codes';
import {
    computePlanningDigest,
    DEFAULT_READY_PREPARE_TIMEOUT_MS,
    extractBatchArray,
    PLANNING_DIGEST_SECTIONS,
    prepareBatchTaskReady,
    prepareCreatedTaskReady,
    READY_CHECKLIST_IDS,
    type ReadyAgentPort,
    type ReadyCheckRow,
    type ReadyPostCheck,
    type ReadyTaskPort,
    readyRefineAllCommand,
    readyRefineCommand,
    TaskPreparationError,
    verifyReadyChecks,
} from '../../src/services/task-readiness';

const traced = (over: Partial<AgentRunTracedResult> = {}): AgentRunTracedResult => ({
    exitCode: 0,
    stdout: '',
    ...over,
});
const captured = (over: Partial<AgentRunCaptureResult> = {}): AgentRunCaptureResult => ({
    exitCode: 0,
    answer: '[]',
    ...over,
});

const passRow = (id: string): ReadyCheckRow => ({ id, pass: true, evidence: `${id} verified in doc` });
const allPassRows = (): ReadyCheckRow[] => READY_CHECKLIST_IDS.map(passRow);

function stageOf(err: unknown): string {
    return err instanceof TaskPreparationError ? err.stage : '';
}

/** One full task document over the canonical section set. */
function taskDoc(
    over: {
        background?: string;
        requirements?: string;
        solution?: string;
        testing?: string;
        review?: string;
        history?: string;
        updated?: string;
        dependencies?: string[];
    } = {},
): string {
    const deps = over.dependencies ?? ['0001'];
    return [
        '---',
        'status: todo',
        'wbs: 0002',
        'feature_id: F21',
        'template: default',
        `dependencies: [${deps.map((d) => `"${d}"`).join(', ')}]`,
        "created_at: '2026-01-01T00:00:00Z'",
        `updated_at: '${over.updated ?? '2026-01-02T00:00:00Z'}'`,
        '---',
        '',
        `### Background`,
        '',
        over.background ?? 'Background body.',
        '',
        `### Requirements`,
        '',
        over.requirements ?? 'Requirements body.',
        '',
        '### Acceptance Criteria',
        '',
        '- [ ] Scenario one.',
        '',
        '### Q&A',
        '',
        '### Design',
        '',
        'Design body.',
        '',
        '### Plan',
        '',
        '1. Step one.',
        '',
        '### Root Cause',
        '',
        '### Solution',
        '',
        over.solution ?? 'Solution body.',
        '',
        '### Testing',
        '',
        over.testing ?? 'Testing body.',
        '',
        '### Review',
        '',
        over.review ?? 'Review body.',
        '',
        '### References',
        '',
        '### History',
        '',
        over.history ?? 'History body.',
        '',
    ].join('\n');
}
describe('task readiness — single-task preparation stages (0788 R1/R2)', () => {
    const baseTasks = (status: string, calls: { promoted: string[] }): ReadyTaskPort => ({
        show: async () => ({ wbs: '0002', status, filePath: 'docs/tasks/0002.md' }),
        updateStatus: async (_wbs, to) => {
            calls.promoted.push(to);
            return {};
        },
    });
    const passingCheck: ReadyPostCheck = async () => ({ pass: true, findings: [] });

    test('exit 2 maps to the agent-dispatch stage with recovery command and file path', async () => {
        const agents: ReadyAgentPort = {
            runTraced: async () => traced({ exitCode: 2, message: 'no executor' }),
            runCapture: async () => captured(),
        };
        const err = await prepareCreatedTaskReady({
            wbs: '0002',
            tasks: baseTasks('backlog', { promoted: [] }),
            agents,
            checkTask: passingCheck,
        }).catch((e: unknown) => e);
        expect(stageOf(err)).toBe('agent-dispatch');
        expect((err as TaskPreparationError).recoveryCommand).toBe(readyRefineCommand('0002'));
        expect((err as TaskPreparationError).filePath).toBe('docs/tasks/0002.md');
        expect((err as TaskPreparationError).message).toContain('no executor');
    });

    test('nonzero exit with a signal maps to agent-run and names the signal', async () => {
        const agents: ReadyAgentPort = {
            runTraced: async () => traced({ exitCode: 3, signal: 'SIGTERM' }),
            runCapture: async () => captured(),
        };
        const err = await prepareCreatedTaskReady({
            wbs: '0002',
            tasks: baseTasks('backlog', { promoted: [] }),
            agents,
            checkTask: passingCheck,
        }).catch((e: unknown) => e);
        expect(stageOf(err)).toBe('agent-run');
        expect((err as TaskPreparationError).message).toContain('terminated by signal SIGTERM');
    });

    test('a failing deterministic post-check stops at the post-check stage and carries findings', async () => {
        const agents: ReadyAgentPort = {
            runTraced: async () => traced(),
            runCapture: async () => captured(),
        };
        const checkTask: ReadyPostCheck = async () => ({
            pass: false,
            findings: [
                {
                    layer: 'L3',
                    code: FINDING_CODES.L3_REQUIRED_SECTION_PLACEHOLDER,
                    severity: 'error',
                    section: 'Plan',
                    message: 'Plan is still a placeholder',
                },
            ],
        });
        const err = await prepareCreatedTaskReady({
            wbs: '0002',
            tasks: baseTasks('backlog', { promoted: [] }),
            agents,
            checkTask,
        }).catch((e: unknown) => e);
        expect(stageOf(err)).toBe('post-check');
        expect((err as TaskPreparationError).message).toContain('Plan is still a placeholder');
        expect((err as TaskPreparationError).findings?.length).toBe(1);
    });

    test('exit 0 alone is not readiness: post-check failure preserves authored work (no rollback)', async () => {
        const agents: ReadyAgentPort = {
            runTraced: async () => traced(),
            runCapture: async () => captured(),
        };
        const err = await prepareCreatedTaskReady({
            wbs: '0002',
            tasks: baseTasks('backlog', { promoted: [] }),
            agents,
            checkTask: async () => ({ pass: false, findings: [] }),
        }).catch((e: unknown) => e);
        expect(stageOf(err)).toBe('post-check');
        expect((err as TaskPreparationError).message).toContain('check did not pass');
    });

    test('backlog task is promoted to todo after a passing post-check', async () => {
        const calls: { promoted: string[] } = { promoted: [] };
        const res = await prepareCreatedTaskReady({
            wbs: '0002',
            tasks: baseTasks('backlog', calls),
            agents: { runTraced: async () => traced(), runCapture: async () => captured() },
            checkTask: passingCheck,
        });
        expect(res.readiness).toEqual({ status: 'ready', depth: 'ready' });
        expect(calls.promoted).toEqual(['todo']);
    });

    test('promotion is idempotent: an already-todo task is not transitioned again', async () => {
        const calls: { promoted: string[] } = { promoted: [] };
        const res = await prepareCreatedTaskReady({
            wbs: '0002',
            tasks: baseTasks('todo', calls),
            agents: { runTraced: async () => traced(), runCapture: async () => captured() },
            checkTask: passingCheck,
        });
        expect(res.readiness.status).toBe('ready');
        expect(calls.promoted).toEqual([]);
    });

    test('dispatch flags carry the selector, cwd and default timeout', async () => {
        const seen: Array<Record<string, string | boolean>> = [];
        const agents: ReadyAgentPort = {
            runTraced: async (_prompt, flags) => {
                seen.push(flags);
                return traced();
            },
            runCapture: async () => captured(),
        };
        await prepareCreatedTaskReady({
            wbs: '0002',
            tasks: baseTasks('todo', { promoted: [] }),
            agents,
            checkTask: passingCheck,
            agentSelector: 'planner-fast',
            cwd: '/tmp/proj',
        });
        expect(seen[0]?.agent).toBe('planner-fast');
        expect(seen[0]?.cwd).toBe('/tmp/proj');
        expect(seen[0]?.timeout).toBe(String(DEFAULT_READY_PREPARE_TIMEOUT_MS));
        expect(seen[0]?.mode).toBe('text');
    });

    test('an unreadable saved task fails at post-check before any dispatch', async () => {
        const dispatched: string[] = [];
        const err = await prepareCreatedTaskReady({
            wbs: '0002',
            tasks: {
                show: async () => {
                    throw new Error('gone');
                },
                updateStatus: async () => ({}),
            },
            agents: {
                runTraced: async () => {
                    dispatched.push('run');
                    return traced();
                },
                runCapture: async () => captured(),
            },
            checkTask: passingCheck,
        }).catch((e: unknown) => e);
        expect(dispatched).toEqual([]);
        expect(stageOf(err)).toBe('post-check');
        expect((err as TaskPreparationError).message).toContain('unreadable before preparation');
    });
});

describe('task readiness — batch preparation stages (0788 R3)', () => {
    const batchSource = JSON.stringify([
        { name: 'First', feature_id: 'F9' },
        { name: 'Second', feature_id: 'F9', background: 'authored' },
    ]);

    test('capture exit 2 maps to agent-dispatch with the refineall recovery hint', async () => {
        const err = await prepareBatchTaskReady({
            batchPath: 'batch.json',
            batchSource,
            agents: {
                runTraced: async () => traced(),
                runCapture: async () => captured({ exitCode: 2, stderr: 'no executor' }),
            },
        }).catch((e: unknown) => e);
        expect(stageOf(err)).toBe('agent-dispatch');
        expect((err as TaskPreparationError).recoveryCommand).toBe(readyRefineAllCommand('F9'));
    });

    test('capture failure maps to agent-run', async () => {
        const err = await prepareBatchTaskReady({
            batchPath: 'batch.json',
            batchSource,
            agents: {
                runTraced: async () => traced(),
                runCapture: async () => captured({ exitCode: 1, signal: 'SIGKILL' }),
            },
        }).catch((e: unknown) => e);
        expect(stageOf(err)).toBe('agent-run');
        expect((err as TaskPreparationError).message).toContain('terminated by signal SIGKILL');
    });

    test('prose-only capture output stops at the invalid-output stage', async () => {
        const err = await prepareBatchTaskReady({
            batchPath: 'batch.json',
            batchSource,
            agents: {
                runTraced: async () => traced(),
                runCapture: async () => captured({ answer: 'I prepared everything!' }),
            },
        }).catch((e: unknown) => e);
        expect(stageOf(err)).toBe('invalid-output');
    });

    test('schema-invalid prepared array stops at the validation stage with issue paths', async () => {
        const err = await prepareBatchTaskReady({
            batchPath: 'batch.json',
            batchSource,
            agents: {
                runTraced: async () => traced(),
                runCapture: async () => captured({ answer: '[{"name":"Ok"},{"no_name":true}]' }),
            },
        }).catch((e: unknown) => e);
        expect(stageOf(err)).toBe('validation');
        expect((err as TaskPreparationError).message).toContain('name');
    });

    test('valid capture preserves input order and the cwd flag reaches the executor', async () => {
        const seen: Array<Record<string, string | boolean>> = [];
        const res = await prepareBatchTaskReady({
            batchPath: 'batch.json',
            batchSource,
            agents: {
                runTraced: async () => traced(),
                runCapture: async (_prompt, flags) => {
                    seen.push(flags);
                    return captured({ answer: '```json\n[{"name":"Second","background":"b"},{"name":"First"}]\n```' });
                },
            },
            cwd: '/tmp/proj',
        });
        expect(seen[0]?.cwd).toBe('/tmp/proj');
        expect(res.items.map((i) => i.name)).toEqual(['Second', 'First']);
        expect(res.items[0]?.background).toBe('b');
    });

    test('recovery hint is absent when no supplied item names a feature', async () => {
        const err = await prepareBatchTaskReady({
            batchPath: 'batch.json',
            batchSource: JSON.stringify([{ name: 'Solo' }]),
            agents: { runTraced: async () => traced(), runCapture: async () => captured({ exitCode: 2 }) },
        }).catch((e: unknown) => e);
        expect((err as TaskPreparationError).recoveryCommand).toBeUndefined();
    });
});

describe('task readiness — planning digest boundary (0788 EVIDENCE)', () => {
    test('execution-owned section edits do not move the digest', () => {
        const base = computePlanningDigest(taskDoc());
        expect(computePlanningDigest(taskDoc({ solution: 'Completely different solution.' }))).toBe(base);
        expect(computePlanningDigest(taskDoc({ testing: 'New test notes.' }))).toBe(base);
        expect(computePlanningDigest(taskDoc({ review: 'New review notes.' }))).toBe(base);
        expect(computePlanningDigest(taskDoc({ history: 'New history row.' }))).toBe(base);
    });

    test('timestamp-only edits do not move the digest; planning body edits do', () => {
        const base = computePlanningDigest(taskDoc());
        expect(computePlanningDigest(taskDoc({ updated: '2030-05-05T00:00:00Z' }))).toBe(base);
        expect(computePlanningDigest(taskDoc({ background: 'Changed background.' }))).not.toBe(base);
        expect(computePlanningDigest(taskDoc({ requirements: 'Changed requirements.' }))).not.toBe(base);
    });

    test('dependency sets are order-insensitive; membership changes move the digest', () => {
        const base = computePlanningDigest(taskDoc({ dependencies: ['0001', '0003'] }));
        expect(computePlanningDigest(taskDoc({ dependencies: ['0003', '0001'] }))).toBe(base);
        expect(computePlanningDigest(taskDoc({ dependencies: ['0001', '0003', '0004'] }))).not.toBe(base);
    });

    test('digest sections exclude exactly the execution-owned set', () => {
        expect(PLANNING_DIGEST_SECTIONS).toContain('Background');
        expect(PLANNING_DIGEST_SECTIONS).toContain('Requirements');
        expect(PLANNING_DIGEST_SECTIONS).not.toContain('Solution');
        expect(PLANNING_DIGEST_SECTIONS).not.toContain('Testing');
        expect(PLANNING_DIGEST_SECTIONS).not.toContain('Review');
        expect(PLANNING_DIGEST_SECTIONS).not.toContain('History');
    });
});

describe('task readiness — checklist verification (0788 R7)', () => {
    test('undefined rows, missing ids, failures and empty evidence are all rejected', () => {
        expect(verifyReadyChecks(undefined).ok).toBe(false);
        expect(verifyReadyChecks(allPassRows().slice(1)).ok).toBe(false);
        const failing = allPassRows().map((r, i) => (i === 2 ? { id: r.id, pass: false, evidence: r.evidence } : r));
        const failVerdict = verifyReadyChecks(failing);
        expect(failVerdict.ok).toBe(false);
        expect(failVerdict.reason).toContain(failing[2]?.id ?? '');
        const emptyEvidence = allPassRows().map((r, i) => (i === 4 ? { ...r, evidence: '  ' } : r));
        expect(verifyReadyChecks(emptyEvidence).ok).toBe(false);
    });

    test('all seven ids passing with nonempty evidence verifies', () => {
        expect(verifyReadyChecks(allPassRows())).toEqual({ ok: true });
    });
});

describe('task readiness — fenced batch extraction (0788 R3)', () => {
    test('plain, fenced, and prose-wrapped arrays all extract', () => {
        expect(extractBatchArray('[{"name":"A"}]')).toEqual([{ name: 'A' }]);
        expect(extractBatchArray('```json\n[{"name":"A"}]\n```')).toEqual([{ name: 'A' }]);
        expect(extractBatchArray('Here you go:\n[{"name":"A"},{"name":"B"}]\nDone.')).toEqual([
            { name: 'A' },
            { name: 'B' },
        ]);
    });

    test('output with no array raises the invalid-output stage', () => {
        let stage = '';
        try {
            extractBatchArray('no json here');
        } catch (err) {
            stage = stageOf(err);
        }
        expect(stage).toBe('invalid-output');
    });
});
