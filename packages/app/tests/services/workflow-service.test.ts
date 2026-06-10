import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMigratedDb } from '@gobing-ai/spur-domain';
import type { AgentService } from '../../src/services/agent-service';
import type { RuleService } from '../../src/services/rule-service';
import { WorkflowAppService } from '../../src/services/workflow-service';

const MINIMAL_WORKFLOW_YAML = `name: test-flow
kind: state-machine
initialState: start
states:
  - id: start
  - id: done
transitions:
  - from: start
    to: done
terminalStates:
  - done
`;

function makeCtx(cwd = process.cwd()) {
    let db: ReturnType<typeof createMigratedDb> | undefined;
    return {
        cwd,
        getDb: async () => {
            db ??= createMigratedDb({ url: ':memory:' });
            return db;
        },
        agentService: () => ({ run: async () => 0 }) as unknown as AgentService,
        ruleService: () => ({ evaluate: async () => ({ exitCode: 0, findings: [] }) }) as unknown as RuleService,
        hitlResponder: () => ({ respond: async () => ({ value: 'yes' }) }),
    };
}

describe('WorkflowAppService', () => {
    describe('validate', () => {
        test('returns valid=true for a well-formed workflow YAML', async () => {
            const dir = await mkdtemp(join(tmpdir(), 'spur-wf-svc-'));
            const path = join(dir, 'test.yaml');
            await writeFile(path, MINIMAL_WORKFLOW_YAML);

            const svc = new WorkflowAppService(makeCtx(dir));
            const result = await svc.validate(path);
            expect(result.valid).toBe(true);
            if (result.valid) {
                expect(result.workflow.name).toBe('test-flow');
            }
            await rm(dir, { recursive: true });
        });

        test('returns valid=false with File not found error for missing file', async () => {
            const svc = new WorkflowAppService(makeCtx());
            const result = await svc.validate('/tmp/no-such-workflow-svc.yaml');
            expect(result.valid).toBe(false);
            if (!result.valid) {
                expect(result.errors[0]).toContain('File not found');
            }
        });

        test('returns valid=false with error details for workflow with unknown transition target', async () => {
            const dir = await mkdtemp(join(tmpdir(), 'spur-wf-bad-svc-'));
            const path = join(dir, 'bad.yaml');
            await writeFile(
                path,
                [
                    'name: broken',
                    'kind: state-machine',
                    'initialState: start',
                    'states:',
                    '  - id: start',
                    '  - id: done',
                    'transitions:',
                    '  - from: start',
                    '    to: ghost',
                    'terminalStates: [done]',
                ].join('\n'),
            );
            const svc = new WorkflowAppService(makeCtx(dir));
            const result = await svc.validate(path);
            expect(result.valid).toBe(false);
            if (!result.valid) {
                expect(result.errors[0]).toContain('ghost');
            }
            await rm(dir, { recursive: true });
        });

        test('ok field mirrors valid field', async () => {
            const svc = new WorkflowAppService(makeCtx());
            const result = await svc.validate('/tmp/nonexistent-svc.yaml');
            expect(result.ok).toBe(result.valid);
        });
    });

    describe('run', () => {
        test('runs a workflow with an explicit runId and per-run vars', async () => {
            const dir = await mkdtemp(join(tmpdir(), 'spur-wf-run-'));
            const path = join(dir, 'test.yaml');
            await writeFile(path, MINIMAL_WORKFLOW_YAML);

            const svc = new WorkflowAppService(makeCtx(dir));
            const result = await svc.run(path, { runId: 'svc-run-1', vars: { taskId: '0042' } });

            expect(result.status).toBe('done');
            expect(result.runId).toBe('svc-run-1');
            expect(result.finalState).toBe('done');
            await rm(dir, { recursive: true, force: true });
        });

        test('defaults the runId and runs with no options', async () => {
            const dir = await mkdtemp(join(tmpdir(), 'spur-wf-run-'));
            const path = join(dir, 'test.yaml');
            await writeFile(path, MINIMAL_WORKFLOW_YAML);

            const svc = new WorkflowAppService(makeCtx(dir));
            const result = await svc.run(path);

            expect(result.status).toBe('done');
            expect(result.runId.length).toBeGreaterThan(0);
            await rm(dir, { recursive: true, force: true });
        });
    });

    describe('list', () => {
        test('returns empty runs array when no runs exist', async () => {
            const svc = new WorkflowAppService(makeCtx());
            const { runs } = await svc.list();
            expect(Array.isArray(runs)).toBe(true);
            expect(runs.length).toBe(0);
        });
    });
});
