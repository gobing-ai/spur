import { afterAll, describe, expect, spyOn, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVar, removeEnvVar, setEnvVar } from '@gobing-ai/spur-config';
import { DecisionHub } from '@gobing-ai/ts-ai-decision';
import { LayaWorkerClient } from '@gobing-ai/ts-laya-mlx';

import { DecisionService, disposeDecisionServices, getDecisionService } from '../../src/decision/decision-service';

const newRoot = async (): Promise<string> => mkdtemp(join(tmpdir(), 'spur-decision-service-'));

// One catalog file per scenario, written on demand into a private shared root.
const writeCatalog = async (dir: string, name: string, yaml: string): Promise<void> => {
    const shared = join(dir, 'shared', 'decisions');
    await mkdir(shared, { recursive: true });
    await writeFile(join(shared, name), yaml);
};

const CATALOG = `
version: 1
defaults:
    minConfidence: 0.8
    maker: typesafe
decisions:
    pick-lane:
        type: choice
        criteria:
            fast: go fast
            slow: go slow
        fallback: slow
    scoped-maker:
        type: choice
        criteria:
            a: a
            b: b
        fallback: a
        maker: fm-local
`;

const roots: string[] = [];

afterAll(async () => {
    await Promise.all(roots.map((r) => rm(r, { recursive: true, force: true })));
});

describe('DecisionService (task 1092, design §3.3/§3.6)', () => {
    test('probe rejects duplicate catalogs before entering the hub', async () => {
        const root = await newRoot();
        roots.push(root);
        await writeCatalog(root, 'base.yaml', CATALOG);
        await writeCatalog(root, 'dup.yaml', CATALOG);
        const service = await getDecisionService(null, root, join(root, 'shared'));
        const decide = spyOn(DecisionHub.prototype, 'decide');
        try {
            await expect(service.probeMaker('pick-lane', 'typesafe', {}, 10)).rejects.toThrow(
                'multiple winning catalogs',
            );
            expect(decide).not.toHaveBeenCalled();
        } finally {
            decide.mockRestore();
        }
    });

    test('probe maps accepted and fallback results and bounds an unanswered hub', async () => {
        const root = await newRoot();
        roots.push(root);
        await writeCatalog(root, 'base.yaml', CATALOG);
        const service = await getDecisionService(null, root, join(root, 'shared'));
        const decide = spyOn(DecisionHub.prototype, 'decide');
        try {
            for (const reason of ['accepted', 'low-confidence', 'no-backend', 'timeout', 'error'] as const) {
                decide.mockResolvedValueOnce({
                    id: 'pick-lane',
                    type: 'choice',
                    maker: 'typesafe',
                    value: 'slow',
                    source: reason === 'accepted' ? 'model' : 'default',
                    reason,
                    confidence: 0.6,
                    durationMs: 12,
                });
                expect(await service.probeMaker('pick-lane', 'typesafe', {}, 100)).toEqual({
                    maker: 'typesafe',
                    ok: reason === 'accepted',
                    value: 'slow',
                    reason,
                    durationMs: 12,
                });
            }
            decide.mockImplementationOnce(() => new Promise(() => {}));
            expect(await service.probeMaker('pick-lane', 'typesafe', {}, 1)).toMatchObject({
                maker: 'typesafe',
                ok: false,
                value: null,
                reason: 'timeout',
            });
            decide.mockRejectedValueOnce(new Error('invalid input'));
            await expect(service.probeMaker('pick-lane', 'typesafe', {}, 100)).rejects.toThrow('invalid input');
        } finally {
            decide.mockRestore();
        }
    });

    test('list layers, describe maker precedence and lazy registry', async () => {
        const root = await newRoot();
        roots.push(root);
        await writeCatalog(root, 'base.yaml', CATALOG);
        const service = await getDecisionService(null as never, root, join(root, 'shared'));
        expect(service.list().map((d) => `${d.id}@${d.layer}`)).toEqual(['pick-lane@shared', 'scoped-maker@shared']);
        // no config: catalog decision entry beats catalog defaults
        expect(service.describe('scoped-maker').effectiveMaker).toEqual({
            name: 'fm-local',
            source: 'catalog-decision',
        });
        expect(service.describe('pick-lane').effectiveMaker).toEqual({ name: 'typesafe', source: 'catalog-default' });
        // status: nothing configured is broken; registry stays lazy but reports registered names
        const status = service.status();
        expect(status.ok).toBe(true);
        expect(status.layers).toEqual({ project: 0, registered: 0, shared: 1 });
        expect(status.registeredMakers).toContain('typesafe');
        expect(status.perDecision.map((r) => `${r.id}:${r.maker}:${r.source}:${r.registered}`)).toEqual([
            'pick-lane:typesafe:catalog-default:true',
            'scoped-maker:fm-local:catalog-decision:true',
        ]);
    });

    test('dup ids decide fail-closed; config outranks catalog; unregistered config maker errors', async () => {
        // Own root: the service cache is keyed by cwd, so tests must not share one.
        const root = await newRoot();
        roots.push(root);
        await writeCatalog(root, 'base.yaml', CATALOG);
        // Same ids in a later shared file: BOTH ids become duplicates (same basename layer order).
        await writeCatalog(root, 'dup.yaml', CATALOG);
        const service = await getDecisionService(
            {
                decisions: { makers: { 'scoped-maker': 'nope-missing' } },
            } as never,
            root,
            join(root, 'shared'),
        );
        // config makers.<id> outranks any catalog source…
        expect(service.describe('scoped-maker').effectiveMaker).toEqual({
            name: 'nope-missing',
            source: 'config-decision',
        });
        // …but decide fails closed on the duplicate id before any maker work.
        await expect(service.decide('scoped-maker', { x: 1 })).rejects.toThrow('multiple winning catalogs');
        const status = service.status();
        expect(status.ok).toBe(false);
        expect(status.errors.join(' ')).toContain('nope-missing');
        await expect(service.decide('scoped-maker', { x: 1 }, { maker: 'nope-missing' })).rejects.toThrow();
    });
});

/** The serving hub and the probe hub each own a laya client, so this catalog serves both. */
const LAYA_CATALOG = `
version: 1
decisions:
    pick-lane:
        type: choice
        criteria:
            fast: go fast
            slow: go slow
        fallback: slow
    maker-liveness:
        type: choice
        criteria:
            ok: answered
            unclear: could not answer
        fallback: unclear
`;

/** The worker's own answer shape, so the driver's mapping runs without spawning Python. */
const LAYA_WORKER_RESULT = {
    model: 'stub',
    answers: {
        'pick-lane': { choice: 'fast', confidence: 0.9, probabilities: { fast: 0.9, slow: 0.1 } },
        'maker-liveness': { choice: 'ok', confidence: 0.9, probabilities: { ok: 0.9, unclear: 0.1 } },
    },
};

/** `laya-local` is Apple-Silicon macOS only; the client's own host check enforces it. */
const NON_LAY_HOST = process.platform !== 'darwin' || process.arch !== 'arm64';

/**
 * `spur decision run` against `laya-local` used to print its result and then hang forever: the
 * driver holds a warm Python worker "for the client's lifetime", exposes no disposal seam, and the
 * worker's open pipes keep the event loop alive (~1 h observed in a real session). These tests pin
 * the fix — Spur builds the client itself (through the registry's typed `client` option) and owns
 * it — without spawning the real worker.
 */
describe('DecisionService — laya-local worker lifecycle', () => {
    test.skipIf(NON_LAY_HOST)('dispose releases the laya client the serving hub used', async () => {
        const root = await newRoot();
        roots.push(root);
        await writeCatalog(root, 'laya.yaml', LAYA_CATALOG);
        const service = await getDecisionService(null, root, join(root, 'shared'));
        const ask = spyOn(LayaWorkerClient.prototype, 'ask').mockResolvedValue(LAYA_WORKER_RESULT);
        const dispose = spyOn(LayaWorkerClient.prototype, 'dispose');
        try {
            await expect(service.decide('pick-lane', {}, { maker: 'laya-local' })).resolves.toMatchObject({
                value: 'fast',
                source: 'model',
                reason: 'accepted',
                maker: 'laya-local',
            });
            expect(ask).toHaveBeenCalledTimes(1);
            // The worker is held while the decision is served…
            expect(dispose).not.toHaveBeenCalled();
            // …and released by the service, which is what lets a one-shot process exit.
            service.dispose();
            expect(dispose).toHaveBeenCalledTimes(1);
        } finally {
            ask.mockRestore();
            dispose.mockRestore();
        }
    });

    test.skipIf(NON_LAY_HOST)('the probe hub owns its own bounded laya client', async () => {
        const root = await newRoot();
        roots.push(root);
        await writeCatalog(root, 'laya.yaml', LAYA_CATALOG);
        const service = await getDecisionService(null, root, join(root, 'shared'));
        const ask = spyOn(LayaWorkerClient.prototype, 'ask').mockResolvedValue(LAYA_WORKER_RESULT);
        const dispose = spyOn(LayaWorkerClient.prototype, 'dispose');
        try {
            await expect(service.probeMaker('maker-liveness', 'laya-local', {}, 1_000)).resolves.toMatchObject({
                maker: 'laya-local',
                ok: true,
                value: 'ok',
            });
            service.dispose();
            expect(dispose).toHaveBeenCalledTimes(1);
        } finally {
            ask.mockRestore();
            dispose.mockRestore();
        }
    });

    test('disposeDecisionServices releases every cached service once and is idempotent', async () => {
        const root = await newRoot();
        roots.push(root);
        await writeCatalog(root, 'base.yaml', CATALOG);
        const service = await getDecisionService(null, root, join(root, 'shared'));
        const dispose = spyOn(DecisionService.prototype, 'dispose');
        try {
            await disposeDecisionServices();
            // Every service in the process-wide cache is released, this one included.
            const released = dispose.mock.calls.length;
            expect(released).toBeGreaterThan(0);
            // The cache is cleared, so a second call has nothing left to release.
            await disposeDecisionServices();
            expect(dispose.mock.calls.length).toBe(released);
            // A disposed service is still usable: the client is rebuilt on the next ask.
            expect(service.status().ok).toBe(true);
        } finally {
            dispose.mockRestore();
        }
    });
});

/** A catalog naming the hosted maker, so hub load itself gates on registration. */
const CLEF_CATALOG = `
version: 1
decisions:
    hosted-pick:
        type: choice
        maker: clef
        criteria:
            fast: go fast
            slow: go slow
        fallback: slow
`;

/** Set env vars for one test body, restoring the process environment afterwards. */
const withEnv = async (vars: Record<string, string>, run: () => Promise<void>): Promise<void> => {
    const previous = Object.fromEntries(Object.keys(vars).map((key) => [key, getEnvVar(key)]));
    for (const [key, value] of Object.entries(vars)) setEnvVar(key, value);
    try {
        await run();
    } finally {
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) removeEnvVar(key);
            else setEnvVar(key, value);
        }
    }
};

describe('DecisionService — hosted clef maker (design §3.6)', () => {
    test('without Cloudflare credentials the maker is unregistered and a catalog naming it fails closed', async () => {
        await withEnv({}, async () => {
            removeEnvVar('CLOUDFLARE_ACCOUNT_ID');
            removeEnvVar('CLOUDFLARE_AUTH_TOKEN');
            const root = await newRoot();
            roots.push(root);
            await writeCatalog(root, 'clef.yaml', CLEF_CATALOG);
            const service = await getDecisionService(null as never, root, join(root, 'shared'));
            const status = service.status();
            expect(status.registeredMakers).not.toContain('clef');
            // A missing backend is reported, never served as a silent fallback.
            expect(status.ok).toBe(false);
            expect(status.errors.join(' ')).toContain("maker 'clef' that is not registered");
            await expect(service.decide('hosted-pick', {})).rejects.toThrow(/hosted-pick/);
        });
    });

    test('credentials register the maker, load the catalog, and a driver failure falls back to the declared value', async () => {
        // A non-hex account id makes createClefDriver reject at construction: the
        // fallback path is exercised with no socket, proving env -> driver -> hub wiring.
        await withEnv({ CLOUDFLARE_ACCOUNT_ID: 'not-a-hex-account', CLOUDFLARE_AUTH_TOKEN: 'cf-token' }, async () => {
            const root = await newRoot();
            roots.push(root);
            await writeCatalog(root, 'clef.yaml', CLEF_CATALOG);
            const service = await getDecisionService(null as never, root, join(root, 'shared'));
            expect(service.status().registeredMakers).toContain('clef');
            expect(service.status().ok).toBe(true);
            expect(service.describe('hosted-pick').effectiveMaker).toEqual({
                name: 'clef',
                source: 'catalog-decision',
            });
            await expect(service.decide('hosted-pick', {})).resolves.toMatchObject({
                value: 'slow',
                source: 'default',
                reason: 'no-backend',
                maker: 'clef',
            });
        });
    });
});
