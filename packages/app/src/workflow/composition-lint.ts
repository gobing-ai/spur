/**
 * Workflow composition lint — pure validators over a parsed `WorkflowDef`.
 *
 * Extracted from the workflow application service (task 0962, review candidate C2). The lint is
 * pure over the definition, so it lives beside the other `workflow/` modules and imports nothing
 * from the service — the dependency edge is service → lint, never back.
 */

import { basename } from 'node:path';
import { AGENT_ROLE_NAMES } from '@gobing-ai/spur-config';
import type { DecisionType } from '@gobing-ai/ts-ai-decision';
import type {
    ActionDef,
    GuardDef,
    StateMachineWorkflowDef,
    TransitionFlowWorkflowDef,
    WorkflowDef,
} from '@gobing-ai/ts-dual-workflow-engine';
import { DECIDE_KIND, DecideOptionsSchema, isCatalogDecideOptions } from './actions/decide';
import { validateEvidenceChoices } from './actions/hitl-select';
import { parseDecisionConfig } from './decision-hitl-responder';
import { isTerminalReason, TERMINAL_REASONS } from './terminal-reason';

/** Composition advisory for a validated workflow (0614; two-tier budgets per ADR-115). */
export interface CompositionAdvisory {
    findings: CompositionFinding[];
}

/** One composition finding under the ADR-115 measures and tiers. */
export interface CompositionFinding {
    workflow: string;
    state: string;
    actionKey: string;
    level: 'warn' | 'error';
    measure: {
        kind: 'shell-lines' | 'shell-chars' | 'guard-lines' | 'agent-run-chars' | 'agent-run-output';
        measured: number;
        threshold?: number;
        severity?: string;
    };
    recommendation: string;
}

/**
 * ADR-115 composition tier caps — the parity anchor for the governance §1.2 tier
 * table (`docs/design/harness-surface-governance.md`), the composition paragraph in
 * `docs/design/cli-contracts.md` and the §3 table in
 * `plugins/sp/skills/spur-cli/references/workflows/workflow-fit-and-tuning.md`.
 * A ratchet changes all four together.
 */
export const COMPOSITION_CAPS = {
    shell: { warnAbove: 5, errorAbove: 10, charsErrorAbove: 800 },
    guard: { warnAbove: 3, errorAbove: 5 },
    agentRunInput: { charsErrorAbove: 1000, lowSeverityBelow: 200 },
} as const;

interface ShellCommandEntry {
    /** State or node id where the command was found. */
    stateId: string;
    /** Whether it's an action or guard. */
    kind: 'action' | 'guard';
    /** Index within the action array or guard location. */
    index: number;
    /** The shell command string. */
    command: string;
}

/**
 * Walk a workflow def and collect all shell-kind commands for syntax validation.
 * Supports both state-machine and transition-flow workflow kinds.
 */
export function collectShellCommands(def: WorkflowDef): ShellCommandEntry[] {
    const entries: ShellCommandEntry[] = [];

    const visitAction = (stateId: string, action: ActionDef, idx: number): void => {
        if (action.kind === 'shell') {
            const cmd = action.options?.command;
            if (typeof cmd === 'string' && cmd.length > 0) {
                entries.push({ stateId, kind: 'action', index: idx, command: cmd });
            }
        }
    };

    const visitGuard = (stateId: string, guard: GuardDef): void => {
        if (guard.kind === 'shell') {
            const cmd = guard.options?.command;
            if (typeof cmd === 'string' && cmd.length > 0) {
                entries.push({ stateId, kind: 'guard', index: 0, command: cmd });
            }
        }
    };

    if (def.kind === 'transition-flow' || def.kind === undefined) {
        // Transition-flow: walk nodes for actions, edges for guards.
        const flowDef = def as TransitionFlowWorkflowDef;
        for (const node of flowDef.nodes ?? []) {
            if (node.action) visitAction(node.id, node.action, 0);
        }
        for (const edge of flowDef.edges ?? []) {
            if (edge.condition) visitGuard(edge.from, edge.condition);
        }
    } else {
        // State-machine: walk states for onEnter/onExit, transitions for guards.
        const smDef = def as StateMachineWorkflowDef;
        for (const state of smDef.states ?? []) {
            if (state.onEnter) {
                state.onEnter.forEach((action, i) => {
                    visitAction(state.id, action, i);
                });
            }
            if (state.onExit) {
                state.onExit.forEach((action, i) => {
                    visitAction(state.id, action, i);
                });
            }
        }
        for (const trans of smDef.transitions ?? []) {
            if (trans.guard) visitGuard(`${trans.from}→${trans.to}`, trans.guard);
        }
    }

    return entries;
}

/**
 * Walk a workflow def and collect validation violations for `agent.run` steps
 * that declare no `role:` or an unknown one (0538 R2). Supports both
 * state-machine and transition-flow workflow kinds; mirrors
 * {@link collectShellCommands}'s walk so the two post-schema gates stay
 * consistent. The role vocabulary is the four-id `AGENT_ROLE_NAMES` literal.
 */
export function collectAgentRunRoleViolations(def: WorkflowDef): string[] {
    const roleOf = (options: Record<string, unknown> | undefined): string | undefined => {
        const role = options?.role;
        return typeof role === 'string' && role.trim() !== '' ? role.trim() : undefined;
    };

    const violations: string[] = [];
    const visitAction = (stateId: string, action: ActionDef, idx: number): void => {
        if (action.kind !== 'agent.run') return;
        const role = roleOf(action.options);
        const location = `${stateId}/agent.run[${idx}]`;
        if (role === undefined) {
            violations.push(
                `agent.run step at ${location} declares no role: — add \`role:\` (scribe | coder | reviewer | planner) beside \`agent:\` (0538 R2)`,
            );
        } else if (!(AGENT_ROLE_NAMES as readonly string[]).includes(role)) {
            violations.push(
                `agent.run step at ${location} declares unknown role: '${role}' (accepted: ${AGENT_ROLE_NAMES.join(', ')}; 0538 R2)`,
            );
        }
        // B7 R3 (0894): the session-policy vocabulary is closed — validate rejects
        // anything but reuse | fresh before a run can start.
        const session = action.options?.session;
        if (session !== undefined && session !== 'reuse' && session !== 'fresh') {
            violations.push(
                `agent.run step at ${location} declares invalid session: '${String(session)}' (accepted: reuse, fresh; 0894 R3)`,
            );
        }
    };

    if (def.kind === 'transition-flow' || def.kind === undefined) {
        const flowDef = def as TransitionFlowWorkflowDef;
        for (const node of flowDef.nodes ?? []) {
            if (node.action) visitAction(node.id, node.action, 0);
        }
    } else {
        const smDef = def as StateMachineWorkflowDef;
        for (const state of smDef.states ?? []) {
            for (const [i, action] of (state.onEnter ?? []).entries()) visitAction(state.id, action, i);
            for (const [i, action] of (state.onExit ?? []).entries()) visitAction(state.id, action, i);
        }
    }
    return violations;
}

/**
 * Terminal-reason rule (0937 R3): a state-machine transition into a `failureStates`
 * member finalizes the run as `failed`, so it must declare a closed-enum
 * `terminalReason` — otherwise every edge into a shared failed state looks identical
 * in `runs.terminal_reason`.
 */
export function collectTerminalReasonViolations(def: WorkflowDef): string[] {
    if (def.kind === 'transition-flow' || def.kind === undefined) return [];
    const smDef = def as StateMachineWorkflowDef;
    const failureStates = new Set(smDef.failureStates ?? []);
    const violations: string[] = [];
    for (const transition of smDef.transitions ?? []) {
        if (!failureStates.has(transition.to)) continue;
        if (transition.terminalReason === undefined || !isTerminalReason(transition.terminalReason)) {
            violations.push(
                `transition ${transition.from} -> ${transition.to} enters a failureState without a declared terminalReason` +
                    ` — add \`terminalReason: <enum>\` (accepted: ${TERMINAL_REASONS.join(', ')}; 0937 R3)`,
            );
        }
    }
    return violations;
}

/**
 * Decide-action rule (0941 R6 + task 1094 R7): every `decide` action must parse against the
 * runner's own {@link DecideOptionsSchema} — rejecting a missing `default`, a `default` outside
 * `choices` (or outside yes/no for `noul`), a missing `resultFile`, and any other option-shape
 * drift — before a run can start. Catalog-reference actions additionally resolve against the
 * loaded catalog when `catalogTypes` is supplied: an unknown id or a non-choice/noul type is a
 * violation (score decisions are CLI-only). The map is built by the caller (workflow-service
 * validate) only when a catalog-form action exists, so inline-only workflows never touch the
 * catalog service.
 */
export function collectDecideViolations(def: WorkflowDef, catalogTypes?: ReadonlyMap<string, DecisionType>): string[] {
    const violations: string[] = [];
    const visitAction = (stateId: string, action: ActionDef, idx: number): void => {
        if (action.kind !== DECIDE_KIND) return;
        const parsed = DecideOptionsSchema.safeParse(action.options ?? {});
        if (!parsed.success) {
            const location = `${stateId}/${DECIDE_KIND}[${idx}]`;
            violations.push(
                `Invalid decide action at ${location}: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
            );
            return;
        }
        if (catalogTypes !== undefined && isCatalogDecideOptions(parsed.data)) {
            const location = `${stateId}/${DECIDE_KIND}[${idx}]`;
            const type = catalogTypes.get(parsed.data.decision);
            if (type === undefined) {
                violations.push(
                    `Invalid decide action at ${location}: references unknown decision "${parsed.data.decision}" (not served by any loaded catalog)`,
                );
            } else if (type !== 'choice' && type !== 'noul') {
                violations.push(
                    `Invalid decide action at ${location}: decision "${parsed.data.decision}" has type "${type}"; workflow decide supports choice and noul`,
                );
            }
        }
    };
    visitDecideActions(def, visitAction);
    return violations;
}

/**
 * Inline-decide deprecation warnings (task 1094 R7): one per inline-form decide action site.
 * Warn-only — inline actions keep running until the 1114–1116 catalog migrations land.
 */
export function collectInlineDecideWarnings(def: WorkflowDef): string[] {
    const warnings: string[] = [];
    visitDecideActions(def, (stateId, action) => {
        if (action.kind !== DECIDE_KIND) return;
        const parsed = DecideOptionsSchema.safeParse(action.options ?? {});
        if (parsed.success && !isCatalogDecideOptions(parsed.data)) {
            warnings.push(
                `decide ${stateId}/${parsed.data.id}: inline decide options are deprecated; use { decision: <catalog-id>, params?, evidence?, resultFile }`,
            );
        }
    });
    return warnings;
}

/** Walk every decide action site in both definition shapes (transition-flow nodes / state onEnter). */
function visitDecideActions(def: WorkflowDef, visit: (stateId: string, action: ActionDef, idx: number) => void): void {
    if (def.kind === 'transition-flow' || def.kind === undefined) {
        const flowDef = def as TransitionFlowWorkflowDef;
        for (const node of flowDef.nodes ?? []) {
            if (node.action) visit(node.id, node.action, 0);
        }
    } else {
        const smDef = def as StateMachineWorkflowDef;
        for (const state of smDef.states ?? []) {
            for (const [i, action] of (state.onEnter ?? []).entries()) visit(state.id, action, i);
        }
    }
}

/** True when at least one decide action uses the catalog-reference form (task 1094 R7). */
export function hasCatalogDecideAction(def: WorkflowDef): boolean {
    let found = false;
    visitDecideActions(def, (_stateId, action) => {
        if (found || action.kind !== DECIDE_KIND) return;
        const parsed = DecideOptionsSchema.safeParse(action.options ?? {});
        if (parsed.success && isCatalogDecideOptions(parsed.data)) found = true;
    });
    return found;
}

const HITL_DECISION_KINDS = new Set(['hitl.confirm', 'hitl.select', 'hitl.input']);
const HITL_ANSWER_VAR_DEFAULTS: Record<string, string> = {
    'hitl.confirm': '__hitlAnswer',
    'hitl.select': '__hitlAnswer',
    'hitl.input': '__hitlInput',
};

/** One gate action site in a definition (the 0911 decision walk / 0932 inspection). */
export interface HitlActionSite {
    readonly stateOrNodeId: string;
    readonly paused: boolean;
    readonly kind: string;
    readonly index: number;
    readonly options: Record<string, unknown> | undefined;
}

/**
 * The var a gate writes its answer into: `options.var` when a non-empty string,
 * else the kind default (0932 R1/R2). Shared with the 0911 decision walk so
 * validation, inspection and execution agree on one answer-var rule.
 */
export function hitlAnswerVar(kind: string, options: Record<string, unknown> | undefined): string {
    return typeof options?.var === 'string' && options.var.trim() !== ''
        ? options.var
        : (HITL_ANSWER_VAR_DEFAULTS[kind] ?? '__hitlAnswer');
}

/**
 * Every gate action site declared by one state/node, in declaration order
 * (onEnter before onExit; 0932). Shared by the 0911 decision walk and
 * `pendingGate` — one site walk, never a copied second one.
 */
export function gateSitesForState(def: WorkflowDef, stateId: string): HitlActionSite[] {
    const sites: HitlActionSite[] = [];
    const visitAction = (paused: boolean, action: ActionDef, idx: number): void => {
        if (!HITL_DECISION_KINDS.has(action.kind)) return;
        sites.push({ stateOrNodeId: stateId, paused, kind: action.kind, index: idx, options: action.options });
    };

    if (def.kind === 'transition-flow' || def.kind === undefined) {
        const flowDef = def as TransitionFlowWorkflowDef;
        const node = (flowDef.nodes ?? []).find((n) => n.id === stateId);
        if (node?.action) visitAction(node.pause === true, node.action, 0);
    } else {
        const smDef = def as StateMachineWorkflowDef;
        const state = (smDef.states ?? []).find((s) => s.id === stateId);
        if (state === undefined) return sites;
        for (const [i, action] of (state.onEnter ?? []).entries()) visitAction(state.pause === true, action, i);
        for (const [i, action] of (state.onExit ?? []).entries()) visitAction(state.pause === true, action, i);
    }
    return sites;
}

/**
 * Post-schema policy walk (0911 D2/D5): every hitl.confirm/select/input `decision:` option is
 * parsed with the same runtime parser, and evidence-mode declarations get structural checks that
 * only the whole workflow can see — no evidence-mode action in a pause=true state/node, at most
 * one per state/node, select choices satisfying the evidence invariants, and every producer
 * node referencing a state/node that actually exists. Mirrors the role-var walkers so all
 * post-schema gates stay consistent; both `validate` and `run` share it.
 */
export function collectHitlDecisionViolations(def: WorkflowDef): string[] {
    const stateIds = new Set<string>();
    const sites: HitlActionSite[] = [];

    if (def.kind === 'transition-flow' || def.kind === undefined) {
        const flowDef = def as TransitionFlowWorkflowDef;
        for (const node of flowDef.nodes ?? []) {
            stateIds.add(node.id);
            // 0932: the per-state site walk is shared with pendingGate, not copied.
            sites.push(...gateSitesForState(def, node.id));
        }
    } else {
        const smDef = def as StateMachineWorkflowDef;
        for (const state of smDef.states ?? []) {
            stateIds.add(state.id);
            sites.push(...gateSitesForState(def, state.id));
        }
    }

    const violations: string[] = [];
    const evidencePerState = new Map<string, number>();
    for (const site of sites) {
        const location = `${site.stateOrNodeId}/${site.kind}[${site.index}]`;
        const answerVar = hitlAnswerVar(site.kind, site.options);
        const kindName = site.kind === 'hitl.confirm' ? 'confirm' : site.kind === 'hitl.select' ? 'select' : 'input';
        const parsed = parseDecisionConfig(site.options ?? {}, answerVar, kindName);
        if (!parsed.ok) {
            violations.push(`Invalid decision at ${location}: ${parsed.error}`);
            continue;
        }
        if (parsed.config.mode !== 'evidence') continue;

        if (site.paused) {
            violations.push(
                `Evidence-mode action at ${location} is not allowed in a pause=true state/node (0911 D2): a paused run never reaches the automatic answer path`,
            );
        }
        const count = (evidencePerState.get(site.stateOrNodeId) ?? 0) + 1;
        evidencePerState.set(site.stateOrNodeId, count);
        if (count > 1) {
            violations.push(
                `At most one evidence-mode action per state/node (0911): ${site.stateOrNodeId} declares ${count}`,
            );
        }

        if (site.kind === 'hitl.select') {
            // The choice list lives under `options.options` — the key the runtime runner reads
            // (`actions/hitl-select.ts`) — and is normalized exactly the way `asStringArray` does
            // (no filtering), so validation and execution agree on empty/duplicate choices.
            const rawChoices = site.options?.options;
            const choices = Array.isArray(rawChoices) ? rawChoices.map((choice) => String(choice)) : [];
            const choiceError = validateEvidenceChoices(choices);
            if (choiceError !== null) {
                violations.push(`Invalid decision at ${location}: ${choiceError}`);
            }
        }

        const unknownNodes = parsed.config.evidenceNodes.filter((node) => !stateIds.has(node));
        if (unknownNodes.length > 0) {
            violations.push(
                `Unknown producer node(s) at ${location}: ${unknownNodes.join(', ')} — evidenceNodes must reference existing state/node ids (0911 D5)`,
            );
        }
    }
    return violations;
}

/**
 * One `agent.run` site plus the actions declared before it in the SAME state (production order).
 */
interface AgentRunSite {
    stateId: string;
    index: number;
    options: Record<string, unknown> | undefined;
    earlierInState: ActionDef[];
}

/** One ordered action list per state/node, the walk the self-contained lint reads for production. */
function orderedStateActions(def: WorkflowDef): Map<string, ActionDef[]> {
    const actions = new Map<string, ActionDef[]>();
    if (def.kind === 'transition-flow' || def.kind === undefined) {
        for (const node of (def as TransitionFlowWorkflowDef).nodes ?? []) {
            actions.set(node.id, node.action === undefined ? [] : [node.action]);
        }
        return actions;
    }
    for (const state of (def as StateMachineWorkflowDef).states ?? []) {
        actions.set(state.id, [...(state.onEnter ?? []), ...(state.onExit ?? [])]);
    }
    return actions;
}

/** Directed state/node edges of either definition shape, used for predecessor reachability. */
function stateEdges(def: WorkflowDef): Array<[string, string]> {
    if (def.kind === 'transition-flow' || def.kind === undefined) {
        return ((def as TransitionFlowWorkflowDef).edges ?? []).map((edge) => [edge.from, edge.to] as [string, string]);
    }
    return ((def as StateMachineWorkflowDef).transitions ?? []).map(
        (transition) => [transition.from, transition.to] as [string, string],
    );
}

/**
 * States that can reach `target` through one or more transitions — the only states whose
 * actions run before `target`. A sibling branch that merely shares an ancestor is NOT a
 * predecessor: nothing it produces is guaranteed to exist when `target` runs. `target` is never
 * its own predecessor, so a re-entry cycle does not license reading what an earlier visit wrote.
 */
function predecessorsOf(edges: ReadonlyArray<[string, string]>, target: string): Set<string> {
    const found = new Set<string>();
    let frontier = [target];
    while (frontier.length > 0) {
        const next: string[] = [];
        for (const [from, to] of edges) {
            if (!frontier.includes(to) || from === target || found.has(from)) continue;
            found.add(from);
            next.push(from);
        }
        frontier = next;
    }
    return found;
}

/**
 * Normalize one run artifact path so a prompt template and the shell form that wrote the file
 * compare equal: `${vars.__runId}`, `${__runId}` and `$__runId` all name one workflow var, and
 * the engine interpolates them to the same string before sh or the agent sees the path.
 * A templated path therefore matches only the SAME template — never a wildcard (1233 R2).
 */
function normalizeRunPath(path: string): string {
    return path
        .replace(/\$\{(?:vars\.)?([A-Za-z_][A-Za-z0-9_]*)\}/g, '{$1}')
        .replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}');
}

/** Every `.spur/run/` artifact path a text names, as written (quotes and trailing punctuation cut). */
function runPathsIn(text: string): string[] {
    return [...text.matchAll(/\.spur\/run\/[^\s"'`;,|)]*/g)].map((match) => {
        const path = match[0];
        const trailing = /[.,;:]+$/.exec(path);
        return trailing === null ? path : path.slice(0, trailing.index);
    });
}

/** Option values that name a stage's declared completion artifacts (`expectFile` folds in, 1232). */
function declaredExpectPaths(options: Record<string, unknown> | undefined): string[] {
    const single = options?.expectFile;
    const list = options?.expectFiles;
    return [
        ...(typeof single === 'string' ? [single] : []),
        ...(Array.isArray(list) ? list.filter((entry): entry is string => typeof entry === 'string') : []),
    ].map(normalizeRunPath);
}

/**
 * Artifact paths one action leaves behind, as far as a static scan can tell: a shell command
 * writes them, a `command.gate` names them in args, and an `agent.run` declares them in
 * expectFile(s).
 *
 * shortcut: any `.spur/run/` path a shell command mentions counts as produced, including a
 * path it only reads (a read-position scan would be the upgrade path). Templates match by exact
 * normalized template, so a producer that composes the name at runtime (a shell variable built
 * from a literal) is invisible to this scan.
 */
function producedPaths(actions: readonly ActionDef[]): Set<string> {
    const produced = new Set<string>();
    const add = (text: string): void => {
        for (const path of runPathsIn(text)) produced.add(normalizeRunPath(path));
    };
    for (const action of actions) {
        if (action.kind === 'shell') {
            const command = action.options?.command;
            if (typeof command === 'string') add(command);
        } else if (action.kind === 'command.gate') {
            const args = action.options?.args;
            if (typeof args === 'string') add(args);
            else if (Array.isArray(args)) for (const arg of args) if (typeof arg === 'string') add(arg);
        } else if (action.kind === 'agent.run') {
            for (const path of declaredExpectPaths(action.options)) produced.add(path);
        }
    }
    return produced;
}

/**
 * Self-contained stage lint (D65 1233, design `workflow-execution-foundation` §4.4): an
 * `agent.run` stage must be runnable by a fresh session under any executor, so the whole
 * definition is checked for the two things that break that promise:
 *
 * 1. declared completion — `expectFiles`/`expectFile` or `ownedSections`, without which the
 *    stage's completion is unobservable. `requireDiff: true` also qualifies: the 0424 R3
 *    empty-implement guard fails the step on zero non-corpus changes, which is observable;
 * 2. prompt artifacts — every `.spur/run/` path the prompt names must be produced by an
 *    earlier state's action or declared in `inputs:` (the stage's own `expectFiles` count as
 *    its outputs, not as undeclared reads). Repo-relative paths are not scanned: they are
 *    versioned files a fresh session already has, while run artifacts are not.
 *
 * Findings are errors: `workflow validate` fails, so an unportable stage cannot start a run.
 * A shipped workflow that cannot satisfy the rule yet is named in
 * {@link SELF_CONTAINED_STAGE_ALLOWANCES} with its reason and migration task.
 */
export function collectSelfContainedStageViolations(def: WorkflowDef): string[] {
    const actionsByState = orderedStateActions(def);
    const edges = stateEdges(def);
    const sites: AgentRunSite[] = [];

    for (const [stateId, actions] of actionsByState) {
        actions.forEach((action, index) => {
            if (action.kind !== 'agent.run') return;
            sites.push({ stateId, index, options: action.options, earlierInState: actions.slice(0, index) });
        });
    }

    const violations: string[] = [];
    for (const site of sites) {
        const location = `${site.stateId}/agent.run[${site.index}]`;
        const allowance = SELF_CONTAINED_STAGE_ALLOWANCES[`${def.name}::${site.stateId}`];

        const expectPaths = declaredExpectPaths(site.options);
        const ownedSections = Array.isArray(site.options?.ownedSections) ? site.options.ownedSections : [];
        if (expectPaths.length === 0 && ownedSections.length === 0 && site.options?.requireDiff !== true) {
            violations.push(
                `agent.run step at ${location} declares neither expectFiles nor ownedSections — declare the artifact it produces or the task section it owns, or a fresh session has no observable completion (1233 R1)`,
            );
        }

        const input = site.options?.input;
        if (typeof input !== 'string' || input === '') continue;
        const produced = producedPaths(site.earlierInState);
        for (const predecessor of predecessorsOf(edges, site.stateId)) {
            for (const path of producedPaths(actionsByState.get(predecessor) ?? [])) produced.add(path);
        }
        const declared = new Set(expectPaths);
        const inputs = site.options?.inputs;
        if (Array.isArray(inputs)) {
            for (const entry of inputs) {
                const path = (entry as { path?: unknown } | null)?.path;
                if (typeof path === 'string') declared.add(normalizeRunPath(path));
            }
        }
        for (const path of runPathsIn(input)) {
            const normalized = normalizeRunPath(path);
            if (produced.has(normalized) || declared.has(normalized)) continue;
            if (allowance?.paths.includes(normalized) === true) continue;
            violations.push(
                `agent.run step at ${location} names ${path}, which no earlier state produces and \`inputs:\` does not declare — produce it earlier or add it to inputs (1233 R2)`,
            );
        }
    }
    return violations;
}

/**
 * Reviewed allowances for shipped `agent.run` prompts that name a run artifact the static scan
 * cannot see produced (1233 R3). Each entry is keyed `<workflow name>::<state id>` and lists the
 * exact normalized paths it covers, so a stage or path added later still fails; every entry names
 * the task that removes it. This is an exception list an editor reviews, not a stored snapshot of
 * findings: nothing here is generated, and an entry dies with its migration (ADR-108).
 */
const SELF_CONTAINED_STAGE_ALLOWANCES: Record<string, { paths: readonly string[]; reason: string }> = {
    'idea-pipeline::discovery': {
        paths: ['.spur/run/{__runId}-idea-needs-design.json'],
        reason: 'the stage writes this signal itself but declares only the eval report as its completion; declaring it is 1241 migration work',
    },
    'idea-pipeline::feature-create': {
        paths: ['.spur/run/{__runId}-idea-goal.md', '.spur/run/{__runId}-idea-scope.md'],
        reason: 'the stage writes both intent artifacts itself and a later action in the same state feeds them to `feature update --from-file`; declaring them is 1241 migration work',
    },
    'wrapup-pipeline::doc-sync': {
        paths: ['.spur/run/{__runId}-wrapup-tasks.json'],
        reason: 'the predecessor `task-resolve` writes it through `spur task wrapup resolve`, so the path text never appears in the YAML and the static scan cannot see the production; 1241 migration declares it as an input',
    },
};

/**
 * Post-schema check (0674 R5): a shell action/guard referencing `$var` where `var` is neither
 * declared in the workflow's `vars:` block nor provided locally fails validation — the
 * undeclared-`$baselineSince` class of defect cannot silently recur.
 *
 * Exemptions (each has one reason):
 * - UPPER_SNAKE names: environment namespace — ambient (`PATH`, `PWD`) or helper-emitted via a
 *   sourced `*.env` file (ADR-069 glue convention, e.g. `HA_SINCE`). ponytail ceiling: an
 *   undeclared UPPER_SNAKE workflow var would slip through; upgrade path is parsing the sourced
 *   file, not worth it while repo-owned helpers control that namespace.
 * - dotted braced names (`${vars.x}`): engine templates, interpolated before sh runs.
 * - escaped `\$name`: literal text passed through to jq/awk, never shell-expanded.
 * - names bound locally: shell assignment (`x=…`), jq `--arg/--argjson/--slurpfile`, `for x in`,
 *   `read x`.
 */
export function collectUndeclaredShellVarViolations(def: WorkflowDef): string[] {
    const declared = new Set(Object.keys(def.vars ?? {}));
    const violations: string[] = [];

    const visitCommand = (location: string, command: string): void => {
        // Mask single-quoted spans first — sh treats them as literal text (jq/awk program bodies).
        let masked = '';
        let open = false;
        for (const ch of command) {
            if (ch === "'") open = !open;
            else if (!open) masked += ch;
        }
        const assigned = new Set<string>();
        for (const m of command.matchAll(/\b(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\S/g)) {
            assigned.add(m[1] as string);
        }
        for (const m of masked.matchAll(/(?:^|\s)(?:--arg|--argjson|--slurpfile)\s+([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
            assigned.add(m[1] as string);
        }
        for (const m of masked.matchAll(/\bfor\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\b/g)) {
            assigned.add(m[1] as string);
        }
        for (const m of masked.matchAll(
            /\bread\s+(?:-[a-zA-Z]+\s+)*([A-Za-z_][A-Za-z0-9_]*(?:\s+[A-Za-z_][A-Za-z0-9_]*)*)/g,
        )) {
            for (const v of ((m[1] as string) ?? '').split(/\s+/)) assigned.add(v);
        }
        for (const m of masked.matchAll(/\$(?:\{([^}]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g)) {
            const raw = (m[1] ?? m[2]) as string;
            if (raw.includes('.')) continue;
            if (/^[A-Z][A-Z0-9_]*$/.test(raw)) continue;
            if ((masked[(m.index ?? 0) - 1] ?? '') === '\\') continue;
            if (declared.has(raw) || assigned.has(raw)) continue;
            violations.push(
                `Shell command at ${location} references $${raw}, which is not declared in the workflow's vars: block (0674 R5) — declare it or provide it locally`,
            );
        }
    };

    if (def.kind === 'transition-flow' || def.kind === undefined) {
        const flowDef = def as TransitionFlowWorkflowDef;
        for (const node of flowDef.nodes ?? []) {
            const cmd = node.action?.kind === 'shell' ? node.action.options?.command : undefined;
            if (typeof cmd === 'string' && cmd.length > 0) visitCommand(node.id, cmd);
        }
        for (const edge of flowDef.edges ?? []) {
            const cmd = edge.condition?.kind === 'shell' ? edge.condition.options?.command : undefined;
            if (typeof cmd === 'string' && cmd.length > 0) visitCommand(`${edge.from}→${edge.to}`, cmd);
        }
    } else {
        const smDef = def as StateMachineWorkflowDef;
        const walkActions = (stateId: string, actions: readonly ActionDef[] | undefined): void => {
            for (const [i, action] of (actions ?? []).entries()) {
                const cmd = action.kind === 'shell' ? action.options?.command : undefined;
                if (typeof cmd === 'string' && cmd.length > 0) visitCommand(`${stateId}/action[${i}]`, cmd);
            }
        };
        for (const state of smDef.states ?? []) {
            walkActions(state.id, state.onEnter);
            walkActions(state.id, state.onExit);
        }
        for (const trans of smDef.transitions ?? []) {
            const cmd = trans.guard?.kind === 'shell' ? trans.guard.options?.command : undefined;
            if (typeof cmd === 'string' && cmd.length > 0) visitCommand(`${trans.from}→${trans.to}`, cmd);
        }
    }
    return violations;
}

/** Bare shell structure tokens never count as a logical command (ADR-115 unit). */
const STRUCTURE_TOKENS = new Set(['then', 'else', 'fi', 'do', 'done', 'esac', '{', '}', '(', ')', ';;']);

/**
 * Count the logical commands of a shell program (ADR-115): split on newline,
 * `;`, `&&` and `||`, skipping blank segments, `#` comment segments and bare
 * structure tokens. A pipeline counts once. The split is deliberately naive —
 * it also splits inside `$(…)` and quotes, so a `;` in a quoted message counts;
 * a single `|` never splits. This is the same algorithm that produced the
 * 2026-09-10 governance §1.2 measurements.
 */
export function countLogicalCommands(command: string): number {
    return command
        .split(/\n|;|&&|\|\|/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !s.startsWith('#') && !STRUCTURE_TOKENS.has(s)).length;
}

/**
 * Composition advisory walk (0614, ADR-115). Measures shell actions, shell
 * transition guards and `agent.run` steps against the governance §1.2 tier caps
 * (`COMPOSITION_CAPS`). Guards are measured since ADR-115 — the ADR-069 bulk
 * exemption ended. Each element yields at most one size finding, plus a separate
 * `agent-run-output` finding when an `agent.run` declares no output check.
 * Findings are derived from the definition; no snapshot or suppression list
 * returns (ADR-108). Warn-level findings never affect anything; error-level
 * findings make `workflow validate` exit 1 (CLI-side) but still never block a
 * run — run/dry-run/continue never call this walk.
 */
export function collectCompositionAdvisory(def: WorkflowDef, workflowFile: string): CompositionAdvisory {
    const findings: CompositionFinding[] = [];
    const workflowName = basename(workflowFile, '.yaml');

    const measureShellAction = (stateId: string, actionKey: string, command: string): void => {
        const caps = COMPOSITION_CAPS.shell;
        const lines = countLogicalCommands(command);
        // Precedence: error lines, then error chars, then warn lines — one size
        // finding per element keeps the counts equal to the §1.2 measured table.
        if (lines > caps.errorAbove) {
            findings.push({
                workflow: workflowName,
                state: stateId,
                actionKey,
                level: 'error',
                measure: { kind: 'shell-lines', measured: lines, threshold: caps.errorAbove },
                recommendation: `shell action at ${actionKey} measures ${lines} logical commands (error above ${caps.errorAbove}, ADR-115) — move it to an owner from the governance §1.1 fix vocabulary`,
            });
        } else if (command.length > caps.charsErrorAbove) {
            findings.push({
                workflow: workflowName,
                state: stateId,
                actionKey,
                level: 'error',
                measure: { kind: 'shell-chars', measured: command.length, threshold: caps.charsErrorAbove },
                recommendation: `shell action at ${actionKey} is ${command.length} chars (error above ${caps.charsErrorAbove}, ADR-115) — move it to an owner from the governance §1.1 fix vocabulary`,
            });
        } else if (lines > caps.warnAbove) {
            findings.push({
                workflow: workflowName,
                state: stateId,
                actionKey,
                level: 'warn',
                measure: { kind: 'shell-lines', measured: lines, threshold: caps.warnAbove },
                recommendation: `shell action at ${actionKey} measures ${lines} logical commands (warn above ${caps.warnAbove}, ADR-115) — move it to an owner from the governance §1.1 fix vocabulary`,
            });
        }
    };

    const measureShellGuard = (from: string, to: string, command: string): void => {
        const caps = COMPOSITION_CAPS.guard;
        const lines = countLogicalCommands(command);
        const actionKey = `${from}→${to}`; // same location format as the shell-var walk
        if (lines > caps.errorAbove || lines > caps.warnAbove) {
            const level: CompositionFinding['level'] = lines > caps.errorAbove ? 'error' : 'warn';
            const threshold = lines > caps.errorAbove ? caps.errorAbove : caps.warnAbove;
            findings.push({
                workflow: workflowName,
                state: from,
                actionKey,
                level,
                measure: { kind: 'guard-lines', measured: lines, threshold },
                recommendation: `shell guard ${actionKey} measures ${lines} logical commands (${level} above ${threshold}, ADR-115) — reduce it to one predicate over a result file`,
            });
        }
    };

    const measureAgentRun = (
        stateId: string,
        actionKey: string,
        options: Record<string, unknown> | undefined,
    ): void => {
        const caps = COMPOSITION_CAPS.agentRunInput;
        const input = options?.input;
        if (typeof input === 'string' && input.length > 0) {
            const severity =
                input.length < caps.lowSeverityBelow ? 'low' : input.length <= caps.charsErrorAbove ? 'medium' : 'high';
            if (input.length > caps.charsErrorAbove) {
                // Over the cap is an error whatever the shape — slash-led or not.
                findings.push({
                    workflow: workflowName,
                    state: stateId,
                    actionKey,
                    level: 'error',
                    measure: {
                        kind: 'agent-run-chars',
                        measured: input.length,
                        threshold: caps.charsErrorAbove,
                        severity,
                    },
                    recommendation: `agent.run prompt at ${actionKey} is ${input.length} chars, over the ${caps.charsErrorAbove}-char cap (error, severity ${severity}) — pin to a slash command or a script with a bounded prompt`,
                });
            } else if (!input.trimStart().startsWith('/')) {
                findings.push({
                    workflow: workflowName,
                    state: stateId,
                    actionKey,
                    level: 'warn',
                    measure: { kind: 'agent-run-chars', measured: input.length, severity },
                    recommendation: `agent.run prompt at ${actionKey} is ${input.length} chars, not slash-pinned (warn, severity ${severity}) — pin to a slash command or a script with a bounded prompt`,
                });
            }
        }
        if (options?.expectFile === undefined && options?.requireDiff !== true) {
            findings.push({
                workflow: workflowName,
                state: stateId,
                actionKey,
                level: 'warn',
                measure: { kind: 'agent-run-output', measured: 0 },
                recommendation: `agent.run at ${actionKey} declares neither expectFile nor requireDiff — declare the artifact it must produce`,
            });
        }
    };

    const visitAction = (stateId: string, actionKey: string, action: ActionDef): void => {
        if (action.kind === 'shell') {
            const cmd = action.options?.command;
            if (typeof cmd === 'string' && cmd.length > 0) measureShellAction(stateId, actionKey, cmd);
        } else if (action.kind === 'agent.run') {
            measureAgentRun(stateId, actionKey, action.options);
        }
    };

    if (def.kind === 'transition-flow' || def.kind === undefined) {
        const flowDef = def as TransitionFlowWorkflowDef;
        for (const node of flowDef.nodes ?? []) {
            if (node.action) visitAction(node.id, `${node.id}:onEnter:0`, node.action);
        }
        // ADR-115 measures flow edges as guards for completeness; no shipped
        // definition uses them today.
        for (const edge of flowDef.edges ?? []) {
            const cmd = edge.condition?.kind === 'shell' ? edge.condition.options?.command : undefined;
            if (typeof cmd === 'string' && cmd.length > 0) measureShellGuard(edge.from, edge.to, cmd);
        }
    } else {
        const smDef = def as StateMachineWorkflowDef;
        for (const state of smDef.states ?? []) {
            for (const [i, action] of (state.onEnter ?? []).entries()) {
                visitAction(state.id, `${state.id}:onEnter:${i}`, action);
            }
            for (const [i, action] of (state.onExit ?? []).entries()) {
                visitAction(state.id, `${state.id}:onExit:${i}`, action);
            }
        }
        for (const trans of smDef.transitions ?? []) {
            const cmd = trans.guard?.kind === 'shell' ? trans.guard.options?.command : undefined;
            if (typeof cmd === 'string' && cmd.length > 0) measureShellGuard(trans.from, trans.to, cmd);
        }
    }

    return { findings };
}
