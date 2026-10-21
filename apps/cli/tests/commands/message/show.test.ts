/**
 * G11 1268 — `spur message show`: the plain-text thread view.
 *
 * The JSON contract is pinned in the noun-level integration file; this covers the human-readable
 * rendering (both directions, oldest first, order stable) and the not-found refusal.
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

describe('spur message show', () => {
    test('is registered on the message noun', () => {
        const program = new Command();
        registerMessageCommand(program, {} as CliContext);
        expect((program.commands[0]?.commands ?? []).map((command) => command.name())).toContain('show');
    });

    test('prints both directions oldest first, and refuses an unknown id', async () => {
        const root = await mkdtemp(join(tmpdir(), 'spur-show-'));
        const cwd = join(root, 'alpha');
        const dbUrl = join(cwd, 'test.db');
        const out = createCapturedOutput();
        try {
            // The project dir must exist before the db file is opened inside it.
            await mkdir(cwd, { recursive: true });
            const db = await createMigratedDb({ url: dbUrl });
            const service = new InboxService({ getDb: async () => db });
            const sent = await service.send({ from: 'operator', to: 'proj-coder', body: 'question' });
            await service.reply(sent.message.id, 'proj-coder', 'answer');
            db.close();

            expect(await main(['message', 'show', sent.message.id], { cwd, dbUrl, output: out })).toBe(0);
            const text = out.messages.join('\n');
            expect(text.indexOf('question')).toBeLessThan(text.indexOf('answer'));
            expect(text).toContain('operator → proj-coder');
            expect(text).toContain('proj-coder → operator');

            expect(await main(['message', 'show', 'msg_missing'], { cwd, dbUrl, output: out })).toBe(1);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});
