/**
 * `spur workflow promote-check|promote-evaluate <id>|promote-resolve <id>` (A94 1413 R2).
 *
 * The candidate-file discipline (pending / overdue / promoted / retired, a strict-fewer bar, a pinned
 * baseline and a refusal to contradict a recorded verdict) is unchanged; only the transport is new,
 * so a downstream workflow layer can keep its own `config/workflow-candidates.json`.
 */
import type { Command } from '@commander-js/extra-typings';
import {
    configurePromotionRoots,
    type PromotionOutcome,
    promoteCheck,
    promoteEvaluate,
    promoteResolve,
} from '@gobing-ai/spur-app';
import { bootFree } from '../../boot-free-route';
import type { CliContext } from '../../context';
import { toEnvelopeJson, toJson } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';

/** Options shared by the three promotion verbs. */
interface PromotionOptions {
    candidates?: string;
    workflowsDir?: string;
    db?: string;
    now?: string;
    decision?: string;
    json?: boolean;
    jsonEnvelope?: boolean;
}

/** Build the service argv from the parsed flags (one grammar, owned by the service). */
function promotionArgv(options: PromotionOptions, includeDb = true): string[] {
    const argv: string[] = [];
    if (options.candidates !== undefined) argv.push('--config', options.candidates);
    if (options.workflowsDir !== undefined) argv.push('--workflows-dir', options.workflowsDir);
    if (includeDb && options.db !== undefined) argv.push('--db', options.db);
    if (options.now !== undefined) argv.push('--now', options.now);
    if (options.decision !== undefined) argv.push('--decision', options.decision);
    return argv;
}

/** Run a promotion verb and render its outcome; an unknown candidate or usage failure exits 2. */
async function runVerb(
    context: CliContext,
    options: PromotionOptions,
    action: () => Promise<PromotionOutcome>,
): Promise<void> {
    try {
        const outcome = await action();
        if (options.json === true) {
            context.output.write(
                toEnvelopeJson(
                    {
                        ok: outcome.ok,
                        status: outcome.status,
                        findings: outcome.findings.map((finding) => ({
                            kind: finding.kind,
                            id: finding.candidateId,
                            detail: finding.detail,
                        })),
                    },
                    { enveloped: options.jsonEnvelope === true },
                ),
            );
        } else if (outcome.ok) {
            for (const line of outcome.lines) context.output.write(line);
        } else {
            reportFailure(context, outcome.lines);
        }
        if (!outcome.ok) context.setExitCode(1);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const usage = /not found|unknown option|requires a value|unknown decision/.test(message);
        if (options.json === true) {
            context.output.write(toJson({ error: { code: usage ? 'usage' : 'promotion', message } }));
            context.setExitCode(usage ? 2 : 1);
            return;
        }
        context.output.error(message);
        context.setExitCode(usage ? 2 : 1);
    }
}

/** Write a refused verdict's lines to stderr (the JSON branch already answered). */
function reportFailure(context: CliContext, lines: readonly string[]): void {
    for (const line of lines) context.output.error(line);
}

/** Register the three `spur workflow promote-*` verbs. */
export function registerWorkflowPromoteCommand(noun: Command, context: CliContext): void {
    bootFree(noun.command('promote-check'))
        .summary('fail an overdue candidate, a parallel definition, or an unrecorded retirement')
        .option('--candidates <path>', 'candidate record (default: workflow-candidates.json)')
        .option('--workflows-dir <dir>', 'workflow definitions directory (default: the project config)')
        .option('--db <path>', 'project database (default: .spur/spur.db)')
        .option('--now <iso>', 'clock override for deadline evaluation')
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (options: PromotionOptions) => {
            configurePromotionRoots(context.cwd);
            await runVerb(context, options, () => promoteCheck({ argv: promotionArgv(options) }));
        });

    bootFree(noun.command('promote-evaluate'))
        .summary('fill a candidate verdict from its recorded run history')
        .argument('<id>', 'candidate id')
        .option('--candidates <path>', 'candidate record (default: workflow-candidates.json)')
        .option('--workflows-dir <dir>', 'workflow definitions directory (default: the project config)')
        .option('--db <path>', 'project database (default: .spur/spur.db)')
        .option('--now <iso>', 'clock override for the measurement window')
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (id: string, options: PromotionOptions) => {
            configurePromotionRoots(context.cwd);
            await runVerb(context, options, () => promoteEvaluate(id, { argv: promotionArgv(options) }));
        });

    bootFree(noun.command('promote-resolve'))
        .summary('remove a candidate after recording its decision (refuses a contradicting verdict)')
        .argument('<id>', 'candidate id')
        .option('--decision <decision>', 'promote or delete (required)')
        .option('--candidates <path>', 'candidate record (default: workflow-candidates.json)')
        .option('--workflows-dir <dir>', 'workflow definitions directory (default: the project config)')

        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (id: string, options: PromotionOptions) => {
            if (options.decision === undefined) {
                const message = 'promote-resolve: --decision <promote|delete> is required';
                if (options.json === true) {
                    context.output.write(toJson({ error: { code: 'usage', message } }));
                    context.setExitCode(2);
                    return;
                }
                context.output.error(message);
                context.setExitCode(2);
                return;
            }
            configurePromotionRoots(context.cwd);
            // `resolve` reads no run history, so it takes no `--db` (accepted only for a uniform grammar).
            await runVerb(context, options, () => promoteResolve(id, { argv: promotionArgv(options, false) }));
        });
}
