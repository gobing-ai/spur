/**
 * Markdown code-fence stripper for Acceptance Criteria bodies.
 *
 * The feature/task templates wrap Gherkin AC in a ```` ```gherkin … ``` ```` fence.
 * The Gherkin validator and the coverage matcher parse RAW Gherkin, so the fence
 * lines must be removed first — otherwise they surface as "Unrecognized syntax".
 * Checklist AC has no fence and passes through unchanged.
 */

/** Remove ```-prefixed fence lines from an AC body, preserving everything else. */
export function stripAcFence(body: string): string {
    const lines = body.split('\n');
    const out: string[] = [];
    for (const line of lines) {
        if (/^\s*```/.test(line)) continue;
        out.push(line);
    }
    return out.join('\n');
}
