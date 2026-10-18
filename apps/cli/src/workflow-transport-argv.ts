/**
 * Argv detection for the boot-free workflow transports (`spur workflow commit-guard …`,
 * `spur workflow persist-out|persist-check …`), split from `workflow-transport.ts` so the
 * detection stays dependency-free and unit-testable without the app layer.
 */

/** The `workflow` verbs served by the early dispatch instead of the full DB/config boot. */
export const WORKFLOW_TRANSPORT_VERBS: readonly string[] = ['commit-guard', 'persist-out', 'persist-check'];

/** True when argv addresses one of the boot-free transports (global flags ignored). */
export function isWorkflowTransportInvocation(argv: readonly string[]): boolean {
    const tokens = argv.filter((token) => !['--no-logo', '--cli-verbose', '-v'].includes(token));
    return tokens[0] === 'workflow' && WORKFLOW_TRANSPORT_VERBS.includes(tokens[1] ?? '');
}
