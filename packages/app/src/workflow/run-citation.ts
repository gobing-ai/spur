/**
 * `.spur/run/<name>` citation extraction and resolution, shared by persist-out
 * (`inline-run-setup.ts`, 0984 R3) and the record step (R6, task 1139). Both consumers
 * must agree on what a "literal direct-child citation" is, so the regex and the
 * literalization rule live here once instead of in two drifting copies.
 */

/** A single safe filename component; a matching name joined under `.spur/run/` cannot escape it. */
export const SAFE_RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * A cited run-evidence reference (0984 R3): `.spur/run/` followed by name characters, with an
 * optional subpath continuation group. The charset deliberately includes template metachars
 * (`*`, `…`, `{`, `<`, `?`, `,`) so abbreviated and glob references stay attached to one
 * capture and are classified non-literal by {@link asLiteralRunFileName}, instead of a
 * truncated prefix (`fadca099-` out of `fadca099-…-wrapup-learnings.md`) masquerading as a
 * real filename. The leading alnum requirement already refuses `<runId>-…` placeholders and
 * `..` traversal outright. The lookbehind keeps only repo-relative citations
 * (`.spur/run/…`, `./.spur/run/…`): a root-qualified path (`knowledge-kit/.spur/run/…`,
 * `/abs/.spur/run/…`, `~/.spur/run/…`) is another project's evidence and carries no local
 * obligation.
 *
 * 1056 R1 (skip, not resolve): when the name is followed by `/rest`, the citation addresses a
 * subpath of `.spur/run/<name>` — the direct-child copy set owns files only (0984 R5), so the
 * continuation is captured as group 2 and the extraction loop classifies the citation as
 * `cited-directory:<name>` instead of obligating `<name>`. A captured continuation — not a
 * negative lookahead on `/` — is required: the greedy name charset would backtrack to a
 * SHORTER capture to satisfy a lookahead, yielding a wrong name (`triage-1051-105`).
 */
export const RUN_CITATION_RE =
    /(?<![\w~:-]|[\w~:-]\/)\.spur\/run\/([A-Za-z0-9][A-Za-z0-9._*?<>{}|,\u2026-]*)(\/[^\s`]*)?/g;

/**
 * Reduce one captured reference to a literal direct-child file name, or `undefined` when it is
 * not one (0984 R3): template/abbreviated references (`fadca099-…`, `run-*-ac87.log`,
 * `{batch-report.md,…}`) and `..` runs are not literal files, so they carry no obligation and
 * never fail a consumer. A surviving name is a single safe component. Trailing sentence
 * punctuation is prose, not name: `… .spur/run/x.json.` must not become a phantom `x.json.`
 * and `… .spur/run/x.json, …` must not drop the citation as non-literal.
 */
export function asLiteralRunFileName(citation: string): string | undefined {
    const name = citation.replace(/[.,]+$/, '');
    if (!SAFE_RUN_ID_RE.test(name) || name.includes('..')) return undefined;
    return name;
}

/** One extracted direct-child citation: the literal name plus the source text it came from. */
export interface RunCitation {
    readonly name: string;
    /** The matched reference including the `.spur/run/` prefix (diagnostics only). */
    readonly reference: string;
}

/**
 * Extract the literal direct-child `.spur/run/<name>` citations from a rendered section body.
 * Subpath citations (`<name>/<rest>`) are skipped, matching 1056 R1: they address evidence
 * below a directory this check does not own.
 */
export function extractRunCitations(body: string): RunCitation[] {
    const out: RunCitation[] = [];
    const seen = new Set<string>();
    for (const match of body.matchAll(RUN_CITATION_RE)) {
        if (match[2] !== undefined) continue;
        const name = asLiteralRunFileName(match[1] ?? '');
        if (name === undefined || seen.has(name)) continue;
        seen.add(name);
        out.push({ name, reference: match[0] });
    }
    return out;
}

/** The three planes a direct-child `.spur/run/<name>` citation may resolve in. */
export const RUN_CITATION_DIRS = ['.spur/run', '.spur/memory/evidence', '.spur/memory/runs'] as const;
