import { expect, setDefaultTimeout, test } from 'bun:test';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTempProject, runCli } from '../helpers';

/**
 * Task 1435 R1–R5 — E2E proof: an idea run files follow-ups and discovery findings and leaves a
 * receipt.
 *
 * Drives the bundled idea-pipeline.yaml through real `spur` subprocesses (runCli) in a temp
 * project with executor:host, profile:auto, design:skip, idea_approved:true. Every agent.run
 * stage pauses as a work item; the answer is its expectFiles plus a receipt
 * (packages/app/src/workflow/receipt.ts) and `workflow continue --answer-text`. The scripted
 * feature-create step files I3/I5 with real `spur feature create` calls and writes the follow-up
 * ledger (shape per checkFollowupLedger, packages/app/src/workflow/idea-handoff.ts). The negative
 * leg removes the I5 row and proves `spur feature handoff` fails closed naming I5 with no report.
 * The observed outcome lands in .spur/run/idea-followup-ledger-e2e-receipt.json; publish a
 * successful preview to docs/reports deliberately, outside a feature verification run.
 */
setDefaultTimeout(120_000);

const REPO_ROOT = join(import.meta.dir, '..', '..', '..', '..');
const IDEA_PIPELINE = join(REPO_ROOT, 'config', 'workflows', 'idea-pipeline.yaml');
const RECEIPT_PATH = join(REPO_ROOT, '.spur', 'run', 'idea-followup-ledger-e2e-receipt.json');

const IDEA = 'Add a preview command with export and cache handling';
const EXCLUDED_I4 = 'operator ruled out';
const MAIN_GOAL = 'Polish the preview command so the operator can render files quickly.\n';
const MAIN_SCOPE = '- In: preview rendering and caching.\n- Out: export formats.\n';

interface WorkItemView {
    state: string;
    expectFiles: string[];
}

interface RunView {
    status: string;
    finalState?: string;
    pause?: { workItem?: WorkItemView };
}

interface LedgerRow {
    item: string;
    disposition: string;
    featureId: string;
    title: string;
}

interface E2eReceipt {
    generatedAt: string;
    runId: string | null;
    finalState: string | null;
    ledger: LedgerRow[];
    followupsFiled: string[];
    excluded: string[];
    negativeLeg: { exitCode: number | null; message: string };
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null) throw new Error(`${label} is not a JSON object`);
    return value as Record<string, unknown>;
}

/** Narrow a `workflow run/continue --json` document to the fields the proof reads. */
function asRun(json: unknown): RunView {
    const run = asRecord(json, 'workflow json');
    const pause = run.pause === undefined ? undefined : asRecord(run.pause, 'workflow pause');
    const item = pause?.workItem === undefined ? undefined : asRecord(pause.workItem, 'work item');
    const expectFiles = Array.isArray(item?.expectFiles) ? item.expectFiles.map(String) : [];
    return {
        status: String(run.status),
        ...(typeof run.finalState === 'string' ? { finalState: run.finalState } : {}),
        ...(pause && item !== undefined ? { pause: { workItem: { state: String(item.state), expectFiles } } } : {}),
    };
}

/** The created feature id from a `feature create --json` document (`.ref.id`, not a top-level id). */
function asFeatureId(json: unknown): string {
    const id = String(asRecord(asRecord(json, 'feature create json').ref, 'feature ref').id ?? '');
    if (id === '') throw new Error('feature create json carries no ref.id');
    return id;
}

function asLedgerRows(json: unknown): LedgerRow[] {
    if (!Array.isArray(json)) throw new Error('follow-up ledger is not a JSON array');
    return json.map((row) => {
        const r = asRecord(row, 'ledger row');
        return {
            item: String(r.item),
            disposition: String(r.disposition),
            featureId: String(r.featureId),
            title: String(r.title),
        };
    });
}

/** One `## <heading>` section body of the handoff report (up to the next heading). */
function sectionOf(report: string, heading: string): string {
    const start = report.indexOf(`${heading}\n`);
    if (start === -1) throw new Error(`handoff report has no ${heading} section`);
    const rest = report.slice(start + heading.length + 1);
    const next = rest.indexOf('\n## ');
    return next === -1 ? rest : rest.slice(0, next);
}

function listLines(section: string): string[] {
    return section
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '' && line !== 'none');
}

/** R2 fixture — the discovery artifact the scripted host answer writes. */
function evalReport(runId: string): string {
    return [
        '# Idea evaluation',
        '',
        '## Recommendation',
        '',
        'proceed',
        '',
        '## Requirement inventory',
        '',
        '- **I1** — The operator can render a preview of the selected file',
        '- **I2** — Preview output is cached so repeated opens are fast',
        '- **I3** — Export the rendered preview to PDF [deferred: follow-up — Preview export]',
        `- **I4** — Reintroduce the legacy --raw flag [deferred: excluded — ${EXCLUDED_I4}]`,
        '- **I5** — (source: discovery — src/preview.ts:12) [deferred: follow-up — Preview cache invalidation]',
        '',
        '---',
        `run_id: ${runId}`,
        `generated_at: ${new Date().toISOString()}`,
        '---',
        '',
    ].join('\n');
}

const AC_CONTENT = [
    '```gherkin',
    'Feature: Preview command polish',
    '',
    '  Scenario: Operator renders a cached preview',
    '    # covers: I1, I2',
    '    Given a file with a warm preview cache',
    '    When the operator runs the preview command',
    '    Then the cached rendered output is shown',
    '```',
    '',
].join('\n');

const TASK_BATCH = [
    [
        { name: 'Render preview output', feature_id: 'PLACEHOLDER' },
        { name: 'Cache preview renders', feature_id: 'PLACEHOLDER' },
    ],
    [
        { name: 'Render preview output', depends_on_names: [] },
        { name: 'Cache preview renders', depends_on_names: ['Render preview output'] },
    ],
] as const;

async function createFeature(dir: string, name: string, parent?: string): Promise<string> {
    const args = parent === undefined ? ['feature', 'create', name] : ['feature', 'create', name, '--parent', parent];
    const res = await runCli([...args, '--json'], dir);
    expect(res.code, res.stderr).toBe(0);
    return asFeatureId(res.json);
}

async function updateSection(dir: string, id: string, section: string, file: string): Promise<void> {
    const res = await runCli(['feature', 'update', id, '--section', section, '--from-file', file], dir);
    expect(res.code, res.stderr).toBe(0);
}

async function writeWorkItemReceipt(dir: string, runId: string, state: string, files: string[]): Promise<string> {
    await mkdir(join(dir, '.spur', 'run', runId, 'receipts'), { recursive: true });
    const now = new Date().toISOString();
    const receipt = {
        runId,
        state,
        executor: 'host',
        outcome: 'done',
        startedAt: now,
        finishedAt: now,
        files,
        reason: null,
    };
    const relative = join('.spur', 'run', runId, 'receipts', `${state}.json`);
    await writeFile(join(dir, relative), `${JSON.stringify(receipt, null, 2)}\n`);
    return relative;
}

test('I15 1435: an idea run files follow-ups and discovery findings and leaves a receipt', async () => {
    expect(RECEIPT_PATH).toStartWith(join(REPO_ROOT, '.spur', 'run'));
    const dir = await createTempProject();
    const runId = 'idea-followup-e2e';
    const negRunId = 'idea-followup-e2e-neg';
    const runDir = join(dir, '.spur', 'run');
    const observed: E2eReceipt = {
        generatedAt: '',
        runId: null,
        finalState: null,
        ledger: [],
        followupsFiled: [],
        excluded: [],
        negativeLeg: { exitCode: null, message: '' },
    };
    try {
        await mkdir(join(dir, '.spur'), { recursive: true });
        await writeFile(join(dir, '.spur', 'config.yaml'), 'workflow:\n  decideDecisionMaker: false\n');
        // Answer one host work item: assert the pause names the state, write the stage files AFTER
        // the pause appears (stage onEnter shells delete stale artifacts), then receipt + continue.
        const resume = async (view: RunView, state: string, writeFiles: () => Promise<void>): Promise<RunView> => {
            const item = view.pause?.workItem;
            expect(item?.state, `expected a work-item pause at ${state}`).toBe(state);
            await writeFiles();
            const receipt = await writeWorkItemReceipt(dir, runId, state, item?.expectFiles ?? []);
            const next = await runCli(
                ['workflow', 'continue', runId, '--yes', '--answer-text', receipt, '--json'],
                dir,
            );
            return asRun(next.json);
        };

        const started = asRun(
            (
                await runCli(
                    [
                        'workflow',
                        'run',
                        IDEA_PIPELINE,
                        '--run-id',
                        runId,
                        '--vars',
                        JSON.stringify({
                            executor: 'host',
                            profile: 'auto',
                            design: 'skip',
                            idea_approved: 'true',
                            idea: IDEA,
                        }),
                        '--json',
                    ],
                    dir,
                )
            ).json,
        );
        expect(started).toMatchObject({ status: 'paused', finalState: 'discovery' });
        observed.runId = runId;

        // discovery — the scripted eval report (I1–I5 per R2) plus the needs-design signal.
        const featureCreateView = await resume(started, 'discovery', async () => {
            await writeFile(join(runDir, `${runId}-idea-eval-report.md`), evalReport(runId));
            await writeFile(join(runDir, `${runId}-idea-needs-design.json`), '{"needs_design": false}\n');
        });
        expect(featureCreateView).toMatchObject({ status: 'paused', finalState: 'feature-create' });

        // feature-create — real corpus writes: the main feature and both follow-ups, each with
        // Goal/Scope through `spur feature update`, then the ledger the yaml shell gate validates.
        let mainId = '';
        const followUpDefs = [
            {
                item: 'I3',
                title: 'Preview export',
                goal: 'Export a rendered preview to PDF.\n',
                scope: '- In: PDF export of the preview canvas.\n',
            },
            {
                item: 'I5',
                title: 'Preview cache invalidation',
                goal: 'Invalidate the preview cache when source files change.\n',
                scope: '- In: cache key derivation.\n',
            },
        ];
        const acView = await resume(featureCreateView, 'feature-create', async () => {
            const goal = join(runDir, `${runId}-idea-goal.md`);
            const scope = join(runDir, `${runId}-idea-scope.md`);
            const followupGoal = join(dir, 'followup-goal.md');
            const followupScope = join(dir, 'followup-scope.md');
            await writeFile(goal, MAIN_GOAL);
            await writeFile(scope, MAIN_SCOPE);
            mainId = await createFeature(dir, 'Preview command polish');
            await updateSection(dir, mainId, 'Goal', goal);
            await updateSection(dir, mainId, 'Scope', scope);
            const ledger: LedgerRow[] = [];
            for (const def of followUpDefs) {
                const id = await createFeature(dir, def.title, mainId);
                await writeFile(followupGoal, def.goal);
                await writeFile(followupScope, def.scope);
                await updateSection(dir, id, 'Goal', followupGoal);
                await updateSection(dir, id, 'Scope', followupScope);
                ledger.push({ item: def.item, disposition: 'filed', featureId: id, title: def.title });
            }
            observed.ledger = ledger;
            await writeFile(join(runDir, `${runId}-idea-feature-id.txt`), `${mainId}\n`);
            await writeFile(join(runDir, `${runId}-idea-followups.json`), `${JSON.stringify(ledger, null, 2)}\n`);
        });
        const followupIds = observed.ledger.map((row) => row.featureId);
        expect(acView).toMatchObject({ status: 'paused', finalState: 'ac-generate' });

        // ac-generate — AC covering the owing items I1+I2; the --inventory gate must PASS.
        const decomposeView = await resume(acView, 'ac-generate', async () => {
            await writeFile(join(runDir, `${runId}-idea-ac-content.md`), AC_CONTENT);
        });
        expect(decomposeView).toMatchObject({ status: 'paused', finalState: 'decompose' });

        // decompose — the task batch plus its ordering sidecar (every batch name listed).
        const readyView = await resume(decomposeView, 'decompose', async () => {
            const [batch, order] = TASK_BATCH;
            const withFeature = batch.map((item) => ({ ...item, feature_id: mainId }));
            await writeFile(join(runDir, `${runId}-idea-task-batch.json`), `${JSON.stringify(withFeature, null, 2)}\n`);
            await writeFile(join(runDir, `${runId}-idea-task-order.json`), `${JSON.stringify(order, null, 2)}\n`);
        });
        expect(readyView).toMatchObject({ status: 'paused', finalState: 'ready-prepare' });

        // ready-prepare — the answer file is the stage's only expectFile; no ready evidence is
        // recorded, so the handoff degrades to the refineall recommendation (a valid outcome).
        const finalView = await resume(readyView, 'ready-prepare', async () => {
            await writeFile(join(runDir, `${runId}-ready-prepare-answer.txt`), 'ready-prepare scripted answer\n');
        });

        // R3 — terminal state and the filed/excluded ledger from the run folder and --json output.
        expect(finalView).toMatchObject({ status: 'done', finalState: 'handoff' });
        observed.finalState = finalView.finalState ?? null;
        for (const id of followupIds) {
            const show = await runCli(['feature', 'show', id, '--json'], dir);
            expect(show.code, show.stderr).toBe(0);
        }
        const storedLedger = asLedgerRows(
            JSON.parse(await readFile(join(runDir, `${runId}-idea-followups.json`), 'utf8')),
        );
        expect(storedLedger.map((row) => row.item).sort()).toEqual(['I3', 'I5']);
        const listRes = await runCli(['feature', 'list', '--json'], dir);
        expect(listRes.code).toBe(0);
        const names = (Array.isArray(listRes.json) ? listRes.json : []).map((row) =>
            String(asRecord(row, 'feature list row').name),
        );
        expect(names.some((name) => name.includes(EXCLUDED_I4))).toBe(false);
        const report = await readFile(join(runDir, `${runId}-idea-handoff.md`), 'utf8');
        const filedSection = sectionOf(report, '## Follow-ups filed');
        observed.followupsFiled = listLines(filedSection);
        observed.excluded = listLines(sectionOf(report, '## Excluded'));
        expect(filedSection).toContain(`I3 → ${followupIds[0]} (Preview export)`);
        expect(filedSection).toContain(`I5 → ${followupIds[1]} (Preview cache invalidation)`);
        expect(filedSection).toContain(`/sp:dev-plan --feature ${followupIds[0]}`);
        expect(filedSection).toContain(`/sp:dev-plan --feature ${followupIds[1]}`);
        expect(observed.excluded).toEqual([`I4 — ${EXCLUDED_I4}`]);
        expect(report.match(/^## Next command$/gm)).toHaveLength(1);

        // R4 — negative leg: the same fixture with the I5 ledger row removed, driven against a
        // fresh run id in the same run folder (no second pipeline run). Handoff must fail closed
        // naming I5 and write no report at the fresh id's report path.
        for (const name of [
            'idea-task-batch.json',
            'idea-batch-create-result.json',
            'idea-task-order.json',
            'idea-eval-report.md',
        ]) {
            await copyFile(join(runDir, `${runId}-${name}`), join(runDir, `${negRunId}-${name}`));
        }
        const incompleteLedger = observed.ledger.filter((row) => row.item !== 'I5');
        await writeFile(
            join(runDir, `${negRunId}-idea-followups.json`),
            `${JSON.stringify(incompleteLedger, null, 2)}\n`,
        );
        const neg = await runCli(['feature', 'handoff', mainId, '--run-id', negRunId, '--no-logo'], dir);
        const negOutput = `${neg.stdout}\n${neg.stderr}`;
        observed.negativeLeg = {
            exitCode: neg.code,
            message: negOutput.split('\n').find((line) => line.includes('I5')) ?? '',
        };
        expect(observed.negativeLeg.message).toContain('follow-up item I5 has no ledger row');
        expect(neg.code).toBe(1);
        let negReport: string | null = null;
        try {
            negReport = await readFile(join(runDir, `${negRunId}-idea-handoff.md`), 'utf8');
        } catch {
            negReport = null;
        }
        expect(negReport).toBeNull();
    } finally {
        observed.generatedAt = new Date().toISOString();
        await mkdir(join(REPO_ROOT, '.spur', 'run'), { recursive: true });
        await writeFile(RECEIPT_PATH, `${JSON.stringify(observed, null, 4)}\n`);
        await rm(dir, { recursive: true, force: true });
    }
});
