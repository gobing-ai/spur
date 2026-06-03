import { describe, expect, it } from 'bun:test';
import { PluginNotDeclaredError, PluginTrustError } from '../src/plugin';
import { TrustEngine } from '../src/trust';

function ctx(pluginName = 'test-plugin', trustLevel: 'bundled' | 'curated' | 'local' | 'untrusted' = 'curated') {
    return { source: trustLevel as 'bundled' | 'curated' | 'local', pluginName, trustLevel };
}

const manifestWith = (entries: Record<string, string[]>) =>
    ({
        ...entries,
    }) as {
        commands?: string[];
        api?: string[];
        ui?: string[];
        events?: string[];
        harnesses?: string[];
        providers?: string[];
        rules?: string[];
        skills?: string[];
        workers?: string[];
    };

describe('TrustEngine.enforce', () => {
    const engine = new TrustEngine();

    it('bundled is unconditionally allowed for any capability', () => {
        // Should not throw for privileged capability at bundled level
        engine.enforce('harnesses', 'bundled', ctx('bundled-plugin', 'bundled'));
        engine.enforce('workers', 'bundled', ctx('bundled-plugin', 'bundled'));
        engine.enforce('commands', 'bundled', ctx('bundled-plugin', 'bundled'));
    });

    it('curated allows all capabilities', () => {
        engine.enforce('commands', 'curated', ctx('curated-plugin', 'curated'));
        engine.enforce('harnesses', 'curated', ctx('curated-plugin', 'curated'));
        engine.enforce('workers', 'curated', ctx('curated-plugin', 'curated'));
    });

    it('local allows safe capabilities', () => {
        engine.enforce('commands', 'local', ctx('local-plugin', 'local'));
        engine.enforce('api', 'local', ctx('local-plugin', 'local'));
        engine.enforce('ui', 'local', ctx('local-plugin', 'local'));
        engine.enforce('events', 'local', ctx('local-plugin', 'local'));
        engine.enforce('skills', 'local', ctx('local-plugin', 'local'));
    });

    it('local denies privileged capabilities', () => {
        expect(() => engine.enforce('harnesses', 'local', ctx('plugin', 'local'))).toThrow(PluginTrustError);
        expect(() => engine.enforce('providers', 'local', ctx('plugin', 'local'))).toThrow(PluginTrustError);
        expect(() => engine.enforce('rules', 'local', ctx('plugin', 'local'))).toThrow(PluginTrustError);
        expect(() => engine.enforce('workers', 'local', ctx('plugin', 'local'))).toThrow(PluginTrustError);
    });

    it('untrusted allows safe capabilities', () => {
        engine.enforce('commands', 'untrusted', ctx('untrusted-plugin', 'untrusted'));
        engine.enforce('api', 'untrusted', ctx('untrusted-plugin', 'untrusted'));
        engine.enforce('ui', 'untrusted', ctx('untrusted-plugin', 'untrusted'));
        engine.enforce('events', 'untrusted', ctx('untrusted-plugin', 'untrusted'));
        engine.enforce('skills', 'untrusted', ctx('untrusted-plugin', 'untrusted'));
    });

    it('untrusted denies privileged capabilities', () => {
        expect(() => engine.enforce('harnesses', 'untrusted', ctx('plugin', 'untrusted'))).toThrow(PluginTrustError);
        expect(() => engine.enforce('providers', 'untrusted', ctx('plugin', 'untrusted'))).toThrow(PluginTrustError);
        expect(() => engine.enforce('rules', 'untrusted', ctx('plugin', 'untrusted'))).toThrow(PluginTrustError);
        expect(() => engine.enforce('workers', 'untrusted', ctx('plugin', 'untrusted'))).toThrow(PluginTrustError);
    });

    it('error message contains plugin + capability + level', () => {
        try {
            engine.enforce('harnesses', 'local', ctx('my-plugin', 'local'));
        } catch (e) {
            expect(e).toBeInstanceOf(PluginTrustError);
            const msg = (e as Error).message;
            expect(msg).toContain('my-plugin');
            expect(msg).toContain('harnesses');
            expect(msg).toContain('local');
        }
    });
});

describe('TrustEngine.declares', () => {
    const engine = new TrustEngine();

    it('returns true when capability is declared with the name', () => {
        const manifest = manifestWith({ commands: ['my.cmd', 'other.cmd'] });
        expect(engine.declares(manifest, 'commands', 'my.cmd')).toBe(true);
        expect(engine.declares(manifest, 'commands', 'other.cmd')).toBe(true);
    });

    it('returns false when capability array is missing', () => {
        const manifest = manifestWith({});
        expect(engine.declares(manifest, 'commands', 'my.cmd')).toBe(false);
    });

    it('returns false when name is not in the list', () => {
        const manifest = manifestWith({ commands: ['my.cmd'] });
        expect(engine.declares(manifest, 'commands', 'other.cmd')).toBe(false);
    });
});

describe('TrustEngine.check', () => {
    const engine = new TrustEngine();

    it('passes when declared and allowed', () => {
        const manifest = manifestWith({ commands: ['my.cmd'] });
        engine.check(manifest, 'commands', 'my.cmd', ctx('plugin', 'curated'));
    });

    it('throws PluginNotDeclaredError when undeclared', () => {
        const manifest = manifestWith({ commands: ['my.cmd'] });
        expect(() => engine.check(manifest, 'commands', 'other.cmd', ctx('plugin', 'curated'))).toThrow(
            PluginNotDeclaredError,
        );
    });

    it('throws PluginTrustError when declared but trust level forbids', () => {
        const manifest = manifestWith({ harnesses: ['my.harness'] });
        expect(() => engine.check(manifest, 'harnesses', 'my.harness', ctx('plugin', 'local'))).toThrow(
            PluginTrustError,
        );
    });

    it('bundled bypasses both checks', () => {
        // Even without declaring, bundled passes
        const manifest = manifestWith({});
        engine.check(manifest, 'harnesses', 'any.harness', ctx('plugin', 'bundled'));
    });
});
