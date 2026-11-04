import type { Command } from '@commander-js/extra-typings';
import { FeatureCheckService, isFeatureFile, resolvePlanningFolders } from '@gobing-ai/spur-app';
import type { CliContext } from '../../context';
import { toEnvelopeJson, writeJsonError } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';
import { makeReceiptRunPort, makeService } from './shared';

/** Register `spur feature advance`. */
export function registerFeatureAdvanceCommand(feature: Command, context: CliContext): void {
    // ── advance ──
    feature
        .command('advance')
        .summary('Walk a feature through the legal forward lifecycle path.')
        .argument('<id>', 'Feature ID to advance')
        .option('--to <status>', "Target status (default: 'done')")
        .option(...SHARED_OPTIONS.folderFeatures)
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (id, options) => {
            const svc = await makeService(context, options.folder);
            const target = options.to ?? 'done';
            const forwardPath: Record<string, string> = {
                backlog: 'active',
                active: 'verifying',
                verifying: 'done',
            };
            const history: Array<{ from: string; to: string }> = [];
            try {
                const initial = await svc.show(id);
                if (initial === null) {
                    writeJsonError(context.output, options, `Feature ${id} not found`, 'NOT_FOUND');
                    context.setExitCode(1);
                    return;
                }
                // 1180 R5: `deprecated` has no forward path entry, so the loop below would
                // stop with a generic message. Refuse up front with the un-deprecate hint
                // instead, before any transition.
                if (initial.status === 'deprecated') {
                    writeJsonError(
                        context.output,
                        options,
                        `${id} is deprecated; un-deprecate first: spur feature update ${id} active`,
                        'GUARD_DENIED',
                    );
                    context.setExitCode(1);
                    return;
                }
                let current = initial.status;
                if (current === target) {
                    if (options.json) {
                        context.output.write(
                            toEnvelopeJson({ id, status: current, hops: history }, { enveloped: options.jsonEnvelope }),
                        );
                    } else {
                        context.output.write(`${id}: already at ${current}; no advance needed`);
                    }
                    return;
                }
                let next: string | undefined = forwardPath[current];
                while (next !== undefined) {
                    if (current === 'active') {
                        await assertFeatureCheckPass(context, id, options.folder, false, 'verifying');
                    } else if (current === 'verifying') {
                        // D61 task 0765 R1: normal feature check --as done — no
                        // blanket strictness elevation. Required-error findings
                        // already carry `error` severity per REQUIRED_FINDING_CODES
                        // in planning-check-base.ts; advisory warnings stay
                        // advisory at the done boundary (target-state policy).
                        await assertFeatureCheckPass(context, id, options.folder, false, 'done');
                    }

                    const result = await svc.transition(id, next);
                    history.push({ from: result.fromStatus ?? current, to: result.toStatus ?? next });
                    const observed = await svc.show(id);
                    current = observed?.status ?? result.toStatus ?? next;
                    if (current !== next) {
                        throw new Error(
                            `Feature ${id} expected status '${next}' after transition, observed '${current}'`,
                        );
                    }
                    if (current === target) break;
                    next = forwardPath[current];
                }
                if (current !== target) {
                    writeJsonError(
                        context.output,
                        options,
                        `${id}: cannot reach '${target}' from '${current}' along the forward path`,
                        'GUARD_DENIED',
                    );
                    context.setExitCode(1);
                    return;
                }
                if (options.json) {
                    context.output.write(
                        toEnvelopeJson({ id, status: current, hops: history }, { enveloped: options.jsonEnvelope }),
                    );
                } else {
                    const trail = history.map((h) => `${h.from} → ${h.to}`).join(', ');
                    context.output.write(`${id}: advanced to ${current} (${trail})`);
                }
            } catch (err) {
                writeJsonError(context.output, options, String(err));
                context.setExitCode(1);
            }
        });
}

async function assertFeatureCheckPass(
    context: CliContext,
    id: string,
    folderOverride: string | undefined,
    strict: boolean,
    asStatus?: string,
): Promise<void> {
    const resolved = await resolvePlanningFolders(context.fs);
    const featuresDir = folderOverride ?? context.fs.resolve(resolved.featuresDir);
    const tasksDir = context.fs.resolve(resolved.tasksDir);
    const tasksDirs = Object.keys(resolved.foldersConfig.folders).map((p) => context.fs.resolve(p));
    if (!tasksDirs.includes(tasksDir)) tasksDirs.unshift(tasksDir);
    const entries = await context.fs.readDir(featuresDir);
    const fileName = entries.find((name) => isFeatureFile(name, id));
    if (fileName === undefined) {
        throw new Error(`Feature ${id} not found`);
    }
    const result = await new FeatureCheckService(context.fs).check(`${featuresDir}/${fileName}`, id, {
        strict,
        featuresDir,
        tasksDir,
        tasksDirs,
        // Receipt validation (0915) reads evidence from the same run dir the CLI
        // check action uses — the completion boundary must see the same evidence.
        runDir: context.fs.resolve('.spur/run'),
        // Same run-store port as the check action: the advance hop's completion
        // boundary must see terminal recording runs and registered artifacts.
        receiptRunPort: await makeReceiptRunPort(context),
        // 0418: the hop's target status so the one-active-goal rule sees the
        // post-transition state (same hint the FSM shell guard passes).
        asStatus,
    });
    if (!result.pass) {
        const details = result.findings.map((f) => `${f.layer} ${f.section}: ${f.message}`).join('; ');
        throw new Error(`Feature ${id} check failed before advance${strict ? ' (strict)' : ''}: ${details}`);
    }
}
