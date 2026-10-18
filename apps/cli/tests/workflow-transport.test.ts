import { describe, expect, test } from 'bun:test';
import { Command } from '@commander-js/extra-typings';
import { createCliContext } from '../src/context';
import { buildProgram } from '../src/index';
import { registerWorkflowTransportCommands } from '../src/workflow-transport';

/**
 * The boot-free composition root for `spur workflow commit-guard` (script-absorption PR-4): it
 * mounts the guard, and the full tree mounts the same command so `spur workflow --help` lists it.
 */
describe('workflow transport composition root', () => {
    test('mounts commit-guard (start/stage/check) under workflow', () => {
        const program = new Command();
        const workflow = program.command('workflow');
        registerWorkflowTransportCommands(workflow, {
            cwd: process.cwd(),
            env: {},
            output: { write: () => {}, error: () => {} },
            setExitCode: () => {},
        });
        const sub = (name: string) => workflow.commands.find((c) => c.name() === name);
        expect(sub('commit-guard')?.commands.map((c) => c.name())).toEqual(['start', 'stage', 'check']);
        // WT-4 landing keeps its capability as flat verbs (task 1242), not as an `inline` sub-verb.
        expect(sub('persist-out')).toBeDefined();
        expect(sub('persist-check')).toBeDefined();
        // D65 1242: the inline driver's transports are gone, not just unregistered.
        expect(sub('inline')).toBeUndefined();
    });

    test('the full tree lists commit-guard under spur workflow and no inline driver', async () => {
        const output = { write: () => {}, error: () => {} };
        const program = await buildProgram(createCliContext({ output }), output);
        const workflow = program.commands.find((c) => c.name() === 'workflow');
        const names = workflow?.commands.map((c) => c.name()) ?? [];
        expect(names).toContain('commit-guard');
        expect(names).toContain('persist-out');
        expect(names).toContain('persist-check');
        expect(names).not.toContain('inline');
    });
});
