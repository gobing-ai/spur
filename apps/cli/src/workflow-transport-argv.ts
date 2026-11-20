/**
 * Argv detection for the boot-free workflow transports (`spur workflow commit-guard-* …`,
 * `spur workflow persist-out|persist-check …`) for the startup banner.
 */

/** Wire names shared by registration and the machine-output banner policy. */
export const WORKFLOW_TRANSPORT = {
    guardStart: 'commit-guard-start',
    guardStage: 'commit-guard-stage',
    guardCheck: 'commit-guard-check',
    persistOut: 'persist-out',
    persistCheck: 'persist-check',
} as const;

/** The `workflow` verbs served by the early dispatch instead of the full DB/config boot. */
export const WORKFLOW_TRANSPORT_VERBS: readonly string[] = Object.values(WORKFLOW_TRANSPORT);

/** True when argv addresses one of the boot-free transports (global flags ignored). */
export function isWorkflowTransportInvocation(argv: readonly string[]): boolean {
    const tokens = argv.filter((token) => !['--no-logo', '--cli-verbose', '-v'].includes(token));
    return tokens[0] === 'workflow' && WORKFLOW_TRANSPORT_VERBS.includes(tokens[1] ?? '');
}
