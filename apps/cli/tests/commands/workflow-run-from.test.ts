import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTempProject, runCli } from '../helpers';

/**
 * E2E for `spur workflow run --from` / `--from-run` (task 1072), driven through the
 * real CLI against real fixture definitions in an isolated project directory. The
 * repeatable artifact is the per-state receipt/marker file each fixture appends to.
 */

let project: string;

beforeEach(async () => {
    project = await createTempProject();
});

afterEach(() => {
    if (existsSync(project)) rmSync(project, { recursive: true, force: true });
});

function writeFixture(name: string, body: string): string {
    const path = join(project, name);
    writeFileSync(path, body);
    return path;
}

function readLines(name: string): string[] {
    const path = join(project, name);
    if (!existsSync(path)) return [];
    return readFileSync(path, 'utf8')
        .split('\n')
        .filter((line) => line !== '');
}

function listDir(name: string): string[] {
    const path = join(project, name);
    return existsSync(path) ? readdirSync(path).sort() : [];
}

/** Append `echo <id> >> <file>` — the fixture's observable side effect. */
function receipt(stateId: string, file: string): string {
    return `      - kind: shell\n        options:\n          command: "echo ${stateId} >> ${file}"\n`;
}

/** The same side effect as a single node action (transition-flow nodes take one action, not a list). */
function nodeReceipt(stateId: string, file: string): string {
    return `      kind: shell\n      options:\n        command: "echo ${stateId} >> ${file}"\n`;
}

const SM_FIXTURE = `name: sm-fixture
initialState: s1
terminalStates: [done]
states:
  - id: s1
    onEnter:
${receipt('s1', 'marker.txt')}  - id: s2
    startable: true
    onEnter:
${receipt('s2', 'marker.txt')}  - id: s3
    startable: true
    onEnter:
${receipt('s3', 'marker.txt')}  - id: done
transitions:
  - from: s1
    to: s2
  - from: s2
    to: s3
  - from: s3
    to: done
`;

const TF_FIXTURE = `kind: transition-flow
name: tf-fixture
initialNode: n1
terminalNodes: [end]
nodes:
  - id: n1
    action:
${nodeReceipt('n1', 'marker.txt')}  - id: n2
    startable: true
    action:
${nodeReceipt('n2', 'marker.txt')}  - id: n3
    startable: true
    action:
${nodeReceipt('n3', 'marker.txt')}  - id: end
edges:
  - from: n1
    to: n2
  - from: n2
    to: n3
  - from: n3
    to: end
`;

const FAILURE_FIXTURE = `name: failure-fixture
initialState: s1
terminalStates: [done, broken]
failureStates: [broken]
states:
  - id: s1
  - id: s2
    startable: true
  - id: broken
    startable: true
  - id: done
transitions:
  - from: s1
    to: s2
  - from: s2
    to: broken
    terminalReason: failed-check
    guard:
      kind: never
  - from: s2
    to: done
`;

/** The publish-tail shape the incident exposed: a prep gate, three channels, a report. */
const KIT_FIXTURE = `name: kit-tail
initialState: fetch
terminalStates: [done]
states:
  - id: fetch
    onEnter:
${receipt('fetch', 'receipts.txt')}  - id: publish-prep
    startable: true
    onEnter:
      - kind: shell
        options:
          command: "test -f stamp.txt && echo publish-prep >> receipts.txt"
  - id: xhs-write
    onEnter:
${receipt('xhs-write', 'receipts.txt')}  - id: translate-en
    onEnter:
${receipt('translate-en', 'receipts.txt')}  - id: wechat-publish
    onEnter:
${receipt('wechat-publish', 'receipts.txt')}  - id: run-report
    onEnter:
${receipt('run-report', 'receipts.txt')}  - id: done
transitions:
  - from: fetch
    to: publish-prep
  - from: publish-prep
    to: xhs-write
  - from: xhs-write
    to: translate-en
  - from: translate-en
    to: wechat-publish
  - from: wechat-publish
    to: run-report
  - from: run-report
    to: done
`;

describe('spur workflow run --from / --from-run (task 1072)', () => {
    test('AC1/AC6: a state-machine run starts at the chosen state and trace reports the lineage', async () => {
        const fixture = writeFixture('sm.yaml', SM_FIXTURE);

        const run = await runCli(['workflow', 'run', fixture, '--from', 's2', '--run-id', 'ac1-sm', '--json'], project);
        expect(run.stderr).toBe('');
        expect(run.code).toBe(0);
        expect(readLines('marker.txt')).toEqual(['s2', 's3']);

        const trace = await runCli(['workflow', 'trace', 'ac1-sm', '--json'], project);
        expect(trace.code).toBe(0);
        expect(trace.stdout).toMatch(/"startState":\s*"s2"/);

        // R7: the run record's `.state.json` projection carries the same lineage.
        const state = JSON.parse(readFileSync(join(project, '.spur/memory/runs/ac1-sm.state.json'), 'utf8')) as {
            startState?: string;
            continuedFrom?: string;
        };
        expect(state.startState).toBe('s2');
        expect(state.continuedFrom).toBeUndefined();

        const list = await runCli(['workflow', 'trace', '--json'], project);
        expect(list.stdout).toMatch(/"startState":\s*"s2"/);
    });

    test('AC1: a transition-flow run starts at the chosen node', async () => {
        const fixture = writeFixture('tf.yaml', TF_FIXTURE);

        const run = await runCli(['workflow', 'run', fixture, '--from', 'n2', '--run-id', 'ac1-tf', '--json'], project);
        expect(run.code).toBe(0);
        expect(readLines('marker.txt')).toEqual(['n2', 'n3']);
    });

    // 7 sequential runCli subprocess spawns; each cold `bun run` start is ~0.5s, so
    // under full-suite load this crosses bun's 5s default and gets SIGTERM'd (1072 AC2).
    test('AC2: every illegal start point exits 2 and writes no run row, record or artifact', async () => {
        const fixture = writeFixture('sm.yaml', SM_FIXTURE);
        const failure = writeFixture('failure.yaml', FAILURE_FIXTURE);
        const dag = writeFixture(
            'dag.yaml',
            'kind: dag\nname: dag-fixture\nnodes:\n  - id: start\n  - id: next\n    dependsOn: [start]\n',
        );
        const before = { runs: listDir('.spur/memory/runs'), artifacts: listDir('.spur/run') };

        const cases: Array<[string, string]> = [
            ['unknown state', 'nope'],
            ['terminal state', 'done'],
            ['non-startable state', 's1'],
        ];
        for (const [, stateId] of cases) {
            const result = await runCli(
                ['workflow', 'run', fixture, '--from', stateId, '--run-id', `bad-${stateId}`, '--json'],
                project,
            );
            expect(result.code).toBe(2);
        }
        const failureState = await runCli(
            ['workflow', 'run', failure, '--from', 'broken', '--run-id', 'bad-failure', '--json'],
            project,
        );
        expect(failureState.code).toBe(2);

        const dagRun = await runCli(
            ['workflow', 'run', dag, '--from', 'next', '--run-id', 'bad-dag', '--json'],
            project,
        );
        expect(dagRun.code).toBe(2);
        expect(dagRun.stderr).toMatch(/dag/);

        const fromRunAlone = await runCli(
            ['workflow', 'run', fixture, '--from-run', 'ac1-sm', '--run-id', 'bad-lone', '--json'],
            project,
        );
        expect(fromRunAlone.code).toBe(2);

        const unknownSource = await runCli(
            [
                'workflow',
                'run',
                fixture,
                '--from',
                's2',
                '--from-run',
                'does-not-exist',
                '--run-id',
                'bad-source',
                '--json',
            ],
            project,
        );
        expect(unknownSource.code).toBe(2);

        expect(listDir('.spur/memory/runs')).toEqual(before.runs);
        expect(listDir('.spur/run')).toEqual(before.artifacts);
    }, 20000);

    test('AC2: the unknown-state refusal lists the startable ids', async () => {
        const fixture = writeFixture('sm.yaml', SM_FIXTURE);
        const result = await runCli(
            ['workflow', 'run', fixture, '--from', 'nope', '--run-id', 'bad-list', '--json'],
            project,
        );
        expect(result.code).toBe(2);
        expect(result.stderr).toMatch(/s2, s3/);
    });

    test('AC3: --from-run inherits the source vars, drops __* keys and records lineage', async () => {
        const fixture = writeFixture(
            'vars.yaml',
            `name: vars-fixture
initialState: pre
terminalStates: [done]
vars:
  publish_enabled: "false"
  declared: workflow-default
states:
  - id: pre
    onEnter:
      - kind: shell
        options:
          command: "echo pre >> marker.txt"
  - id: publish
    startable: true
    onEnter:
      - kind: shell
        options:
          command: "echo publish:$publish_enabled:$declared >> marker.txt"
  - id: done
transitions:
  - from: pre
    to: publish
  - from: publish
    to: done
`,
        );

        const source = await runCli(
            ['workflow', 'run', fixture, '--vars', '{"declared":"from-source"}', '--run-id', 'src-1', '--json'],
            project,
        );
        expect(source.code).toBe(0);
        const sourceRecord = readFileSync(join(project, '.spur/memory/runs/src-1.md'), 'utf8');

        const continued = await runCli(
            [
                'workflow',
                'run',
                fixture,
                '--from',
                'publish',
                '--from-run',
                'src-1',
                '--vars',
                '{"publish_enabled":"true"}',
                '--run-id',
                'cont-1',
                '--json',
            ],
            project,
        );
        expect(continued.code).toBe(0);
        // The caller override wins; the source's non-internal var is inherited.
        expect(readLines('marker.txt')).toEqual(['pre', 'publish:false:from-source', 'publish:true:from-source']);

        const trace = await runCli(['workflow', 'trace', 'cont-1', '--json'], project);
        expect(trace.stdout).toMatch(/"startState":\s*"publish"/);
        expect(trace.stdout).toMatch(/"continuedFrom":\s*"src-1"/);
        // The source run is never mutated: its record file is byte-identical and it
        // gained no lineage keys of its own.
        expect(readFileSync(join(project, '.spur/memory/runs/src-1.md'), 'utf8')).toBe(sourceRecord);
        const sourceTrace = await runCli(['workflow', 'trace', 'src-1', '--json'], project);
        expect(sourceTrace.stdout).not.toMatch(/startState/);
        expect(sourceTrace.stdout).not.toMatch(/continuedFrom/);
    });

    test('AC4: the publish tail runs every channel when the safety stamp is present', async () => {
        const fixture = writeFixture('kit.yaml', KIT_FIXTURE);
        writeFileSync(join(project, 'stamp.txt'), 'safety-reviewed\n');

        const result = await runCli(
            ['workflow', 'run', fixture, '--from', 'publish-prep', '--run-id', 'kit-ok', '--json'],
            project,
        );
        expect(result.code).toBe(0);
        expect(readLines('receipts.txt')).toEqual([
            'publish-prep',
            'xhs-write',
            'translate-en',
            'wechat-publish',
            'run-report',
        ]);
    });

    test('AC4: without the stamp the run fails at publish-prep and no later receipt exists', async () => {
        const fixture = writeFixture('kit.yaml', KIT_FIXTURE);

        const result = await runCli(
            ['workflow', 'run', fixture, '--from', 'publish-prep', '--run-id', 'kit-fail', '--json'],
            project,
        );
        expect(result.code).not.toBe(0);
        expect(readLines('receipts.txt')).toEqual([]);
        const trace = await runCli(['workflow', 'trace', 'kit-fail', '--json'], project);
        expect(trace.stdout).toMatch(/"status":\s*"failed"/);
    });

    test('AC5: --dry-run --from walks from the start state and executes nothing', async () => {
        const fixture = writeFixture('sm.yaml', SM_FIXTURE);

        const result = await runCli(
            ['workflow', 'run', fixture, '--from', 's2', '--dry-run', '--run-id', 'dry-1', '--json'],
            project,
        );
        expect(result.code).toBe(0);
        expect(readLines('marker.txt')).toEqual([]);

        const trace = await runCli(['workflow', 'trace', 'dry-1', '--json'], project);
        expect(trace.stdout).toMatch(/"isDryRun":\s*true/);
        expect(trace.stdout).toMatch(/"startState":\s*"s2"/);
    });

    test('AC5: --async --from threads the start state to the worker and marks the plan artifact', async () => {
        const fixture = writeFixture('sm.yaml', SM_FIXTURE);

        const launched = await runCli(
            ['workflow', 'run', fixture, '--from', 's2', '--async', '--run-id', 'async-1', '--json'],
            project,
        );
        expect(launched.code).toBe(0);

        const planPath = join(project, '.spur/run/async-1-workflow-plan.json');
        expect(existsSync(planPath)).toBe(true);
        const plan = readFileSync(planPath, 'utf8');
        expect(plan).toMatch(/"startState":\s*"s2"/);
        expect(plan).toMatch(/"outcome":\s*"unattempted"/);
        expect(plan).toMatch(/before start state/);

        // The detached worker records the same start point on the run row.
        let trace = '';
        for (let attempt = 0; attempt < 30; attempt += 1) {
            const result = await runCli(['workflow', 'trace', 'async-1', '--json'], project);
            trace = result.stdout;
            if (/"status":\s*"(done|failed)"/.test(trace)) break;
            await Bun.sleep(500);
        }
        expect(trace).toMatch(/"startState":\s*"s2"/);
        expect(readLines('marker.txt')).toEqual(['s2', 's3']);
    }, 30_000);

    test('AC7: a run without --from produces no startState or continuedFrom keys', async () => {
        const fixture = writeFixture('sm.yaml', SM_FIXTURE);

        const result = await runCli(['workflow', 'run', fixture, '--run-id', 'plain-1', '--json'], project);
        expect(result.code).toBe(0);
        expect(readLines('marker.txt')).toEqual(['s1', 's2', 's3']);

        const trace = await runCli(['workflow', 'trace', 'plain-1', '--json'], project);
        expect(trace.stdout).not.toMatch(/startState/);
        expect(trace.stdout).not.toMatch(/continuedFrom/);

        // R8: the state projection gains no startState/continuedFrom key either.
        const state = JSON.parse(readFileSync(join(project, '.spur/memory/runs/plain-1.state.json'), 'utf8')) as {
            startState?: string;
            continuedFrom?: string;
        };
        expect(state.startState).toBeUndefined();
        expect(state.continuedFrom).toBeUndefined();
    });
});
