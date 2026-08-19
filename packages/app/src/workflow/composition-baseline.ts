import crypto from 'node:crypto';
import { resolve } from 'node:path';
import {
    type ActionDef,
    loadWorkflowDef,
    type StateMachineWorkflowDef,
    type WorkflowDef,
} from '@gobing-ai/ts-dual-workflow-engine';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';

/**
 * Action-level facts recorded in the workflow composition baseline.
 */
export interface WorkflowActionBaseline {
    /** Runner kind declared for the action. */
    kind: string;
    /** Canonical invocation representation (e.g. input prompt or executable args). */
    invocation?: string;
    /** Classification of state mutation effect on domain state. */
    stateEffect: 'read' | 'write' | 'may-write';
    /** Classification of evidence creation effect. */
    evidenceEffect: 'none' | 'write';
}

/**
 * Baseline fact specification for a single tracked workflow definition.
 */
export interface WorkflowEntryBaseline {
    /** Relative path to definition file. */
    definition: string;
    /** Boundary containment classification. */
    boundary: string;
    /** Disposition classification for workflow deprecation or migration. */
    disposition?: string;
    /** List of known entrypoint callers invoking this workflow. */
    callers: string[];
    /** Declared terminal states. */
    terminalStates: string[];
    /** Recorded artifact paths or kinds produced by the workflow. */
    artifacts: string[];
    /** Failure disposition policy. */
    failurePolicy: string;
    /** List of state identifiers that perform LLM / model queries. */
    modelQueries: string[];
    /** Map of indexed action keys to action facts. */
    actions: Record<string, WorkflowActionBaseline>;
}

/**
 * Two-sided workflow composition baseline schema tracking all canonical workflows.
 */
export interface WorkflowCompositionBaseline {
    /** Schema version number. */
    schemaVersion: 1;
    /** Proof input scoping and normalization parameters. */
    proofInputs: {
        repository: {
            excludeConfiguredCorpusFolders: boolean;
        };
        taskFields: string[];
        taskSections: string[];
        featureFields: string[];
        featureSections: string[];
    };
    /** Map of workflow IDs to their baseline specifications. */
    workflows: Record<string, WorkflowEntryBaseline>;
}

/**
 * Difference entry identified between resolved workflow definitions and composition baseline.
 */
export interface CompositionCheckDiff {
    /** Workflow identifier. */
    workflow: string;
    /** Property or action field path where drift was detected. */
    field: string;
    /** Expected value recorded in baseline. */
    expected: unknown;
    /** Actual value resolved from current definition. */
    actual: unknown;
}

/**
 * Result of two-sided workflow composition baseline verification.
 */
export interface CompositionCheckResult {
    /** True if no unlisted drift or missing baseline definitions were found. */
    pass: boolean;
    /** Human-readable error messages for detected violations. */
    errors: string[];
    /** Detailed differences between actual definitions and baseline. */
    diffs: CompositionCheckDiff[];
}

/**
 * Deterministically serializes a JSON-compatible object with sorted keys.
 *
 * @param obj - The value to stringify.
 * @returns Canonical sorted JSON string.
 */
export function canonicalJsonStringify(obj: unknown): string {
    if (obj === null || typeof obj !== 'object') {
        return JSON.stringify(obj);
    }
    if (Array.isArray(obj)) {
        return `[${obj.map(canonicalJsonStringify).join(',')}]`;
    }
    const keys = Object.keys(obj as Record<string, unknown>).sort();
    const entries = keys.map(
        (key) => `${JSON.stringify(key)}:${canonicalJsonStringify((obj as Record<string, unknown>)[key])}`,
    );
    return `{${entries.join(',')}}`;
}

/**
 * Computes canonical SHA-256 digest string (`sha256:<hex>`) over a workflow definition.
 *
 * @param workflow - The loaded workflow definition.
 * @returns SHA-256 digest string.
 */
export function computeDefinitionDigest(workflow: WorkflowDef): string {
    const canonical = canonicalJsonStringify(workflow);
    const hash = crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
    return `sha256:${hash}`;
}

/**
 * Extracts normalized action facts, terminal states, and model-bearing states from a workflow.
 *
 * @param workflow - The loaded workflow definition.
 * @returns Extracted facts object.
 */
export function extractResolvedWorkflowFacts(workflow: WorkflowDef): {
    terminalStates: string[];
    modelQueries: string[];
    actions: Record<string, { kind: string; invocation?: string }>;
} {
    const sm = workflow as StateMachineWorkflowDef;
    const terminalStates = Array.isArray(sm.terminalStates) ? [...sm.terminalStates] : [];
    const modelQueries: string[] = [];
    const actions: Record<string, { kind: string; invocation?: string }> = {};

    if (Array.isArray(sm.states)) {
        for (const state of sm.states) {
            let hasModelQuery = false;
            if (Array.isArray(state.onEnter)) {
                state.onEnter.forEach((action: ActionDef, idx: number) => {
                    const key = `${state.id}:onEnter:${idx}`;
                    const invocation =
                        typeof action.options?.input === 'string'
                            ? action.options.input
                            : typeof action.options?.command === 'string'
                              ? action.options.command
                              : undefined;
                    actions[key] = {
                        kind: action.kind,
                        ...(invocation !== undefined ? { invocation } : {}),
                    };
                    if (action.kind === 'agent.run') {
                        hasModelQuery = true;
                    }
                });
            }
            if (Array.isArray(state.onExit)) {
                state.onExit.forEach((action: ActionDef, idx: number) => {
                    const key = `${state.id}:onExit:${idx}`;
                    const invocation =
                        typeof action.options?.input === 'string'
                            ? action.options.input
                            : typeof action.options?.command === 'string'
                              ? action.options.command
                              : undefined;
                    actions[key] = {
                        kind: action.kind,
                        ...(invocation !== undefined ? { invocation } : {}),
                    };
                    if (action.kind === 'agent.run') {
                        hasModelQuery = true;
                    }
                });
            }
            if (hasModelQuery) {
                modelQueries.push(state.id);
            }
        }
    }

    return {
        terminalStates,
        modelQueries,
        actions,
    };
}

/**
 * Validates repository workflow definitions against `config/workflow-composition-baseline.json`.
 * Enforces two-sided symmetry: unlisted drift fails and stale baseline records fail.
 *
 * @param options - Check options including project root and optional custom baseline.
 * @returns Verification result with pass status and diffs.
 */
export async function checkWorkflowComposition(options: {
    projectRoot: string;
    baselinePath?: string;
    baseline?: WorkflowCompositionBaseline;
    fileSystem?: FileSystem;
}): Promise<CompositionCheckResult> {
    const fs = options.fileSystem ?? createNodeFileSystem();
    const baselineFile =
        options.baselinePath ?? resolve(options.projectRoot, 'config/workflow-composition-baseline.json');
    let baseline = options.baseline;

    if (!baseline) {
        if (!(await fs.exists(baselineFile))) {
            return {
                pass: false,
                errors: [`Baseline file not found at ${baselineFile}`],
                diffs: [],
            };
        }
        const content = await fs.readFile(baselineFile);
        try {
            baseline = JSON.parse(content) as WorkflowCompositionBaseline;
        } catch (e) {
            return {
                pass: false,
                errors: [`Failed to parse baseline JSON: ${e instanceof Error ? e.message : String(e)}`],
                diffs: [],
            };
        }
    }

    const errors: string[] = [];
    const diffs: CompositionCheckDiff[] = [];

    for (const [name, expected] of Object.entries(baseline.workflows)) {
        const defPath = resolve(options.projectRoot, expected.definition);
        if (!(await fs.exists(defPath))) {
            errors.push(`Workflow definition for "${name}" missing at ${expected.definition}`);
            diffs.push({
                workflow: name,
                field: 'definition',
                expected: expected.definition,
                actual: null,
            });
            continue;
        }

        let def: WorkflowDef;
        try {
            def = await loadWorkflowDef(defPath, { validateSchema: false });
        } catch (e) {
            errors.push(`Failed to load workflow definition "${name}": ${e instanceof Error ? e.message : String(e)}`);
            continue;
        }

        const facts = extractResolvedWorkflowFacts(def);

        // Terminal states comparison
        const sortedExpectedTerminals = [...expected.terminalStates].sort();
        const sortedActualTerminals = [...facts.terminalStates].sort();
        if (JSON.stringify(sortedExpectedTerminals) !== JSON.stringify(sortedActualTerminals)) {
            errors.push(`Workflow "${name}" terminalStates mismatch`);
            diffs.push({
                workflow: name,
                field: 'terminalStates',
                expected: expected.terminalStates,
                actual: facts.terminalStates,
            });
        }

        // Model queries comparison
        const sortedExpectedModelQueries = [...expected.modelQueries].sort();
        const sortedActualModelQueries = [...facts.modelQueries].sort();
        if (JSON.stringify(sortedExpectedModelQueries) !== JSON.stringify(sortedActualModelQueries)) {
            errors.push(`Workflow "${name}" modelQueries mismatch`);
            diffs.push({
                workflow: name,
                field: 'modelQueries',
                expected: expected.modelQueries,
                actual: facts.modelQueries,
            });
        }

        // Two-sided action checks
        const expectedActionKeys = Object.keys(expected.actions).sort();
        const actualActionKeys = Object.keys(facts.actions).sort();

        // Check for missing / unexpected actions
        for (const actionKey of expectedActionKeys) {
            if (!facts.actions[actionKey]) {
                errors.push(
                    `Workflow "${name}" action "${actionKey}" is listed in baseline but missing from live definition`,
                );
                diffs.push({
                    workflow: name,
                    field: `actions.${actionKey}`,
                    expected: expected.actions[actionKey],
                    actual: null,
                });
            } else {
                const expAction = expected.actions[actionKey];
                const actAction = facts.actions[actionKey];
                if (expAction && actAction) {
                    if (expAction.kind !== actAction.kind) {
                        errors.push(
                            `Workflow "${name}" action "${actionKey}" kind mismatch: expected ${expAction.kind}, got ${actAction.kind}`,
                        );
                        diffs.push({
                            workflow: name,
                            field: `actions.${actionKey}.kind`,
                            expected: expAction.kind,
                            actual: actAction.kind,
                        });
                    }
                    if (expAction.invocation !== undefined && expAction.invocation !== actAction.invocation) {
                        errors.push(`Workflow "${name}" action "${actionKey}" invocation mismatch`);
                        diffs.push({
                            workflow: name,
                            field: `actions.${actionKey}.invocation`,
                            expected: expAction.invocation,
                            actual: actAction.invocation,
                        });
                    }
                }
            }
        }

        for (const actionKey of actualActionKeys) {
            if (!expected.actions[actionKey]) {
                errors.push(
                    `Workflow "${name}" action "${actionKey}" present in live definition but unlisted in baseline`,
                );
                diffs.push({
                    workflow: name,
                    field: `actions.${actionKey}`,
                    expected: null,
                    actual: facts.actions[actionKey],
                });
            }
        }
    }

    return {
        pass: errors.length === 0,
        errors,
        diffs,
    };
}
