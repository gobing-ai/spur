/**
 * `@gobing-ai/spur-app/hooks` — host hook adapters behind `spur self hook <id>`
 * (script-absorption plan PR-2a, docs/plans/2026-10-14-spur-script-absorption.md §5).
 */

export {
    HOOK_DEFINITIONS,
    HOOK_HOSTS,
    HOOK_IDS,
    type HookDefinition,
    type HookHost,
    type HookHostOption,
    type HookKind,
    type HookRunInput,
    type HookRunResult,
    hookSpurArgv,
    resolveHookHost,
    runSpurHook,
} from './run-hook';
