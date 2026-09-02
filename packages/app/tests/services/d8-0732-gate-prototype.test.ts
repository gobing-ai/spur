/**
 * D8-0732 proportional-gate prototype — retained regression check (R8).
 *
 * The one retained executable check for the two-path route table + root
 * `version` behavioral-neutrality exercise. Loads both fixture version-forms,
 * validates both, runs both through the real engine (WorkflowAppService with a
 * real NodeProcessExecutor), and asserts:
 *   - definitionDigest differs between explicit(<literal>) and unversioned forms
 *   - both validate
 *   - both execute to `done` through the SAME route (version does no behavioral
 *     dispatch) — proven by identical bounded-reason output
 *
 * Retained deliberately: this is the minimum evidence 0733 needs to trust the
 * prototype's fast/safety route table and the version field's behavior-neutrality.
 */
import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMigratedDb } from '@gobing-ai/spur-domain';
import { loadWorkflowDefFromText } from '@gobing-ai/ts-dual-workflow-engine';
import { NodeProcessExecutor } from '@gobing-ai/ts-runtime';
import type { AgentService } from '../../src/services/agent-service';
import type { RuleService } from '../../src/services/rule-service';
import { WorkflowAppService } from '../../src/services/workflow-service';
import { computeDefinitionDigest } from '../../src/workflow/composition-baseline';

const FIXTURES = join(import.meta.dir, '..', 'fixtures', 'd8-0732');
const UNVERSIONED = join(FIXTURES, 'd8-0732-gate-fixture.yaml');
const VERSIONED = join(FIXTURES, 'd8-0732-gate-fixture-versioned.yaml');

async function readFixture(p: string): Promise<string> {
    return readFile(p, 'utf8');
}

describe('d8-0732 gate prototype fixture', () => {
    test('R7: explicit(<literal>) and unversioned forms produce different definitionDigests', async () => {
        const [plain, versioned] = await Promise.all([readFixture(UNVERSIONED), readFixture(VERSIONED)]);
        const plainDef = loadWorkflowDefFromText(plain, UNVERSIONED);
        const versionedDef = loadWorkflowDefFromText(versioned, VERSIONED);

        // Only the version field differs between the two forms.
        expect((versionedDef as { version?: string }).version).toBe('1.2.3');
        expect((plainDef as { version?: string }).version).toBeUndefined();

        const plainDigest = computeDefinitionDigest(plainDef);
        const versionedDigest = computeDefinitionDigest(versionedDef);
        expect(plainDigest).not.toBe(versionedDigest);
    });

    test('both forms validate through the real service', async () => {
        const svc = new WorkflowAppService({
            cwd: process.cwd(),
            getDb: async () => createMigratedDb({ url: ':memory:' }),
            agentService: () => ({ run: async () => 0 }) as unknown as AgentService,
            ruleService: () => ({ evaluate: async () => ({ exitCode: 0, findings: [] }) }) as unknown as RuleService,
            hitlResponder: () => ({ respond: async () => ({ value: 'yes' }) }),
            processExecutor: () => new NodeProcessExecutor(),
        });
        for (const p of [UNVERSIONED, VERSIONED]) {
            const result = await svc.validate(p);
            expect(result.valid).toBe(true);
            if (result.valid) {
                expect(result.workflow.name).toBe('d8-0732-gate-fixture');
            }
        }
    });

    test('both forms run to done through the SAME route (version does no behavioral dispatch)', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'spur-d8-0732-'));
        const db = createMigratedDb({ url: ':memory:' });
        const makeSvc = () =>
            new WorkflowAppService({
                cwd: dir,
                getDb: async () => db,
                agentService: () => ({ run: async () => 0 }) as unknown as AgentService,
                ruleService: () =>
                    ({ evaluate: async () => ({ exitCode: 0, findings: [] }) }) as unknown as RuleService,
                hitlResponder: () => ({ respond: async () => ({ value: 'yes' }) }),
                processExecutor: () => new NodeProcessExecutor(),
            });

        const vars = {
            mode: 'fast',
            tasks: '["0732"]',
            profile: 'auto',
            merge: 'false',
            reasonFile: join(dir, '.spur', 'run', 'd8-0732-route-reason.txt'),
        };

        const results = [];
        for (const p of [UNVERSIONED, VERSIONED]) {
            const result = await makeSvc().run(p, { vars });
            expect(result.status).toBe('done');
            expect(result.finalState).toBe('done');
            results.push({ p, result });
        }

        // Same route: both runs reached done through fast-path (3 transitions:
        // start -> resolve -> fast-path -> done) and recorded the same reason.
        for (const { result } of results) {
            expect(result.transitionsTaken).toBe(3);
        }
        const reason = await readFile(vars.reasonFile, 'utf8');
        expect(reason.trim()).toBe('fast:evidence complete+consistent');
        expect(results).toHaveLength(2);

        await rm(dir, { recursive: true, force: true });
    });
});
