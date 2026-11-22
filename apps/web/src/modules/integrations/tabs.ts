/** Append-only tab list for the Integrations module (task 1424 R2): contract order, never reordered. */
export interface IntegrationsTab {
    readonly id: 'summary' | 'mcp' | 'a2a';
    readonly label: string;
}

/** Summary → MCP → A2A. Append new views at the end so existing ids stay stable. */
export const INTEGRATIONS_TABS: readonly IntegrationsTab[] = [
    { id: 'summary', label: 'Summary' },
    { id: 'mcp', label: 'MCP' },
    { id: 'a2a', label: 'A2A' },
];
