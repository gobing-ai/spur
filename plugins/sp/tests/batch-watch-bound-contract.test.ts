import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..', '..');
const EXECUTION_BATCH = join(ROOT, 'plugins', 'sp', 'skills', 'spur-dev', 'references', 'execution-batch.md');
const SPUR_DEV_SKILL = join(ROOT, 'plugins', 'sp', 'skills', 'spur-dev', 'SKILL.md');
const SUPER_PLANNER = join(ROOT, 'plugins', 'sp', 'agents', 'super-planner.md');

// 0930 R3/R4 — the batch driver's watch bound and terminal-evidence acceptance rule are
// plugin contracts: every driver surface must carry the single `--follow --timeout 600000`
// bound (the retired "10 minutes or 20 polls" wording must not return) and the verdict
// acceptance rule (trace `.run.runId` == dispatched run AND verdict mtime ≥ `.run.startedAt`, else
// `stale-evidence`), with a timeout never cancelling or relaunching the run.

describe('task 0930 — bounded watch + stale-evidence acceptance contract', () => {
    const executionBatch = readFileSync(EXECUTION_BATCH, 'utf8');
    const spurDev = readFileSync(SPUR_DEV_SKILL, 'utf8');
    const superPlanner = readFileSync(SUPER_PLANNER, 'utf8');

    test('execution-batch.md watches through --follow --timeout 600000 and projects the per-run trace under .run', () => {
        expect(executionBatch).toContain('--follow --timeout 600000');
        // The per-run trace payload nests identity/status under `.run`; the broken top-level
        // jq (`{runId, status, terminalState}` reads nothing) must not come back.
        expect(executionBatch).toContain("jq '.run | {runId, status, startedAt}'");
        expect(executionBatch).not.toContain('{runId, status, terminalState}');
    });

    test('execution-batch.md accepts the verdict only on trace-runId identity + mtime ≥ .run.startedAt freshness', () => {
        expect(executionBatch).toContain('stale-evidence');
        expect(executionBatch).toContain('.run.startedAt');
        expect(executionBatch).toContain('never cancel or relaunch');
        // Identity lives in the TRACE (`.run.runId`); the WBS-keyed verdict artifact carries no runId.
        expect(executionBatch).toContain("the **trace's** `.run.runId` equals");
        expect(executionBatch).not.toContain("the verdict's `runId`");
    });

    test('spur-dev SKILL.md and super-planner.md carry the single bound instead of the retired poll-count rule', () => {
        expect(spurDev).toContain('--follow --timeout 600000');
        expect(spurDev).not.toMatch(/10 minutes or 20 polls/);
        expect(superPlanner).toContain('--follow --timeout 600000');
        expect(superPlanner).toContain('stale-evidence');
        expect(superPlanner).toContain('.run.startedAt');
        expect(superPlanner).toContain("the trace's `.run.runId` equals the dispatched");
    });
});
