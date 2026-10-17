/**
 * Thin-wrapper integration tests for `spur task verdict` (apps/cli/src/commands/task/verdict.ts).
 * Behavioral tests for TaskService live in packages/app/tests/services/task-service.test.ts.
 *
 * These exercise the verb surface through the real `main()` entry point:
 * golden paths, the `--json` envelope shape, and exit codes 0/1/2 (design §10, R5).
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, rmSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { main } from '../../../src/index';
import { type CapturedOutput, createCapturedOutput } from '../../helpers';

let cwd: string;

beforeAll(async () => {
    cwd = join(join(import.meta.dir, '..'), '..', `.tmp-verdict-task-test-${Date.now()}`);
    await mkdir(join(cwd, 'docs', 'tasks'), { recursive: true });
    // Materialize the file the fixtures cite as their evidence anchor. Since the 0994
    // follow-up a live record's Testing/Solution `file:line` anchor must RESOLVE at the
    // `--as done` guard (`L4.anchor-unresolved` is an error there), so a fixture citing a
    // path that does not exist would be denied by the anchor gate before the behaviour
    // each test below exists to exercise. Every fixture cites line 1 of this file.
    const evidenceTarget = join(cwd, 'apps', 'cli', 'src', 'commands', 'task.ts');
    await mkdir(join(evidenceTarget, '..'), { recursive: true });
    await writeFile(evidenceTarget, '// fixture evidence target (no real code)\nexport {};\n', 'utf-8');
});

afterAll(() => {
    rmSync(cwd, { recursive: true, force: true });
});

/** The file path printed by `task create` ("Created task NNNN: <path>"). */
function createdPath(output: CapturedOutput): string {
    const msg = output.messages.find((m) => m.startsWith('Created task'));
    if (msg === undefined) throw new Error(`no "Created task" line in: ${output.messages.join(' | ')}`);
    const path = msg.split(': ')[1];
    if (path === undefined) throw new Error(`could not parse path from: ${msg}`);
    return path;
}

/** The WBS embedded in the `task create` confirmation line. */
function createdWbs(output: CapturedOutput): string {
    const match = createdPath(output).match(/(\d{4})_/);
    if (match?.[1] === undefined) throw new Error(`no WBS in created path`);
    return match[1];
}

/** The last captured message, or a throwing guard for empty output. */
function lastMessage(output: CapturedOutput): string {
    const msg = output.messages.at(-1);
    if (msg === undefined) throw new Error('no output captured');
    return msg;
}

describe('spur task CLI', () => {
    // ── verdict ──
    // The verdict command reads the answer file and writes .spur/run/<wbs>-verdict.json
    // relative to the process cwd (not the test cwd), so we pass an absolute --from-answer
    // and clean the emitted artifact afterward to keep the repo tree clean.
    const verdictArtifacts: string[] = [];
    afterAll(() => {
        for (const p of verdictArtifacts) rmSync(p, { force: true });
    });

    test('verdict derives PASS from an all-MET answer table and writes the artifact', async () => {
        const answerPath = join(cwd, '8001-verify-answer.txt');
        await Bun.write(answerPath, '| Req | Status | Evidence |\n|-----|--------|----------|\n| R1 | MET | done |\n');
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'verdict', '8001', '--from-answer', answerPath, '--json'], {
            cwd,
            output,
        });
        verdictArtifacts.push(join(process.cwd(), '.spur', 'run', '8001-verdict.json'));
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lastMessage(output));
        expect(parsed.verdict).toBe('PASS');
        expect(parsed.wbs).toBe('8001');
        expect(parsed.source).toBe('spur-task-verdict');
    });
    test('verdict (human output) prints a verdict summary line', async () => {
        const answerPath = join(cwd, '8002-verify-answer.txt');
        await Bun.write(answerPath, '| Req | Status | Evidence |\n|-----|--------|----------|\n| R1 | MET | done |\n');
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'verdict', '8002', '--from-answer', answerPath], { cwd, output });
        verdictArtifacts.push(join(process.cwd(), '.spur', 'run', '8002-verdict.json'));
        expect(exitCode).toBe(0);
        expect(lastMessage(output)).toContain('Verdict: PASS');
    });
    test('verdict fails closed on a hollow MET row (0721): PARTIAL + exit 1', async () => {
        // An evidence-less requirement table parses but records nothing — the
        // aggregate must be PARTIAL (exit 1), never PASS.
        const answerPath = join(cwd, '8002b-verify-answer.txt');
        await Bun.write(answerPath, '| Req | Status | Evidence |\n|-----|--------|----------|\n| R1 | MET |  |\n');
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'verdict', '8002b', '--from-answer', answerPath], { cwd, output });
        verdictArtifacts.push(join(process.cwd(), '.spur', 'run', '8002b-verdict.json'));
        expect(exitCode).toBe(1);
        expect(lastMessage(output)).toContain('Verdict: PARTIAL');
    });
    test('verdict downgrades behavior-bearing AC without executable evidence', async () => {
        const answerPath = join(cwd, '8005-verify-answer.txt');
        await Bun.write(
            answerPath,
            [
                '| Req | Status | Evidence |',
                '|-----|--------|----------|',
                '| R1 | MET | `apps/cli/src/commands/task.ts:1` |',
                '',
                '| AC | Status | Evidence Type | Evidence |',
                '|----|--------|---------------|----------|',
                '| Scenario: CLI emits JSON | MET | static-ref | `apps/cli/src/commands/task.ts:1` |',
            ].join('\n'),
        );
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'verdict', '8005', '--from-answer', answerPath, '--json'], {
            cwd,
            output,
        });
        verdictArtifacts.push(join(process.cwd(), '.spur', 'run', '8005-verdict.json'));
        expect(exitCode).toBe(1);
        const parsed = JSON.parse(lastMessage(output));
        expect(parsed.verdict).toBe('PARTIAL');
        expect(parsed.acceptanceCriteria[0].status).toBe('PARTIAL');
        expect(parsed.checks.some((check: { name: string }) => check.name === 'evidence-rule-failed')).toBe(true);
    });
    test('verdict honors an AC exemption tag only when the task file carries it (P2)', async () => {
        const createOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Exemption fixture'], { cwd, output: createOut });
        const wbs = createdWbs(createOut);
        const acFile = join(cwd, `${wbs}-ac.md`);
        const answerPath = join(cwd, `${wbs}-verify-answer.txt`);
        const reqFile = join(cwd, `${wbs}-req.md`);
        await Bun.write(reqFile, 'R1. The help text must name the verb.\n');
        await main(['task', 'update', wbs, '--section', 'Requirements', '--from-file', reqFile], {
            cwd,
            output: createCapturedOutput(),
        });
        const answer = (tag: string) =>
            [
                'Verdict: PASS',
                'Confidence: MEDIUM',
                '',
                '| Req | Status | Evidence |',
                '|-----|--------|----------|',
                '| R1 | MET | `apps/cli/src/commands/task.ts:1` |',
                '',
                '| AC | Status | Evidence Type | Evidence |',
                '|----|--------|---------------|----------|',
                `| ${tag}The help text names the verb | MET | static-ref | \`apps/cli/src/commands/task.ts:1\` |`,
            ].join('\n');
        const runVerdict = async (taskItem: string): Promise<{ verdict: string; checks: { name: string }[] }> => {
            await Bun.write(acFile, `- [x] ${taskItem}\n`);
            await main(['task', 'update', wbs, '--section', 'Acceptance Criteria', '--from-file', acFile], {
                cwd,
                output: createCapturedOutput(),
            });
            await Bun.write(answerPath, answer('[docs-only] '));
            const output = createCapturedOutput();
            await main(['task', 'verdict', wbs, '--from-answer', answerPath, '--json'], { cwd, output });
            return JSON.parse(lastMessage(output));
        };
        verdictArtifacts.push(join(process.cwd(), '.spur', 'run', `${wbs}-verdict.json`));

        const untagged = await runVerdict('The help text names the verb');
        expect(untagged.verdict).toBe('PARTIAL');
        expect(untagged.checks.some((c) => c.name === 'ac-exemption-not-in-task')).toBe(true);

        const tagged = await runVerdict('[docs-only] The help text names the verb');
        expect(tagged.checks.some((c) => c.name === 'ac-exemption-not-in-task')).toBe(false);
        expect(tagged.checks.some((c) => c.name === 'evidence-rule-pass')).toBe(true);
    });
    test('verdict exits 1 on UNKNOWN when the answer has no parseable requirements', async () => {
        const answerPath = join(cwd, '8003-verify-answer.txt');
        await Bun.write(answerPath, 'no requirements table here\n');
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'verdict', '8003', '--from-answer', answerPath, '--json'], {
            cwd,
            output,
        });
        verdictArtifacts.push(join(process.cwd(), '.spur', 'run', '8003-verdict.json'));
        expect(exitCode).toBe(1);
        expect(JSON.parse(lastMessage(output)).verdict).toBe('UNKNOWN');
    });
    test('verdict lints the answer before deriving (1003 R2): malformed answer exits 1 with lintFindings', async () => {
        // Real task fixture: the lint resolves the task corpus; a corpus-less answer skips the
        // lint (fail-open mirrors the scenario-key gap posture), so the gate needs a task file.
        const createOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Lint fixture'], { cwd, output: createOut });
        const wbs = createdWbs(createOut);
        const artifactPath = join(process.cwd(), '.spur', 'run', `${wbs}-verdict.json`);
        // Shared repo-root .spur/run: concurrent suite writers can transiently own this path (project
        // root is discovered by walking up from the temp fixture) — clear it before the absence assert.
        rmSync(artifactPath, { force: true });
        const answerPath = join(cwd, `${wbs}-verify-answer.txt`);
        await Bun.write(answerPath, 'no verdict line here\n');
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'verdict', wbs, '--from-answer', answerPath, '--json'], {
            cwd,
            output,
        });
        expect(exitCode).toBe(1);
        const parsed = JSON.parse(lastMessage(output)) as { lintFindings: Array<{ line: number; message: string }> };
        expect(parsed.lintFindings.length).toBeGreaterThan(0);
        expect(parsed.lintFindings[0]?.message).toContain('`Verdict:`');
        // The lint gate fires before any derivation write — no verdict artifact.
        expect(existsSync(artifactPath)).toBe(false);
    });
    test('verdict exits 1 with an error when the answer file is missing', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'verdict', '8004', '--from-answer', join(cwd, 'nope.txt')], {
            cwd,
            output,
        });
        expect(exitCode).toBe(1);
        expect(output.errors.some((e) => e.includes('Answer file not found'))).toBe(true);
    });
});

// ── verdict scenario-key gap (task 0958 R2/AC4) ──
// Prevention at certify time: a covering task whose derived verdict rows name no scenario of
// its linked feature must fail BEFORE the artifact is written. The recorded failure loop
// (runall-d6-4440) was: task reaches done with unkeyed rows → feature done gate rejects →
// manual re-key + re-derive + re-bind.
describe('spur task CLI — verdict scenario-key gate (0958)', () => {
    const AC = [
        '```gherkin',
        'Feature: fallback envelope',
        '  Scenario: R3 — Explicit fallback list is honored in order',
        '    Given x',
        '  Scenario: R6 — Explicit unknown or unconfigured provider still throws at selection',
        '    Given x',
        '```',
    ].join('\n');

    async function seedGapCwd(): Promise<string> {
        const isoCwd = join(join(import.meta.dir, '..'), '..', `.tmp-verdict-task-gap-${Date.now()}`);
        await mkdir(join(isoCwd, 'docs', 'tasks'), { recursive: true });
        await mkdir(join(isoCwd, 'docs', 'features'), { recursive: true });
        await writeFile(
            join(isoCwd, 'docs', 'features', 'D9_fallback-envelope.md'),
            [
                '---',
                'schema_version: 1',
                'id: "D9"',
                'name: "Fallback envelope"',
                'status: verifying',
                'priority: P1',
                'created_at: 2026-09-25T00:00:00.000Z',
                'updated_at: 2026-09-25T00:00:00.000Z',
                '---',
                '',
                '# D9: Fallback envelope',
                '',
                '## Goal',
                '',
                'Fallback selection semantics.',
                '',
                '## Scope',
                '',
                'In scope: envelope and selection.',
                '',
                '## Acceptance Criteria',
                '',
                AC,
                '',
            ].join('\n'),
        );
        await writeFile(
            join(isoCwd, 'docs', 'tasks', '0961_covering-task.md'),
            [
                '---',
                'schema_version: 1',
                'name: "Covering task"',
                'status: wip',
                'feature_id: D9',
                'priority: P1',
                'created_at: 2026-09-25T00:00:00.000Z',
                'updated_at: 2026-09-25T00:00:00.000Z',
                '---',
                '',
                '## 0961. Covering task',
                '',
                '### Requirements',
                '',
                // 1003 R2: `task verdict` owns the answer lint, so the fixture declares the
                // requirement ids its answers key by (lint contract: exact `R<n>` tokens).
                '- [ ] **R1. Envelope shape.** Fallback envelope shape.',
                '- [ ] **R2. Contract honored.** Selection contract.',
                '',
                '### Acceptance Criteria',
                '',
                AC,
                '',
            ].join('\n'),
        );
        return isoCwd;
    }

    const gapArtifacts: string[] = [];
    afterAll(() => {
        for (const p of gapArtifacts) rmSync(p, { force: true });
    });

    test('verdict fails a covering task whose rows name no scenario, before any artifact write', async () => {
        const isoCwd = await seedGapCwd();
        try {
            const answerPath = join(isoCwd, '0961-verify-answer.txt');
            await writeFile(
                answerPath,
                [
                    'Verdict: PASS',
                    'Confidence: HIGH',
                    '',
                    '### Per-Requirement Traceability',
                    '| Req | Status | Evidence |',
                    '|-----|--------|----------|',
                    '| R1 | MET | `src/x.ts:1` |',
                    '| R2 | MET | `src/x.ts:2` |',
                ].join('\n'),
            );
            const output = createCapturedOutput();
            const exitCode = await main(['task', 'verdict', '0961', '--from-answer', answerPath, '--json'], {
                cwd: isoCwd,
                output,
            });
            expect(exitCode).toBe(1);
            // Plain `--json` (raw mode) surfaces writeJsonError text on the error sink.
            const errorText = output.errors.join(' ');
            expect(errorText).toContain('D9');
            expect(errorText).toContain('R2');
            expect(errorText).toContain('(feature R<n>)');
            // No artifact: the failure happens before certification.
            const artifactPath = join(process.cwd(), '.spur', 'run', '0961-verdict.json');
            gapArtifacts.push(artifactPath);
            expect(existsSync(artifactPath)).toBe(false);
        } finally {
            rmSync(isoCwd, { recursive: true, force: true });
        }
    });

    test('verdict passes once one row carries an explicit scenario reference', async () => {
        const isoCwd = await seedGapCwd();
        try {
            const answerPath = join(isoCwd, '0961-verify-answer.txt');
            await writeFile(
                answerPath,
                [
                    'Verdict: PASS',
                    'Confidence: HIGH',
                    '',
                    '### Per-Requirement Traceability',
                    '| Req | Status | Evidence |',
                    '|-----|--------|----------|',
                    '| R1 | MET | `src/x.ts:1` |',
                    '| R2 | MET | `src/x.ts:2` |',
                    '',
                    // 1003 R2: scenario crediting rides an AC row keyed by the scenario title —
                    // the lint's AC-identity contract — so the row clears the scenario-key gap.
                    '### Acceptance Criteria Verification',
                    '| AC | Status | Evidence Type | Evidence |',
                    '| --- | --- | --- | --- |',
                    '| Scenario: R3 — Explicit fallback list is honored in order | MET | test | `tests/fallback.test.ts:3` |',
                ].join('\n'),
            );
            const output = createCapturedOutput();
            const exitCode = await main(['task', 'verdict', '0961', '--from-answer', answerPath, '--json'], {
                cwd: isoCwd,
                output,
            });
            expect(exitCode).toBe(0);
            const artifactPath = join(process.cwd(), '.spur', 'run', '0961-verdict.json');
            gapArtifacts.push(artifactPath);
            expect(existsSync(artifactPath)).toBe(true);
        } finally {
            rmSync(isoCwd, { recursive: true, force: true });
        }
    });

    test('a task with no linked feature keeps verdicting without the gate (R6)', async () => {
        const isoCwd = join(join(import.meta.dir, '..'), '..', `.tmp-verdict-task-gap-none-${Date.now()}`);
        await mkdir(join(isoCwd, 'docs', 'tasks'), { recursive: true });
        try {
            const answerPath = join(isoCwd, '8001-verify-answer.txt');
            await writeFile(
                answerPath,
                '| Req | Status | Evidence |\n|-----|--------|----------|\n| R1 | MET | done |\n',
            );
            const output = createCapturedOutput();
            const exitCode = await main(['task', 'verdict', '8001', '--from-answer', answerPath, '--json'], {
                cwd: isoCwd,
                output,
            });
            expect(exitCode).toBe(0);
            const artifactPath = join(process.cwd(), '.spur', 'run', '8001-verdict.json');
            gapArtifacts.push(artifactPath);
            expect(existsSync(artifactPath)).toBe(true);
        } finally {
            rmSync(isoCwd, { recursive: true, force: true });
        }
    });
});

// ── parent-status link guard under raw --json (task 1132 R2, review residual v) ──
// `task create` already emitted the structured `ok:false` payload; `task update --feature` wrote
// prose to stderr with empty stdout, which automation reading stdout cannot parse.
describe('spur task CLI — verdict answer lint gate (hedge refusal; ADR-141 confidence cross-check)', () => {
    // End-to-end cover for the surviving lint contract, exercised through the real command
    // rather than the pure lint: the uncertainty phrases in a MET row's evidence refuse the
    // answer unwritten (`evidence-hedged`), and no confidence value exists anywhere — a legacy
    // `Confidence:` line parses with the value ignored (F511, task 1207).
    const WBS = '9077';
    const SCENARIO = 'AC1 — The receipt is written on every run (req: R1)';
    const TASK_FILE = [
        '---',
        'schema_version: 1',
        `name: "Confidence gate fixture"`,
        'status: wip',
        'priority: P2',
        'created_at: 2026-10-09T00:00:00.000Z',
        'updated_at: 2026-10-09T00:00:00.000Z',
        '---',
        '',
        `## ${WBS}. Confidence gate fixture`,
        '',
        '### Requirements',
        '',
        '- [ ] **R1. Receipt.** The widget writes its receipt on every run.',
        '',
        '### Acceptance Criteria',
        '',
        '```gherkin',
        `Scenario: ${SCENARIO}`,
        '  Given a configured widget',
        '  When the widget runs',
        '  Then a receipt exists',
        '```',
        '',
    ].join('\n');

    /** The artifact the command writes: process-cwd relative (mirrors the 0958 suite). */
    const artifactPath = (): string => join(process.cwd(), '.spur', 'run', `${WBS}-verdict.json`);

    async function seedCwd(): Promise<string> {
        const isoCwd = join(join(import.meta.dir, '..'), '..', `.tmp-verdict-task-lint-${Date.now()}`);
        await mkdir(join(isoCwd, 'docs', 'tasks'), { recursive: true });
        await writeFile(join(isoCwd, 'docs', 'tasks', `${WBS}_confidence-gate-fixture.md`), TASK_FILE);
        return isoCwd;
    }

    /** One verify answer: `status`/`evidence` for the only row; the level defaults to what the rows derive. */
    function answer(status: string, evidence: string, confidence?: string): string {
        return [
            `Verdict: ${status === 'MET' ? 'PASS' : 'PARTIAL'}`,
            `Confidence: ${confidence ?? (status === 'MET' ? 'HIGH' : 'LOW')}`,
            '',
            '| Req | Status | Evidence |',
            '| --- | --- | --- |',
            `| R1 | ${status} | ${evidence} |`,
            '',
            '| AC | Status | Evidence Type | Evidence |',
            '| --- | --- | --- | --- |',
            `| ${SCENARIO} | MET | test | \`docs/tasks/${WBS}_confidence-gate-fixture.md:1\` |`,
        ].join('\n');
    }

    const CLEAN_EVIDENCE = `\`docs/tasks/${WBS}_confidence-gate-fixture.md:1\` records it`;
    const HEDGED_EVIDENCE = 'it could regress under load, so the receipt is written';

    interface VerdictRun {
        exitCode: number;
        lintRules: string[];
        artifact: { confidence?: string; verdict?: string } | null;
    }

    async function runVerdict(isoCwd: string, name: string, body: string): Promise<VerdictRun> {
        rmSync(artifactPath(), { force: true });
        const answerPath = join(isoCwd, `${name}-verify-answer.txt`);
        await writeFile(answerPath, body);
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'verdict', WBS, '--from-answer', answerPath, '--json'], {
            cwd: isoCwd,
            output,
        });
        const message = output.messages.at(-1) ?? '';
        const parsed = JSON.parse(message) as { lintFindings?: { rule: string; message: string }[] };
        const artifact = existsSync(artifactPath())
            ? (JSON.parse(await readFile(artifactPath(), 'utf-8')) as { confidence?: string; verdict?: string })
            : null;
        return { exitCode, lintRules: (parsed.lintFindings ?? []).map((f) => f.rule), artifact };
    }

    // ADR-141 supersedes the F511 retirement for the ANSWER only: the line is required and the lint
    // cross-checks it against the rows. The verdict artifact still carries no `confidence` field —
    // the answer stays the record of truth, so nothing downstream grades a level.
    test('the matrix: the line is required, cross-checked, and never lands in the artifact', async () => {
        const isoCwd = await seedCwd();
        try {
            const clean = await runVerdict(isoCwd, 'clean', answer('MET', CLEAN_EVIDENCE));
            expect({ exit: clean.exitCode, rules: clean.lintRules }).toEqual({ exit: 0, rules: [] });
            expect(clean.artifact?.verdict).toBe('PASS');
            expect('confidence' in (clean.artifact ?? {})).toBe(false);

            // Absent: rejected, and the message names the level the rows derive.
            const missing = await runVerdict(isoCwd, 'missing', answer('MET', CLEAN_EVIDENCE, undefined));
            const absentBody = (await readFile(join(isoCwd, 'missing-verify-answer.txt'), 'utf-8')).replace(
                /^Confidence:.*\n?/m,
                '',
            );
            const noLine = await runVerdict(isoCwd, 'no-line', absentBody);
            expect(noLine.exitCode).toBe(1);
            expect(noLine.lintRules).toContain('confidence-missing');

            // Overstated: HIGH on rows that only carry a citation is a mismatch, not a pass.
            const overstated = await runVerdict(
                isoCwd,
                'overstated',
                answer('MET', `\`docs/tasks/${WBS}_confidence-gate-fixture.md:1\` records it`, 'HIGH').replace(
                    '| MET | test |',
                    '| MET | static-ref |',
                ),
            );
            expect(overstated.exitCode).toBe(1);
            expect(overstated.lintRules).toContain('confidence-mismatch');

            // A PARTIAL row still yields PARTIAL, and LOW is the level it derives.
            const partial = await runVerdict(isoCwd, 'partial', answer('PARTIAL', CLEAN_EVIDENCE));
            expect({ verdict: partial.artifact?.verdict, rules: partial.lintRules }).toEqual({
                verdict: 'PARTIAL',
                rules: [],
            });
            void missing;
        } finally {
            rmSync(artifactPath(), { force: true });
            rmSync(isoCwd, { recursive: true, force: true });
        }
    });

    test('the hedge alone flips the outcome — same fixture, only the phrase differs (the one surviving rule)', async () => {
        const isoCwd = await seedCwd();
        try {
            const clean = await runVerdict(isoCwd, 'control-clean', answer('MET', CLEAN_EVIDENCE));
            const hedged = await runVerdict(isoCwd, 'control-hedged', answer('MET', HEDGED_EVIDENCE));
            expect(clean.lintRules).toEqual([]);
            expect(clean.exitCode).toBe(0);
            // The only difference is the phrase: exactly one rule, and no artifact.
            expect(hedged.lintRules).toEqual(['evidence-hedged']);
            expect(hedged.exitCode).toBe(1);
            expect(hedged.artifact).toBeNull();
        } finally {
            rmSync(artifactPath(), { force: true });
            rmSync(isoCwd, { recursive: true, force: true });
        }
    });
});
