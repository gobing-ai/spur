import { describe, expect, test } from 'bun:test';
import { Command } from '@commander-js/extra-typings';
import { createCliContext } from '../src/context';
import { buildProgram } from '../src/index';
import { registerWorkflowTransportCommands } from '../src/workflow-transport';

/**
 * The boot-free composition root for `spur workflow inline|commit-guard` (script-absorption PR-4):
 * it mounts both transports, and the full tree mounts the same commands so `spur workflow --help`
 * lists them.
 */
describe('workflow transport composition root', () => {
    test('mounts inline (every op) and commit-guard (start/stage/check) under workflow', () => {
        const program = new Command();
        const workflow = program.command('workflow');
        registerWorkflowTransportCommands(workflow, {
            cwd: process.cwd(),
            env: {},
            output: { write: () => {}, error: () => {} },
            setExitCode: () => {},
        });
        const sub = (name: string) => workflow.commands.find((c) => c.name() === name);
        expect(sub('inline')?.commands.map((c) => c.name())).toEqual([
            'begin',
            'fingerprint',
            'action',
            'node-enter',
            'actions',
            'close',
            'decide',
            'persist-out',
            'persist-check',
            'attribution',
            'dispatch-failure',
        ]);
        expect(sub('commit-guard')?.commands.map((c) => c.name())).toEqual(['start', 'stage', 'check']);
    });

    test('the full tree lists both under spur workflow', async () => {
        const output = { write: () => {}, error: () => {} };
        const program = await buildProgram(createCliContext({ output }), output);
        const workflow = program.commands.find((c) => c.name() === 'workflow');
        const names = workflow?.commands.map((c) => c.name()) ?? [];
        expect(names).toContain('inline');
        expect(names).toContain('commit-guard');
    });
});
