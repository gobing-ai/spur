import { describe, expect, test } from 'bun:test';
import { createCliContext } from '../src/context';
import { buildProgram } from '../src/index';

describe('workflow transport composition root', () => {
    test('the registered tree lists the flat transports with no retired routes', () => {
        const output = { write: () => {}, error: () => {} };
        const program = buildProgram(createCliContext({ output }), output);
        const workflow = program.commands.find((c) => c.name() === 'workflow');
        const names = workflow?.commands.map((c) => c.name()) ?? [];
        for (const op of ['start', 'stage', 'check']) expect(names).toContain(`commit-guard-${op}`);
        expect(names).toContain('persist-out');
        expect(names).toContain('persist-check');
        expect(names).not.toContain('commit-guard');
        expect(names).not.toContain('inline');
        expect(workflow?.helpInformation()).toContain('commit-guard-start');
    });
});
