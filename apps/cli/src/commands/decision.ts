import { resolve } from 'node:path';
import type { Command } from '@commander-js/extra-typings';
import {
    DecisionInputError,
    type DecisionStatus,
    decisionCorrelationFromVars,
    decisionReliability,
    emitDecisionRejected,
    getDecisionService,
    readDecisionEvidence,
    type SystemEventBus,
    UnknownDecisionError,
} from '@gobing-ai/spur-app';
import { getEnvVars } from '@gobing-ai/spur-config';
import { SystemEventDao } from '@gobing-ai/spur-domain';
import { EventBus } from '@gobing-ai/ts-infra';
import type { CliContext } from '../context';
import { toEnvelopeJson, toJson, writeJsonError } from '../output';
import { attachSystemEventLedger } from '../system-event-ledger';
import { SHARED_OPTIONS } from './shared-options';

/**
 * Register `spur decision` — the CLI noun over DecisionService (task 1093, design §3.4).
 * Four verbs: `list`, `show`, `run`, `status`. `list`/`show`/`status` never construct a
 * maker; `run` resolves the effective maker per design §3.6 and maps every backend
 * outcome (accepted, low-confidence, no-backend, timeout, error) to exit 0 — only caller
 * mistakes (unknown id, missing/invalid params, unregistered maker, unreadable evidence)
 * exit 1, all before any backend call. `run` never writes a workflow resultFile.
 */
export function registerDecisionCommand(program: Command, context: CliContext): void {
    const noun = program
        .command('decision')
        .summary('decision catalog and maker surface (list, show, run, status)')
        .description(
            [
                'Inspect and serve decision-catalog decisions across the three config',
                'layers (project .spur/decisions, registered paths, bundled shared):',
                '  spur decision list --layer shared --json',
                '  spur decision show task-triage --json',
                '  spur decision run task-triage --param wbs=1093 --evidence diff.json',
                '  spur decision status --json',
            ].join('\n'),
        );

    noun.command('list')
        .summary('list every served decision with its catalog layer')
        .description('One entry per decision: id, type, description, catalog file and layer.')
        .option('--layer <layer>', 'filter by config layer: project | registered | shared')
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (options) => {
            try {
                const service = await getDecisionService(context.spurConfig ?? null, context.cwd);
                let entries = service.list();
                if (options.layer !== undefined) {
                    if (!DECISION_LAYERS.includes(options.layer)) {
                        throw new Error(
                            `invalid --layer "${options.layer}": expected one of ${DECISION_LAYERS.join(', ')}`,
                        );
                    }
                    entries = entries.filter((entry) => entry.layer === options.layer);
                }
                if (options.json === true) {
                    context.output.write(
                        toEnvelopeJson(entries, { enveloped: options.jsonEnvelope === true, kind: 'list' }),
                    );
                } else {
                    for (const entry of entries) {
                        context.output.write(
                            `${entry.id}\t${entry.type}\t${entry.layer}\t${entry.source}\t${entry.description ?? ''}`,
                        );
                    }
                }
            } catch (error) {
                fail(context, options, error);
            }
        });

    noun.command('show')
        .summary('show one decision: served contract plus effective maker and source')
        .description(
            [
                'Full entry for one decision id: type, choices/criteria, parameters,',
                'fallback, minConfidence, catalog and layer, plus the effective maker',
                'and the source that selected it (flag > config-decision > config-default',
                '> catalog-decision > catalog-default). Never constructs a maker.',
            ].join('\n'),
        )
        .argument('<id>', 'decision id')
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (id, options) => {
            try {
                const service = await getDecisionService(context.spurConfig ?? null, context.cwd);
                const description = service.describe(id); // throws UnknownDecisionError for unknown ids
                if (options.json === true) {
                    context.output.write(toEnvelopeJson(description, { enveloped: options.jsonEnvelope === true }));
                } else {
                    context.output.write(
                        [
                            `id: ${description.id}`,
                            `type: ${description.type}`,
                            `description: ${description.description ?? ''}`,
                            `catalog: ${description.catalog}`,
                            `layer: ${description.layer}`,
                            `minConfidence: ${description.minConfidence}`,
                            `criteria: ${toJson(description.criteria)}`,
                            `fallback: ${toJson(description.fallback)}`,
                            `parameters: ${toJson(description.parameters)}`,
                            `model: ${description.model ?? '(unset)'}`,
                            `effectiveMaker: ${description.effectiveMaker.name}`,
                            `makerSource: ${description.effectiveMaker.source}`,
                        ].join('\n'),
                    );
                }
            } catch (error) {
                fail(context, options, error);
            }
        });

    noun.command('run')
        .summary('serve one decision once with the effective maker')
        .description(
            [
                'Validate params and evidence, resolve the effective maker and print the',
                'result. Exits 0 for every backend outcome (accepted, low-confidence,',
                'no-backend, timeout, error — all resolve to the declared fallback);',
                'exits 1 only for caller mistakes before any backend call: unknown id,',
                'missing/invalid parameter, unknown or unregistered maker, unreadable',
                'evidence file. Evidence is redacted and bounded before it leaves the',
                'process and rides the implicit instructions channel of the rendered',
                'question. Never writes a workflow resultFile.',
            ].join('\n'),
        )
        .argument('<id>', 'decision id')
        .option('--param <pairs...>', 'declared parameter as k=v (repeatable)', collect)
        .option('--evidence <files...>', 'evidence file to redact, bound and attach (repeatable)', collect)
        .option('--maker <name>', 'override the effective maker for this call')
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (id, options) => {
            // CLI-local decision-event bus with the same durable ledger tap as
            // `spur agent run` (task 0370 pattern): lifecycle events persist to
            // `system_events` and flush before process exit.
            const bus = new EventBus() as SystemEventBus;
            const ledger = await attachSystemEventLedger(bus, context);
            // Task 1113 R4: a rescue `decision run` inside a workflow shell adopts the
            // calling run — the shell action exports workflow vars as env, so env vars
            // become full correlation (runId/workflowName/nodeId/wbs). Without __runId
            // the context stays plain `cli` (behavior unchanged).
            const correlation = decisionCorrelationFromVars(getEnvVars());
            const callContext =
                correlation !== undefined ? { caller: 'workflow' as const, correlation } : { caller: 'cli' as const };
            try {
                const service = await getDecisionService(context.spurConfig ?? null, context.cwd);
                let description: ReturnType<typeof service.describe>;
                try {
                    description = service.describe(id); // unknown id exits before any work
                } catch (error) {
                    emitDecisionRejected(bus, { decisionId: id, ...callContext }, error);
                    throw error;
                }

                // Evidence before any backend interaction: an unreadable declared file is
                // a caller mistake (design §3.4). The shared helper applies the SAME
                // redaction + bound the workflow decide uses (task 1094 R3), so
                // CLI-gathered reliability samples measure the workflow input.
                let evidence: string[] | undefined;
                try {
                    if (options.evidence !== undefined && options.evidence.length > 0) {
                        evidence = await readDecisionEvidence(
                            options.evidence.map((file) => resolve(context.cwd, file)),
                            async (path) => await context.fs.readFile(path),
                        );
                    }
                } catch (error) {
                    emitDecisionRejected(bus, { decisionId: id, ...callContext }, error);
                    throw error;
                }

                let input: Record<string, unknown>;
                try {
                    input = parseParams(id, description.parameters, options.param ?? [], evidence);
                } catch (error) {
                    emitDecisionRejected(bus, { decisionId: id, ...callContext }, error);
                    throw error;
                }
                const result = await service.decide(id, input, {
                    maker: options.maker,
                    bus,
                    context: callContext,
                });
                if (options.json === true) {
                    context.output.write(toEnvelopeJson(result, { enveloped: options.jsonEnvelope === true }));
                } else {
                    context.output.write(
                        `${result.id}: ${toJson(result.value)} (reason ${result.reason}, confidence ${result.confidence ?? 'n/a'},` +
                            ` maker ${result.maker} via ${result.makerSource}, ${result.durationMs}ms)`,
                    );
                }
            } catch (error) {
                // Rejections thrown from inside `decide` are already emitted by the
                // service; every pre-decide caller mistake was emitted at its site above.
                fail(context, options, error);
            } finally {
                await ledger.flush();
                ledger.unsubscribe();
            }
        });

    noun.command('status')
        .summary('catalog and maker-config readiness report')
        .description(
            [
                'Configured default maker, per-decision effective maker and source,',
                'registered makers, per-layer catalog counts, load errors and duplicate',
                'ids. Exits 0 when clean; exits 1 on any catalog or maker-config error.',
                '',
                'With --reliability, reports recorded decision outcomes per decision',
                'and maker from the `decision.end` ledger instead (task 1096): samples,',
                'acceptedRate, fallbacks by reason, medianConfidence, p50/p95 durationMs',
                'and firstSeen/lastSeen. Catalog ids with no recorded rows report',
                "evidence: 'none'. Reads recorded rows only — never calls a maker — and",
                'exits 0 on a successful report.',
            ].join('\n'),
        )
        .option('--reliability', 'report recorded decision outcomes per decision and maker from the ledger')
        .option('--since <iso>', 'with --reliability: only rows at or after this ISO timestamp')
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (options) => {
            try {
                const service = await getDecisionService(context.spurConfig ?? null, context.cwd);
                if (options.reliability === true) {
                    if (options.since !== undefined && Number.isNaN(Date.parse(options.since))) {
                        throw new Error(`invalid --since "${options.since}": expected an ISO timestamp`);
                    }
                    const dao = new SystemEventDao(await context.getDb());
                    const report = await decisionReliability(dao, {
                        ...(options.since !== undefined ? { since: options.since } : {}),
                        catalog: service.status().perDecision.map((row) => ({
                            decisionId: row.id,
                            maker: row.maker,
                        })),
                    });
                    if (options.json === true) {
                        context.output.write(toEnvelopeJson(report, { enveloped: options.jsonEnvelope === true }));
                    } else {
                        for (const group of report.groups) {
                            context.output.write(
                                [
                                    group.decisionId,
                                    group.maker,
                                    group.evidence,
                                    String(group.samples),
                                    group.acceptedRate.toFixed(4),
                                    toJson(group.fallbacks),
                                    group.medianConfidence === null ? '-' : String(group.medianConfidence),
                                    group.p50DurationMs === null ? '-' : String(group.p50DurationMs),
                                    group.p95DurationMs === null ? '-' : String(group.p95DurationMs),
                                    group.firstSeen ?? '-',
                                    group.lastSeen ?? '-',
                                ].join('\t'),
                            );
                        }
                    }
                    return;
                }
                if (options.since !== undefined) {
                    throw new Error('--since is only valid together with --reliability');
                }
                const status: DecisionStatus = service.status();
                if (options.json === true) {
                    context.output.write(toEnvelopeJson(status, { enveloped: options.jsonEnvelope === true }));
                } else {
                    for (const line of [
                        `defaultMaker: ${status.configDefaultMaker ?? '(unset)'}`,
                        `registeredMakers: ${status.registeredMakers.join(', ')}`,
                        `layers: ${toJson(status.layers)}`,
                        `duplicateIds: ${toJson(status.duplicateIds)}`,
                        `loadErrors: ${status.loadErrors.map((e) => `${e.path}: ${e.message}`).join('; ') || '(none)'}`,
                        ...status.perDecision.map(
                            (row) =>
                                `${row.id}: maker ${row.maker} (${row.source})${row.registered ? '' : ' UNREGISTERED'}`,
                        ),
                        ...(status.errors.length > 0 ? ['errors:', ...status.errors.map((e) => `  ${e}`)] : []),
                    ]) {
                        context.output.write(line);
                    }
                }
                if (!status.ok) context.setExitCode(1);
            } catch (error) {
                fail(context, options, error);
            }
        });
}

const DECISION_LAYERS: readonly string[] = ['project', 'registered', 'shared'];

/** --param/--evidence collector: commander repeatable-option value arrays. */
function collect(value: string, previous: string[] | undefined): string[] {
    return [...(previous ?? []), value];
}

/**
 * Build the hub input from `--param k=v` pairs. Declared types coerce like the
 * catalog loader would (number/boolean/json); strings and enums pass verbatim.
 * Unknown keys and unparseable values throw here — before any backend call.
 * Evidence (already redacted and bounded) joins onto the implicit `instructions`
 * channel so the maker reads it inside the rendered question.
 */
function parseParams(
    id: string,
    declared: Readonly<Record<string, unknown>>,
    pairs: string[],
    evidence: string[] | undefined,
): Record<string, unknown> {
    const input: Record<string, unknown> = {};
    for (const pair of pairs) {
        const eq = pair.indexOf('=');
        if (eq <= 0) throw new DecisionInputError(`invalid --param "${pair}": expected k=v`, id, '');
        const key = pair.slice(0, eq);
        const raw = pair.slice(eq + 1);
        const def = declared[key] as { type?: string } | undefined;
        if (def === undefined) {
            throw new DecisionInputError(
                `unknown --param "${key}" for decision "${id}"; declared parameters: ${Object.keys(declared).join(', ')}`,
                id,
                key,
            );
        }
        switch (def.type) {
            case 'number': {
                const value = Number(raw);
                if (!Number.isFinite(value))
                    throw new DecisionInputError(`--param ${key} expects a finite number, got "${raw}"`, id, key);
                input[key] = value;
                break;
            }
            case 'boolean':
                if (raw !== 'true' && raw !== 'false')
                    throw new DecisionInputError(`--param ${key} expects true|false, got "${raw}"`, id, key);
                input[key] = raw === 'true';
                break;
            case 'json':
                try {
                    input[key] = JSON.parse(raw);
                } catch {
                    throw new DecisionInputError(`--param ${key} expects valid JSON, got "${raw}"`, id, key);
                }
                break;
            default:
                input[key] = raw;
        }
    }
    if (evidence !== undefined && evidence.length > 0) {
        input.instructions = evidence.join('\n\n');
    }
    return input;
}

/**
 * One error path for every verb: JSON envelope when asked, human line otherwise, exit 1.
 * Every throw reaching here is a caller mistake (design §3.4): unknown id → NOT_FOUND,
 * everything else (bad param/layer/maker/evidence, duplicate id) → VALIDATION_FAILED.
 */
function fail(context: CliContext, options: { json?: boolean; jsonEnvelope?: boolean }, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    if (options.json === true) {
        writeJsonError(
            context.output,
            options,
            message,
            error instanceof UnknownDecisionError ? 'NOT_FOUND' : 'VALIDATION_FAILED',
        );
    } else {
        context.output.error(message);
    }
    context.setExitCode(1);
}
