/**
 * Argv detection for the boot-free workflow transports (`spur workflow inline …` and
 * `spur workflow commit-guard …`, script-absorption PR-4), split from `workflow-transport.ts` so the
 * detection stays dependency-free and unit-testable without the app layer.
 */

/** The `workflow` verbs served by the early dispatch instead of the full DB/config boot. */
export const WORKFLOW_TRANSPORT_VERBS: readonly string[] = ['inline', 'commit-guard'];

/** True when argv addresses `spur workflow inline|commit-guard …` (global flags ignored). */
export function isWorkflowTransportInvocation(argv: readonly string[]): boolean {
    const tokens = argv.filter((token) => !['--no-logo', '--cli-verbose', '-v'].includes(token));
    return tokens[0] === 'workflow' && WORKFLOW_TRANSPORT_VERBS.includes(tokens[1] ?? '');
}
