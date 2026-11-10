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

    // 1326 R10: progress lines print the 8-char id prefix, so `spur workflow trace <prefix>`
    // must resolve it — uniquely, exactly, or not at all.
    test('R10: resolveRunId accepts an exact id, a unique prefix, and refuses an ambiguous one', async () => {
        await runOps.run(join(wfDir, 'linear.yaml'), { runId: 'aaaa1111-2222-3333-4444-555555555555' });
        await runOps.run(join(wfDir, 'linear.yaml'), { runId: 'aaaa9999-2222-3333-4444-555555555555' });
        await runOps.run(join(wfDir, 'linear.yaml'), { runId: 'bbbb1111-2222-3333-4444-555555555555' });
        const db = await ctx.getDb();

        // exact id wins even though it is also a prefix of nothing else
        expect(await inspect.resolveRunId(db, 'aaaa1111-2222-3333-4444-555555555555')).toBe(
            'aaaa1111-2222-3333-4444-555555555555',
        );
        // a unique prefix resolves to the same run the full id does
        expect(await inspect.resolveRunId(db, 'bbbb')).toBe('bbbb1111-2222-3333-4444-555555555555');
        // an ambiguous prefix names its candidates instead of guessing
        await expect(inspect.resolveRunId(db, 'aaaa')).rejects.toThrow(
            /Ambiguous run id prefix: aaaa; candidates: aaaa1111/,
        );
        // an absent prefix is a distinct failure
        await expect(inspect.resolveRunId(db, 'cccc')).rejects.toThrow('Run not found: cccc');
    });

    // 1319 R8 failure modes: the list query omits the pause anchor so a listed run is never
    // stalled; the node's own budget is ignored in favour of the 30-minute default; the label
    // appears on a run still inside its budget.
    test('a paused run past its node budget is stalled in both traceList and traceRun', async () => {
        writeFileSync(
            join(wfDir, 'gate.yaml'),
            `name: gate
kind: state-machine
initialState: ask
states:
  - id: ask
    pause: true
    onEnter:
      - kind: hitl.confirm
        options:
          prompt: "Approve?"
  - id: done
transitions:
  - from: ask
    to: done
    guard: { kind: always }
terminalStates:
  - done
`,
        );
        expect((await runOps.run(join(wfDir, 'gate.yaml'), { runId: 'ins-p' })).status).toBe('paused');
        const db = await ctx.getDb();
        // Inside the default budget, no node budget: not stalled.
        await db.run('UPDATE runs SET updated_at = ? WHERE id = ?', [Date.now() - 10_000, 'ins-p']);
        expect((await inspect.traceList(db, { workflow: 'gate' })).entries[0]?.stalled).toBeUndefined();
        expect((await inspect.traceRun(db, 'ins-p')).run.stalled).toBeUndefined();

        // The paused action carries a 1 s node budget (what the host surface records): 10 s is stalled.
        await db.run(
            `UPDATE action_runs SET result_json = json_set(COALESCE(result_json, '{}'), '$.pause', json('true'),
                 '$.data.timeoutMs', 1000) WHERE run_id = ?`,
            ['ins-p'],
        );
        const listed = (await inspect.traceList(db, { workflow: 'gate' })).entries[0];
        expect(listed?.stalled).toBe(true);
        expect(listed?.stalledMs).toBeGreaterThanOrEqual(10_000);
        const traced = (await inspect.traceRun(db, 'ins-p')).run;
        expect(traced.stalled).toBe(true);
        expect(traced.nextAction?.value).toBe('spur workflow continue ins-p');
    });

    test('inspectRunRecord reports a run with no record as missing', () => {
        expect(inspect.inspectRunRecord('never-ran')).toEqual({ status: 'missing' });
    });
});
