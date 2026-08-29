import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SPEC = readFileSync(join(import.meta.dir, '../../skills/spur-dev/references/execution-batch.md'), 'utf8');

/**
 * execution-batch worktree/zero-task contract pins (task 0701).
 *
 * Static pins for the prose lifecycle: the WT-3b commit step, the WT-4
 * zero-commit guard, --ignore-scripts at the worktree install call sites,
 * branch cleanup on a failed create, marker/lifecycle-DB ownership statements,
 * and the Step-1 zero-task rule. Behavioural halves (live dry-runs) are
 * separate command-typed evidence; these pins fail if the spec regresses.
 */
describe('execution-batch spec contract (task 0701)', () => {
    test('WT-3b — commit step exists before the terminal action', () => {
        expect(SPEC).toContain("### WT-3b — Commit the batch's writes on `$BRANCH`");
        expect(SPEC).toContain('git commit -m');
    });

    test('WT-4 — zero-commit guard refuses a silent empty FF-merge', () => {
        expect(SPEC).toContain('git rev-list --count');
        expect(SPEC).toContain('branch carries no commits');
    });

    test('WT-2 — worktree installs use --ignore-scripts (shared .git/hooks)', () => {
        expect(SPEC.match(/bun install --frozen-lockfile --ignore-scripts/g)?.length).toBeGreaterThanOrEqual(2);
        expect(SPEC).toContain('lefthook install');
    });

    test('WT-2 — failed create cleans up the dangling branch', () => {
        expect(SPEC).toContain('git branch -D "$BRANCH"');
    });

    test('WT-3/WT-6 — marker ownership: the invoking tree', () => {
        expect(SPEC).toContain("the **invoking** tree's");
        expect(SPEC).toContain('**in the invoking tree**');
    });

    test('WT-4/WT-5 — lifecycle-DB disposition is stated', () => {
        expect(SPEC).toContain('Lifecycle-DB disposition');
        expect(SPEC).toContain('committed task file is authoritative');
    });

    test('Step 1 — zero-task rule is defined (aborted, WT-2 skipped)', () => {
        expect(SPEC).toContain('Zero-task rule');
        expect(SPEC).toContain('empty set after the status');
        expect(SPEC).toContain('WT-2 is skipped entirely');
    });
});
