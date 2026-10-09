import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readRunbook } from '../helpers/runbook-parts';

const DRIVER = readRunbook('inline-pipeline-driver');
const CROSS = readFileSync(join(import.meta.dir, '../../skills/spur-dev/references/cross-cutting.md'), 'utf8');
const BATCH = readRunbook('execution-batch');
const PLANNER = readFileSync(join(import.meta.dir, '../../agents/super-planner.md'), 'utf8');
const COMMANDS_DIR = join(import.meta.dir, '../../commands');

/**
 * Shared startup-contract / retention spec pins (task 0814 R1/R3/R7; publish-first 1105 R1–R4).
 *
 * Static pins for the prose startup contract in the shared reference owners —
 * the same pattern as execution-batch-contract.test.ts. 0814 R1 (publish the
 * generated plan → quick readiness → isolation → digest-binding ordering),
 * R3 (quickReadiness precedes worktree creation/adoption; invalid/empty
 * targets cut no tree), and R7 (comprehensive checks stay at owning
 * boundaries; deterministic first). 1105 pins the publish-first contract: the
 * generated `.plan` is the first visible list, the hand-written bootstrap rows
 * and AA label rule are gone, and the batch/command surfaces publish first.
 * These pins fail if the shared startup procedure regresses.
 */
describe('shared startup contract (task 0814 R1) — spec pins', () => {
    test('cross-cutting owns a shared startup contract SSOT naming the load-bearing order', () => {
        expect(CROSS).toContain('## Shared startup contract (task 0814 R1/R3/R4/R6/R7/R8)');
        expect(CROSS).toContain('1. **Publish the generated plan first (1105 R1)');
        expect(CROSS).toContain('4. **Bind the published plan to the run digest (R4)');
        expect(CROSS).toContain('--no-logo --format todo --json');
    });

    test('driver run-setup order is publish → quick readiness → isolation → digest binding', () => {
        const steps = [
            '5. **Publish the generated plan (R1, 1105)',
            '6. **Quick deterministic readiness (R2), before isolation',
            '7. **Isolation (R3), only when `--worktree` is valid',
            '8. **Bind the published plan to the run digest (R4)',
        ];
        let prev = -1;
        for (const s of steps) {
            const i = DRIVER.indexOf(s);
            expect(i).toBeGreaterThan(prev);
            prev = i;
        }
    });

    test('inventory is published before the driver reads the full YAML for model/comprehensive work', () => {
        expect(DRIVER).toContain('then read the full YAML for comprehensive/model work');
        expect(DRIVER).toContain('--no-logo --format todo --json');
    });
});

describe('publish-first contract (task 1105 R1/R2) — spec pins', () => {
    test('AC1 — the hand-written bootstrap rows and the AA label rule are gone from run instructions', () => {
        expect(CROSS).not.toContain('`A, Quick readiness`');
        expect(DRIVER).not.toContain('`A, Quick readiness`');
        expect(CROSS).not.toContain('Z, AA, AB');
        expect(DRIVER).not.toContain('AA, AB');
        expect(DRIVER).not.toContain('A, B, … Z, AA');
    });

    test('AC1 — the first run-setup action is workflow show + verbatim .plan publish with a steps[] fallback', () => {
        expect(DRIVER).toContain('5. **Publish the generated plan (R1, 1105)');
        expect(DRIVER).toContain("`.plan` row's `text` **verbatim**");
        expect(DRIVER).toContain('`steps[]` inventory');
        expect(DRIVER).toContain('columnLabel');
    });

    test('AC1 — frozen status mapping, insert-on-entry, attempt N, and [outcome] rendering are pinned', () => {
        expect(DRIVER).toContain('Frozen status mapping: `pending → pending`,');
        expect(DRIVER).toContain('`active → in_progress`, `completed → completed`,');
        expect(DRIVER).toContain('skipped|failed|unattempted|blocked → pending` + ` [<outcome>]`');
        expect(DRIVER).toContain(' — attempt N');
        expect(DRIVER).toContain('insertOnEntry');
    });

    test('R2 — per-item and full-list host update styles are documented with the Markdown fallback', () => {
        for (const needle of [
            'TaskCreate',
            'TaskUpdate',
            'update_plan',
            'write_todos',
            'todowrite',
            'todo_write',
            'renderProgressMarkdown',
            'per-item',
            'full-list',
        ]) {
            expect(DRIVER, `driver should document ${needle}`).toContain(needle);
        }
    });
});

describe('batch and command publish-first (task 1105 R3/R4) — spec pins', () => {
    test('AC2 — execution-batch carries a Visible batch plan subsection between Steps 2 and 3', () => {
        expect(BATCH).toContain('### 2.7 Visible batch plan');
        const section = BATCH.indexOf('### 2.7 Visible batch plan');
        expect(section).toBeGreaterThan(BATCH.indexOf('### 2.6 Preflight'));
        expect(section).toBeLessThan(BATCH.indexOf('## Step 3'));
        for (const needle of ['batch-plan.mjs', 'waves --tasks', 'task-children --letter', 'Z Batch report']) {
            expect(BATCH, `batch driver should name ${needle}`).toContain(needle);
        }
    });

    test('AC2 — the Step 3 loop marks the visible-plan start/end updates', () => {
        const loop = BATCH.indexOf('for wbs in plan:');
        expect(loop).toBeGreaterThan(-1);
        const block = BATCH.slice(loop, BATCH.indexOf('### 3.1'));
        expect(block).toContain('§2.7');
    });

    test('AC2 — each workflow dev command publishes the plan as its first Implementation bullet', () => {
        for (const cmd of ['dev-run', 'dev-runall', 'dev-parallel', 'dev-idea', 'dev-plan']) {
            const md = readFileSync(join(COMMANDS_DIR, `${cmd}.md`), 'utf8');
            const impl = md.indexOf('## Implementation');
            expect(impl).toBeGreaterThan(0);
            const firstBullet = md.indexOf('\n- ', impl);
            const head = md.slice(firstBullet, firstBullet + 600);
            expect(head, `${cmd}.md first Implementation bullet`).toContain('1105');
            expect(head, `${cmd}.md first Implementation bullet`).toContain('publish');
        }
    });

    test('AC2 — super-planner states the parent host owns the visible list and subagents return outcomes', () => {
        expect(PLANNER).toContain('parent host owns the visible');
        expect(PLANNER).toContain('{wbs, state, outcome}');
    });
});

describe('worktree startup ordering (task 0814 R3) — spec pins', () => {
    test('execution-batch.md puts command-aware quickReadiness before worktree creation/adoption', () => {
        expect(BATCH).toContain('command-aware readiness (the `quickReadiness` contract in `batch-preflight.ts`)');
        expect(BATCH).toContain('**before** creating');
    });

    test('invalid/empty/unsupported targets create no worktree and no marker', () => {
        expect(BATCH).toContain('quickReadiness marks `blocked`/`invalid` creates no tree and no marker');
        expect(BATCH).toContain('**WT-2 is skipped entirely**: no worktree is cut and no WT-3 marker is');
    });
});

describe('comprehensive-check retention (task 0814 R7) — spec pins', () => {
    test('cross-cutting keeps comprehensive gates at owning boundaries, deterministic first', () => {
        expect(CROSS).toContain(
            '5. **Load execution detail and run comprehensive checks (R7).** Only after the plan is visible',
        );
        expect(CROSS).toContain(
            'comprehensive gates at their boundaries. Prefer deterministic checks; invoke semantic model work',
        );
    });

    test('driver retains comprehensive checks at owning boundaries with a named R7 section', () => {
        expect(DRIVER).toContain('## Comprehensive-check retention and evidence (R7/R8)');
        expect(DRIVER).toContain('R7 — comprehensive checks stay at their owning boundaries');
    });
});
