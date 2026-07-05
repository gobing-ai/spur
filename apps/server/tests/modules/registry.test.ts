import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { builtins, registerModules } from '../../src/modules/registry';

describe('module registry', () => {
    test('builtins includes health, task, feature, events, messages, and jobs modules', () => {
        const names = builtins.map((m) => m.name);
        expect(names).toEqual(['health', 'task', 'feature', 'events', 'messages', 'jobs']);
    });

    test('registerModules mounts all builtins without throwing', () => {
        const app = new Hono();
        expect(() => registerModules(app, undefined, builtins)).not.toThrow();
    });

    test('taskModule is a ServerModule with name "task"', () => {
        const taskMod = builtins.find((m) => m.name === 'task');
        expect(taskMod).toBeDefined();
        expect(taskMod?.name).toBe('task');
    });

    test('featureModule is a ServerModule with name "feature"', () => {
        const featMod = builtins.find((m) => m.name === 'feature');
        expect(featMod).toBeDefined();
        expect(featMod?.name).toBe('feature');
    });
});
