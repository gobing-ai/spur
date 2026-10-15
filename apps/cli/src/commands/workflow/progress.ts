import type { Command } from '@commander-js/extra-typings';
import { projectWorkflowProgress, type WorkflowProgressProjection } from '@gobing-ai/spur-app';
import type { CliContext } from '../../context';
import { toEnvelopeJson, writeJsonError } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';

/**
 * Render a workflow progress projection for humans: the current state, every declared
 * action with its recorded attempts, and the candidate next transitions (D62 / 0867 R2).
 *
 * Rendering only — every field printed here comes straight off
 * {@link WorkflowProgressProjection}; nothing is re-derived. Values the run has not
 * answered yet print as `unknown` (R4), so a running or incomplete run reads as
 * incomplete rather than as a failure or a fabricated zero.
 */
function formatWorkflowProgress(projection: WorkflowProgressProjection): string {
    // 0768 R1: `version` is ABSENT on pre-0768 rows (unknown identity), `null` on a
    // known-unversioned definition, and a literal otherwise.
    const version = 'version' in projection ? (projection.version ?? 'unversioned') : 'unknown';
    const lines: string[] = [
        `Run ${projection.runId} — ${projection.workflow}`,
        `Status: ${projection.status}`,
        `Current state: ${projection.currentState ?? 'unknown'}`,
        `Definition: version ${version} · digest ${projection.definitionDigest ?? 'unknown'}`,
        '',
    ];

    if (projection.states.length === 0) {
        lines.push('States: none recorded');
    } else {
        lines.push('States:');
        for (const state of projection.states) {
            lines.push(`  ${state.state} (visit ${state.visit}) — ${state.status}`);
            if (state.actions.length === 0) {
                lines.push('    (no actions declared)');
                continue;
            }
            for (const action of state.actions) {
                lines.push(`    ${action.actionKey} [${action.kind}] — ${action.status}`);
                for (const attempt of action.attempts) {
                    const duration = attempt.durationMs === null ? 'unknown' : `${attempt.durationMs}ms`;
                    const ok = attempt.ok === null ? 'unknown' : attempt.ok ? 'yes' : 'no';
                    lines.push(`      attempt ${attempt.actionRunId}: ${attempt.status} ok=${ok} ${duration}`);
                }
            }
        }
    }

    lines.push('');
    if (projection.nextTransitions.length === 0) {
        lines.push('Next transitions: none');
    } else {
        lines.push('Next transitions:');
        for (const transition of projection.nextTransitions) {
            const trigger = transition.trigger === null ? '' : ` — ${transition.trigger}`;
            lines.push(`  ${transition.from} → ${transition.to} [${transition.eligibility}]${trigger}`);
        }
    }

    lines.push('');
    lines.push(
        projection.diagnostics.length === 0
            ? 'Diagnostics: none'
            : `Diagnostics: ${projection.diagnostics.map((d) => `${d.code} (${d.message})`).join('; ')}`,
    );
    return lines.join('\n');
}

/** Register `spur workflow progress`. */
export function registerWorkflowProgressCommand(workflow: Command, context: CliContext): void {
    workflow
        .command('progress')
        .description(
            'Project the structured progress of a workflow run: current state, per-action attempts, and candidate next transitions.',
        )
        .argument('<run-id>', 'Run id to project')
        .option(...SHARED_OPTIONS.jsonSupported)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (runId, options) => {
            // D62 / 0867 R3: apps/cli stays a thin transport (ADR-021). The projection is
            // computed by `projectWorkflowProgress` and rendered here — no second
            // derivation path, and the human output is a rendering of the same object.
            const projection = await projectWorkflowProgress(runId, {
                db: await context.getDb(),
                projectRoot: context.cwd,
            });
            // R5: an unknown run id is the projection's own `orphan-row` diagnostic. Name
            // the miss and fail — an unknown run must never read as an empty success
            // (same NOT_FOUND contract as `cancel`).
            if (projection.diagnostics.some((diagnostic) => diagnostic.code === 'orphan-row')) {
                writeJsonError(context.output, options, `Run ${runId} not found.`, 'NOT_FOUND');
                context.setExitCode(1);
                return;
            }
            // R4: a running or incomplete run exits 0. Whatever the rows do not answer
            // stays visible as `unknown` (null digest/state, absent attempts) rather than
            // being fabricated or failing the read.
            if (options.json) {
                context.output.write(toEnvelopeJson(projection, { enveloped: options.jsonEnvelope }));
            } else {
                context.output.write(formatWorkflowProgress(projection));
            }
        });
}
