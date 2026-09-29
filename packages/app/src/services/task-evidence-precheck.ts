/**
 * Task evidence-channel precheck (1002 R2 — the former pipeline precheck script, now
 * folded into `task check --precheck`).
 *
 * Parses the task content for an exact `evidence-channel:` declaration and proves the
 * declared live-data channel exists in the local spur database before implementation
 * begins. Exactly one channel is allowlisted:
 *
 *   evidence-channel: history_tool_call.args_raw[pi]
 *
 * …satisfied only when the fixed count over `history_tool_call`
 * (`args_raw IS NOT NULL AND source = 'pi'`, owned by the domain reader
 * `countToolCallArgsRaw`) returns a positive number. Unknown declarations, a
 * missing database/table (deps report `null`), and a zero count all fail closed.
 *
 * A task without any `evidence-channel:` declaration passes without touching the
 * deps — the check only gates tasks that declare a live-data evidence channel.
 * Pure function; no I/O and no SQLite import here (R3: domain is the sole ts-db
 * consumer — the caller injects the count).
 */

import { countToolCallArgsRaw } from '@gobing-ai/spur-domain';

/** The only allowlisted live-data channel (0726 R2 / 1002 R2). */
export const ALLOWED_EVIDENCE_CHANNELS = ['history_tool_call.args_raw[pi]'] as const;

/** Result of evaluating a task's evidence-channel declarations. */
export interface TaskEvidenceReport {
    /** True when no declaration exists or the declared channel is verified live. */
    ok: boolean;
    /** Human-readable fail-closed reasons when !ok. */
    reasons: string[];
}

/** Injected DB counter (1002 R3). `null` = missing DB/table → fail closed. */
export interface TaskEvidenceDeps {
    countArgsRaw(source: string): Promise<number | null>;
}

/** Extract every `evidence-channel:` token from task content, in declaration order. */
export function parseEvidenceChannels(content: string): string[] {
    const channels: string[] = [];
    for (const match of content.matchAll(/evidence-channel:\s*(\S+)/g)) {
        channels.push(match[1] ?? '');
    }
    return channels;
}

/**
 * Evaluate a task's evidence-channel declarations against the allowlist and the live
 * DB count. Async because the injected counter goes through the async domain reader.
 */
export async function evaluateTaskEvidence(content: string, deps: TaskEvidenceDeps): Promise<TaskEvidenceReport> {
    const declarations = parseEvidenceChannels(content);
    const unknown = declarations.filter((d) => !(ALLOWED_EVIDENCE_CHANNELS as readonly string[]).includes(d));
    if (unknown.length > 0) {
        return {
            ok: false,
            reasons: [
                `unknown evidence-channel declaration(s): ${unknown.join(', ')}`,
                `allowlisted declaration: evidence-channel: ${ALLOWED_EVIDENCE_CHANNELS[0] ?? ''}`,
            ],
        };
    }
    if (declarations.length === 0) {
        return { ok: true, reasons: [] };
    }

    // A repeated exact declaration still gates the single fixed query; the only
    // allowlisted channel names its source in the `[pi]` suffix.
    const channel = declarations[0] ?? '';
    const source = /\[([a-z0-9-]+)\]$/.exec(channel)?.[1] ?? '';

    let count: number | null;
    try {
        count = await deps.countArgsRaw(source);
    } catch {
        count = null; // counter failure is a missing/unreadable DB → fail closed
    }
    if (count === null) {
        return {
            ok: false,
            reasons: [
                `local spur database or history_tool_call table missing/unreadable for source '${source}' — run a real history import first`,
            ],
        };
    }
    if (!(count > 0)) {
        return {
            ok: false,
            reasons: [
                `0 live ${source} rows with args_raw — run a non-dry-run ${source} history import with a safe importer before implementing`,
            ],
        };
    }
    return { ok: true, reasons: [] };
}

/** CLI wiring helper (1002 R3): bridge the async domain reader into deps. */
export function makeTaskEvidenceDeps(
    db: Parameters<typeof countToolCallArgsRaw>[0],
    /** Wrap reader errors as `null` so a missing DB/table fails closed instead of throwing. */
    read: (db: Parameters<typeof countToolCallArgsRaw>[0], source: string) => Promise<number> = countToolCallArgsRaw,
): TaskEvidenceDeps {
    return {
        countArgsRaw: async (source) => {
            try {
                return await read(db, source);
            } catch {
                return null;
            }
        },
    };
}
