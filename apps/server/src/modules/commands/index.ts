import { type SlashCommandItem, SlashCommandsService } from '@gobing-ai/spur-app';
import { getSlashCommandsFilePath } from '@gobing-ai/spur-config';
import type { Context, Hono } from 'hono';
import type { ServerContext } from '../../context';
import type { ServerModule } from '../types';

/**
 * Server module for Slash Commands catalog and discovery.
 *
 * Responsibilities:
 * - On server mount, loads slash command candidates from `~/.config/spur/slash_commands.json`
 *   (or `SPUR_SLASH_COMMANDS_FILE`). If the file is missing, automatically generates it from
 *   Anthropic Claude Code built-in commands and installed plugin commands (`plugins/sp/commands/*.md`).
 * - Serves `GET /api/commands` and `GET /api/agent/commands` for the Global Agent Bar and command palette.
 * - Serves `POST /api/commands/generate` to trigger manual regeneration when new commands are authored.
 */
export const commandsModule: ServerModule = {
    name: 'commands',

    mount(app: Hono, ctx: ServerContext | undefined): void {
        const projectRoot = ctx?.cwd ?? process.cwd();
        const filePath = getSlashCommandsFilePath();
        const service = new SlashCommandsService({ filePath, projectRoot });

        // Pre-warm / load slash commands immediately upon server startup.
        let cachedCommands: SlashCommandItem[] = [];
        try {
            cachedCommands = service.getCommands();
        } catch {
            // Graceful fallback to empty cached list if initialization fails
        }

        const handleList = (c: Context) => {
            const reload = c.req.query('reload') === 'true';
            if (reload || cachedCommands.length === 0) {
                try {
                    cachedCommands = service.getCommands(reload);
                } catch {
                    // Retain existing cached commands
                }
            }
            return c.json({
                commands: cachedCommands,
                count: cachedCommands.length,
                filePath: service.getFilePath(),
            });
        };

        // ── GET /api/commands & /api/agent/commands (GlobalAgentBar parity) ──
        app.get('/api/commands', handleList);
        app.get('/api/agent/commands', handleList);

        // ── POST /api/commands/generate — Trigger file regeneration from Claude Code / plugins ──
        app.post('/api/commands/generate', (c) => {
            try {
                const result = service.generate();
                cachedCommands = result.commands;
                return c.json({
                    ok: true,
                    count: result.count,
                    filePath: result.path,
                    commands: result.commands,
                });
            } catch (err) {
                return c.json(
                    {
                        ok: false,
                        error: err instanceof Error ? err.message : String(err),
                        filePath: service.getFilePath(),
                    },
                    500,
                );
            }
        });
    },
};
