import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { Hono } from 'hono';
import type { ServerContext } from '../../src/context';
import { healthModule } from '../../src/modules/health';

describe('plans endpoints', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'spur-plans-test-'));
    });

    afterEach(() => {
        if (existsSync(tempDir)) {
            rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('GET /api/project/plans returns empty list without ServerContext', async () => {
        const app = new Hono();
        healthModule.mount(app, undefined);

        const res = await app.request('/api/project/plans');
        expect(res.status).toBe(200);
        const data = (await res.json()) as { files: unknown[]; total: number };
        expect(data.files).toEqual([]);
        expect(data.total).toBe(0);
    });

    test('GET /api/project/plans returns docs/02_ROADMAP.md and docs/plans/*.md sorted descending', async () => {
        // Create sample roadmap and plan docs
        mkdirSync(join(tempDir, 'docs', 'plans'), { recursive: true });
        writeFileSync(
            join(tempDir, 'docs', '02_ROADMAP.md'),
            '---\nfrontmatter: true\n---\n\n# 02 Roadmap — Spur\n\nPhases.',
        );
        writeFileSync(join(tempDir, 'docs', 'plans', '2026-06-10-older-plan.md'), '# Older Plan\n\nJune details.');
        writeFileSync(join(tempDir, 'docs', 'plans', '2026-09-21-newer-plan.md'), '# Newer Plan\n\nSeptember details.');
        // Non-md file should be ignored
        writeFileSync(join(tempDir, 'docs', 'plans', 'audit.json'), '{"ignore": true}');

        const app = new Hono();
        const ctx = {
            cwd: tempDir,
            fs: createNodeFileSystem(tempDir),
        } as unknown as ServerContext;
        healthModule.mount(app, ctx);

        const res = await app.request('/api/project/plans');
        expect(res.status).toBe(200);
        const data = (await res.json()) as {
            files: Array<{ id: string; path: string; name: string; title: string; category: string }>;
            total: number;
        };

        expect(data.total).toBe(3);
        // 1. Roadmap
        expect(data.files[0]?.path).toBe('docs/02_ROADMAP.md');
        expect(data.files[0]?.title).toBe('02 Roadmap — Spur');
        expect(data.files[0]?.category).toBe('roadmap');

        // 2. Newer plan first (descending sort)
        expect(data.files[1]?.path).toBe('docs/plans/2026-09-21-newer-plan.md');
        expect(data.files[1]?.title).toBe('Newer Plan');
        expect(data.files[1]?.category).toBe('plan');

        // 3. Older plan second
        expect(data.files[2]?.path).toBe('docs/plans/2026-06-10-older-plan.md');
        expect(data.files[2]?.title).toBe('Older Plan');
        expect(data.files[2]?.category).toBe('plan');
    });

    test('GET /api/project/plans/file loads allowed files', async () => {
        mkdirSync(join(tempDir, 'docs', 'plans'), { recursive: true });
        writeFileSync(join(tempDir, 'docs', '02_ROADMAP.md'), '# Roadmap Title\n\nRoadmap content.');
        writeFileSync(join(tempDir, 'docs', 'plans', 'sample.md'), '# Sample Plan\n\nSample content.');

        const app = new Hono();
        const ctx = {
            cwd: tempDir,
            fs: createNodeFileSystem(tempDir),
        } as unknown as ServerContext;
        healthModule.mount(app, ctx);

        const resRoadmap = await app.request('/api/project/plans/file?path=docs/02_ROADMAP.md');
        expect(resRoadmap.status).toBe(200);
        const dataRoadmap = (await resRoadmap.json()) as { ok: boolean; path: string; title: string; content: string };
        expect(dataRoadmap.ok).toBe(true);
        expect(dataRoadmap.title).toBe('Roadmap Title');
        expect(dataRoadmap.content).toBe('# Roadmap Title\n\nRoadmap content.');

        const resPlan = await app.request('/api/project/plans/file?path=docs/plans/sample.md');
        expect(resPlan.status).toBe(200);
        const dataPlan = (await resPlan.json()) as { ok: boolean; path: string; title: string; content: string };
        expect(dataPlan.ok).toBe(true);
        expect(dataPlan.title).toBe('Sample Plan');
        expect(dataPlan.content).toBe('# Sample Plan\n\nSample content.');
    });

    test('GET /api/project/plans/file rejects unauthorized paths', async () => {
        const app = new Hono();
        const ctx = {
            cwd: tempDir,
            fs: createNodeFileSystem(tempDir),
        } as unknown as ServerContext;
        healthModule.mount(app, ctx);

        const res1 = await app.request('/api/project/plans/file?path=../../etc/passwd');
        expect(res1.status).toBe(403);

        const res2 = await app.request('/api/project/plans/file?path=package.json');
        expect(res2.status).toBe(403);

        const res3 = await app.request('/api/project/plans/file?path=docs/plans/audit.json');
        expect(res3.status).toBe(403);

        const res4 = await app.request('/api/project/plans/file');
        expect(res4.status).toBe(400);
    });

    test('GET /api/project/plans/file returns 404 for missing allowed files', async () => {
        const app = new Hono();
        const ctx = {
            cwd: tempDir,
            fs: createNodeFileSystem(tempDir),
        } as unknown as ServerContext;
        healthModule.mount(app, ctx);

        const res = await app.request('/api/project/plans/file?path=docs/plans/nonexistent.md');
        expect(res.status).toBe(404);
        const data = (await res.json()) as { ok: boolean; error: string };
        expect(data.ok).toBe(false);
    });
});
