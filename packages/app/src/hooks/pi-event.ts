/**
 * pi-event — Pi event → Claude-shaped payload normalization for `spur self hook --host pi`.
 *
 * Ported verbatim from `plugins/sp/hooks/pi/guard-extension.ts` (task 0969 R1) for the
 * script-absorption plan PR-2a (docs/plans/2026-10-14-spur-script-absorption.md §5.3). The Pi
 * extension keeps its own copy until PR-2b reduces it to a spawn wrapper; keep the two in step.
 */

import type { ToolPayload } from './context-post-tool';

// ─── Pi → Claude payload normalization (task 0969 R1) ─────────────────────

/** Pi tool name → the Claude tool name the shared core records. */
const PI_TO_CLAUDE: Record<string, string> = {
    read: 'Read',
    write: 'Write',
    edit: 'Edit',
    bash: 'Bash',
    grep: 'Grep',
    find: 'Glob',
};

/** Join the text parts of a Pi tool_result `content` payload. */
function piContentText(content: unknown): string {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    const parts: string[] = [];
    for (const part of content) {
        if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
            parts.push((part as { text: string }).text);
        }
    }
    return parts.join('\n');
}

/**
 * Pure Pi-event → Claude-{@link ToolPayload} adapter. An unmapped tool returns null so the
 * shared core writes no row (R1's row filter). Search tools keep `path` (never `file_path`)
 * because the core treats `file_path` as the written file, not a search root.
 */
export function normalizePiToolEvent(
    toolName: string,
    input: Record<string, unknown> | undefined,
    content?: unknown,
): ToolPayload | null {
    const mapped = PI_TO_CLAUDE[toolName];
    if (mapped === undefined) return null;
    const i = input ?? {};
    const str = (value: unknown): string => (typeof value === 'string' ? value : '');
    const path = str(i.path) || str(i.file_path);
    const text = piContentText(content);
    const tool_response = text.length > 0 ? { content: text } : undefined;

    switch (mapped) {
        case 'Read':
            return { tool_name: mapped, tool_input: { file_path: path }, tool_response };
        case 'Write':
            return { tool_name: mapped, tool_input: { file_path: path, content: str(i.content) }, tool_response };
        case 'Edit': {
            const edits = Array.isArray(i.edits) ? (i.edits as Array<Record<string, unknown>>) : [];
            return {
                tool_name: mapped,
                tool_input: {
                    file_path: path,
                    old_string: edits.map((e) => str(e.oldText)).join(''),
                    new_string: edits.map((e) => str(e.newText)).join(''),
                },
                tool_response,
            };
        }
        case 'Grep':
            return {
                tool_name: mapped,
                tool_input: {
                    pattern: str(i.pattern),
                    ...(path ? { path } : {}),
                    ...(str(i.glob) ? { glob: str(i.glob) } : {}),
                },
                tool_response,
            };
        case 'Glob':
            return {
                tool_name: mapped,
                tool_input: { pattern: str(i.pattern), ...(path ? { path } : {}) },
                tool_response,
            };
        case 'Bash':
            return { tool_name: mapped, tool_input: { command: str(i.command) }, tool_response };
        default:
            return null;
    }
}
