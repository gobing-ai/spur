import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMigratedDb } from '@gobing-ai/spur-domain';
import type { AgentService } from '../../src/services/agent-service';
import type { RuleService } from '../../src/services/rule-service';
import { WorkflowAppService } from '../../src/services/workflow-service';

const WORKFLOW = (action: string): string => `name: decide-flow
kind: state-machine
initialState: a
states:
  - id: a
    onEnter:
${action}
  - id: done
transitions:
  - from: a
    to: done
    guard: { kind: always }
terminalStates:
  - done
`;

const CATALOG_OK = `version: 1
decisions:
    pick-lane:
        type: choice
        criteria:
            fast: go fast
            slow: go slow
        fallback: slow
`;

function makeTestContext(cwd: string) {
    let db: ReturnType<typeof createMigratedDb> | undefined;
    const warnings: string[] = [];
    return {
        warnings,
        ctx: {
            cwd,
            getDb: async () => {
                db ??= createMigratedDb({ url: ':memory:' });
                return db;
            },
            agentService: () => ({ run: async () => 0 }) as unknown as AgentService,
            ruleService: () => ({ evaluate: async () => ({ exitCode: 0, findings: [] }) }) as unknown as RuleService,
            hitlResponder: () => ({ respond: async () => ({ value: 'yes' as const }) }),
            warn: (message: string) => warnings.push(message),
        },
    };
}

describe('workflow validate × decision catalog (task 1094 R7)', () => {
    test('catalog-form decide validates against project catalogs; inline forms warn; unknown ids fail', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'spur-decide-validate-'));
        try {
            const wfDir = join(dir, '.spur', 'workflows');
            const decDir = join(dir, '.spur', 'decisions');
            await mkdir(wfDir, { recursive: true });
            await mkdir(decDir, { recursive: true });
            await writeFile(join(decDir, 'base.yaml'), CATALOG_OK);

            // 1. Valid catalog id validates cleanly, with no deprecation warning.
            await writeFile(
                join(wfDir, 'ok.yaml'),
                WORKFLOW(
                    '        - kind: decide\n          options:\n            id: gate\n            decision: pick-lane\n            resultFile: out/lane.json',
                ),
            );
            const ok = makeTestContext(dir);
            const okResult = await new WorkflowAppService(ok.ctx).validate('ok');
            expect(okResult.valid).toBe(true);
            expect(ok.warnings).toEqual([]);

            // 2. Inline decide still validates but warns through the ctx sink.
            await writeFile(
                join(wfDir, 'legacy.yaml'),
                WORKFLOW(
                    '        - kind: decide\n          options:\n            id: legacy\n            method: noul\n            question: go?\n            default: no\n            resultFile: out/go.json',
                ),
            );
            const legacy = makeTestContext(dir);
            const legacyResult = await new WorkflowAppService(legacy.ctx).validate('legacy');
            expect(legacyResult.valid).toBe(true);
            expect(legacy.warnings).toHaveLength(1);
            expect(legacy.warnings[0]).toContain('inline decide options are deprecated');

            // 3. Unknown catalog id is a validation error.
            await writeFile(
                join(wfDir, 'bad.yaml'),
                WORKFLOW(
                    '        - kind: decide\n          options:\n            id: gate\n            decision: nope\n            resultFile: out/lane.json',
                ),
            );
            const bad = makeTestContext(dir);
            const badResult = await new WorkflowAppService(bad.ctx).validate('bad');
            expect(badResult.valid).toBe(false);
            if (!badResult.valid) {
                expect(badResult.errors.join('\n')).toContain('unknown decision "nope"');
            }
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    test('a malformed catalog fails closed: the cataloged id validates as unknown', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'spur-decide-validate-broken-'));
        try {
            const wfDir = join(dir, '.spur', 'workflows');
            const decDir = join(dir, '.spur', 'decisions');
            await mkdir(wfDir, { recursive: true });
            await mkdir(decDir, { recursive: true });
            await writeFile(join(decDir, 'base.yaml'), ':::: not yaml [');
            await writeFile(
                join(wfDir, 'cat.yaml'),
                WORKFLOW(
                    '        - kind: decide\n          options:\n            id: gate\n            decision: pick-lane\n            resultFile: out/lane.json',
                ),
            );
            const { ctx, warnings } = makeTestContext(dir);
            const result = await new WorkflowAppService(ctx).validate('cat');
            // The service reports catalog errors, never throws: the malformed file loads
            // nothing, so the referenced id is simply unknown — fail closed.
            expect(result.valid).toBe(false);
            if (!result.valid) {
                expect(result.errors.join('\n')).toContain('unknown decision "pick-lane"');
            }
            expect(warnings).toEqual([]);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
});
