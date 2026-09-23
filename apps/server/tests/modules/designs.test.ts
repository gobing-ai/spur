import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { Hono } from 'hono';
import type { ServerContext } from '../../src/context';
import { healthModule } from '../../src/modules/health';

describe('designs endpoints', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'spur-designs-test-'));
    });

    afterEach(() => {
        if (existsSync(tempDir)) {
            rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('GET /api/project/designs returns empty list without ServerContext', async () => {
        const app = new Hono();
        healthModule.mount(app, undefined);

        const res = await app.request('/api/project/designs');
        expect(res.status).toBe(200);
        const data = (await res.json()) as { files: unknown[]; total: number };
        expect(data.files).toEqual([]);
        expect(data.total).toBe(0);
    });

    test('GET /api/project/designs returns DESIGN.md, 04_DESIGN.md, and docs/design/*.md', async () => {
        // Create sample design docs
        writeFileSync(join(tempDir, 'DESIGN.md'), '# Spur UI/UX Design System\n\nDesign system guidelines.');
        mkdirSync(join(tempDir, 'docs', 'design'), { recursive: true });
        writeFileSync(join(tempDir, 'docs', '04_DESIGN.md'), '# Concrete Surface Contracts\n\nContracts spec.');
        writeFileSync(join(tempDir, 'docs', 'design', 'beta-feature.md'), '# Beta Feature Spec\n\nBeta details.');
        writeFileSync(join(tempDir, 'docs', 'design', 'alpha-feature.md'), '# Alpha Feature Spec\n\nAlpha details.');

        const app = new Hono();
        const ctx = {
            cwd: tempDir,
            fs: createNodeFileSystem(tempDir),
        } as unknown as ServerContext;
        healthModule.mount(app, ctx);

        const res = await app.request('/api/project/designs');
        expect(res.status).toBe(200);
        const data = (await res.json()) as {
            files: Array<{ id: string; path: string; name: string; title: string; category: string }>;
            total: number;
        };

        expect(data.total).toBe(4);
        expect(data.files[0]?.path).toBe('DESIGN.md');
        expect(data.files[0]?.title).toBe('Spur UI/UX Design System');
        expect(data.files[0]?.category).toBe('root');

        expect(data.files[1]?.path).toBe('docs/04_DESIGN.md');
        expect(data.files[1]?.title).toBe('Concrete Surface Contracts');
        expect(data.files[1]?.category).toBe('architecture');

        // Satellite files sorted alphabetically
        expect(data.files[2]?.path).toBe('docs/design/alpha-feature.md');
        expect(data.files[2]?.title).toBe('Alpha Feature Spec');
        expect(data.files[2]?.category).toBe('satellite');

        expect(data.files[3]?.path).toBe('docs/design/beta-feature.md');
        expect(data.files[3]?.title).toBe('Beta Feature Spec');
        expect(data.files[3]?.category).toBe('satellite');
    });

    test('GET /api/project/designs/file loads allowed files', async () => {
        writeFileSync(join(tempDir, 'DESIGN.md'), '# My Design\n\nContent body here.');

        const app = new Hono();
        const ctx = {
            cwd: tempDir,
            fs: createNodeFileSystem(tempDir),
        } as unknown as ServerContext;
        healthModule.mount(app, ctx);

        const res = await app.request('/api/project/designs/file?path=DESIGN.md');
        expect(res.status).toBe(200);
        const data = (await res.json()) as { ok: boolean; path: string; title: string; content: string };
        expect(data.ok).toBe(true);
        expect(data.path).toBe('DESIGN.md');
        expect(data.title).toBe('My Design');
        expect(data.content).toBe('# My Design\n\nContent body here.');
    });

    test('GET /api/project/designs/file rejects unauthorized paths', async () => {
        const app = new Hono();
        const ctx = {
            cwd: tempDir,
            fs: createNodeFileSystem(tempDir),
        } as unknown as ServerContext;
        healthModule.mount(app, ctx);

        // Path traversal
        const resTraversal = await app.request('/api/project/designs/file?path=../../etc/passwd');
        expect(resTraversal.status).toBe(403);

        // Outside allowed directories
        const resOutside = await app.request('/api/project/designs/file?path=package.json');
        expect(resOutside.status).toBe(403);

        // Missing path parameter
        const resMissing = await app.request('/api/project/designs/file');
        expect(resMissing.status).toBe(400);

        // File not found
        const resNotFound = await app.request('/api/project/designs/file?path=docs/04_DESIGN.md');
        expect(resNotFound.status).toBe(404);
    });
});
