import { afterEach, describe, expect, it } from 'bun:test';

import { homedir } from 'node:os';
import { join } from 'node:path';
import {
    getSlashCommandsFilePath,
    slashCommandCategorySchema,
    slashCommandItemSchema,
    slashCommandsFileSchema,
} from '../src/slash-commands';

describe('packages/config slash-commands schemas and path resolution', () => {
    const originalEnv = process.env.SPUR_SLASH_COMMANDS_FILE;

    afterEach(() => {
        if (originalEnv !== undefined) {
            process.env.SPUR_SLASH_COMMANDS_FILE = originalEnv;
        } else {
            delete process.env.SPUR_SLASH_COMMANDS_FILE;
        }
    });

    describe('slashCommandCategorySchema', () => {
        it('accepts valid categories', () => {
            expect(slashCommandCategorySchema.parse('git')).toBe('git');
            expect(slashCommandCategorySchema.parse('dev')).toBe('dev');
            expect(slashCommandCategorySchema.parse('sys')).toBe('sys');
            expect(slashCommandCategorySchema.parse('harness')).toBe('harness');
        });

        it('rejects invalid category strings', () => {
            expect(() => slashCommandCategorySchema.parse('invalid')).toThrow();
            expect(() => slashCommandCategorySchema.parse('')).toThrow();
        });
    });

    describe('slashCommandItemSchema', () => {
        it('parses a valid slash command item with defaults', () => {
            const item = slashCommandItemSchema.parse({
                name: '/test',
                description: 'Test command description',
            });
            expect(item.name).toBe('/test');
            expect(item.description).toBe('Test command description');
            expect(item.category).toBe('dev');
        });

        it('parses a full slash command item', () => {
            const item = slashCommandItemSchema.parse({
                name: '/sp:dev-plan',
                description: 'Plan a feature',
                category: 'harness',
                argumentHint: '"<description>"',
                role: 'planner',
                source: 'plugin:sp',
            });
            expect(item.name).toBe('/sp:dev-plan');
            expect(item.category).toBe('harness');
            expect(item.role).toBe('planner');
            expect(item.source).toBe('plugin:sp');
        });

        it('rejects empty name or description', () => {
            expect(() => slashCommandItemSchema.parse({ name: '', description: 'valid' })).toThrow();
            expect(() => slashCommandItemSchema.parse({ name: '/valid', description: '' })).toThrow();
        });
    });

    describe('slashCommandsFileSchema', () => {
        it('parses empty slash commands file with defaults', () => {
            const parsed = slashCommandsFileSchema.parse({});
            expect(parsed.version).toBe(1);
            expect(parsed.commands).toEqual([]);
        });

        it('parses a slash commands file containing commands', () => {
            const parsed = slashCommandsFileSchema.parse({
                version: 1,
                commands: [{ name: '/review', description: 'Review code', category: 'git' }],
            });
            expect(parsed.commands.length).toBe(1);
            const first = parsed.commands[0];
            expect(first).toBeDefined();
            expect(first?.name).toBe('/review');
        });
    });

    describe('getSlashCommandsFilePath', () => {
        it('returns SPUR_SLASH_COMMANDS_FILE env override when set', () => {
            process.env.SPUR_SLASH_COMMANDS_FILE = '/custom/slash_commands.json';
            expect(getSlashCommandsFilePath()).toBe('/custom/slash_commands.json');
        });

        it('returns default ~/.config/spur/slash_commands.json when SPUR_SLASH_COMMANDS_FILE is unset', () => {
            delete process.env.SPUR_SLASH_COMMANDS_FILE;
            const expected = join(homedir(), '.config', 'spur', 'slash_commands.json');
            expect(getSlashCommandsFilePath()).toBe(expected);
        });
    });
});
