import type { Command } from '@commander-js/extra-typings';
import { DEFAULT_LOOP_POLL_MS } from '@gobing-ai/spur-app';
import type { CliContext } from '../../context';
import { SHARED_OPTIONS } from '../shared-options';
import { commanderOptionsToFlags, parseLoopPoll, runAgentLoop } from './shared';

/**
 * Bound a supervised `agent loop`'s lifetime to its parent serve (1088 R2).
 *
 * Graceful shutdown already reaps loops (`supervisor().stopAll()`), but a SIGKILLed or crashed
 * serve sends its children nothing, so the loop kept draining against a dead serve forever.
 * `process.ppid` is re-read live (Bun reports `N` → `1` after a SIGKILL), so the loop can detect
 * the reparent alone: no daemon, no marker file, and no signal from the dying parent. The abort
 * ends the loop through its normal shutdown (claim release, member-session reset).
 *
 * The returned stop function clears the watch — the caller's `finally`. `readPpid` is a test seam.
 */
export function startParentWatch(
    controller: AbortController,
    intervalMs: number,
    readPpid: () => number = () => process.ppid,
): () => void {
    const parent = readPpid();
    const timer = setInterval(() => {
        if (readPpid() !== parent) controller.abort();
    }, intervalMs);
    // Never hold the loop process open on this watch alone.
    (timer as { unref?: () => void }).unref?.();
    return () => clearInterval(timer);
}

/** Register `spur agent loop`. */
export function registerAgentLoopCommand(agent: Command, context: CliContext): void {
    // Supervisor-internal (`supervisor-service.ts` spawns `agent loop --spec <id>`): hidden from help.
    agent
        .command('loop', { hidden: true })
        .description('Run the persistent self-draining loop for a supervised agent spec.')
        .option('--spec <id>', 'Agent spec id / message recipient')
        .option(...SHARED_OPTIONS.pollAgent, String(DEFAULT_LOOP_POLL_MS))
        .action(async (options) => {
            const controller = new AbortController();
            const onSignal = () => controller.abort();
            process.on('SIGINT', onSignal);
            process.on('SIGTERM', onSignal);
            // 1088 R2: the parent watch bounds the loop's lifetime to its parent serve. A plain
            // SIGKILLed serve can send no signal at all, so the loop would outlive it forever.
            const stopParentWatch = startParentWatch(controller, parseLoopPoll(options.poll));
            try {
                const flags = commanderOptionsToFlags(options);
                const code = await runAgentLoop(context, flags, { signal: controller.signal });
                context.setExitCode(code);
            } finally {
                stopParentWatch();
                process.off('SIGINT', onSignal);
                process.off('SIGTERM', onSignal);
            }
        });
}
