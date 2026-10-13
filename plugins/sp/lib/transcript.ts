/**
 * Host-transcript adapter shared by session-timeline (session review) and run-summary (dev-run /
 * dev-runall execution summary). Owns the host side: resolving the active transcript path from the
 * environment, detecting the host row format, and parsing raw JSONL lines into timestamped rows.
 * Reads Claude Code / pi JSONL rows read-only. Node builtins only.
 *
 * Task 1178 R2: the pure measurement (row/token/actor aggregation and its normalized types) lives
 * in `packages/app/src/workflow/run-summary.ts` and is reached through the generated pure
 * plan-projection entry. Normalize once here (`parseRows`) and hand the rows to that owner; the
 * re-exports below keep the plugin's one import path for the whole surface.
 */
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Row } from './plan-projection.generated.mjs';

export {
    type Acc,
    type ActorSplit,
    accumulate,
    actorSplit,
    type Block,
    buildRunSummary,
    formatDuration,
    formatTokenSplit,
    formatTokens,
    type GateTime,
    isCompaction,
    newAcc,
    type Progress,
    promptText,
    type Row,
    type RunSummary,
    type Span,
    type SummaryRow,
    skillInvocationPrompt,
    sumSpans,
    sumTokens,
    type Tokens,
    zeroTokens,
} from './plan-projection.generated.mjs';

const SESSION_ID = /^[A-Za-z0-9_-]+$/;
/** pi roles that prove a `type:"message"` row is a pi transcript, not Claude's `user`/`assistant`. */
const PI_ROLES = new Set(['user', 'assistant', 'toolResult']);

/** First row matching a known shape decides: `type:"message"` with a pi role → pi, else Claude. */
export function sniffFormat(rows: Row[]): 'claude' | 'pi' | 'unknown' {
    for (const row of rows) {
        if (row.type === 'message' && PI_ROLES.has(row.message?.role ?? '')) return 'pi';
        if (row.type === 'user' || row.type === 'assistant') return 'claude';
    }
    return 'unknown';
}

/** Timestamped rows in file order; malformed lines counted, timestamp-less rows dropped. */
export function parseRows(lines: string[]): {
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
    return { rows, skippedLines, format: sniffFormat(rows.map(([r]) => r)) };
}

export type Resolved = { ok: true; path: string } | { ok: false; reason: string };

export function resolveTranscript(
    env: Record<string, string | undefined>,
    projectsRoot = join(homedir(), '.claude', 'projects'),
    override?: string,
): Resolved {
    if (override) return existsSync(override) ? { ok: true, path: override } : { ok: false, reason: 'no transcript' };
    const id = env.CLAUDE_CODE_SESSION_ID;
    if (!id) {
        // 1138 R1: pi exports PI_SESSION_FILE (an exact path) and no Claude session id. Order is
        // explicit override → Claude id → PI_SESSION_FILE; PI_SESSION_ID is never used for lookup
        // because pi's filename embeds a timestamp, so the path is not derivable from the id.
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
