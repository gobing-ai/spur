/**
 * Task 1102 (map I13) — rough prototype of the two-layer A–Z / 1–9 plan projection.
 *
 * Not production code. Run from the repo root:
 *   bun docs/analysis/2026-10-plan-projection-prototype.ts > docs/analysis/2026-10-plan-projection-prototype.md
 *
 * The state list comes from the CLI projection (`workflow show --format todo --json`, i.e.
 * buildWorkflowSteps), never hand-copied. The phase table below is the one new input: a proposal
 * the operator reviews (graduation would move it into the workflow YAML or a side table next to
 * step-reporter.ts). The script ends with assert self-checks; a failure exits nonzero.
 */

type Show = 'plan' | 'on-entry';
type Outcome = 'pending' | 'active' | 'completed' | 'skipped' | 'failed' | 'unattempted';

interface Step {
    id: string;
    terminal: boolean;
    failure: boolean;
}
interface PhaseState {
    id: string;
    title: string;
    show: Show;
}
interface Phase {
    title: string;
    states: PhaseState[];
}
interface Item {
    label: string;
    id: string;
    title: string;
    outcome: Outcome;
    note?: string;
}

// ---------------------------------------------------------------- R1: phase grouping (proposal)

const PHASES: Record<string, Phase[]> = {
    'task-pipeline': [
        {
            title: 'Implement',
            states: [
                { id: 'precheck', title: 'Check task readiness', show: 'plan' },
                { id: 'implement', title: 'Implement', show: 'plan' },
                { id: 'escalate', title: 'Ask operator', show: 'on-entry' },
            ],
        },
        {
            title: 'Test',
            states: [
                { id: 'test', title: 'Run quality gate', show: 'plan' },
                { id: 'test-fail-triage', title: 'Triage test failure', show: 'on-entry' },
                { id: 'test-fix', title: 'Fix failures', show: 'on-entry' },
                { id: 'test-recheck', title: 'Re-run quality gate', show: 'on-entry' },
            ],
        },
        {
            title: 'Review',
            states: [
                { id: 'triage', title: 'Choose review depth', show: 'plan' },
                { id: 'review', title: 'Review changes', show: 'plan' },
                { id: 'review-fail-triage', title: 'Triage review findings', show: 'on-entry' },
                { id: 'approve', title: 'Operator approval', show: 'on-entry' },
            ],
        },
        {
            title: 'Verify & record',
            states: [
                { id: 'verify', title: 'Verify requirements and AC', show: 'plan' },
                { id: 'record', title: 'Record evidence', show: 'plan' },
            ],
        },
    ],
    'idea-pipeline': [
        {
            title: 'Discover',
            states: [
                { id: 'start', title: 'Check inputs', show: 'plan' },
                { id: 'discovery', title: 'Discovery interview', show: 'plan' },
                { id: 'idea-eval', title: 'Evaluate idea', show: 'plan' },
            ],
        },
        {
            title: 'Define feature',
            states: [
                { id: 'feature-create', title: 'Create feature', show: 'plan' },
                { id: 'ac-generate', title: 'Generate AC', show: 'plan' },
                { id: 'feature-check', title: 'Check feature', show: 'plan' },
            ],
        },
        {
            title: 'Design',
            states: [
                { id: 'system-design', title: 'System design', show: 'plan' },
                { id: 'design-approval', title: 'Approve design', show: 'plan' },
            ],
        },
        {
            title: 'Decompose',
            states: [
                { id: 'decompose', title: 'Decompose into tasks', show: 'plan' },
                { id: 'batch-create', title: 'Approve task batch', show: 'plan' },
                { id: 'batch-create-run', title: 'Create tasks', show: 'plan' },
            ],
        },
        {
            title: 'Hand off',
            states: [
                { id: 'ready-prepare', title: 'Prepare ready set', show: 'plan' },
                { id: 'handoff-finalize', title: 'Finalize handoff', show: 'plan' },
            ],
        },
    ],
};

const SINGLE_PREPARE = ['Quick readiness', 'Prepare Git', 'Publish plan'];
const BATCH_PREPARE = ['Resolve and freeze task set', 'Order by dependencies', 'Prepare Git', 'Publish plan'];
const WAVE_SIZE = 24; // B..Y; A = prepare, Z = report

// ---------------------------------------------------------------- R4: labels, cap, validation

function letter(index: number): string {
    if (index < 0 || index > 25) throw new Error(`letter index ${index} exceeds A–Z`);
    return String.fromCharCode(65 + index);
}
function child(parent: string, index: number): string {
    if (index < 0 || index > 8) throw new Error(`child index ${index} under ${parent} exceeds 1–9`);
    return `${parent}${index + 1}`;
}

/** Authoring-time check: every non-terminal state in exactly one phase, phases ≤ 25 (B..Z), states ≤ 9. */
function validate(steps: Step[], phases: Phase[]): string[] {
    const errors: string[] = [];
    const known = new Map(steps.map((s) => [s.id, s] as const));
    const seen = new Map<string, number>();
    if (phases.length > 25) errors.push(`${phases.length} phases exceed B–Z (25)`);
    phases.forEach((phase, i) => {
        if (phase.states.length > 9) errors.push(`phase "${phase.title}" has ${phase.states.length} states (> 9)`);
        for (const s of phase.states) {
            const step = known.get(s.id);
            if (step === undefined) errors.push(`phase "${phase.title}" names unknown state "${s.id}"`);
            else if (step.terminal) errors.push(`terminal state "${s.id}" must not be in a phase`);
            if (seen.has(s.id)) errors.push(`state "${s.id}" is in two phases`);
            seen.set(s.id, i);
        }
    });
    for (const step of steps) {
        if (!step.terminal && !seen.has(step.id)) errors.push(`state "${step.id}" has no phase`);
    }
    return errors;
}

// ---------------------------------------------------------------- R2: single-task projection

function singlePlan(phases: Phase[]): Item[] {
    const items: Item[] = [{ label: 'A', id: 'prepare', title: 'Prepare', outcome: 'pending' }];
    SINGLE_PREPARE.forEach((title, i) => {
        items.push({ label: child('A', i), id: `prepare.${i + 1}`, title, outcome: 'pending' });
    });
    phases.forEach((phase, p) => {
        const L = letter(p + 1);
        items.push({ label: L, id: `phase.${L}`, title: phase.title, outcome: 'pending' });
        phase.states
            .filter((s) => s.show === 'plan')
            .forEach((s, i) => {
                items.push({ label: child(L, i), id: s.id, title: s.title, outcome: 'pending' });
            });
    });
    return items;
}

const text = (item: Item): string =>
    `${item.label} ${item.title}${item.label.length > 1 && !item.id.startsWith('prepare') && !item.id.startsWith('task.') ? ` · ${item.id}` : ''}${item.note === undefined ? '' : ` — ${item.note}`}`;

/** Tracks a run against the plan: insert-on-entry, re-entry notes, observed outcomes only. */
class Tracker {
    readonly items: Item[];
    private readonly phaseOf = new Map<string, string>(); // state id -> parent letter
    private readonly meta = new Map<string, PhaseState>();
    private readonly attempts = new Map<string, number>();
    private current: Item | undefined;

    constructor(phases: Phase[]) {
        this.items = singlePlan(phases);
        phases.forEach((phase, p) => {
            for (const s of phase.states) {
                this.phaseOf.set(s.id, letter(p + 1));
                this.meta.set(s.id, s);
            }
        });
    }

    private parent(L: string): Item {
        return this.items.find((i) => i.label === L) as Item;
    }
    private children(L: string): Item[] {
        return this.items.filter((i) => i.label.length > 1 && i.label[0] === L);
    }

    prepare(index: number, outcome: Outcome): void {
        const item = this.items.find((i) => i.id === `prepare.${index}`) as Item;
        item.outcome = outcome;
        const kids = this.children('A');
        this.parent('A').outcome = kids.every((k) => k.outcome === 'completed') ? 'completed' : 'active';
    }

    /** Leave the current state with an observed outcome, then enter `stateId`. */
    enter(stateId: string, leftAs: Outcome = 'completed', leftNote?: string): void {
        if (this.current !== undefined) {
            this.current.outcome = leftAs;
            if (leftNote !== undefined) this.current.note = leftNote;
        }
        const L = this.phaseOf.get(stateId);
        if (L === undefined) throw new Error(`state ${stateId} has no phase`);
        // Moving forward past a phase: plan children never entered are skipped, never completed.
        // Looping back (verify → test-fix) leaves the later phase open; it will be re-entered.
        const prevL = this.current === undefined ? undefined : this.phaseOf.get(this.current.id);
        if (prevL !== undefined && prevL < L) this.closePhase(prevL);
        else if (prevL !== undefined && prevL > L) this.parent(prevL).outcome = this.current?.outcome ?? 'pending';
        let item = this.items.find((i) => i.id === stateId);
        if (item === undefined) {
            const kids = this.children(L);
            const meta = this.meta.get(stateId) as PhaseState;
            item = { label: child(L, kids.length), id: stateId, title: meta.title, outcome: 'pending' };
            // Full-list hosts render in this array order; per-item hosts append (see R6).
            const last = kids.at(-1) ?? this.parent(L);
            this.items.splice(this.items.indexOf(last) + 1, 0, item);
        }
        const n = (this.attempts.get(stateId) ?? 0) + 1;
        this.attempts.set(stateId, n);
        item.outcome = 'active';
        item.note = n > 1 ? `attempt ${n}` : undefined;
        this.parent(L).outcome = 'active';
        this.parent(L).note = undefined;
        this.current = item;
    }

    private closePhase(L: string): void {
        for (const k of this.children(L)) {
            if (k.outcome === 'pending') {
                k.outcome = 'skipped';
                k.note = 'not entered';
            }
        }
        const last = this.children(L)
            .filter((k) => k.outcome !== 'skipped')
            .at(-1);
        this.parent(L).outcome = last?.outcome === 'completed' ? 'completed' : (last?.outcome ?? 'skipped');
    }

    /** Terminal state reached. `done` closes everything; failure leaves later work unattempted. */
    finish(terminal: 'done' | 'failed', note?: string): void {
        const L = this.current === undefined ? undefined : this.phaseOf.get(this.current.id);
        if (this.current !== undefined) {
            this.current.outcome = terminal === 'done' ? 'completed' : 'failed';
            if (note !== undefined) this.current.note = note;
        }
        if (L !== undefined) this.closePhase(L);
        for (const i of this.items) {
            if (i.outcome === 'pending') {
                i.outcome = terminal === 'done' ? 'skipped' : 'unattempted';
                i.note = terminal === 'done' ? 'not entered' : 'run failed earlier';
            }
        }
        this.current = undefined;
    }

    snapshot(): Item[] {
        return this.items.map((i) => ({ ...i }));
    }
}

// ---------------------------------------------------------------- R3: batch projection

interface TaskRef {
    wbs: string;
    name: string;
}

function batchWaves(tasks: TaskRef[], phases: Phase[]): Item[][] {
    const waves: Item[][] = [];
    for (let w = 0; w * WAVE_SIZE < tasks.length; w += 1) {
        const slice = tasks.slice(w * WAVE_SIZE, (w + 1) * WAVE_SIZE);
        const items: Item[] = [{ label: 'A', id: 'prepare', title: 'Prepare batch', outcome: 'pending' }];
        BATCH_PREPARE.forEach((title, i) => {
            items.push({ label: child('A', i), id: `prepare.${i + 1}`, title, outcome: 'pending' });
        });
        slice.forEach((task, t) => {
            const L = letter(t + 1);
            const short = task.name.length > 60 ? `${task.name.slice(0, 57)}…` : task.name;
            items.push({ label: L, id: `task.${task.wbs}`, title: `${task.wbs} ${short}`, outcome: 'pending' });
            phases.forEach((phase, p) => {
                items.push({
                    label: child(L, p),
                    id: `task.${task.wbs}.${p + 1}`,
                    title: phase.title,
                    outcome: 'pending',
                });
            });
        });
        items.push({ label: 'Z', id: 'report', title: 'Batch report', outcome: 'pending' });
        waves.push(items);
    }
    return waves;
}

// ---------------------------------------------------------------- R6: per-host rendering

const FULL_LIST_STATUS: Record<Outcome, string> = {
    pending: 'pending',
    active: 'in_progress',
    completed: 'completed',
    // Codex/Claude Code/pi have no skipped or cancelled: keep it open and say why in the text.
    skipped: 'pending',
    failed: 'pending',
    unattempted: 'pending',
};
const outcomeSuffix = (i: Item): string =>
    ['skipped', 'failed', 'unattempted'].includes(i.outcome) ? ` [${i.outcome}]` : '';
const hostText = (i: Item): string => `${text(i)}${outcomeSuffix(i)}`;

/** Full-list host (Codex `update_plan`; same shape for Gemini/OpenCode/Grok with `todos`). */
function codexPayload(items: Item[]): { plan: Array<{ step: string; status: string }> } {
    return { plan: items.map((i) => ({ step: hostText(i), status: FULL_LIST_STATUS[i.outcome] })) };
}

/** Per-item host (Claude Code TaskCreate/TaskUpdate): ops needed to move from `prev` to `next`. */
function claudeOps(prev: Item[] | undefined, next: Item[], ids: Map<string, number>): string[] {
    const ops: string[] = [];
    for (const i of next) {
        const before = prev?.find((p) => p.id === i.id);
        if (before === undefined) {
            ids.set(i.id, ids.size + 1);
            ops.push(`TaskCreate ${JSON.stringify({ subject: hostText(i), activeForm: i.title })}`);
        }
        const status = FULL_LIST_STATUS[i.outcome];
        const changed =
            before === undefined
                ? status !== 'pending'
                : FULL_LIST_STATUS[before.outcome] !== status || hostText(before) !== hostText(i);
        if (changed) {
            const patch: Record<string, string> = { taskId: String(ids.get(i.id)), status };
            if (before !== undefined && hostText(before) !== hostText(i)) patch.subject = hostText(i);
            ops.push(`TaskUpdate ${JSON.stringify(patch)}`);
        }
    }
    return ops;
}

// ---------------------------------------------------------------- inputs from the CLI

function cliJson(args: string[]): unknown {
    const res = Bun.spawnSync(['bun', 'apps/cli/src/index.ts', ...args, '--json'], { stderr: 'pipe' });
    const out = res.stdout.toString();
    const start = out.search(/[[{]/);
    if (res.exitCode !== 0 || start < 0) throw new Error(`spur ${args.join(' ')} failed: ${res.stderr.toString()}`);
    return JSON.parse(out.slice(start));
}
function workflowSteps(name: string): Step[] {
    const json = cliJson(['workflow', 'show', `config/workflows/${name}.yaml`, '--no-logo', '--format', 'todo']) as {
        steps: Step[];
    };
    return json.steps;
}
function featureTasks(feature: string): TaskRef[] {
    const list = cliJson(['task', 'list', '--feature', feature]) as TaskRef[];
    // ponytail: WBS order stands in for the batch driver's topo sort; ordering is not what this prototype tests.
    return list.map((t) => ({ wbs: t.wbs, name: t.name })).sort((a, b) => a.wbs.localeCompare(b.wbs));
}

// ---------------------------------------------------------------- render the artifact

const out: string[] = [];
const say = (...lines: string[]): void => {
    out.push(...lines);
};
const block = (lines: string[]): void => say('```text', ...lines, '```', '');
const checks: string[] = [];
function check(cond: boolean, what: string): void {
    if (!cond) throw new Error(`self-check failed: ${what}`);
    if (!checks.includes(what)) checks.push(what);
}

say(
    '# Two-layer plan projection prototype (task 1102, map I13)',
    '',
    'Generated by `bun docs/analysis/2026-10-plan-projection-prototype.ts`; do not edit by hand.',
    'State lists come from `spur workflow show <yaml> --format todo --json`; the phase table in the',
    'script is the proposal under review.',
    '',
);

// R1 + R2 + R4 for both pipelines
for (const name of ['task-pipeline', 'idea-pipeline']) {
    const steps = workflowSteps(name);
    const phases = PHASES[name] as Phase[];
    const errors = validate(steps, phases);
    check(errors.length === 0, `${name}: phase table validates (${errors.join('; ') || 'no errors'})`);
    const plan = singlePlan(phases);
    const hidden = steps.filter((s) => s.terminal || s.failure).map((s) => s.id);
    check(
        plan.every((i) => !hidden.includes(i.id)),
        `${name}: no terminal/failure state in the initial plan`,
    );
    const onEntry = phases.flatMap((p) => p.states.filter((s) => s.show === 'on-entry').map((s) => s.id));
    check(
        plan.every((i) => !onEntry.includes(i.id)),
        `${name}: no on-entry (loop/branch) state in the initial plan`,
    );
    say(`## ${name} — initial single-task plan (R1, R2)`, '');
    say(
        `${steps.length} declared states → ${plan.length} plan items. Hidden until entered: ` +
            `${onEntry.map((s) => `\`${s}\``).join(', ') || 'none'}. Never shown: ` +
            `${hidden.map((s) => `\`${s}\``).join(', ')}.`,
        '',
    );
    block(plan.map(text));
}

// R4: the cap rejects or folds, never emits AA / A10
{
    const steps: Step[] = Array.from({ length: 30 }, (_, i) => ({ id: `s${i}`, terminal: false, failure: false }));
    const tenInPhase: Phase[] = [
        { title: 'Big', states: steps.slice(0, 10).map((s) => ({ id: s.id, title: s.id, show: 'plan' })) },
    ];
    check(
        validate(steps.slice(0, 10), tenInPhase).some((e) => e.includes('> 9')),
        'validator rejects a phase with 10 states',
    );
    const many: Phase[] = steps
        .slice(0, 26)
        .map((s) => ({ title: s.id, states: [{ id: s.id, title: s.id, show: 'plan' }] }));
    check(
        validate(steps.slice(0, 26), many).some((e) => e.includes('exceed B–Z')),
        'validator rejects 26 phases',
    );
    let threw = false;
    try {
        child('A', 9);
    } catch {
        threw = true;
    }
    check(threw, 'label builder throws instead of emitting A10');
    const fake = Array.from({ length: 60 }, (_, i) => ({ wbs: String(9000 + i), name: `synthetic ${i}` }));
    const waves = batchWaves(fake, PHASES['task-pipeline'] as Phase[]);
    check(waves.length === 3, '60 tasks fold into 3 waves of ≤ 24');
    check(
        waves.flat().every((i) => /^[A-Z][1-9]?$/.test(i.label)),
        'every batch label matches ^[A-Z][1-9]?$ (no AA, no A10)',
    );
}

// R3: batch projection against real feature sets
const taskPhases = PHASES['task-pipeline'] as Phase[];
{
    const e71 = featureTasks('E71');
    const [wave] = batchWaves(e71, taskPhases);
    say(`## Batch plan — feature E71, ${e71.length} tasks, one wave (R3)`, '');
    say(`${(wave as Item[]).length} items: A prepare, one letter per task with phase digits, Z report.`, '');
    block((wave as Item[]).map(text));
    const d62 = featureTasks('D62');
    const waves = batchWaves(d62, taskPhases);
    check(
        waves.length === Math.ceil(d62.length / WAVE_SIZE),
        `D62 (${d62.length} tasks) splits into ${waves.length} waves`,
    );
    say(`## Batch plan — feature D62, ${d62.length} tasks, ${waves.length} waves (R3)`, '');
    waves.forEach((w, n) => {
        const letters = w.filter((i) => i.label.length === 1);
        say(
            `- Wave ${n + 1}: ${w.length} items; letters ${letters.at(0)?.label}…${letters.at(-1)?.label}; ` +
                `tasks ${letters.filter((i) => i.id.startsWith('task.')).length}`,
        );
    });
    say('', `Wave ${waves.length} rendered:`, '');
    block((waves.at(-1) as Item[]).map(text));
}

// R5: one realistic run — test-fix loop, skipped review (fast mode), verify sends work back once
{
    const t = new Tracker(taskPhases);
    const snaps: Array<{ event: string; items: Item[] }> = [];
    const snap = (event: string): void => {
        snaps.push({ event, items: t.snapshot() });
    };
    snap('plan published (first action)');
    t.prepare(1, 'completed');
    t.prepare(2, 'completed');
    t.prepare(3, 'completed');
    snap('prepare A1–A3 observed complete');
    t.enter('precheck');
    t.enter('implement');
    t.enter('test');
    snap('implement done, quality gate running');
    t.enter('test-fix', 'failed', 'gate failed: 2 tests');
    snap('gate failed → test-fix inserted as C2');
    t.enter('test-recheck');
    t.enter('triage');
    t.enter('verify'); // fast mode: triage → verify, review never entered
    snap('fast mode: triage → verify; D2 review skipped');
    t.enter('test-fix', 'failed', 'verdict PARTIAL: R3 unmet');
    snap('verify PARTIAL → back to C2 (attempt 2)');
    t.enter('test-recheck');
    t.enter('triage');
    t.enter('verify');
    t.enter('record');
    t.finish('done');
    snap('record → done');

    say('## Progress snapshots — test-fix loop, skipped review, verify loop-back (R5)', '');
    for (const s of snaps) {
        say(`### ${s.event}`, '');
        block(s.items.map((i) => `${i.outcome.padEnd(11)} ${text(i)}`));
    }

    // Stability and truthfulness over the whole sequence.
    const labelOf = new Map<string, string>();
    for (const s of snaps) {
        for (const i of s.items) {
            const prior = labelOf.get(i.id);
            check(prior === undefined || prior === i.label, `label of ${i.id} stays ${prior ?? i.label}`);
            labelOf.set(i.id, i.label);
        }
    }
    const final = snaps.at(-1)?.items as Item[];
    check(final.find((i) => i.id === 'review')?.outcome === 'skipped', 'review ends skipped, not completed');
    check(final.find((i) => i.id === 'test-fix')?.label === 'C2', 'inserted test-fix took the next digit (C2)');
    check(final.find((i) => i.id === 'test')?.outcome === 'failed', 'first gate attempt stays failed');
    check(!final.some((i) => i.outcome === 'pending' || i.outcome === 'active'), 'nothing left pending after done');
    check(!final.some((i) => /^[A-Z]{2}|\d{2}/.test(i.label)), 'no AA/A10 label emitted during the run');

    // R6: the same snapshots on a full-list host and a per-item host.
    say('## Host payloads (R6)', '');
    say(
        'Codex `update_plan` (full-list rewrite; Gemini `write_todos`, OpenCode `todowrite` and Grok `todo_write`',
        'take the same list as `todos`). Final snapshot:',
        '',
    );
    const codex = codexPayload(final);
    say('```json', JSON.stringify(codex, null, 2), '```', '');
    const ids = new Map<string, number>();
    say('Claude Code `TaskCreate` / `TaskUpdate` (per-item). Ops per snapshot:', '');
    let prev: Item[] | undefined;
    const allOps: string[] = [];
    for (const s of snaps) {
        const ops = claudeOps(prev, s.items, ids);
        allOps.push(...ops);
        say(`- **${s.event}:** ${ops.length} ops`);
        prev = s.items;
    }
    say('', 'Ops for the verify → test-fix loop-back snapshot:', '');
    block(claudeOps(snaps[4]?.items, snaps[5]?.items as Item[], new Map(ids)));
    const displayOrder = [...ids.entries()]
        .sort((a, b) => a[1] - b[1])
        .map(([id]) => final.find((i) => i.id === id)?.label);
    say(
        'Per-item hosts display in creation order, so inserted items land at the end:',
        '',
        `- Claude Code order: ${displayOrder.join(' ')}`,
        `- Full-list order:   ${final.map((i) => i.label).join(' ')}`,
        '',
    );
    check(
        !codex.plan.some((p) => / \[(skipped|failed|unattempted)\]$/.test(p.step) && p.status === 'completed'),
        'full-list payload never marks skipped/failed/unattempted completed',
    );
    check(
        !allOps.some((op) => op.includes('[skipped]') && op.includes('"status":"completed"')),
        'per-item ops never mark a skipped item completed',
    );
    check(
        codex.plan.map((p) => p.step).join('\n') === final.map(hostText).join('\n'),
        'both hosts carry identical item text',
    );
}

say('## Self-checks', '', ...checks.map((c) => `- [x] ${c}`), '');
console.log(out.join('\n'));
