import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PluginHost } from '@gobing-ai/spur-plugin-sdk';
import { EventBus, type Logger } from '@gobing-ai/ts-infra';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { PluginLoader } from '../src/services/plugin-loader';

function createTempDir(): string {
    const dir = join(tmpdir(), `spur-test-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    return dir;
}

function writeYaml(dir: string, obj: Record<string, unknown>): void {
    const lines = Object.entries(obj).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
    writeFileSync(join(dir, 'plugin.yaml'), lines.join('\n'));
}

function writeIndex(dir: string, name: string): void {
    writeFileSync(
        join(dir, 'index.ts'),
        `export default { name: '${name}', version: '1.0.0', trust: 'local', onLoad(h) {}, };`,
    );
}

function makePlugin(parent: string, name: string, trust = 'local'): string {
    const p = join(parent, name);
    mkdirSync(p, { recursive: true });
    writeYaml(p, { name, version: '1.0.0', trust });
    writeIndex(p, name);
    return p;
}
const silentLogger: Logger = {
    trace() {},
    debug() {},
    info() {},
    warn() {},
    error() {},
    fatal() {},
    child() {
        return silentLogger;
    },
};

function newHost(): PluginHost {
    // biome-ignore lint/suspicious/noExplicitAny: ts-infra 0.3.5 duplicate instances — structurally identical EventBus
    return new PluginHost(new EventBus({}) as any, { logger: silentLogger });
}

function newLoader(
    env: Record<string, string | undefined> = {},
    loadModule?: (id: string) => Promise<Record<string, unknown>>,
) {
    const mockLoad =
        loadModule ??
        (async (id: string) => {
            const dirName = id.split('/').slice(-2, -1)[0] ?? 'unknown';
            if (dirName === 'bad-b' || dirName === 'bad-l') throw new Error('BROKEN');
            return { default: { name: dirName, version: '1.0.0', trust: 'local', onLoad() {} } };
        });
    return new PluginLoader(newHost(), createNodeFileSystem(), silentLogger, env, mockLoad);
}

// ═══════════════════════════════════════════════════════════════════════
// resolveRoots
// ═══════════════════════════════════════════════════════════════════════

describe('PluginLoader.resolveRoots', () => {
    it('returns at least .spur + ~/.spur roots', () => {
        const roots = newLoader().resolveRoots();
        expect(roots.length).toBeGreaterThanOrEqual(2);
    });

    it('includes installDir bundled root', () => {
        const roots = newLoader().resolveRoots('/install');
        expect(roots.some((r) => r.source === 'bundled')).toBe(true);
    });

    it('SPUR_PLUGIN_PATH env creates local roots', () => {
        const roots = newLoader({ SPUR_PLUGIN_PATH: '/a:/b' }).resolveRoots();
        expect(roots.filter((r) => r.path === '/a' || r.path === '/b').length).toBe(2);
    });

    it('home root is curated', () => {
        expect(
            newLoader()
                .resolveRoots()
                .some((r) => r.source === 'curated'),
        ).toBe(true);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// discover
// ═══════════════════════════════════════════════════════════════════════

describe('PluginLoader.discover', () => {
    let tmp: string;
    let loader: PluginLoader;

    beforeEach(() => {
        tmp = createTempDir();
        const pd = join(tmp, '.spur/plugins');
        mkdirSync(pd, { recursive: true });
        makePlugin(pd, 'p-a');
        makePlugin(pd, 'p-b');
        mkdirSync(join(pd, 'empty'), { recursive: true });
        writeFileSync(join(pd, 'file.txt'), 'x');
        loader = newLoader();
    });

    afterEach(() => rmSync(tmp, { recursive: true, force: true }));

    it('finds plugins with plugin.yaml', async () => {
        const c = await loader.discover([{ path: join(tmp, '.spur/plugins'), source: 'local' }]);
        expect(c.length).toBe(2);
    });

    it('skips non-existent roots', async () => {
        const c = await loader.discover([{ path: join(tmp, 'nope'), source: 'local' }]);
        expect(c).toEqual([]);
    });

    it('skips non-plugin dirs', async () => {
        const c = await loader.discover([{ path: join(tmp, '.spur/plugins'), source: 'local' }]);
        const names = c.map((x) => x.dir.split('/').pop());
        expect(names).not.toContain('empty');
    });

    it('tags with correct source', async () => {
        const c = await loader.discover([{ path: join(tmp, '.spur/plugins'), source: 'local' }]);
        expect(c.every((x) => x.source === 'local')).toBe(true);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// validate
// ═══════════════════════════════════════════════════════════════════════

describe('PluginLoader.validate', () => {
    let tmp: string;
    let loader: PluginLoader;

    beforeEach(() => {
        tmp = createTempDir();
        loader = newLoader();
    });
    afterEach(() => rmSync(tmp, { recursive: true, force: true }));

    it('passes valid manifest', async () => {
        const d = makePlugin(tmp, 'ok');
        const r = await loader.validate({ dir: d, source: 'local', root: tmp });
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.plugin.manifest.name).toBe('ok');
    });

    it('fail-soft for local with bad name', async () => {
        const d = join(tmp, 'bad');
        mkdirSync(d, { recursive: true });
        writeFileSync(join(d, 'plugin.yaml'), 'name: Bad!\nversion: 1.0.0\ntrust: local\n');
        const r = await loader.validate({ dir: d, source: 'local', root: tmp });
        expect(r.ok).toBe(false);
    });

    it('fail-fast for bundled with bad name', async () => {
        const d = join(tmp, 'bad-b');
        mkdirSync(d, { recursive: true });
        writeFileSync(join(d, 'plugin.yaml'), 'name: Bad!\nversion: 1.0.0\ntrust: bundled\n');
        await expect(loader.validate({ dir: d, source: 'bundled', root: tmp })).rejects.toThrow(/Bundled/);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// registerAll — two-class loading
// ═══════════════════════════════════════════════════════════════════════

describe('PluginLoader.registerAll', () => {
    let tmp: string;
    let loader: PluginLoader;

    beforeEach(() => {
        tmp = createTempDir();
        loader = newLoader();
    });
    afterEach(() => rmSync(tmp, { recursive: true, force: true }));

    async function valReg(dir: string, src: 'bundled' | 'curated' | 'local' = 'local') {
        const r = await loader.validate({ dir, source: src, root: tmp });
        if (!r.ok) throw new Error(`validate: ${r.error}`);
        return loader.registerAll([r.plugin]);
    }

    it('loads local plugin', async () => {
        const r = await valReg(makePlugin(tmp, 'ok-p'));
        expect(r[0]?.status).toBe('loaded');
    });

    it('fail-fast: bundled throws fatal', async () => {
        const d = join(tmp, 'bad-b');
        mkdirSync(d, { recursive: true });
        writeYaml(d, { name: 'bad-b', version: '1.0.0', trust: 'bundled' });
        writeFileSync(join(d, 'index.ts'), 'throw new Error("BROKEN");');
        await expect(valReg(d, 'bundled')).rejects.toThrow(/FATAL/);
    });

    it('fail-soft: local error is skipped', async () => {
        const d = join(tmp, 'bad-l');
        mkdirSync(d, { recursive: true });
        writeYaml(d, { name: 'bad-l', version: '1.0.0', trust: 'local' });
        writeFileSync(join(d, 'index.ts'), 'throw new Error("BROKEN");');
        const r = await valReg(d);
        expect(r[0]?.status).toBe('failed');
    });

    it('name-shadowing: second same-name skipped', async () => {
        // Custom mock: both dirs return name 'shadow'
        loader = newLoader({}, async () => ({
            default: { name: 'shadow', version: '1.0.0', trust: 'local', onLoad() {} },
        }));
        const d1 = makePlugin(tmp, 'shadow');
        const d2 = join(tmp, 'shadow2');
        mkdirSync(d2, { recursive: true });
        writeYaml(d2, { name: 'shadow', version: '1.0.0', trust: 'local' });
        writeIndex(d2, 'shadow');
        const r1 = await loader.validate({ dir: d1, source: 'local', root: tmp });
        const r2 = await loader.validate({ dir: d2, source: 'local', root: tmp });
        if (!r1.ok || !r2.ok) throw new Error('val fail');

        const results = await loader.registerAll([r1.plugin, r2.plugin]);
        expect(results.filter((r) => r.status === 'loaded').length).toBe(1);
        expect(results.filter((r) => r.status === 'skipped').length).toBe(1);
    });
});
