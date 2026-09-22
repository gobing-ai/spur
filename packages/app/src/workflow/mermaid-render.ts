/**
 * Mermaid FSM renderer for workflow definitions.
 *
 * `spur workflow show` and the Web UI render the *resolved* definition — the same
 * structure the engine executes — not the YAML text, so extensions and scalar folding
 * cannot make the diagram disagree with the run. Both engine kinds are covered:
 * state-machine (states + transitions) and transition-flow (nodes + edges).
 *
 * Enhanced features:
 * - Action-kind badges on node labels (🤖 agent.run, 💻 shell, 👤 hitl.*, etc.)
 * - Distinct edge arrow styles per guard kind (dashed=shell, solid=always, dotted=other)
 * - Click-tooltip directives embedding key action details visible on hover in the UI
 * - Color-coded node classes for action-kind categories
 */

import type { ActionDef, StateDef, WorkflowDef } from '@gobing-ai/ts-dual-workflow-engine';

// ---------------------------------------------------------------------------
// Escaping helpers
// ---------------------------------------------------------------------------

/**
 * Sanitize a node identifier for Mermaid syntax.
 * Identifiers must use alphanumeric characters, hyphens, and underscores.
 */
export function escId(id: string): string {
    return id.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Escape text for use inside a quoted Mermaid node label ["..."] or tooltip "...".
 * Replaces double-quotes with single-quotes and collapses whitespace.
 * Preserves natural parentheses, brackets, and UTF-8 characters.
 */
export function escQuotedText(text: string): string {
    return text
        .replace(/"/g, "'")
        .replace(/[\r\n]+/g, ' ')
        .trim();
}

/**
 * Escape text for use inside a double-quoted Mermaid edge label |"..."|.
 * Replaces double-quotes with single-quotes, pipes with '/', and collapses whitespace.
 * Natural parentheses and brackets are preserved without entity mangling.
 */
export function escEdgeText(text: string): string {
    return text
        .replace(/"/g, "'")
        .replace(/\|/g, '/')
        .replace(/[\r\n]+/g, ' ')
        .trim();
}

/** Backward-compatible alias for text escaping. */
export function esc(text: string): string {
    return escQuotedText(text);
}

/** Render a `class X classname` assignment. */
export function classLine(id: string, cls: string): string {
    return `    class ${escId(id)} ${cls};`;
}

// ---------------------------------------------------------------------------
// Action-kind classification
// ---------------------------------------------------------------------------

/** Broad category of an action kind for visual grouping. */
type ActionCategory = 'agent' | 'shell' | 'hitl' | 'gate' | 'system' | 'other';

function categorizeAction(kind: string): ActionCategory {
    if (kind === 'agent.run') return 'agent';
    if (kind === 'shell') return 'shell';
    if (kind.startsWith('hitl.')) return 'hitl';
    if (kind === 'command.gate' || kind === 'doctor.probe') return 'gate';
    if (kind === 'note' || kind === 'proof.fingerprint' || kind === 'file.read.into-var' || kind === 'run.artifact')
        return 'system';
    return 'other';
}

/** Emoji badge for an action category. */
const CATEGORY_BADGE: Record<ActionCategory, string> = {
    agent: '🤖',
    shell: '💻',
    hitl: '👤',
    gate: '🔒',
    system: '⚙',
    other: '▶',
};

/**
 * Derive the dominant action category for a list of actions.
 * Priority: agent > hitl > shell > gate > system > other.
 */
function dominantCategory(actions: readonly ActionDef[]): ActionCategory | null {
    if (actions.length === 0) return null;
    const priority: ActionCategory[] = ['agent', 'hitl', 'shell', 'gate', 'system', 'other'];
    const found = new Set<ActionCategory>(actions.map((a) => categorizeAction(a.kind)));
    return priority.find((c) => found.has(c)) ?? null;
}

/** Mermaid classDef name for a dominant action category. */
function categoryClass(cat: ActionCategory): string {
    const map: Record<ActionCategory, string> = {
        agent: 'nodeAgent',
        shell: 'nodeShell',
        hitl: 'nodeHitl',
        gate: 'nodeGate',
        system: 'nodeSystem',
        other: 'nodeOther',
    };
    return map[cat];
}

// ---------------------------------------------------------------------------
// Tooltip helpers
// ---------------------------------------------------------------------------

/** Truncate a string to at most `max` chars, appending … if truncated. */
function trunc(s: string, max = 120): string {
    const trimmed = s.replace(/\s+/g, ' ').trim();
    return trimmed.length > max ? `${trimmed.slice(0, max)}...` : trimmed;
}

/**
 * Build a short tooltip string for a single action.
 * - shell: first ~120 chars of the command
 * - agent.run: agent + prompt/slash prefix
 * - hitl.*: question or kind label
 * - others: kind only
 */
function actionTooltip(action: ActionDef): string {
    const opts = action.options ?? {};
    switch (action.kind) {
        case 'shell': {
            const cmd = typeof opts.command === 'string' ? opts.command : '';
            return `shell: ${trunc(cmd, 120)}`;
        }
        case 'agent.run': {
            const agent = typeof opts.agent === 'string' ? opts.agent : 'auto';
            const prompt = typeof opts.prompt === 'string' ? opts.prompt : '';
            const slash = typeof opts.slash === 'string' ? opts.slash : '';
            const input = prompt || slash;
            return input ? `agent(${agent}): ${trunc(input, 80)}` : `agent.run(${agent})`;
        }
        case 'hitl.confirm': {
            const q = typeof opts.question === 'string' ? opts.question : action.kind;
            return `hitl: ${trunc(q, 100)}`;
        }
        default: {
            const id = typeof opts.id === 'string' ? opts.id : '';
            return id ? `${action.kind}(${id})` : action.kind;
        }
    }
}

/**
 * Build the full tooltip text for a state/node.
 * Lists the description + up to 3 key action details.
 */
function stateTooltip(description: string | undefined, actions: readonly ActionDef[]): string {
    const parts: string[] = [];
    if (description) parts.push(trunc(description, 80));
    const relevant = actions.slice(0, 3);
    for (const a of relevant) {
        parts.push(actionTooltip(a));
    }
    if (actions.length > 3) parts.push(`+${actions.length - 3} more`);
    return parts.join(' | ');
}

/**
 * Build the display label for a state node.
 * Adds an emoji badge for the dominant action kind.
 */
function stateLabel(id: string, actions: readonly ActionDef[]): string {
    const cat = dominantCategory(actions);
    if (!cat) return esc(id);
    const badge = CATEGORY_BADGE[cat];
    return `${badge} ${esc(id)}`;
}

// ---------------------------------------------------------------------------
// Guard / edge helpers
// ---------------------------------------------------------------------------

type EdgeStyle = 'solid' | 'dashed';

function guardEdgeStyle(guardKind: string | undefined): EdgeStyle {
    if (guardKind === 'shell') return 'dashed';
    return 'solid';
}

/**
 * Smartly clean and truncate description text at word boundaries with an ellipsis.
 * Balances unclosed parentheses if cut off inside a parenthetical.
 */
function cleanAndTruncate(s: string, maxLen = 65): string {
    const oneLine = s
        .replace(/[\r\n]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (oneLine.length <= maxLen) return oneLine;

    // Truncate at word boundary
    const slice = oneLine.slice(0, maxLen);
    const lastSpace = slice.lastIndexOf(' ');
    let cut = (lastSpace > maxLen * 0.5 ? slice.slice(0, lastSpace) : slice).trim();

    // Remove trailing punctuation that looks awkward before ellipsis
    cut = cut.replace(/[,;:\-—–([]+$/, '').trim();

    // Check paren balance: if an opening paren was started but not closed
    const opens = (cut.match(/\(/g) || []).length;
    const closes = (cut.match(/\)/g) || []).length;
    if (opens > closes) {
        return `${cut}…)`;
    }
    return `${cut}…`;
}

/**
 * Format a human-friendly, concise label for a workflow transition/edge.
 *
 * Rules:
 * 1. Triggers are formatted as `[trigger]` (e.g. `[contract-violation]`, `[ready]`).
 * 2. Unconditional transitions (`guard: always`) and shell probes (`guard: shell`)
 *    rely on the arrow style (solid vs dashed) to indicate conditionality.
 *    Redundant prefixes like `guard:always · ` or `guard:shell · ` are omitted
 *    when a clear human description is present.
 * 3. Specific/custom conditions without a description display `[guard: kind]`.
 * 4. Human descriptions are cleanly truncated at word boundaries with an ellipsis `…`
 *    so text does not awkwardly cut off mid-word or leave dangling open parens.
 */
export function formatEdgeLabel(description?: string, guardKind?: string, trigger?: string, maxLen = 65): string {
    const parts: string[] = [];

    // 1. Trigger prefix if present, e.g. [ready] or [contract-violation]
    if (trigger !== undefined && trigger.trim().length > 0) {
        parts.push(`[${trigger.trim()}]`);
    }

    // 2. Guard prefix for non-standard guards (neither default 'always' nor standard 'shell')
    // 'always' and 'shell' are already visually represented by the arrow style (solid vs dashed)
    if (guardKind !== undefined && guardKind !== 'always' && guardKind !== 'shell' && guardKind !== trigger) {
        parts.push(`[${guardKind}]`);
    }

    // 3. Human description if present
    if (description && description.trim().length > 0) {
        const text = cleanAndTruncate(description, maxLen);
        parts.push(text);
    } else if (parts.length === 0 && guardKind !== undefined) {
        // If there is no trigger and no description, label the guard kind
        // e.g. [guard: shell] or [guard: always]
        parts.push(`[guard: ${guardKind}]`);
    }

    return parts.join(' ');
}

/**
 * Render a Mermaid edge arrow for a given style and optional label.
 *
 * Mermaid flowchart arrow syntax:
 *   solid:  --> (no label) | -->|"label"| (with double-quoted label)
 *   dashed: -.-> (no label) | -.->|"label"| (with double-quoted label)
 *
 * Double-quoting the label inside |"..."| tells Mermaid to treat the contents as a
 * string literal, natively supporting parentheses, brackets, dashes, and UTF-8.
 */
function edgeLine(from: string, to: string, label: string, style: EdgeStyle): string {
    const f = escId(from);
    const t = escId(to);
    const cleaned = escEdgeText(label);
    if (style === 'dashed') {
        return cleaned ? `    ${f} -.->|"${cleaned}"| ${t}` : `    ${f} -.-> ${t}`;
    }
    return cleaned ? `    ${f} -->|"${cleaned}"| ${t}` : `    ${f} --> ${t}`;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Options for Mermaid workflow diagram generation. */
export interface RenderWorkflowMermaidOptions {
    /** Whether to wrap the output in markdown code fences ```mermaid ... ``` (default: true). */
    fenced?: boolean;
    /** Flowchart direction: 'TD' (top-down) or 'LR' (left-right). Default: 'TD'. */
    direction?: 'TD' | 'LR';
}

// ---------------------------------------------------------------------------
// Main renderer
// ---------------------------------------------------------------------------

/** Render workflow definition output as a mermaid flowchart block. */
export function renderWorkflowMermaid(def: WorkflowDef, options: RenderWorkflowMermaidOptions = {}): string {
    const fenced = options.fenced !== false;
    const direction = options.direction ?? 'TD';
    const lines: string[] = [];

    if (fenced) {
        lines.push('```mermaid');
    }
    lines.push(`flowchart ${direction}`);

    // ── Node state/lifecycle classDefs ──────────────────────────────────────
    lines.push('    classDef terminal fill:#d4edda,stroke:#1e7e34,stroke-width:1.5px,color:#0a3d1f;');
    lines.push('    classDef failure fill:#f8d7da,stroke:#c62828,stroke-width:1.5px,color:#5f1414;');
    lines.push('    classDef initial fill:#fff3cd,stroke:#b8860b,stroke-width:1.5px,color:#5a4a00;');
    // transition-flow structural shapes
    lines.push('    classDef gate fill:#e8e8f8,stroke:#5b5bd6,stroke-width:1.5px,color:#1a1a5e;');
    lines.push('    classDef decision fill:#ffe9d1,stroke:#e07b00,stroke-width:1.5px,color:#6b3a00;');
    lines.push('    classDef parallel fill:#f0f4f8,stroke:#2c7fb8,stroke-width:1.5px,color:#123a55;');
    // ── Action-kind node classDefs ───────────────────────────────────────────
    lines.push('    classDef nodeAgent fill:#e0e7ff,stroke:#4f46e5,stroke-width:1.5px,color:#1e1b4b;');
    lines.push('    classDef nodeShell fill:#ecfdf5,stroke:#059669,stroke-width:1.5px,color:#064e3b;');
    lines.push('    classDef nodeHitl fill:#fdf4ff,stroke:#9333ea,stroke-width:1.5px,color:#3b0764;');
    lines.push('    classDef nodeGate fill:#eff6ff,stroke:#2563eb,stroke-width:1.5px,color:#1e3a8a;');
    lines.push('    classDef nodeSystem fill:#f8fafc,stroke:#64748b,stroke-width:1px,color:#0f172a;');
    lines.push('    classDef nodeOther fill:#f5f5f4,stroke:#78716c,stroke-width:1px,color:#1c1917;');

    // ── Render by workflow kind ─────────────────────────────────────────────
    const tooltips: string[] = [];

    if (def.kind === 'transition-flow') {
        const terminal = new Set<string>(def.terminalNodes ?? []);
        const typeShape: Record<string, string> = {
            gate: '{{',
            decision: '{',
            parallel: '[(',
        };
        const typeClose: Record<string, string> = {
            gate: '}}',
            decision: '}',
            parallel: ')]',
        };

        for (const node of def.nodes) {
            const id = node.id;
            const nid = escId(id);
            const type = node.type ?? 'action';
            const terminalNode = terminal.has(id);
            const actions: ActionDef[] = node.action ? [node.action] : [];
            const label = stateLabel(id, actions);
            const displayLabel = escQuotedText(label);

            if (terminalNode) {
                lines.push(`    ${nid}(["${escQuotedText(id)}"])`);
                lines.push(classLine(id, 'terminal'));
            } else if (type === 'action') {
                lines.push(`    ${nid}["${displayLabel}"]`);
                const cat = dominantCategory(actions);
                if (cat) lines.push(classLine(id, categoryClass(cat)));
            } else {
                const open = typeShape[type] ?? '[';
                const close = typeClose[type] ?? ']';
                lines.push(`    ${nid}${open}"${displayLabel}"${close}`);
                const cls = type === 'gate' ? 'gate' : type === 'decision' ? 'decision' : 'parallel';
                lines.push(classLine(id, cls));
            }

            // tooltip click directive
            const tip = stateTooltip(node.description, actions);
            if (tip) {
                tooltips.push(`    click ${nid} href "javascript:void(0)" "${escQuotedText(tip)}"`);
            }
        }

        lines.push(classLine(def.initialNode, 'initial'));

        for (const edge of def.edges) {
            const guardKind = edge.condition?.kind;
            const style = guardEdgeStyle(guardKind);
            const label = formatEdgeLabel(edge.description, guardKind);
            lines.push(edgeLine(edge.from, edge.to, label, style));
        }
    } else {
        // state-machine
        const terminal = new Set<string>(def.terminalStates ?? []);
        const failure = new Set<string>(def.failureStates ?? []);

        for (const state of def.states) {
            const id = state.id;
            const nid = escId(id);
            const actions = [...(state.onEnter ?? []), ...(state.onExit ?? [])];
            const isTerminal = terminal.has(id);
            const isFailure = failure.has(id);
            const label = stateLabel(id, actions);
            const displayLabel = escQuotedText(label);

            if (isFailure) {
                lines.push(`    ${nid}["${escQuotedText(id)}"]`);
                lines.push(classLine(id, 'failure'));
            } else if (isTerminal) {
                lines.push(`    ${nid}(["${escQuotedText(id)}"])`);
                lines.push(classLine(id, 'terminal'));
            } else {
                lines.push(`    ${nid}["${displayLabel}"]`);
                const cat = dominantCategory(actions);
                if (cat) lines.push(classLine(id, categoryClass(cat)));
            }

            // tooltip click directive
            const tip = stateTooltip(state.description, actions);
            if (tip) {
                tooltips.push(`    click ${nid} href "javascript:void(0)" "${escQuotedText(tip)}"`);
            }
        }

        // initial class overrides action-kind class — applied last so it wins specificity
        lines.push(classLine(def.initialState, 'initial'));

        // Edges — styled by guard kind; human-friendly label formatting
        for (const t of def.transitions) {
            const guardKind = t.guard?.kind;
            const style = guardEdgeStyle(guardKind);
            const label = formatEdgeLabel(t.description, guardKind, t.trigger);
            lines.push(edgeLine(t.from, t.to, label, style));
        }
    }

    // ── Tooltip click directives ────────────────────────────────────────────
    for (const tip of tooltips) {
        lines.push(tip);
    }

    if (fenced) {
        lines.push('```');
    }
    return lines.join('\n');
}

// StateDef is imported but used only as a type reference in the function signature.
// Re-export for downstream consumers that currently import from this module.
export type { StateDef };
