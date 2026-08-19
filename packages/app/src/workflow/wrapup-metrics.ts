import { resolve } from 'node:path';
import {
    createNodeFileSystem,
    type FileSystem,
    NodeProcessExecutor,
    type ProcessExecutor,
} from '@gobing-ai/ts-runtime';

/**
 * Parse the wrap-up `tasks` var into WBS identifiers.
 * Accepts a JSON array, a JSON-encoded array string, or a comma/whitespace list.
 *
 * @param raw - Workflow `tasks` env value.
 * @returns Deduplicated WBS strings, empty when none can be parsed.
 */
export function parseWrapupTaskWbs(raw: string): string[] {
    const trimmed = raw.trim();
    if (trimmed === '') return [];

    let parsed: unknown = trimmed;
    try {
        parsed = JSON.parse(trimmed) as unknown;
    } catch {
        return uniqueWbs(trimmed.split(/[\s,]+/));
    }

    if (typeof parsed === 'string') {
        const inner = parsed.trim();
        if (inner === '') return [];
        try {
            parsed = JSON.parse(inner) as unknown;
        } catch {
            return uniqueWbs(inner.split(/[\s,]+/));
        }
    }

    if (Array.isArray(parsed)) {
        return uniqueWbs(parsed.filter((entry): entry is string => typeof entry === 'string'));
    }
    return [];
}

function uniqueWbs(values: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const value of values) {
        const wbs = value.trim();
        if (wbs === '' || seen.has(wbs)) continue;
        seen.add(wbs);
        out.push(wbs);
    }
    return out;
}

/**
 * Options for appending wrap-up metrics rows.
 */
export interface AppendWrapupMetricsOptions {
    /** Project root. */
    projectRoot?: string;
    /** Raw `tasks` var (JSON array or encoded array string). */
    tasksRaw: string;
    /** Spur binary used for `task show`. */
    spurBin?: string;
    /** File system. */
    fileSystem?: FileSystem;
    /** Process executor. */
    processExecutor?: ProcessExecutor;
    /** Clock used for the timestamp field. */
    now?: () => string;
}

/**
 * Result of a wrap-up metrics append.
 */
export interface AppendWrapupMetricsResult {
    /** Whether every parsed WBS produced a row. */
    ok: boolean;
    /** WBS identifiers that received a row. */
    written: string[];
    /** Destination path. */
    path: string;
}

/**
 * Append one JSONL metrics row per task to `.spur/memory/wrapup-metrics.jsonl`.
 * Missing task show output skips that WBS without failing the wrap-up hop.
 *
 * @param options - Append options.
 * @returns Append result.
 */
export async function appendWrapupMetrics(options: AppendWrapupMetricsOptions): Promise<AppendWrapupMetricsResult> {
    const root = options.projectRoot ?? process.cwd();
    const fs = options.fileSystem ?? createNodeFileSystem();
    const executor = options.processExecutor ?? new NodeProcessExecutor();
    const spurBin = options.spurBin ?? 'spur';
    const now = options.now ?? (() => new Date().toISOString());
    const memoryDir = resolve(root, '.spur', 'memory');
    const path = resolve(memoryDir, 'wrapup-metrics.jsonl');
    const wbsList = parseWrapupTaskWbs(options.tasksRaw);
    const written: string[] = [];

    await fs.ensureDir(memoryDir);

    for (const wbs of wbsList) {
        const shown = await executor.run({
            command: spurBin,
            args: ['task', 'show', wbs, '--json'],
            cwd: root,
            forceBuffered: true,
            rejectOnError: false,
        });
        if (shown.exitCode !== 0 || shown.stdout.trim() === '') continue;

        let featureId = '';
        let status = 'unknown';
        try {
            const body = JSON.parse(shown.stdout) as {
                feature_id?: string;
                status?: string;
                frontmatter?: { feature_id?: string; status?: string };
            };
            featureId = body.frontmatter?.feature_id ?? body.feature_id ?? '';
            status = body.frontmatter?.status ?? body.status ?? 'unknown';
        } catch {
            continue;
        }

        let verdict = 'UNKNOWN';
        const verdictPath = resolve(root, '.spur', 'run', `${wbs}-verdict.json`);
        if (await fs.exists(verdictPath)) {
            try {
                const verdictBody = JSON.parse(await fs.readFile(verdictPath)) as { verdict?: string };
                if (typeof verdictBody.verdict === 'string' && verdictBody.verdict !== '') {
                    verdict = verdictBody.verdict;
                }
            } catch {
                verdict = 'UNKNOWN';
            }
        }

        const row = JSON.stringify({
            wbs,
            feature_id: featureId,
            status,
            verdict,
            timestamp: now(),
        });
        const existing = (await fs.exists(path)) ? await fs.readFile(path) : '';
        await fs.writeFile(
            path,
            existing === '' ? `${row}\n` : `${existing}${existing.endsWith('\n') ? '' : '\n'}${row}\n`,
        );
        written.push(wbs);
    }

    return { ok: true, written, path };
}
