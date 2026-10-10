/**
 * Tests for the shared DB-backed feature receipt run port (task 1137 P2 remediation).
 *
 * The port is the completion boundary's only view of run-store facts, so both the
 * digest-selection fallbacks and the symlink-aware artifact comparison are pinned here.
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArtifactDao, createMigratedDb, RunDao } from '@gobing-ai/spur-domain';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { createFeatureReceiptRunPort } from '../../src/services/feature-receipt-run-port';

function db(): Promise<Awaited<ReturnType<typeof createMigratedDb>>> {
    return createMigratedDb({ url: ':memory:' });
}

describe('createFeatureReceiptRunPort (1137)', () => {
    test('returns undefined for an unknown run id', async () => {
        const port = createFeatureReceiptRunPort(await db());
        expect(await port.readRunRow?.('run_missing')).toBeUndefined();
    });

    test('prefers resumeDefinitionDigest over definitionDigest and passes status through', async () => {
        const adapter = await db();
        const runs = new RunDao(adapter);
        const run = await runs.open({ status: 'done' });
        await runs.stampMetadata(run.id, {
            definitionDigest: 'sha256:launch',
            resumeDefinitionDigest: 'sha256:resume',
        });

        const row = await createFeatureReceiptRunPort(adapter).readRunRow?.(run.id);

        expect(row).toEqual({ status: 'done', definitionDigest: 'sha256:resume', varsJson: null });
    });

    test('falls back to definitionDigest, then to null when no digest is recorded', async () => {
        const adapter = await db();
        const runs = new RunDao(adapter);
        const withLaunch = await runs.open({ status: 'done' });
        await runs.stampMetadata(withLaunch.id, { definitionDigest: 'sha256:launch' });
        const bare = await runs.open({ status: 'failed' });

        const port = createFeatureReceiptRunPort(adapter);

        expect((await port.readRunRow?.(withLaunch.id))?.definitionDigest).toBe('sha256:launch');
        // An empty metadata_json column is not valid JSON: the unreadable-metadata path
        // must degrade to an empty patch, never throw.
        expect(await port.readRunRow?.(bare.id)).toEqual({ status: 'failed', definitionDigest: null, varsJson: null });
    });

    test('matches a registered artifact by exact path and rejects an unregistered one', async () => {
        const adapter = await db();
        const runs = new RunDao(adapter);
        const artifacts = new ArtifactDao(adapter);
        const run = await runs.open({ status: 'done' });
        await artifacts.record({ runId: run.id, path: '/tmp/receipt.json', kind: 'feature-receipt' });

        const port = createFeatureReceiptRunPort(adapter);

        expect(await port.hasArtifact?.(run.id, '/tmp/receipt.json')).toBe(true);
        expect(await port.hasArtifact?.(run.id, '/tmp/other.json')).toBe(false);
        expect(await port.hasArtifact?.('run_missing', '/tmp/receipt.json')).toBe(false);
    });

    test('resolves a symlinked comparison through the filesystem, and degrades to lexical equality without one', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-receipt-port-'));
        try {
            const real = join(dir, 'real.json');
            const link = join(dir, 'link.json');
            writeFileSync(real, '{}');
            symlinkSync(real, link);

            const adapter = await db();
            const runs = new RunDao(adapter);
            const artifacts = new ArtifactDao(adapter);
            const run = await runs.open({ status: 'done' });
            await artifacts.record({ runId: run.id, path: real, kind: 'feature-receipt' });

            const withFs = createFeatureReceiptRunPort(adapter, createNodeFileSystem());
            const lexicalOnly = createFeatureReceiptRunPort(adapter);

            expect(await withFs.hasArtifact?.(run.id, link)).toBe(true);
            expect(await lexicalOnly.hasArtifact?.(run.id, link)).toBe(false);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
