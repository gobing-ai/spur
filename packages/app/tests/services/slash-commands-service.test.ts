import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { slashCommandsFileSchema } from '@gobing-ai/spur-config';
import {
    deduceCommandCategory,
    generateSlashCommands,
    generateSlashCommandsFile,
    getBuiltinClaudeCommands,
    loadSlashCommands,
    SlashCommandsService,
    scanMarkdownCommands,
} from '../../src/services/slash-commands-service';

describe('slash-commands-service', () => {
    let tempDir: string;
    let tempJsonPath: string;

    beforeEach(() => {
        tempDir = join(tmpdir(), `spur_test_slash_cmd_${Date.now()}_${Math.random().toString(36).slice(2)}`);
        mkdirSync(tempDir, { recursive: true });
        tempJsonPath = join(tempDir, 'slash_commands.json');
    });

    afterEach(() => {
        try {
            rmSync(tempDir, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors
        }
    });

    test('getBuiltinClaudeCommands returns standard Claude Code commands', () => {
        const builtins = getBuiltinClaudeCommands();
        expect(builtins.length).toBeGreaterThanOrEqual(15);

        const names = builtins.map((c) => c.name);
        expect(names).toContain('/help');
        expect(names).toContain('/clear');
        expect(names).toContain('/compact');
        expect(names).toContain('/cost');
        expect(names).toContain('/doctor');
        expect(names).toContain('/init');
        expect(names).toContain('/review');
        expect(names).toContain('/commit');
        expect(names).toContain('/terminal');
        expect(names).toContain('/revert');
        expect(names).toContain('/resume');
        expect(names).toContain('/bug');
        expect(names).toContain('/config');
        expect(names).toContain('/login');
        expect(names).toContain('/logout');

        for (const cmd of builtins) {
            expect(cmd.source).toBe('builtin');
            expect(['git', 'dev', 'sys', 'harness']).toContain(cmd.category);
            expect(cmd.description.length).toBeGreaterThan(0);
        }
    });

    test('deduceCommandCategory categorizes commands by prefix or stem', () => {
        expect(deduceCommandCategory('dev-gitmsg')).toBe('git');
        expect(deduceCommandCategory('review')).toBe('git');
        expect(deduceCommandCategory('commit')).toBe('git');
        expect(deduceCommandCategory('doctor')).toBe('sys');
        expect(deduceCommandCategory('cost')).toBe('sys');
        expect(deduceCommandCategory('rule-add')).toBe('harness');
        expect(deduceCommandCategory('workflow-run')).toBe('harness');
        expect(deduceCommandCategory('dev-plan')).toBe('harness');
        expect(deduceCommandCategory('dev-debug')).toBe('dev');
    });

    test('scanMarkdownCommands parses frontmatter and markdown body', () => {
        const mdDir = join(tempDir, 'sample_commands');
        mkdirSync(mdDir, { recursive: true });

        const customMd = `---
description: Custom test command for testing scanner
role: tester
argument-hint: "<arg1> [--flag]"
category: dev
---

# Custom Command

Some documentation body here.
`;
        writeFileSync(join(mdDir, 'custom-test.md'), customMd, 'utf-8');

        const items = scanMarkdownCommands(mdDir, { prefix: '/sp:', source: 'plugin:sp' });
        expect(items.length).toBe(1);
        const first = items[0];
        expect(first).toBeDefined();
        expect(first).toEqual({
            name: '/sp:custom-test',
            description: 'Custom test command for testing scanner',
            role: 'tester',
            argumentHint: '<arg1> [--flag]',
            category: 'dev',
            source: 'plugin:sp',
        });
    });

    test('scanMarkdownCommands falls back to header if description is missing', () => {
        const mdDir = join(tempDir, 'no_fm');
        mkdirSync(mdDir, { recursive: true });

        const customMd = `# Heading Only Command

Details about the command.
`;
        writeFileSync(join(mdDir, 'heading-cmd.md'), customMd, 'utf-8');

        const items = scanMarkdownCommands(mdDir, { prefix: '/' });
        expect(items.length).toBe(1);
        const first = items[0];
        expect(first).toBeDefined();
        expect(first?.name).toBe('/heading-cmd');
        expect(first?.description).toBe('Heading Only Command');
    });

    test('generateSlashCommands merges builtins and plugins/sp/commands', () => {
        const commands = generateSlashCommands({
            projectRoot: process.cwd(),
            includeBuiltin: true,
            includePluginSp: true,
        });

        expect(commands.length).toBeGreaterThan(40);
        const names = commands.map((c) => c.name);

        // Contains builtins
        expect(names).toContain('/help');
        expect(names).toContain('/review');

        // Contains spur plugin commands
        expect(names).toContain('/sp:dev-plan');
        expect(names).toContain('/sp:dev-run');
        expect(names).toContain('/sp:dev-verify');

        const devPlan = commands.find((c) => c.name === '/sp:dev-plan');
        expect(devPlan?.role).toBe('planner');
        expect(devPlan?.argumentHint).toBeDefined();
        expect(devPlan?.source).toBe('plugin:sp');
    });

    test('generateSlashCommandsFile writes valid schema JSON', () => {
        const result = generateSlashCommandsFile(tempJsonPath, {
            projectRoot: process.cwd(),
        });

        expect(result.path).toBe(tempJsonPath);
        expect(result.count).toBeGreaterThan(40);
        expect(existsSync(tempJsonPath)).toBe(true);

        const raw = JSON.parse(readFileSync(tempJsonPath, 'utf-8'));
        const validated = slashCommandsFileSchema.parse(raw);
        expect(validated.version).toBe(1);
        expect(validated.commands.length).toBe(result.count);
    });

    test('loadSlashCommands auto-generates if file does not exist', () => {
        expect(existsSync(tempJsonPath)).toBe(false);

        const loaded = loadSlashCommands(tempJsonPath, true, {
            projectRoot: process.cwd(),
        });

        expect(existsSync(tempJsonPath)).toBe(true);
        expect(loaded.length).toBeGreaterThan(40);

        // Second load reads from the persisted file
        const reloaded = loadSlashCommands(tempJsonPath, false);
        expect(reloaded.length).toBe(loaded.length);
    });

    test('SlashCommandsService manages discovery, caching, and regeneration', () => {
        const service = new SlashCommandsService({
            filePath: tempJsonPath,
            projectRoot: process.cwd(),
        });

        expect(service.getFilePath()).toBe(tempJsonPath);

        const commands = service.getCommands();
        expect(commands.length).toBeGreaterThan(40);
        expect(existsSync(tempJsonPath)).toBe(true);

        // Regenerate writes fresh content
        const regenResult = service.generate();
        expect(regenResult.count).toBe(commands.length);
    });
});
