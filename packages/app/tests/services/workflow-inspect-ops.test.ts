import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMigratedDb } from '@gobing-ai/spur-domain';
import type { AgentService } from '../../src/services/agent-service';
import type { RuleService } from '../../src/services/rule-service';
import { WorkflowEngineFactory } from '../../src/services/workflow-engine-factory';
import { WorkflowInspectOps } from '../../src/services/workflow-inspect-ops';
import { WorkflowRunOps } from '../../src/services/workflow-run-ops';
import type { WorkflowAppServiceContext } from '../../src/services/workflow-service';

// WorkflowInspectOps holds the read-only workflow verbs: validate, list, the trace projections
// and run-record inspection. A real run (through WorkflowRunOps) seeds the trace rows.

let dir: string;
let wfDir: string;
let ctx: WorkflowAppServiceContext;
let inspect: WorkflowInspectOps;
let runOps: WorkflowRunOps;

const LINEAR = `name: linear
description: two states, one hop
kind: state-machine
initialState: start
states:
  - id: start
    onEnter:
      - kind: note
        options:
          message: go
  - id: done
transitions:
  - from: start
    to: done
    guard: { kind: always }
terminalStates:
  - done
`;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'spur-wf-inspect-ops-'));
    wfDir = join(dir, '.spur', 'workflows');
    mkdirSync(wfDir, { recursive: true });
    writeFileSync(join(wfDir, 'linear.yaml'), LINEAR);
    writeFileSync(join(wfDir, 'broken.yaml'), 'name: broken\nkind: state-machine\nstates: [\n');
    let db: ReturnType<typeof createMigratedDb> | undefined;
    ctx = {
        cwd: dir,
        getDb: async () => {
            db ??= createMigratedDb({ url: ':memory:' });
            return db;
        },
        agentService: () => ({ run: async () => 0 }) as unknown as AgentService,
        ruleService: () => ({ evaluate: async () => ({ exitCode: 0, findings: [] }) }) as unknown as RuleService,
        hitlResponder: () => ({ respond: async () => ({ value: 'yes' }) }),
    } as WorkflowAppServiceContext;
    const engine = new WorkflowEngineFactory(ctx);
    inspect = new WorkflowInspectOps(ctx, engine);
    runOps = new WorkflowRunOps(ctx, engine);
});

afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

describe('WorkflowInspectOps.validate', () => {
    test('a well-formed definition validates with a digest; a malformed one reports errors', async () => {
        const good = await inspect.validate(join(wfDir, 'linear.yaml'));
        expect(good.ok).toBe(true);
        if (good.ok) {
            expect(good.workflow.name).toBe('linear');
            expect(typeof good.digest).toBe('string');
        }
        const bad = await inspect.validate(join(wfDir, 'broken.yaml'));
        expect(bad.ok).toBe(false);
        if (!bad.ok) expect(bad.errors.length).toBeGreaterThan(0);
    });
});

describe('WorkflowInspectOps.list', () => {
    test('lists every file of the project layer, marking the unparseable one invalid', async () => {
        const listed = await inspect.list();
        const byName = new Map(listed.entries.map((e) => [e.path.split('/').pop(), e]));
        expect(byName.get('linear.yaml')?.valid).toBe(true);
        expect(byName.get('linear.yaml')?.name).toBe('linear');
        expect(byName.get('broken.yaml')?.valid).toBe(false);
        expect(listed.totalFiles).toBe(listed.entries.length);
    });
});

describe('WorkflowInspectOps traces and run records', () => {
    test('traceList / traceRun project the recorded run; an unknown run throws', async () => {
        await runOps.run(join(wfDir, 'linear.yaml'), { runId: 'ins-1' });
        const db = await ctx.getDb();
        const list = await inspect.traceList(db, { workflow: 'linear' });
        expect(list.total).toBe(1);
        expect(list.entries[0]?.runId).toBe('ins-1');
        const timeline = await inspect.traceRun(db, 'ins-1');
        expect(timeline.run.runId).toBe('ins-1');
        await expect(inspect.traceRun(db, 'missing')).rejects.toThrow('Run not found: missing');
    });

    test('inspectRunRecord reports a run with no record as missing', () => {
        expect(inspect.inspectRunRecord('never-ran')).toEqual({ status: 'missing' });
    });
});
