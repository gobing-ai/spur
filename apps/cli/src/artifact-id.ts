import type { CliContext } from './context';

/** Artifact identities must stay in one filename component under the run directory. */
export function acceptArtifactId(
    id: string,
    kind: string,
    context: Pick<CliContext, 'output' | 'setExitCode'>,
): boolean {
    if (/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) return true;
    context.output.error(`refusing unsafe ${kind}: ${JSON.stringify(id)}`);
    context.setExitCode(2);
    return false;
}
