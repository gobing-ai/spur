/**
 * detect-pipeline-driving — @1.2 pipeline-driving testee detector (task 0277, W7).
 *
 * Pure function over the raw testee string → boolean. Used by the dogfood driver
 * (Phase 1.0 refuse-ambiguous gate) and by unit tests so the matcher contract is
 * machine-checked rather than agent-interpreted.
 *
 * Also ships a **CLI gate** (import.meta.main) so Phase 1.0 is a live shell call,
 * not agent-only prose interpretation:
 *
 *   bun plugins/sp/scripts/dogfood-testing/detect-pipeline-driving.ts \
 *     --testee "/sp:dev-run 0125 --auto --next" [--max-retry-present] \
 *     [--steps "step1||step2"] [--json]
 *
 * Exit codes:
 *   0 — proceed (may print implement-heavy advisory on stderr)
 *   2 — refuse: pipeline-driving without explicit --max-retry
 *   1 — usage / argument error
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
 * Non-goals of detectPipelineDriving: decides ambiguity only. It does NOT decide
 * observe vs fix — any explicit `--max-retry` value proceeds regardless.
 * Implement-heavy advisory is a separate helper (detectImplementHeavy).
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
    'dev-refineall',
    'dev-verifyall',
    'dev-run',
    'dev-wrap',
    'dev-idea',
    'refineall',
    'verifyall',
    'runall',
    'wrapall',
    'run',
    'wrap',
    'idea',
] as const;

/** Refuse message when pipeline-driving and `--max-retry` was not passed (exact string). */
export const PIPELINE_DRIVING_REFUSE_MESSAGE =
    '⚠ pipeline-driving testee detected; pass --max-retry 0 (observe-only) or --max-retry N (fix mode, tree mutation acknowledged)';

/**
 * Refuse message when the testee carries a mutating `--fix` mode (`--fix all` /
 * `--fix blockers-first`) and `--max-retry` was not passed. A mutating fix mode
 * mutates the working tree independent of pipeline-driving (task 0293 R1/R2):
 * `--max-retry 0` bounds the **driver** only — the testee's own `--fix` pass
 * still mutates the tree — so the message must not imply otherwise.
 */
export const MUTATING_FIX_REFUSE_MESSAGE =
    '⚠ mutating --fix mode detected (--fix all | --fix blockers-first); pass --max-retry 0 (observe-only for the driver; the testee still mutates the tree) or --max-retry N (fix mode, driver + testee both mutate)';

/** Advisory when pipeline-driving + implement-heavy derived steps (exact string). */
export const IMPLEMENT_HEAVY_ADVISORY_MESSAGE =
    '⚠ implement-heavy pipeline dogfood: prefer --max-retry 0 (observe-only) or step-split; operator --max-retry N overrides';

/**
 * Tokens that mark a derived step as implement-heavy (mutates product/code or
 * drives a mutating pipeline leg). Deliberately excludes verify/review/unit-only
 * surfaces even when they carry `--next`.
 */
const IMPLEMENT_HEAVY_TOKENS = [
    'dev-runall',
    'dev-wrapall',
    'dev-run',
    'dev-wrap',
    'dev-idea',
    'runall',
    'wrapall',
    // bare `run` / `wrap` / `idea` — only when not clearly a non-mutating surface
    'run',
    'wrap',
    'idea',
    'implement',
] as const;

/**
 * A verify/review surface stops being non-mutating the moment it carries a
 * repair mode: `--fix all` / `--fix blockers-first` applies Edit/Write repairs
 * to the working tree (0280 dogfood, finding P2). `--fix none` stays
 * observational. Boundary-guarded so `--prefix all` / `--focus all` never match.
 * Exported so the Phase 1.0 gate and tests share one matcher (task 0293 R1/R4).
 */
export function hasMutatingFixMode(step: string): boolean {
    return /(?<![\w-])--fix[=\s]+(all|blockers-first)(?![\w-])/i.test(step);
}

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

/**
 * True when a single step label (or the whole testee) is implement-heavy —
 * it chains into real implementation / wrap / idea work, not verify-only.
 *
 * Non-mutating surfaces (`dev-verify`, `dev-review`, `dev-unit`, plain
 * `dev-refine` without a further run) are never implement-heavy even if
 * pipeline-driving via `--next` — UNLESS they carry a mutating repair mode
 * (`--fix all` / `--fix blockers-first`), which turns the verify/review leg
 * into a tree-mutating fix pass (0280 dogfood, finding P2).
 */
export function isImplementHeavyStep(step: string): boolean {
    if (typeof step !== 'string' || step.length === 0) return false;
    // Explicit non-mutating surfaces win unless a mutating token co-occurs.
    const nonMutatingOnly =
        tokenMatches(step, 'dev-verify') || tokenMatches(step, 'dev-review') || tokenMatches(step, 'dev-unit');
    const hasMutating = IMPLEMENT_HEAVY_TOKENS.some((token) => tokenMatches(step, token)) || hasMutatingFixMode(step);
    if (nonMutatingOnly && !hasMutating) return false;
    // refine alone is planning, not implement-heavy; refine+run/--next chain is.
    if (tokenMatches(step, 'dev-refine') && !hasMutating && !tokenMatches(step, '--next')) {
        return false;
    }
    if (tokenMatches(step, 'dev-refine') && tokenMatches(step, '--next')) {
        // refine --next chains into run → implement-heavy
        return true;
    }
    return hasMutating;
}

/**
 * True when the testee is implement-heavy: it carries a pipeline-driving token,
 * a mutating `--fix` mode, OR at least one derived step (or the testee itself
 * when no steps given) is implement-heavy. Used for the W8 Phase 1 advisory
 * after step derivation.
 *
 * Task 0293 R3: a mutating `--fix` mode alone is implement-heavy even with no
 * pipeline token — the verify/review leg itself becomes a tree-mutating fix
 * pass.
 */
export function detectImplementHeavy(testee: string, derivedSteps: string[] = []): boolean {
    if (isImplementHeavyStep(testee)) return true;
    if (!detectPipelineDriving(testee)) return false;
    return derivedSteps.some((step) => isImplementHeavyStep(step));
}

export interface GateResult {
    pipelineDriving: boolean;
    mutatingFix: boolean;
    maxRetryPresent: boolean;
    implementHeavy: boolean;
    refuse: boolean;
    advisory: boolean;
    message: string | null;
    exitCode: 0 | 1 | 2;
}

/**
 * Phase 1.0 + W8 gate decision. Pure — no I/O. The CLI wrapper prints and exits.
 *
 * Refuse condition (task 0293 R1) is the union of two **independent** mutation
 * sources, each gated on `!maxRetryPresent`:
 *
 *   1. pipeline-driving testee (`--next`, `dev-run`, …) — refuses because the
 *      testee chains lifecycle legs whose cumulative blast radius the driver
 *      cannot pre-attribute.
 *   2. mutating `--fix` mode (`--fix all` / `--fix blockers-first`) — refuses
 *      because the testee itself applies Edit/Write repairs even with no
 *      pipeline token. `--max-retry 0` bounds the **driver** only; the testee
 *      still mutates (honesty note in MUTATING_FIX_REFUSE_MESSAGE).
 *
 * Pipeline-driving is reported first when both co-occur (its refuse message is
 * the superset — chain + tree mutation).
 */
export function evaluateDogfoodGate(
    testee: string,
    options: { maxRetryPresent?: boolean; steps?: string[] } = {},
): GateResult {
    const maxRetryPresent = options.maxRetryPresent === true;
    const steps = options.steps ?? [];
    const pipelineDriving = detectPipelineDriving(testee);
    const mutatingFix = hasMutatingFixMode(testee);
    const implementHeavy = detectImplementHeavy(testee, steps);

    if (pipelineDriving && !maxRetryPresent) {
        return {
            pipelineDriving,
            mutatingFix,
            maxRetryPresent,
            implementHeavy,
            refuse: true,
            advisory: false,
            message: PIPELINE_DRIVING_REFUSE_MESSAGE,
            exitCode: 2,
        };
    }

    if (mutatingFix && !maxRetryPresent) {
        return {
            pipelineDriving,
            mutatingFix,
            maxRetryPresent,
            implementHeavy,
            refuse: true,
            advisory: false,
            message: MUTATING_FIX_REFUSE_MESSAGE,
            exitCode: 2,
        };
    }

    if (implementHeavy) {
        return {
            pipelineDriving,
            mutatingFix,
            maxRetryPresent,
            implementHeavy,
            refuse: false,
            advisory: true,
            message: IMPLEMENT_HEAVY_ADVISORY_MESSAGE,
            exitCode: 0,
        };
    }

    return {
        pipelineDriving,
        mutatingFix,
        maxRetryPresent,
        implementHeavy,
        refuse: false,
        advisory: false,
        message: null,
        exitCode: 0,
    };
}

export { PIPELINE_TOKENS };

// ── CLI entry (live Phase 1.0 gate) ──────────────────────────────────────────

export interface CliArgs {
    testee: string | null;
    maxRetryPresent: boolean;
    steps: string[];
    json: boolean;
    help: boolean;
}

/** Parse CLI argv (everything after the script name). Exported for unit tests. */
export function parseCliArgs(argv: string[]): CliArgs {
    let testee: string | null = null;
    let maxRetryPresent = false;
    let steps: string[] = [];
    let json = false;
    let help = false;

    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--help' || a === '-h') {
            help = true;
        } else if (a === '--json') {
            json = true;
        } else if (a === '--max-retry-present') {
            maxRetryPresent = true;
        } else if (a === '--testee') {
            testee = argv[++i] ?? null;
        } else if (a === '--steps') {
            const raw = argv[++i] ?? '';
            steps =
                raw.length === 0
                    ? []
                    : raw
                          .split('||')
                          .map((s) => s.trim())
                          .filter(Boolean);
        } else if (a === '--') {
            testee = argv.slice(i + 1).join(' ');
            break;
        } else if (!a.startsWith('-') && testee === null) {
            testee = a;
        }
    }

    return { testee, maxRetryPresent, steps, json, help };
}

export const CLI_USAGE = `Usage:
  bun plugins/sp/scripts/dogfood-testing/detect-pipeline-driving.ts \\
    --testee "<testee string>" [--max-retry-present] [--steps "s1||s2"] [--json]

Exit codes:
  0  proceed (stdout may carry implement-heavy advisory)
  2  refuse — pipeline-driving OR mutating --fix mode without --max-retry
  1  usage error

Phase 1.0: run BEFORE deriving steps (omit --steps).
Phase 1 W8: re-run AFTER step derivation with --steps "label1||label2".`;

/**
 * Pure CLI runner for tests: returns { exitCode, stdout, stderr } without
 * process.exit / console I/O side effects.
 */
export function runCli(argv: string[]): { exitCode: number; stdout: string; stderr: string } {
    const { testee, maxRetryPresent, steps, json, help } = parseCliArgs(argv);
    if (help) {
        return { exitCode: 0, stdout: '', stderr: CLI_USAGE };
    }
    if (testee === null || testee.length === 0) {
        return { exitCode: 1, stdout: '', stderr: CLI_USAGE };
    }

    const result = evaluateDogfoodGate(testee, { maxRetryPresent, steps });
    if (json) {
        return { exitCode: result.exitCode, stdout: `${JSON.stringify(result, null, 2)}\n`, stderr: '' };
    }
    if (result.message) {
        return { exitCode: result.exitCode, stdout: `${result.message}\n`, stderr: '' };
    }
    return { exitCode: result.exitCode, stdout: '', stderr: '' };
}

if (import.meta.main) {
    const { exitCode, stdout, stderr } = runCli(process.argv.slice(2));
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(`${stderr}\n`);
    process.exit(exitCode);
}
