import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..', '..');
const EXECUTION_BATCH = join(ROOT, 'plugins', 'sp', 'skills', 'spur-dev', 'references', 'execution-batch.md');
const DEV_RUNALL = join(ROOT, 'plugins', 'sp', 'commands', 'dev-runall.md');
const FLAG_GLOSSARY = join(ROOT, 'plugins', 'sp', 'skills', 'spur-dev', 'references', 'flag-glossary.md');
const SUPER_PLANNER = join(ROOT, 'plugins', 'sp', 'agents', 'super-planner.md');
const PLUGIN_SP = join(ROOT, 'plugins', 'sp');
const SECTION_HEADING = '## Parallel isolation (`--mode parallel`)';
const SECTION_LINK = '#parallel-isolation---mode-parallel';
const NEW_REJECTION_REASON = 'parallel mode already isolates each task in its own worktree';

// 0931 R1-R6 — `--mode parallel` isolates every concurrently running task in its own create-mode
// worktree (`sp/run-<wbs>-<short-id>`), bounds the fan-out with `--concurrency` (default 2),
// integrates by rebase + `--ff-only` only, retains the worktree on a rebase conflict as
// `integration-conflict` (never auto-resolved), and defers the per-task feature sync
// (`deferFeatureSync`) until after integration. This file is the prose contract;
// `parallel-integration-git.test.ts` proves the git mechanics in a temp repo.

/** Fold a markdown slice to single spaces so prose assertions survive rewrapping. */
function flat(raw: string): string {
    return raw.replace(/\s+/g, ' ');
}

/** The § Parallel isolation section: from its heading to the next same-level heading. */
function parallelIsolationSection(): string {
    const raw = readFileSync(EXECUTION_BATCH, 'utf8');
    const start = raw.indexOf(SECTION_HEADING);
    if (start < 0) throw new Error(`missing "${SECTION_HEADING}" in execution-batch.md`);
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

describe('task 0931 — parallel isolation prose contract', () => {
    const executionBatch = readFileSync(EXECUTION_BATCH, 'utf8');
    const superPlanner = readFileSync(SUPER_PLANNER, 'utf8');
    const section = parallelIsolationSection();
    const prose = flat(section);

    test('AC1 (R1) — per-task create-mode worktrees, WT-3 markers with batchId, no shared tree', () => {
        expect(prose).toContain('every concurrently running task gets its **own create-mode git worktree**');
        expect(section).toContain('sp/run-<wbs>-<short-id>');
        expect(prose).toContain('cut from the current base-ref tip');
        expect(prose).toContain('Two task pipelines never share a working tree');
        expect(prose).toContain('the main tree receives no task writes while the batch runs');
        // Per-task WT-3 marker: schema fields + the batch-shared batchId.
        expect(section).toContain('{command: dev-runall, selector: <wbs>, batchId: <batchId>}');
        expect(prose).toContain('(path, branch, baseRef, baseSha) + batchId shared by every marker');
    });

    test('AC2 (R2) — bounded concurrency, integration-gated eligibility, sequential default', () => {
        expect(section).toContain('|running| < CONCURRENCY and ready has t with deps(t) ⊆ integrated:');
        expect(section).toContain('[`--concurrency <n>`](flag-glossary.md#flag-concurrency)');
        expect(prose).toContain('default **2**, `n ≥ 1`');
        expect(prose).toContain('at most that many pipelines run at once');
        expect(prose).toContain('only when all of its in-set dependencies are **integrated** onto the base ref');
        expect(prose).toContain('Omitting `--mode` stays sequential');
    });

    test('AC3 (R3) — integration is rebase then --ff-only; never a merge commit, never --no-ff', () => {
        expect(section).toContain('git -C "$WT" rebase "$BASE_REF"');
        expect(section).toContain('git merge --ff-only "$BRANCH"');
        expect(prose).toContain('integrations are **serialized** (one at a time) in completion order');
        expect(prose).toContain(
            'The pipeline never creates a merge commit, and no conflict is ever resolved automatically',
        );
        expect(section).not.toContain('--no-ff');
        expect(executionBatch).not.toContain('--no-ff');
    });

    test('AC4 (R4) — conflict aborts the rebase, retains the worktree, reports, blocks; no auto-resolution', () => {
        expect(section).toContain('git -C "$WT" rebase --abort');
        expect(prose).toContain('There is no auto-resolution');
        expect(prose).toContain('(WT-5, marker `retained`)');
        expect(section).toContain('outcome is `integration-conflict`');
        // The report row names path, branch, and the manual resume/merge/discard commands.
        expect(section).toContain('resume:  cd <worktree-path> && git rebase <BASE_REF>');
        expect(section).toContain('merge:   git checkout <BASE_REF> && git merge --ff-only <branch>');
        expect(section).toContain('discard: git worktree remove <worktree-path> && git branch -D <branch>');
        expect(prose).toContain('dependent subtree is blocked under the normal failure policy');
    });

    test('AC5 (R5) — generated regions: deferFeatureSync deferral + one post-integration sync/refresh', () => {
        expect(prose).toContain('`deferFeatureSync: "true"` (default `"false"`)');
        expect(prose).toContain('feature sync deferred to batch integration');
        expect(prose).toContain('branches never touch feature files or `docs/features/INDEX.md`');
        expect(section).toContain('`spur feature refresh --feature <f>`');
        expect(prose).toContain('`chore(corpus)` commit');
        // Step 5 vocabulary + super-planner carry the parallel-only outcome.
        expect(flat(executionBatch)).toContain('and the parallel-only `integration-conflict`');
        expect(superPlanner).toContain('integration-conflict');
    });

    test('R6 — the lifted rejection: --worktree + --mode parallel fails with the new reason everywhere', () => {
        expect(prose).toContain(NEW_REJECTION_REASON);
        expect(flat(readFileSync(DEV_RUNALL, 'utf8'))).toContain(NEW_REJECTION_REASON);
        expect(flat(readFileSync(FLAG_GLOSSARY, 'utf8'))).toContain(NEW_REJECTION_REASON);
        expect(prose).toContain('`--worktree --mode parallel` fails with');
    });

    test('R6 — Step 3 routes parallel mode to the new section; the shared-tree wording is gone', () => {
        expect(executionBatch).toContain(SECTION_LINK);
        expect(executionBatch).not.toContain('subagent/worktree-safe context');
        expect(executionBatch).not.toContain('## Parallel Execution');
    });

    test('AC5 — no retired 0142 deferral reference remains on any non-test plugin surface', () => {
        const offenders = collectSourceFiles(PLUGIN_SP).filter((f) => readFileSync(f, 'utf8').includes('0142'));
        expect(offenders).toEqual([]);
    });
});
