import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runStoragePaths } from './run-storage';

// Extracted from `inline-run-setup.ts`: workflow actions (proof-fingerprint, agent-run,
// run-artifact, action-trace) append run-record lines without importing the whole inline-run
// service, which imports the workflow service → builtins → those actions (an import cycle).

/**
 * The run-record file for appended driver lines (task 0927 R1): the durable `<run-id>.md`
 * under `.spur/memory/runs/` for pair-based runs. A legacy run that predates the pair keeps
 * appending to its declared legacy `<run-id>.log` — the same precedence as
 * `readWorkflowRunRecord` (the pair wins, legacy stays readable in place).
 */
export function inlineRunRecordLogPath(runDir: string, runId: string): string {
    const markdownPath = join(runDir, `${runId}.md`);
    const legacyLogPath = join(runDir, `${runId}.log`);
    if (existsSync(legacyLogPath) && !existsSync(markdownPath)) return legacyLogPath;
    return markdownPath;
}

/**
 * Append one emission-failure/provenance line to the run record — the durable
 * `.spur/memory/runs/<run-id>.md` (1026 R1), the run log the inline driver already
 * owns. Best-effort and synchronous (the process may
 * exit immediately after), and never throws: an unwritable log must not wedge the run
 * (ADR-117 R3).
 */
export function appendInlineRunLogLine(runId: string, detail: string, workdir?: string): void {
    try {
        const runDir = runStoragePaths(workdir ?? process.cwd()).recordsDir;
        if (!existsSync(runDir)) mkdirSync(runDir, { recursive: true });
        const safeRunId = runId.replace(/[^A-Za-z0-9._-]/g, '_');
        const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
        appendFileSync(inlineRunRecordLogPath(runDir, safeRunId), `[${stamp}] ${detail}\n`);
    } catch {
        // Best-effort (R3): the run continues even when the failure cannot be recorded.
    }
}
