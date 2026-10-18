import { describe, expect, test } from 'bun:test';
import { createCliContext } from '../../../src/context';
import { buildProgram } from '../../../src/index';

/**
 * D65 1242 / ADR-140: the inline driver and its eleven bookkeeping sub-verbs are deleted, not
 * merely unregistered. This pins the absence, so a reintroduced verb fails loudly here.
 */
describe('spur workflow inline — retired surface (task 1242)', () => {
    test('`inline` is not a known workflow command, and its sub-verbs are gone with it', async () => {
        const output = { write: () => {}, error: () => {} };
        const program = await buildProgram(createCliContext({ output }), output);
        const workflow = program.commands.find((c) => c.name() === 'workflow');
        const names = workflow?.commands.map((c) => c.name()) ?? [];
        expect(names).not.toContain('inline');
        // The WT-4 landing capability survives as flat verbs.
        expect(names).toContain('persist-out');
        expect(names).toContain('persist-check');
    });

    test('dispatching `spur workflow inline begin` fails as an unknown command', async () => {
        const errors: string[] = [];
        const output = { write: () => {}, error: (line: string) => errors.push(line) };
        const program = await buildProgram(createCliContext({ output }), output);
        program.exitOverride();
        let code: string | undefined;
        try {
            await program.parseAsync(['workflow', 'inline', 'begin'], { from: 'user' });
        } catch (error) {
            code = (error as { code?: string }).code;
        }
        expect(code).toBe('commander.unknownCommand');
    });
});
