import { resolve } from 'node:path';
import type { Command } from '@commander-js/extra-typings';
import {
    DECIDE_EVIDENCE_MAX_CHARS,
    type DecisionStatus,
    getDecisionService,
    redactAndBound,
    UnknownDecisionError,
} from '@gobing-ai/spur-app';
import type { CliContext } from '../context';
import { toEnvelopeJson, toJson, writeJsonError } from '../output';
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
            try {
                const service = await getDecisionService(context.spurConfig ?? null, context.cwd);
                const description = service.describe(id); // unknown id exits before any work

                // Evidence before any backend interaction: an unreadable declared file is
                // a caller mistake (design §3.4). Redaction uses the built-in SECRET_PATTERN
                // only — secrets are deliberately not threaded (workflow decide parity).
                let evidence: string[] | undefined;
                if (options.evidence !== undefined && options.evidence.length > 0) {
                    evidence = await Promise.all(
                        options.evidence.map(async (file) => {
                            const path = resolve(context.cwd, file);
                            let text: string;
                            try {
                                text = await context.fs.readFile(path);
                            } catch {
                                throw new Error(`evidence file "${file}" is unreadable (cwd ${context.cwd})`);
                            }
                            return redactAndBound(text, [], DECIDE_EVIDENCE_MAX_CHARS);
                        }),
                    );
                }

                const input = parseParams(id, description.parameters, options.param ?? [], evidence);
                const result = await service.decide(id, input, { maker: options.maker });
                if (options.json === true) {
                    context.output.write(toEnvelopeJson(result, { enveloped: options.jsonEnvelope === true }));
                } else {
                    context.output.write(
                        `${result.id}: ${toJson(result.value)} (reason ${result.reason}, confidence ${result.confidence ?? 'n/a'},` +
                            ` maker ${result.maker} via ${result.makerSource}, ${result.durationMs}ms)`,
                    );
                }
            } catch (error) {
                fail(context, options, error);
            }
        });

    noun.command('status')
        .summary('catalog and maker-config readiness report')
        .description(
            [
                'Configured default maker, per-decision effective maker and source,',
                'registered makers, per-layer catalog counts, load errors and duplicate',
                'ids. Exits 0 when clean; exits 1 on any catalog or maker-config error.',
            ].join('\n'),
        )
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (options) => {
            try {
                const service = await getDecisionService(context.spurConfig ?? null, context.cwd);
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
        if (eq <= 0) throw new Error(`invalid --param "${pair}": expected k=v`);
        const key = pair.slice(0, eq);
        const raw = pair.slice(eq + 1);
        const def = declared[key] as { type?: string } | undefined;
        if (def === undefined) {
            throw new Error(
                `unknown --param "${key}" for decision "${id}"; declared parameters: ${Object.keys(declared).join(', ')}`,
            );
        }
        switch (def.type) {
            case 'number': {
                const value = Number(raw);
                if (!Number.isFinite(value)) throw new Error(`--param ${key} expects a finite number, got "${raw}"`);
                input[key] = value;
                break;
            }
            case 'boolean':
                if (raw !== 'true' && raw !== 'false')
                    throw new Error(`--param ${key} expects true|false, got "${raw}"`);
                input[key] = raw === 'true';
                break;
            case 'json':
                try {
                    input[key] = JSON.parse(raw);
                } catch {
                    throw new Error(`--param ${key} expects valid JSON, got "${raw}"`);
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
