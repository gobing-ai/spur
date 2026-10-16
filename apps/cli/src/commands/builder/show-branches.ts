/**
 * `spur builder show-branches` — read-only branch topology report (task 1218, feature L1).
 * Thin transport over `@gobing-ai/spur-app/branch-topology`: Commander owns the flags, number and
 * format validation and exit codes (0 ok · 1 usage · 2 git failure); the service owns every git/gh
 * call, so this file holds no git logic (ADR-021).
 */
import type { Command } from '@commander-js/extra-typings';
import {
    BranchTopologyGitError,
    BranchTopologyUsageError,
    collectBranchTopology,
    renderMarkdown,
    renderText,
} from '@gobing-ai/spur-app/branch-topology';
import { createSpawnRunner } from '@gobing-ai/spur-app/pr-review';
import type { CliContext } from '../../context';
import { toJson } from '../../output';

const FORMATS = ['markdown', 'json', 'text'] as const;

type Format = (typeof FORMATS)[number];

/** Register `spur builder show-branches` — the read-only branch report verb. */
export function registerBuilderShowBranchesCommand(builder: Command, context: CliContext): void {
    const command = builder
        .command('show-branches')
        .summary('read-only branch topology report against a base (markdown | json | text)')
        .description(
            [
                'Report every branch against a base ref, read-only: fork point, commits ahead/behind,',
                'contained flag, last commit, worktree binding, and (with --pr) open pull-request state.',
                'Base resolution: --base, else the origin/HEAD target, else main.',
                'markdown (default) prints the summary table and one condensed mermaid gitGraph;',
                'json prints the raw BranchTopology object; text prints the aligned table only.',
                'Exit codes: 0 ok · 1 usage (bad --format/--limit/--max-commits, unknown base ref,',
                '--local with --remote) · 2 git failure (not a repository, git missing).',
            ].join('\n'),
        )
        .option('--format <format>', 'output format: markdown | json | text (default markdown)', 'markdown')
        .option('--json', 'alias of --format json (prints the raw BranchTopology object)')
        .option('--base <ref>', 'base ref to measure every branch against (default: origin/HEAD, else main)')
        .option('--local', 'only local branches')
        .option('--remote', 'only remote branches')
        .option('--pr', 'enrich rows with open pull-request state (one gh call; degrades with a warning)')
        .option('--limit <n>', 'maximum branch rows kept, most recent last-commit first (default 30)', '30')
        .option('--max-commits <n>', 'maximum commit nodes per branch line in the graph (default 3)', '3')
        .option('--hide-contained', 'drop contained branches from the graph instead of drawing their join')
        .option('--theme <name>', 'mermaid theme name for the graph init directive')
        .action((options) => {
            const format = resolveFormat(
                options.format,
                command.getOptionValueSource('format') === 'cli',
                options.json === true,
                context,
            );
            if (format === null) return;
            const limit = positiveInteger(options.limit, '--limit', context);
            if (limit === null) return;
            const maxCommits = positiveInteger(options.maxCommits, '--max-commits', context);
            if (maxCommits === null) return;
            if (options.local === true && options.remote === true) {
                usageError('--local and --remote are mutually exclusive', context);
                return;
            }

            try {
                const topology = collectBranchTopology(
                    // 1215: git runs in the invocation cwd with the caller env — never the process values.
                    createSpawnRunner({ cwd: context.cwd, env: context.env }),
                    {
                        ...(options.base !== undefined ? { base: options.base } : {}),
                        scope: options.local === true ? 'local' : options.remote === true ? 'remote' : 'all',
                        pr: options.pr === true,
                        limit,
                    },
                );
                if (format === 'json') {
                    context.output.write(toJson(topology));
                } else if (format === 'text') {
                    context.output.write(renderText(topology));
                } else {
                    context.output.write(
                        renderMarkdown(topology, {
                            maxCommits,
                            hideContained: options.hideContained === true,
                            ...(options.theme !== undefined ? { theme: options.theme } : {}),
                        }),
                    );
                }
                context.setExitCode(0);
            } catch (err) {
                if (err instanceof BranchTopologyUsageError) {
                    usageError(err.message, context);
                    return;
                }
                if (err instanceof BranchTopologyGitError) {
                    context.output.error(err.message);
                    context.setExitCode(2);
                    return;
                }
                context.output.error(err instanceof Error ? err.message : String(err));
                context.setExitCode(2);
            }
        });
}

/** `--format` value with `--json` as its alias; an unknown value or a conflict is a usage error. */
function resolveFormat(requested: string, explicitFormat: boolean, json: boolean, context: CliContext): Format | null {
    if (!(FORMATS as readonly string[]).includes(requested)) {
        usageError(`unknown --format '${requested}': expected ${FORMATS.join(' | ')}`, context);
        return null;
    }
    if (!json) return requested as Format;
    if (explicitFormat && requested !== 'json') {
        usageError(`--json conflicts with --format ${requested}`, context);
        return null;
    }
    return 'json';
}

/** Commander hands every option value through as a string; the report only accepts a count. */
function positiveInteger(value: string, flag: string, context: CliContext): number | null {
    const trimmed = value.trim();
    const parsed = Number.parseInt(trimmed, 10);
    if (!/^\d+$/.test(trimmed) || parsed < 1) {
        usageError(`${flag} expects a positive integer, got '${value}'`, context);
        return null;
    }
    return parsed;
}

function usageError(message: string, context: CliContext): void {
    context.output.error(message);
    context.setExitCode(1);
}
