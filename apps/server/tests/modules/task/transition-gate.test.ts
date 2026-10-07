import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GuardDeniedError } from '@gobing-ai/spur-app';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { createServerContext } from '../../../src/context';
import { mockRuntime } from '../../middleware/helpers';

/**
 * The `done` gate in miniature (mirrors the canonical `standard` variant):
 * `done` requires Solution + Testing and is a gate status, so an L2 violation is
 * a hard error.
 */
const matrix = {
    variants: {
        standard: {
            backlog: { required: ['Background'] },
            todo: { required: ['Background'] },
            wip: { required: ['Background'] },
            testing: { required: ['Solution'] },
            done: { required: ['Solution', 'Testing'], gate: true },
        },
    },
};

const TASK_HEAD = [
    '---',
    'schema_version: 1',
    'name: "Server gate subject"',
    'status: testing',
    'created_at: 2026-06-13T00:00:00.000Z',
    'updated_at: 2026-06-13T00:00:00.000Z',
    '---',
    '',
    '## 0001. Server gate subject',
    '',
];

/** Sections the `done` gate requires, with a cited `file:line` Solution row. */
const GATED_TASK = [
    ...TASK_HEAD,
    '### Background',
    '',
    'Text',
    '',
    '### Solution',
    '',
    '| Req | Status | Evidence |',
    '| R1 | MET | `packages/app/src/gate.ts:1-3` (`gate`) |',
    '',
    '### Testing',
    '',
    '`bun test` — 1 passing',
    '',
].join('\n');

/** Missing the required `Solution`/`Testing` sections → L2 hard error under `gate: true`. */
const UNGATED_TASK = [...TASK_HEAD, '### Background', '', 'Text', ''].join('\n');

const PASS_VERDICT = {
    wbs: '0001',
    verdict: 'PASS',
    // Task 1085: a PASS artifact must carry the verifier's stated confidence
    // level or the shared done gate rejects it before the structural gate runs.
    confidence: 'HIGH',
    requirements: [{ id: 'R1', status: 'MET', evidence: 'a' }],
    acceptanceCriteria: [],
    source: 'test',
};

/**
 * Corpus dir for the synthetic project. Deliberately NOT `docs/tasks`: the server's
 * task resolution probes the relative folder against the process cwd, so a
 * `docs/tasks` fixture would silently read the real repo corpus when the suite runs
 * from the repo root. A name that cannot exist under any cwd keeps the fixture
 * hermetic.
 */
const TASKS_DIR = 'spur-gate-corpus/tasks';

function makeCtx(opts: { task: string; verdict?: unknown; withMatrix?: boolean }) {
    const root = mkdtempSync(join(tmpdir(), 'spur-server-gate-'));
    const tasksDir = join(root, TASKS_DIR);
    mkdirSync(tasksDir, { recursive: true });
    writeFileSync(join(tasksDir, '0001_task.md'), opts.task);
    // Materialize the file `GATED_TASK`'s Solution cites. Since the 0994 follow-up a live
    // record's Testing/Solution `file:line` anchor must RESOLVE at the `--as done` gate
    // (`L4.anchor-unresolved` is an error there), so an unresolvable fixture anchor would
    // deny the transition before the verdict gate these tests exercise. The project root
    // is the parent of the tasks dir (`spur-gate-corpus`), since the fixture deliberately
    // avoids a `docs/tasks` suffix and so takes the `dirname(tasksDir)` branch.
    const evidenceTarget = join(root, 'spur-gate-corpus', 'packages', 'app', 'src', 'gate.ts');
    mkdirSync(join(evidenceTarget, '..'), { recursive: true });
    writeFileSync(evidenceTarget, 'export const gate = true;\nexport const a = 1;\nexport const b = 2;\n');
    if (opts.verdict !== undefined) {
        mkdirSync(join(root, '.spur', 'run'), { recursive: true });
        writeFileSync(join(root, '.spur', 'run', '0001-verdict.json'), JSON.stringify(opts.verdict));
    }
    const ctx = createServerContext(mockRuntime(), {
        cwd: root,
        fs: createNodeFileSystem(root),
        dbUrl: ':memory:',
        folders: {
            tasksDir: TASKS_DIR,
            featuresDir: 'spur-gate-corpus/features',
            foldersConfig: { active_folder: TASKS_DIR, folders: { [TASKS_DIR]: { baseCounter: 0 } } },
        },
        ...(opts.withMatrix === false ? {} : { sectionMatrix: matrix as never }),
    });
    return { ctx, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe('server task.transition gate (task 0966 R3)', () => {
    test('AC1 — refuses done without a PASS verdict (no artifact → deny)', async () => {
        const { ctx, cleanup } = makeCtx({ task: GATED_TASK });
        await expect(ctx.transitionTask({ wbs: '0001', toStatus: 'done' })).rejects.toThrow(GuardDeniedError);
        await expect(ctx.transitionTask({ wbs: '0001', toStatus: 'done' })).rejects.toThrow(
            'missing verify verdict artifact',
        );
        cleanup();
    });

    test('AC1b — refuses done on a non-PASS verdict', async () => {
        const { ctx, cleanup } = makeCtx({
            task: GATED_TASK,
            verdict: { ...PASS_VERDICT, verdict: 'PARTIAL' },
        });
        await expect(ctx.transitionTask({ wbs: '0001', toStatus: 'done' })).rejects.toThrow(GuardDeniedError);
        cleanup();
    });

    test('AC2 — runs the structural check gate (server has no lifecycle port)', async () => {
        // The verdict is PASS, so a denial can only come from the structural gate.
        const { ctx, cleanup } = makeCtx({ task: UNGATED_TASK, verdict: PASS_VERDICT });
        await expect(ctx.transitionTask({ wbs: '0001', toStatus: 'done' })).rejects.toThrow(
            '`spur task check 0001 --as done` failed',
        );
        cleanup();
    });

    test('AC3 — allows a gated transition that passes', async () => {
        const { ctx, cleanup } = makeCtx({ task: GATED_TASK, verdict: PASS_VERDICT });
        const out = await ctx.transitionTask({ wbs: '0001', toStatus: 'done' });
        expect(out.kind).toBe('transitioned');
        if (out.kind === 'transitioned') {
            expect(out.result.toStatus).toBe('done');
        }
        cleanup();
    });

    test('AC3b — a `testing` transition passes the gate without needing a verdict', async () => {
        const { ctx, cleanup } = makeCtx({ task: GATED_TASK });
        const out = await ctx.transitionTask({ wbs: '0001', toStatus: 'testing' });
        expect(out.kind).toBe('transitioned');
        cleanup();
    });

    test('exposes runDir as `<projectRoot>/.spur/run`', () => {
        const { ctx, cleanup } = makeCtx({ task: GATED_TASK });
        expect(ctx.runDir).toBe(join(ctx.cwd, '.spur', 'run'));
        cleanup();
    });
});
