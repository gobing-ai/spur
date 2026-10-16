/**
 * `spur builder pr-<verb>` — the four flat PR-review verbs (task 1219, feature L1) plus the hidden
 * `pr [argv...]` pass-through alias kept for one release (R4).
 *
 * Thin transport over `@gobing-ai/spur-app/pr-review` (ADR-021): Commander owns the flags and the
 * usage errors (exit 1), the service owns the op sequencing, the verdict words and the exit codes
 * (0 ok · 1 usage · 2 hard failure · 3 wait timeout). The alias keeps the absorbed spine's own argv
 * parser, so installed callers of `spur builder pr <op>` keep working byte-identically apart from
 * one stderr deprecation line.
 */
import type { Command } from '@commander-js/extra-typings';
import {
    PR_REVIEW_HELP,
    type PrReviewContext,
    type PrReviewIo,
    type PrVerb,
    type PrVerbOptions,
    main as runPrReview,
    runPrVerb,
} from '@gobing-ai/spur-app/pr-review';
import type { CliContext } from '../../context';
import { SHARED_OPTIONS } from '../shared-options';

/** `pr <op>` → the flat verb that replaces it, for the one deprecation line. */
const PR_VERB_FOR_OP: Readonly<Record<string, string>> = {
    preflight: 'pr-check',
    hygiene: 'pr-check',
    push: 'pr-open',
    ensure: 'pr-open',
    'ensure-pr': 'pr-open',
    request: 'pr-review',
    wait: 'pr-review',
    collect: 'pr-status',
    status: 'pr-status',
};

/** One stderr line naming the replacing verb; an unknown/absent op lists the whole surface. */
function prDeprecationLine(op: string | undefined): string {
    const replacement = op === undefined ? undefined : PR_VERB_FOR_OP[op];
    return replacement !== undefined
        ? `spur builder pr ${op} is deprecated; use spur builder ${replacement}`
        : 'spur builder pr is deprecated; use spur builder pr-status | pr-check | pr-open | pr-review';
}

/** Register the four flat `spur builder pr-<verb>` composers. */
export function registerBuilderPrCommands(builder: Command, context: CliContext): void {
    const io = (): PrReviewIo => ({
        out: (line) => context.output.write(line),
        err: (line) => context.output.error(line),
    });
    // 1215: the verbs run their git/gh calls and relative status writes in the invocation cwd
    // with the caller env — never the process-global cwd/env.
    const ctx = (): PrReviewContext => ({ cwd: context.cwd, env: context.env });
    const run = (verb: PrVerb, opts: PrVerbOptions): void => {
        context.setExitCode(runPrVerb(verb, opts, io(), ctx()));
    };

    builder
        .command('pr-status')
        .summary('read-only PR/CI/Codex status with the current-HEAD review as `review`')
        .description(
            [
                'Read-only composition of the status and collect operations:',
                'repository, branch, PR/base, local changes, CI and Codex state, plus',
                '`review` — the current-HEAD Codex record when the branch has a PR,',
                'else null. Writes no verdict: a status probe is not a gate.',
                'Exit codes: 0 ok · 2 probe failure.',
            ].join('\n'),
        )
        .option('--since <iso>', 'only count review output submitted at or after this time')
        .option('--head <sha>', 'pin the reviewed commit (default: the current local HEAD)')
        .option(...SHARED_OPTIONS.json)
        .option('--status-file <path>', 'accepted for symmetry; a read-only status writes no verdict')
        .action((options) => {
            run('status', {
                ...(options.since !== undefined ? { since: options.since } : {}),
                ...(options.head !== undefined ? { head: options.head } : {}),
                ...(options.json === true ? { json: true } : {}),
                ...(options.statusFile !== undefined ? { statusFile: options.statusFile } : {}),
            });
        });

    builder
        .command('pr-check')
        .summary('PR submission gate: preflight then hygiene (PASS | WARN | BLOCK | FAIL)')
        .description(
            [
                'Preflight (git/gh/repo checks, clean tree, not the base branch) then',
                'the hygiene scan of base...HEAD for secrets/.env/conflict markers',
                '(BLOCK) and debug residue (WARN). A preflight FAIL stops before',
                'hygiene. `--scan-only` runs hygiene alone, for a local review on a',
                'dirty tree. Exit codes: 0 ok · 2 BLOCK/preflight FAIL/probe failure.',
            ].join('\n'),
        )
        .option('--base <branch>', 'base branch for the base...HEAD diff (default: the PR base, else the repo default)')
        .option('--scan-only', 'hygiene only; skip preflight (a dirty tree is expected)')
        .option(...SHARED_OPTIONS.json)
        .option('--status-file <path>', 'write the one-word verdict (PASS | WARN | BLOCK | FAIL)')
        .action((options) => {
            run('check', {
                ...(options.base !== undefined ? { base: options.base } : {}),
                ...(options.scanOnly === true ? { scanOnly: true } : {}),
                ...(options.json === true ? { json: true } : {}),
                ...(options.statusFile !== undefined ? { statusFile: options.statusFile } : {}),
            });
        });

    builder
        .command('pr-open')
        .summary('publish the branch and reuse or create its pull request (FOUND | CREATED | FAIL)')
        .description(
            [
                'Push the branch (normal push only — never force; sets upstream when',
                'missing), then reuse the branch PR or create one with',
                '`gh pr create --fill`. A rejected push stops before any PR work.',
                'Exit codes: 0 ok · 2 push rejected or ensure failed.',
            ].join('\n'),
        )
        .option('--base <branch>', 'base for a newly created PR (default: the repo default branch)')
        .option(...SHARED_OPTIONS.json)
        .option('--status-file <path>', 'write the one-word verdict (FOUND | CREATED | FAIL)')
        .action((options) => {
            run('open', {
                ...(options.base !== undefined ? { base: options.base } : {}),
                ...(options.json === true ? { json: true } : {}),
                ...(options.statusFile !== undefined ? { statusFile: options.statusFile } : {}),
            });
        });

    builder
        .command('pr-review')
        .summary('request the GitHub Codex review and collect its result (CLEAN | FINDINGS | PENDING | FAIL)')
        .description(
            [
                'Post the `@codex review` request (per-HEAD dedupe unless --force),',
                'poll for the result, then collect it. An already-reviewed HEAD is',
                'collected without a new request; an in-flight request or --no-wait',
                'returns PENDING. Exit codes: 0 ok · 2 hard failure · 3 wait timeout',
                '(verdict PENDING — pending, never failure).',
            ].join('\n'),
        )
        .option('--force', 'request a fresh review even when the current HEAD is already reviewed')
        .option('--focus <text>', 'extra review focus appended to the request')
        .option('--no-wait', 'post the request and return PENDING without polling')
        .option('--timeout <s>', 'wait budget in seconds (service default 600)')
        .option('--interval <s>', 'poll interval in seconds (service default 30)')
        .option(...SHARED_OPTIONS.json)
        .option('--status-file <path>', 'write the one-word verdict (CLEAN | FINDINGS | PENDING | FAIL)')
        .action((options) => {
            run('review', {
                ...(options.force === true ? { force: true } : {}),
                ...(options.focus !== undefined ? { focus: options.focus } : {}),
                ...(options.wait === false ? { noWait: true } : {}),
                ...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
                ...(options.interval !== undefined ? { interval: options.interval } : {}),
                ...(options.json === true ? { json: true } : {}),
                ...(options.statusFile !== undefined ? { statusFile: options.statusFile } : {}),
            });
        });
}

/**
 * Register the hidden `spur builder pr [argv...]` alias: one deprecation line naming the replacing
 * verb, then the unchanged pass-through. Hidden from `builder --help`; removal is a follow-up task.
 */
export function registerBuilderPrAliasCommand(builder: Command, context: CliContext): void {
    builder
        .command('pr', { hidden: true })
        .summary('deprecated alias for the flat pr-<verb> commands')
        .description(PR_REVIEW_HELP)
        .allowUnknownOption(true)
        .allowExcessArguments(true)
        .argument('[argv...]', 'subcommand and flags (see description)')
        .action((argv: string[]) => {
            context.output.error(prDeprecationLine(argv[0]));
            context.setExitCode(
                runPrReview(
                    argv,
                    {
                        out: (line) => context.output.write(line),
                        err: (line) => context.output.error(line),
                    },
                    // 1215: run the spine's git/gh and relative status writes in the invocation cwd
                    // with the caller env — never the process-global cwd/env.
                    { cwd: context.cwd, env: context.env },
                ),
            );
        });
}
