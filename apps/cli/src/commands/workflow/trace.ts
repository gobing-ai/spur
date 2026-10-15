import { closeSync, fstatSync, openSync, readFileSync, readSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Command } from '@commander-js/extra-typings';
import {
    readWorkflowRunRecord,
    resolveRunRecordDir,
    type TimelineEvent,
    type WorkflowAppService,
    type WorkflowRunRecordRead,
    type WorkflowTraceListResult,
    type WorkflowTraceTimeline,
} from '@gobing-ai/spur-app';
import type { ActionCost } from '@gobing-ai/spur-domain';
import type { CliContext } from '../../context';
import { toEnvelopeJson, writeJsonError } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';
import { makeWorkflowService } from './shared';

function formatTraceList(result: WorkflowTraceListResult): string {
    if (result.entries.length === 0) {
        return 'No workflow runs.';
    }
    const lines = [
        'RUN ID    PROJECT              WORKFLOW             MODE            STATUS   STARTED                 COMPLETED               DURATION    OUTCOME      NEXT',
    ];
    for (const entry of result.entries) {
        const dryLabel = entry.isDryRun ? ' [dry]' : '';
        const duration = entry.durationMs === null ? 'unavailable' : `${entry.durationMs}ms`;
        const next = entry.nextAction?.value ?? '-';
        lines.push(
            `${entry.runId.padEnd(10)} ${entry.project.name.padEnd(20)} ${entry.workflowName.padEnd(22)} ${entry.mode.padEnd(15)} ${entry.status.padEnd(8)} ${entry.startedAt.padEnd(23)} ${(entry.completedAt ?? 'unavailable').padEnd(23)} ${duration.padEnd(11)} ${entry.outcome.padEnd(12)} ${next}${dryLabel}`,
        );
    }
    return lines.join('\n');
}

/**
 * Render a per-run timeline for human output: phase entries, transitions, action
 * events, and per-step cost when available.
 */
export function formatTraceTimeline(result: WorkflowTraceTimeline): string {
    const { run, events } = result;
    const dryLabel = run.isDryRun ? ' [DRY RUN]' : '';
    const reason = run.failureReason ?? run.terminalReason;
    const reasonLabel = reason ? ` — ${reason}` : '';
    const lines = [
        `Run: ${run.runId} — ${run.workflowName} (${run.mode}) — ${run.status}${dryLabel}${reasonLabel}`,
        `Project: ${run.project.name} (${run.project.root})`,
        `Started: ${run.startedAt}   Completed: ${run.completedAt ?? 'unavailable'}   Duration: ${run.durationMs === null ? 'unavailable' : `${run.durationMs}ms`}`,
        `Outcome: ${run.outcome}   Events: ${events.length}`,
        '',
    ];
    if (run.nextAction !== undefined) lines.splice(4, 0, `Next: ${run.nextAction.label} — ${run.nextAction.value}`);
    // Per-run agent-output capture (task 0414): point the operator at the live
    // artifact so a long-running agent.run step is observable mid-flight.
    if (result.outputArtifact !== undefined) {
        lines.push(`Run log: ${result.outputArtifact} (tail -f for live view)`);
        lines.push('');
    }
    for (const event of events) {
        lines.push(formatTimelineEvent(event));
    }
    // Import is a precondition, not a trigger (R6): when any agent.run step has no
    // joinable usage, point the operator at `history import` rather than auto-running it (AC2).
    const hasUnjoinedCost = events.some(
        (e) =>
            e.kind === 'action' &&
            e.cost !== undefined &&
            (e.cost.exact?.totals.records ?? 0) + (e.cost.estimated?.totals.records ?? 0) === 0,
    );
    if (hasUnjoinedCost) {
        lines.push('', 'Some agent.run steps show cost n/a — run `spur history import` to populate cost.');
    }
    return lines.join('\n').trimEnd();
}

function formatTimelineEvent(event: TimelineEvent): string {
    if (event.kind === 'phase') {
        const ts = event.startedAt ?? event.completedAt ?? '';
        return `  ${event.phase.padEnd(20)} ${event.status.padEnd(10)} ${ts}`;
    }
    if (event.kind === 'transition') {
        const guard = event.trigger ? `  [${event.trigger}]` : '';
        return `    → ${event.from} → ${event.to}${guard}  ${event.at}`;
    }
    const costSuffix = formatActionCost(event);
    const lines = [
        `    ⚡ ${event.actionId}  ${event.node}/${event.actionKind}  ${event.status}  ${event.duration || 'unavailable'}${event.label}${costSuffix}`,
        `      started=${event.startedAt ?? 'unavailable'} completed=${event.completedAt ?? 'unavailable'} outcome=${event.outcome}`,
    ];
    if (event.result !== null) {
        lines.push(
            `      result=${Object.entries(event.result)
                .map(([key, value]) => `${key}=${String(value)}`)
                .join(' ')}`,
        );
    } else {
        lines.push('      result=unavailable');
    }
    if (event.invocation !== null) {
        lines.push(
            `      invocation=${Object.entries(event.invocation)
                .map(([key, value]) => `${key}=${String(value)}`)
                .join(' ')}`,
        );
    } else {
        lines.push('      invocation=unavailable');
    }
    lines.push(`      error=${event.error ?? 'unavailable'}`);
    if (event.decision !== null && event.decision !== undefined) {
        const d = event.decision;
        lines.push(
            `      decision=mode:${d.mode} outcome:${d.outcome} reason:${d.reason}` +
                ` provider:${d.provider ?? 'unavailable'} confidence:${d.confidence ?? 'unavailable'}` +
                ` probability:${d.selectedProbability ?? 'unavailable'} durationMs:${d.durationMs}` +
                ` evidence:[${d.evidenceActionIds.join(',') || 'none'}]` +
                ` digest:${d.evidenceDigest ?? 'unavailable'} artifact:${d.artifactId ?? 'unavailable'}`,
        );
    }
    if (event.artifacts.length === 0) lines.push('      artifact=unavailable');
    else for (const artifact of event.artifacts) lines.push(`      artifact=${artifact}`);
    if (event.nextAction !== undefined) lines.push(`      Next: ${event.nextAction.label} — ${event.nextAction.value}`);
    return lines.join('\n');
}

/** 0930 R1: the single checkpoint line a deadline-expired follow writes before returning. */
function followDeadlineLine(runId: string, elapsedMs: number, status: string): string {
    return `Follow timed out after ${elapsedMs}ms: run ${runId} status=${status} — run continues; resume with spur workflow trace ${runId} --follow`;
}

/**
 * Replay persisted timeline rows, then poll for inserts/updates until the run is
 * terminal. Updated action rows are emitted again (in-flight → finished), while
 * identical snapshots are deduplicated by a stable serialized fingerprint.
 *
 * With `deadlineMs` (0930 R1), a caller deadline measured from follow start — including
 * the `Run not found` retry window — stops a non-terminal follow with a single
 * checkpoint line; the run is never cancelled or relaunched. Returns whether the
 * deadline expired (the caller maps it to exit code 1); a terminal run returns false.
 */
export async function followTrace(
    service: Pick<WorkflowAppService, 'trace'>,
    runId: string,
    pollMs: number,
    write: (line: string) => void,
    wait: (ms: number) => Promise<unknown> = (ms) => sleep(ms),
    now: () => number = Date.now,
    deadlineMs?: number,
): Promise<boolean> {
    const start = now();
    const deadline = deadlineMs === undefined ? Number.POSITIVE_INFINITY : start + deadlineMs;
    let missingAttempts = 0;
    let timeline: WorkflowTraceTimeline;
    while (true) {
        try {
            timeline = await service.trace(runId);
            break;
        } catch (error) {
            if (!String(error).includes('Run not found') || missingAttempts >= 20) throw error;
            missingAttempts++;
            await wait(pollMs);
            if (now() >= deadline) {
                write(followDeadlineLine(runId, now() - start, 'pending'));
                return true;
            }
        }
    }

    write(formatTraceTimeline(timeline));
    const seen = new Set(timeline.events.map((event) => JSON.stringify(event)));
    if (isTerminalTraceStatus(timeline.run.status)) return false;

    while (true) {
        await wait(pollMs);
        const next = await service.trace(runId);
        for (const event of next.events) {
            const fingerprint = JSON.stringify(event);
            if (seen.has(fingerprint)) continue;
            seen.add(fingerprint);
            write(formatTimelineEvent(event));
        }
        if (isTerminalTraceStatus(next.run.status)) {
            const reason = next.run.failureReason ? ` — ${next.run.failureReason}` : '';
            const duration = next.run.durationMs === null ? 'unavailable' : `${next.run.durationMs}ms`;
            write(`Run finalized: ${next.run.status}${reason} — outcome=${next.run.outcome} duration=${duration}`);
            if (next.run.nextAction !== undefined) {
                write(`Next: ${next.run.nextAction.label} — ${next.run.nextAction.value}`);
            }
            return false;
        }
        const at = now();
        if (at >= deadline) {
            write(followDeadlineLine(runId, at - start, next.run.status));
            return true;
        }
    }
}

function isTerminalTraceStatus(status: string): boolean {
    return status !== 'running' && status !== 'pending';
}

/**
 * Read complete lines appended to the run log since `offset`, holding back a
 * trailing partial line (line buffering) until a newline lands. Returns whether
 * the file exists, the new complete lines, and the next byte offset to resume
 * from. Read-only — never writes to the log.
 */
function readRunLogChunk(logPath: string, offset: number): { exists: boolean; lines: string[]; offset: number } {
    let fd: number;
    try {
        fd = openSync(logPath, 'r');
    } catch {
        return { exists: false, lines: [], offset };
    }
    try {
        const size = fstatSync(fd).size;
        if (size <= offset) return { exists: true, lines: [], offset };
        const buffer = Buffer.alloc(size - offset);
        readSync(fd, buffer, 0, buffer.length, offset);
        const text = buffer.toString('utf8');
        const lastNewline = text.lastIndexOf('\n');
        const consumed = lastNewline >= 0 ? lastNewline + 1 : 0;
        // split then drop only the trailing empty element from the final newline,
        // preserving intentional blank separator lines inside the chunk.
        const parts = consumed === 0 ? [] : text.slice(0, consumed).split('\n');
        const lines = parts.length > 0 && parts.at(-1) === '' ? parts.slice(0, -1) : parts;
        return { exists: true, lines, offset: offset + consumed };
    } finally {
        closeSync(fd);
    }
}

/**
 * Tail the run record `.spur/memory/runs/<RUNID>.md` (legacy `.log` fallback; read-only)
 * as the run progresses, then exit once
 * the run reaches a terminal status. Best-effort: if the log never appears
 * (e.g. the run was started with `--no-log`), surface a clear message after
 * terminal status rather than hanging forever. This is a distinct source from
 * `followTrace`'s DB timeline — the two never interleave.
 *
 * With `deadlineMs` (0930 R1), the same caller-deadline contract as `followTrace`:
 * counted from follow start (including a not-yet-persisted run), expiry on a
 * non-terminal run writes one checkpoint line and returns true — never cancels.
 */
export async function followRunLog(
    service: Pick<WorkflowAppService, 'trace'>,
    runId: string,
    dir: string,
    pollMs: number,
    write: (line: string) => void,
    wait: (ms: number) => Promise<unknown> = (ms) => sleep(ms),
    now: () => number = Date.now,
    deadlineMs?: number,
): Promise<boolean> {
    const start = now();
    const deadline = deadlineMs === undefined ? Number.POSITIVE_INFINITY : start + deadlineMs;
    // 0926 R3: the record format is re-detected every poll. A legacy `.log` run
    // that gets continued mid-follow gains a `.md` under the same run id — the
    // tail must switch to it (once, from the top) instead of tracking the stale
    // legacy file forever. When no record exists yet, expect the new `.md` so a
    // follow that starts before the run writes picks up the new record.
    const runDir = join(dir, '.spur', 'run');
    const pendingMdPath = join(runDir, `${runId}.md`);
    let logPath: string | undefined;
    let record: WorkflowRunRecordRead = { kind: 'missing' };
    let offset = 0;
    let everRead = false;
    // Text already emitted, so a legacy→.md switch can skip a shared prefix
    // instead of reprinting the new file from byte 0 (0948 R6).
    let carried = '';
    // 0930 R1: last observed status for the deadline checkpoint; a run not yet
    // persisted is pending registration.
    let lastStatus = 'pending';
    while (true) {
        // 1026 R1: records resolve outside scratch (durable first, legacy fallback).
        record = readWorkflowRunRecord(resolveRunRecordDir(dir, runId), runId);
        const target =
            record.kind === 'legacy-log'
                ? record.logPath
                : 'markdownPath' in record
                  ? record.markdownPath
                  : pendingMdPath;
        if (target !== logPath) {
            logPath = target;
            offset = 0;
            if (carried !== '') {
                try {
                    const nextText = readFileSync(target, 'utf8');
                    if (nextText.startsWith(carried)) offset = Buffer.byteLength(carried);
                } catch {
                    offset = 0;
                }
            }
        }
        const chunk = readRunLogChunk(logPath, offset);
        if (chunk.exists && (chunk.lines.length > 0 || chunk.offset > offset)) {
            everRead = true;
            for (const line of chunk.lines) {
                write(line);
                carried += `${line}\n`;
            }
            offset = chunk.offset;
        }

        let terminal = false;
        try {
            const observed = (await service.trace(runId)).run.status;
            lastStatus = observed;
            terminal = isTerminalTraceStatus(observed);
        } catch (error) {
            // Run not persisted yet — keep waiting inside the follow window.
            if (!String(error).includes('Run not found')) throw error;
        }
        if (terminal) {
            if (everRead && record.kind === 'incomplete') {
                // A pair record whose state never landed is an explicit incomplete
                // record — never a successful old run (0926 AC2).
                write(
                    `Run record incomplete (${record.reason}) at ${record.statePath} — the workflow DB trace remains the completion authority.`,
                );
            } else if (!everRead) {
                // 0948 R6: an EXISTING but empty record is not a `--no-log` run — the old
                // message sent the operator hunting for a flag that was never passed.
                const present = record.kind === 'legacy-log' || readRunLogChunk(logPath, 0).exists;
                write(
                    present
                        ? `Run record at ${logPath} is empty — no output was written to it.`
                        : `No run log at ${logPath} — the run may have been started with --no-log.`,
                );
            }
            return false;
        }
        const at = now();
        if (at >= deadline) {
            write(followDeadlineLine(runId, at - start, lastStatus));
            return true;
        }
        await wait(pollMs);
    }
}

/**
 * Render per-step token cost and cache-hit for the human-readable trace timeline.
 *
 * Returns an empty string for non-agent.run actions; ` · cost n/a` when the step
 * cannot be joined to usage data (never `$0.00` — 0281/0284 invariant); otherwise
 * the token figures derived from `history_message` typed columns via the run→session
 * mapping (task 0559). Exact and estimated figures are rendered apart and never
 * summed (R2); estimated figures carry the `~` prefix. No currency value is ever
 * emitted (R3) — tokens, never prices.
 */
export function formatActionCost(event: TimelineEvent): string {
    if (event.kind !== 'action') return '';
    const cost = event.cost;
    if (!cost) return '';
    const parts: string[] = [];
    if (cost.exact !== null && cost.exact.totals.recordsWithUsage > 0) {
        parts.push(formatTokenCost(cost.exact, false));
    }
    if (cost.estimated !== null && cost.estimated.totals.recordsWithUsage > 0) {
        parts.push(formatTokenCost(cost.estimated, true));
    }
    // Unjoinable agent.run step (no matched usage) → render `n/a`, never a fabricated zero
    // (0281/0284 never-fabricate invariant). Matched rows with no token data also render
    // n/a: absent telemetry is unknown, not 0 tokens.
    if (parts.length === 0) return ' · cost n/a';
    return ` · ${parts.join(' · ')}`;
}

/** One token-figure segment: `~12.4k in / 3.2k out · cache 41%` (est prefix when estimated). */
function formatTokenCost(cost: ActionCost, estimated: boolean): string {
    const est = estimated ? '~' : '';
    const { inputTokens, outputTokens } = cost.totals;
    const ratio = cost.cacheHit === null ? 'n/a' : `${(cost.cacheHit * 100).toFixed(0)}%`;
    return `${est}${formatTokens(inputTokens)} in / ${est}${formatTokens(outputTokens)} out · cache ${est}${ratio}`;
}

/** Compact token rendering: `1250` → `1.3k`, `5000000` → `5.0M`. */
function formatTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
}

/** Register `spur workflow trace`. */
export function registerWorkflowTraceCommand(workflow: Command, context: CliContext): void {
    workflow
        .command('trace')
        .description('Show persisted workflow run history.')
        .argument('[run-id]', 'Run ID for per-run timeline detail')
        .option('--workflow <name>', 'Filter by workflow name')
        .option(...SHARED_OPTIONS.statusDoneFailedRunning)
        .option(...SHARED_OPTIONS.since)
        .option(...SHARED_OPTIONS.last, '20')
        .option('--follow', 'Replay a run timeline and poll persisted state until it becomes terminal')
        .option(...SHARED_OPTIONS.pollWorkflow, '1000')
        .option('--output', 'With --follow: stream .spur/memory/runs/<RUNID>.md instead of the DB timeline')
        .option(...SHARED_OPTIONS.timeout)
        .option(...SHARED_OPTIONS.jsonSupported)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (runId, options) => {
            const svc = makeWorkflowService(context);
            const last = parseInt(options.last, 10);
            if (Number.isNaN(last) || last < 1) {
                writeJsonError(context.output, options, '--last must be a positive integer', 'VALIDATION_FAILED');
                context.setExitCode(1);
                return;
            }
            const pollMs = parseInt(options.poll, 10);
            if (Number.isNaN(pollMs) || pollMs < 50) {
                writeJsonError(
                    context.output,
                    options,
                    '--poll must be an integer of at least 50ms',
                    'VALIDATION_FAILED',
                );
                context.setExitCode(1);
                return;
            }
            if (options.follow === true && runId === undefined) {
                writeJsonError(context.output, options, '--follow requires a run-id', 'VALIDATION_FAILED');
                context.setExitCode(1);
                return;
            }
            if (options.follow === true && options.json === true) {
                writeJsonError(
                    context.output,
                    options,
                    '--follow is a human streaming mode and cannot be combined with --json',
                    'VALIDATION_FAILED',
                );
                context.setExitCode(1);
                return;
            }
            if (options.output === true && options.follow !== true) {
                writeJsonError(context.output, options, '--output requires --follow', 'VALIDATION_FAILED');
                context.setExitCode(1);
                return;
            }
            // 0930 R2: the caller deadline bounds a --follow watch; without --follow there is
            // nothing to bound, and a non-positive/non-integer value is a caller bug.
            if (options.timeout !== undefined && options.follow !== true) {
                writeJsonError(context.output, options, '--timeout requires --follow', 'VALIDATION_FAILED');
                context.setExitCode(1);
                return;
            }
            const timeoutMs = options.timeout === undefined ? undefined : Number(options.timeout);
            if (timeoutMs !== undefined && (!Number.isInteger(timeoutMs) || timeoutMs <= 0)) {
                writeJsonError(
                    context.output,
                    options,
                    '--timeout must be a positive integer of milliseconds',
                    'VALIDATION_FAILED',
                );
                context.setExitCode(1);
                return;
            }
            if (options.output === true && options.json === true) {
                writeJsonError(
                    context.output,
                    options,
                    '--output is a human streaming mode and cannot be combined with --json',
                    'VALIDATION_FAILED',
                );
                context.setExitCode(1);
                return;
            }
            if (options.status !== undefined && !['done', 'failed', 'running'].includes(options.status)) {
                writeJsonError(
                    context.output,
                    options,
                    '--status must be one of: done, failed, running',
                    'VALIDATION_FAILED',
                );
                context.setExitCode(1);
                return;
            }
            if (options.follow === true && runId !== undefined) {
                // 0930 R1: a deadline expiry stops the watch with a checkpoint; the run itself
                // is never cancelled or relaunched — exit 1 is the watcher's, not the run's.
                const timedOut =
                    options.output === true
                        ? await followRunLog(
                              svc,
                              runId,
                              context.cwd,
                              pollMs,
                              (line) => context.output.write(line),
                              undefined,
                              undefined,
                              timeoutMs,
                          )
                        : await followTrace(
                              svc,
                              runId,
                              pollMs,
                              (line) => context.output.write(line),
                              undefined,
                              undefined,
                              timeoutMs,
                          );
                if (timedOut) context.setExitCode(1);
                return;
            }
            const result = runId
                ? await svc.trace(runId)
                : await svc.trace({
                      workflow: options.workflow,
                      status: options.status,
                      since: options.since,
                      last,
                  });
            if (options.json) {
                context.output.write(toEnvelopeJson(result, { enveloped: options.jsonEnvelope }));
            } else if ('events' in result) {
                context.output.write(formatTraceTimeline(result));
            } else {
                context.output.write(formatTraceList(result));
            }
        });
}
