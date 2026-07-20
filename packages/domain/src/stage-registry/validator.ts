/**
 * Stage-registry graph validator (feature O, spec ticket 0282, task 0302).
 *
 * {@link validateStageRegistryGraph} is the load-time gate (0282 R3 + AC2):
 * it validates the whole registry graph - per-record semantics, cross-record
 * identity, external cross-references, and the transition DAG - and rejects
 * before any corpus mutation or agent invocation. Unlike the throwing
 * {@link validateStageRegistry} (0301, within-registry structural checks),
 * the graph validator is non-throwing and collects ALL actionable diagnostics
 * in one pass (0282 R2).
 *
 * Authority boundaries (R2, 0282) are preserved: the registry is declarative
 * data; cross-reference resolution is owned by the host (CLI / scripts lane)
 * via {@link RegistryReferenceResolver}. The validator never reaches into the
 * filesystem - it asks the resolver.
 *
 * Observability (R4, 0282 Design): the same `run_id` and `stage_ids` are
 * emitted on both pass and fail paths, and every diagnostic carries the
 * `run_id` so downstream telemetry can correlate pass/fail signals to the
 * exact validation run.
 */
import { type StageRecord, StageRegistryError, validateStageRecord } from './schema';

// ─── Transition graph (R1, 0282 R3) ───────────────────────────────────────

/**
 * A directed transition between two stages in the registry graph.
 *
 * Transitions are declared separately from {@link StageRecord} because they
 * are a graph-level (workflow-lane) concern, not a per-record property. A
 * transition names its source and target stage ids and MAY declare:
 * - `gate`    - a gate that must fire on this transition (resolved via the
 *               resolver's `hasGate`).
 * - `workflow` - the workflow that owns this transition edge (resolved via
 *               the resolver's `hasWorkflow`).
 *
 * The transition graph MUST be a DAG (0282 AC2: cyclic transitions are
 * rejected). Retry semantics live on the record's `retry` policy, not on
 * transition cycles.
 */
export interface StageTransition {
    /** Source stage id (must exist in the registry). */
    from: string;
    /** Target stage id (must exist in the registry). */
    to: string;
    /** Optional gate that fires on this transition. */
    gate?: string;
    /** Optional workflow that owns this transition edge. */
    workflow?: string;
}

// ─── Reference resolver (R2, 0282 R3) ─────────────────────────────────────

/**
 * Host-owned cross-reference resolver. Maps the six reference kinds named in
 * 0282 R3 (skills, commands, gates, workflows, adapters, artifact paths) to
 * whether they resolve in the host environment.
 *
 * The registry is declarative; it names references but never resolves them.
 * The host implements this interface. Hosts that do not track a kind return
 * `true` (opt-out per-kind); the validator then never emits a diagnostic for
 * that kind.
 */
export interface RegistryReferenceResolver {
    /** Whether `reasoning_skill` resolves to an installed skill. */
    hasSkill(name: string): boolean;
    /** Whether a command alias resolves to a registered command. */
    hasCommand(name: string): boolean;
    /** Whether a gate name resolves to a known gate implementation. */
    hasGate(name: string): boolean;
    /** Whether a workflow name resolves to a loaded workflow. */
    hasWorkflow(name: string): boolean;
    /** Whether an adapter name resolves to a platform adapter. */
    hasAdapter(name: string): boolean;
    /** Whether an artifact path resolves to a real on-disk artifact. */
    hasArtifactPath(path: string): boolean;
}

// ─── Diagnostics (R2, R4) ─────────────────────────────────────────────────

/**
 * Reference kind tag for actionable cross-reference diagnostics (R2). Tells
 * the operator which lane to fix: skill, command, gate, workflow, adapter,
 * artifact path, or transition edge.
 */
export type RegistryReferenceKind =
    | 'skill'
    | 'command'
    | 'gate'
    | 'workflow'
    | 'adapter'
    | 'artifact-path'
    | 'transition';

/**
 * Diagnostic code union. Extends {@link StageRegistryError}['code'] with the
 * graph-level `dangling-transition` code (a transition edge references a
 * stage id that does not exist in the registry).
 */
export type RegistryDiagnosticCode = StageRegistryError['code'] | 'dangling-transition';

/**
 * An actionable validation diagnostic (R2). One per discovered defect; the
 * validator collects all of them rather than throwing on the first.
 */
export interface RegistryDiagnostic {
    /** R4: the run id this diagnostic belongs to (same on pass and fail). */
    run_id: string;
    /** Error category. Drives the operator's fix path. */
    code: RegistryDiagnosticCode;
    /** The stage that has the defect, when applicable. */
    stageId?: string;
    /** Human-readable, actionable description. */
    message: string;
    /** The reference that failed to resolve, when applicable. */
    ref?: string;
    /** The reference kind, for cross-reference diagnostics (R2). */
    kind?: RegistryReferenceKind;
}

// ─── Result (R1, R4) ──────────────────────────────────────────────────────

/**
 * Result of validating the registry graph (R1). `ok` is true iff
 * `diagnostics` is empty. The `run_id` and `stage_ids` are always present
 * (R4: same identifiers on pass and fail paths).
 */
export interface RegistryValidationResult {
    /** True iff the registry graph passed all checks. */
    ok: boolean;
    /** All discovered diagnostics (empty when ok). */
    diagnostics: RegistryDiagnostic[];
    /** R4: the run id for this validation pass. */
    run_id: string;
    /** R4: the stage ids under validation, for observability correlation. */
    stage_ids: string[];
}

// ─── Options ──────────────────────────────────────────────────────────────

/**
 * Options for {@link validateStageRegistryGraph}.
 */
export interface ValidateStageRegistryGraphOptions {
    /** Host-owned cross-reference resolver (R2). Required. */
    resolver: RegistryReferenceResolver;
    /** Transition edges (R1). Optional; when absent, transition checks are skipped. */
    transitions?: ReadonlyArray<StageTransition>;
    /**
     * Optional stage-id -> adapter-name map. When provided, the validator
     * checks `hasAdapter` for each entry (R2: adapters). Stages not in the
     * map are not adapter-checked.
     */
    adapter_refs?: ReadonlyMap<string, string>;
    /**
     * Optional caller-provided run id (R4). When omitted, a UUID is generated.
     * Providing an explicit id lets the caller correlate the validation run
     * with an outer pipeline run.
     */
    run_id?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * A resolver that resolves everything. Useful for hosts that trust the
 * registry's declared references (e.g. unit tests of graph structure) and
 * for tests that want to isolate non-cross-reference checks.
 */
export const passAllResolver: RegistryReferenceResolver = {
    hasSkill: () => true,
    hasCommand: () => true,
    hasGate: () => true,
    hasWorkflow: () => true,
    hasAdapter: () => true,
    hasArtifactPath: () => true,
};

/**
 * Generate a run id (R4). Uses the Web Crypto API when available; falls back
 * to a timestamp+counter so the validator never blocks on id generation.
 */
function generateRunId(): string {
    const crypto = globalThis.crypto;
    if (crypto && typeof crypto.randomUUID === 'function') {
        return `stage-registry-run-${crypto.randomUUID()}`;
    }
    return `stage-registry-run-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ─── Graph validator (R1, R2, R3, R4) ─────────────────────────────────────

/**
 * Validate the whole registry graph at load time (R1). Non-throwing; returns
 * ALL actionable diagnostics (R2) plus the run/stage identifiers for
 * observability (R4).
 *
 * Checks performed (R3):
 * 1. Per-record semantics (via {@link validateStageRecord}, catches throws).
 * 2. Cross-record identity: duplicate ids, alias shadows.
 * 3. External cross-references (R2): skills, commands, gates, workflows,
 *    adapters, artifact paths - resolved via the host resolver.
 * 4. Transition DAG: dangling edges, cycles, unsupported transitions into
 *    `irreversible` stages without a gate.
 *
 * @param records  - the stage records forming the registry graph.
 * @param options  - resolver (required), transitions, adapter_refs, run_id.
 * @returns a {@link RegistryValidationResult}; never throws.
 */
export function validateStageRegistryGraph(
    records: ReadonlyArray<StageRecord>,
    options: ValidateStageRegistryGraphOptions,
): RegistryValidationResult {
    const run_id = options.run_id ?? generateRunId();
    const diagnostics: RegistryDiagnostic[] = [];
    const stage_ids = records.map((r) => r.id);

    const diag = (
        code: RegistryDiagnosticCode,
        message: string,
        extra?: { stageId?: string; ref?: string; kind?: RegistryReferenceKind },
    ): void => {
        diagnostics.push({ run_id, code, message, ...extra });
    };

    // ── 1. Per-record semantic validation (catch throws -> diagnostics) ──
    for (const record of records) {
        try {
            validateStageRecord(record);
        } catch (err) {
            if (err instanceof StageRegistryError) {
                diag(err.code, err.message, { stageId: err.stageId ?? record.id });
            } else {
                diag(
                    'unknown-dependency',
                    `stage ${record.id}: unexpected validation error: ${(err as Error).message}`,
                    {
                        stageId: record.id,
                    },
                );
            }
        }
    }

    // ── 2. Cross-record identity (non-throwing re-implementation) ──────
    const idIndex = new Map<string, number>();
    const aliasOwner = new Map<string, string>();
    for (let i = 0; i < records.length; i += 1) {
        const record = records[i];
        if (record === undefined) continue;
        const prior = idIndex.get(record.id);
        if (prior !== undefined) {
            diag('duplicate-id', `duplicate stage id ${record.id} (first at index ${prior})`, {
                stageId: record.id,
            });
        } else {
            idIndex.set(record.id, i);
        }
        for (const alias of record.aliases) {
            const owner = aliasOwner.get(alias);
            if (owner !== undefined && owner !== record.id) {
                diag('duplicate-id', `alias ${alias} of stage ${record.id} shadows stage ${owner}`, {
                    stageId: record.id,
                    ref: alias,
                });
            } else if (idIndex.has(alias) && idIndex.get(alias) !== i) {
                diag('duplicate-id', `alias ${alias} of stage ${record.id} shadows stage id ${alias}`, {
                    stageId: record.id,
                    ref: alias,
                });
            } else {
                aliasOwner.set(alias, record.id);
            }
        }
    }

    // ── 3. External cross-references (R2) ──────────────────────────────
    const resolver = options.resolver;
    for (const record of records) {
        // Skill reference.
        if (!resolver.hasSkill(record.reasoning_skill)) {
            diag(
                'unknown-dependency',
                `stage ${record.id}: reasoning_skill ${record.reasoning_skill} does not resolve`,
                {
                    stageId: record.id,
                    ref: record.reasoning_skill,
                    kind: 'skill',
                },
            );
        }
        // Command references (aliases are legacy command identifiers).
        for (const alias of record.aliases) {
            if (!resolver.hasCommand(alias)) {
                diag('unknown-dependency', `stage ${record.id}: alias ${alias} does not resolve to a command`, {
                    stageId: record.id,
                    ref: alias,
                    kind: 'command',
                });
            }
        }
        // Gate references.
        for (const gate of record.gates) {
            if (!resolver.hasGate(gate.name)) {
                diag('missing-gate', `stage ${record.id}: gate ${gate.name} does not resolve`, {
                    stageId: record.id,
                    ref: gate.name,
                    kind: 'gate',
                });
            }
        }
        // Artifact-path references.
        for (const ref of record.required_references) {
            if (!resolver.hasArtifactPath(ref)) {
                diag('unknown-dependency', `stage ${record.id}: required_reference ${ref} does not resolve`, {
                    stageId: record.id,
                    ref,
                    kind: 'artifact-path',
                });
            }
        }
    }

    // Adapter references (opt-in via adapter_refs map).
    if (options.adapter_refs) {
        for (const [stageId, adapterName] of options.adapter_refs) {
            if (!resolver.hasAdapter(adapterName)) {
                diag('unknown-dependency', `stage ${stageId}: adapter ${adapterName} does not resolve`, {
                    stageId,
                    ref: adapterName,
                    kind: 'adapter',
                });
            }
        }
    }

    // ── 4. Transition DAG (R3) ─────────────────────────────────────────
    if (options.transitions && options.transitions.length > 0) {
        const transitions = options.transitions;

        // 4a. Dangling edges: from/to must exist in the registry.
        for (const t of transitions) {
            if (!idIndex.has(t.from)) {
                diag(
                    'dangling-transition',
                    `transition from ${t.from} to ${t.to} references unknown source stage ${t.from}`,
                    {
                        stageId: t.from,
                        ref: t.from,
                        kind: 'transition',
                    },
                );
            }
            if (!idIndex.has(t.to)) {
                diag(
                    'dangling-transition',
                    `transition from ${t.from} to ${t.to} references unknown target stage ${t.to}`,
                    {
                        stageId: t.to,
                        ref: t.to,
                        kind: 'transition',
                    },
                );
            }
            // Transition gate reference.
            if (t.gate && !resolver.hasGate(t.gate)) {
                diag('missing-gate', `transition ${t.from} -> ${t.to}: gate ${t.gate} does not resolve`, {
                    ref: t.gate,
                    kind: 'gate',
                });
            }
            // Transition workflow reference.
            if (t.workflow && !resolver.hasWorkflow(t.workflow)) {
                diag('unknown-dependency', `transition ${t.from} -> ${t.to}: workflow ${t.workflow} does not resolve`, {
                    ref: t.workflow,
                    kind: 'workflow',
                });
            }
        }

        // 4b. Cycle detection (DFS). Self-loops and longer cycles both reject.
        const adj = new Map<string, string[]>();
        for (const id of stage_ids) adj.set(id, []);
        for (const t of transitions) {
            if (idIndex.has(t.from) && idIndex.has(t.to)) {
                adj.get(t.from)?.push(t.to);
            }
        }
        const WHITE = 0;
        const GRAY = 1;
        const BLACK = 2;
        const color = new Map<string, number>();
        for (const id of stage_ids) color.set(id, WHITE);

        const findCycle = (): string[] | null => {
            const stack: string[] = [];
            const visit = (node: string): string[] | null => {
                color.set(node, GRAY);
                stack.push(node);
                for (const next of adj.get(node) ?? []) {
                    const c = color.get(next);
                    if (c === GRAY) {
                        // Found a cycle: slice from the first occurrence of `next`.
                        const idx = stack.indexOf(next);
                        return stack.slice(idx).concat(next);
                    }
                    if (c === WHITE) {
                        const found = visit(next);
                        if (found) return found;
                    }
                }
                stack.pop();
                color.set(node, BLACK);
                return null;
            };
            for (const id of stage_ids) {
                if (color.get(id) === WHITE) {
                    const found = visit(id);
                    if (found) return found;
                }
            }
            return null;
        };

        const cycle = findCycle();
        if (cycle && cycle.length > 0) {
            const path = cycle.join(' -> ');
            const startNode = cycle[0];
            if (cycle.length === 2 && cycle[0] === cycle[1]) {
                diag(
                    'cyclic-transition',
                    `stage ${startNode} has a self-transition; use the stage retry policy for retries`,
                    {
                        stageId: startNode,
                        ref: startNode,
                        kind: 'transition',
                    },
                );
            } else {
                diag('cyclic-transition', `transition graph has a cycle: ${path}`, {
                    stageId: startNode,
                    ref: path,
                    kind: 'transition',
                });
            }
        }

        // 4c. Unsupported transitions: into an `irreversible` execution stage
        //     requires a transition gate (operator intent at the boundary).
        const recordById = new Map<string, StageRecord>();
        for (const r of records) recordById.set(r.id, r);
        for (const t of transitions) {
            const target = recordById.get(t.to);
            if (target && target.execution.kind === 'irreversible' && !t.gate) {
                diag(
                    'incompatible-model-policy',
                    `transition ${t.from} -> ${t.to}: target stage ${t.to} is irreversible and requires a transition gate`,
                    {
                        stageId: t.to,
                        ref: `${t.from} -> ${t.to}`,
                        kind: 'transition',
                    },
                );
            }
        }
    }

    return {
        ok: diagnostics.length === 0,
        diagnostics,
        run_id,
        stage_ids,
    };
}
