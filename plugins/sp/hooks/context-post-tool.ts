#!/usr/bin/env bun
/**
 * context-post-tool — PostToolUse hook for indexed-context (matcher: Read|Write|Edit).
 *
 * Appends one event line to `token-ledger.jsonl` per tool call: file path, action, and token
 * estimate (`Math.ceil(bytes / 4)`). Reads session ID from `.spur/context/.session.json`.
 *
 * **Fail-open contract:** every error path — unparseable payload, wrong tool, missing
 * `.spur/context/`, missing `.session.json`, write failure — exits 0 with no output.
 *
 * Self-contained by design (task 0232). Installed hook configs use the portable
 * `superskill hook run sp context-post-tool` entrypoint.
 */

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

interface ToolPayload {
    tool_name?: string;
    tool_input?: { file_path?: string };
    tool_response?: { content?: string };
}

function exitOk(): never {
    process.exit(0);
}

/** Estimate tokens from raw byte count: Math.ceil(bytes / 4). Portable, no file-type heuristic. */
function estimateTokens(text: string): number {
    return Math.ceil(new TextEncoder().encode(text).length / 4);
}

function readSessionId(dir: string): string {
    const sessionFile = join(dir, '.session.json');
    if (!existsSync(sessionFile)) return '';
    try {
        const data = JSON.parse(readFileSync(sessionFile, 'utf-8')) as { session?: string };
        return data.session ?? '';
    } catch {
        return '';
    }
}

async function main(): Promise<void> {
    const dir = join(process.env.CLAUDE_PROJECT_DIR ?? process.cwd(), '.spur', 'context');

    const stdinText = await Bun.stdin.text();
    let payload: ToolPayload;
    try {
        payload = JSON.parse(stdinText) as ToolPayload;
    } catch {
        exitOk();
    }

    const toolName = payload.tool_name ?? '';
    if (toolName !== 'Read' && toolName !== 'Write' && toolName !== 'Edit') exitOk();

    const filePath = payload.tool_input?.file_path ?? '';
    if (!filePath) exitOk();

    const session = readSessionId(dir);
    if (!session) exitOk();

    const content = payload.tool_response?.content ?? '';
    const tokens = content ? estimateTokens(content) : 0;
    const ts = new Date().toISOString();
    const type = toolName === 'Read' ? 'read' : 'write';
    const action = toolName === 'Read' ? undefined : toolName === 'Write' ? 'create' : 'edit';

    const event: Record<string, unknown> = { ts, session, type, file: filePath, tokens };
    if (action) event.action = action;

    try {
        appendFileSync(join(dir, 'token-ledger.jsonl'), `${JSON.stringify(event)}\n`);
    } catch {
        exitOk();
    }

    exitOk();
}

void main().catch(exitOk);
