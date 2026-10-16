import type { Command } from '@commander-js/extra-typings';
import {
    AgentUsageProducerError,
    type AgentUsageRunResult,
    type RunAgentUsageOptions,
    runAgentUsageProducer,
    type UsageSource,
    UsageSourceError,
} from '@gobing-ai/spur-app';
import type { CliContext } from '../../context';
import { toEnvelopeJson } from '../../output';
import {
    CodexbarUsageSource,
    defaultAgentUsageSnapshotPath,
    resolveCaptureTimeoutMs,
} from '../../services/agent-usage-source';
import { SHARED_OPTIONS } from '../shared-options';

/** Injectable seams for `runAgentUsage` tests (source stub, snapshot override). */
export interface AgentUsageDeps {
    source?: UsageSource;
    snapshotPath?: string;
}

// ── Injectable usage-source seam for the `agent usage` command tests ──
let _testUsageDeps: AgentUsageDeps | undefined;

/** Replace the usage source + snapshot path for the current test (reset in cleanup). */
export function setAgentUsageSourceForTesting(deps: AgentUsageDeps | undefined): void {
    _testUsageDeps = deps;
}

/** Restore the default codexbar source after a test. */
export function resetAgentUsageSourceForTesting(): void {
    _testUsageDeps = undefined;
}

/**
 * Run the `spur agent usage` producer once (B6 0892 R1–R3). Fail-closed
 * capture/parse/config errors exit 1 with the cause on stderr and change
 * nothing; per-provider error entries are listed while healthy entries still
 * apply. `--dry-run` prints would-be changes and writes nothing.
 */
export async function runAgentUsage(
    context: CliContext,
    flags: { dryRun: boolean; source: string; json: boolean; enveloped?: boolean },
    deps?: AgentUsageDeps,
): Promise<number> {
    if (flags.source !== 'codexbar') {
        const message = `unknown usage source "${flags.source}" — only "codexbar" is implemented`;
        if (flags.json) {
            context.output.write(
                toEnvelopeJson(
                    { error: { code: 'unknown_source', message } },
                    {
                        enveloped: flags.enveloped,
                        error: {
                            code: 'VALIDATION_FAILED',
                            message,
                            details: { source: flags.source, reason: 'unknown_source' },
                        },
                    },
                ),
            );
        } else {
            context.output.error(`agent usage: ${message}`);
        }
        return 2;
    }
    let result: AgentUsageRunResult;
    try {
        const options: RunAgentUsageOptions = {
            // Spawn-capable source + HOME-derived snapshot default live in this (CLI) layer.
            source:
                deps?.source ??
                _testUsageDeps?.source ??
                new CodexbarUsageSource(undefined, resolveCaptureTimeoutMs(context.spurConfig)),
            snapshotPath: deps?.snapshotPath ?? _testUsageDeps?.snapshotPath ?? defaultAgentUsageSnapshotPath(),
            // 0892 R2: the CLI flag must reach the producer or --dry-run silently
            // degrades to a full run (snapshot write + drain).
            dryRun: flags.dryRun === true,
        };
        result = await runAgentUsageProducer(
            {
                getDb: () => context.getDb(),
                projectRoot: context.cwd,
                loadAgentConfig: context.loadAgentConfig,
                warn: (message) => context.output.error(`Warning: ${message}`),
            },
            options,
        );
    } catch (error) {
        if (!(error instanceof UsageSourceError) && !(error instanceof AgentUsageProducerError)) throw error;
        const message = error.message;
        if (flags.json) {
            context.output.write(
                toEnvelopeJson(
                    { error: { code: 'usage_capture_failed', message } },
                    {
                        enveloped: flags.enveloped,
                        error: { code: 'INTERNAL_ERROR', message, details: { reason: 'usage_capture_failed' } },
                    },
                ),
            );
        } else {
            context.output.error(`agent usage: ${message}`);
        }
        return 1;
    }
    if (flags.json) {
        context.output.write(
            toEnvelopeJson(result, {
                enveloped: flags.enveloped,
                error: { code: 'INTERNAL_ERROR', message: 'unreachable' },
            }),
        );
    } else {
        const applied = result.changes.filter((c) => c.action !== 'no-op');
        const snapshotNote =
            result.snapshotPath !== null ? `\nSnapshot: ${result.snapshotPath}` : '\nDry run: nothing written';
        context.output.write(
            [
                `Usage captured ${result.capturedAt} via ${result.source} (${applied.length} change${applied.length === 1 ? '' : 's'}).`,
                // 0907 R5: every decision is listed; skipped/pending name the requested
                // target as intent — completion is unconfirmed, not proven persisted.
                ...result.changes.map((c) => {
                    const target =
                        c.action === 'skipped' || c.action === 'pending'
                            ? `${c.from} → ${c.to} (requested target — completion unconfirmed)`
                            : `${c.from} → ${c.to}`;
                    return `  ${c.executor}: ${target} [${c.action}] — ${c.reason}`;
                }),
                ...(result.erroredProviders.length > 0
                    ? [
                          `Errored providers (skipped, never treated as recovery): ${result.erroredProviders
                              .map((e) => e.provider)
                              .join(', ')}`,
                      ]
                    : []),
                ...(result.unmappedProviders.length > 0
                    ? [`Unmapped providers (never guessed): ${result.unmappedProviders.join(', ')}`]
                    : []),
                ...(result.drain !== null
                    ? [
                          `Drain: ${result.drain.applied} applied, ${result.drain.skippedOperatorOwned} operator-skipped, ${result.drain.failed} failed.`,
                      ]
                    : []),
                snapshotNote,
            ].join('\n'),
        );
    }
    return 0;
}

/** Register `spur agent usage`. */
export function registerAgentUsageCommand(agent: Command, context: CliContext): void {
    agent
        .command('usage')
        .description(
            'Run-once provider usage capture (codexbar) that refreshes quota-owned executor availability. Schedule it externally (cron/launchd); spur serve never runs it.',
        )
        .option(...SHARED_OPTIONS.dryRunAgentUsage)
        .option(...SHARED_OPTIONS.sourceAgentUsage)
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (options) => {
            const code = await runAgentUsage(context, {
                dryRun: options.dryRun === true,
                source: options.source ?? 'codexbar',
                json: options.json === true,
                enveloped: options.jsonEnvelope,
            });
            context.setExitCode(code);
        });
}
