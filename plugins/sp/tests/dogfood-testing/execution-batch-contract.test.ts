import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { getEnvVars } from '@gobing-ai/ts-utils';
import { readRunbook, referencePath } from '../helpers/runbook-parts';

const SPEC = readRunbook('execution-batch');

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

describe('execution-batch spec contract (task 1089 R1)', () => {
    test('WT-2 stages prior-task verdicts into the worktree, never clobbering one', () => {
        const wt2 = SPEC.indexOf('### WT-2 — Worktree creation or adoption');
        const wt3 = SPEC.indexOf('### WT-3 — Crash-safe state marker');
        const staging = SPEC.indexOf('#### Evidence staging before the first task (create and reuse mode)');
        // R4: the step lives inside § WT-2, in the create/adopt → marker → loop sequence.
        expect(wt2).toBeGreaterThan(-1);
        expect(wt3).toBeGreaterThan(wt2);
        expect(staging).toBeGreaterThan(wt2);
        expect(staging).toBeLessThan(wt3);
        // R1: both untracked evidence planes, `cp -n`, and the before-first-task ordering.
        expect(SPEC).toContain('for d in .spur/memory/evidence .spur/run; do');
        expect(SPEC).toContain('cp -n "$f" "$WT/$d/"');
        expect(SPEC).toContain('before the first task runs');
        expect(SPEC).toContain('must never clobber it');
    });
});

describe('execution-batch spec contract (task 0948 R9)', () => {
    test('default worktree root is a sibling path, not under .spur/', () => {
        expect(SPEC).toContain('git worktree add "../<repo>-<command>-<selector-slug>-<short-id>"');
        expect(SPEC).toContain('Worktree root is outside `.spur/`');
        expect(SPEC).toContain('Checked 0 files');
        expect(SPEC).not.toContain('git worktree add ".spur/');
        expect(SPEC).not.toContain('git worktree add `.spur/');
    });

    test('copy-out is mandatory and the verify-answer table is four columns', () => {
        expect(SPEC).toContain('Copy-out is mandatory');
        expect(SPEC).toContain('| AC | Status | Evidence Type | Evidence |');
        expect(SPEC).toContain('isolated in cell 3');
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
    test('WT-2 — create mode registers the worktree in projects.json', () => {
        expect(SPEC).toContain('WT-2r — register the worktree in ~/.config/spur/projects.json');
        expect(SPEC).toContain('spur projects add "../<repo>-<command>-<selector-slug>-<short-id>"');
    });

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

describe('execution-batch spec contract (task 0975 R1 — per-run provenance persist-out)', () => {
    test('WT-4a — the persist-out call is wired before WT-4b with the shared WT_PATH hoisted above both', () => {
        // The create-mode block resolves WT_PATH once, runs persist-out, then holder cleanup.
        const wtPath = SPEC.indexOf('WT_PATH="$(cd "../<worktree-dir>" && pwd)"');
        const persistOut = SPEC.indexOf('bun "$SETUP_SCRIPT" --persist-out --from "$WT_PATH"');
        const holderCleanup = SPEC.indexOf('WT-4b — bounded CWD-holder cleanup');
        expect(wtPath).toBeGreaterThanOrEqual(0);
        expect(persistOut).toBeGreaterThan(wtPath);
        expect(holderCleanup).toBeGreaterThan(persistOut);
        // Exactly one resolution site — no second, divergent copy further down.
        expect(SPEC.match(/WT_PATH="\$\(cd "\.\.\/<worktree-dir>" && pwd\)"/g)).toHaveLength(1);
    });

    test('WT-4a — persist-out failure halts with WT-5 routing (worktree + branch retained)', () => {
        expect(SPEC).toContain('worktree run-record persist-out failed - worktree retained (WT-5)');
        expect(SPEC).toContain('Any persistence failure routes to WT-5');
    });

    test('prose — stage-record copy-out is the mechanical persist-out, not a manual duty', () => {
        expect(SPEC).toContain('persisted by 0975 R1');
        expect(SPEC).toContain('inline-run-setup.ts --persist-out --from <worktree>');
        expect(SPEC).toContain('idempotent on re-persist');
        expect(SPEC).not.toContain('must copy those records out');
        expect(SPEC).toContain('spur workflow progress --json` in the\ninvoking tree shows the merged run `done`');
    });
});

describe('execution-batch spec contract (task 0984 — cited run evidence survives teardown)', () => {
    test('WT-4a — the persist-out call forwards the merged task file(s) via repeatable --task-file', () => {
        expect(SPEC).toContain(`bun "$SETUP_SCRIPT" --persist-out --from "$WT_PATH" "\${TASK_FILE_ARGS[@]}"`);
        expect(SPEC).toContain('spur task show <wbs> --json | jq -r .filePath');
        expect(SPEC).toContain('repeatable `--task-file <path>`');
        // The driver resolves paths in the invoking tree post-merge, via the task-show fast path.
        expect(SPEC).toContain('spur task show <wbs> --json` → `.filePath`');
    });

    test('prose — citation failure semantics and the record-missing skip are pinned', () => {
        expect(SPEC).toContain('A citation missing in BOTH trees');
        expect(SPEC).toContain('`record-missing:<file>`');
        expect(SPEC).toContain('0984 R5');
        expect(SPEC).toContain('Abbreviated references');
    });
});

const RUNALL = readFileSync(join(import.meta.dir, '../../commands/dev-runall.md'), 'utf8');
const GLOSSARY = readFileSync(join(import.meta.dir, '../../skills/spur-dev/references/flag-glossary.md'), 'utf8');

describe('execution-batch spec contract (task 0477 — worktree isolation lifecycle)', () => {
    test('R2.1/R2.2 — one worktree cut from the current ref, not literally main', () => {
        expect(SPEC).toContain('BASE_REF=$(git rev-parse --abbrev-ref HEAD)');
        expect(SPEC).toContain(
            'git worktree add "../<repo>-<command>-<selector-slug>-<short-id>" -b "$BRANCH" "$BASE_REF"',
        );
    });

    test('R3.1/R3.2 — dirty main tree aborts before creation; --force proceeds with a warning', () => {
        expect(SPEC).toContain('**Dirty tree** → **abort** before any worktree is created');
        expect(SPEC).toContain('proceed past a dirty tree with a divergence warning');
    });

    test('R4.1/R4.2 — FF-only merge; a non-FF base falls through to retention', () => {
        expect(SPEC).toContain(
            'git merge --ff-only "$BRANCH"          # FF-only: never rebase, merge-commit, or resolve conflicts',
        );
        expect(SPEC).toContain('WT-5 retains the worktree and branch whenever FF is impossible');
    });

    test('R5.1–R5.3 — halted batch retains intact; report names path/branch/cause + three commands', () => {
        expect(SPEC).toContain('worktree directory and branch are left **intact**');
        expect(SPEC).toContain(
            'flag combination (`--auto`, `--force`, `--keep-going` — all leave the worktree in place)',
        );
        for (const field of ['**Halt cause:**', '**Worktree path:**', '**Branch:**', 'resume:', 'merge:', 'discard:']) {
            expect(SPEC).toContain(field);
        }
    });

    test('R6.1/R6.2 — marker under .spur/run; a killed session leaves it recoverable', () => {
        expect(SPEC).toContain('`.spur/run/worktree-<marker-id>.json`');
        expect(SPEC).toContain('a killed session leaves the marker at `status: active`');
    });

    test('R7.1/R7.2 — --continue re-enters via the marker; no marker fails loudly', () => {
        expect(SPEC).toContain('must re-enter the existing worktree via');
        expect(SPEC).toContain('**Not found** → fail loudly: "no resolvable worktree marker');
    });

    test('R8.1 — --worktree --mode parallel is rejected in the command doc and WT-7', () => {
        expect(RUNALL).toContain('`--worktree --mode parallel` is **rejected**');
        expect(SPEC).toContain('**`--mode parallel`** is rejected when combined with `--worktree`');
    });

    test('R9.1 — the flag glossary documents --worktree', () => {
        expect(GLOSSARY).toContain('### `--worktree [<name>]` — run the batch in an isolated git worktree');
    });

    test('WT-4a — external-key-conflict teardown refusal names the 1049 reconciliation elements', () => {
        // Task 1049 AC4: the bounded reconciliation contract must carry every element —
        // archived snapshot, source identities, file-hash check, merged-commit ancestry,
        // and operator-authorized cleanup — so a prose regression fails here, not in the field.
        for (const phrase of [
            '**and fails the pass (1049)**',
            'the original archived DB snapshot',
            'the skipped source run identities',
            'verifies the archive by file hash',
            'merged-commit ancestry of the source branch',
            'explicit operator-authorized cleanup',
        ]) {
            expect(SPEC).toContain(phrase);
        }
    });

    test('R10.1 — portable git only; no Claude-Code-only worktree tools', () => {
        expect(SPEC).toContain('Use portable `git worktree` commands only');
        expect(RUNALL).not.toContain('EnterWorktree');
    });
});

const DRIVER = readRunbook('inline-pipeline-driver');

describe('execution-batch + inline-driver spec contract (task 1058 — per-call tree pin)', () => {
    test('inline driver — the canonical per-call pin protocol is defined (R1)', () => {
        expect(DRIVER).toContain('## Per-call execution-tree pin (task 1058)');
        // The template: cd first, then verify physical path and repository identity.
        expect(DRIVER).toContain('cd -- "$SPUR_TREE"');
        expect(DRIVER).toContain('pwd -P');
        expect(DRIVER).toContain('git rev-parse --show-toplevel');
        expect(DRIVER).toContain('git branch --show-current');
        expect(DRIVER).toContain('tree mismatch: expected');
        expect(DRIVER).toContain('branch mismatch: expected');
        expect(DRIVER).toContain('Pin reads as well as writes');
        expect(DRIVER).toContain('heading-only grep is not proof');
        // Fail closed BEFORE the CLI runs, with named expected/actual — no magic exit-91
        // contract (task 1058 Q&A, 2026-10-02).
        expect(DRIVER).toContain('before the CLI runs');
        expect(DRIVER).not.toContain('exit 91');
        // Engine shell actions already bind context.workdir — the protocol is host-only.
        expect(DRIVER).toContain('packages/app/src/workflow/actions/shell.ts:98');
    });

    test('execution batch — host boundaries pin their tree; WT-4 selects the invoking tree (R2)', () => {
        // Collapse markdown reflow so multi-word pins match across wrapped lines.
        const spec = SPEC.replace(/\s+/g, ' ');
        expect(spec).toContain('Per-call tree pinning (task 1058)');
        expect(spec).toContain('canonical per-call pin protocol');
        expect(spec).toContain('select the **invoking** tree');
        expect(spec).toContain('FF ancestry, marker and cleanup sequencing remain owned by 1059');
        // WT-3b runs as a pinned subshell, not a persistent cd + `cd -` reliance.
        expect(spec).toContain('cd -- "../<worktree-dir>"');
    });
});

describe('execution-batch spec contract (task 1059 — WT-4 fail-stop pins)', () => {
    test('execution batch — WT-4 fail-stop merge sequence', () => {
        // Collapse markdown reflow so multi-word pins match across wrapped lines.
        const spec = SPEC.replace(/\s+/g, ' ');
        // Tips are captured, never re-derived: BATCH_TIP pinned before any cleanup, fresh BASE_TIP.
        expect(spec).toContain('BATCH_TIP="$(git rev-parse "$BRANCH")"');
        expect(spec).toContain('BASE_TIP="$(git rev-parse "$BASE_REF")"');
        // Fresh-base ancestry immediately before the sole mutation; errors fail closed.
        expect(spec).toContain('immediately before the sole mutation');
        expect(spec).toContain('git merge-base --is-ancestor "$BASE_TIP" "$BATCH_TIP" || ANCESTRY_RC=$?');
        expect(spec).toContain('ancestry check could not run (git exit $ANCESTRY_RC) - failing closed');
        expect(spec).toContain('git merge --ff-only "$BRANCH"');
        expect(spec).toContain('the concurrent-writer race survives every precheck');
        // Landed verification of the captured tip after the merge.
        expect(spec).toContain('git merge-base --is-ancestor "$BATCH_TIP" "$LANDED_BASE_TIP"');
        // Frozen marker vocabulary: failed FF stays active; merged only after landed
        // verification + persistence; landed-but-incomplete records retained + mergeCommit.
        expect(spec).toContain('failed FF leaves the marker at `status: active`');
        expect(spec).toContain('only after landed verification and required persistence');
        expect(spec).toContain('records `status: retained` + `mergeCommit` BATCH_TIP');
        expect(spec).toContain('a removed branch is never queried');
        // F3: the delete is fail-stop — a refusal halts via the retained marker, never silently.
        expect(spec).toContain(
            'git branch -D "$BRANCH" || { echo "WT-4 halt: cannot delete branch $BRANCH after landed merge $BATCH_TIP" >&2; write_marker retained; exit 1; }',
        );
        expect(spec).toContain('an unmerged-refusal would only block proven-merged cleanup');
        // Partial worktree-removal recovery is inspection-only; recursive deletion needs
        // explicit operator authorization; no automatic recovery mutations.
        expect(spec).toContain('Partial worktree-removal recovery is inspection-only');
        expect(spec).toContain('Recursive deletion of leftover directories');
        expect(spec).toContain('requires explicit operator authorization');
        expect(spec).toContain('No automatic rebase, recovery merge');
        // Local refs only — fetch appears only as its prohibition.
        expect(spec).toContain('no fetch');
        expect(spec).not.toContain('git fetch');
    });

    test('execution batch — marker read-modify-write, fail-stop branch delete, class-conditional WT-5 report (F1/F2/F3)', () => {
        // Collapse markdown reflow so multi-word pins match across wrapped lines.
        const spec = SPEC.replace(/\s+/g, ' ');
        // F1: marker rewrite preserves WT-3 fields — read-modify-write, not a 6-field overwrite.
        expect(spec).toContain(
            'read-modify-write: preserve WT-3 fields (id, command, selector, createdAt, adopted, adoptedAt)',
        );
        // Both create and reuse blocks rewrite in place via jq; the absent-fallback stays 6-field.
        expect(
            spec
                .split('write_marker ()')
                .filter((part) =>
                    part.includes('jq --arg s "$1" --arg m "$BATCH_TIP" \'.status = $s | .mergeCommit = $m\''),
                ).length,
        ).toBe(2);
        expect(spec).toContain('cannot rewrite marker $MARKER');
        // F2: the retained-report sentence is conditional on the failure class — the
        // unconditional "Nothing was merged" claim is gone; landed-but-incomplete states the landing.
        expect(spec).not.toContain('The worktree and its branch are intact. Nothing was merged onto the base ref.');
        expect(spec).toContain('pre-merge failure: nothing was merged onto the base ref.');
        expect(spec).toContain(
            'landed-but-incomplete: the batch merge LANDED as <batch-tip-sha> on <base-ref>; retention covers post-merge persistence/cleanup only.',
        );
    });
});

// --- task 1058 R3: two-tree subprocess canary against the real source CLI -------------------

const CANARY_ROOT = join(import.meta.dir, '..', '..', '..', '..');
const CANARY_CLI = join(CANARY_ROOT, 'apps', 'cli', 'src', 'index.ts');
const CANARY_PROOF_DIR = join(CANARY_ROOT, '.spur', 'run', '1058-cwd-proof');
const CANARY_WBS = '1100';
const CANARY_SEED = [
    '---',
    'schema_version: 1',
    'name: pin canary task',
    'status: todo',
    'template: issue',
    'created_at: 2026-10-02T22:50:39.301Z',
    'updated_at: "2026-10-02T22:50:39.301Z"',
    'feature_id: D63',
    'priority: P2',
    'estimate_hours: 1',
    '---',
    '',
    `## ${CANARY_WBS}. pin canary task`,
    '',
    '### Background',
    '',
    'Seed background body.',
    '',
    '### Requirements',
    '',
    '- [ ] R1. Canary requirement.',
    '',
    '### Solution',
    '',
    '<!-- Filled during implementation. -->',
    '',
    '### History',
    '',
].join('\n');

/** The exact per-call pin subshell the driver spec documents — the test subject, not a mock. */
function pinnedCall(cliCommand: string): string {
    return `(
  cd -- "$SPUR_TREE" || { echo "tree missing: expected $SPUR_TREE" >&2; exit 1; }
  ACTUAL_TREE="$(pwd -P)"
  [ "$ACTUAL_TREE" = "$SPUR_TREE" ] || { echo "tree mismatch: expected $SPUR_TREE, got $ACTUAL_TREE" >&2; exit 1; }
  GIT_TOP="$(git rev-parse --show-toplevel)" || exit 1
  [ "$GIT_TOP" = "$SPUR_TREE" ] || { echo "toplevel mismatch: expected $SPUR_TREE, got $GIT_TOP" >&2; exit 1; }
  ACTUAL_BRANCH="$(git branch --show-current)"
  [ "$ACTUAL_BRANCH" = "$SPUR_BRANCH" ] || { echo "branch mismatch: expected $SPUR_BRANCH, got $ACTUAL_BRANCH" >&2; exit 1; }
  exec $SPUR_INVOCATION ${cliCommand}
)`;
}

describe('task 1058 — two-tree subprocess canary (R3, real source CLI)', () => {
    const canaryTaskFile = (tree: string): string => join(tree, 'docs', 'tasks', `${CANARY_WBS}_pin_canary_task.md`);
    const hashFile = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');

    function seedTree(baseDir: string, name: string, branch: string): string {
        const tree = join(baseDir, name);
        mkdirSync(join(tree, 'docs', 'tasks'), { recursive: true });
        writeFileSync(canaryTaskFile(tree), CANARY_SEED);
        const git = (args: string[]): void => {
            const result = Bun.spawnSync(['git', ...args], { cwd: tree, stdout: 'pipe', stderr: 'pipe' });
            if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.toString()}`);
        };
        git(['init', '-q', '-b', branch]);
        git(['config', 'user.email', 'canary@example.invalid']);
        git(['config', 'user.name', 'pin canary']);
        git(['add', '.']);
        git(['commit', '-q', '-m', 'seed corpus']);
        // The recorded identity is the PHYSICAL tree — what `pwd -P` reports.
        return realpathSync(tree);
    }

    function runPinned(script: string, staleCwd: string, vars: Record<string, string>) {
        const result = Bun.spawnSync(['sh', '-c', script], {
            cwd: staleCwd, // intentionally stale host cwd — each call may start anywhere
            env: { ...getEnvVars(), ...vars },
            stdout: 'pipe',
            stderr: 'pipe',
        });
        return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
    }

    // Per-test headroom only (cross-cutting.md § Isolation rerun for load-flakes): this canary
    // spawns the real source CLI twice (cold `bun` starts) and straddled bun's 5s default in two
    // consecutive full-gate runs (5145.73ms, 5966.87ms) while passing green alone 3/3 (268
    // assertions). Load flake, not a regression — the same test load-flaked in two separate runs,
    // which is the protocol's condition for an explicit per-test timeout. Assertions unchanged.
    test('a pinned call from a stale cwd updates only the selected tree; wrong identities abort before writing', () => {
        const base = mkdtempSync(join(tmpdir(), 'spur-1058-cwd-'));
        try {
            // Distinct execution and invoking trees; the selected tree path contains spaces.
            const treeA = seedTree(base, 'spur exec tree a', 'sp/canary-alpha');
            const treeB = seedTree(base, 'tree-b', 'sp/canary-beta');
            const before = { treeA: hashFile(canaryTaskFile(treeA)), treeB: hashFile(canaryTaskFile(treeB)) };
            const newBody = 'Pinned canary body — written from an intentionally stale cwd.';
            const bodyFile = join(base, 'background-body.md');
            writeFileSync(bodyFile, `${newBody}\n`);
            // Source invocation form: the existing resolved command (bun + CLI entry).
            const vars = {
                SPUR_TREE: treeA,
                SPUR_BRANCH: 'sp/canary-alpha',
                SPUR_INVOCATION: `${process.execPath} ${CANARY_CLI}`,
                BODY_FILE: bodyFile,
            };

            // AC1 — host write from a stale cwd (tree B) lands only in the selected tree (tree A).
            const write = runPinned(
                pinnedCall(`task update ${CANARY_WBS} --section Background --from-file "$BODY_FILE" --json`),
                treeB,
                vars,
            );
            expect(write.exitCode).toBe(0);

            // Fresh pinned read proves the section — never a heading-only grep.
            const read = runPinned(pinnedCall(`task show ${CANARY_WBS} --json`), treeB, vars);
            expect(read.exitCode).toBe(0);
            const shown = JSON.parse(read.stdout) as { filePath: string; content: string };
            expect(shown.filePath.startsWith(treeA)).toBe(true); // returned filePath belongs to the selected tree
            expect(shown.content).toContain(newBody);
            expect(shown.content).not.toContain('Seed background body.');

            const after = { treeA: hashFile(canaryTaskFile(treeA)), treeB: hashFile(canaryTaskFile(treeB)) };
            expect(after.treeA).not.toBe(before.treeA); // selected task changed
            expect(after.treeB).toBe(before.treeB); // the other corpus is untouched

            // AC3 — missing tree: cd fails before the CLI runs; neither corpus changes.
            const missing = runPinned(pinnedCall(`task show ${CANARY_WBS} --json`), treeA, {
                ...vars,
                SPUR_TREE: join(base, 'missing tree'),
            });
            expect(missing.exitCode).not.toBe(0);
            expect(missing.stderr).toContain('tree missing: expected');

            // AC3 — wrong branch: cd succeeds, the identity check aborts before the CLI runs.
            const wrongBranch = runPinned(pinnedCall(`task show ${CANARY_WBS} --json`), treeA, {
                ...vars,
                SPUR_TREE: treeB,
                SPUR_BRANCH: 'sp/canary-alpha',
            });
            expect(wrongBranch.exitCode).not.toBe(0);
            expect(wrongBranch.stderr).toContain('branch mismatch: expected sp/canary-alpha, got sp/canary-beta');

            const afterNegative = { treeA: hashFile(canaryTaskFile(treeA)), treeB: hashFile(canaryTaskFile(treeB)) };
            expect(afterNegative.treeA).toBe(after.treeA);
            expect(afterNegative.treeB).toBe(before.treeB);

            // Repeatable proof artifacts (AC1/AC3) under .spur/run/1058-cwd-proof/.
            mkdirSync(CANARY_PROOF_DIR, { recursive: true });
            writeFileSync(
                join(CANARY_PROOF_DIR, 'canary-ac1-pinned-write.json'),
                `${JSON.stringify(
                    {
                        task: '1058',
                        ac: 'AC1 — Host writes select the execution tree (req: R1)',
                        cli: 'source',
                        invocation: vars.SPUR_INVOCATION,
                        staleCwd: treeB,
                        selectedTree: treeA,
                        branch: vars.SPUR_BRANCH,
                        updateEnvelope: JSON.parse(write.stdout) as unknown,
                        pinnedShow: shown,
                        hashes: { before, after },
                    },
                    null,
                    4,
                )}\n`,
            );
            writeFileSync(
                join(CANARY_PROOF_DIR, 'canary-ac3-negative.json'),
                `${JSON.stringify(
                    {
                        task: '1058',
                        ac: 'AC3 — Wrong identities fail before writing (req: R3)',
                        cases: [
                            { name: 'missing-tree', exitCode: missing.exitCode, stderr: missing.stderr.trim() },
                            {
                                name: 'wrong-branch',
                                exitCode: wrongBranch.exitCode,
                                stderr: wrongBranch.stderr.trim(),
                            },
                        ],
                        hashes: { before, afterNegative },
                        bothCorporaUnchanged:
                            afterNegative.treeA === after.treeA && afterNegative.treeB === before.treeB,
                    },
                    null,
                    4,
                )}\n`,
            );
        } finally {
            rmSync(base, { recursive: true, force: true });
        }
    }, 30_000);
});

// --- task 1059: executable WT-4 bash-shape cases against scratch git trees -------------------

const WT4_PROOF_DIR = join(CANARY_ROOT, '.spur', 'run', '1059-wt4-proof');

describe('task 1059 — WT-4 executable bash-shape cases (scratch git trees)', () => {
    const BATCH_BRANCH = 'sp/wt4-1059';
    const BASE_REF = 'main';

    function gitRun(cwd: string, args: string[]): void {
        const r = Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
        if (r.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr.toString()}`);
    }

    function gitOut(cwd: string, args: string[]): string {
        const r = Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
        if (r.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr.toString()}`);
        return r.stdout.toString().trim();
    }

    function gitOk(cwd: string, args: string[]): boolean {
        return Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' }).exitCode === 0;
    }

    /** Scratch git tree standing in for the invoking tree: main branch, one seed commit. */
    function seedTree(baseDir: string, name: string): string {
        const tree = join(baseDir, name);
        mkdirSync(join(tree, 'docs', 'tasks'), { recursive: true });
        mkdirSync(join(tree, '.spur', 'run'), { recursive: true }); // invoking trees carry the marker/report dir
        writeFileSync(join(tree, 'seed.md'), 'WT-4 scratch seed body.\n');
        gitRun(tree, ['init', '-q', '-b', BASE_REF]);
        gitRun(tree, ['config', 'user.email', 'wt4-canary@example.invalid']);
        gitRun(tree, ['config', 'user.name', 'wt4 canary']);
        gitRun(tree, ['add', '.']);
        gitRun(tree, ['commit', '-q', '-m', 'seed base corpus']);
        return realpathSync(tree);
    }

    /** One commit on the currently checked-out branch; returns the new tip. */
    function commitHere(tree: string, file: string, body: string): string {
        writeFileSync(join(tree, file), body);
        gitRun(tree, ['add', '.']);
        gitRun(tree, ['commit', '-q', '-m', `commit ${file}`]);
        return gitOut(tree, ['rev-parse', 'HEAD']);
    }

    /** Branch `branch` at `from`, one commit, then return HEAD to base — the invoking-tree state. */
    function commitOnBranch(tree: string, branch: string, from: string, file: string, body: string): string {
        gitRun(tree, ['checkout', '-q', '-b', branch, from]);
        const tip = commitHere(tree, file, body);
        gitRun(tree, ['checkout', '-q', BASE_REF]);
        return tip;
    }

    interface Wt4Shape {
        tree: string;
        branch: string;
        baseRef: string;
        baseSha: string;
        marker: string;
        report: string;
        /** Optional line injected between the ancestry check and the merge (concurrent-writer race). */
        race?: string;
    }

    /**
     * The canonical fail-stop WT-4 block shape: zero-commit guard, captured BATCH_TIP/BASE_TIP,
     * ancestry check naming both tips, `git merge --ff-only` as the sole mutation, landed-tip
     * verify, existence-guarded branch delete, marker write LAST (status retained keeps the
     * captured BATCH_TIP and never re-queries the removed branch). The write is read-modify-write
     * (F1): an existing marker's WT-3 fields survive; only status/mergeCommit change.
     */
    function wt4Block(o: Wt4Shape): string {
        return `set -e
cd -- "${o.tree}"
BRANCH="${o.branch}"
BASE_REF="${o.baseRef}"
BASE_SHA="${o.baseSha}"
[ "$(git rev-list --count "$BASE_REF".."$BRANCH")" -gt 0 ] || { echo 'WT-4 halt: branch carries no commits' >&2; exit 1; }
BATCH_TIP="$(git rev-parse "$BRANCH")"
BASE_TIP="$(git rev-parse "$BASE_REF")"
git merge-base --is-ancestor "$BASE_TIP" "$BATCH_TIP" || {
  echo "WT-4 halt: divergent — batch tip $BATCH_TIP vs base tip $BASE_TIP" >&2
  git log --oneline "$BASE_TIP..$BATCH_TIP" >&2
  git log --oneline "$BATCH_TIP..$BASE_TIP" >&2
  exit 1
}
${o.race ?? ''}
git merge --ff-only "$BRANCH"
LANDED_BASE_TIP="$(git rev-parse "$BASE_REF")"
git merge-base --is-ancestor "$BATCH_TIP" "$LANDED_BASE_TIP" || { echo 'WT-4 halt: landed verify failed' >&2; exit 1; }
if git rev-parse --verify --quiet "$BRANCH" >/dev/null; then git branch -D "$BRANCH"; fi
STATUS='merged'
if printf 'wt4 report %s\\n' "$BATCH_TIP" > "${o.report}" 2>/dev/null; then :; else
  STATUS='retained'
  echo "WT-5 halt: persistence failed after landed merge $BATCH_TIP; recovery reads captured tips only" >&2
fi
write_marker () {   # read-modify-write (F1): preserve WT-3 fields already on the marker
  mkdir -p "$(dirname "${o.marker}")"
  if [ -f "${o.marker}" ]; then
    TMP_MARKER="$(mktemp)"
    jq --arg s "$STATUS" --arg m "$BATCH_TIP" '.status = $s | .mergeCommit = $m' "${o.marker}" > "$TMP_MARKER" || { echo "WT-4 halt: cannot rewrite marker ${o.marker}" >&2; rm -f "$TMP_MARKER"; exit 1; }
    mv "$TMP_MARKER" "${o.marker}"
  else
    printf '{ "baseRef": "${o.baseRef}", "baseSha": "%s", "branch": "${o.branch}", "path": "${o.tree}", "status": "%s", "mergeCommit": "%s" }\\n' "$BASE_SHA" "$STATUS" "$BATCH_TIP" > "${o.marker}"
  fi
}
write_marker
[ "$STATUS" = 'merged' ] || exit 1
`;
    }

    function runSh(script: string, cwd: string): { exitCode: number; stdout: string; stderr: string } {
        const r = Bun.spawnSync(['sh', '-c', script], {
            cwd,
            env: { ...getEnvVars() },
            stdout: 'pipe',
            stderr: 'pipe',
        });
        return { exitCode: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
    }

    function markerFor(tree: string, run: string): string {
        return join(tree, '.spur', 'run', `worktree-${run}.json`);
    }

    function reportFor(tree: string, run: string): string {
        return join(tree, '.spur', 'run', `worktree-${run}-batch-report.md`);
    }

    /** WT-3-like fields seeded onto the active marker to prove write_marker read-modify-write (F1). */
    const MARKER_SEED = {
        id: 'wt4-proof',
        command: 'dev-runall',
        selector: 'feature:WT4',
        createdAt: '2026-01-01T00:00:00Z',
        adopted: true,
        adoptedAt: '2026-01-01T00:00:05Z',
    } as const;

    function writeActiveMarker(path: string, baseSha: string, branch: string, tree: string): void {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(
            path,
            `${JSON.stringify({
                ...MARKER_SEED,
                path: tree,
                branch,
                baseRef: BASE_REF,
                baseSha,
                status: 'active',
            })}\n`,
        );
    }

    function writeProof(name: string, payload: Record<string, unknown>): void {
        mkdirSync(WT4_PROOF_DIR, { recursive: true });
        writeFileSync(join(WT4_PROOF_DIR, `${name}.json`), `${JSON.stringify(payload, null, 4)}\n`);
    }

    test('case 1 — clean FF: ancestry ok, merge lands, marker merged with mergeCommit BATCH_TIP', () => {
        const base = mkdtempSync(join(tmpdir(), 'spur-1059-wt4-'));
        try {
            const tree = seedTree(base, 'case1');
            const run = '1059-case1';
            const baseSha = gitOut(tree, ['rev-parse', BASE_REF]);
            const batchTip = commitOnBranch(tree, BATCH_BRANCH, baseSha, 'batch-task.md', 'WT-4 batch body.\n');
            const marker = markerFor(tree, run);
            // Seed WT-3 fields first — the merged write must preserve them (read-modify-write, F1).
            writeActiveMarker(marker, baseSha, BATCH_BRANCH, tree);
            const script = wt4Block({
                tree,
                branch: BATCH_BRANCH,
                baseRef: BASE_REF,
                baseSha,
                marker,
                report: reportFor(tree, run),
            });
            const r = runSh(script, tree);
            expect(r.exitCode).toBe(0);
            const newBaseTip = gitOut(tree, ['rev-parse', BASE_REF]);
            expect(gitOk(tree, ['merge-base', '--is-ancestor', batchTip, newBaseTip])).toBe(true);
            const recorded = JSON.parse(readFileSync(marker, 'utf8')) as Record<string, unknown>;
            expect(recorded.status).toBe('merged');
            expect(recorded.mergeCommit).toBe(batchTip);
            expect(recorded.baseSha).toBe(baseSha);
            expect(recorded.branch).toBe(BATCH_BRANCH);
            expect(recorded.path).toBe(tree);
            // F1 read-modify-write proof: seeded WT-3 fields survive the merged rewrite untouched.
            expect(recorded.id).toBe(MARKER_SEED.id);
            expect(recorded.command).toBe(MARKER_SEED.command);
            expect(recorded.selector).toBe(MARKER_SEED.selector);
            expect(recorded.createdAt).toBe(MARKER_SEED.createdAt);
            expect(recorded.adopted).toBe(true);
            expect(recorded.adoptedAt).toBe(MARKER_SEED.adoptedAt);
            expect(gitOk(tree, ['rev-parse', '--verify', '--quiet', BATCH_BRANCH])).toBe(false);
            writeProof('case1-clean-ff', {
                task: '1059',
                case: 'clean-ff',
                baseSha,
                batchTip,
                baseTipAfter: newBaseTip,
                exitCode: r.exitCode,
                marker: recorded,
                batchBranchDeleted: true,
                wt3MarkerFieldsPreserved: true,
            });
        } finally {
            rmSync(base, { recursive: true, force: true });
        }
    });

    test('case 2 — advanced-but-ancestor base: fresh BASE_TIP descendant of baseSha still FF-merges', () => {
        const base = mkdtempSync(join(tmpdir(), 'spur-1059-wt4-'));
        try {
            const tree = seedTree(base, 'case2');
            const run = '1059-case2';
            const baseSha = gitOut(tree, ['rev-parse', BASE_REF]);
            const advancedTip = commitHere(tree, 'base-advance.md', 'Base advanced after marker creation.\n');
            const batchTip = commitOnBranch(tree, BATCH_BRANCH, advancedTip, 'batch-task.md', 'WT-4 batch body.\n');
            expect(gitOk(tree, ['merge-base', '--is-ancestor', baseSha, advancedTip])).toBe(true);
            expect(gitOk(tree, ['merge-base', '--is-ancestor', advancedTip, batchTip])).toBe(true);
            const marker = markerFor(tree, run);
            const r = runSh(
                wt4Block({
                    tree,
                    branch: BATCH_BRANCH,
                    baseRef: BASE_REF,
                    baseSha,
                    marker,
                    report: reportFor(tree, run),
                }),
                tree,
            );
            expect(r.exitCode).toBe(0);
            const newBaseTip = gitOut(tree, ['rev-parse', BASE_REF]);
            expect(gitOk(tree, ['merge-base', '--is-ancestor', batchTip, newBaseTip])).toBe(true);
            const recorded = JSON.parse(readFileSync(marker, 'utf8')) as Record<string, string>;
            expect(recorded.status).toBe('merged');
            expect(recorded.mergeCommit).toBe(batchTip);
            expect(recorded.baseSha).toBe(baseSha); // stale baseSha preserved; fresh BASE_TIP governed the check
            writeProof('case2-advanced-ancestor-base', {
                task: '1059',
                case: 'advanced-but-ancestor-base',
                baseSha,
                advancedTip,
                batchTip,
                baseTipAfter: newBaseTip,
                exitCode: r.exitCode,
                marker: recorded,
            });
        } finally {
            rmSync(base, { recursive: true, force: true });
        }
    });

    test('case 3 — divergent base: ancestry halt names both tips, tree/branch retained, marker active', () => {
        const base = mkdtempSync(join(tmpdir(), 'spur-1059-wt4-'));
        try {
            const tree = seedTree(base, 'case3');
            const run = '1059-case3';
            const baseSha = gitOut(tree, ['rev-parse', BASE_REF]);
            const batchTip = commitOnBranch(tree, BATCH_BRANCH, baseSha, 'batch-task.md', 'WT-4 batch body.\n');
            const foreignTip = commitHere(tree, 'foreign.md', 'Foreign base commit — divergent.\n');
            const marker = markerFor(tree, run);
            writeActiveMarker(marker, baseSha, BATCH_BRANCH, tree);
            const r = runSh(
                wt4Block({
                    tree,
                    branch: BATCH_BRANCH,
                    baseRef: BASE_REF,
                    baseSha,
                    marker,
                    report: reportFor(tree, run),
                }),
                tree,
            );
            expect(r.exitCode).not.toBe(0);
            expect(r.stderr).toContain('divergent');
            expect(r.stderr).toContain(batchTip);
            expect(r.stderr).toContain(foreignTip);
            expect(r.stderr).toContain('commit batch-task.md'); // batch-side divergent log (BASE_TIP..BATCH_TIP)
            expect(r.stderr).toContain('commit foreign.md'); // base-side divergent log (BATCH_TIP..BASE_TIP)
            const recorded = JSON.parse(readFileSync(marker, 'utf8')) as Record<string, string>;
            expect(recorded.status).toBe('active');
            expect(recorded.mergeCommit).toBeUndefined();
            expect(gitOk(tree, ['rev-parse', '--verify', '--quiet', BATCH_BRANCH])).toBe(true); // branch retained
            expect(gitOut(tree, ['rev-parse', '--verify', BATCH_BRANCH])).toBe(batchTip);
            expect(readFileSync(join(tree, 'seed.md'), 'utf8')).toContain('WT-4 scratch seed body.'); // tree retained
            writeProof('case3-divergent-base', {
                task: '1059',
                case: 'divergent-base',
                baseSha,
                batchTip,
                foreignTip,
                exitCode: r.exitCode,
                stderr: r.stderr.trim(),
                marker: recorded,
                branchRetained: true,
            });
        } finally {
            rmSync(base, { recursive: true, force: true });
        }
    });

    test('case 4 — failed FF: race after ancestry passes, merge --ff-only halts, marker stays active', () => {
        const base = mkdtempSync(join(tmpdir(), 'spur-1059-wt4-'));
        try {
            const tree = seedTree(base, 'case4');
            const run = '1059-case4';
            const baseSha = gitOut(tree, ['rev-parse', BASE_REF]);
            const batchTip = commitOnBranch(tree, BATCH_BRANCH, baseSha, 'batch-task.md', 'WT-4 batch body.\n');
            const marker = markerFor(tree, run);
            writeActiveMarker(marker, baseSha, BATCH_BRANCH, tree);
            // Concurrent-writer race: base moves between the ancestry check and the sole mutation.
            const script = wt4Block({
                tree,
                branch: BATCH_BRANCH,
                baseRef: BASE_REF,
                baseSha,
                marker,
                report: reportFor(tree, run),
                race: 'git commit -q --allow-empty -m "concurrent base advance"',
            });
            const r = runSh(script, tree);
            expect(r.exitCode).not.toBe(0);
            expect(r.stderr).toContain('fast-forward');
            const recorded = JSON.parse(readFileSync(marker, 'utf8')) as Record<string, string>;
            expect(recorded.status).toBe('active');
            expect(recorded.mergeCommit).toBeUndefined(); // no success write
            expect(gitOk(tree, ['rev-parse', '--verify', '--quiet', BATCH_BRANCH])).toBe(true);
            writeProof('case4-failed-ff', {
                task: '1059',
                case: 'failed-ff',
                baseSha,
                batchTip,
                baseTipAfter: gitOut(tree, ['rev-parse', BASE_REF]),
                exitCode: r.exitCode,
                stderr: r.stderr.trim(),
                marker: recorded,
            });
        } finally {
            rmSync(base, { recursive: true, force: true });
        }
    });

    test('case 5 — post-FF base advance: BATCH_TIP remains an ancestor of later base descendants', () => {
        const base = mkdtempSync(join(tmpdir(), 'spur-1059-wt4-'));
        try {
            const tree = seedTree(base, 'case5');
            const run = '1059-case5';
            const baseSha = gitOut(tree, ['rev-parse', BASE_REF]);
            const batchTip = commitOnBranch(tree, BATCH_BRANCH, baseSha, 'batch-task.md', 'WT-4 batch body.\n');
            const marker = markerFor(tree, run);
            const r = runSh(
                wt4Block({
                    tree,
                    branch: BATCH_BRANCH,
                    baseRef: BASE_REF,
                    baseSha,
                    marker,
                    report: reportFor(tree, run),
                }),
                tree,
            );
            expect(r.exitCode).toBe(0);
            const landedBaseTip = gitOut(tree, ['rev-parse', BASE_REF]);
            const laterTip = commitHere(tree, 'later.md', 'Base advances again after the batch landed.\n');
            expect(gitOk(tree, ['merge-base', '--is-ancestor', batchTip, laterTip])).toBe(true);
            expect(gitOk(tree, ['merge-base', '--is-ancestor', landedBaseTip, laterTip])).toBe(true);
            writeProof('case5-post-ff-base-advance', {
                task: '1059',
                case: 'post-ff-base-advance',
                baseSha,
                batchTip,
                landedBaseTip,
                laterTip,
                batchStillAncestorOfLaterBase: true,
                exitCode: r.exitCode,
            });
        } finally {
            rmSync(base, { recursive: true, force: true });
        }
    });

    test('case 6 — persist+cleanup failure after landed merge: retained marker, deleted branch never queried', () => {
        const base = mkdtempSync(join(tmpdir(), 'spur-1059-wt4-'));
        try {
            const tree = seedTree(base, 'case6');
            const run = '1059-case6';
            const baseSha = gitOut(tree, ['rev-parse', BASE_REF]);
            const batchTip = commitOnBranch(tree, BATCH_BRANCH, baseSha, 'batch-task.md', 'WT-4 batch body.\n');
            const blocker = join(tree, 'report-blocker');
            writeFileSync(blocker, 'a file occupying the report path so the persistence write fails\n');
            const marker = markerFor(tree, run);
            // Seed WT-3 fields first — the retained write must preserve them too (read-modify-write, F1).
            writeActiveMarker(marker, baseSha, BATCH_BRANCH, tree);
            const script = wt4Block({
                tree,
                branch: BATCH_BRANCH,
                baseRef: BASE_REF,
                baseSha,
                marker,
                report: join(blocker, 'out.md'),
            });
            // The recovery path must never query the removed branch: the existence check precedes any delete…
            const deleteAt = script.indexOf('git branch -D "$BRANCH"');
            expect(script.indexOf('git rev-parse --verify --quiet "$BRANCH"')).toBeGreaterThan(-1);
            expect(script.indexOf('git rev-parse --verify --quiet "$BRANCH"')).toBeLessThan(deleteAt);
            // …and after the delete the script reads captured BATCH_TIP only — no branch query remains.
            const afterDelete = script.slice(deleteAt);
            expect(afterDelete).not.toContain('git rev-parse');
            expect(afterDelete).toContain('"$BATCH_TIP"');
            const r = runSh(script, tree);
            expect(r.exitCode).toBe(1); // fail-stop halt, after the retained marker write
            expect(r.stderr).toContain('WT-5 halt');
            expect(r.stderr).toContain(batchTip);
            const recorded = JSON.parse(readFileSync(marker, 'utf8')) as Record<string, unknown>;
            expect(recorded.status).toBe('retained');
            expect(recorded.mergeCommit).toBe(batchTip); // reads the captured variable, not the deleted branch
            // F1 read-modify-write proof: seeded WT-3 fields survive the retained rewrite too.
            expect(recorded.id).toBe(MARKER_SEED.id);
            expect(recorded.command).toBe(MARKER_SEED.command);
            expect(recorded.selector).toBe(MARKER_SEED.selector);
            expect(recorded.createdAt).toBe(MARKER_SEED.createdAt);
            expect(recorded.adopted).toBe(true);
            expect(recorded.adoptedAt).toBe(MARKER_SEED.adoptedAt);
            expect(gitOk(tree, ['rev-parse', '--verify', '--quiet', BATCH_BRANCH])).toBe(false);
            writeProof('case6-persist-cleanup-failure', {
                task: '1059',
                case: 'persist-cleanup-failure-after-landed-merge',
                baseSha,
                batchTip,
                exitCode: r.exitCode,
                stderr: r.stderr.trim(),
                marker: recorded,
                batchBranchDeleted: true,
                recoveryQueriedDeletedBranch: false,
                wt3MarkerFieldsPreserved: true,
            });
        } finally {
            rmSync(base, { recursive: true, force: true });
        }
    });
});

describe('execution-batch spec contract (task 1111 R3/R4)', () => {
    test('--defer-gate adds the pipeline var and records the report marker', () => {
        // The var is added only under the opt-in flag; the marker is what stops a reader
        // mistaking a light receipt for the batch's full-gate evidence.
        expect(SPEC).toContain('"deferQualityGate":"true"');
        expect(SPEC).toContain('deferQualityGate is added ONLY under the opt-in --defer-gate flag');
        expect(SPEC).toContain('`gate: deferred`');
    });

    test('the integrated full gate runs before the deferred feature sync', () => {
        const post = SPEC.split('post: integrated full gate on BASE_REF')[1] ?? '';
        expect(post.length).toBeGreaterThan(0);
        const deferredSection = SPEC.split('**Deferred gate (`--defer-gate`, task 1111 R3/R4).**')[1] ?? '';
        expect(deferredSection.length).toBeGreaterThan(0);
        // Order inside the deferred recipe: gate, then sync, then the FAIL lane.
        // Avoid the literal brace-brace placeholder: biome's noTemplateCurlyInString flags it
        // in any string, so anchor the gate line on its trailing marker instead.
        const gateAt = deferredSection.indexOf('on BASE_REF');
        const syncAt = deferredSection.indexOf('PASS -> proceed to feature sync');
        const failAt = deferredSection.indexOf('FAIL -> batch verdict FAIL; feature sync SKIPPED');
        expect(gateAt).toBeGreaterThan(-1);
        expect(syncAt).toBeGreaterThan(gateAt);
        expect(failAt).toBeGreaterThan(syncAt);
        // No automatic bisect, and the re-gate list is newest-first.
        expect(deferredSection).toContain('no automatic bisect');
        expect(deferredSection).toContain('newest-first');
    });
});

describe('execution-batch spec contract (task 1121 — WT-4d invoking-tree relink)', () => {
    const CREATE_BLOCK = SPEC.slice(
        SPEC.indexOf('#### Create mode — merge, remove, delete'),
        SPEC.indexOf('#### Reuse mode — merge, retain'),
    );
    const REUSE_BLOCK = SPEC.slice(
        SPEC.indexOf('#### Reuse mode — merge, retain'),
        SPEC.indexOf('**Fast-forward only.**'),
    );
    const DIFF_CONDITION = 'git diff --name-only "$BASE_TIP" "$BATCH_TIP" -- bun.lock \'*package.json\'';

    test('AC1 — create mode: WT-4d sits after the landed verify and WT-4c, before the success marker', () => {
        expect(CREATE_BLOCK).toContain('WT-4d');
        expect(CREATE_BLOCK).toContain(DIFF_CONDITION);
        expect(CREATE_BLOCK).toContain('bun install --frozen-lockfile --ignore-scripts');
        const landedVerify = CREATE_BLOCK.indexOf('git merge-base --is-ancestor "$BATCH_TIP" "$LANDED_BASE_TIP"');
        const wt4c = CREATE_BLOCK.indexOf('WT-4c');
        const wt4d = CREATE_BLOCK.indexOf('WT-4d');
        const successMarker = CREATE_BLOCK.lastIndexOf('write_marker merged');
        expect(landedVerify).toBeGreaterThan(-1);
        expect(wt4c).toBeGreaterThan(-1);
        expect(wt4d).toBeGreaterThan(landedVerify);
        expect(wt4d).toBeGreaterThan(wt4c);
        expect(successMarker).toBeGreaterThan(wt4d);
    });

    test('AC1 — reuse mode: WT-4d sits after the landed verify and Step 5 persistence, before the marker', () => {
        expect(REUSE_BLOCK).toContain('WT-4d');
        expect(REUSE_BLOCK).toContain(DIFF_CONDITION);
        expect(REUSE_BLOCK).toContain('bun install --frozen-lockfile --ignore-scripts');
        const landedVerify = REUSE_BLOCK.indexOf('git merge-base --is-ancestor "$BATCH_TIP" "$LANDED_BASE_TIP"');
        const persistence = REUSE_BLOCK.indexOf('# Step 5 evidence persistence');
        const wt4d = REUSE_BLOCK.indexOf('WT-4d');
        const successMarker = REUSE_BLOCK.lastIndexOf('write_marker merged');
        expect(landedVerify).toBeGreaterThan(-1);
        expect(persistence).toBeGreaterThan(-1);
        expect(wt4d).toBeGreaterThan(landedVerify);
        expect(wt4d).toBeGreaterThan(persistence);
        expect(successMarker).toBeGreaterThan(wt4d);
    });

    test('AC1/R3 — the manifest/lockfile guard exists exactly once per mode (silent skip otherwise)', () => {
        expect(SPEC.split(DIFF_CONDITION)).toHaveLength(3); // two occurrences → three slices
    });

    test('AC2 — a failed relink warns, names the stale workspace state in the batch report, never halts', () => {
        for (const block of [CREATE_BLOCK, REUSE_BLOCK]) {
            expect(block).toContain('invoking tree workspace links are stale');
            expect(block).toContain('tee -a ".spur/run/worktree-<marker-id>-batch-report.md"');
        }
        // The prose names the non-fatal contract: warning only — the success marker still records merged.
        expect(SPEC).toContain('a failed relink');
        expect(SPEC).toContain('the success marker still records `merged`');
    });
});

describe('execution-batch spec contract (task 1132 R4/R5 — auto-fix-first gates)', () => {
    // ─── 1132 R4/R5 — auto-fix-first gates + the --auto refine-once rule ───
    // The batch driver is an agent-interpreted runbook, so these pins are its executable half:
    // without them a regression in the repair-before-judge order or in the bounded refine lane
    // would pass every gate (verifier finding on task 1132, AC5/AC6).

    test('1132 R4 — the pipeline precheck repairs before it judges, and captures the repairs', () => {
        // Segmented so the source carries no runtime-path literal (rule `sp-runtime-path`).
        const pipelinePath = join(import.meta.dir, '..', '..', '..', '..', 'config', 'workflows', 'task-pipeline.yaml');
        const pipeline = readFileSync(pipelinePath, 'utf8');
        const guard = pipeline.slice(pipeline.indexOf('- from: precheck'));
        const fixAt = guard.indexOf('task check $wbs --fix');
        const precheckAt = guard.indexOf('task check $wbs --precheck');
        expect(fixAt).toBeGreaterThan(-1);
        expect(precheckAt).toBeGreaterThan(fixAt);
        // The captured artifact is what lets the batch report carry task-level `autoRepairs`.
        expect(guard).toContain('$wbs-auto-repairs.json');
    });

    test('1132 R4 — the feature preflight repairs first, and the exemption lives in code', () => {
        expect(SPEC).toContain('feature check <id> --fix --json');
        expect(SPEC).toContain('feature check <id> --strict --json');
        const fixAt = SPEC.indexOf('feature check <id> --fix --json');
        const strictAt = SPEC.indexOf('feature check <id> --strict --json');
        expect(strictAt).toBeGreaterThan(fixAt);
        // Prose points at the constant; no second copy of the code list lives in the runbook.
        expect(SPEC).toContain('NON_ABORTING_PREFLIGHT_CODES');
        expect(SPEC).toContain('autoRepairs');
    });

    test('1132 R5/AC6 — --auto gets ONE refine pass, then the task is skipped and the batch continues', () => {
        expect(SPEC).toContain('**Semantic precheck failure under `--auto` (1132 R5).**');
        expect(SPEC).toContain('one** `/sp:dev-refineall --auto` refinement pass');
        // The bound is explicit (exactly one), the fallback is a reported skip, and independence
        // is stated — the three clauses R5 asks for.
        expect(SPEC).toContain('(exactly one — never');
        expect(SPEC).toContain('marked **skipped** with its findings');
        expect(SPEC).toContain('The batch does not abort');
        // Non-auto behavior is unchanged (halt), so the rule is not a blanket softening.
        expect(SPEC).toContain('unchanged halt behavior');
        // The driver loop carries the same branch, so the prose is not merely descriptive.
        expect(SPEC).toContain('/sp:dev-refineall --auto pass');
    });
});

/**
 * 1146 AC6 — the print obligation is carried by the CLOSE OUTPUT, not a trailing step. These pins
 * fail if a driver re-acquires the job of measuring its own run (the 1130/1131 failure: an
 * agent-recorded SINCE plus a compacted-away step).
 */
describe('1146 — execution summary is a close product (AC6)', () => {
    const ref = (name: string): string => readFileSync(referencePath(name), 'utf8');

    test('the close docs hand the driver summaryFile to print', () => {
        expect(ref('structured-trace-emission.md')).toContain('summaryFile');
        expect(ref('inline-pipeline-driver.md')).toContain('summaryFile');
        expect(ref('inline-pipeline-driver.md')).toContain('### Execution summary');
    });

    test('the batch report names the roll-up built from per-run files', () => {
        const report = ref('execution-batch-report.md');
        expect(report).toContain('run-summary.mjs');
        expect(report).toContain('--rollup');
        expect(report).toContain('wall-span');
    });

    test('no execution-summary reference records SINCE or measures with --since', () => {
        for (const name of [
            'dev-operations.md',
            'execution-batch-report.md',
            'inline-pipeline-driver.md',
            'structured-trace-emission.md',
        ]) {
            const body = ref(name);
            expect(body).not.toContain('SINCE=');
            expect(body).not.toContain('--since "$SINCE"');
        }
    });
});

/**
 * 1149 AC6 — the landing contract names the automatic receiving-row reconcile; a manual row
 * DELETE is never the required exit, and the --next chain states the --worktree interaction.
 */
describe('1149 — landing names the reconcile, not a manual delete (AC6)', () => {
    const ref = (name: string): string => readFileSync(referencePath(name), 'utf8');

    test('landing and batch-report name the receiving-row reconcile; neither requires a DELETE', () => {
        expect(ref('execution-worktree-landing.md')).toContain('automatically reconciles');
        expect(ref('execution-batch-report.md')).toContain('reconciled automatically during persist-out');
        for (const name of ['execution-worktree-landing.md', 'execution-batch-report.md']) {
            expect(ref(name)).not.toMatch(/\bDELETE FROM\b/);
        }
    });

    test('the --next chain contract states the --worktree interaction', () => {
        const body = ref('cross-cutting.md');
        expect(body).toContain('Worktree interaction (1149');
        expect(body).toContain('external-key-conflict-bookkeeping');
    });
});
