/**
 * feature-verification-run — the app-owned verification pass (task 1176 R2).
 *
 * The receipt writer under test is the real one: each case drives `runFeatureVerification` against a
 * temporary workdir with the genuine `start`/`complete` receipt functions, so the durable/feature-latest
 * receipt pair and the status file are real artifacts. What is injected is the surroundings: an
 * in-memory artifact registration (the run/artifact backing), a canned definition resolver, a canned
 * launcher, and the digest seam — enough to reach failure paths without a git repo, a project DB, or a
 * spawned agent.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BuilderConfigSchema } from '@gobing-ai/spur-config';
import { RunDao } from '@gobing-ai/spur-domain';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { openInlineRunProjectDb } from '../../src/services/inline-run-attribution';
import {
    completeFeatureVerificationReceipt,
    featureReceiptPaths,
    startFeatureVerificationReceipt,
} from '../../src/workflow/feature-verification-receipt';
import {
    createFeatureLookup,
    type FeatureVerificationRunInput,
    runFeatureVerification,
} from '../../src/workflow/feature-verification-run';

const roots: string[] = [];
afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
});

interface Harness {
    workdir: string;
    input: FeatureVerificationRunInput;
    artifacts: Array<{ runId: string; path: string; kind: string }>;
    setDigest: (value: string) => void;
    lastArgs: string[];
}

/** A passing-by-default harness: real receipts, canned everything else. */
function harness(over: Partial<FeatureVerificationRunInput> = {}, status: number | null = 0): Harness {
    const workdir = mkdtempSync(join(tmpdir(), 'fv-run-'));
    roots.push(workdir);
    const featureFile = join(workdir, 'H99_temp-feature.md');
    writeFileSync(featureFile, '# H99\n\n## Goal\n\ntemp\n');
    const artifacts: Harness['artifacts'] = [];
    const lastArgs: string[] = [];
    let digest = 'sha256:before';
    const input: FeatureVerificationRunInput = {
        workdir,
        featureId: 'H99',
        runId: 'run-h99',
        resolveFeatureSpec: async () => ({ path: featureFile, content: readFileSync(featureFile, 'utf8') }),
        resolveDefinition: async () =>
            ({
                path: join(workdir, 'feature-lifecycle.yaml'),
                layer: 'shared' as never,
                digest: 'sha256:definition',
                // 1246 R5: definition `vars` are no longer consulted — the effective command is
                // the DEFAULT_FEATURE_VERIFICATION_CMD constant unless `--cmd` overrides it.
                workflow: { vars: { verificationCmd: 'bun run spur-check-feature' } },
            }) as never,
        launch: (_command, args) => {
            lastArgs.push(...args);
            return { status };
        },
        // The digest seam is the fingerprint engine, not the receipt writer; forcing its value keeps
        // the mismatch case deterministic without a git worktree.
        receipts: {
            start: startFeatureVerificationReceipt,
            complete: completeFeatureVerificationReceipt,
            captureDigest: async () => digest,
        },
        registerArtifact: async (artifact) => {
            artifacts.push(artifact);
        },
        ...over,
    };
    return {
        workdir,
        input,
        artifacts,
        setDigest: (value: string) => {
            digest = value;
        },
        lastArgs,
    };
}

describe('runFeatureVerification — receipt lifecycle (task 1176 R2)', () => {
    test('a green pass records RUNNING then PASS, in both copies and the status file', async () => {
        const h = harness();
        const result = await runFeatureVerification(h.input);
        expect(result.status).toBe('PASS');
        const paths = featureReceiptPaths(join(h.workdir, '.spur', 'run'), 'H99', 'run-h99');
        expect(existsSync(paths.runScoped)).toBe(true);
        expect(existsSync(paths.featureScoped)).toBe(true);
        expect(readFileSync(paths.status, 'utf8').trim()).toBe('PASS');
        const receipt = JSON.parse(readFileSync(paths.runScoped, 'utf8')) as {
            status: string;
            featureId: string;
            runId: string;
            verificationCmd: string;
            verifier: { definitionDigest: string; layer: string };
        };
        expect(receipt.status).toBe('PASS');
        expect(receipt.featureId).toBe('H99');
        expect(receipt.runId).toBe('run-h99');
        // The resolved definition is recorded, not re-derived at completion time; the effective
        // command is the default constant now that the wrapper's verificationCmd var is gone (1246 R5).
        expect(receipt.verifier.definitionDigest).toBe('sha256:definition');
        expect(receipt.verificationCmd).toBe('spur self exec check-feature');
    });

    test('the run-scoped receipt is registered as an artifact (in-memory backing)', async () => {
        const h = harness();
        await runFeatureVerification(h.input);
        expect(h.artifacts).toHaveLength(1);
        expect(h.artifacts[0]?.kind).toBe('feature-verification');
        expect(h.artifacts[0]?.runId).toBe('run-h99');
        expect(h.artifacts[0]?.path).toBe(
            featureReceiptPaths(join(h.workdir, '.spur', 'run'), 'H99', 'run-h99').runScoped,
        );
    });

    test('a failing command completes the receipt FAIL and writes the FAIL status', async () => {
        const h = harness({}, 2);
        const result = await runFeatureVerification(h.input);
        expect(result.status).toBe('FAIL');
        const paths = featureReceiptPaths(join(h.workdir, '.spur', 'run'), 'H99', 'run-h99');
        expect(readFileSync(paths.status, 'utf8').trim()).toBe('FAIL');
        expect((JSON.parse(readFileSync(paths.runScoped, 'utf8')) as { status: string }).status).toBe('FAIL');
    });

    test('a digest mismatch fails an otherwise green command', async () => {
        const h = harness();
        let calls = 0;
        h.input.receipts = {
            ...(h.input.receipts as NonNullable<FeatureVerificationRunInput['receipts']>),
            captureDigest: async () => {
                calls += 1;
                return calls === 1 ? 'sha256:before' : 'sha256:after';
            },
        };
        const result = await runFeatureVerification(h.input);
        expect(calls).toBe(2);
        expect(result.status).toBe('FAIL');
    });

    test('an unsafe command is refused by the splitter and records FAIL without launching', async () => {
        const h = harness({ splitCommand: () => ({ error: 'unsafe verificationCmd' }) });
        const result = await runFeatureVerification(h.input);
        expect(result.status).toBe('FAIL');
        expect(result.message).toContain('unsafe verificationCmd');
        expect(h.lastArgs).toEqual([]);
        const paths = featureReceiptPaths(join(h.workdir, '.spur', 'run'), 'H99', 'run-h99');
        expect(readFileSync(paths.status, 'utf8').trim()).toBe('FAIL');
    });

    test('the real defaults run end to end: log fd, launcher and artifact registration', async () => {
        // No launch/openLog/registerArtifact injection: this exercises the app-owned defaults, so a
        // regression in the log-fd wiring or the DB-backed artifact registration fails here. The
        // artifact row carries a foreign key to `runs`, exactly as in production, so the fixture
        // seeds a run row first (the workflow's own run id does this on a real pass).
        const h = harness({ cmdOverride: 'printf verified' });
        delete h.input.launch;
        delete h.input.registerArtifact;
        const db = await openInlineRunProjectDb(h.workdir);
        const run = await new RunDao(db.adapter as never).open();
        db.close();
        h.input.runId = (run as { id: string }).id;
        const result = await runFeatureVerification(h.input);
        expect(result.status).toBe('PASS');
        const paths = featureReceiptPaths(join(h.workdir, '.spur', 'run'), 'H99', h.input.runId);
        expect(readFileSync(paths.log, 'utf8')).toContain('verified');
        expect(readFileSync(paths.status, 'utf8').trim()).toBe('PASS');
    });

    test("an empty run id opens and finalizes the pass's own run row (1246 R2)", async () => {
        const opened: string[] = [];
        const finalized: Array<{ runId: string; status: string }> = [];
        const h = harness({
            runId: '',
            passRun: {
                open: async () => {
                    const id = 'run-owned';
                    opened.push(id);
                    return id;
                },
                finalize: async (runId, status) => {
                    finalized.push({ runId, status });
                },
            },
        });
        const result = await runFeatureVerification(h.input);
        expect(result.status).toBe('PASS');
        expect(opened).toEqual(['run-owned']);
        // A completed pass closes its row done whether the verdict is PASS or FAIL.
        expect(finalized).toEqual([{ runId: 'run-owned', status: 'done' }]);
        const paths = featureReceiptPaths(join(h.workdir, '.spur', 'run'), 'H99', 'run-owned');
        expect((JSON.parse(readFileSync(paths.runScoped, 'utf8')) as { runId: string }).runId).toBe('run-owned');
    });

    test('an empty run id finalizes the row failed when the pass cannot run (1246 R2)', async () => {
        const finalized: Array<{ runId: string; status: string }> = [];
        const h = harness({
            runId: '',
            resolveFeatureSpec: async () => null,
            passRun: {
                open: async () => 'run-owned',
                finalize: async (runId, status) => {
                    finalized.push({ runId, status });
                },
            },
        });
        await expect(runFeatureVerification(h.input)).rejects.toThrow(/not found in the configured features/);
        expect(finalized).toEqual([{ runId: 'run-owned', status: 'failed' }]);
    });

    test('an explicit command override is recorded as the effective command', async () => {
        const h = harness({ cmdOverride: 'bun run lint' });
        await runFeatureVerification(h.input);
        const paths = featureReceiptPaths(join(h.workdir, '.spur', 'run'), 'H99', 'run-h99');
        expect((JSON.parse(readFileSync(paths.runScoped, 'utf8')) as { verificationCmd: string }).verificationCmd).toBe(
            'bun run lint',
        );
    });

    test('unsafe feature and run ids are refused before any write', async () => {
        const h = harness();
        await expect(runFeatureVerification({ ...h.input, featureId: '../escape' })).rejects.toThrow(
            /refusing unsafe feature id/,
        );
        await expect(runFeatureVerification({ ...h.input, runId: 'a/b' })).rejects.toThrow(/refusing unsafe run id/);
        expect(existsSync(join(h.workdir, '.spur', 'run', 'run-h99-feature-verification.log'))).toBe(false);
    });

    test('an unresolved feature spec is a hard error, not a silent skip', async () => {
        const h = harness({ resolveFeatureSpec: async () => null });
        await expect(runFeatureVerification(h.input)).rejects.toThrow(/not found in the configured features/);
        // D65 1238 R1: the workflow's verify step is a `command.gate` over this operation, so a pass
        // that cannot RUN must still leave the coarse FAIL its transition guards route on — the old
        // shell appended `|| printf 'FAIL …'` and that responsibility moved here.
        expect(readFileSync(join(h.workdir, '.spur', 'run', 'run-h99-feature-verification.status'), 'utf8')).toBe(
            'FAIL\n',
        );
    });

    test('the app-owned lookup honours the configured features directory', async () => {
        const lookup = await createFeatureLookup(join(import.meta.dir, '..', '..', '..', '..'));
        const spec = await lookup('A91');
        expect(spec?.path.endsWith('.md')).toBe(true);
        expect(spec?.path).toContain('A91_');
        expect(spec?.content).toContain('# A91');
        expect(await lookup('ZZ')).toBeNull();
    });
});

/**
 * Tree-keyed reuse. The pass is one repo-wide command whose inputs are the checked tree (corpus
 * excluded) plus learnings — never the feature id. Closing N features on one tree used to re-run the
 * same ~10 min suite N times, and `sync` from `active` re-ran it again right after `verify`.
 * Ways reuse could go wrong, each pinned below: reusing across a changed tree, reusing a FAIL or a
 * pass still RUNNING, reusing under a different definition or command, reusing for a `--cmd`
 * override, trusting a legacy receipt without a tree digest, and choking on a malformed file.
 */
describe('runFeatureVerification — tree-keyed reuse', () => {
    /** A harness whose tree digest is settable; launches are counted. */
    function reuseHarness(featureId: string, runId: string, workdir?: string) {
        const h = harness({ featureId, runId });
        let tree = 'tree:A';
        let launches = 0;
        if (workdir !== undefined) h.input.workdir = workdir;
        h.input.launch = () => {
            launches += 1;
            return { status: 0 };
        };
        h.input.receipts = {
            ...(h.input.receipts as NonNullable<FeatureVerificationRunInput['receipts']>),
            captureTreeDigest: async () => tree,
        };
        return {
            h,
            setTree: (value: string) => {
                tree = value;
            },
            launches: () => launches,
        };
    }

    function receiptOf(workdir: string, featureId: string, runId: string): Record<string, unknown> {
        return JSON.parse(
            readFileSync(featureReceiptPaths(join(workdir, '.spur', 'run'), featureId, runId).runScoped, 'utf8'),
        ) as Record<string, unknown>;
    }

    test('a second feature on the same tree reuses the PASS without launching', async () => {
        const a = reuseHarness('H99', 'run-a');
        expect((await runFeatureVerification(a.h.input)).status).toBe('PASS');
        expect(a.launches()).toBe(1);
        expect(receiptOf(a.h.workdir, 'H99', 'run-a').treeDigest).toBe('tree:A');

        const b = reuseHarness('H98', 'run-b', a.h.workdir);
        const result = await runFeatureVerification(b.h.input);
        expect(result.status).toBe('PASS');
        expect(result.message).toContain('reused');
        expect(b.launches()).toBe(0);
        const receipt = receiptOf(a.h.workdir, 'H98', 'run-b');
        expect(receipt.status).toBe('PASS');
        expect(receipt.featureId).toBe('H98');
        expect(receipt.reusedFromRunId).toBe('run-a');
        expect(receipt.treeDigest).toBe('tree:A');
        // The receipt still binds this feature's own full digest, which the done gate re-checks.
        expect(receipt.inputDigest).toBe('sha256:before');
        // And it is registered as an artifact of this pass's own run, as the done gate requires.
        expect(b.h.artifacts.map((x) => x.runId)).toEqual(['run-b']);
    });

    test('the same feature re-verified on an unchanged tree (sync after verify) reuses', async () => {
        const a = reuseHarness('H99', 'run-a');
        await runFeatureVerification(a.h.input);
        const again = reuseHarness('H99', 'run-a2', a.h.workdir);
        expect((await runFeatureVerification(again.h.input)).status).toBe('PASS');
        expect(again.launches()).toBe(0);
    });

    test('a changed tree launches the real pass', async () => {
        const a = reuseHarness('H99', 'run-a');
        await runFeatureVerification(a.h.input);
        const b = reuseHarness('H98', 'run-b', a.h.workdir);
        b.setTree('tree:B');
        await runFeatureVerification(b.h.input);
        expect(b.launches()).toBe(1);
        expect(receiptOf(a.h.workdir, 'H98', 'run-b').reusedFromRunId).toBeUndefined();
    });

    test('a prior FAIL is never reused', async () => {
        const a = reuseHarness('H99', 'run-a');
        a.h.input.launch = () => ({ status: 1 });
        expect((await runFeatureVerification(a.h.input)).status).toBe('FAIL');
        const b = reuseHarness('H98', 'run-b', a.h.workdir);
        await runFeatureVerification(b.h.input);
        expect(b.launches()).toBe(1);
    });

    test('a pass still RUNNING is never reused', async () => {
        const a = reuseHarness('H99', 'run-a');
        await startFeatureVerificationReceipt(createNodeFileSystem(), join(a.h.workdir, '.spur', 'run'), {
            featureId: 'H97',
            runId: 'run-running',
            workdir: a.h.workdir,
            verifier: {
                name: 'feature-lifecycle',
                sourcePath: 'x',
                layer: 'shared',
                definitionDigest: 'sha256:definition',
            },
            verificationCmd: 'spur self exec check-feature',
            inputDigest: 'sha256:x',
        });
        await runFeatureVerification(a.h.input);
        expect(a.launches()).toBe(1);
    });

    test('a different verifier definition is never reused', async () => {
        const a = reuseHarness('H99', 'run-a');
        await runFeatureVerification(a.h.input);
        const b = reuseHarness('H98', 'run-b', a.h.workdir);
        const resolve = b.h.input.resolveDefinition as NonNullable<FeatureVerificationRunInput['resolveDefinition']>;
        b.h.input.resolveDefinition = async (...args) => ({ ...(await resolve(...args)), digest: 'sha256:other' });
        await runFeatureVerification(b.h.input);
        expect(b.launches()).toBe(1);
    });

    test('a --cmd override neither reuses nor becomes reusable', async () => {
        const a = reuseHarness('H99', 'run-a');
        await runFeatureVerification(a.h.input);
        const b = reuseHarness('H98', 'run-b', a.h.workdir);
        b.h.input.cmdOverride = 'printf hi';
        await runFeatureVerification(b.h.input);
        expect(b.launches()).toBe(1);
        expect(receiptOf(a.h.workdir, 'H98', 'run-b').treeDigest).toBeUndefined();
    });

    test('legacy receipts without a tree digest and malformed files are ignored', async () => {
        const a = reuseHarness('H99', 'run-a');
        // A real PASS recorded without the tree seam is a legacy-shaped receipt.
        a.h.input.receipts = { ...(a.h.input.receipts as NonNullable<FeatureVerificationRunInput['receipts']>) };
        delete (a.h.input.receipts as { captureTreeDigest?: unknown }).captureTreeDigest;
        await runFeatureVerification(a.h.input);
        expect(receiptOf(a.h.workdir, 'H99', 'run-a').treeDigest).toBeUndefined();
        writeFileSync(join(a.h.workdir, '.spur', 'memory', 'evidence', 'junk-feature-verification.json'), '{not json');
        const b = reuseHarness('H98', 'run-b', a.h.workdir);
        await runFeatureVerification(b.h.input);
        expect(b.launches()).toBe(1);
    });

    test('a tree capture failure falls back to the real pass', async () => {
        const a = reuseHarness('H99', 'run-a');
        await runFeatureVerification(a.h.input);
        const b = reuseHarness('H98', 'run-b', a.h.workdir);
        b.h.input.receipts = {
            ...(b.h.input.receipts as NonNullable<FeatureVerificationRunInput['receipts']>),
            captureTreeDigest: async () => {
                throw new Error('git failed');
            },
        };
        expect((await runFeatureVerification(b.h.input)).status).toBe('PASS');
        expect(b.launches()).toBe(1);
    });

    describe('full-tier quality-gate receipt reuse', () => {
        const TREE = 'a'.repeat(40);
        const sameCheckBuilder = BuilderConfigSchema.parse({
            preset: 'bun',
            actions: { 'check-feature': 'bun run spur-check' },
        });

        function writeGateReceipt(workdir: string, file: string, receipt: Record<string, unknown>): void {
            const runDir = join(workdir, '.spur', 'run');
            mkdirSync(runDir, { recursive: true });
            writeFileSync(join(runDir, file), JSON.stringify(receipt, null, 2));
        }

        test('reuses a tier-full PASS check-receipt on the same git tree when check-feature equals check', async () => {
            const a = reuseHarness('G61', 'run-g61');
            writeGateReceipt(a.h.workdir, '0423-check-receipt.json', {
                schemaVersion: 'check-receipt/v1',
                wbs: '0423',
                runId: 'gate-run-0423',
                tier: 'full',
                inputDigest: TREE,
                checks: [
                    {
                        id: 'full-gate',
                        cmd: 'bun run spur-check',
                        status: 'PASS',
                        durationMs: 1000,
                        logPath: '.spur/run/0423.log',
                    },
                ],
                status: 'PASS',
                completedAt: '2026-11-24T01:02:10Z',
            });
            a.h.input.builder = sameCheckBuilder;
            a.h.input.captureGitTree = () => ({ ok: true, tree: TREE });

            const result = await runFeatureVerification(a.h.input);
            expect(result.status).toBe('PASS');
            expect(result.message).toContain('reused full-tier gate run gate-run-0423');
            expect(a.launches()).toBe(0);
            expect(receiptOf(a.h.workdir, 'G61', 'run-g61').reusedFromRunId).toBe('gate-run-0423');
        });

        test('does not reuse a narrower check receipt when check-feature is a distinct wider command', async () => {
            const a = reuseHarness('G61', 'run-g61');
            writeGateReceipt(a.h.workdir, '0423-check-receipt.json', {
                schemaVersion: 'check-receipt/v1',
                wbs: '0423',
                runId: 'gate-run-0423',
                tier: 'full',
                inputDigest: TREE,
                checks: [
                    {
                        id: 'full-gate',
                        cmd: 'bun run spur-check',
                        status: 'PASS',
                        durationMs: 1000,
                        logPath: '.spur/run/0423.log',
                    },
                ],
                status: 'PASS',
                completedAt: '2026-11-24T01:02:10Z',
            });
            // Default bun preset has check='bun run spur-check' != check-feature='bun run spur-check-feature'.
            a.h.input.builder = BuilderConfigSchema.parse({ preset: 'bun' });
            a.h.input.captureGitTree = () => ({ ok: true, tree: TREE });

            const result = await runFeatureVerification(a.h.input);
            expect(result.status).toBe('PASS');
            expect(a.launches()).toBe(1);
        });

        test('never reuses a light-tier receipt or a receipt from a different git tree', async () => {
            const a = reuseHarness('G61', 'run-g61');
            writeGateReceipt(a.h.workdir, '0423-check-receipt.json', {
                schemaVersion: 'check-receipt/v1',
                wbs: '0423',
                runId: 'light-run-0423',
                tier: 'light',
                inputDigest: TREE,
                checks: [],
                status: 'PASS',
                completedAt: '2026-11-24T01:02:10Z',
            });
            writeGateReceipt(a.h.workdir, '0424-check-receipt.json', {
                schemaVersion: 'check-receipt/v1',
                wbs: '0424',
                runId: 'stale-run-0424',
                tier: 'full',
                inputDigest: 'b'.repeat(40),
                checks: [
                    {
                        id: 'full-gate',
                        cmd: 'bun run spur-check',
                        status: 'PASS',
                        durationMs: 1000,
                        logPath: '.spur/run/0424.log',
                    },
                ],
                status: 'PASS',
                completedAt: '2026-11-24T01:02:10Z',
            });
            a.h.input.builder = sameCheckBuilder;
            a.h.input.captureGitTree = () => ({ ok: true, tree: TREE });

            const result = await runFeatureVerification(a.h.input);
            expect(result.status).toBe('PASS');
            expect(a.launches()).toBe(1);
        });
    });
});
