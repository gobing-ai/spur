/**
 * G11 1268 — `spur message read`: the plain-text receipt view.
 *
 * The JSON contract is pinned in the noun-level integration file; this covers the transition vs
 * repeat wording an operator actually reads.
 */
import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from '@commander-js/extra-typings';
import { InboxService } from '@gobing-ai/spur-app';
import { createMigratedDb } from '@gobing-ai/spur-domain';
import { registerMessageCommand } from '../../../src/commands/message';
import type { CliContext } from '../../../src/context';
import { main } from '../../../src/index';
import { createCapturedOutput } from '../../helpers';

describe('spur message read', () => {
    test('is registered on the message noun', () => {
        const program = new Command();
        registerMessageCommand(program, {} as CliContext);
        expect((program.commands[0]?.commands ?? []).map((command) => command.name())).toContain('read');
    });

    test('says "read" on the first mark and "already read" on the repeat', async () => {
        const root = await mkdtemp(join(tmpdir(), 'spur-read-'));
        const cwd = join(root, 'alpha');
        const dbUrl = join(cwd, 'test.db');
        const out = createCapturedOutput();
        try {
            // The project dir must exist before the db file is opened inside it.
            await mkdir(cwd, { recursive: true });
            const db = await createMigratedDb({ url: dbUrl });
            const sent = await new InboxService({ getDb: async () => db }).send({
                from: 'proj-coder',
                to: 'operator',
                body: 'hi',
            });
            db.close();

            expect(await main(['message', 'read', sent.message.id], { cwd, dbUrl, output: out })).toBe(0);
            expect(out.messages.join('\n')).toContain(`read ${sent.message.id} by operator`);

            expect(await main(['message', 'read', sent.message.id], { cwd, dbUrl, output: out })).toBe(0);
            expect(out.messages.join('\n')).toContain('was already read by operator');
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});
