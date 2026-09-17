import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as spurApp from '@gobing-ai/spur-app';
import { getEnvVar, removeEnvVar, setEnvVar, slashCommandsFileSchema } from '@gobing-ai/spur-config';
import { Hono } from 'hono';
import { commandsModule } from '../../src/modules/commands';

describe('commandsModule', () => {
    let tempDir: string;
    let tempJsonPath: string;
    let originalEnv: string | undefined;

    beforeEach(() => {
        originalEnv = getEnvVar('SPUR_SLASH_COMMANDS_FILE');
        tempDir = join(tmpdir(), `spur_srv_slash_cmd_${Date.now()}_${Math.random().toString(36).slice(2)}`);
        mkdirSync(tempDir, { recursive: true });
        tempJsonPath = join(tempDir, 'slash_commands.json');
        setEnvVar('SPUR_SLASH_COMMANDS_FILE', tempJsonPath);
    });

    afterEach(() => {
        if (originalEnv !== undefined) {
            setEnvVar('SPUR_SLASH_COMMANDS_FILE', originalEnv);
        } else {
            removeEnvVar('SPUR_SLASH_COMMANDS_FILE');
        }
        try {
            rmSync(tempDir, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors
        }
    });

    test('mounts and pre-warms slash commands, generating file if missing', () => {
        expect(existsSync(tempJsonPath)).toBe(false);

        const app = new Hono();
        commandsModule.mount(app, undefined);

        // Pre-warm on mount auto-generates the file
        expect(existsSync(tempJsonPath)).toBe(true);
        const raw = JSON.parse(readFileSync(tempJsonPath, 'utf-8'));
        const validated = slashCommandsFileSchema.parse(raw);
        expect(validated.commands.length).toBeGreaterThan(15);
    });

    test('GET /api/commands returns registered commands and filePath', async () => {
        const app = new Hono();
        commandsModule.mount(app, undefined);

        const res = await app.request('/api/commands');
        expect(res.status).toBe(200);

        const data = (await res.json()) as {
            commands: Array<{ name: string; description: string; category: string }>;
            count: number;
            filePath: string;
        };
        expect(data.filePath).toBe(tempJsonPath);
        expect(data.count).toBeGreaterThan(15);
        expect(data.commands.length).toBe(data.count);

        const names = data.commands.map((c) => c.name);
        expect(names).toContain('/help');
        expect(names).toContain('/review');
    });

    test('GET /api/commands?reload=true reloads commands from file', async () => {
        const app = new Hono();
        commandsModule.mount(app, undefined);

        const res = await app.request('/api/commands?reload=true');
        expect(res.status).toBe(200);
        const data = (await res.json()) as { count: number };
        expect(data.count).toBeGreaterThan(15);
    });

    test('GET /api/agent/commands returns identical parity payload for GlobalAgentBar', async () => {
        const app = new Hono();
        commandsModule.mount(app, undefined);

        const res = await app.request('/api/agent/commands');
        expect(res.status).toBe(200);

        const data = (await res.json()) as {
            commands: Array<{ name: string; description: string; category: string }>;
            count: number;
        };
        expect(data.count).toBeGreaterThan(15);
        expect(Array.isArray(data.commands)).toBe(true);
    });

    test('GET /api/agent/commands?reload=true reloads commands for GlobalAgentBar', async () => {
        const app = new Hono();
        commandsModule.mount(app, undefined);

        const res = await app.request('/api/agent/commands?reload=true');
        expect(res.status).toBe(200);
        const data = (await res.json()) as { count: number };
        expect(data.count).toBeGreaterThan(15);
    });

    test('POST /api/commands/generate regenerates the JSON file and returns fresh commands', async () => {
        const app = new Hono();
        commandsModule.mount(app, undefined);

        const res = await app.request('/api/commands/generate', { method: 'POST' });
        expect(res.status).toBe(200);

        const data = (await res.json()) as {
            ok: boolean;
            count: number;
            filePath: string;
            commands: Array<{ name: string }>;
        };
        expect(data.ok).toBe(true);
        expect(data.filePath).toBe(tempJsonPath);
        expect(data.count).toBeGreaterThan(15);
        expect(data.commands.length).toBe(data.count);
    });

    test('POST /api/commands/generate handles error when generation throws', async () => {
        const app = new Hono();
        commandsModule.mount(app, undefined);

        const originalGenerate = spurApp.SlashCommandsService.prototype.generate;
        spurApp.SlashCommandsService.prototype.generate = () => {
            throw new Error('Disk unwritable');
        };

        try {
            const res = await app.request('/api/commands/generate', { method: 'POST' });
            expect(res.status).toBe(500);
            const data = (await res.json()) as { ok: boolean; error: string };
            expect(data.ok).toBe(false);
            expect(data.error).toBe('Disk unwritable');
        } finally {
            spurApp.SlashCommandsService.prototype.generate = originalGenerate;
        }
    });
});
