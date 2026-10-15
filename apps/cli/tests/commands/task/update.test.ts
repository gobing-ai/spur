/**
 * Thin-wrapper integration tests for `spur task update` (apps/cli/src/commands/task/update.ts).
 * Behavioral tests for TaskService live in packages/app/tests/services/task-service.test.ts.
 *
 * These exercise the verb surface through the real `main()` entry point:
 * golden paths, the `--json` envelope shape, and exit codes 0/1/2 (design §10, R5).
 */
import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getEnvVars } from '@gobing-ai/spur-config';
import * as configModule from '@gobing-ai/spur-config/loader';
import { main } from '../../../src/index';
import type { CommandOutput } from '../../../src/output';
import { type CapturedOutput, createCapturedOutput } from '../../helpers';

let cwd: string;

beforeAll(async () => {
    cwd = join(join(import.meta.dir, '..'), '..', `.tmp-update-task-test-${Date.now()}`);
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
    // ── run-link ────────────────────────────────────────────────────
    // ── Done-transition verdict guard (task 0292) ──
    // The guard is orthogonal to the lifecycle FSM, so all transitions use
    // --no-lifecycle to isolate the verdict-guard behavior. R8 (verdict gate applies
    // under --no-lifecycle) is therefore exercised by every test in this block, and
    // called out explicitly in its own case.
    /**
     * Fill every section `spur task check` requires before a task may legally
     * reach `testing`/`done`.
     *
     * WHY this exists: a real task at `testing` has ALWAYS passed the structural
     * gate. Seeding a placeholder-only task and walking it to `testing` worked
     * only while `--no-lifecycle` suppressed enforcement as well as the lifecycle
     * run record — the bypass this fixture now stops relying on. Holding
     * structural validity constant is what actually isolates the verdict guard;
     * the old fixture isolated it by keeping every task structurally invalid,
     * which is a state the verdict guard never sees in production.
     */
    async function fillDoneRequiredSections(path: string): Promise<void> {
        const bodies: Record<string, string> = {
            Requirements: '- R1 — Seeded requirement for the done-guard fixture.',
            'Acceptance Criteria':
                '```gherkin\nFeature: done-guard fixture\n\n  Scenario: R1 — seeded scenario\n    Given a seeded task\n    When the done guard runs\n    Then the structural gate is already satisfied\n```',
            Solution: 'Seeded change map: `apps/cli/src/commands/task.ts:1` — fixture only, no code.',
            Testing: 'N/A — fixture task, no code. Coverage N/A.',
            Review: [
                '| Severity | File | Finding | Recommendation |',
                '| --- | --- | --- | --- |',
                '| P4 | `apps/cli/src/commands/task.ts:1` | Fixture only. | None. |',
                '',
                'Residual risk: none (fixture).',
            ].join('\n'),
        };
        let text = await readFile(path, 'utf-8');
        for (const [name, body] of Object.entries(bodies)) {
            text = text.replace(new RegExp(`(### ${name}\\n)[\\s\\S]*?(?=\\n### |$)`), `$1\n${body}\n`);
        }
        await writeFile(path, text, 'utf-8');
    }

    async function seedTaskAtTesting(label: string): Promise<string> {
        const cOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', label], { cwd, output: cOut });
        const wbs = createdWbs(cOut);
        await fillDoneRequiredSections(createdPath(cOut));
        await main(['task', 'update', wbs, 'todo', '--no-lifecycle'], { cwd, output: nullOutput() });
        await main(['task', 'update', wbs, 'wip', '--no-lifecycle'], { cwd, output: nullOutput() });
        await main(['task', 'update', wbs, 'testing', '--no-lifecycle'], { cwd, output: nullOutput() });
        return wbs;
    }

    async function writeVerdict(wbs: string, verdictJson: Record<string, unknown>): Promise<void> {
        const runDir = join(cwd, '.spur', 'run');
        await mkdir(runDir, { recursive: true });
        await writeFile(join(runDir, `${wbs}-verdict.json`), JSON.stringify(verdictJson), 'utf-8');
    }

    async function readStatus(wbs: string): Promise<string> {
        const show = createCapturedOutput();
        await main(['task', 'show', wbs, '--json'], { cwd, output: show });
        const json = JSON.parse(show.messages.filter((m) => m.trim().startsWith('{')).pop() ?? '{}');
        return String(json.frontmatter?.status ?? '');
    }

    const PASS_VERDICT = {
        wbs: 'PLACEHOLDER',
        verdict: 'PASS',
        confidence: 'HIGH',
        requirements: [
            { id: 'R1', status: 'MET', evidence: 'x' },
            { id: 'R2', status: 'MET', evidence: 'y' },
        ],
        acceptanceCriteria: [],
        source: 'spur task verdict',
    };
    const PARTIAL_VERDICT = {
        wbs: 'PLACEHOLDER',
        verdict: 'PARTIAL',
        requirements: [
            { id: 'R1', status: 'MET', evidence: 'x' },
            { id: 'R2', status: 'PARTIAL', evidence: 'y' },
        ],
        acceptanceCriteria: [],
        source: 'spur task verdict',
    };
    const FAIL_VERDICT = {
        wbs: 'PLACEHOLDER',
        verdict: 'FAIL',
        requirements: [
            { id: 'R1', status: 'MET', evidence: 'x' },
            { id: 'R2', status: 'UNMET', evidence: 'y' },
        ],
        acceptanceCriteria: [],
        source: 'spur task verdict',
    };

    test('update --help names the section-discovery command (0534 R2)', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'update', '--help'], { cwd, output });
        expect(exitCode).toBe(0);
        expect(output.messages.join('')).toContain('spur task sections <wbs> list');
    });
    test('update --section without --from-file exits 2 (usage error)', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Section guard'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'update', wbs, '--section', 'Solution'], { cwd, output });
        expect(exitCode).toBe(2);
        expect(output.errors.at(-1)).toContain('--from-file is required');
    });
    test('update with no status and no --section exits 2 (usage error)', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Arg guard'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'update', wbs], { cwd, output });
        expect(exitCode).toBe(2);
        expect(output.errors.at(-1)).toContain('required');
    });
    test('update status transition exits 0 and reports from→to', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Transition me'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'update', wbs, 'todo'], { cwd, output });
        expect(exitCode).toBe(0);
        expect(lastMessage(output)).toContain('backlog → todo');
    });
    test('update --section --from-file replaces the section body', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Section target'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);
        const bodyFile = join(cwd, 'body.md');
        await Bun.write(
            bodyFile,
            'Replacement solution body citing `packages/app/src/services/task-service.ts:1102`.\n',
        );

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'update', wbs, '--section', 'Solution', '--from-file', bodyFile], {
            cwd,
            output,
        });
        expect(exitCode).toBe(0);
        expect(lastMessage(output)).toContain("Updated section 'Solution'");
    });
    test('update --section Solution with no file:line citation exits 3 without mutating (0510 R1)', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'R1 solution reject'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);
        const taskPath = createdPath(cOut);
        const before = await Bun.file(taskPath).text();

        const bodyFile = join(cwd, 'sol-no-cite.md');
        await Bun.write(bodyFile, 'Changed everything but forgot the citation.\n');

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'update', wbs, '--section', 'Solution', '--from-file', bodyFile], {
            cwd,
            output,
        });
        expect(exitCode).toBe(3);
        expect(output.errors.join('\n')).toContain('Solution must contain at least one `file:line` citation');
        // Rejection happens before the write service: file content is byte-identical.
        const after = await Bun.file(taskPath).text();
        expect(after).toBe(before);
    });
    test('update --section Solution rejection is non-zero under --json too (0510 R1)', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'R1 solution reject json'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);

        const bodyFile = join(cwd, 'sol-no-cite-json.md');
        await Bun.write(bodyFile, 'No citation anywhere in this body.\n');

        const output = createCapturedOutput();
        const exitCode = await main(
            ['task', 'update', wbs, '--section', 'Solution', '--from-file', bodyFile, '--json'],
            { cwd, output },
        );
        expect(exitCode).toBe(3);
        expect(output.errors.join('\n')).toContain('Solution must contain at least one `file:line` citation');
    });
    test('update --append without --section exits 2 (1057)', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Append guard'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);
        const bodyFile = join(cwd, 'append-no-section.md');
        await Bun.write(bodyFile, 'Orphan append body.\n');

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'update', wbs, '--append', '--from-file', bodyFile], { cwd, output });
        expect(exitCode).toBe(2);
        expect(output.errors.at(-1)).toContain('--append requires --section');
    });
    test('update --append --section Review preserves prior section content (1057 AC1)', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Append target'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);
        const taskPath = createdPath(cOut);

        const tableFile = join(cwd, 'review-table.md');
        await Bun.write(
            tableFile,
            `${[
                '| Priority | Dimension | Location | Finding |',
                '|----------|-----------|----------|---------|',
                '| P4 | — | — | No P1–P3 findings |',
            ].join('\n')}\n`,
        );
        expect(
            await main(['task', 'update', wbs, '--section', 'Review', '--from-file', tableFile], {
                cwd,
                output: createCapturedOutput(),
            }),
        ).toBe(0);

        const narrativeFile = join(cwd, 'review-append.md');
        await Bun.write(narrativeFile, 'Appended verify narrative.\n');
        const output = createCapturedOutput();
        const exitCode = await main(
            ['task', 'update', wbs, '--section', 'Review', '--from-file', narrativeFile, '--append'],
            { cwd, output },
        );
        expect(exitCode).toBe(0);
        expect(lastMessage(output)).toContain("Updated section 'Review'");

        const raw = await Bun.file(taskPath).text();
        const review = raw.slice(raw.indexOf('### Review'));
        expect(review).toContain('No P1–P3 findings');
        expect(review).toContain('Appended verify narrative.');
        expect(review).toContain('No P1–P3 findings |\n\nAppended verify narrative.');
    });
    test('update --section Notes is byte-identical on a second identical write', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Notes round trip'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);
        const taskPath = createdPath(cOut);
        const bodyFile = join(cwd, 'notes-round-trip.md');
        await writeFile(bodyFile, 'Round-trip notes body.\n');

        expect(
            await main(['task', 'update', wbs, '--section', 'Notes', '--from-file', bodyFile], {
                cwd,
                output: createCapturedOutput(),
            }),
        ).toBe(0);
        const afterFirst = await readFile(taskPath, 'utf8');
        const notesOf = (raw: string) => raw.slice(raw.indexOf('### Notes'));
        expect(notesOf(afterFirst)).toMatch(/^### Notes\n\nRound-trip notes body\.\n\n/);

        expect(
            await main(['task', 'update', wbs, '--section', 'Notes', '--from-file', bodyFile], {
                cwd,
                output: createCapturedOutput(),
            }),
        ).toBe(0);
        const afterSecond = await readFile(taskPath, 'utf8');
        // Frontmatter `updated_at` advances on every write; the Notes spelling must not.
        expect(notesOf(afterSecond)).toBe(notesOf(afterFirst));
    });
    test('update --help documents the Q&A append exception and qa:replace marker', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'update', '--help'], { cwd, output });
        expect(exitCode).toBe(0);
        const help = output.messages.join('\n');
        expect(help).toContain('Section name to write');
        expect(help).toContain('Q&A');
        expect(help).toContain('APPENDS');
        expect(help).toContain('<!-- qa:replace -->');
    });
    test('update status --json returns structured output', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'JSON transition'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'update', wbs, 'todo', '--json'], { cwd, output });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lastMessage(output));
        expect(parsed.ref.id).toBe(wbs);
        expect(parsed.fromStatus).toBe('backlog');
        expect(parsed.toStatus).toBe('todo');
    });
    test('update --section --from-file --json returns structured output', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Section JSON'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);
        const bodyFile = join(cwd, 'body-json.md');
        await Bun.write(bodyFile, 'JSON section body citing `packages/app/src/services/task-service.ts:1102`.\n');

        const output = createCapturedOutput();
        const exitCode = await main(
            ['task', 'update', wbs, '--section', 'Solution', '--from-file', bodyFile, '--json'],
            { cwd, output },
        );
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lastMessage(output));
        expect(parsed.ref.id).toBe(wbs);
    });
    test('update --feature sets feature_id on task', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Feature update'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'update', wbs, '--feature', 'B'], { cwd, output });
        expect(exitCode).toBe(0);
        expect(output.messages[0] ?? '').toContain('Set feature_id=B');
        // Verify it stuck
        const content = await Bun.file(join(cwd, 'docs', 'tasks', `${wbs}_feature-update.md`)).text();
        expect(content).toContain('feature_id: B');
    });
    test('update --priority sets priority on task', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Priority update'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'update', wbs, '--priority', 'P0'], { cwd, output });
        expect(exitCode).toBe(0);
        expect(output.messages[0] ?? '').toContain('Set priority=P0');
    });
    test('update --add-tag/--remove-tag edit the tags list in place (GTD fleet:auto carrier)', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Tag update'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);
        const file = join(cwd, 'docs', 'tasks', `${wbs}_tag-update.md`);
        const tagsOf = async (): Promise<unknown> => {
            const out = createCapturedOutput();
            await main(['task', 'show', wbs, '--json'], { cwd, output: out });
            return JSON.parse(lastMessage(out)).frontmatter.tags;
        };

        let exitCode = await main(['task', 'update', wbs, '--add-tag', 'fleet:auto', '--add-tag', 'server'], {
            cwd,
            output: createCapturedOutput(),
        });
        expect(exitCode).toBe(0);
        expect(await tagsOf()).toEqual(['fleet:auto', 'server']);

        // Re-adding is idempotent; removing one keeps the rest.
        exitCode = await main(['task', 'update', wbs, '--add-tag', 'fleet:auto', '--remove-tag', 'server'], {
            cwd,
            output: createCapturedOutput(),
        });
        expect(exitCode).toBe(0);
        expect(await tagsOf()).toEqual(['fleet:auto']);

        const blank = createCapturedOutput();
        exitCode = await main(['task', 'update', wbs, '--add-tag', '  '], { cwd, output: blank });
        expect(exitCode).not.toBe(0);
        expect(await Bun.file(file).text()).toContain('fleet:auto');
    });
    test('update applies every field flag in one call and writes estimate_hours as a number', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Multi field update'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'update', wbs, '--priority', 'P0', '--estimate-hours', '4'], {
            cwd,
            output,
        });
        expect(exitCode).toBe(0);
        const content = await Bun.file(join(cwd, 'docs', 'tasks', `${wbs}_multi-field-update.md`)).text();
        expect(content).toContain('priority: P0');
        expect(content).toMatch(/^estimate_hours: 4$/m);
    });
    test('update --estimate-hours rejects a non-positive value', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Bad estimate'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'update', wbs, '--estimate-hours', '0'], { cwd, output });
        expect(exitCode).not.toBe(0);
        const content = await Bun.file(join(cwd, 'docs', 'tasks', `${wbs}_bad-estimate.md`)).text();
        expect(content).not.toContain('estimate_hours');
    });
    test('update --ac-altitude sets ac_altitude frontmatter and the field persists (0600 R-fix)', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Altitude update'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'update', wbs, '--ac-altitude', 'task-local'], { cwd, output });
        expect(exitCode).toBe(0);
        expect(output.messages[0] ?? '').toContain('Set ac_altitude=task-local');

        // Field persisted on disk
        const content = await Bun.file(join(cwd, 'docs', 'tasks', `${wbs}_altitude-update.md`)).text();
        expect(content).toContain('ac_altitude: task-local');
    });
    test('update --ac-altitude with invalid value is rejected by the L1 schema', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Altitude bad'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'update', wbs, '--ac-altitude', 'bogus'], { cwd, output });
        expect(exitCode).not.toBe(0);
    });
    test('update --feature --json returns structured output', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Feature JSON'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'update', wbs, '--feature', 'C', '--json'], { cwd, output });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lastMessage(output));
        expect(parsed.ref.id).toBe(wbs);
    });
    test('update with non-existent wbs exits 1 and prints error (update catch)', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'update', '9999', 'todo'], { cwd, output });
        // Non-existent task triggers the update catch block (lines 136-137)
        expect(exitCode).toBe(1);
        expect(output.errors.length).toBeGreaterThan(0);
    });
    test('testing→done is gated by `spur task check` when the lifecycle adapter is unavailable (P3 backstop)', async () => {
        // Force the lifecycle adapter to be unavailable so the SchemaLifecyclePort
        // fallback (which permits every transition) is in play — the exact hole P3
        // describes: without the inline gate, `done` would succeed despite an L3 error.
        const spy = spyOn(configModule, 'bundledConfigRoot').mockReturnValue(null);
        try {
            const cOut = createCapturedOutput();
            await main(['task', 'create', '--skip-ready', 'P3 gate target'], { cwd, output: cOut });
            const wbs = createdWbs(cOut);

            // Plant a Solution with no `file:line` citation → L3 hard error at testing/done.
            // R1 (0510) now rejects such a body at the CLI write seam, so plant it
            // directly in the file — the done-gate regression needs the L3 defect to
            // actually exist in the corpus at transition time.
            const taskPath = createdPath(cOut);
            const rawTask = await Bun.file(taskPath).text();
            await Bun.write(
                taskPath,
                `${rawTask.replace(/\s*$/, '')}\n\n### Solution\n\nA change-map with no file:line citation.\n`,
            );
            // Walk to testing first (also gated, but the wip→testing gate is the default
            // severity; a bare Solution body passes it). Use --no-lifecycle on the walk so
            // we control the path, then test the done transition under the fallback.
            await main(['task', 'update', wbs, 'todo', '--no-lifecycle'], { cwd, output: createCapturedOutput() });
            // Seed done-required sections so the ONLY failure is the L3 citation.
            const testingBody = join(cwd, 'testing.md');
            await Bun.write(testingBody, 'Testing evidence present.\n');
            await main(['task', 'update', wbs, '--section', 'Testing', '--from-file', testingBody], {
                cwd,
                output: createCapturedOutput(),
            });
            const reviewBody = join(cwd, 'review.md');
            await Bun.write(
                reviewBody,
                '| Priority | Status | Note |\n|----------|--------|------|\n| P1 | DONE | ok |\n',
            );
            await main(['task', 'update', wbs, '--section', 'Review', '--from-file', reviewBody], {
                cwd,
                output: createCapturedOutput(),
            });
            await main(['task', 'update', wbs, 'wip', '--no-lifecycle'], { cwd, output: createCapturedOutput() });
            await main(['task', 'update', wbs, 'testing', '--no-lifecycle'], { cwd, output: createCapturedOutput() });

            // Now attempt done WITHOUT --no-lifecycle: the adapter is unavailable (spy
            // forces bundledConfigRoot to null; SPUR_GLOBAL_RULES_DIR redirects the 0071
            // R5 global-fallback tier to a nonexistent dir so the adapter stays truly
            // unavailable regardless of what this machine has seeded under ~/.config/spur),
            // so the inline gate must run `task check` and block the L3 citation error.
            const output = createCapturedOutput();
            const exitCode = await main(['task', 'update', wbs, 'done'], {
                cwd,
                output,
                env: { ...getEnvVars(), SPUR_GLOBAL_RULES_DIR: join(cwd, 'no-such-global-config') },
            });
            expect(exitCode).toBe(1);
            expect(output.errors.some((e) => e.includes('blocked'))).toBe(true);
        } finally {
            spy.mockRestore();
        }
    });
    test('fallback done-gate passes a task with pass:True + L4 warnings only (Issue B fix: strict-core ≠ strict)', async () => {
        // WHY: The real task-lifecycle FSM testing→done guard uses `--strict-core`
        // (default severity — L4 warnings stay warnings). The pre-fix fallback passed
        // `strict: true`, which elevated L4 warnings (e.g. missing feature_id) to
        // errors, blocking tasks the real guard would allow. Verify the fix: a task
        // whose only finding is an L4 warning (no feature_id) must transition done.
        const spy = spyOn(configModule, 'bundledConfigRoot').mockReturnValue(null);
        try {
            const cOut = createCapturedOutput();
            await main(['task', 'create', '--skip-ready', 'Strict-core gate target'], { cwd, output: cOut });
            const wbs = createdWbs(cOut);

            // Seed done-required sections with valid content so the ONLY finding is
            // the L4 "missing feature_id" warning. Post-0339: placeholder
            // Requirements/AC trip L3 empty-section errors, so populate them too.
            const reqBody = join(cwd, 'req-strict-core.md');
            // Box CHECKED on purpose: 1132 R1 normalizes the loose `R1. …` form into
            // `- [ ] R1. …`, and an OPEN box is an L3 error at `--as done` (0800 R1) — it
            // would block done on an L3 error and mask this test's actual subject (L4
            // warnings must not block). Same reason the AC box below is checked.
            await Bun.write(reqBody, '- [x] R1. Done gate must not block on L4 warnings under --strict-core.\n');
            await main(['task', 'update', wbs, '--section', 'Requirements', '--from-file', reqBody], {
                cwd,
                output: createCapturedOutput(),
            });
            const acBody = join(cwd, 'ac-strict-core.md');
            // Box CHECKED on purpose: task 0800 R1 made L3.unchecked-checklist a hard
            // error when `--as` names a differing transition target, so an open box here
            // would block `done` on an L3 error and mask this test's actual subject
            // (L4 warnings must not block). Open-box refusal is covered by task-check's
            // own AC1/AC2 tests.
            await Bun.write(acBody, '- [x] Given a strict-core task / When done is attempted / Then exit 0.\n');
            await main(['task', 'update', wbs, '--section', 'Acceptance Criteria', '--from-file', acBody], {
                cwd,
                output: createCapturedOutput(),
            });
            const solutionBody = join(cwd, 'sol-strict-core.md');
            await Bun.write(solutionBody, 'Fix applied in `apps/cli/src/commands/task.ts:1`.\n');
            await main(['task', 'update', wbs, '--section', 'Solution', '--from-file', solutionBody], {
                cwd,
                output: createCapturedOutput(),
            });
            const testingBody = join(cwd, 'test-strict-core.md');
            await Bun.write(testingBody, 'Tests pass with 95% coverage. N/A.\n');
            await main(['task', 'update', wbs, '--section', 'Testing', '--from-file', testingBody], {
                cwd,
                output: createCapturedOutput(),
            });
            const reviewBody = join(cwd, 'rev-strict-core.md');
            await Bun.write(
                reviewBody,
                '| Priority | Status | Note |\n|----------|--------|------|\n| P1 | DONE | ok |\n',
            );
            await main(['task', 'update', wbs, '--section', 'Review', '--from-file', reviewBody], {
                cwd,
                output: createCapturedOutput(),
            });
            // Walk to testing via --no-lifecycle so only the done transition hits the fallback.
            await main(['task', 'update', wbs, 'todo', '--no-lifecycle'], { cwd, output: createCapturedOutput() });
            await main(['task', 'update', wbs, 'wip', '--no-lifecycle'], { cwd, output: createCapturedOutput() });
            await main(['task', 'update', wbs, 'testing', '--no-lifecycle'], { cwd, output: createCapturedOutput() });

            // Post-0292 tighten: the CLI-layer verdict-artifact gate denies `done` when
            // `.spur/run/<wbs>-verdict.json` is absent (no silent no-artifact allow).
            // This test's subject is the SECONDARY fallback `spur task check` gate, so
            // plant a PASS verdict stub to clear the primary gate and let the fallback
            // run — matching how docs-pipeline.yaml reaches `done` for docs-only tasks.
            await mkdir(join(cwd, '.spur', 'run'), { recursive: true });
            await writeFile(
                join(cwd, '.spur', 'run', `${wbs}-verdict.json`),
                `${JSON.stringify({
                    wbs,
                    verdict: 'PASS',
                    source: 'test-stub',
                    confidence: 'HIGH',
                    requirements: [{ id: 'r1', status: 'MET', evidence: 'stub' }],
                    acceptanceCriteria: [],
                    checks: [{ name: 'stub', status: 'pass', evidence: 'stub' }],
                })}\n`,
            );

            // Attempt done: adapter unavailable (spy + SPUR_GLOBAL_RULES_DIR redirect, see
            // the P3 backstop test above for why both are needed post-0071/R5), fallback
            // runs with strict:false. The only finding is L4 "Missing feature_id" (warning)
            // — must NOT block.
            const output = createCapturedOutput();
            const exitCode = await main(['task', 'update', wbs, 'done'], {
                cwd,
                output,
                env: { ...getEnvVars(), SPUR_GLOBAL_RULES_DIR: join(cwd, 'no-such-global-config') },
            });
            // With the fix (strict:false), the L4 warning stays a warning → pass:true → done succeeds.
            expect(exitCode).toBe(0);
            expect(output.errors.every((e) => !e.includes('blocked'))).toBe(true);
        } finally {
            spy.mockRestore();
        }
    });
    test('fallback done-gate still blocks a task with a hard L3 error (regression guard)', async () => {
        // WHY: fixing Issue B (strict→strict-core) must not loosen the gate for real
        // hard-core errors. L3 "Solution must contain at least one file:line citation"
        // is a hard error even under --strict-core — it must still block done.
        const spy = spyOn(configModule, 'bundledConfigRoot').mockReturnValue(null);
        try {
            const cOut = createCapturedOutput();
            await main(['task', 'create', '--skip-ready', 'Hard L3 gate target'], { cwd, output: cOut });
            const wbs = createdWbs(cOut);

            // Plant Solution WITHOUT a file:line citation → L3 hard error.
            // R1 (0510) rejects such a body at the CLI write seam, so plant it directly
            // in the file so the done-gate regression still sees the real L3 defect.
            const taskPath = createdPath(cOut);
            const rawTask = await Bun.file(taskPath).text();
            await Bun.write(
                taskPath,
                `${rawTask.replace(/\s*$/, '')}\n\n### Solution\n\nChanged everything but forgot the citation.\n`,
            );
            const testingBody = join(cwd, 'test-no-cite.md');
            await Bun.write(testingBody, 'Tests pass. N/A.\n');
            await main(['task', 'update', wbs, '--section', 'Testing', '--from-file', testingBody], {
                cwd,
                output: createCapturedOutput(),
            });
            const reviewBody = join(cwd, 'rev-no-cite.md');
            await Bun.write(
                reviewBody,
                '| Priority | Status | Note |\n|----------|--------|------|\n| P1 | DONE | ok |\n',
            );
            await main(['task', 'update', wbs, '--section', 'Review', '--from-file', reviewBody], {
                cwd,
                output: createCapturedOutput(),
            });

            await main(['task', 'update', wbs, 'todo', '--no-lifecycle'], { cwd, output: createCapturedOutput() });
            await main(['task', 'update', wbs, 'wip', '--no-lifecycle'], { cwd, output: createCapturedOutput() });
            await main(['task', 'update', wbs, 'testing', '--no-lifecycle'], { cwd, output: createCapturedOutput() });

            // Attempt done: hard L3 error → fallback must block even with strict:false.
            // (SPUR_GLOBAL_RULES_DIR redirect: same reason as the P3 backstop test above —
            // keep the adapter genuinely unavailable post-0071/R5's global-fallback tier.)
            const output = createCapturedOutput();
            const exitCode = await main(['task', 'update', wbs, 'done'], {
                cwd,
                output,
                env: { ...getEnvVars(), SPUR_GLOBAL_RULES_DIR: join(cwd, 'no-such-global-config') },
            });
            expect(exitCode).toBe(1);
            expect(output.errors.some((e) => e.includes('blocked'))).toBe(true);
        } finally {
            spy.mockRestore();
        }
    });
    test('0147 regression: feature_id=null task passes --strict-core done-gate (deferral preserved)', async () => {
        // WHY (0148 P1): the testing→done lifecycle FSM guard runs `spur task check <wbs> --strict-core`.
        // Under --strict-core a missing feature_id MUST stay a warning, not an error — the
        // default gate permits deferral (feature_id=null is a TODO, not a blocker). This test
        // locks the 0147 fix: feature_id never silently re-enters the hard-core blocking set.
        const cOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', '0147-regression target'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);

        // Seed Requirements + AC so the only finding is the L4 "Missing feature_id"
        // warning. Post-0339: placeholder Requirements/AC trip L3 empty-section errors.
        const reqBody = join(cwd, `req-0147-${wbs}.md`);
        await Bun.write(reqBody, 'R1. feature_id=null must stay a warning under --strict-core.\n');
        await main(['task', 'update', wbs, '--section', 'Requirements', '--from-file', reqBody], {
            cwd,
            output: createCapturedOutput(),
        });
        const acBody = join(cwd, `ac-0147-${wbs}.md`);
        await Bun.write(acBody, '- [ ] Given feature_id=null / When check --strict-core / Then pass:true.\n');
        await main(['task', 'update', wbs, '--section', 'Acceptance Criteria', '--from-file', acBody], {
            cwd,
            output: createCapturedOutput(),
        });
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'check', wbs, '--strict-core', '--json'], { cwd, output });

        // Must pass: the only L4 finding is "Missing feature_id" at severity=warning.
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lastMessage(output)) as Array<{
            pass: boolean;
            findings: Array<{ message: string; severity: string }>;
        }>;
        const firstResult = parsed[0];
        expect(firstResult).toBeDefined();
        if (!firstResult) {
            throw new Error('missing task check result');
        }
        expect(firstResult.pass).toBe(true);
        // Confirm the feature_id finding is a warning (not an error) — the key 0147 invariant.
        const featureIdFindings = firstResult.findings.filter((f) => f.message.includes('feature_id'));
        expect(featureIdFindings.length).toBeGreaterThan(0);
        expect(featureIdFindings.every((f) => f.severity === 'warning')).toBe(true);
    });
    test('update --section --from-file with non-json output handles warnings', async () => {
        // Create a task with a section that triggers warnings on write (e.g. Review at backlog)
        const cOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Warning test'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);
        const bodyFile = join(cwd, 'body-warn.md');
        await Bun.write(bodyFile, 'Some review text.\n');

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'update', wbs, '--section', 'Review', '--from-file', bodyFile], {
            cwd,
            output,
        });
        // Update should succeed (exit 0); warnings go to error channel (line 112)
        expect(exitCode).toBe(0);
    });
    test('update --section with a body containing a same-level heading emits warnings to error channel', async () => {
        // WHY: a section body that itself contains a same-level markdown heading (###)
        // is demoted one level deeper by PlanningWriteService (task 0701 changed this from
        // an outright strip), which populates result.warnings. The non-JSON path routes
        // those warnings to the error channel.
        const cOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Warn section task'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);
        const bodyFile = join(cwd, 'warn-section-body.md');
        // Body contains a ### heading — same level as section headers, triggers strip warning.
        await Bun.write(
            bodyFile,
            'Some text citing `apps/cli/src/commands/task.ts:1`.\n\n### Rogue heading\n\nMore text.\n',
        );

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'update', wbs, '--section', 'Solution', '--from-file', bodyFile], {
            cwd,
            output,
        });
        expect(exitCode).toBe(0);
        expect(output.errors.some((e) => e.includes('Demoted same-level heading'))).toBe(true);
    });
    test('done guard: PASS verdict advances to done (R4a)', async () => {
        const wbs = await seedTaskAtTesting('guard pass');
        await writeVerdict(wbs, { ...PASS_VERDICT, wbs });
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'update', wbs, 'done', '--no-lifecycle'], { cwd, output });
        expect(exitCode).toBe(0);
        expect(output.messages.join('\n')).toContain('testing → done');
    });
    test('done guard: PARTIAL verdict blocks done with actionable message (R5/R4b)', async () => {
        const wbs = await seedTaskAtTesting('guard partial');
        await writeVerdict(wbs, { ...PARTIAL_VERDICT, wbs });
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'update', wbs, 'done', '--no-lifecycle'], { cwd, output });
        expect(exitCode).toBe(1);
        const msg = output.errors.join('\n') + output.messages.join('\n');
        expect(msg).toContain(wbs);
        expect(msg).toContain('PARTIAL');
        expect(msg).toContain('.spur/run/');
        expect(msg).toContain('--force-done');
        // Task remains at testing.
        expect(await readStatus(wbs)).toBe('testing');
    });
    test('done guard: FAIL verdict blocks done (R4c)', async () => {
        const wbs = await seedTaskAtTesting('guard fail');
        await writeVerdict(wbs, { ...FAIL_VERDICT, wbs });
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'update', wbs, 'done', '--no-lifecycle'], { cwd, output });
        expect(exitCode).toBe(1);
    });
    test('done guard: no verdict file → deny (R4d; require verify or --force-done)', async () => {
        const wbs = await seedTaskAtTesting('guard no-verdict');
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'update', wbs, 'done', '--no-lifecycle'], { cwd, output });
        expect(exitCode).toBe(1);
        const msg = output.errors.join('\n') + output.messages.join('\n');
        expect(msg).toContain('missing verify verdict artifact');
        expect(await readStatus(wbs)).toBe('testing');
    });
    test('done guard: 1123 → F511 — a legacy artifact carrying a confidence value parses and advances', async () => {
        // F511 (task 1207): the 1123 requirement (a PASS must state a level) was retired —
        // a model that can write a PASS can write `HIGH`. The guard reads proof digests only;
        // legacy artifacts that still carry a `confidence` key parse with the value ignored,
        // including out-of-vocabulary ones (read-compat, no error).
        const wbs = await seedTaskAtTesting('guard legacy-confidence');
        await writeVerdict(wbs, { ...PASS_VERDICT, wbs, confidence: 'SURE' });
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'update', wbs, 'done', '--no-lifecycle'], { cwd, output });
        expect(exitCode).toBe(0);
        expect(await readStatus(wbs)).toBe('done');
    });
    test('done guard: no verdict file + --force-done → allow with audit trail', async () => {
        const wbs = await seedTaskAtTesting('guard no-verdict force');
        const output = createCapturedOutput();
        const exitCode = await main(
            ['task', 'update', wbs, 'done', '--no-lifecycle', '--force-done', '--reason', 'docs-only pipeline close'],
            { cwd, output },
        );
        expect(exitCode).toBe(0);
        expect(output.messages.join('\n')).toContain('Override recorded');
    });
    test('done guard: --force-done with PARTIAL records override frontmatter (R3/R5)', async () => {
        const wbs = await seedTaskAtTesting('guard forced');
        await writeVerdict(wbs, { ...PARTIAL_VERDICT, wbs });
        const output = createCapturedOutput();
        const exitCode = await main(
            [
                'task',
                'update',
                wbs,
                'done',
                '--no-lifecycle',
                '--force-done',
                '--reason',
                'telemetry absent is acceptable',
            ],
            { cwd, output },
        );
        expect(exitCode).toBe(0);
        expect(output.messages.join('\n')).toContain('Override recorded');
        // Audit-trail persisted on the task frontmatter.
        const show = createCapturedOutput();
        await main(['task', 'show', wbs, '--json'], { cwd, output: show });
        const raw = show.messages.filter((m) => m.trim().startsWith('{')).pop() ?? '{}';
        const json = JSON.parse(raw);
        // persisted as YAML-quoted "true"; the schema coerces it to boolean at
        // validation time. Assert the override was recorded, either form.
        expect(String(json.frontmatter?.done_forced)).toBe('true');
        expect(json.frontmatter?.done_reason).toBe('telemetry absent is acceptable');
    });
    test('done guard: --no-lifecycle PARTIAL is still verdict-gated (R8 explicit)', async () => {
        const wbs = await seedTaskAtTesting('guard no-lifecycle');
        await writeVerdict(wbs, { ...PARTIAL_VERDICT, wbs });
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'update', wbs, 'done', '--no-lifecycle'], { cwd, output });
        expect(exitCode).toBe(1);
        expect(await readStatus(wbs)).toBe('testing');
    });
    test('--no-lifecycle does not bypass the structural gate on wip→testing', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'bypass regression testing hop'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);
        // Deliberately NOT filled — placeholder Requirements/AC are L3 errors.
        await main(['task', 'update', wbs, 'todo', '--no-lifecycle'], { cwd, output: nullOutput() });
        await main(['task', 'update', wbs, 'wip', '--no-lifecycle'], { cwd, output: nullOutput() });
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'update', wbs, 'testing', '--no-lifecycle'], { cwd, output });
        expect(exitCode).toBe(1);
        const blocked = output.errors.join('\n');
        expect(blocked).toContain('Lifecycle transition blocked');
        // 0808 R3: the message names the target-status probe and its error findings,
        // so a passing plain check no longer reads as a contradiction.
        expect(blocked).toContain(`spur task check ${wbs} --as testing`);
        expect(blocked).toContain('L3.');
        expect(await readStatus(wbs)).toBe('wip');
    });
    test('--no-lifecycle --force-done together cannot land a structurally invalid task at done', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'bypass regression done hop'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);
        await main(['task', 'update', wbs, 'todo', '--no-lifecycle'], { cwd, output: nullOutput() });
        await main(['task', 'update', wbs, 'wip', '--no-lifecycle'], { cwd, output: nullOutput() });
        const output = createCapturedOutput();
        const exitCode = await main(
            ['task', 'update', wbs, 'done', '--no-lifecycle', '--force-done', '--reason', 'probe'],
            { cwd, output },
        );
        expect(exitCode).toBe(1);
        // --force-done waives the VERDICT, never the structural matrix.
        expect(output.errors.join('\n')).toContain('Lifecycle transition blocked');
        expect(await readStatus(wbs)).not.toBe('done');
    });
    test('done guard: same-status no-op is honest and exits 0 (R9)', async () => {
        const wbs = await seedTaskAtTesting('guard noop');
        await writeVerdict(wbs, { ...PASS_VERDICT, wbs });
        // First advance to done.
        await main(['task', 'update', wbs, 'done', '--no-lifecycle'], { cwd, output: nullOutput() });
        // Second call: no-op, exit 0, message is "already done — no transition".
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'update', wbs, 'done', '--no-lifecycle'], { cwd, output });
        expect(exitCode).toBe(0);
        const msg = output.messages.join('\n');
        expect(msg).toContain('already done');
        expect(msg).not.toContain('undefined → undefined');
    });
    test('done guard: inconsistent artifact denied with inconsistency named (R10)', async () => {
        const wbs = await seedTaskAtTesting('guard inconsistent');
        // Stored verdict claims PASS but a row is UNMET.
        await writeVerdict(wbs, {
            wbs,
            verdict: 'PASS',
            requirements: [
                { id: 'R1', status: 'MET', evidence: 'x' },
                { id: 'R2', status: 'UNMET', evidence: 'y' },
            ],
            acceptanceCriteria: [],
            source: 'spur task verdict',
        });
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'update', wbs, 'done', '--no-lifecycle'], { cwd, output });
        expect(exitCode).toBe(1);
        const msg = output.errors.join('\n') + output.messages.join('\n');
        expect(msg).toContain('self-inconsistent');
    });
    test('done guard: case-variant target (Done) is still verdict-gated (R1/R8)', async () => {
        const wbs = await seedTaskAtTesting('guard case-variant');
        await writeVerdict(wbs, { ...PARTIAL_VERDICT, wbs });
        const output = createCapturedOutput();
        // The frontmatter schema alias-normalizes `Done` → `done`, so this IS a
        // `* → done` transition and must pass through the verdict gate.
        const exitCode = await main(['task', 'update', wbs, 'Done', '--no-lifecycle'], { cwd, output });
        expect(exitCode).toBe(1);
        expect(await readStatus(wbs)).toBe('testing');
    });
});
