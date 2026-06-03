import { describe, expect, it } from 'bun:test';
import {
    type Capability,
    PluginCollisionError,
    PluginNotDeclaredError,
    type PluginSource,
    PluginTrustError,
} from '../src/plugin';

describe('plugin types and errors', () => {
    it('PluginCollisionError includes capability and name', () => {
        const err = new PluginCollisionError('commands', 'my.cmd', 'plugin-a');
        expect(err.message).toContain('my.cmd');
        expect(err.message).toContain('commands');
        expect(err.message).toContain('plugin-a');
        expect(err.name).toBe('PluginCollisionError');
    });

    it('PluginTrustError includes plugin name, capability, and level', () => {
        const err = new PluginTrustError('test-plugin', 'harnesses', 'local', 'not allowed');
        expect(err.message).toContain('test-plugin');
        expect(err.message).toContain('harnesses');
        expect(err.message).toContain('local');
        expect(err.name).toBe('PluginTrustError');
    });

    it('PluginNotDeclaredError includes plugin, capability, and name', () => {
        const err = new PluginNotDeclaredError('test-plugin', 'commands', 'my.cmd');
        expect(err.message).toContain('test-plugin');
        expect(err.message).toContain('commands');
        expect(err.message).toContain('my.cmd');
        expect(err.name).toBe('PluginNotDeclaredError');
    });

    it('Capability type accepts all 9 known capabilities', () => {
        const caps: Capability[] = [
            'commands',
            'api',
            'ui',
            'events',
            'harnesses',
            'providers',
            'rules',
            'skills',
            'workers',
        ];
        expect(caps.length).toBe(9);
    });

    it('PluginSource type accepts all 5 sources', () => {
        const sources: PluginSource[] = ['builtin', 'bundled', 'curated', 'local', 'untrusted'];
        expect(sources.length).toBe(5);
    });
});
