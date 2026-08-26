/**
 * Mermaid FSM renderer for workflow definitions (task 0620).
 *
 * `spur workflow show` renders the *resolved* definition — the same structure
 * the engine executes — not the YAML text, so extensions and scalar folding
 * can't make the diagram disagree with the run. Both engine kinds are covered:
 * state-machine (states + transitions) and transition-flow (nodes + edges).
 *
 * The output is a fenced `mermaid` code block ready to paste into docs, with
 * terminal and failure states visually distinguished from ordinary states.
 */

import type { WorkflowDef } from '@gobing-ai/ts-dual-workflow-engine';

/**
 * Escape a node id / label for use inside a mermaid `flowchart` block.
 * Parens are escaped too: unquoted mermaid edge/node labels reject them
 * (`got 'PS'` parse error), e.g. descriptions like "(ADR-079)".
 */
function esc(text: string): string {
    return text
        .replace(/"/g, '&quot;')
        .replace(/\[/g, '&#91;')
        .replace(/\]/g, '&#93;')
        .replace(/\(/g, '&#40;')
        .replace(/\)/g, '&#41;');
}

/** Render a `class X classname` assignment. */
function classLine(id: string, cls: string): string {
    return `    class ${esc(id)} ${cls};`;
}

/** Render `spur workflow show <file>` output: a fenced mermaid block. */
export function renderWorkflowMermaid(def: WorkflowDef): string {
    const lines: string[] = [];
    lines.push('```mermaid');
    lines.push('flowchart TD');
    lines.push('    classDef terminal fill:#d4edda,stroke:#1e7e34,color:#0a3d1f;');
    lines.push('    classDef failure fill:#f8d7da,stroke:#c62828,color:#5f1414;');
    lines.push('    classDef initial fill:#fff3cd,stroke:#b8860b,color:#5a4a00;');
    lines.push('    classDef gate fill:#e8e8f8,stroke:#5b5bd6,color:#1a1a5e;');
    lines.push('    classDef decision fill:#ffe9d1,stroke:#e07b00,color:#6b3a00;');
    lines.push('    classDef parallel fill:#f0f4f8,stroke:#2c7fb8,color:#123a55;');

    if (def.kind === 'transition-flow') {
        const terminal = new Set<string>(def.terminalNodes ?? []);
        const typeShape: Record<string, string> = {
            gate: '{{"',
            decision: '{"',
            parallel: '[("',
        };
        for (const node of def.nodes) {
            const id = node.id;
            const type = node.type ?? 'action';
            const terminalNode = terminal.has(id);
            if (terminalNode) {
                lines.push(`    ${esc(id)}(["${esc(id)}"])`);
                lines.push(classLine(id, 'terminal'));
            } else if (type === 'action') {
                lines.push(`    ${esc(id)}["${esc(id)}"]`);
            } else {
                const open = typeShape[type] ?? '["';
                lines.push(`    ${esc(id)}${open}${esc(id)}"]`);
                const cls = type === 'gate' ? 'gate' : type === 'decision' ? 'decision' : 'parallel';
                lines.push(classLine(id, cls));
            }
        }
        lines.push(classLine(def.initialNode, 'initial'));
        for (const edge of def.edges) {
            const label = [edge.condition !== undefined ? `cond:${edge.condition.kind}` : undefined, edge.description]
                .filter((s): s is string => s !== undefined)
                .join(' · ');
            lines.push(
                label.length > 0
                    ? `    ${esc(edge.from)} -->|${esc(label)}| ${esc(edge.to)}`
                    : `    ${esc(edge.from)} --> ${esc(edge.to)}`,
            );
        }
    } else {
        const terminal = new Set<string>(def.terminalStates ?? []);
        const failure = new Set<string>(def.failureStates ?? []);
        for (const state of def.states) {
            const id = state.id;
            const isTerminal = terminal.has(id);
            const isFailure = failure.has(id);
            if (isFailure) {
                lines.push(`    ${esc(id)}["${esc(id)}"]`);
                lines.push(classLine(id, 'failure'));
            } else if (isTerminal) {
                lines.push(`    ${esc(id)}(["${esc(id)}"])`);
                lines.push(classLine(id, 'terminal'));
            } else {
                lines.push(`    ${esc(id)}["${esc(id)}"]`);
            }
        }
        lines.push(classLine(def.initialState, 'initial'));
        for (const t of def.transitions) {
            const label = [
                t.trigger !== undefined ? `trigger:${t.trigger}` : undefined,
                t.guard !== undefined ? `guard:${t.guard.kind}` : undefined,
                t.description,
            ]
                .filter((s): s is string => s !== undefined)
                .join(' · ');
            lines.push(
                label.length > 0
                    ? `    ${esc(t.from)} -->|${esc(label)}| ${esc(t.to)}`
                    : `    ${esc(t.from)} --> ${esc(t.to)}`,
            );
        }
    }

    lines.push('```');
    return lines.join('\n');
}
