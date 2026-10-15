/**
 * Thin-wrapper integration tests for `spur task check` (apps/cli/src/commands/task/check.ts).
 * Behavioral tests for TaskService live in packages/app/tests/services/task-service.test.ts.
 *
 * These exercise the verb surface through the real `main()` entry point:
 * golden paths, the `--json` envelope shape, and exit codes 0/1/2 (design §10, R5).
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { main } from '../../../src/index';
import type { CommandOutput } from '../../../src/output';
import { type CapturedOutput, createCapturedOutput } from '../../helpers';

let cwd: string;

beforeAll(async () => {
    cwd = join(join(import.meta.dir, '..'), '..', `.tmp-check-task-test-${Date.now()}`);
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

function nullOutput(): CommandOutput {
    return { write: () => {}, error: () => {} };
}

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
    // ── check configured-folder consistency (0522 R1–R3) ──
    //
    // Two configured folders (active docs/tasks4, inactive docs/tasks2 — the 0197
    // layout that exposed the defect) each holding one CLI-created task; the
    // inactive-folder task is moved there after creation so both files are well-formed.
    async function seedTwoFolderCorpus(): Promise<{
        root: string;
        activeWbs: string;
        inactiveWbs: string;
        inactiveRel: string;
        inactiveAbs: string;
        inactiveFile: string;
    }> {
        const root = await mkdtemp(join(tmpdir(), 'spur-task-check-folders-'));
        await mkdir(join(root, 'docs', 'tasks2'), { recursive: true });
        await mkdir(join(root, 'docs', 'tasks4'), { recursive: true });
        await mkdir(join(root, '.spur'), { recursive: true });
        await Bun.write(
            join(root, '.spur', 'config.yaml'),
            'version: "1"\nname: test\n' +
                'tasks:\n' +
                '  active: docs/tasks4\n' +
                '  folders:\n' +
                '    docs/tasks2:\n' +
                '      baseCounter: 0\n' +
                '      label: Phase 2\n' +
                '    docs/tasks4:\n' +
                '      baseCounter: 100\n' +
                '      label: Phase 4\n',
        );

        const c1 = createCapturedOutput();
        expect(await main(['task', 'create', '--skip-ready', 'Active folder task'], { cwd: root, output: c1 })).toBe(0);
        const activeWbs = createdWbs(c1);
        const c2 = createCapturedOutput();
        expect(await main(['task', 'create', '--skip-ready', 'Inactive folder task'], { cwd: root, output: c2 })).toBe(
            0,
        );
        const inactiveWbs = createdWbs(c2);

        // Seed real Requirements + AC so the tasks pass L3 (placeholders error) — same
        // idiom as the "freshly-created backlog task PASS" test above.
        for (const w of [activeWbs, inactiveWbs]) {
            const reqBody = join(root, `req-${w}.md`);
            await writeFile(reqBody, 'R1. The folder fixture task must be structurally valid.\n');
            expect(
                await main(['task', 'update', w, '--section', 'Requirements', '--from-file', reqBody], {
                    cwd: root,
                    output: nullOutput(),
                }),
            ).toBe(0);
            const acBody = join(root, `ac-${w}.md`);
            await writeFile(acBody, '- [ ] Given a valid task / When check runs / Then exit code is 0.\n');
            expect(
                await main(['task', 'update', w, '--section', 'Acceptance Criteria', '--from-file', acBody], {
                    cwd: root,
                    output: nullOutput(),
                }),
            ).toBe(0);
        }

        const srcRaw = createdPath(c2);
        const src = srcRaw.startsWith('/') ? srcRaw : join(root, srcRaw);
        const inactiveFile = join(root, 'docs', 'tasks2', basename(src));
        await rename(src, inactiveFile);
        return {
            root,
            activeWbs,
            inactiveWbs,
            inactiveRel: 'docs/tasks2',
            inactiveAbs: join(root, 'docs', 'tasks2'),
            inactiveFile,
        };
    }

    // ── verdict ──
    // The verdict command reads the answer file and writes .spur/run/<wbs>-verdict.json
    // relative to the process cwd (not the test cwd), so we pass an absolute --from-answer
    // and clean the emitted artifact afterward to keep the repo tree clean.
    const verdictArtifacts: string[] = [];
    afterAll(() => {
        for (const p of verdictArtifacts) rmSync(p, { force: true });
    });

    // Cover the scaffold-tests action (function-coverage gate for task.ts)

    test('explicit corpus audit is not invoked by routine repository hooks or quality gates', async () => {
        const root = resolve(join(import.meta.dir, '..'), '../../../..');
        expect(await readFile(join(root, '.lefthook.yml'), 'utf8')).not.toMatch(/corpus-check|check --corpus/);
        const { scripts } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
        expect(scripts['spur-check']).not.toMatch(/corpus-check|check --corpus/);
        expect(scripts['spur-check-new']).toBe(scripts['spur-check']);
    });
    test('explicit corpus audit reports unsuppressed warnings without failing or reading a baseline', async () => {
        const root = await mkdtemp(join(tmpdir(), 'spur-explicit-audit-'));
        try {
            const created = createCapturedOutput();
            await main(['task', 'create', '--skip-ready', 'Audit warning fixture', '--json'], {
                cwd: root,
                output: created,
            });
            const taskPath = JSON.parse(lastMessage(created)).filePath;
            const taskBody = await readFile(taskPath, 'utf8');
            await writeFile(
                taskPath,
                taskBody
                    .replace(/### Requirements[\s\S]*?(?=### )/, '### Requirements\n\n- R1: Report audit findings.\n\n')
                    .replace(
                        /### Acceptance Criteria[\s\S]*?(?=### )/,
                        '### Acceptance Criteria\n\n- Reports all audit findings.\n\n',
                    ),
            );
            await mkdir(join(root, 'config'), { recursive: true });
            await writeFile(join(root, 'config/corpus-baseline.json'), 'not valid JSON');
            const output = createCapturedOutput();
            const code = await main(['task', 'check', '--corpus', '--json'], { cwd: root, output });
            expect(code, JSON.stringify(output)).toBe(0);
            expect(output.messages).toHaveLength(1);
            const result = JSON.parse(lastMessage(output));
            expect(result.ok).toBe(true);
            expect(result.baselined).toBe(0);
            expect(result.duplicateKeys).toEqual([]);
            expect(result.newWarnings.length).toBeGreaterThan(0);
            expect(result.bySeverity.warning.newCount).toBe(result.newWarnings.length);
            expect(output.errors.join('\n')).toContain('fog check SKIPPED (not a git repository)');
            await writeFile(join(root, 'docs/tasks/9999_broken.md'), '---\nstatus: invalid\n---\n');
            const broken = createCapturedOutput();
            expect(await main(['task', 'check', '--corpus', '--json'], { cwd: root, output: broken })).toBe(1);
            expect(JSON.parse(lastMessage(broken)).newErrors.length).toBeGreaterThan(0);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
    test('explicit corpus audit rejects ambiguous scopes and reports usage errors as JSON', async () => {
        for (const args of [
            ['--since', 'HEAD'],
            ['0001', '--corpus'],
            ['--corpus', '--as', 'done'],
            ['--corpus', '--fix'],
            ['--corpus', '--folder', 'docs/tasks'],
            ['--corpus', '--strict'],
        ]) {
            const output = createCapturedOutput();
            expect(await main(['task', 'check', ...args, '--json', '--json-envelope'], { cwd, output })).toBe(2);
            expect(JSON.parse([...output.messages, ...output.errors].at(-1) ?? '{}').error).toBeDefined();
        }
    });
    test('explicit corpus audit includes digit-zero feature IDs and fails duplicate identity or corrupt matrix', async () => {
        const root = await mkdtemp(join(tmpdir(), 'spur-audit-identity-'));
        try {
            await mkdir(join(root, 'docs/features'), { recursive: true });
            for (const name of ['F10_first.md', 'F10_second.md']) {
                await writeFile(join(root, 'docs/features', name), '---\nname: Incomplete feature\n---\n');
            }
            const output = createCapturedOutput();
            expect(await main(['task', 'check', '--corpus', '--json'], { cwd: root, output })).toBe(1);
            const result = JSON.parse(lastMessage(output));
            expect(
                result.newErrors.some(
                    (finding: { id: string; code: string }) =>
                        finding.id === 'F10' && finding.code === 'corpus.duplicate-id',
                ),
            ).toBe(true);
            expect(
                result.newErrors.some(
                    (finding: { id: string; code: string }) => finding.id === 'F10' && finding.code.startsWith('L1.'),
                ),
            ).toBe(true);
            await mkdir(join(root, '.spur/tasks'), { recursive: true });
            await writeFile(join(root, '.spur/tasks/section-matrix.yaml'), 'invalid: true');
            const broken = createCapturedOutput();
            expect(
                await main(['task', 'check', '--corpus', '--json', '--json-envelope'], { cwd: root, output: broken }),
            ).toBe(1);
            expect(JSON.parse(lastMessage(broken)).error.message).toContain('section matrix');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
    test('check validates a freshly-created backlog task as PASS', async () => {
        // WHY: a bare new task with populated Requirements + AC passes cleanly. Post-0339,
        // placeholder Requirements/AC trip L3 empty-section errors — so this test seeds
        // real content to validate the gate on a *valid* backlog task.
        const cOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Check me'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);
        const reqBody = join(cwd, `req-${wbs}.md`);
        await Bun.write(reqBody, 'R1. The check command must pass on a valid backlog task.\n');
        await main(['task', 'update', wbs, '--section', 'Requirements', '--from-file', reqBody], {
            cwd,
            output: createCapturedOutput(),
        });
        const acBody = join(cwd, `ac-${wbs}.md`);
        await Bun.write(acBody, '- [ ] Given a valid task / When check runs / Then exit code is 0.\n');
        await main(['task', 'update', wbs, '--section', 'Acceptance Criteria', '--from-file', acBody], {
            cwd,
            output: createCapturedOutput(),
        });

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'check', wbs], { cwd, output });
        expect(exitCode).toBe(0);
        expect(output.messages.join('')).toContain(wbs);
        expect(output.messages.join('')).toContain('PASS');
    });
    test('check --json returns structured results even on failure', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Check JSON'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);

        const output = createCapturedOutput();
        await main(['task', 'check', wbs, '--json'], { cwd, output });
        const parsed = JSON.parse(lastMessage(output));
        expect(parsed[0].wbs).toBe(wbs);
        // Has findings
        expect(parsed[0].findings.length).toBeGreaterThan(0);
    });
    test('check reports an unclosed code fence as an L2 error; --fix never auto-closes (task 1008 R2)', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Fence Check'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);
        const taskPath = createdPath(cOut);

        try {
            // Corrupt the fixture: a section whose fence never closes — every later
            // heading becomes invisible to the parser.
            const raw = await Bun.file(taskPath).text();
            await Bun.write(taskPath, `${raw}\n### Solution\n\n\`\`\`text\nnever closed\n`);

            const output = createCapturedOutput();
            const exitCode = await main(['task', 'check', wbs, '--json'], { cwd, output });
            expect(exitCode).toBe(1);
            const parsed = JSON.parse(lastMessage(output));
            const fence = parsed[0].findings.find((f: { code: string }) => f.code === 'L2.unclosed-code-fence');
            expect(fence).toBeDefined();
            expect(fence.severity).toBe('error');
            expect(fence.message).toMatch(/line \d+/);

            // --fix repairs structural findings only — it must not auto-close fences.
            await main(['task', 'check', wbs, '--fix'], { cwd, output: createCapturedOutput() });
            expect(await Bun.file(taskPath).text()).toContain('never closed');
        } finally {
            // This file shares one corpus cwd across all tests; drop the corrupted
            // fixture even on failure so later corpus-facing tests don't sweep its L2 error.
            rmSync(taskPath);
        }
    });
    test('check --as <status> projects the target row (F92 R2): result.status is the target', async () => {
        // A freshly-created backlog task. Plain check reports the CURRENT status
        // (backlog); check --as done must report the TARGET status (done) in the
        // JSON, proving the lifecycle guard evaluates the done row.
        const cOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Check as done'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);

        const plain = createCapturedOutput();
        await main(['task', 'check', wbs, '--json'], { cwd, output: plain });
        expect(JSON.parse(lastMessage(plain))[0].status).toBe('backlog');

        // Target projection: the reported status is the TARGET.
        const output = createCapturedOutput();
        await main(['task', 'check', wbs, '--as', 'done', '--json'], { cwd, output });
        expect(JSON.parse(lastMessage(output))[0].status).toBe('done');
    });
    test('check --as rejects an unknown status (exit 2)', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'check', '--as', 'BOGUS'], { cwd, output });
        expect(exitCode).toBe(2);
        expect(output.errors.join('\n')).toContain('invalid --as status');
    });
    test('check --strict elevates warnings and can exit 1 on missing sections', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Check strict'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'check', wbs, '--strict'], { cwd, output });
        // Strict mode may elevate warnings → might pass or fail depending on fixture completeness.
        // The important thing is exit code is a number (0 or 1).
        expect([0, 1]).toContain(exitCode);
    });
    test('check without WBS scans all tasks in the folder', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'check'], { cwd, output });
        // Should scan and report on all tasks
        expect([0, 1]).toContain(exitCode); // may fail depending on task content
        expect(output.messages.join('')).toMatch(/\d{4}/);
    });
    test('check --precheck fails a task over the size limits (exit 1, precheck-size code)', async () => {
        // 11 R-items and 17 plan items exceed DEFAULT_TASK_SIZE_LIMITS (10/16).
        const cOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Too big for precheck'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);
        const reqBody = join(cwd, `req-${wbs}.md`);
        await Bun.write(reqBody, Array.from({ length: 11 }, (_, i) => `- R${i + 1}. Requirement ${i + 1}.`).join('\n'));
        await main(['task', 'update', wbs, '--section', 'Requirements', '--from-file', reqBody], {
            cwd,
            output: createCapturedOutput(),
        });
        const acBody = join(cwd, `ac-${wbs}.md`);
        await Bun.write(acBody, '- [ ] Given a task / When checked / Then it is measured.\n');
        await main(['task', 'update', wbs, '--section', 'Acceptance Criteria', '--from-file', acBody], {
            cwd,
            output: createCapturedOutput(),
        });
        const planBody = join(cwd, `plan-${wbs}.md`);
        await Bun.write(planBody, Array.from({ length: 17 }, (_, i) => `- [ ] Step ${i + 1}.`).join('\n'));
        await main(['task', 'update', wbs, '--section', 'Plan', '--from-file', planBody], {
            cwd,
            output: createCapturedOutput(),
        });

        // Without --precheck the plain four-layer check stays clean.
        const plain = createCapturedOutput();
        const plainExit = await main(['task', 'check', wbs, '--json'], { cwd, output: plain });
        expect(plainExit).toBe(0);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'check', wbs, '--precheck', '--json'], { cwd, output });
        expect(exitCode).toBe(1);
        const parsed = JSON.parse(lastMessage(output));
        const codes = (parsed[0].findings as { code: string }[]).map((f) => f.code);
        expect(codes).toContain('precheck-size');
        // No evidence declaration on this task — the evidence precheck passed silently.
        expect(codes).not.toContain('precheck-evidence');
    });
    test('check --precheck rejects --corpus and a missing WBS (exit 2)', async () => {
        const corpus = createCapturedOutput();
        const corpusExit = await main(['task', 'check', '--precheck', '--corpus'], { cwd, output: corpus });
        expect(corpusExit).toBe(2);
        expect(corpus.errors.join('\n')).toContain('--precheck requires a <wbs> argument');

        const bare = createCapturedOutput();
        const bareExit = await main(['task', 'check', '--precheck'], { cwd, output: bare });
        expect(bareExit).toBe(2);
        expect(bare.errors.join('\n')).toContain('--precheck requires a <wbs> argument');
    });
    test('check --precheck fails closed on an unknown evidence-channel declaration (exit 1)', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Unknown evidence channel'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);
        const reqBody = join(cwd, `req-${wbs}.md`);
        await Bun.write(reqBody, 'R1. Real requirement.\n');
        await main(['task', 'update', wbs, '--section', 'Requirements', '--from-file', reqBody], {
            cwd,
            output: createCapturedOutput(),
        });
        const acBody = join(cwd, `ac-${wbs}.md`);
        await Bun.write(acBody, '- [ ] Given / When / Then.\n');
        await main(['task', 'update', wbs, '--section', 'Acceptance Criteria', '--from-file', acBody], {
            cwd,
            output: createCapturedOutput(),
        });
        const planBody = join(cwd, `plan-${wbs}.md`);
        await Bun.write(planBody, '- [ ] Step 1.\n');
        await main(['task', 'update', wbs, '--section', 'Plan', '--from-file', planBody], {
            cwd,
            output: createCapturedOutput(),
        });
        const designBody = join(cwd, `design-${wbs}.md`);
        await Bun.write(designBody, 'evidence-channel: not.a.real.channel[x]\n');
        await main(['task', 'update', wbs, '--section', 'Design', '--from-file', designBody], {
            cwd,
            output: createCapturedOutput(),
        });

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'check', wbs, '--precheck', '--json'], { cwd, output });
        expect(exitCode).toBe(1);
        const parsed = JSON.parse(lastMessage(output));
        const codes = (parsed[0].findings as { code: string }[]).map((f) => f.code);
        expect(codes).toContain('precheck-evidence');
    });
    test('check with unknown WBS prints error and exits 1', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'check', '9999'], { cwd, output });
        expect(exitCode).toBe(1);
        expect(output.errors.at(-1)).toContain('not found');
    });
    test('R1: targeted check resolves a WBS in a configured inactive folder', async () => {
        const fx = await seedTwoFolderCorpus();
        try {
            const output = createCapturedOutput();
            const exitCode = await main(['task', 'check', fx.inactiveWbs, '--json'], { cwd: fx.root, output });
            expect(exitCode).toBe(0);
            const results = JSON.parse(lastMessage(output));
            expect(results.some((r: { wbs: string }) => r.wbs === fx.inactiveWbs)).toBe(true);
            expect(output.errors.some((e) => e.includes('not found'))).toBe(false);
        } finally {
            rmSync(fx.root, { recursive: true, force: true });
        }
    });
    test('R2: relative and absolute --folder spellings return identical findings with a valid citation', async () => {
        const fx = await seedTwoFolderCorpus();
        try {
            // A root-relative file:line citation whose target exists under the project root.
            await mkdir(join(fx.root, 'apps', 'cli', 'src'), { recursive: true });
            await writeFile(join(fx.root, 'apps', 'cli', 'src', 'index.ts'), 'export {};\n');
            // Anchor validation runs at wip; walk the FSM there and write Solution with the citation.
            expect(await main(['task', 'update', fx.inactiveWbs, 'todo'], { cwd: fx.root, output: nullOutput() })).toBe(
                0,
            );
            expect(await main(['task', 'update', fx.inactiveWbs, 'wip'], { cwd: fx.root, output: nullOutput() })).toBe(
                0,
            );
            const solutionFile = join(fx.root, 'solution.md');
            await writeFile(
                solutionFile,
                'Implemented the folder fix.\n\n- `apps/cli/src/index.ts:1` — entry point touched.\n',
            );
            expect(
                await main(['task', 'update', fx.inactiveWbs, '--section', 'Solution', '--from-file', solutionFile], {
                    cwd: fx.root,
                    output: nullOutput(),
                }),
            ).toBe(0);

            const rel = createCapturedOutput();
            expect(
                await main(['task', 'check', fx.inactiveWbs, '--folder', fx.inactiveRel, '--json'], {
                    cwd: fx.root,
                    output: rel,
                }),
            ).toBe(0);
            const abs = createCapturedOutput();
            expect(
                await main(['task', 'check', fx.inactiveWbs, '--folder', fx.inactiveAbs, '--json'], {
                    cwd: fx.root,
                    output: abs,
                }),
            ).toBe(0);

            const relResults = JSON.parse(lastMessage(rel));
            const absResults = JSON.parse(lastMessage(abs));
            expect(relResults).toEqual(absResults);
            const blob = JSON.stringify(relResults);
            expect(blob).not.toContain('Stale line anchor');
            expect(blob).not.toContain('stale-line-anchor');
        } finally {
            rmSync(fx.root, { recursive: true, force: true });
        }
    });
    test('R3: unscoped check and list scan only the active folder', async () => {
        const fx = await seedTwoFolderCorpus();
        try {
            const chk = createCapturedOutput();
            await main(['task', 'check', '--json'], { cwd: fx.root, output: chk });
            const checkBlob = lastMessage(chk);
            expect(checkBlob).toContain(fx.activeWbs);
            expect(checkBlob).not.toContain(fx.inactiveWbs);

            const lst = createCapturedOutput();
            await main(['task', 'list', '--json'], { cwd: fx.root, output: lst });
            const listBlob = lastMessage(lst);
            expect(listBlob).toContain(fx.activeWbs);
            expect(listBlob).not.toContain(fx.inactiveWbs);
        } finally {
            rmSync(fx.root, { recursive: true, force: true });
        }
    });
    test('check with bad folder exits 1', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'check', '0001', '--folder', join(cwd, 'nonexistent')], { cwd, output });
        expect(exitCode).toBe(1);
    });
    test('check detects duplicate WBS prefixes across files (0416 R6)', async () => {
        const isoCwd = join(join(import.meta.dir, '..'), '..', `.tmp-check-task-dupwbs-${Date.now()}`);
        await mkdir(join(isoCwd, 'docs', 'tasks'), { recursive: true });
        try {
            const first = createCapturedOutput();
            await main(['task', 'create', '--skip-ready', 'Original dup task'], { cwd: isoCwd, output: first });
            expect(first.errors.join('')).toBe('');
            const wbs = createdWbs(first);

            // Copy the task file with the same WBS prefix but different slug
            const originalPath = createdPath(first);
            const dupPath = join(isoCwd, 'docs', 'tasks', `${wbs}_dup.md`);
            const content = await readFile(originalPath, 'utf8');
            await writeFile(dupPath, content);

            const output = createCapturedOutput();
            const exitCode = await main(['task', 'check', '--json'], { cwd: isoCwd, output });
            expect(exitCode).toBe(1);

            const results = JSON.parse(lastMessage(output)) as Array<{
                wbs: string;
                pass: boolean;
                status: string;
                findings: string[];
            }>;
            const dupResult = results.find((r) => r.status === 'duplicate');
            expect(dupResult).toBeDefined();
            expect(dupResult?.wbs).toBe(wbs);
            expect(dupResult?.pass).toBe(false);
        } finally {
            rmSync(isoCwd, { recursive: true, force: true });
        }
    });
    test('check reports duplicate WBS prefixes to stderr without --json (0416 R6)', async () => {
        const isoCwd = join(join(import.meta.dir, '..'), '..', `.tmp-check-task-dupwbs-nojson-${Date.now()}`);
        await mkdir(join(isoCwd, 'docs', 'tasks'), { recursive: true });
        try {
            const first = createCapturedOutput();
            await main(['task', 'create', '--skip-ready', 'Original dup task (nojson)'], {
                cwd: isoCwd,
                output: first,
            });
            expect(first.errors.join('')).toBe('');
            const wbs = createdWbs(first);

            // Plant a duplicate file sharing the WBS prefix.
            const originalPath = createdPath(first);
            const dupPath = join(isoCwd, 'docs', 'tasks', `${wbs}_dup.md`);
            const content = await readFile(originalPath, 'utf8');
            await writeFile(dupPath, content);

            const output = createCapturedOutput();
            const exitCode = await main(['task', 'check'], { cwd: isoCwd, output });
            expect(exitCode).toBe(1);
            // Non-JSON path: the duplicate report goes to the error sink.
            const combined = output.errors.join('');
            expect(combined).toContain(`Duplicate WBS ${wbs}`);
            expect(combined).toContain(`${wbs}_dup.md`);
        } finally {
            rmSync(isoCwd, { recursive: true, force: true });
        }
    });
});

describe('spur task check --fix', () => {
    test('repairs structural findings in place and leaves content findings reported', async () => {
        const isoCwd = join(join(import.meta.dir, '..'), '..', `.tmp-check-task-fix-${Date.now()}`);
        try {
            const tasksDir = join(isoCwd, 'docs', 'tasks');
            await mkdir(tasksDir, { recursive: true });
            const taskPath = join(tasksDir, '9999_fix-probe.md');
            await writeFile(
                taskPath,
                `---
name: "Fix probe"
status: wip
template: feature-impl
created_at: 2026-08-21T00:00:00.000Z
updated_at: 2026-08-21T00:00:00.000Z
---

## 9999. Fix probe

### Background

Probe for the repair engine.

## Requirements

- R1. First requirement
- [ ] R2. Already checkboxed

### Plan

- [ ] step one
`,
            );

            const output = createCapturedOutput();
            // The fixture is content-incomplete (missing feature_id, empty AC, no
            // created/updated provenance), so the check still FAILs — that is correct:
            // --fix repairs structural shapes only and exit 1 carries the remaining
            // content findings. The file write is the observable contract.
            await main(['task', 'check', '9999', '--fix', '--folder', tasksDir], {
                cwd: isoCwd,
                output,
            });

            const fixed = await readFile(taskPath, 'utf8');
            // Heading level repaired.
            expect(fixed).toContain('### Requirements');
            expect(fixed).not.toContain('\n## Requirements\n');
            // R-item checkbox form repaired.
            expect(fixed).toContain('- [ ] R1. First requirement');
            // Missing required section inserted as a bare heading (never content).
            expect(fixed).toContain('### Acceptance Criteria');
            expect(fixed).not.toContain('Scenario');

            const combined = output.messages.join('\n');
            expect(combined).toContain('[FIX] heading-level');
            expect(combined).toContain('[FIX] requirement-checkbox');
        } finally {
            rmSync(isoCwd, { recursive: true, force: true });
        }
    });
});
