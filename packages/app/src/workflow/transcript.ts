/**
 * Host-transcript adapter for the measured execution summary: resolve the active transcript path
 * from the environment, detect the host row format, and parse raw JSONL lines into timestamped rows
 * (Claude Code / pi JSONL, read-only). The pure measurement lives in `./run-summary.ts`.
 *
 * Script-absorption PR-4 moved this adapter out of `plugins/sp/lib/transcript.ts`; PR-6 retired
 * the plugin copy with its last consumers (now `spur workflow summary` / `spur history timeline`).
 */
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Row } from './run-summary';

const SESSION_ID = /^[A-Za-z0-9_-]+$/;
/** pi roles that prove a `type:"message"` row is a pi transcript, not Claude's `user`/`assistant`. */
const PI_ROLES = new Set(['user', 'assistant', 'toolResult']);

/** First row matching a known shape decides: `type:"message"` with a pi role → pi, else Claude. */
export function sniffTranscriptFormat(rows: Row[]): 'claude' | 'pi' | 'unknown' {
    for (const row of rows) {
        if (row.type === 'message' && PI_ROLES.has(row.message?.role ?? '')) return 'pi';
        if (row.type === 'user' || row.type === 'assistant') return 'claude';
    }
    return 'unknown';
}

/** Timestamped rows in file order; malformed lines counted, timestamp-less rows dropped. */
export function parseTranscriptRows(lines: string[]): {
    rows: [Row, number][];
    skippedLines: number;
    format: 'claude' | 'pi' | 'unknown';
} {
    const rows: [Row, number][] = [];
    let skippedLines = 0;
    for (const line of lines) {
        if (!line.trim()) continue;
        let row: Row;
        try {
            row = JSON.parse(line) as Row;
        } catch {
            skippedLines++;
            continue;
        }
        const ts = row.timestamp ? Date.parse(row.timestamp) : Number.NaN;
        if (!Number.isNaN(ts)) rows.push([row, ts]);
    }
    return { rows, skippedLines, format: sniffTranscriptFormat(rows.map(([r]) => r)) };
}

/** A resolved transcript path, or the reason none resolved. */
export type ResolvedTranscript = { ok: true; path: string } | { ok: false; reason: string };

/**
 * Resolution order: explicit override → `CLAUDE_CODE_SESSION_ID` under `projectsRoot` →
 * `PI_SESSION_FILE` (1138 R1). `PI_SESSION_ID` is never used for lookup: pi's filename embeds a
 * timestamp, so the path is not derivable from the id.
 */
export function resolveTranscript(
    env: Record<string, string | undefined>,
    projectsRoot = join(homedir(), '.claude', 'projects'),
    override?: string,
): ResolvedTranscript {
    if (override) return existsSync(override) ? { ok: true, path: override } : { ok: false, reason: 'no transcript' };
    const id = env.CLAUDE_CODE_SESSION_ID;
    if (!id) {
        const piFile = env.PI_SESSION_FILE;
        if (piFile !== undefined && piFile !== '') {
            return existsSync(piFile)
                ? { ok: true, path: piFile }
                : { ok: false, reason: `PI_SESSION_FILE ${piFile} does not exist` };
        }
        return {
            ok: false,
            reason:
                'no host session id; pass --transcript <path> (pi: ~/.pi/agent/sessions/<cwd-slug>/<file>.jsonl, ' +
                'or set PI_SESSION_FILE)',
        };
    }
    if (!SESSION_ID.test(id)) return { ok: false, reason: 'refusing a session id with path characters' };
    if (!existsSync(projectsRoot)) return { ok: false, reason: `no transcript root ${projectsRoot}` };
    for (const dir of readdirSync(projectsRoot)) {
        const path = join(projectsRoot, dir, `${id}.jsonl`);
        if (existsSync(path)) return { ok: true, path };
    }
    return { ok: false, reason: `no transcript for session ${id}` };
}
