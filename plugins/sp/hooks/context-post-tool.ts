#!/usr/bin/env bun

/**
 * context-post-tool — PostToolUse hook for indexed-context
 * (matcher: Bash|Grep|Glob|Read|Write|Edit — task 0248).
 *
 * Appends one event line to `token-ledger.jsonl` per tool call: path and/or short
 * summary, action, and token estimate. Reads session ID (+ optional agent/model)
 * from `.spur/context/.session.json`.
 *
 * Token cascade (task 0246): tool_response.content → Write tool_input.content →
 * Edit old/new strings → Read file stat → omit tokens (never store 0 for unknown).
 *
 * Redaction (task 0248): store summary only (never full stdout); cap text ~4 KiB;
 * strip obvious secret patterns. Bash tokens estimate from capped stdout/stderr length.
 *
 * **Fail-open contract:** every error path exits 0 with no output.
 *
 * Self-contained by design (task 0232/0246/0248). Installed hook configs use
 * `superskill hook run sp context-post-tool`.
 */

import { execSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

/** Tools recorded by this hook (must match hooks.json PostToolUse matcher). */
export const ALLOWED_TOOLS = new Set(['Bash', 'Grep', 'Glob', 'Read', 'Write', 'Edit']);

/** Max stored summary / token-estimate input size (bytes). Task 0248 ~2–4 KiB. */
export const REDACTION_CAP_BYTES = 4096;

/** Max command/pattern summary length before ellipsis (chars). */
export const SUMMARY_MAX_CHARS = 200;

interface ToolPayload {
    session_id?: string;
    tool_name?: string;
    tool_input?: {
        file_path?: string;
        content?: string;
        old_string?: string;
        new_string?: string;
        /** Bash */
        command?: string;
        /** Grep / Glob (Claude Code shapes vary) */
        pattern?: string;
        glob_pattern?: string;
        glob?: string;
        path?: string;
    };
    tool_response?: {
        content?: string | unknown;
        filePath?: string;
        stdout?: string;
        stderr?: string;
    };
}

interface SessionFile {
    session?: string;
    agent?: string;
    model?: string;
}

/** Estimate tokens from raw byte count: Math.ceil(bytes / 4). */
export function estimateTokens(text: string): number {
    return Math.ceil(new TextEncoder().encode(text).length / 4);
}

/** Scrub secret-like patterns without size capping. */
export function scrubSecrets(text: string): string {
    let s = text;
    // Bearer / API key prefixes first (before generic key=value)
    s = s.replace(/\bBearer\s+[A-Za-z0-9._\-+=/]+/gi, 'Bearer ***');
    // `sk-` keys. Segments may be hyphen-separated (`sk-ant-api03-…`), so match the
    // whole run rather than a single alphanumeric block — anchoring on `[A-Za-z0-9]{8,}`
    // alone stopped at the first hyphen and let every Anthropic key through, which is
    // the most likely secret to appear in a Claude-agent harness.
    s = s.replace(/\bsk-[A-Za-z0-9_-]{8,}/g, 'sk-***');
    s = s.replace(/\bAKIA[0-9A-Z]{16}\b/g, 'AKIA***');
    // Provider token prefixes with a fixed, unambiguous shape.
    s = s.replace(/\bgithub_pat_[A-Za-z0-9_]{20,}/g, 'github_pat_***');
    s = s.replace(/\bgh[pousr]_[A-Za-z0-9]{20,}/g, (m) => `${m.slice(0, 4)}***`);
    // Key=value style secrets (value = rest of non-space token). The key may carry a
    // prefix (`ANTHROPIC_API_KEY`, `GITHUB_TOKEN`): `_` is a word character, so a
    // leading `\b` would not match there and every namespaced env var leaked. Allow an
    // optional `WORD_`-style prefix instead of requiring a boundary.
    // The whole key (prefix included) is captured so the ledger still says *which*
    // variable was scrubbed — `ANTHROPIC_API_KEY=***`, not a bare `API_KEY=***`.
    s = s.replace(
        /\b((?:[A-Za-z0-9]+[_-])*(?:api[_-]?key|password|passwd|secret|token|access[_-]?key|private[_-]?key))\s*[:=]\s*\S+/gi,
        '$1=***',
    );
    // Authorization: <scheme> <credentials...>
    s = s.replace(/\bAuthorization\s*:\s*\S+(?:\s+\S+)*/gi, 'Authorization: ***');
    // PEM private key blocks — redact the payload, keep the header as a marker.
    s = s.replace(
        /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z ]+ )?PRIVATE KEY-----|$)/g,
        '[private-key-redacted]',
    );
    // Collapse long base64 only when + / or = present (avoid pure a-z body blobs)
    s = s.replace(/\b[A-Za-z0-9+/]{80,}={0,2}\b/g, (m) => (/[+/=]/.test(m) ? '[base64-redacted]' : m));
    return s;
}

/**
 * Cap text to {@link REDACTION_CAP_BYTES} and scrub obvious secret patterns.
 * Used for any stored summary fragments — never full env dumps.
 */
export function redactText(text: string, capBytes: number = REDACTION_CAP_BYTES): string {
    const s = scrubSecrets(text);
    const bytes = new TextEncoder().encode(s);
    if (bytes.length <= capBytes) return s;
    // Truncate on byte boundary then append marker
    let end = capBytes;
    while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
    return `${new TextDecoder().decode(bytes.subarray(0, end))}…[truncated]`;
}

/** Byte length after scrub + hard cap (no truncation marker) — for token estimates. */
export function cappedByteLength(text: string, capBytes: number = REDACTION_CAP_BYTES): number {
    const scrubbed = scrubSecrets(text);
    return Math.min(new TextEncoder().encode(scrubbed).length, capBytes);
}

/** Truncate a one-line summary for the ledger (after light redaction). */
export function truncateSummary(text: string, maxChars: number = SUMMARY_MAX_CHARS): string {
    const cleaned = redactText(text.replace(/\s+/g, ' ').trim(), REDACTION_CAP_BYTES);
    if (cleaned.length <= maxChars) return cleaned;
    return `${cleaned.slice(0, Math.max(0, maxChars - 1))}…`;
}

/**
 * Map platform tool name → ledger `type` (task 0248 R2).
 * Edit stays `write` with action=edit (0245/0246 convention).
 */
export function mapToolType(toolName: string): string {
    switch (toolName) {
        case 'Read':
            return 'read';
        case 'Write':
        case 'Edit':
            return 'write';
        case 'Bash':
            return 'bash';
        case 'Grep':
            return 'grep';
        case 'Glob':
            return 'glob';
        default:
            return toolName.toLowerCase();
    }
}

/**
 * Short summary for Bash/Grep/Glob (command truncated, pattern, path glob).
 * Not full stdout. Returns undefined when nothing useful to store.
 */
export function buildToolSummary(toolName: string, toolInput: ToolPayload['tool_input']): string | undefined {
    if (!toolInput) return undefined;
    if (toolName === 'Bash') {
        const cmd = typeof toolInput.command === 'string' ? toolInput.command : '';
        if (!cmd.trim()) return undefined;
        return truncateSummary(cmd);
    }
    if (toolName === 'Grep') {
        const pattern = typeof toolInput.pattern === 'string' ? toolInput.pattern : '';
        const path = typeof toolInput.path === 'string' ? toolInput.path : '';
        const glob =
            (typeof toolInput.glob === 'string' && toolInput.glob) ||
            (typeof toolInput.glob_pattern === 'string' && toolInput.glob_pattern) ||
            '';
        const parts = [pattern && `/${pattern}/`, path, glob].filter(Boolean);
        if (parts.length === 0) return undefined;
        return truncateSummary(parts.join(' '));
    }
    if (toolName === 'Glob') {
        const pattern =
            (typeof toolInput.pattern === 'string' && toolInput.pattern) ||
            (typeof toolInput.glob_pattern === 'string' && toolInput.glob_pattern) ||
            (typeof toolInput.glob === 'string' && toolInput.glob) ||
            '';
        const path = typeof toolInput.path === 'string' ? toolInput.path : '';
        const parts = [pattern, path].filter(Boolean);
        if (parts.length === 0) return undefined;
        return truncateSummary(parts.join(' in '));
    }
    return undefined;
}

/** Response text used only for size/token estimate — never written to the ledger. */
function responseTextForEstimate(toolResponse: ToolPayload['tool_response']): string {
    if (!toolResponse) return '';
    const parts: string[] = [];
    if (typeof toolResponse.content === 'string') parts.push(toolResponse.content);
    if (typeof toolResponse.stdout === 'string') parts.push(toolResponse.stdout);
    if (typeof toolResponse.stderr === 'string') parts.push(toolResponse.stderr);
    return parts.join('\n');
}

/**
 * Token cascade (tasks 0246 / 0248). Returns undefined when unknown — callers omit
 * the field rather than writing tokens: 0.
 *
 * Bash: capped stdout/stderr length. Grep/Glob: capped result size or undefined.
 */
export function resolveTokenEstimate(
    toolName: string,
    toolInput: ToolPayload['tool_input'],
    toolResponse: ToolPayload['tool_response'],
): number | undefined {
    // Bash: estimate from capped response only (never uncapped multi-MB stdout).
    if (toolName === 'Bash') {
        const raw = responseTextForEstimate(toolResponse);
        if (raw.length === 0) return undefined;
        return Math.ceil(cappedByteLength(raw) / 4);
    }

    // Grep / Glob: result size after cap, or omit when empty.
    if (toolName === 'Grep' || toolName === 'Glob') {
        const raw = responseTextForEstimate(toolResponse);
        if (raw.length === 0) return undefined;
        return Math.ceil(cappedByteLength(raw) / 4);
    }

    const responseContent = toolResponse?.content;
    if (typeof responseContent === 'string' && responseContent.length > 0) {
        return estimateTokens(responseContent);
    }
    if (toolName === 'Write' && typeof toolInput?.content === 'string' && toolInput.content.length > 0) {
        return estimateTokens(toolInput.content);
    }
    if (toolName === 'Edit') {
        const parts = [toolInput?.old_string ?? '', toolInput?.new_string ?? ''].join('');
        if (parts.length > 0) return estimateTokens(parts);
    }
    if (toolName === 'Read' && typeof toolInput?.file_path === 'string' && toolInput.file_path) {
        try {
            if (existsSync(toolInput.file_path)) {
                const size = statSync(toolInput.file_path).size;
                if (size > 0) return Math.ceil(size / 4);
            }
        } catch {
            /* fail-open: skip stat */
        }
    }
    return undefined;
}

function readSessionFile(dir: string): SessionFile {
    const sessionFile = join(dir, '.session.json');
    if (!existsSync(sessionFile)) return {};
    try {
        return JSON.parse(readFileSync(sessionFile, 'utf-8')) as SessionFile;
    } catch {
        return {};
    }
}

/**
 * Core record path (testable). Returns the written event, or null when nothing was logged
 * (unknown tool, missing session, missing path/summary, I/O failure).
 */
export function recordToolUseEvent(
    contextDir: string,
    payload: ToolPayload,
    now: () => Date = () => new Date(),
): Record<string, unknown> | null {
    const toolName = payload.tool_name ?? '';
    if (!ALLOWED_TOOLS.has(toolName)) return null;

    const filePath = payload.tool_input?.file_path ?? '';
    const summary = buildToolSummary(toolName, payload.tool_input);

    // Read/Write/Edit still require a path; Bash/Grep/Glob require a short summary.
    if (toolName === 'Read' || toolName === 'Write' || toolName === 'Edit') {
        if (!filePath) return null;
    } else if (!summary) {
        return null;
    }

    const sessionMeta = readSessionFile(contextDir);
    const session = sessionMeta.session ?? '';
    if (!session) return null;

    // Freshness stamp (task 0711 R4): the indexed-context producer is the agent
    // following the skill's update guidance; the observable producer moment in
    // code is a Write/Edit landing on a `.spur/context/*.md` file. Each such
    // write refreshes `.freshness.json` so staleness checks can compare the
    // sidecar's source commit against HEAD until the next regeneration.
    if ((toolName === 'Write' || toolName === 'Edit') && isContextIndexFile(contextDir, filePath)) {
        stampContextFreshness(contextDir, currentHeadCommit(), now());
    }

    const tokens = resolveTokenEstimate(toolName, payload.tool_input, payload.tool_response);
    const ts = now().toISOString();
    const type = mapToolType(toolName);
    const action = toolName === 'Write' ? 'create' : toolName === 'Edit' ? 'edit' : undefined;

    const event: Record<string, unknown> = { ts, session, type };
    if (filePath) event.file = filePath;
    if (summary) event.summary = summary;
    if (tokens !== undefined) event.tokens = tokens;
    if (action) event.action = action;

    // Best-effort identity fields — never block logging.
    if (typeof payload.session_id === 'string' && payload.session_id) {
        event.sessionId = payload.session_id;
    }
    if (typeof sessionMeta.agent === 'string' && sessionMeta.agent) event.agent = sessionMeta.agent;
    if (typeof sessionMeta.model === 'string' && sessionMeta.model) event.model = sessionMeta.model;

    try {
        appendFileSync(join(contextDir, 'token-ledger.jsonl'), `${JSON.stringify(event)}\n`);
    } catch {
        return null;
    }

    return event;
}

// ─── Context freshness sidecar (task 0711 R4) ───────────────────────────

export interface ContextFreshness {
    schema_version: number;
    source_commit: string;
    generated_at: string;
}

export const CONTEXT_FRESHNESS_SCHEMA_VERSION = 1;

/** True when `filePath` is a regenerated context index inside `contextDir` (not the sidecars). */
export function isContextIndexFile(contextDir: string, filePath: string): boolean {
    const resolvedDir = resolve(contextDir);
    const resolvedFile = resolve(filePath);
    if (!resolvedFile.startsWith(resolvedDir + sep)) return false;
    const name = resolvedFile.slice(resolvedDir.length + 1);
    return name.endsWith('.md');
}

/** Current HEAD, best-effort — null when git is unavailable or the dir is not a work tree. */
export function currentHeadCommit(): string | null {
    try {
        const out = execSync('git rev-parse HEAD', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
        const commit = out.trim();
        return commit.length > 0 ? commit : null;
    } catch {
        return null;
    }
}

/**
 * Write/refresh `.spur/context/.freshness.json`. Best-effort: any I/O failure
 * leaves the previous sidecar (or none) in place — the hook contract is
 * fail-open, never blocking.
 */
export function stampContextFreshness(contextDir: string, sourceCommit: string | null, at: Date): void {
    if (!sourceCommit) return;
    const body: ContextFreshness = {
        schema_version: CONTEXT_FRESHNESS_SCHEMA_VERSION,
        source_commit: sourceCommit,
        generated_at: at.toISOString(),
    };
    try {
        writeFileSync(join(contextDir, '.freshness.json'), JSON.stringify(body));
    } catch {
        /* fail-open */
    }
}

export interface ContextFreshnessCheck {
    stale: boolean;
    reason?: string;
}

/**
 * Compare a freshness sidecar against the current HEAD (task 0711 R4). A
 * missing/unparsable sidecar is stale (`never stamped`); a commit mismatch is
 * stale until the producer regenerates the index.
 */
export function checkContextFreshness(raw: string | null, headCommit: string | null): ContextFreshnessCheck {
    if (raw === null) return { stale: true, reason: 'never stamped' };
    let body: ContextFreshness;
    try {
        body = JSON.parse(raw) as ContextFreshness;
    } catch {
        return { stale: true, reason: 'malformed sidecar' };
    }
    if (body.schema_version !== CONTEXT_FRESHNESS_SCHEMA_VERSION) {
        return { stale: true, reason: `schema_version ${String(body.schema_version)}` };
    }
    if (typeof body.source_commit !== 'string' || body.source_commit === '') {
        return { stale: true, reason: 'missing source_commit' };
    }
    if (headCommit !== null && body.source_commit !== headCommit) {
        return { stale: true, reason: 'source commit changed since generation' };
    }
    return { stale: false };
}

/** Read the freshness sidecar, or null when absent/unreadable. */
export function readContextFreshness(contextDir: string): string | null {
    try {
        return readFileSync(join(contextDir, '.freshness.json'), 'utf-8');
    } catch {
        return null;
    }
}

// Entrypoint — thin wrapper; logic lives in {@link recordToolUseEvent} for unit coverage.
if (import.meta.main) {
    void (async () => {
        const dir = join(process.env.CLAUDE_PROJECT_DIR ?? process.cwd(), '.spur', 'context');
        try {
            const stdinText = await Bun.stdin.text();
            const payload = JSON.parse(stdinText) as ToolPayload;
            recordToolUseEvent(dir, payload);
        } catch {
            /* fail-open: malformed stdin / I/O */
        }
        process.exit(0);
    })();
}
