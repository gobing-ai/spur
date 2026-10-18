# Workflow engine action pauses

The engine patch mirrors the fix in `ts-libs/packages/dual-workflow-engine`: action-requested
pauses persist a continuation cursor and resume without replaying completed actions. Bun applies
it through `patchedDependencies`, including on a frozen-lockfile install.

shortcut: the fix is pinned to engine 0.5.28; remove the patch and its manifest entry when a
published engine release includes the same action-pause behavior, then regenerate the lockfile.
