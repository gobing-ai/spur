/**
 * Thin-wrapper integration tests for `spur task create` (apps/cli/src/commands/task/create.ts).
 * Behavioral tests for TaskService live in packages/app/tests/services/task-service.test.ts.
 *
 * These exercise the verb surface through the real `main()` entry point:
 * golden paths, the `--json` envelope shape, and exit codes 0/1/2 (design §10, R5).
 */
import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { existsSync, rmSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FINDING_CODES, TaskCandidateInvalidError, TaskService, WbsCollisionError } from '@gobing-ai/spur-app';
import { getEnvVar, setEnvVar } from '@gobing-ai/spur-config';
import { apiErrorSchema } from '@gobing-ai/spur-contracts';
import { main } from '../../../src/index';
import { type CapturedOutput, createCapturedOutput } from '../../helpers';

let cwd: string;

beforeAll(async () => {
    cwd = join(join(import.meta.dir, '..'), '..', `.tmp-create-task-test-${Date.now()}`);
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

    // F21 task 0787 R4/AC-R3: the create/batch-create failure surface emits ONE
    // parseable result via writeCreateJsonError — raw `--json` gets the ADR-091
    // `ok:false` payload on stdout, `--json --json-envelope` the canonical
    // apiErrorSchema envelope (CLI-local code carried in details.cliCode), and
    // non-JSON invocations keep stderr prose. candidate-invalid exits 1 and
    // carries the checker findings. (The JSON-mode duplicate-WBS push is covered
    // by the 0416 R6 test above.)
    const candidateFindings = [
        {
            layer: 'L3' as const,
            code: FINDING_CODES.L3_AC_EMPTY,
            severity: 'error' as const,
            section: 'Acceptance Criteria',
            message: 'Acceptance Criteria has no criteria.',
        },
    ];

    // Cover the scaffold-tests action (function-coverage gate for task.ts)

    test('create writes a task file and exits 0', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'create', '--skip-ready', 'Unit test task'], { cwd, output });
        expect(exitCode).toBe(0);
        const content = await Bun.file(createdPath(output)).text();
        expect(content).toContain('Unit test task');
    });
    test('create --json returns the write-result envelope', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'create', '--skip-ready', 'JSON task', '--json'], { cwd, output });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lastMessage(output));
        expect(parsed.ref.kind).toBe('task');
        expect(parsed.ref.id).toMatch(/^\d{4}$/);
        expect(parsed.eventName).toBe('task.created');
        // Additive top-level mirrors (task 0510): a script projecting `wbs`/`filePath`
        // must not read nulls on success.
        expect(parsed.wbs).toBe(parsed.ref.id);
        expect(parsed.filePath).toBe(parsed.ref.filePath);
    });
    test('create with --feature adds feature_id', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'create', '--skip-ready', 'Feature task', '--feature', 'A'], {
            cwd,
            output,
        });
        expect(exitCode).toBe(0);
        const content = await Bun.file(createdPath(output)).text();
        expect(content).toContain('feature_id: A');
    });
    test('create --feature twice with same title within window exits 3 (duplicate-follow-up)', async () => {
        const isoCwd = join(join(import.meta.dir, '..'), '..', `.tmp-create-task-dedup-${Date.now()}`);
        await mkdir(join(isoCwd, 'docs', 'tasks'), { recursive: true });
        try {
            const first = createCapturedOutput();
            await main(['task', 'create', '--skip-ready', 'Dedup clone', '--feature', 'D1', '--json'], {
                cwd: isoCwd,
                output: first,
            });
            expect(first.errors.join('')).toBe('');
            const firstWbs = JSON.parse(lastMessage(first)).ref.id;

            const second = createCapturedOutput();
            const exitCode = await main(
                ['task', 'create', '--skip-ready', 'Dedup clone', '--feature', 'D1', '--json'],
                {
                    cwd: isoCwd,
                    output: second,
                },
            );
            expect(exitCode).toBe(3);
            expect(second.errors).toEqual([]);
            expect(JSON.parse(lastMessage(second))).toMatchObject({
                ok: false,
                error: {
                    code: 'duplicate-follow-up',
                    existingWbs: firstWbs,
                    existingName: 'Dedup clone',
                    attemptedName: 'Dedup clone',
                },
            });
        } finally {
            rmSync(isoCwd, { recursive: true, force: true });
        }
    });
    test('create --feature --dedupe-within overrides the default window', async () => {
        const isoCwd = join(join(import.meta.dir, '..'), '..', `.tmp-create-task-dedup-window-${Date.now()}`);
        await mkdir(join(isoCwd, 'docs', 'tasks'), { recursive: true });
        try {
            const first = createCapturedOutput();
            await main(['task', 'create', '--skip-ready', 'Window dup', '--feature', 'W1'], {
                cwd: isoCwd,
                output: first,
            });
            const taskPath = createdPath(first);
            const content = await readFile(taskPath, 'utf8');
            const twoMinutesAgo = new Date(Date.now() - 120_000).toISOString();
            await writeFile(taskPath, content.replaceAll(/(created_at|updated_at): .+/g, `$1: ${twoMinutesAgo}`));

            const second = createCapturedOutput();
            const exitCode = await main(
                ['task', 'create', '--skip-ready', 'Window dup', '--feature', 'W1', '--dedupe-within', '60'],
                {
                    cwd: isoCwd,
                    output: second,
                },
            );
            expect(exitCode).toBe(0);
        } finally {
            rmSync(isoCwd, { recursive: true, force: true });
        }
    });
    for (const invalid of ['0', '-1', '1.5', 'nope', '60junk']) {
        test(`create rejects invalid --dedupe-within ${invalid}`, async () => {
            const output = createCapturedOutput();
            const exitCode = await main(
                ['task', 'create', '--skip-ready', 'Invalid window', '--feature', 'W2', '--dedupe-within', invalid],
                {
                    cwd,
                    output,
                },
            );
            expect(exitCode).toBe(2);
            expect(output.errors.join('')).toContain('--dedupe-within must be a positive integer');
        });
    }
    test('create --feature --allow-duplicate-name overrides dedup (exit 0)', async () => {
        const isoCwd = join(join(import.meta.dir, '..'), '..', `.tmp-create-task-dedup-allow-${Date.now()}`);
        await mkdir(join(isoCwd, 'docs', 'tasks'), { recursive: true });
        try {
            const first = createCapturedOutput();
            await main(['task', 'create', '--skip-ready', 'Allow dup', '--feature', 'A1'], {
                cwd: isoCwd,
                output: first,
            });

            const second = createCapturedOutput();
            const exitCode = await main(
                ['task', 'create', '--skip-ready', 'Allow dup', '--feature', 'A1', '--allow-duplicate-name'],
                {
                    cwd: isoCwd,
                    output: second,
                },
            );
            expect(exitCode).toBe(0);
        } finally {
            rmSync(isoCwd, { recursive: true, force: true });
        }
    });
    test('create without --feature dedups within the window (unscoped)', async () => {
        const isoCwd = join(join(import.meta.dir, '..'), '..', `.tmp-create-task-dedup-nofeature-${Date.now()}`);
        await mkdir(join(isoCwd, 'docs', 'tasks'), { recursive: true });
        try {
            const first = createCapturedOutput();
            await main(['task', 'create', '--skip-ready', 'No scope dup', '--json'], { cwd: isoCwd, output: first });
            expect(first.errors.join('')).toBe('');
            const firstWbs = JSON.parse(lastMessage(first)).wbs;

            const second = createCapturedOutput();
            const exitCode = await main(['task', 'create', '--skip-ready', 'No scope dup', '--json'], {
                cwd: isoCwd,
                output: second,
            });
            expect(exitCode).toBe(3);
            expect(JSON.parse(lastMessage(second))).toMatchObject({
                ok: false,
                error: {
                    code: 'duplicate-follow-up',
                    existingWbs: firstWbs,
                    attemptedName: 'No scope dup',
                },
            });
        } finally {
            rmSync(isoCwd, { recursive: true, force: true });
        }
    });
    test('create without --feature --allow-duplicate-name overrides dedup (exit 0)', async () => {
        const isoCwd = join(join(import.meta.dir, '..'), '..', `.tmp-create-task-dedup-nofeature-allow-${Date.now()}`);
        await mkdir(join(isoCwd, 'docs', 'tasks'), { recursive: true });
        try {
            const first = createCapturedOutput();
            await main(['task', 'create', '--skip-ready', 'No scope allow'], { cwd: isoCwd, output: first });

            const second = createCapturedOutput();
            const exitCode = await main(
                ['task', 'create', '--skip-ready', 'No scope allow', '--allow-duplicate-name'],
                {
                    cwd: isoCwd,
                    output: second,
                },
            );
            expect(exitCode).toBe(0);
        } finally {
            rmSync(isoCwd, { recursive: true, force: true });
        }
    });
    test('create without --feature --dedupe-within overrides the default window', async () => {
        const isoCwd = join(join(import.meta.dir, '..'), '..', `.tmp-create-task-dedup-nofeature-window-${Date.now()}`);
        await mkdir(join(isoCwd, 'docs', 'tasks'), { recursive: true });
        try {
            const first = createCapturedOutput();
            await main(['task', 'create', '--skip-ready', 'No scope window'], { cwd: isoCwd, output: first });
            const taskPath = createdPath(first);
            const content = await readFile(taskPath, 'utf8');
            const twoMinutesAgo = new Date(Date.now() - 120_000).toISOString();
            await writeFile(taskPath, content.replaceAll(/(created_at|updated_at): .+/g, `$1: ${twoMinutesAgo}`));

            const second = createCapturedOutput();
            const exitCode = await main(
                ['task', 'create', '--skip-ready', 'No scope window', '--dedupe-within', '60'],
                {
                    cwd: isoCwd,
                    output: second,
                },
            );
            expect(exitCode).toBe(0);
        } finally {
            rmSync(isoCwd, { recursive: true, force: true });
        }
    });
    test('create with --parent adds parent_wbs', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'create', '--skip-ready', 'Child task', '--parent', '0042'], {
            cwd,
            output,
        });
        expect(exitCode).toBe(0);
        const content = await Bun.file(createdPath(output)).text();
        expect(content).toContain('parent_wbs: "0042"');
    });
    test('create --template writes the variant to frontmatter', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'create', '--skip-ready', 'Issue task', '--template', 'issue'], {
            cwd,
            output,
        });
        expect(exitCode).toBe(0);
        const content = await Bun.file(createdPath(output)).text();
        expect(content).toContain('template: issue');
    });
    test('create --template rejects an unknown variant with exit 2', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'create', '--skip-ready', 'Bad variant', '--template', 'nope'], {
            cwd,
            output,
        });
        expect(exitCode).toBe(2);
        expect(output.errors.join('')).toContain('Unknown template variant');
    });
    test('create --template meta uses the meta template', async () => {
        // First access of 'meta' variant exercises bundled fallback + cache miss paths
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'create', '--skip-ready', 'Meta task', '--template', 'meta'], {
            cwd,
            output,
        });
        expect(exitCode).toBe(0);
        const content = await Bun.file(createdPath(output)).text();
        expect(content).toContain('template: meta');
    });
    test('create --template brainstorm uses the brainstorm template', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'create', '--skip-ready', 'Brainstorm task', '--template', 'brainstorm'], {
            cwd,
            output,
        });
        expect(exitCode).toBe(0);
        const content = await Bun.file(createdPath(output)).text();
        expect(content).toContain('Brainstorm task');
        expect(content).toContain('template: brainstorm');
    });
    test('create --template review seeds Review Findings as input under Background', async () => {
        // WHY: a review task logs the code-review findings as INPUT (under Background's
        // `#### Review Findings`) to be fixed; the `### Review` section is reserved for
        // post-fix reflection. With template-as-skeleton rendering, ALL template sections
        // appear at creation (including `### Review` with its guidance text).
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'create', '--skip-ready', 'Fix review', '--template', 'review'], {
            cwd,
            output,
        });
        expect(exitCode).toBe(0);
        const content = await Bun.file(createdPath(output)).text();
        expect(content).toContain('template: review');
        expect(content).toContain('#### Review Findings');
        expect(content).toMatch(/Severity\s+\|\s+File\s+\|\s+Finding/);
        expect(content).toMatch(/\n### Review\n/);
    });
    test('create with malformed config falls back to defaults', async () => {
        const dir = join(cwd, 'malformed-cfg');
        await mkdir(dir, { recursive: true });
        await mkdir(join(dir, 'docs', 'tasks'), { recursive: true });
        await mkdir(join(dir, '.spur'), { recursive: true });
        // Write a YAML file that fails to parse (trailing colon is invalid)
        await Bun.write(join(dir, '.spur', 'config.yaml'), 'tasks:\n  active:\n');

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'create', '--skip-ready', 'Malformed cfg task'], { cwd: dir, output });
        expect(exitCode).toBe(0); // falls back to defaults, still creates task
        rmSync(dir, { recursive: true, force: true });
    });
    test('create exits 3 with wbs-collision JSON on WbsCollisionError (0416 R1)', async () => {
        const spy = spyOn(TaskService.prototype, 'create').mockImplementation(async () => {
            throw new WbsCollisionError(
                '0001',
                join(cwd, 'docs', 'tasks', '0001_existing.md'),
                join(cwd, 'docs', 'tasks', '0001_new.md'),
            );
        });
        try {
            const output = createCapturedOutput();
            const exitCode = await main(['task', 'create', '--skip-ready', 'Colliding task', '--json'], {
                cwd,
                output,
            });
            expect(exitCode).toBe(3);
            expect(output.errors).toEqual([]);
            expect(JSON.parse(lastMessage(output))).toMatchObject({
                ok: false,
                error: {
                    code: 'wbs-collision',
                    wbs: '0001',
                    existingPath: join(cwd, 'docs', 'tasks', '0001_existing.md'),
                    attemptedPath: join(cwd, 'docs', 'tasks', '0001_new.md'),
                },
            });
        } finally {
            spy.mockRestore();
        }
    });
    test('create exits 3 and writes human-readable error on WbsCollisionError without --json (0416 R1)', async () => {
        const spy = spyOn(TaskService.prototype, 'create').mockImplementation(async () => {
            throw new WbsCollisionError(
                '0002',
                join(cwd, 'docs', 'tasks', '0002_existing.md'),
                join(cwd, 'docs', 'tasks', '0002_new.md'),
            );
        });
        try {
            const output = createCapturedOutput();
            const exitCode = await main(['task', 'create', '--skip-ready', 'Colliding task'], { cwd, output });
            expect(exitCode).toBe(3);
            // Non-JSON path: the error message goes to the error sink, not stdout.
            expect(output.errors.length).toBeGreaterThan(0);
            expect(output.errors.join('')).toContain('wbs-collision');
            expect(output.errors.join('')).toContain('0002');
        } finally {
            spy.mockRestore();
        }
    });
    test('create exits 1 with candidate-invalid JSON carrying findings (F21 0787 R4)', async () => {
        const spy = spyOn(TaskService.prototype, 'create').mockImplementation(async () => {
            throw new TaskCandidateInvalidError('Bad candidate', candidateFindings);
        });
        try {
            const output = createCapturedOutput();
            const exitCode = await main(['task', 'create', '--skip-ready', 'Bad candidate', '--json'], { cwd, output });
            expect(exitCode).toBe(1);
            expect(output.errors).toEqual([]);
            expect(JSON.parse(lastMessage(output))).toMatchObject({
                ok: false,
                error: { code: 'candidate-invalid', findings: candidateFindings },
            });
        } finally {
            spy.mockRestore();
        }
    });
    test('create --json --json-envelope emits an apiErrorSchema envelope with cliCode + findings (F21 0787 R4)', async () => {
        const spy = spyOn(TaskService.prototype, 'create').mockImplementation(async () => {
            throw new TaskCandidateInvalidError('Bad candidate', candidateFindings);
        });
        try {
            const output = createCapturedOutput();
            const exitCode = await main(
                ['task', 'create', '--skip-ready', 'Bad candidate', '--json', '--json-envelope'],
                {
                    cwd,
                    output,
                },
            );
            expect(exitCode).toBe(1);
            const parsed = apiErrorSchema.parse(JSON.parse(lastMessage(output)));
            expect(parsed.ok).toBe(false);
            expect(parsed.error.code).toBe('INTERNAL_ERROR');
            expect(parsed.error.message).toContain('Bad candidate');
            const details = parsed.error.details as Record<string, unknown>;
            expect(details.cliCode).toBe('candidate-invalid');
            expect(details.findings).toEqual(candidateFindings);
        } finally {
            spy.mockRestore();
        }
    });
    test('create exits 1 with human-readable error on TaskCandidateInvalidError without --json (F21 0787 R4)', async () => {
        const spy = spyOn(TaskService.prototype, 'create').mockImplementation(async () => {
            throw new TaskCandidateInvalidError('Bad candidate', candidateFindings);
        });
        try {
            const output = createCapturedOutput();
            const exitCode = await main(['task', 'create', '--skip-ready', 'Bad candidate'], { cwd, output });
            expect(exitCode).toBe(1);
            // Non-JSON path: stderr prose, stdout untouched.
            expect(output.messages).toEqual([]);
            expect(output.errors.join('')).toContain('rejected before persistence');
        } finally {
            spy.mockRestore();
        }
    });
});

describe('spur task ready-by-default (0788, fake executor)', () => {
    let isoCwd: string;
    let binDir: string;
    let savedPath: string | undefined;

    // Substantive replacements for the template placeholder comments — the same
    // fills that make `task check --as todo` pass with warnings only (verified
    // against the real checker).
    const AC_PLACEHOLDER =
        '<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- \\[ \\] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- \\[ \\] R1. <text>`, checked at close. Keep empty if this task has no objective AC yet. -->';
    const DESIGN_PLACEHOLDER =
        '<!-- Chosen approach, key tradeoffs, invariants, and impacted surfaces. Keep snippets short. -->';
    const PLAN_PLACEHOLDER = '<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->';

    beforeAll(async () => {
        isoCwd = join(join(import.meta.dir, '..'), '..', `.tmp-create-task-ready-${Date.now()}`);
        await mkdir(join(isoCwd, 'docs', 'tasks'), { recursive: true });
        await mkdir(join(isoCwd, '.spur'), { recursive: true });
        // An agent.default must be a role or a configured executor; declare the
        // executor HERE (tests run with SPUR_SKIP_GLOBAL_CONFIG=true, so no
        // global layer merges in) pinning the claude shim our fake bin serves.
        await writeFile(
            join(isoCwd, '.spur', 'config.yaml'),
            'agent:\n  default: coder\n  executors:\n    - name: fakeprep\n      agent: claude\n      tier: standard\n',
        );
        binDir = join(isoCwd, '.fake-bin');
        await mkdir(binDir, { recursive: true });
    });

    afterAll(() => {
        if (savedPath !== undefined) setEnvVar('PATH', savedPath);
        rmSync(isoCwd, { recursive: true, force: true });
    });

    /** Install a fake `claude` on PATH. `behavior` shapes the -p response. */
    async function installFakeClaude(
        behavior: 'prepare' | 'prepare-batch' | 'reject-batch' | 'log-only',
    ): Promise<string> {
        const log = join(binDir, `invocations-${behavior}-${Math.random().toString(36).slice(2)}.log`);
        const body = `#!/bin/sh
touch '${log}'
if [ "$1" = "--version" ]; then
  echo 'claude 1.0.0 (fake)'
  exit 0
fi
if [ "$1" = "-p" ]; then
  input="$2"
  printf '%s\\n' "$input" >> '${log}'
  case '${behavior}' in
    log-only)
      echo "noop"; exit 0 ;;
    prepare)
      wbs=$(printf '%s' "$input" | grep -oE '[0-9]{4}' | head -1)
      file=$(ls docs/tasks/"\${wbs}"_*.md 2>/dev/null | head -1)
      if [ -n "$file" ]; then
        sed -i.bak \\
          -e 's|${AC_PLACEHOLDER}|- [ ] Prepared scenario covers R1 (fake).|' \\
          -e 's|${DESIGN_PLACEHOLDER}|Fake prepared design: single-seam approach with substance.|' \\
          -e 's|${PLAN_PLACEHOLDER}|1. Fake prepared step one.|' "$file"
        rm -f "$file.bak"
      fi
      echo "prepared"
      exit 0 ;;
    prepare-batch)
      cat <<'JSON'
[{"name":"Batch alpha","background":"Prepared background from fake.","requirements":"- [ ] R1. Prepared requirement.","acceptance_criteria":"- [ ] Prepared AC scenario.","design":"Fake prepared design.","plan":"1. Fake prepared plan step."}]
JSON
      exit 0 ;;
    reject-batch)
      echo 'definitely not json'
      exit 0 ;;
  esac
fi
echo "unsupported args: $*" >&2
exit 1
`;
        const script = join(binDir, 'claude');
        await writeFile(script, body);
        await Bun.$`chmod +x ${script}`.quiet();
        if (savedPath === undefined) savedPath = getEnvVar('PATH');
        setEnvVar('PATH', `${binDir}:${savedPath}`);
        return log;
    }

    function dropFakeFromPath(): void {
        // Minimal system PATH: no fake dir AND no real claude install — the
        // resolution ladder must find nothing.
        setEnvVar('PATH', '/usr/bin:/bin:/usr/sbin:/sbin');
    }

    test('default flow prepares and promotes the task to todo', async () => {
        const log = await installFakeClaude('prepare');
        const output = createCapturedOutput();
        const code = await main(['task', 'create', 'Ready target', '--json'], { cwd: isoCwd, output });
        if (code !== 0)
            throw new Error(`create failed (${code}): ${lastMessage(output)} :: ERR ${output.errors.join(' | ')}`);
        const parsed = JSON.parse(lastMessage(output));
        expect(parsed.eventName).toBe('task.created');
        expect(parsed.readiness).toEqual({ status: 'ready', depth: 'ready' });
        // The fake saw exactly one refine dispatch naming the wbs at ready depth.
        const dispatched = (await readFile(log, 'utf8'))
            .trim()
            .split('\n')
            .filter((l) => l.startsWith('/'));
        expect(dispatched.length).toBe(1);
        expect(dispatched[0]).toContain('/sp:dev-refine');
        expect(dispatched[0]).toContain(parsed.wbs);
        expect(dispatched[0]).toContain('--depth ready');
        // The task was promoted.
        const body = await readFile(parsed.filePath, 'utf8');
        expect(body).toMatch(/status: todo/);
        expect(body).toContain('Fake prepared design');
    });
    test('--skip-ready dispatches nothing and reports skipped readiness', async () => {
        const log = await installFakeClaude('log-only');
        const output = createCapturedOutput();
        const code = await main(['task', 'create', 'Skip ready', '--skip-ready', '--json'], { cwd: isoCwd, output });
        expect(code).toBe(0);
        const parsed = JSON.parse(lastMessage(output));
        expect(parsed.readiness).toEqual({ status: 'skipped', depth: 'ready' });
        const body = await readFile(parsed.filePath, 'utf8');
        expect(body).toMatch(/status: backlog/);
        // Zero dispatches: the fake was never invoked, so its log never appeared.
        expect(existsSync(log)).toBe(false);
    });

    test('missing executor fails preparation at agent-run stage and keeps the capture', async () => {
        await installFakeClaude('log-only');
        dropFakeFromPath();
        const output = createCapturedOutput();
        const code = await main(['task', 'create', 'No executor', '--json'], { cwd: isoCwd, output });
        expect(code).toBe(1);
        const parsed = JSON.parse(lastMessage(output));
        expect(parsed.error.code).toBe('preparation-failed');
        expect(parsed.error.failedStage).toBe('agent-run');
        expect(parsed.error.readiness).toEqual({ status: 'failed', depth: 'ready' });
        expect(parsed.error.recoveryCommand).toBe(`/sp:dev-refine ${parsed.error.wbs} --auto --depth ready`);
        // The capture survived: the task file exists and stays in backlog.
        expect(existsSync(parsed.error.filePath)).toBe(true);
        const body = await readFile(parsed.error.filePath, 'utf8');
        expect(body).toMatch(/status: backlog/);
    });

    test('retry after failed preparation keeps the same WBS identity', async () => {
        const output = createCapturedOutput();
        const first = await main(['task', 'create', 'Retry identity', '--skip-ready', '--json'], {
            cwd: isoCwd,
            output,
        });
        expect(first).toBe(0);
        const wbs = JSON.parse(lastMessage(output)).wbs;
        // A plain duplicate of the same capture is rejected with the SAME wbs.
        const second = createCapturedOutput();
        const dup = await main(['task', 'create', 'Retry identity', '--skip-ready', '--json'], {
            cwd: isoCwd,
            output: second,
        });
        expect(dup).toBe(3);
        expect(JSON.parse(lastMessage(second)).error.existingWbs).toBe(wbs);
    });

    test('batch-create with prepared output creates ready tasks in order', async () => {
        await installFakeClaude('prepare-batch');
        const batchFile = join(isoCwd, `.batch-ready-${Date.now()}.json`);
        await writeFile(batchFile, `${JSON.stringify([{ name: 'Batch alpha' }])}\n`);
        const output = createCapturedOutput();
        const code = await main(['task', 'batch-create', '--file', batchFile, '--json'], { cwd: isoCwd, output });
        expect(code).toBe(0);
        const parsed = JSON.parse(lastMessage(output));
        expect(parsed.created).toBe(1);
        expect(parsed.readiness.status).toBe('ready');
        const body = await readFile(join(isoCwd, 'docs', 'tasks', `${parsed.wbs[0]}_batch-alpha.md`), 'utf8');
        expect(body).toContain('Fake prepared design');
        await rmSync(batchFile, { force: true });
    });

    test('batch-create rejects invalid prepared output atomically', async () => {
        await installFakeClaude('reject-batch');
        const batchFile = join(isoCwd, `.batch-reject-${Date.now()}.json`);
        await writeFile(batchFile, `${JSON.stringify([{ name: 'Batch reject' }])}\n`);
        const tasksBefore = (await readdir(join(isoCwd, 'docs', 'tasks'))).length;
        const output = createCapturedOutput();
        const code = await main(['task', 'batch-create', '--file', batchFile, '--json'], { cwd: isoCwd, output });
        expect(code).toBe(1);
        const parsed = JSON.parse(lastMessage(output));
        expect(parsed.error.code).toBe('preparation-failed');
        expect(parsed.error.failedStage).toBe('invalid-output');
        // Atomicity: nothing was committed.
        expect((await readdir(join(isoCwd, 'docs', 'tasks'))).length).toBe(tasksBefore);
        await rmSync(batchFile, { force: true });
    });

    test('--agent together with --skip-ready is invalid usage', async () => {
        await installFakeClaude('log-only');
        const output = createCapturedOutput();
        const code = await main(['task', 'create', 'Contradiction', '--skip-ready', '--agent', 'claude', '--json'], {
            cwd: isoCwd,
            output,
        });
        expect(code).toBe(2);
        const parsed = JSON.parse(lastMessage(output));
        expect(parsed.error.code).toBe('invalid-usage');
    });
});
