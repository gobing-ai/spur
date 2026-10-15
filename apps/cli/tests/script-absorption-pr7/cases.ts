/**
 * Script-absorption PR-7 golden cases: each runs the retired plugin script (legacy) and the
 * `spur` verb that replaces it (cli) with the same inputs. `capture.ts` froze the legacy side into
 * `fixtures/script-absorption-pr7-golden.json` from origin/main before the scripts were deleted.
 */
export interface Pr7Case {
    name: string;
    /** Retired script path relative to the plugin root, plus its argv. */
    legacy: readonly string[];
    /** argv after `spur`. */
    cli: readonly string[];
    /** `full` compares exit + stdout + stderr (after rewrites); `stdout` skips stderr; `exit` only the code. */
    compare?: 'full' | 'stdout' | 'exit';
}

const GATE = 'scripts/dogfood-testing/detect-pipeline-driving.ts';
const VALIDATE = 'scripts/dogfood-testing/validate-report.ts';
const PR = 'scripts/pr-reviewing.ts';
/** Fixture placeholder: replaced with the absolute fixtures dir at run time. */
export const FIXTURE_DIR_TOKEN = '<FIXTURES>';

export const PR7_CASES: readonly Pr7Case[] = [
    {
        name: 'gate refuses pipeline-driving',
        legacy: [GATE, '--testee', '/sp:dev-run 0125 --auto'],
        cli: ['agent', 'dogfood', 'gate', '--testee', '/sp:dev-run 0125 --auto'],
    },
    {
        name: 'gate refuses mutating fix',
        legacy: [GATE, '--testee', '/sp:dev-verify 0299 --force --fix all'],
        cli: ['agent', 'dogfood', 'gate', '--testee', '/sp:dev-verify 0299 --force --fix all'],
    },
    {
        name: 'gate proceeds with max-retry',
        legacy: [GATE, '--testee', '/sp:dev-run 0125 --auto', '--max-retry-present'],
        cli: ['agent', 'dogfood', 'gate', '--testee', '/sp:dev-run 0125 --auto', '--max-retry-present'],
    },
    {
        name: 'gate advisory on implement-heavy steps',
        legacy: [
            GATE,
            '--testee',
            '/sp:dev-verify 0299 --fix all',
            '--max-retry-present',
            '--steps',
            'implement||test',
        ],
        cli: [
            'agent',
            'dogfood',
            'gate',
            '--testee',
            '/sp:dev-verify 0299 --fix all',
            '--max-retry-present',
            '--steps',
            'implement||test',
        ],
    },
    {
        name: 'gate clean json',
        legacy: [GATE, '--testee', '/sp:dev-verify 0277', '--json'],
        cli: ['agent', 'dogfood', 'gate', '--testee', '/sp:dev-verify 0277', '--json'],
    },
    {
        name: 'gate refuse json',
        legacy: [GATE, '--testee', '/sp:dev-runall --feature M1', '--json'],
        cli: ['agent', 'dogfood', 'gate', '--testee', '/sp:dev-runall --feature M1', '--json'],
    },
    {
        name: 'gate positional testee',
        legacy: [GATE, '/sp:dev-run 0125'],
        cli: ['agent', 'dogfood', 'gate', '/sp:dev-run 0125'],
    },
    { name: 'gate usage error', legacy: [GATE], cli: ['agent', 'dogfood', 'gate'] },
    {
        name: 'validate complete report',
        legacy: [VALIDATE, '--file', `${FIXTURE_DIR_TOKEN}/report-complete.md`],
        cli: ['agent', 'dogfood', 'validate-report', '--file', `${FIXTURE_DIR_TOKEN}/report-complete.md`],
    },
    {
        name: 'validate missing footer',
        legacy: [VALIDATE, '--file', `${FIXTURE_DIR_TOKEN}/report-missing-footer.md`],
        cli: ['agent', 'dogfood', 'validate-report', '--file', `${FIXTURE_DIR_TOKEN}/report-missing-footer.md`],
    },
    {
        name: 'validate missing footer json',
        legacy: [VALIDATE, '--file', `${FIXTURE_DIR_TOKEN}/report-missing-footer.md`, '--json'],
        cli: [
            'agent',
            'dogfood',
            'validate-report',
            '--file',
            `${FIXTURE_DIR_TOKEN}/report-missing-footer.md`,
            '--json',
        ],
    },
    {
        name: 'validate complete json positional',
        legacy: [VALIDATE, `${FIXTURE_DIR_TOKEN}/report-complete.md`, '--json'],
        cli: ['agent', 'dogfood', 'validate-report', `${FIXTURE_DIR_TOKEN}/report-complete.md`, '--json'],
    },
    { name: 'validate usage error', legacy: [VALIDATE], cli: ['agent', 'dogfood', 'validate-report'] },
    {
        name: 'validate unreadable file',
        legacy: [VALIDATE, '--file', `${FIXTURE_DIR_TOKEN}/does-not-exist.md`],
        cli: ['agent', 'dogfood', 'validate-report', '--file', `${FIXTURE_DIR_TOKEN}/does-not-exist.md`],
    },
    { name: 'pr unknown subcommand', legacy: [PR, 'bogus'], cli: ['builder', 'pr', 'bogus'] },
    { name: 'pr unknown argument', legacy: [PR, 'wait', '--bogus'], cli: ['builder', 'pr', 'wait', '--bogus'] },
    {
        name: 'pr value flag without value',
        legacy: [PR, 'wait', '--timeout'],
        cli: ['builder', 'pr', 'wait', '--timeout'],
    },
    {
        name: 'pr unknown argument json',
        legacy: [PR, 'collect', '--bogus', '--json'],
        cli: ['builder', 'pr', 'collect', '--bogus', '--json'],
    },
    {
        name: 'pr preflight outside a git repo',
        legacy: [PR, 'preflight', '--json'],
        cli: ['builder', 'pr', 'preflight', '--json'],
        compare: 'stdout',
    },
    { name: 'pr help', legacy: [PR, '--help'], cli: ['builder', 'pr', 'help'], compare: 'exit' },
];
