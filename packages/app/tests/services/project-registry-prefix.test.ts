import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeEnvVar, setEnvVar } from '@gobing-ai/spur-config';
import { ProjectRegistry } from '../../src/services/project-registry';

describe('ProjectRegistry prefix contract (K4 R1/R2)', () => {
    let tempDir: string;
    let projectsFile: string;
    let registry: ProjectRegistry;

    function rawFile(): string {
        return readFileSync(projectsFile, 'utf8');
    }

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'spur-project-registry-prefix-'));
        projectsFile = join(tempDir, 'projects.json');
        setEnvVar('SPUR_PROJECTS_FILE', projectsFile);
        registry = new ProjectRegistry(projectsFile);
    });

    afterEach(() => {
        removeEnvVar('SPUR_PROJECTS_FILE');
        if (existsSync(tempDir)) {
            rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('stores an explicit prefix normalized with its leading slash', async () => {
        const entry = await registry.upsert({ name: 'Knowledge Kit', path: tempDir, prefix: 'kk' });
        expect(entry.prefix).toBe('/kk');
        expect((await registry.getByName('Knowledge Kit'))?.prefix).toBe('/kk');
    });

    it('refuses a prefix that is not a slug', async () => {
        await expect(registry.upsert({ name: 'KK', path: tempDir, prefix: 'Knowledge Kit' })).rejects.toThrow(/slug/);
        expect(existsSync(projectsFile)).toBe(false);
    });

    it('refuses a reserved segment and names it', async () => {
        await expect(registry.upsert({ name: 'KK', path: tempDir, prefix: '/api' })).rejects.toThrow(/api/);
        await expect(registry.upsert({ name: 'KK', path: tempDir, prefix: '/_astro' })).rejects.toThrow(/_astro/);
    });

    it('refuses a prefix another local entry already resolves to', async () => {
        await registry.upsert({ name: 'knowledge-kit', path: join(tempDir, 'a') });
        await expect(
            registry.upsert({ name: 'Other', path: join(tempDir, 'b'), prefix: '/knowledge-kit' }),
        ).rejects.toThrow(/knowledge-kit/);
    });

    it('refuses a prefix on a remote entry and leaves the registry untouched', async () => {
        await registry.upsert({ name: 'Local', path: tempDir });
        const before = rawFile();
        await expect(
            registry.upsert({ name: 'Remote', path: '/tmp/remote', host: '192.168.87.27', prefix: '/kk' }),
        ).rejects.toThrow(/local/);
        expect(rawFile()).toBe(before);
        expect(await registry.getByPath('/tmp/remote')).toBeUndefined();
    });

    it('preserves a stored prefix when the caller omits it', async () => {
        await registry.upsert({ name: 'Knowledge Kit', path: tempDir, prefix: '/kk', port: 0 });
        const healed = await registry.upsert({ name: 'Knowledge Kit', path: tempDir, port: 3001 });
        expect(healed.prefix).toBe('/kk');
        expect(healed.port).toBe(3001);
    });

    it('keeps remote entries byte-identical while adding a local prefix', async () => {
        await registry.upsert({ name: 'Remote', path: '/tmp/remote', host: '192.168.87.27', port: 3003 });
        const before = (await registry.list()).find((p) => p.name === 'Remote');
        await registry.upsert({ name: 'Knowledge Kit', path: tempDir, prefix: '/kk' });
        const after = (await registry.list()).find((p) => p.name === 'Remote');
        expect(after).toEqual(before as never);
        expect(after?.port).toBe(3003);
    });
});
