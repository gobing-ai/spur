import { resolve } from 'node:path';
import type { Command } from '@commander-js/extra-typings';
import {
    confidenceLevel,
    configuredSecretValues,
    DECISION_OUTCOME_PATTERN,
    DecisionInputError,
    type DecisionProbeOutcome,
    type DecisionStatus,
    type DecisionStatusReadiness,
    decisionCorrelationFromVars,
    decisionLogSink,
    decisionReliability,
    emitDecisionRejected,
    getDecisionService,
    probeDecisionMakers,
    readDecisionEvidence,
    readDecisionStatusReadiness,
    recordDecisionOutcome,
    resolvePlanningFolders,
    reviewSeverityOutcome,
    type SystemEventBus,
    TaskLocator,
    UnknownDecisionError,
    UnknownDecisionInvocationError,
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
                    if (!isDecisionLayer(options.layer)) {
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
            // Task 1100: the CLI caller writes decision rows from its own config. The
            // prelude clock opens before describe so every pre-decide rejection row
            // carries the real invocation start, and a successful evidence read adds
            // the `evidence` phase (CLI and workflow paths only).
            const sink = decisionLogSink(await context.getDb(), context.spurConfig ?? null, context.env);
            const prelude:
                | { startedAt: number; phases: { phase: 'evidence'; startedAt: number; durationMs: number }[] }
                | undefined = sink !== undefined ? { startedAt: Date.now(), phases: [] } : undefined;
            const rejectedLog = () =>
                sink !== undefined && prelude !== undefined
                    ? { sink, startedAt: Date.now(), phases: [], prelude }
                    : undefined;
            try {
                const service = await getDecisionService(context.spurConfig ?? null, context.cwd);
                let description: ReturnType<typeof service.describe>;
                try {
                    description = service.describe(id); // unknown id exits before any work
                } catch (error) {
                    emitDecisionRejected(bus, { decisionId: id, ...callContext }, error, undefined, rejectedLog());
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
                    if (prelude !== undefined) {
                        prelude.phases.push({
                            phase: 'evidence',
                            startedAt: prelude.startedAt,
                            durationMs: Date.now() - prelude.startedAt,
                        });
                    }
                } catch (error) {
                    emitDecisionRejected(bus, { decisionId: id, ...callContext }, error, undefined, rejectedLog());
                    throw error;
                }

                let input: Record<string, unknown>;
                try {
                    input = parseParams(id, description.parameters, options.param ?? [], evidence);
                } catch (error) {
                    emitDecisionRejected(bus, { decisionId: id, ...callContext }, error, undefined, rejectedLog());
                    throw error;
                }
                const result = await service.decide(id, input, {
                    maker: options.maker,
                    bus,
                    context: callContext,
                    ...(sink !== undefined && prelude !== undefined ? { decisionLog: { sink, prelude } } : {}),
                });
                if (options.json === true) {
                    // Design §3.5: a decide receipt exposes the derived level next to the raw
                    // confidence (the hub result carries only the number). Derived here, never stored.
                    context.output.write(
                        toEnvelopeJson(
                            { ...result, confidenceLevel: confidenceLevel(result.confidence) },
                            { enveloped: options.jsonEnvelope === true },
                        ),
                    );
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

    noun.command('outcome')
        .summary('record what actually happened after a served decision')
        .description(
            [
                'Record the outcome of one served decision invocation (task 1263 R2): whether the',
                'answer turned out to be right, as later observed by the caller.',
                '',
                'The invocation id is the one a decide step now writes into its result row',
                '(invocationId) and that keys the decision.* events and the decision_logs row.',
                'The outcome must match ^[a-z0-9-]{1,32}$; --review-severity <wbs> derives it from',
                "the worst finding in that task's Review table instead (p1-p4, or none).",
                '',
                'First write wins: a second outcome for the same invocation exits 0 and reports',
                'recorded: false with the outcome that already stands. An unknown invocation id',
                'exits 1 (there is no decision to score); a malformed outcome exits 2.',
                '',
                'The row lands in system_events beside decision.end, on the same run id, so',
                '`spur decision status --reliability` can score accuracy against',
                '`decisions.outcomeMap`.',
            ].join('\n'),
        )
        .argument('<invocation-id>', 'invocation id of the served decision')
        .argument('[outcome]', 'outcome label (lowercase slug, e.g. fixed, not-fixed, p2)')
        .option('--review-severity <wbs>', "derive the outcome from that task's Review findings")
        .option('--gate-status <run-id>', "derive the outcome from that run's gate status (fixed / not-fixed)")
        .option('--source <text>', 'free-text note on where the outcome was observed')
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (invocationId: string, outcomeArg: string | undefined, options) => {
            try {
                const derived = [options.reviewSeverity, options.gateStatus].filter((value) => value !== undefined);
                if ((outcomeArg === undefined) === (derived.length === 0) || derived.length > 1) {
                    // Exit 2: a malformed invocation, not a ledger miss.
                    writeJsonError(
                        context.output,
                        options,
                        'provide exactly one of <outcome>, --review-severity <wbs> or --gate-status <run-id>',
                        'VALIDATION_FAILED',
                    );
                    context.setExitCode(2);
                    return;
                }
                let outcome: string;
                if (options.gateStatus !== undefined) {
                    outcome = await gateOutcome(context, String(options.gateStatus));
                } else if (options.reviewSeverity !== undefined) {
                    const path = await taskSpecPath(context, String(options.reviewSeverity));
                    outcome = reviewSeverityOutcome(await context.fs.readFile(path));
                } else {
                    outcome = String(outcomeArg);
                    if (!DECISION_OUTCOME_PATTERN.test(outcome)) {
                        writeJsonError(
                            context.output,
                            options,
                            `invalid outcome "${outcome}": expected ^[a-z0-9-]{1,32}$ (e.g. fixed, not-fixed, p2)`,
                            'VALIDATION_FAILED',
                        );
                        context.setExitCode(2);
                        return;
                    }
                }
                const dao = new SystemEventDao(await context.getDb());
                const result = await recordDecisionOutcome(
                    {
                        dao,
                        secretValues: configuredSecretValues(context.env ?? {}),
                        projectRoot: context.cwd,
                    },
                    {
                        invocationId: String(invocationId),
                        outcome,
                        ...(options.source !== undefined ? { source: String(options.source) } : {}),
                    },
                );
                context.output.write(
                    options.json === true
                        ? toEnvelopeJson(result, { enveloped: options.jsonEnvelope === true })
                        : `${result.decisionId}: outcome ${result.outcome}${result.recorded ? '' : ' (already recorded; first write wins)'}`,
                );
            } catch (error) {
                if (error instanceof UnknownDecisionInvocationError) {
                    context.output.error(`decision outcome: ${error.message}`);
                    context.setExitCode(1);
                    return;
                }
                fail(context, options, error);
            }
        });

    noun.command('status')
        .summary('catalog and maker-config readiness report')
        .description(
            [
                'Readiness report in labelled sections: one status line, then errors, the',
                'makers with their registration, configuration source, served decisions and',
                'recorded evidence, the served decisions with their effective maker and',
                'evidence, and the catalog layer counts.',
                '',
                'Three marks stay separate per row: registered (the registry holds the',
                'maker), configured (a config key names it), and recorded (the ledger holds',
                'outcomes). A maker can be registered and configured and still have never',
                'succeeded: that is what the recorded/accepted counts show.',
                '',
                'With --probe, each distinct registered effective maker is asked one',
                'liveness decision (maker-liveness) through the real resolution, validation',
                'and fallback seam, and reports whether it answered. A failing probe never',
                'changes the exit code, writes no decision_logs row and emits no decision',
                'event, so recorded evidence stays uncontaminated. Without --probe no maker',
                'is constructed.',
                '',
                'With --reliability, reports recorded decision outcomes per decision',
                'and maker from the `decision.end` ledger instead (task 1096): samples,',
                'acceptedRate, fallbacks by reason, medianConfidence, p50/p95 durationMs',
                'and firstSeen/lastSeen. Catalog ids with no recorded rows report',
                "evidence: 'none'. Reads recorded rows only and never calls a maker.",
                '',
                'Exits 0 when clean; exits 1 on any catalog or maker-config error.',
            ].join('\n'),
        )
        .option('--reliability', 'report recorded decision outcomes per decision and maker from the ledger')
        .option('--probe', 'ask one liveness decision of each distinct registered effective maker')
        .option('--since <iso>', 'with --reliability: only rows at or after this ISO timestamp')
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (options) => {
            try {
                const service = await getDecisionService(context.spurConfig ?? null, context.cwd);
                // Refused before the reliability branch returns and before any maker call.
                if (options.probe === true && options.reliability === true) {
                    throw new Error('--probe and --reliability cannot be combined: run one report at a time');
                }
                if (options.reliability === true) {
                    if (options.since !== undefined && Number.isNaN(Date.parse(options.since))) {
                        throw new Error(`invalid --since "${options.since}": expected an ISO timestamp`);
                    }
                    const dao = new SystemEventDao(await context.getDb());
                    const outcomeMap = context.spurConfig?.decisions?.outcomeMap;
                    const report = await decisionReliability(dao, {
                        ...(options.since !== undefined ? { since: options.since } : {}),
                        catalog: service.status().perDecision.map((row) => ({
                            decisionId: row.id,
                            maker: row.maker,
                        })),
                        // 1263 R5: what "right" means for each decision comes from config.
                        ...(outcomeMap !== undefined ? { outcomeMap } : {}),
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
                                    toJson(group.outcomes),
                                    group.accuracy === null ? '-' : group.accuracy.toFixed(4),
                                    group.fallbackAccuracy === null ? '-' : group.fallbackAccuracy.toFixed(4),
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
                const readiness: DecisionStatusReadiness = await readDecisionStatusReadiness(
                    new SystemEventDao(await context.getDb()),
                    status,
                );
                if (options.probe === true) {
                    // Progress goes to stderr: stdout stays the report (and, with --json, one
                    // parseable document). A probe is opted into and bounded per driver, but a
                    // cold local model can still take its full budget per maker.
                    readiness.probes = await probeDecisionMakers(service, status, {
                        onResult: (result) => context.output.error(`probing ${result.maker}: ${renderProbe(result)}`),
                    });
                }
                if (options.json === true) {
                    context.output.write(
                        toEnvelopeJson(
                            {
                                ...status,
                                perDecision: readiness.perDecision,
                                makers: readiness.makers,
                                ...(readiness.probes !== undefined ? { probes: readiness.probes } : {}),
                            },
                            { enveloped: options.jsonEnvelope === true },
                        ),
                    );
                } else {
                    context.output.write(renderDecisionStatus(status, readiness));
                }
                if (!status.ok) context.setExitCode(1);
            } catch (error) {
                fail(context, options, error);
            }
        });
}

const DECISION_LAYERS = ['project', 'registered', 'shared'] as const;

/** Narrow the free-form `--layer` string onto the layer ids `status` counts. */
function isDecisionLayer(value: string): value is (typeof DECISION_LAYERS)[number] {
    return (DECISION_LAYERS as readonly string[]).includes(value);
}

/**
 * Readiness report for `spur decision status` (feature P11 R1): labelled sections, one
 * aligned table per subject, `✓`/`✗` status glyphs and `—` for an empty cell — the shape
 * `agent doctor` established (`packages/app/src/services/agent-service.ts:3158`). Object
 * values never render as raw JSON: the layer counts and duplicates read as `name value`
 * pairs, because the operator is reading a state, not a payload.
 *
 * `SERVES` counts rather than lists: the id → maker mapping is the Decisions table one
 * block down, and a list of every served id inlined here would be wider than the table it
 * belongs to. The ids stay on `makers[].serves` in `--json`.
 */
function renderDecisionStatus(status: DecisionStatus, readiness: DecisionStatusReadiness): string {
    const makers = readiness.makers;
    const probes = new Map((readiness.probes ?? []).map((probe) => [probe.maker, probe]));
    const lines: string[] = [
        `decision status — ${status.ok ? 'OK' : `FAILED (${status.errors.length} error${status.errors.length === 1 ? '' : 's'})`}` +
            ` · ${status.perDecision.length} decisions · ${makers.length} makers · default maker` +
            ` ${status.configDefaultMaker ?? '(unset)'} · ${makers.reduce((total, m) => total + m.evidence.recorded, 0)} recorded`,
    ];
    if (status.errors.length > 0) {
        lines.push('', `Errors (${status.errors.length})`, ...status.errors.map((error) => `  ${error}`));
    }
    lines.push(
        '',
        'Makers',
        ...alignTable(
            [
                'ST',
                'MAKER',
                'CONFIGURED BY',
                'SERVES',
                'RECORDED',
                'ACCEPTED',
                'LAST SEEN',
                ...(readiness.probes !== undefined ? ['PROBE'] : []),
            ],
            makers.map((maker) => [
                maker.registered ? '✓' : '✗',
                maker.name,
                maker.configuredBy.join(', ') || '—',
                String(maker.serves.length),
                String(maker.evidence.recorded),
                String(maker.evidence.accepted),
                maker.evidence.lastSeen ?? '—',
                ...(readiness.probes !== undefined
                    ? [probes.has(maker.name) ? renderProbe(probes.get(maker.name) as DecisionProbeOutcome) : '—']
                    : []),
            ]),
        ),
        '',
        `Decisions (${status.perDecision.length})`,
        ...alignTable(
            ['ST', 'DECISION', 'TYPE', 'MAKER', 'SOURCE', 'MIN', 'LAYER', 'RECORDED', 'ACCEPTED', 'LAST SEEN'],
            readiness.perDecision.map((row) => [
                row.registered ? '✓' : '✗',
                row.id,
                row.type,
                row.maker,
                row.source,
                String(row.minConfidence),
                row.layer,
                String(row.evidence.recorded),
                String(row.evidence.accepted),
                row.evidence.lastSeen ?? '—',
            ]),
        ),
        '',
        'Catalog',
        `  layers      ${DECISION_LAYERS.map((layer) => `${layer} ${status.layers[layer] ?? 0}`).join(' · ')}`,
        `  duplicates  ${status.duplicateIds.map((d) => `${d.id} (${d.sources.join(', ')})`).join(' · ') || '(none)'}`,
        `  overrides   ${
            Object.entries(status.configDecisionMakers)
                .map(([id, maker]) => `${id} ${maker}`)
                .join(' · ') || '(none)'
        }`,
    );
    return lines.join('\n');
}

/**
 * One probe result as `glyph value via reason · duration`. The value is the served answer
 * (`ok` when the maker answered) and the reason distinguishes a named fallback from a
 * deadline; a probe that obtained no answer renders `—` rather than a value it never got.
 */
function renderProbe(probe: DecisionProbeOutcome): string {
    const value = probe.value === null ? '—' : String(probe.value);
    // Human labels rather than the raw taxonomy words: `no-backend` reads as an internal token,
    // and the cell must tell an operator whether the backend was missing, slow or broken without
    // a second `--json` run. The raw reason stays on `probes[].reason` for machine consumers.
    const outcome = probe.ok ? value : `${value} via ${PROBE_REASON_LABELS[probe.reason]}`;
    return `${probe.ok ? '✓' : '✗'} ${outcome} · ${(probe.durationMs / 1000).toFixed(1)}s`;
}

/** Display spelling of each served reason; the `--json` payload keeps the raw value. */
const PROBE_REASON_LABELS: Record<DecisionProbeOutcome['reason'], string> = {
    accepted: 'accepted',
    'low-confidence': 'low confidence',
    'no-backend': 'no backend',
    timeout: 'timed out',
    error: 'errored',
};

/** Pad every column to its widest cell, header included. */
function alignTable(header: readonly string[], rows: readonly (readonly string[])[]): string[] {
    const all = [header, ...rows];
    const widths = header.map((_, column) => Math.max(...all.map((row) => (row[column] ?? '').length)));
    return all.map((row) =>
        row
            .map((cell, column) => cell.padEnd(widths[column] ?? 0))
            .join('  ')
            .trimEnd(),
    );
}

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
/**
 * The outcome a gate visit produced for the decision it was scoring (task 1263 R3a): `fixed` when
 * that run's gate status is PASS, `not-fixed` otherwise — including a missing token, because an
 * unrecorded gate is not evidence that the repair worked.
 */
async function gateOutcome(context: CliContext, runId: string): Promise<string> {
    const path = resolve(context.cwd, '.spur', 'run', `${runId}-gate.status`);
    if (!(await context.fs.exists(path))) return 'not-fixed';
    const status = String(await context.fs.readFile(path)).trim();
    return status === 'PASS' ? 'fixed' : 'not-fixed';
}

/**
 * The task file a `--review-severity <wbs>` call reads. Folder resolution runs through the same
 * config the task noun uses, so a task in a phase folder (`docs/tasks5`) resolves like any other.
 */
async function taskSpecPath(context: CliContext, wbs: string): Promise<string> {
    const { foldersConfig } = await resolvePlanningFolders(context.fs);
    const locator = TaskLocator.forDirs(context.fs, [
        context.fs.resolve(foldersConfig.active_folder),
        ...Object.keys(foldersConfig.folders ?? {}).map((folder) => context.fs.resolve(folder)),
    ]);
    const path = await locator.findPathByWbs(wbs);
    if (path === null) throw new Error(`no task file carries WBS ${wbs}`);
    return path;
}

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
