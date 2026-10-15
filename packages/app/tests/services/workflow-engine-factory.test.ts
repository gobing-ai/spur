import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMigratedDb } from '@gobing-ai/spur-domain';
import { WorkflowService as EngineWorkflowService } from '@gobing-ai/ts-dual-workflow-engine';
import type { AgentService } from '../../src/services/agent-service';
import type { RuleService } from '../../src/services/rule-service';
import { WorkflowEngineFactory } from '../../src/services/workflow-engine-factory';
import type { WorkflowAppServiceContext } from '../../src/services/workflow-service';
import type { FleetDispatchDeps } from '../../src/workflow/fleet-dispatch';

// WorkflowEngineFactory composes the engine-side WorkflowService for WorkflowAppService. The
// end-to-end run/continue paths live in workflow-service.test.ts; these tests pin the
// composition seams that only fire lazily at action time (the fleet receipt reads).

let dir: string;
let dbOpens: number;

function makeCtx(): WorkflowAppServiceContext {
    let db: ReturnType<typeof createMigratedDb> | undefined;
    return {
        cwd: dir,
        getDb: async () => {
            dbOpens += 1;
            db ??= createMigratedDb({ url: ':memory:' });
            return db;
        },
        agentService: () => ({ run: async () => 0 }) as unknown as AgentService,
        ruleService: () => ({ evaluate: async () => ({ exitCode: 0, findings: [] }) }) as unknown as RuleService,
        hitlResponder: () => ({ respond: async () => ({ value: 'yes' }) }),
    } as WorkflowAppServiceContext;
}

function fleetDeps(factory: WorkflowEngineFactory): FleetDispatchDeps {
    return (factory as unknown as { buildFleetDispatchDeps: () => FleetDispatchDeps }).buildFleetDispatchDeps();
}

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'spur-wf-engine-factory-'));
    dbOpens = 0;
});

afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

describe('WorkflowEngineFactory', () => {
    test('createEngineService composes an engine service without touching any fleet DB read', async () => {
        const factory = new WorkflowEngineFactory(makeCtx());
        const engine = await factory.createEngineService();
        expect(engine).toBeInstanceOf(EngineWorkflowService);
        // The run DB is opened for persistence + the decision-log sink only.
        expect(dbOpens).toBeGreaterThan(0);
    });

    test('fleet dispatch deps open the workflow DB lazily, per receipt read', async () => {
        const deps = fleetDeps(new WorkflowEngineFactory(makeCtx()));
        expect(dbOpens).toBe(0);
        // No run row and no inbox row for this message: with no time left the wait stops at
        // outcome-unknown after one receipt read — never a failure (R2).
        expect(await deps.dispatcher.awaitReceipt('msg-unknown', 'member-1', { timeoutMs: 0 })).toEqual({
            status: 'outcome-unknown',
            messageId: 'msg-unknown',
        });
        expect(dbOpens).toBeGreaterThan(0);
        const before = Date.now();
        expect(deps.now()).toBeGreaterThanOrEqual(before);
    });
});
