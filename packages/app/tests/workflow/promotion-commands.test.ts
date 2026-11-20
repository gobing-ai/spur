/**
 * Promotion verb services (A94 1413 R2).
 *
 * The candidate-file discipline is the contract a workflow owner relies on, so the failure modes come
 * first: an unknown candidate or a contradicting resolve must refuse rather than mutate the record,
 * and `promote-check` must pass a clean catalogue while failing an overdue or parallel one.
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    configurePromotionRoots,
    loadWorkflowCandidates,
    promoteCheck,
    promoteEvaluate,
    promoteResolve,
} from '../../src/workflow/promotion-commands';

/** A throwaway project with a candidate record and an empty definitions directory. */
async function project(candidates: unknown[]): Promise<{ root: string; config: string; workflows: string }> {
    const root = mkdtempSync(join(tmpdir(), 'spur-promo-svc-'));
    const workflows = join(root, 'workflows');
    const config = join(root, 'workflow-candidates.json');
    await Bun.write(join(workflows, 'task-pipeline.yaml'), 'name: task-pipeline\n');
    writeFileSync(config, JSON.stringify({ schemaVersion: 1, candidates }, null, 2));
    // Pin every root: the service's defaults resolve `<root>/config/...`, and this fixture is flat.
    configurePromotionRoots(root, { candidatesPath: config, workflowsDir: workflows, dbPath: join(root, 'none.db') });
    return { root, config, workflows };
}

const candidate = {
    id: 'c1',
    canonical: 'task-pipeline',
    createdAt: '2026-01-01',
    deadline: '2099-01-01',
    rationale: 'fixture',
    measurement: { workflow: 'task-pipeline' },
    delta: { agentRunCount: 3 },
    verdict: null,
};

describe('promote-check', () => {
    test('a clean catalogue passes and reports the count', async () => {
        const fx = await project([candidate]);
        try {
            const outcome = await promoteCheck();
            expect(outcome.ok).toBe(true);
            expect(outcome.status).toBe('PASS');
            expect(outcome.lines.join('\n')).toContain('1 candidate(s)');
        } finally {
            await rm(fx.root, { recursive: true, force: true });
        }
    });

    test('an overdue candidate fails with a finding that names it', async () => {
        const fx = await project([{ ...candidate, deadline: '2000-01-01' }]);
        try {
            const outcome = await promoteCheck({ argv: ['--now', '2026-06-01T00:00:00Z'] });
            expect(outcome.ok).toBe(false);
            expect(outcome.findings.map((finding) => finding.kind)).toContain('expired-candidate');
            expect(outcome.findings[0]?.candidateId).toBe('c1');
        } finally {
            await rm(fx.root, { recursive: true, force: true });
        }
    });
});

describe('promote-resolve', () => {
    test('an unknown candidate refuses without touching the record', async () => {
        const fx = await project([candidate]);
        try {
            await expect(promoteResolve('ghost', { argv: ['--decision', 'delete'] })).rejects.toThrow(/not found/);
            const record = await loadWorkflowCandidates(fx.config);
            expect(record.candidates).toHaveLength(1);
        } finally {
            await rm(fx.root, { recursive: true, force: true });
        }
    });

    test('a contradicting decision is refused and the candidate stays recorded', async () => {
        const fx = await project([
            { ...candidate, verdict: { decision: 'delete', evaluatedAt: '2026-02-02T00:00:00Z', reason: 'fixture' } },
        ]);
        try {
            const outcome = await promoteResolve('c1', { argv: ['--decision', 'promote'] });
            expect(outcome.ok).toBe(false);
            expect(outcome.lines.join('\n')).toContain('contradicts it');
            expect((await loadWorkflowCandidates(fx.config)).candidates).toHaveLength(1);
        } finally {
            await rm(fx.root, { recursive: true, force: true });
        }
    });

    test('a matching decision removes the candidate', async () => {
        const fx = await project([candidate]);
        try {
            const outcome = await promoteResolve('c1', { argv: ['--decision', 'delete'] });
            expect(outcome.ok).toBe(true);
            expect((await loadWorkflowCandidates(fx.config)).candidates).toEqual([]);
        } finally {
            await rm(fx.root, { recursive: true, force: true });
        }
    });
});

describe('promote-evaluate', () => {
    test('records a verdict from the (empty) history instead of refusing', async () => {
        const fx = await project([{ ...candidate, measurement: { workflow: 'task-pipeline', runIds: [] } }]);
        try {
            const outcome = await promoteEvaluate('c1', { argv: ['--now', '2026-06-01T00:00:00Z'] });
            expect(outcome.ok).toBe(true);
            expect(['promote', 'delete']).toContain(outcome.status);
            const record = await loadWorkflowCandidates(fx.config);
            expect(record.candidates[0]?.verdict).toBeDefined();
        } finally {
            await rm(fx.root, { recursive: true, force: true });
        }
    });

    test('a live definition that drifted from the pinned baseline is refused, not evaluated', async () => {
        const fx = await project([
            {
                ...candidate,
                delta: { agentRunCount: 3, baselineAgentRunCount: 9 },
                measurement: { workflow: 'task-pipeline', runIds: [] },
            },
        ]);
        try {
            const outcome = await promoteEvaluate('c1');
            expect(outcome.ok).toBe(false);
            expect(outcome.status).toBe('refused');
            expect(outcome.lines.join('\n')).toContain('drifted');
        } finally {
            await rm(fx.root, { recursive: true, force: true });
        }
    });
});
