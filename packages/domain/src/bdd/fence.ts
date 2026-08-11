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

/** True when an AC body reads as Gherkin (a Feature/Scenario header anywhere). */
export function looksLikeGherkinAc(body: string): boolean {
    return /^\s*(?:Feature:|Scenario:|Scenario Outline:)/m.test(body);
}

/**
 * Ensure a Gherkin AC body is wrapped in a ```gherkin fence for presentation.
 * Checklist-tier and empty bodies pass through unchanged; already-fenced bodies
 * pass through unchanged. Write paths call this so the corpus invariant
 * ("Gherkin AC is always fenced") holds regardless of the author.
 */
export function normalizeAcFence(body: string): string {
    const trimmed = body.trim();
    if (trimmed === '' || /^\s*```/m.test(trimmed)) return body;
    if (!looksLikeGherkinAc(trimmed)) return body;
    return `\`\`\`gherkin\n${trimmed}\n\`\`\``;
}
