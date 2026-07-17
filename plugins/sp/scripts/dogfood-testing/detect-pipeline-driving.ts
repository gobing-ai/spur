/**
 * detect-pipeline-driving — @1.2 pipeline-driving testee detector (task 0277, W7).
 *
 * Pure function over the raw testee string → boolean. Used by the dogfood driver
 * (Phase 1.0 refuse-ambiguous gate) and by unit tests so the matcher contract is
 * machine-checked rather than agent-interpreted.
 *
 * Contract (0274 §3 dogfood-pipeline-detect, 0277 R1):
 *   - Word-boundary matchers with `-` treated as a word char (NOT a boundary).
 *     A token counts only when it is a distinct hyphen-word, not when it is a
 *     substring of a longer alphanumeric or hyphen run. This removes the
 *     leading-space dependency of the @1.1 prose detector.
 *   - Two token shapes, both with strict `[^\w-]` boundaries:
 *       (a) complete tokens — `--next`, `dev-run`, `dev-runall`, `dev-wrap`,
 *           `dev-wrapall`, `dev-idea` — matched as whole hyphen-words so the
 *           slash form `/sp:dev-run` matches on its `dev-run` tail whether or
 *           not it is preceded by a space, but `--next` does NOT match inside
 *           `--next-gen` (the trailing `-gen` breaks the boundary).
 *       (b) bare nouns — `run`, `runall`, `wrap`, `wrapall`, `idea` — matched
 *           only as standalone words, so `run` matches in
 *           `bun ... task run 0042` but NOT inside `runaway`/`prerun`, and
 *           `idea` does NOT match inside `idealist`/`ideal`.
 *   - Listing both shapes is what makes the detector leading-space invariant
 *     (the slash form is caught by its `dev-*` tail; the bare noun is caught
 *     when it appears as its own word) without letting `run` leak into every
 *     `-run-` identifier.
 *
 * Non-goals: this detector decides ambiguity only. It does NOT decide observe
 * vs fix — any explicit `--max-retry` value proceeds regardless.
 */

/**
 * Tokens whose presence makes a testee pipeline-driving. Ordered for stable
 * diagnostics. Two shapes per the contract above: complete `dev-*` / `--next`
 * tokens first, then bare nouns.
 */
const PIPELINE_TOKENS = [
    '--next',
    'dev-runall',
    'dev-wrapall',
    'dev-run',
    'dev-wrap',
    'dev-idea',
    'runall',
    'wrapall',
    'run',
    'wrap',
    'idea',
] as const;

/**
 * Match a token at a word boundary. A "word boundary" here is the position
 * between a non-`[\w-]` char (or string start) and the token, and between the
 * token and a non-`[\w-]` char (or string end). Treating `-` as a word char
 * is what makes `--next` reject `--next-gen` and `dev-run` reject `dev-runner`.
 */
function tokenMatches(testee: string, token: string): boolean {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // (?<![\w-]) — not preceded by a word char or hyphen.
    // (?![\w-])  — not followed by a word char or hyphen.
    const re = new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, 'i');
    return re.test(testee);
}

/**
 * Returns whether the testee string is pipeline-driving (contains any of the
 * pipeline-driving tokens as a distinct hyphen-word). Machine-checked
 * counterpart of the prose list in SKILL.md §Pipeline-driving detection and
 * dev-dogfood.md.
 */
export function detectPipelineDriving(testee: string): boolean {
    if (typeof testee !== 'string' || testee.length === 0) {
        return false;
    }
    return PIPELINE_TOKENS.some((token) => tokenMatches(testee, token));
}

export { PIPELINE_TOKENS };
