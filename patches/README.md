# Workflow engine action pauses

The engine patch mirrors the fix in `ts-libs/packages/dual-workflow-engine`: action-requested
pauses persist a continuation cursor and resume without replaying completed actions. Bun applies
it through `patchedDependencies`, including on a frozen-lockfile install.

shortcut: the fix is pinned to engine 0.5.28; remove the patch and its manifest entry when a
published engine release includes the same action-pause behavior, then regenerate the lockfile.

# Database synchronous transactions

The ts-db 0.5.32 patch adds an optional facade transaction capability with a synchronous SQL handle.
Inbox row/event mutations use it so an awaited statement cannot absorb another request's write into
its transaction. Bun executes the callback atomically, rejects asynchronous callbacks, and expires
escaped handles; D1 explicitly rejects this capability. The upstream source proposal is maintained
with the task 1271 implementation evidence.

shortcut: pinned to ts-db 0.5.32; remove this patch and its registration when a released ts-db
includes the synchronous transaction facade, then regenerate the lockfile.
