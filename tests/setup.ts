import util from 'node:util';
import { setLoggerMuted } from '@gobing-ai/ts-infra';
import { configure, reset } from '@logtape/logtape';

type UtilTypesWithEventTarget = typeof util.types & {
    isEventTarget?: (target: unknown) => boolean;
};

// Fix Bun 1.3.14 on Linux where node:util types.isEventTarget(signal) returns false for AbortSignal,
// causing node:events setMaxListeners(n, controller.signal) in execa 9.6+ to throw ERR_INVALID_ARG_TYPE.
const utilTypes = util?.types as UtilTypesWithEventTarget | undefined;
if (utilTypes && typeof utilTypes.isEventTarget === 'function') {
    const origIsEventTarget = utilTypes.isEventTarget.bind(utilTypes);
    utilTypes.isEventTarget = (target: unknown): boolean => {
        if (
            target != null &&
            (target instanceof AbortSignal ||
                (target as { constructor?: { name?: string } }).constructor?.name === 'AbortSignal')
        ) {
            return true;
        }
        return origIsEventTarget(target);
    };
}

if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.prototype === 'object' && AbortSignal.prototype !== null) {
    try {
        const noopSetMaxListeners = (_n?: number): void => {};
        Object.defineProperty(AbortSignal.prototype, 'setMaxListeners', {
            value: noopSetMaxListeners,
            writable: true,
            configurable: true,
        });
        noopSetMaxListeners(0);
    } catch {
        // Fallback for environments where prototype is frozen
    }
}

// Gate the ts-infra logger adapter (per-instance).
setLoggerMuted(true);

// Configure LogTape engine directly — no sinks, fatal-only root level.
// This silences ALL log output regardless of which ts-infra instance
// created the LogTapeLogger adapter (four duplicate ts-infra@0.3.5
// instances exist in Bun's store, each with its own `muted` flag).
await reset();
await configure({
    sinks: {},
    loggers: [
        { category: ['app'], lowestLevel: 'fatal', sinks: [] },
        { category: ['logtape', 'meta'], lowestLevel: 'fatal', sinks: [] },
    ],
});

// Prevent tests from resolving the global ~/.config/spur/config.yaml fallback,
// ensuring they hit the direct (no-config) code path.
process.env.SPUR_SKIP_GLOBAL_CONFIG = 'true';

// A pipeline's `test`/`test-recheck` gate runs as a child of the workflow run process,
// inheriting its SPUR_WORKFLOW_RUN_ACTIVE=1 marker (task 0610 R4 nested-run refusal).
// Tests are legitimate top-level processes, not nested pipelines, so drop the leaked
// marker here. The refusal test in apps/cli/tests/commands/workflow.test.ts sets it
// explicitly itself, so the guard stays fully covered (0753 R3: never relax the guard).
delete process.env.SPUR_WORKFLOW_RUN_ACTIVE;
