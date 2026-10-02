/**
 * Task 1050 (feature D62) — task 1041's job-handoff contract, retained in the normal suite.
 *
 * Task 1041 shipped /sp:dev-job-dump and /sp:dev-job-resume as thin wrappers over the shared
 * sp:spur-dev job-dump/job-resume operations and the eight-section job handoff template in
 * dev-operations.md, but its detailed executable checks lived only in disposable scratch
 * scripts (preserved under .spur/memory/runs/session-review-1041/ with input-manifest.json
 * hashes; one also read a historical walkthrough receipt). This file migrates their material
 * assertions so shared handoff-contract drift fails normal Bun discovery in a clean checkout:
 *
 *   - both wrappers: the required `--file <path>` argument contract, the usage line and the
 *     exact shared skill section each wrapper dispatches (generic frontmatter, shared-flag and
 *     markdown-link parity stays with command-contract, command-flag-parity and
 *     skill-structure R16c — this file relies on those gates instead of cloning their parsers);
 *   - the shared handoff template: its eight declared headings and the exclusion of another
 *     job's sample data from the reusable structure;
 *   - the declared job-dump/job-resume obligations: required argument/path validation,
 *     live-state reconciliation, ownership preservation, missing-required versus optional
 *     evidence, and the continuation boundaries (no replayed completion, no invented approvals);
 *   - AC2 negative mutations on isolated in-memory text fixtures prove the checks detect
 *     material drift while tolerating unrelated reference edits; canonical instruction files
 *     are never mutated by a test.
 *
 * These are instruction-contract assertions about declared behavior: they protect the reusable
 * instructions and do not certify that any model executed them. The test reads only the three
 * canonical production files — never .spur/run scratch state or a historical receipt (AC3: no
 * runtime handoff layer, new dependency or public flag is introduced here).
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PLUGIN_ROOT = join(import.meta.dir, '..');
const OPERATIONS_PATH = join(PLUGIN_ROOT, 'skills', 'spur-dev', 'references', 'dev-operations.md');

/** Declared section boundaries in dev-operations.md; each heading occurs exactly once. */
const DUMP_START = '### 11a. job-dump';
const RESUME_START = '### 11b. job-resume';
const TEMPLATE_START = '#### Job handoff template';
const NEXT_SECTION_START = '### 12. brainstorm';

const OPERATIONS = readFileSync(OPERATIONS_PATH, 'utf8');

interface WrapperContract {
    /** Command file under plugins/sp/commands/. */
    file: string;
    /** Usage line showing the required argument. */
    usage: string;
    /** dev-operations.md anchor of the shared section the wrapper dispatches. */
    sharedSectionAnchor: string;
    /** args= operation passed to the sp:spur-dev skill call. */
    skillOperation: string;
}

interface WrapperContracts {
    dump: WrapperContract;
    resume: WrapperContract;
}

const WRAPPERS: WrapperContracts = {
    dump: {
        file: 'dev-job-dump.md',
        usage: '/sp:dev-job-dump --file <path>',
        sharedSectionAnchor: 'dev-operations.md#11a-job-dump',
        skillOperation: 'job-dump',
    },
    resume: {
        file: 'dev-job-resume.md',
        usage: '/sp:dev-job-resume --file <path>',
        sharedSectionAnchor: 'dev-operations.md#11b-job-resume',
        skillOperation: 'job-resume',
    },
};

function wrapperText(file: string): string {
    return readFileSync(join(PLUGIN_ROOT, 'commands', file), 'utf8');
}

/**
 * Slice a reference section by its declared headings. Returns null when either boundary is
 * missing — a renumbered or deleted boundary heading is contract drift, never an empty pass.
 */
function boundedSection(text: string, startHeading: string, endHeading: string): string | null {
    const start = text.indexOf(startHeading);
    if (start === -1) return null;
    const rest = text.slice(start + startHeading.length);
    const end = rest.indexOf(endHeading);
    if (end === -1) return null;
    return rest.slice(0, end);
}

/** Section of the (possibly mutated) reference text, throwing when a boundary heading vanished. */
function sectionBetween(text: string, startHeading: string, endHeading: string): string {
    const section = boundedSection(text, startHeading, endHeading);
    if (section === null) {
        throw new Error(`dev-operations.md lost a job-handoff boundary heading: ${startHeading} / ${endHeading}`);
    }
    return section;
}

const dumpSection = (text = OPERATIONS): string => sectionBetween(text, DUMP_START, RESUME_START);
const resumeSection = (text = OPERATIONS): string => sectionBetween(text, RESUME_START, TEMPLATE_START);
const templateSection = (text = OPERATIONS): string => sectionBetween(text, TEMPLATE_START, NEXT_SECTION_START);

// ─── Wrapper contract: required --file argument plus dispatch to the shared skill section ───

function wrapperViolations(text: string, contract: WrapperContract): string[] {
    const violations: string[] = [];
    if (!text.includes('argument-hint: "--file <path>"')) {
        violations.push(`${contract.file}: argument-hint must declare the required --file <path> option`);
    }
    if (!/^ *\| `--file <path>` \| .*\| required \| *$/m.test(text)) {
        violations.push(`${contract.file}: the Argument Flags table must declare \`--file <path>\` as required`);
    }
    if (!text.includes(contract.usage)) {
        violations.push(`${contract.file}: the Usage section must show ${contract.usage}`);
    }
    if (!text.includes(contract.sharedSectionAnchor)) {
        violations.push(
            `${contract.file}: the Implementation must target the shared section (${contract.sharedSectionAnchor})`,
        );
    }
    const dispatch = `Skill(skill="sp:spur-dev", args="${contract.skillOperation} $ARGUMENTS")`;
    if (!text.includes(dispatch)) {
        violations.push(
            `${contract.file}: must dispatch sp:spur-dev with args "${contract.skillOperation} $ARGUMENTS"`,
        );
    }
    return violations;
}

// ─── Shared handoff template: eight sections, reusable (no other job's sample data) ─────────

const TEMPLATE_HEADINGS = [
    '## Mission',
    // 1052 R3: exact template lines — the verified-stamps live on the real heading line.
    '## Environment (verified <timestamp and timezone>)',
    '## Completed so far',
    '## Remaining work, in order',
    '## Execution mode',
    '## Lessons and rejected approaches',
    '## Constraints and authoritative references',
    '## First actions for the new session',
] as const;

/**
 * Task 1041's session specimens. The template is a reusable structure: another job's task IDs,
 * error names or bypass codenames must never be baked into it.
 */
const SAMPLE_DATA_SPECIMENS = [
    'E71',
    '1024',
    '1025',
    '1026',
    '1027',
    'sp-e71',
    'AccountQuotaExceeded',
    'provenance-bypass',
] as const;

function templateViolations(template: string): string[] {
    const violations: string[] = [];
    // 1052 R3: presence is not enough — each declared heading must be an exact line occurring
    // exactly once, so a duplicated section cannot slip a second template past the slicing.
    for (const heading of TEMPLATE_HEADINGS) {
        const count = headingLineCount(template, heading);
        if (count === 0) violations.push(`template is missing the declared heading: ${heading}`);
        else if (count > 1) {
            violations.push(`template repeats the declared heading ${heading} ${count} times; expected exactly 1`);
        }
    }
    for (const specimen of SAMPLE_DATA_SPECIMENS) {
        if (template.includes(specimen)) violations.push(`template leaks another job's sample data: ${specimen}`);
    }
    return violations;
}

/** Count exact-line occurrences of a heading (no substring matches, no parser). */
function headingLineCount(text: string, heading: string): number {
    return text.split('\n').filter((line) => line === heading).length;
}

/**
 * 1052 R3: each reference slicing boundary must occur exactly once in the whole reference — a
 * duplicate would make indexOf-based slicing silently grab the wrong section half, and a missing
 * one must be a named violation rather than an implicit null slice.
 */
function boundaryViolations(text: string): string[] {
    const violations: string[] = [];
    for (const boundary of [DUMP_START, RESUME_START, TEMPLATE_START, NEXT_SECTION_START]) {
        const count = headingLineCount(text, boundary);
        if (count === 0) violations.push(`dev-operations.md is missing the slicing boundary: ${boundary}`);
        else if (count > 1) {
            violations.push(
                `dev-operations.md repeats the slicing boundary ${boundary} ${count} times; expected exactly 1`,
            );
        }
    }
    return violations;
}

// ─── Declared obligations (migrated from task 1041's instruction-contract check) ────────────

interface DumpObligations {
    pathValidation: string[];
    liveStateVerification: string[];
    snapshotIntegrity: string[];
    continuationBoundary: string[];
}

const DUMP_OBLIGATIONS: DumpObligations = {
    pathValidation: [
        'quoted paths with spaces',
        'missing/empty path',
        'repeated `--file`',
        'unknown flags',
        'extra positional arguments',
        'absolute path before changing directories',
        'directory target',
        'create missing parent directories',
        'task/feature documents cannot be dump targets',
    ],
    liveStateVerification: [
        'Verify repository/worktree paths, branch, HEAD/base, dirty files',
        '`--json`',
        'frozen batch membership',
        'label unavailable facts `unknown`',
    ],
    snapshotIntegrity: ['Redact credentials', 'Construct the complete snapshot before writing', 'Read it back'],
    continuationBoundary: [
        'does not stop an active executor',
        'change lifecycle state, commit, merge, or remove a worktree',
    ],
};

const ALL_DUMP_OBLIGATIONS: string[] = [
    ...DUMP_OBLIGATIONS.pathValidation,
    ...DUMP_OBLIGATIONS.liveStateVerification,
    ...DUMP_OBLIGATIONS.snapshotIntegrity,
    ...DUMP_OBLIGATIONS.continuationBoundary,
];

interface ResumeObligations {
    fileContract: string[];
    liveStateReconciliation: string[];
    evidencePolicy: string[];
    continuationBoundary: string[];
    approvalBoundary: string[];
}

const RESUME_OBLIGATIONS: ResumeObligations = {
    fileContract: [
        'existing, readable, non-empty file',
        'do not create it',
        'Read the entire file before acting',
        'embedded commands must be verified',
        'request missing critical context before dependent work',
    ],
    liveStateReconciliation: [
        'read its `AGENTS.md`',
        'Report drift',
        'verified path mapping',
        'Never silently fall back',
        'Preserve dirty changes and ownership',
        'active executors',
        'one writer per tree',
        '`--json`',
    ],
    evidencePolicy: [
        'Skip confirmed completed work',
        'Missing optional notes trigger focused rediscovery',
        'missing required evidence/checkpoints',
        'incompatible state stop',
    ],
    continuationBoundary: [
        'existing lifecycle/competency owner',
        'rather than replaying the original invocation',
        'frozen remaining set',
        'matching live run',
        'never fabricate a paused snapshot',
    ],
    approvalBoundary: ['Required approvals stay pending', 'retain work and evidence on partial success or failure'],
};

const ALL_RESUME_OBLIGATIONS: string[] = [
    ...RESUME_OBLIGATIONS.fileContract,
    ...RESUME_OBLIGATIONS.liveStateReconciliation,
    ...RESUME_OBLIGATIONS.evidencePolicy,
    ...RESUME_OBLIGATIONS.continuationBoundary,
    ...RESUME_OBLIGATIONS.approvalBoundary,
];

function obligationViolations(section: string, label: string, obligations: string[]): string[] {
    return obligations
        .filter((obligation) => !section.includes(obligation))
        .map((obligation) => `${label}: missing obligation: ${obligation}`);
}

// ─── R1 — the retained contract passes in the normal suite with no scratch input ────────────

describe('1050 R1 — wrappers and the shared handoff template survive clean checkouts', () => {
    test('both thin wrappers carry the required --file contract and dispatch their shared skill section', () => {
        expect(wrapperViolations(wrapperText(WRAPPERS.dump.file), WRAPPERS.dump)).toEqual([]);
        expect(wrapperViolations(wrapperText(WRAPPERS.resume.file), WRAPPERS.resume)).toEqual([]);
    });

    test("the shared handoff template keeps its eight sections and stays free of other jobs' sample data", () => {
        expect(templateViolations(templateSection())).toEqual([]);
    });

    // 1052 R3: exact uniqueness of the slicing boundaries in the owning reference.
    test('each slicing boundary occurs exactly once in dev-operations.md', () => {
        expect(boundaryViolations(OPERATIONS)).toEqual([]);
    });
});

// ─── 1052 R3 — isolated duplicate/missing-heading mutations fail with named violations ─────

describe('1052 R3 — duplicate/missing headings produce named violations', () => {
    test('a duplicated slicing boundary is a named violation', () => {
        const duplicated = OPERATIONS.replace(`${DUMP_START}\n`, `${DUMP_START}\n${DUMP_START}\n`);
        expect(duplicated).not.toBe(OPERATIONS);
        expect(boundaryViolations(duplicated)).toContain(
            `dev-operations.md repeats the slicing boundary ${DUMP_START} 2 times; expected exactly 1`,
        );
    });

    test('a missing slicing boundary is a named violation', () => {
        const missing = OPERATIONS.replace(`\n${NEXT_SECTION_START}\n`, '\n### 12. brainstorm-renamed\n');
        expect(missing).not.toBe(OPERATIONS);
        expect(boundaryViolations(missing)).toContain(
            `dev-operations.md is missing the slicing boundary: ${NEXT_SECTION_START}`,
        );
    });

    test('a duplicated template heading is a named violation', () => {
        const template = templateSection();
        const duplicated = template.replace('## Mission\n', '## Mission\n## Mission\n');
        expect(duplicated).not.toBe(template);
        expect(templateViolations(duplicated)).toContain(
            'template repeats the declared heading ## Mission 2 times; expected exactly 1',
        );
    });
});

// ─── R2 — declared job-dump obligations ─────────────────────────────────────────────────────

describe('1050 R2 — declared job-dump obligations', () => {
    test('required argument/path validation, including the CLI-gated corpus-write exclusion', () => {
        expect(obligationViolations(dumpSection(), 'job-dump', DUMP_OBLIGATIONS.pathValidation)).toEqual([]);
    });

    test('live-state verification is recorded through the CLI facade with --json', () => {
        expect(obligationViolations(dumpSection(), 'job-dump', DUMP_OBLIGATIONS.liveStateVerification)).toEqual([]);
    });

    test('the complete snapshot is redacted, written, then read back', () => {
        expect(obligationViolations(dumpSection(), 'job-dump', DUMP_OBLIGATIONS.snapshotIntegrity)).toEqual([]);
    });

    test('dumping transfers context only — no executor stop, lifecycle, commit, merge or worktree change', () => {
        expect(obligationViolations(dumpSection(), 'job-dump', DUMP_OBLIGATIONS.continuationBoundary)).toEqual([]);
    });
});

// ─── R2 — declared job-resume obligations ───────────────────────────────────────────────────

describe('1050 R2 — declared job-resume obligations', () => {
    test('the file contract: read an existing handoff, never create or blindly execute it', () => {
        expect(obligationViolations(resumeSection(), 'job-resume', RESUME_OBLIGATIONS.fileContract)).toEqual([]);
    });

    test('live-state reconciliation in the recorded tree preserves ownership (one writer per tree)', () => {
        expect(obligationViolations(resumeSection(), 'job-resume', RESUME_OBLIGATIONS.liveStateReconciliation)).toEqual(
            [],
        );
    });

    test('missing required evidence stops the continuation; only optional notes are rediscovered', () => {
        expect(obligationViolations(resumeSection(), 'job-resume', RESUME_OBLIGATIONS.evidencePolicy)).toEqual([]);
    });

    test('continuation runs through the existing owner — completion is never replayed or fabricated', () => {
        expect(obligationViolations(resumeSection(), 'job-resume', RESUME_OBLIGATIONS.continuationBoundary)).toEqual(
            [],
        );
    });

    test('approvals stay pending and partial success retains work and evidence', () => {
        expect(obligationViolations(resumeSection(), 'job-resume', RESUME_OBLIGATIONS.approvalBoundary)).toEqual([]);
    });
});

// ─── AC2 — material drift is detected; unrelated reference edits are not ────────────────────

describe('1050 AC2 — material drift is detected, unrelated reference edits are not', () => {
    /** Apply one fixture mutation; a no-op mutation would prove nothing, so fail on it. */
    function mutate(text: string, from: string | RegExp, to: string): string {
        const next = text.replace(from, to);
        expect(next).not.toBe(text);
        return next;
    }

    test('removing the required --file contract from a wrapper fails its wrapper check', () => {
        const withoutFileRow = mutate(wrapperText(WRAPPERS.dump.file), /^ *\| `--file <path>` \|.*\n/m, '');
        expect(wrapperViolations(withoutFileRow, WRAPPERS.dump)).toContain(
            'dev-job-dump.md: the Argument Flags table must declare `--file <path>` as required',
        );
    });

    test('removing one template heading fails the eight-section check', () => {
        const withoutExecutionMode = mutate(templateSection(), '## Execution mode\n', '');
        expect(templateViolations(withoutExecutionMode)).toContain(
            'template is missing the declared heading: ## Execution mode',
        );
    });

    test('removing the approval boundary fails the resume check', () => {
        const withoutApprovals = mutate(
            resumeSection(),
            'Required approvals stay pending; saved `--auto` or narration does not grant new irreversible actions. ',
            '',
        );
        expect(obligationViolations(withoutApprovals, 'job-resume', RESUME_OBLIGATIONS.approvalBoundary)).toContain(
            'job-resume: missing obligation: Required approvals stay pending',
        );
    });

    test('removing a completed-work/live-state reconciliation obligation fails its check', () => {
        const withoutCompletedSkip = mutate(
            resumeSection(),
            'Skip confirmed completed work; unproven completion stays unverified. ',
            '',
        );
        expect(obligationViolations(withoutCompletedSkip, 'job-resume', RESUME_OBLIGATIONS.evidencePolicy)).toContain(
            'job-resume: missing obligation: Skip confirmed completed work',
        );
        const withoutGitVerification = mutate(
            dumpSection(),
            'Verify repository/worktree paths, branch, HEAD/base, dirty files and relevant commits with Git. ',
            '',
        );
        expect(
            obligationViolations(withoutGitVerification, 'job-dump', DUMP_OBLIGATIONS.liveStateVerification),
        ).toContain('job-dump: missing obligation: Verify repository/worktree paths, branch, HEAD/base, dirty files');
    });

    test("another job's sample data leaking into the template fails the exclusion check", () => {
        const withLeak = mutate(
            templateSection(),
            '## Lessons and rejected approaches',
            '## Lessons and rejected approaches\n<Stale AccountQuotaExceeded note carried over from job sp-e71.>',
        );
        expect(templateViolations(withLeak)).toContain(
            "template leaks another job's sample data: AccountQuotaExceeded",
        );
    });

    test('control: unrelated reference edits and legitimate template additions pass every check', () => {
        const unrelatedEdit = mutate(
            OPERATIONS,
            'Interactive solution design — heuristic discovery interview (grilling)',
            'Interactive design review — heuristic discovery interview (grilling)',
        );
        expect(templateViolations(templateSection(unrelatedEdit))).toEqual([]);
        expect(boundaryViolations(unrelatedEdit)).toEqual([]);
        expect(obligationViolations(dumpSection(unrelatedEdit), 'job-dump', ALL_DUMP_OBLIGATIONS)).toEqual([]);
        expect(obligationViolations(resumeSection(unrelatedEdit), 'job-resume', ALL_RESUME_OBLIGATIONS)).toEqual([]);

        const appendedTemplate = mutate(
            templateSection(),
            '<Verified pitfalls, discoveries and approaches ruled out, with evidence.>',
            '<Verified pitfalls, discoveries and approaches ruled out, with evidence. Link prior handoff files when they stay durable.>',
        );
        expect(templateViolations(appendedTemplate)).toEqual([]);
    });
});
