import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 1129 AC4 (R5): the runbooks route every driver commit through `spur workflow commit-guard`.
 * The guard itself moved into the CLI (script-absorption PR-4); its behaviour is pinned by
 * `packages/app/tests/workflow/commit-guard.test.ts`. This file keeps the doc contract for the
 * surviving execution runbooks (the inline driver runbook retired with the driver, task 1242).
 */

const ROOT = join(import.meta.dir, '..', '..', '..');
const REFERENCES = join(ROOT, 'plugins', 'sp', 'skills', 'spur-dev', 'references');
const ref = (name: string): string => join(REFERENCES, name);
const DRIVER_DOCS = [
    'execution-batch.md',
    'execution-batch-report.md',
    'execution-worktree-setup.md',
    'execution-worktree-landing.md',
    'execution-parallel-isolation.md',
    'execution-batch-continuation.md',
] as const;
/** Files that MUST define at least one commit step — losing one is a contract loss, not a move. */
const COMMIT_STEP_DOCS = [
    'execution-batch-report.md',
    'execution-worktree-setup.md',
    'execution-worktree-landing.md',
] as const;

/**
 * AC4 (R5) — the runbooks route every driver commit through the guard. The contract is mechanical:
 * the word in the doc is what the driver executes, so a free-form `git add` cannot come back.
 *
 * A commit step is the contiguous non-blank command region around each `git commit` line (fenced-
 * block pairing is unreliable in these files: they contain nested fences).
 */
describe('commit-guard (1129 AC4) — runbook commit-step contract', () => {
    const docs = DRIVER_DOCS.map((name) => [name, readFileSync(ref(name), 'utf8')] as const);

    /** Every command region that ends in a `git commit` invocation. */
    function commitSteps(doc: string): string[] {
        const lines = doc.split('\n');
        const steps: string[] = [];
        lines.forEach((line, index) => {
            if (!/git commit\b/.test(line)) return;
            let start = index;
            while (start > 0 && (lines[start - 1] ?? '').trim().length > 0) start--;
            steps.push(lines.slice(start, index + 1).join('\n'));
        });
        return steps;
    }

    /** The guard call: `spur workflow commit-guard stage` (the retired `$GUARD` script form is gone). */
    function invokesGuard(step: string): boolean {
        return /spur workflow commit-guard\s+stage/.test(step);
    }

    test('every commit step invokes commit-guard stage', () => {
        for (const [name, doc] of docs) {
            const steps = commitSteps(doc);
            if (COMMIT_STEP_DOCS.includes(name as (typeof COMMIT_STEP_DOCS)[number])) {
                expect([name, steps.length > 0]).toEqual([name, true]);
            }
            for (const step of steps) {
                if (!invokesGuard(step)) throw new Error(`${name}: commit step without the guard:\n${step}`);
            }
        }
    });

    test('git add -A and git add . appear only in a forbidden sentence', () => {
        for (const [name, doc] of docs) {
            for (const line of doc.split('\n')) {
                if (!/git add (-A|\.)(?![\w/])/.test(line)) continue;
                expect([name, /forbidden/i.test(line)]).toEqual([name, true]);
            }
        }
    });

    test('every guard start fixes RUN_ID first, so the later stage call reuses a defined id', () => {
        // 1129 residual (b): the sequential start/close-out pair consumed `$RUN_ID` with no assignment
        // on that path — the guard then failed closed (exit 1) instead of guarding the close-out.
        for (const [name, doc] of docs) {
            const start = doc.search(/spur workflow commit-guard\s+start --run "\$RUN_ID"/);
            if (start < 0) continue;
            expect([name, /RUN_ID\s*=/.test(doc.slice(0, start))]).toEqual([name, true]);
        }
    });

    test('the guard is documented wherever a commit step lives, with the incidents that motivated it', () => {
        const corpus = docs.map(([, doc]) => doc).join('\n');
        // Both incidents ride the guard wiring that the 1128 split scattered across the runbook set.
        expect(corpus.includes('a94f9f431') && corpus.includes('36f274590')).toBe(true);
        for (const name of COMMIT_STEP_DOCS) {
            const doc = docs.find(([n]) => n === name)?.[1] ?? '';
            expect([name, doc.includes('commit-guard')]).toEqual([name, true]);
            expect([name, doc.includes('git add -A')]).toEqual([name, true]);
        }
    });
});

describe('commit-guard docs — the retired script form is gone', () => {
    test('no runbook resolves the deleted commit-guard script', () => {
        for (const name of DRIVER_DOCS) {
            const doc = readFileSync(ref(name), 'utf8');
            expect([name, /commit-guard\.(ts|mjs)|\$GUARD\b/.test(doc)]).toEqual([name, false]);
        }
    });
});
