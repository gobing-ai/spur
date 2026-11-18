import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readRunbook, referencePath } from './helpers/runbook-parts';

const ROOT = join(import.meta.dir, '..', '..', '..');
const DEV_RUNALL = join(ROOT, 'plugins', 'sp', 'commands', 'dev-run.md');
const FLAG_GLOSSARY = join(ROOT, 'plugins', 'sp', 'skills', 'spur-dev', 'references', 'flag-glossary.md');
const SUPER_PLANNER = join(ROOT, 'plugins', 'sp', 'agents', 'super-planner.md');
const PLUGIN_SP = join(ROOT, 'plugins', 'sp');
/**
 * Task 1343 (G76 1341/1342) moved parallel isolation out of the prose and into the fleet kernel.
 * The section now records the contract and names its owners; the git mechanics are pinned by
 * `packages/app/tests/services/fleet-integration-queue.test.ts` and `fleet-lanes-e2e.test.ts`.
 */
const WORKTREE_REFERENCE = referencePath('execution-worktree.md');
const SECTION_HEADING = '## `--mode parallel` — engine-owned (G76 1341/1342/1343)';
const SECTION_LINK = '#-mode-parallel--engine-owned-g76-134113421343';
const NEW_REJECTION_REASON = 'parallel mode already isolates each task in its own worktree';
const ENGINE_OWNERS = [
    'packages/app/src/services/worktree-lane-service.ts',
    'packages/app/src/services/fleet-integration-queue.ts',
    'packages/app/src/services/fleet-foreground-loop.ts',
];

/** Fold a markdown slice to single spaces so prose assertions survive rewrapping. */
function flat(raw: string): string {
    return raw.replace(/\s+/g, ' ');
}

/** The engine-owned parallel section: from its heading to the next `## ` heading. */
function parallelSection(): string {
    const raw = readFileSync(WORKTREE_REFERENCE, 'utf8');
    const start = raw.indexOf(SECTION_HEADING);
    if (start < 0) throw new Error(`missing "${SECTION_HEADING}" in execution-worktree.md`);
    const next = raw.indexOf('\n## ', start + 1);
    return raw.slice(start, next < 0 ? undefined : next);
}

/** Every non-test .md/.ts/.yaml file under plugins/sp (tests may cite the retired number). */
function collectSourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'tests' || entry.name === 'node_modules') continue;
            collectSourceFiles(full, out);
        } else if (/\.(md|ts|yaml)$/.test(entry.name)) {
            out.push(full);
        }
    }
    return out;
}

describe('task 1343 — parallel mode is engine-owned', () => {
    const executionBatch = readRunbook('execution-batch');
    const superPlanner = readFileSync(SUPER_PLANNER, 'utf8');
    const section = parallelSection();
    const prose = flat(section);

    test('R1/R2 — the section names the three engine owners and no per-task worktree prose', () => {
        for (const owner of ENGINE_OWNERS) expect(section).toContain(owner);
        expect(prose).toContain('The frozen set is tagged `fleet:auto`');
        expect(prose).toContain('opens one **lane** per write dispatch');
        expect(prose).toContain('rebases, gates and fast-forwards each finished lane');
        // R4 inversion: no driver git command survives in the skill prose for parallel mode.
        expect(section).not.toContain('git worktree');
        expect(section).not.toMatch(/git merge/);
        expect(section).not.toContain('sp/run-<wbs>-<short-id>');
    });

    test('R2 — the report is projected from the ledger, not from terminal output', () => {
        expect(prose).toContain('projected from `fleet.lane.*` / `fleet.task.integrated` events');
        expect(prose).toContain('`fleetReportRows`');
    });

    test('R3 — a fleet-less project refuses parallel mode and names the fix', () => {
        expect(prose).toContain('without an enabled fleet, a coder member or `agent.fleet.maxWriters`');
        expect(prose).toContain('refuses parallel mode with the fix named');
        expect(prose).toContain('`parallelRefusal`');
        expect(prose).toContain('rather than falling back to serial');
    });

    test('surviving contracts: integrated-not-terminal, --worktree rejection, defer-gate, conflict retention', () => {
        expect(prose).toContain('only when its in-set dependencies are **integrated**, not merely pipeline-terminal');
        expect(prose).toContain('admission reads `fleet.task.integrated`, never corpus status');
        expect(prose).toContain('`--worktree` is rejected under `--mode parallel`');
        expect(prose).toContain('`--defer-gate` runs the one full gate on the integrated base ref');
        expect(prose).toContain('rebase conflict aborts, retains lane and branch');
        expect(prose).toContain('`integration-conflict`');
        expect(prose).toContain('never auto-resolved');
        expect(flat(executionBatch)).toContain('and the parallel-only `integration-conflict`');
        expect(superPlanner).toContain('integration-conflict');
    });

    test('R6 — the lifted rejection reason still reaches the command surface', () => {
        expect(flat(readFileSync(DEV_RUNALL, 'utf8'))).toContain(NEW_REJECTION_REASON);
        expect(flat(readFileSync(FLAG_GLOSSARY, 'utf8'))).toContain(NEW_REJECTION_REASON);
    });

    test('R4 — execution-batch keeps the driver loop and points at the reference', () => {
        expect(executionBatch).toContain(SECTION_LINK);
        expect(executionBatch).toContain('Nothing in this file runs `git worktree` or a landing merge.');
        expect(executionBatch).not.toContain('subagent/worktree-safe context');
        expect(executionBatch).not.toContain('## Parallel Execution');
        // The retired per-task isolation loop is gone from the driver file.
        expect(executionBatch).not.toContain('WT-2 create  sp/run-<wbs>-<short-id>');
    });

    test('AC5 — no retired 0142 deferral reference remains on any non-test plugin surface', () => {
        const offenders = collectSourceFiles(PLUGIN_SP).filter((f) => readFileSync(f, 'utf8').includes('0142'));
        expect(offenders).toEqual([]);
    });
});
