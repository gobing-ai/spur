/**
 * Mermaid FSM renderer for workflow definitions (task 0620).
 *
 * `spur workflow show` renders the *resolved* definition — the same structure
 * the engine executes — not the YAML text, so extensions and scalar folding
 * can't make the diagram disagree with the run. Both engine kinds are covered:
 * state-machine (states + transitions) and transition-flow (nodes + edges).
 *
 * The implementation lives in `@gobing-ai/spur-app` so CLI and Server share the exact same
 * renderer logic and options.
 */

export {
    classLine,
    esc,
    type RenderWorkflowMermaidOptions,
    renderWorkflowMermaid,
} from '@gobing-ai/spur-app';
