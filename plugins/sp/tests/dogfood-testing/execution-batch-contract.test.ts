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

describe('execution-batch spec contract (task 0720)', () => {
    test('Step 5 — worktree evidence persists to the invoking tree before removal', () => {
        expect(SPEC).toContain('Evidence persistence (worktree batches');
        expect(SPEC).toContain('.spur/run/worktree-<marker-id>-batch-report.md');
        expect(SPEC).toContain('.spur/run/worktree-<marker-id>-verdicts/<wbs>-verdict.json');
        expect(SPEC).toContain('routes to **WT-5** — the worktree and branch are retained');
        expect(SPEC).toContain('can never destroy its own evidence');
    });

    test('WT-4 — bounded CWD-holder cleanup: enumerate, TERM, bounded wait, KILL survivors, re-query', () => {
        expect(SPEC).toContain('WT-4b — bounded CWD-holder cleanup');
        expect(SPEC).toContain('lsof -t +D "$WT_PATH"');
        expect(SPEC).toContain('kill -TERM $HOLDERS');
        expect(SPEC).toContain('kill -KILL $SURVIVORS');
        // bounded wait loop, not an unverified single signal
        expect(SPEC).toMatch(/for _ in 1 2 3 4 5 6; do/);
        // PID mandatory, port best-effort — port absence must not hide the PID
        expect(SPEC).toContain('names every surviving PID');
        expect(SPEC).toContain('the listening port is best-effort');
        // fail-closed: removal proceeds only on an empty re-queried holder set
        expect(SPEC).toContain('only an EMPTY holder set may proceed');
        expect(SPEC).toContain('worktree still held by PID(s)');
    });

    test('WT-4 — the one-shot lsof|xargs kill is gone', () => {
        expect(SPEC).not.toContain('xargs');
        expect(SPEC).not.toContain('lsof+fuser');
    });

    test('R2d — lifecycle disposition is no-replay; committed files own state, persisted artifacts own evidence', () => {
        expect(SPEC).toContain('One contract, no alternatives');
        expect(SPEC).toContain('Committed task files own lifecycle state');
        expect(SPEC).toContain('The persisted invoking-tree artifacts own evidence');
        expect(SPEC).toContain('intentionally do not travel');
        // replay instructions removed
        expect(SPEC).not.toContain('Re-sync');
        expect(SPEC).not.toContain('spur task record <wbs>');
        expect(SPEC).not.toContain('task update <wbs>');
        expect(SPEC).not.toContain('Record-first ordering');
    });
});

describe('execution-batch spec contract (task 0924)', () => {
    test('WT-4 — projects.json registry cleanup upon worktree removal', () => {
        expect(SPEC).toContain('WT-4c — clean up registry entry in ~/.config/spur/projects.json');
        expect(SPEC).toContain('spur projects remove "$WT_PATH"');
    });

    test('WT-5 — discard instructions deregister worktree from projects.json', () => {
        expect(SPEC).toContain('spur projects remove <worktree-path>');
    });
});

describe('execution-batch spec contract (task 0919 — batch continuation reconciliation)', () => {
    test('BC — no identity-blind newest-checkpoint read remains', () => {
        expect(SPEC).toContain('Batch continuation (`--continue`)');
        expect(SPEC).not.toContain('ls -t .spur/memory/sessions/*.md 2>/dev/null | head -1');
        expect(SPEC).toContain('identity-blind');
        expect(SPEC).toContain('ignored regardless of recency');
    });

    test('BC-1 — frozen identity binds membership; post-freeze additions never join', () => {
        expect(SPEC).toContain('validation, not a re-definition');
        expect(SPEC).toContain('`not-admitted`');
        expect(SPEC).toContain('never silently\nrewritten');
    });

    test('BC-2 — checkpoints are hints; skip requires reconciled evidence; stale rechecks', () => {
        expect(SPEC).toContain('Checkpoints are hints');
        expect(SPEC).toContain('Anything less is not a valid skip.');
        expect(SPEC).toContain('`recheck`');
        expect(SPEC).toContain('Never treat an\n  unverified claim as done.');
    });

    test('BC-1/BC-2 — changed dependencies and lost worktree produce explicit blocked outcomes', () => {
        expect(SPEC).toContain('blocked (admission invalidated —\nre-plan required)');
        expect(SPEC).toContain('(lost worktree, unresolvable marker), report `blocked` with the reason');
    });

    test('BC-3 — resumed partial batch is never reported clean; evidence survives cleanup', () => {
        expect(SPEC).toContain('is never reported `clean`');
        expect(SPEC).toContain('task 0720 R3');
        expect(SPEC).toContain('routes to **WT-5**');
    });
});
