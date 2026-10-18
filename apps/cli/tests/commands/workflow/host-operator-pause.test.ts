/**
 * End-to-end: an unanswered operator gate on a host run pauses and resumes on `--answer`
 * (task 1248, feature D66 R10; repro run 44f98e49-ba48-476b-93d8-a10c611ea075).
 *
 * The regression shape: `workflow run … --vars '{"executor":"host"}' --json` selects the
 * non-TTY default responder, which answered confirm `no`; the shell after the gate consumed
 * that default and the run ended terminal with no pause. The gate must pause instead, and
 * `continue --answer` must land the operator's answer in the gate's answer var for the next
 * action — without replaying the gate.
 */
import { describe, expect, test } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createMigratedDb } from '@gobing-ai/spur-domain';
import { main } from '../../../src/index';
import { createCapturedOutput, createTempProject } from '../../helpers';

/**
 * A confirm gate followed, in the SAME state, by the shell that consumes its answer — the
 * idea-pipeline shape. The state is not declared `pause: true`: the only pause available is
 * the action's, which is exactly what regressed.
 */
const HOST_CONFIRM_YAML = `name: host-confirm-gate
kind: state-machine
initialState: start
vars:
  __hitlAnswer: ""
states:
  - id: start
    onEnter:
      - kind: note
        options:
          message: go
  - id: gate
    onEnter:
      - kind: hitl.confirm
        options:
          prompt: "Approve the idea?"
          decision:
            mode: never
      - kind: shell
        options:
          command: 'a="\${vars.__hitlAnswer}"; [ -n "$a" ] || a=no; echo "$a" > answer.txt'
  - id: approved
  - id: rejected
transitions:
  - from: start
    to: gate
    guard: { kind: always }
  - from: gate
    to: approved
    guard:
      kind: shell
      options:
        command: 'test "\${vars.__hitlAnswer}" = yes'
  - from: gate
    to: rejected
    guard:
      kind: shell
      options:
        command: 'test "\${vars.__hitlAnswer}" != yes'
terminalStates:
  - approved
  - rejected
`;

/** Launch the fixture on the host executor, headless `--json`, and return the run result. */
async function runOnHost(runId: string, vars = '{"executor":"host"}', yaml = HOST_CONFIRM_YAML) {
    const dir = await createTempProject();
    const wfDir = join(dir, '.spur', 'workflows');
    await mkdir(wfDir, { recursive: true });
    const wf = join(wfDir, 'host-confirm-gate.yaml');
    await writeFile(wf, yaml);
    const dbUrl = join(dir, 'spur.db');
    const out = createCapturedOutput();
    const exit = await main(['workflow', 'run', '--run-id', runId, wf, '--vars', vars, '--json'], {
        output: out,
        cwd: dir,
        dbUrl,
    });
    expect(out.errors).toEqual([]);
    const result = JSON.parse(out.messages.at(-1) ?? '{}');
    expect(exit).toBe(result.status === 'done' ? 0 : 1);
    return { dir, dbUrl, out, result };
}

async function runStatus(dbUrl: string, runId: string): Promise<string | undefined> {
    const db = await createMigratedDb({ url: dbUrl });
    const row = await db.queryFirst<{ status: string }>('SELECT status FROM runs WHERE id = ?', runId);
    return row?.status;
}

describe('task 1248 AC1: an interactive operator pause on a host run waits for an answer', () => {
    test('the confirm gate pauses with its question instead of defaulting to no (R1)', async () => {
        const { dir, dbUrl, result } = await runOnHost('host-gate-1');
        expect(result.status).toBe('paused');
        expect(result.finalState).toBe('gate');
        // The question reaches the host, which relays it to the operator.
        expect(result.pause).toEqual({ reason: 'hitl-pause', kind: 'hitl.confirm', prompt: 'Approve the idea?' });
        expect(await runStatus(dbUrl, 'host-gate-1')).toBe('paused');
        // The default-deny shell never ran: the pause is before it, not after.
        expect(readFile(join(dir, 'answer.txt'), 'utf8')).rejects.toThrow();
        await rm(dir, { recursive: true, force: true });
    });

    test('continue --answer yes resumes the paused gate and the next action sees the answer (R2)', async () => {
        const { dir, dbUrl } = await runOnHost('host-gate-2');
        const out = createCapturedOutput();
        const exit = await main(['workflow', 'continue', 'host-gate-2', '--yes', '--answer', 'yes', '--json'], {
            output: out,
            cwd: dir,
            dbUrl,
        });
        expect(exit).toBe(0);
        const resumed = JSON.parse(out.messages.at(-1) ?? '{}');
        expect(resumed.status).toBe('done');
        expect(resumed.finalState).toBe('approved');
        // The shell AFTER the gate ran exactly once, with the operator's answer — no gate replay.
        expect((await readFile(join(dir, 'answer.txt'), 'utf8')).trim()).toBe('yes');
        await rm(dir, { recursive: true, force: true });
    });

    test('--answer no resumes to the rejected branch (R2)', async () => {
        const { dir, dbUrl } = await runOnHost('host-gate-3');
        const out = createCapturedOutput();
        const exit = await main(['workflow', 'continue', 'host-gate-3', '--yes', '--answer', 'no', '--json'], {
            output: out,
            cwd: dir,
            dbUrl,
        });
        expect(exit).toBe(0);
        expect(JSON.parse(out.messages.at(-1) ?? '{}').finalState).toBe('rejected');
        expect((await readFile(join(dir, 'answer.txt'), 'utf8')).trim()).toBe('no');
        await rm(dir, { recursive: true, force: true });
    });

    test('--answer-text is refused on a paused host confirm, not stored as a receipt path (R3)', async () => {
        const { dir, dbUrl } = await runOnHost('host-gate-4');
        const out = createCapturedOutput();
        const exit = await main(['workflow', 'continue', 'host-gate-4', '--yes', '--answer-text', 'yes', '--json'], {
            output: out,
            cwd: dir,
            dbUrl,
        });
        expect(exit).toBe(2);
        const errText = out.errors.join('\n');
        expect(errText).toContain("state 'gate' waits on a hitl.confirm gate");
        expect(errText).toContain('use --answer yes|no|cancel');
        // A refused answer mutates nothing: still paused, still no shell output.
        expect(await runStatus(dbUrl, 'host-gate-4')).toBe('paused');
        expect(readFile(join(dir, 'answer.txt'), 'utf8')).rejects.toThrow();
        await rm(dir, { recursive: true, force: true });
    });

    test('a headless run without executor=host keeps the default-deny responder (R4)', async () => {
        const { dir, dbUrl, result } = await runOnHost('host-gate-5', '{"profile":"standard"}');
        expect(result.status).toBe('done');
        expect(result.finalState).toBe('rejected');
        expect((await readFile(join(dir, 'answer.txt'), 'utf8')).trim()).toBe('no');
        expect(await runStatus(dbUrl, 'host-gate-5')).toBe('done');
        await rm(dir, { recursive: true, force: true });
    });
});

const OPERATOR_KINDS = ['hitl.confirm', 'hitl.select', 'hitl.input'] as const;

test('a non-host declared transition-flow pause keeps its default answer without a host question (R4)', async () => {
    const definition = Bun.YAML.parse(operatorWorkflow('hitl.confirm', 'transition-flow')) as {
        nodes: { id: string; pause?: boolean }[];
    };
    for (const node of definition.nodes) {
        if (node.id === 'gate') node.pause = true;
    }
    const { dir, result } = await runOnHost(
        'non-host-node-pause',
        '{"profile":"standard"}',
        Bun.YAML.stringify(definition),
    );
    try {
        expect(result.status).toBe('paused');
        expect(result.pause).toBeUndefined();
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

function operatorWorkflow(kind: (typeof OPERATOR_KINDS)[number], mode: 'state-machine' | 'transition-flow'): string {
    const gate = {
        kind,
        options: {
            // biome-ignore lint/suspicious/noTemplateCurlyInString: workflow template resolved from persisted vars
            prompt: 'Answer ${vars.topic}?',
            var: 'chosen',
            ...(kind === 'hitl.input' ? {} : { decision: { mode: 'never' } }),
            ...(kind === 'hitl.select' ? { options: ['yes', 'no', 'cancel'] } : {}),
        },
    };
    const consumer = {
        kind: 'shell',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: workflow template consumed after resume
        options: { command: 'echo "${vars.chosen}" >> answer.txt' },
    };
    return Bun.YAML.stringify({
        name: 'operator-gate',
        kind: mode,
        vars: { chosen: '', topic: 'the operator' },
        ...(mode === 'transition-flow'
            ? {
                  initialNode: 'gate',
                  nodes: [{ id: 'gate', action: gate }, { id: 'consumer', action: consumer }, { id: 'done' }],
                  edges: [
                      { from: 'gate', to: 'consumer' },
                      { from: 'consumer', to: 'done' },
                  ],
                  terminalNodes: ['done'],
              }
            : {
                  initialState: 'gate',
                  states: [{ id: 'gate', onEnter: [gate, consumer] }, { id: 'done' }],
                  transitions: [{ from: 'gate', to: 'done', guard: { kind: 'always' } }],
                  terminalStates: ['done'],
              }),
    });
}

for (const mode of ['state-machine', 'transition-flow'] as const) {
    describe(`task 1248 review regressions: ${mode}`, () => {
        for (const kind of OPERATOR_KINDS) {
            test(`${kind} refuses an unanswered TTY continue without advancing the consumer`, async () => {
                const runId = `unanswered-${mode}-${kind.replace('.', '-')}`;
                const { dir, dbUrl, result } = await runOnHost(
                    runId,
                    '{"executor":"host"}',
                    operatorWorkflow(kind, mode),
                );
                try {
                    expect(result.status).toBe('paused');
                    const out = createCapturedOutput();
                    const previous = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
                    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
                    let exit: number;
                    try {
                        // --yes skips resume confirmation; it must never answer the gate.
                        exit = await main(['workflow', 'continue', runId, '--yes'], { output: out, cwd: dir, dbUrl });
                    } finally {
                        if (previous) Object.defineProperty(process.stdout, 'isTTY', previous);
                        else delete (process.stdout as { isTTY?: boolean }).isTTY;
                    }
                    // Service validation uses the CLI's existing resume-error exit code.
                    expect(exit).toBe(1);
                    expect(out.errors.join('\n')).toContain(kind === 'hitl.input' ? '--answer-text' : '--answer');
                    expect(await runStatus(dbUrl, runId)).toBe('paused');
                    await expect(readFile(join(dir, 'answer.txt'), 'utf8')).rejects.toThrow();
                } finally {
                    await rm(dir, { recursive: true, force: true });
                }
            });

            test(`${kind} carries its question and resumes once with the explicit answer`, async () => {
                const runId = `answered-${mode}-${kind.replace('.', '-')}`;
                const { dir, dbUrl, result } = await runOnHost(
                    runId,
                    '{"executor":"host"}',
                    operatorWorkflow(kind, mode),
                );
                try {
                    expect(result.status).toBe('paused');
                    expect(result.pause).toEqual({ reason: 'hitl-pause', kind, prompt: 'Answer the operator?' });
                    await expect(readFile(join(dir, 'answer.txt'), 'utf8')).rejects.toThrow();
                    const out = createCapturedOutput();
                    const answer = kind === 'hitl.input' ? 'operator text' : 'yes';
                    const flag = kind === 'hitl.input' ? '--answer-text' : '--answer';
                    expect(
                        await main(['workflow', 'continue', runId, '--yes', flag, answer, '--json'], {
                            output: out,
                            cwd: dir,
                            dbUrl,
                        }),
                    ).toBe(0);
                    expect(JSON.parse(out.messages.at(-1) ?? '{}').status).toBe('done');
                    expect(await readFile(join(dir, 'answer.txt'), 'utf8')).toBe(`${answer}\n`);
                } finally {
                    await rm(dir, { recursive: true, force: true });
                }
            });
        }
    });
}
