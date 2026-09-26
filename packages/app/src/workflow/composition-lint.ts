/**
 * Workflow composition lint — pure validators over a parsed `WorkflowDef`.
 *
 * Extracted from the workflow application service (task 0962, review candidate C2). The lint is
 * pure over the definition, so it lives beside the other `workflow/` modules and imports nothing
 * from the service — the dependency edge is service → lint, never back.
 */

import { basename } from 'node:path';
import { AGENT_ROLE_NAMES } from '@gobing-ai/spur-config';
import type {
    ActionDef,
    GuardDef,
    StateMachineWorkflowDef,
    TransitionFlowWorkflowDef,
    WorkflowDef,
} from '@gobing-ai/ts-dual-workflow-engine';
import { DECIDE_KIND, DecideOptionsSchema } from './actions/decide';
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
 * Decide-action rule (0941 R6): every `decide` action must parse against the runner's own
 * {@link DecideOptionsSchema} — rejecting a missing `default`, a `default` outside `choices`
 * (or outside yes/no for `noul`), a missing `resultFile`, and any other option-shape drift —
 * before a run can start.
 */
export function collectDecideViolations(def: WorkflowDef): string[] {
    const violations: string[] = [];
    const visitAction = (stateId: string, action: ActionDef, idx: number): void => {
        if (action.kind !== DECIDE_KIND) return;
        const parsed = DecideOptionsSchema.safeParse(action.options ?? {});
        if (!parsed.success) {
            const location = `${stateId}/${DECIDE_KIND}[${idx}]`;
            violations.push(
                `Invalid decide action at ${location}: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
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
        }
    }
    return violations;
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
