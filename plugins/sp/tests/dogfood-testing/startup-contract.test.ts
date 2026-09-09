import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DRIVER = readFileSync(
    join(import.meta.dir, '../../skills/spur-dev/references/inline-pipeline-driver.md'),
    'utf8',
);
const CROSS = readFileSync(join(import.meta.dir, '../../skills/spur-dev/references/cross-cutting.md'), 'utf8');
const BATCH = readFileSync(join(import.meta.dir, '../../skills/spur-dev/references/execution-batch.md'), 'utf8');

/**
 * Shared startup-contract / retention spec pins (task 0814 R1/R3/R7).
 *
 * Static pins for the prose startup contract in the shared reference owners —
 * the same pattern as execution-batch-contract.test.ts. R1 (bootstrap → quick
 * readiness → isolation → inventory-before-YAML ordering), R3 (quickReadiness
 * precedes worktree creation/adoption; invalid/empty targets cut no tree), and
 * R7 (comprehensive checks stay at owning boundaries; deterministic first).
 * These pins fail if the shared startup procedure regresses.
 */
describe('shared startup contract (task 0814 R1) — spec pins', () => {
    test('cross-cutting owns a shared startup contract SSOT naming the load-bearing order', () => {
        expect(CROSS).toContain('## Shared startup contract (task 0814 R1/R3/R4/R6/R7/R8)');
        expect(CROSS).toContain('1. **Publish a compact bootstrap checklist immediately**');
        expect(CROSS).toContain('4. **Publish the workflow inventory (R4), before reading the YAML.**');
        expect(CROSS).toContain('bootstrap checklist');
    });

    test('driver run-setup order is bootstrap → quick readiness → isolation → inventory-before-YAML', () => {
        const steps = [
            'Publish the bootstrap checklist (R1)',
            'Quick deterministic readiness (R2), before isolation',
            'Isolation (R3), only when `--worktree` is valid',
            'Publish the workflow inventory (R4), BEFORE reading the YAML',
        ];
        let prev = -1;
        for (const s of steps) {
            const i = DRIVER.indexOf(s);
            expect(i).toBeGreaterThan(prev);
            prev = i;
        }
    });

    test('inventory is published before the driver reads the full YAML for model/comprehensive work', () => {
        expect(DRIVER).toContain('only then read the full YAML for comprehensive/model work');
        expect(DRIVER).toContain('--no-logo --format todo --json');
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
