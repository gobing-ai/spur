import type { DbAdapter } from '@gobing-ai/spur-domain';
import {
    DbWorkflowPersistenceAdapter,
    type Vars,
    type WorkflowDef,
    type WorkflowPersistenceAdapter,
} from '@gobing-ai/ts-dual-workflow-engine';

/**
 * Fresh-run start state — app-layer early validation and `--from-run` lineage
 * resolution (task 1072, ADR-051 consent 2026-10-05).
 *
 * The engine holds the runtime authority: `WorkflowService.run` re-validates
 * `startState` and refuses with `FSMError` before it creates the run row. This
 * module mirrors that rule one layer earlier so the CLI can refuse *before* it
 * writes a plan artifact, a run record, or an async worker — the engine cannot
 * do that for the async launcher, which resolves the definition and writes its
 * own artifacts before the worker ever calls the engine (R3).
 *
 * The duplication is deliberate and narrow: `assertStartStateStartable` is the
 * engine rule restated for the early gate. If the engine rule changes, both
 * change; the engine remains the contract of record.
 */

/** A refused `--from` / `--from-run` invocation. The CLI maps this to exit 2. */
export class StartStateRefusedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'StartStateRefusedError';
    }
}

/** Engine/runtime-internal var prefix — never inherited from a source run (R5). */
const INTERNAL_VAR_PREFIX = '__';

/**
 * Refuse an illegal fresh-run start point: undeclared (naming the valid
 * `startable` ids), terminal, failure, not marked `startable: true`, or on a
 * `kind: 'dag'` workflow.
 */
export function assertStartStateStartable(workflow: WorkflowDef, startState: string): void {
    if (workflow.kind === 'dag') {
        throw new StartStateRefusedError(
            `--from ${startState}: not supported for kind: "dag" workflows — DAG runs resume at node level instead.`,
        );
    }
    const nodes: readonly { readonly id: string; readonly startable?: boolean }[] =
        workflow.kind === 'transition-flow' ? workflow.nodes : workflow.states;
    const terminal: readonly string[] =
        workflow.kind === 'transition-flow' ? (workflow.terminalNodes ?? []) : (workflow.terminalStates ?? []);
    const failure: readonly string[] = workflow.kind === 'transition-flow' ? [] : (workflow.failureStates ?? []);

    const declared = nodes.find((node) => node.id === startState);
    if (declared === undefined) {
        const startable = nodes.filter((node) => node.startable === true).map((node) => node.id);
        throw new StartStateRefusedError(
            `--from ${startState}: no such state in this definition. ` +
                (startable.length > 0 ? `Startable ids: ${startable.join(', ')}` : 'No state declares startable: true'),
        );
    }
    if (failure.includes(startState)) {
        throw new StartStateRefusedError(`--from ${startState}: it is declared as a failure state.`);
    }
    if (terminal.includes(startState)) {
        throw new StartStateRefusedError(`--from ${startState}: it is declared as a terminal state.`);
    }
    if (declared.startable !== true) {
        throw new StartStateRefusedError(
            `--from ${startState}: not marked startable: true in the definition. ` +
                'Starting mid-graph is an author opt-in — there is no override flag.',
        );
    }
}

/** Lineage read from a `--from-run` source run. */
export interface ContinuedFrom {
    /** Effective vars from the source run's last snapshot, engine-internal keys dropped. */
    vars: Vars;
    /** The source run's recorded definition digest, when it recorded one. */
    digest?: string;
    /** The source run's status at read time — recorded for the lineage line, never mutated. */
    status: string;
}

/**
 * Read `--from-run` lineage: the source run row plus its last snapshot's
 * effective vars, with engine-internal `__*` keys dropped (R5). The source run
 * is never mutated — continuation always creates a new run id.
 */
export async function readContinuedFrom(
    source: DbAdapter | WorkflowPersistenceAdapter,
    sourceRunId: string,
): Promise<ContinuedFrom> {
    const persistence =
        'loadRun' in source
            ? (source as WorkflowPersistenceAdapter)
            : new DbWorkflowPersistenceAdapter(source as DbAdapter);
    const run = await persistence.loadRun(sourceRunId);
    if (run === undefined) {
        throw new StartStateRefusedError(`--from-run ${sourceRunId}: no such run.`);
    }
    const snapshot = await persistence.loadLatestStateSnapshot(sourceRunId);
    const raw = (snapshot?.data as { effectiveVars?: unknown } | undefined)?.effectiveVars;
    const vars: Vars = {};
    if (raw !== null && typeof raw === 'object') {
        for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
            if (key.startsWith(INTERNAL_VAR_PREFIX)) continue;
            if (typeof value === 'string') vars[key] = value;
        }
    }
    let digest: string | undefined;
    try {
        const meta = JSON.parse(run.metadata_json) as Record<string, unknown>;
        if (typeof meta.definitionDigest === 'string' && meta.definitionDigest !== '') {
            digest = meta.definitionDigest;
        }
    } catch {
        // Unparseable metadata yields no digest lineage; the run still continues.
    }
    return { vars, digest, status: run.status };
}
