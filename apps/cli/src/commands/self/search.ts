import type { Command } from '@commander-js/extra-typings';
import { searchProject, searchStatus } from '@gobing-ai/spur-app/search';
import type { SearchHit, SearchResponse, SearchStatus } from '@gobing-ai/spur-contracts';
import type { CliContext } from '../../context';
import { toEnvelopeJson, writeJsonError } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';

/**
 * Register `spur self search` (feature A34 R8, `docs/design/hybrid-search.md` §4 CLI).
 *
 * Thin transport: flag mapping and rendering only. Every search decision lives in
 * `packages/app/src/services/search.ts` (ADR-021), including the degradation rules —
 * this module never prints or runs an install/index command, only the service's hints.
 */
export function registerSearchCommand(self: Command, context: CliContext): void {
    self.command('search')
        .summary('hybrid exact (rg) and semantic (zg) search over project docs and code (ADR-147)')
        .description(
            'Search docs and code through the hybrid backend: ripgrep for exact matches, zg for ' +
                'indexed semantic matches. A missing or unindexed backend degrades to the exact route ' +
                'with a printed hint (never an install or index run).',
        )
        .argument('[query]', 'search query (optional only with --status)')
        .option(...SHARED_OPTIONS.modeSearch)
        .option('--scope <scope>', 'Search scope: docs|code|all (default: all)')
        .option('--glob <glob...>', 'Extra backend glob (repeatable; prefix ! to negate)')
        .option('--limit <n>', 'Maximum hits per group (1-100)', '20')
        .option('--regex', 'Treat the query as a regular expression (exact route)')
        // A boolean `--status` is a distinct flag string from the `--status <s>` filter family,
        // so it deliberately stays a literal declaration.
        .option('--status', 'Print search backend readiness instead of results')
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (query, opts) => {
            try {
                if (opts.status === true) {
                    const status = await searchStatus(context.cwd);
                    context.output.write(
                        opts.json === true
                            ? toEnvelopeJson(status, { enveloped: opts.jsonEnvelope })
                            : formatSearchStatus(status),
                    );
                    return;
                }

                if (query === undefined) {
                    context.output.error(
                        'usage: spur self search <query> [--mode exact|fuzzy|auto] [--status] (--status prints backend readiness without a query)',
                    );
                    context.setExitCode(2);
                    return;
                }

                const response = await searchProject(
                    {
                        query,
                        // Design §4 default is 20; the app service defaults to 10, so the CLI pins it.
                        limit: Number(opts.limit),
                        ...(opts.mode === undefined ? {} : { mode: opts.mode }),
                        ...(opts.scope === undefined ? {} : { scope: opts.scope }),
                        ...(opts.glob === undefined ? {} : { globs: opts.glob }),
                        ...(opts.regex === true ? { regex: true } : {}),
                    },
                    context.cwd,
                );
                context.output.write(
                    opts.json === true
                        ? toEnvelopeJson(response, { enveloped: opts.jsonEnvelope })
                        : formatSearchResponse(response),
                );
            } catch (error) {
                // SearchError carries the actionable remediation (missing rg, invalid request).
                writeJsonError(context.output, opts, error instanceof Error ? error.message : String(error));
                context.setExitCode(1);
            }
        });
}

/** Human-readable search response: one block per group, then the degraded routes. */
export function formatSearchResponse(response: SearchResponse): string {
    const lines: string[] = [];
    let total = 0;
    for (const group of ['exact', 'fuzzy'] as const) {
        const hits = response.groups[group];
        if (hits === null) continue;
        total += hits.length;
        lines.push(`${group} (${hits.length})`);
        for (const hit of hits) lines.push(...formatHit(hit));
    }
    if (total === 0) lines.push('no matches');
    for (const skipped of response.skipped) {
        lines.push(
            `skipped ${skipped.route}: ${skipped.reason}${skipped.hint === undefined ? '' : ` — ${skipped.hint}`}`,
        );
    }
    return lines.join('\n');
}

/** `path:start[-end]  [matchedBy]` plus the snippet's first three lines, indented. */
function formatHit(hit: SearchHit): string[] {
    const range = hit.startLine === hit.endLine ? `${hit.startLine}` : `${hit.startLine}-${hit.endLine}`;
    const snippet = hit.snippet
        .split('\n')
        .slice(0, 3)
        .map((line) => `    ${line}`);
    return [`${hit.path}:${range}  [${hit.matchedBy.join('+')}]`, ...snippet];
}

/** Human-readable backend readiness (`--status`). */
export function formatSearchStatus(status: SearchStatus): string {
    const lines = [
        `rg: ${status.rg.available ? (status.rg.version ?? 'available') : 'not installed'}`,
        `zg: ${status.zg.available ? (status.zg.version ?? 'available') : 'not installed'} index=${status.zg.index}`,
    ];
    if (status.zg.hint !== undefined) lines.push(`hint: ${status.zg.hint}`);
    return lines.join('\n');
}
