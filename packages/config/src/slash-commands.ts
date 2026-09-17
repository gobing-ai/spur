import { homedir } from 'node:os';
import { join } from 'node:path';
import { getEnvVar } from '@gobing-ai/ts-utils';
import { z } from 'zod';

/** Standard categories for slash commands in Spur & Claude Code. */
export const slashCommandCategorySchema = z.enum(['git', 'dev', 'sys', 'harness']);
/** Category union type for slash command categorization. */
export type SlashCommandCategory = z.infer<typeof slashCommandCategorySchema>;

/** Zod schema for a single slash command candidate. */
export const slashCommandItemSchema = z.object({
    /** Canonical slash command name, e.g. '/review' or '/sp:dev-plan'. */
    name: z.string().min(1),
    /** Concise, single-line explanation of what the command does. */
    description: z.string().min(1),
    /** UI category for filtering and grouping in the command palette. */
    category: slashCommandCategorySchema.default('dev'),
    /** Syntax hint for arguments, e.g. '"<description>" [--auto]'. */
    argumentHint: z.string().optional(),
    /** Tags for categorization and dynamic filtering, e.g. ['sp', 'dev', 'plan']. */
    tags: z.array(z.string()).default([]),
    /** Target agent role or executor if pinned, e.g. 'planner'. */
    role: z.string().optional(),
    /** Provenance source, e.g. 'builtin', 'plugin:sp', 'user'. */
    source: z.string().optional(),
});

/** Individual slash command item candidate. */
export type SlashCommandItem = z.infer<typeof slashCommandItemSchema>;

/** Zod schema for ~/.config/spur/slash_commands.json storage file. */
export const slashCommandsFileSchema = z.object({
    version: z.number().int().default(1),
    updatedAt: z.string().optional(),
    commands: z.array(slashCommandItemSchema).default([]),
});

/** Structure of the ~/.config/spur/slash_commands.json storage file. */
export type SlashCommandsFile = z.infer<typeof slashCommandsFileSchema>;

/**
 * Get the path to ~/.config/spur/slash_commands.json.
 * Respects SPUR_SLASH_COMMANDS_FILE env override for tests and custom locations.
 */
export function getSlashCommandsFilePath(): string {
    const override = getEnvVar('SPUR_SLASH_COMMANDS_FILE');
    if (override) {
        return override;
    }
    return join(homedir(), '.config', 'spur', 'slash_commands.json');
}
