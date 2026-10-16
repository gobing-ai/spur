/**
 * Script-absorption PR-6 golden cases: each runs the retired plugin script (legacy) and the
 * `spur` verb that replaces it (cli) with the same inputs. `capture.ts` froze the legacy side into
 * `fixtures/script-absorption-pr6-golden.json` before the scripts were deleted.
 */
export interface Pr6Case {
    name: string;
    /** Retired script path relative to the plugin root, plus its argv. */
    legacy: readonly string[];
    /** argv after `spur`. */
    cli: readonly string[];
    /** Extra env for both sides (values may carry the fixture token). */
    env?: Readonly<Record<string, string>>;
    /** A file (relative to the scratch cwd) the op writes; its content is appended to stdout. */
    readBack?: string;
    /** Wall-clock stamps to replace with `<NOW>` before comparing. */
    scrubClock?: boolean;
    /**
     * Documented, intended output deltas applied to the legacy golden before comparing
     * ([from, to] literal replacements on stdout).
     */
    stdoutDelta?: readonly (readonly [string, string])[];
    /** `full` compares exit + stdout + stderr (after rewrites); `stdout` skips stderr; `exit` only the code. */
    compare?: 'full' | 'stdout' | 'exit';
}

const HA = 'scripts/history-anatomy-cache.ts';
const TL = 'scripts/session-timeline.ts';
const RS = 'scripts/run-summary.ts';
const SP = 'scripts/workflow-step-profile.ts';
const DS = 'scripts/daily-summary/daily-summary.ts';
/** Fixture placeholder: replaced with the absolute fixtures dir at run time. */
export const FIXTURE_DIR_TOKEN = '<FIXTURES>';
const F = (name: string): string => `${FIXTURE_DIR_TOKEN}/${name}`;

/** Same argv on both sides: `legacy` gets the script prefix, `cli` the noun/verb prefix. */
function pair(
    name: string,
    script: string,
    verb: readonly string[],
    argv: readonly string[],
    extra: Partial<Pr6Case> = {},
): Pr6Case {
    return { name, legacy: [script, ...argv], cli: [...verb, ...argv], ...extra };
}

const ANATOMY = ['history', 'anatomy'];
const TIMELINE = ['history', 'timeline'];
const WSUMMARY = ['workflow', 'summary'];
const PROFILE = ['workflow', 'profile'];
const DSUMMARY = ['history', 'summary'];

export const PR6_CASES: readonly Pr6Case[] = [
    // ── spur history anatomy (history-anatomy-cache) ──
    pair('anatomy digest', HA, ANATOMY, ['digest', F('ha-artifact.json')]),
    pair('anatomy check pass', HA, ANATOMY, ['check', F('ha-report-good.md')]),
    pair('anatomy check bad category', HA, ANATOMY, ['check', F('ha-report-bad-category.md')]),
    pair('anatomy check missing sections', HA, ANATOMY, ['check', F('ha-report-missing.md')]),
    pair('anatomy check usage', HA, ANATOMY, ['check']),
    pair('anatomy unknown op', HA, ANATOMY, ['bogus']),
    pair('anatomy no op', HA, ANATOMY, []),
    pair(
        'anatomy paths env',
        HA,
        ANATOMY,
        ['paths', '--helper', F('ha-artifact.json'), '--date', '2026-08-24', '--out', 'paths.env'],
        { readBack: 'paths.env' },
    ),
    pair(
        'anatomy paths daily rejects --output',
        HA,
        ANATOMY,
        [
            'paths',
            '--helper',
            F('ha-artifact.json'),
            '--date',
            '2026-08-24',
            '--output',
            'docs/report/custom.md',
            '--out',
            'paths.env',
        ],
        { readBack: 'paths.env' },
    ),
    pair(
        'anatomy paths bad date',
        HA,
        ANATOMY,
        ['paths', '--helper', F('ha-artifact.json'), '--date', '2026-13-40', '--out', 'paths.env'],
        { readBack: 'paths.env' },
    ),
    pair('anatomy paths no out', HA, ANATOMY, ['paths', '--helper', F('ha-artifact.json')]),
    // ── spur history timeline (session-timeline) ──
    pair('timeline no session', TL, TIMELINE, []),
    pair('timeline claude transcript', TL, TIMELINE, ['--transcript', F('transcript.jsonl')]),
    pair('timeline grouped', TL, TIMELINE, ['--transcript', F('transcript.jsonl'), '--group', '1,2']),
    pair('timeline bad group', TL, TIMELINE, ['--transcript', F('transcript.jsonl'), '--group', '3-1']),
    pair('timeline missing transcript', TL, TIMELINE, ['--transcript', F('no-such.jsonl')]),
    pair('timeline pi transcript', TL, TIMELINE, ['--transcript', F('pi-session.jsonl')]),
    pair('timeline pi via PI_SESSION_FILE', TL, TIMELINE, [], { env: { PI_SESSION_FILE: F('pi-session.jsonl') } }),
    // ── spur workflow summary (run-summary) ──
    pair('summary usage', RS, WSUMMARY, []),
    pair('summary progress json', RS, WSUMMARY, [
        '--progress',
        F('progress-r1.json'),
        '--transcript',
        F('transcript.jsonl'),
    ]),
    pair('summary progress markdown', RS, WSUMMARY, [
        '--progress',
        `r1=${F('progress-r1.json')}`,
        '--transcript',
        F('transcript.jsonl'),
        '--markdown',
    ]),
    pair('summary since', RS, WSUMMARY, [
        '--progress',
        F('progress-r1.json'),
        '--transcript',
        F('transcript.jsonl'),
        '--since',
        '2026-10-04T03:00:20.000Z',
    ]),
    pair('summary no transcript', RS, WSUMMARY, ['--progress', F('progress-r1.json')]),
    pair('summary untimed progress', RS, WSUMMARY, [
        '--progress',
        F('progress-untimed.json'),
        '--transcript',
        F('transcript.jsonl'),
    ]),
    pair('summary malformed progress', RS, WSUMMARY, [
        '--progress',
        F('transcript.jsonl'),
        '--transcript',
        F('transcript.jsonl'),
    ]),
    pair('summary rollup json', RS, WSUMMARY, [
        '--rollup',
        `a=${F('ra-summary.json')}`,
        '--rollup',
        `b=${F('rb-summary.json')}`,
    ]),
    pair('summary rollup markdown', RS, WSUMMARY, [
        '--rollup',
        F('ra-summary.json'),
        '--rollup',
        F('rb-summary.json'),
        '--markdown',
    ]),
    pair('summary rollup with progress', RS, WSUMMARY, [
        '--rollup',
        F('ra-summary.json'),
        '--progress',
        F('progress-r1.json'),
    ]),
    // ── spur workflow profile (workflow-step-profile) ──
    pair('profile json', SP, PROFILE, ['idea-pipeline', '--json', '--spur-bin', F('spur-stub.sh')]),
    pair('profile human', SP, PROFILE, ['idea-pipeline', '--spur-bin', F('spur-stub.sh')]),
    pair('profile window and last', SP, PROFILE, [
        'idea-pipeline',
        '--last',
        '1',
        '--window',
        '60',
        '--json',
        '--spur-bin',
        F('spur-stub.sh'),
    ]),
    pair('profile failing spur', SP, PROFILE, ['idea-pipeline', '--spur-bin', F('no-such-spur')]),
    // ── spur history summary (daily-summary) ──
    pair('daily summary dry run', DS, DSUMMARY, ['--date', '2026-01-02', '--dry-run', '--no-git', '--no-ccusage'], {
        env: { SP_DAILY_SUMMARY_NO_PROMPT: '1' },
        scrubClock: true,
        // Intended delta: the retired script loaded `readHistoryHealth` through the generated
        // inline-run app bundle, which a scratch cwd cannot resolve, so it silently reported the
        // history section unavailable. `spur history summary` calls the app in-process and reads
        // the project `.spur/spur.db` (bootstrapped by the CLI), so an empty day is "Clean".
        stdoutDelta: [
            [
                '- **Platforms:** unknown\n',
                '- **Platforms:** Spur History\n\n## Execution Loops & Health Findings\n\n- **Status:** ✅ Clean — No execution loops or tool calls recorded for this date.\n',
            ],
            ['   Platforms: none\n', '   Platforms: Spur History\n'],
        ],
    }),
];
