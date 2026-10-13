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
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunDao } from '@gobing-ai/spur-domain';
import { openInlineRunProjectDb } from '../../src/services/inline-run-setup';
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
                path: join(workdir, 'feature-verification.yaml'),
                layer: 'shared' as never,
                digest: 'sha256:definition',
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
        // The selected definition is recorded, not re-derived at completion time.
        expect(receipt.verifier.definitionDigest).toBe('sha256:definition');
        expect(receipt.verificationCmd).toBe('bun run spur-check-feature');
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

    test('an explicit command override is recorded as the effective command', async () => {
        const h = harness({ cmdOverride: 'bun run lint' });
        await runFeatureVerification(h.input);
        const paths = featureReceiptPaths(join(h.workdir, '.spur', 'run'), 'H99', 'run-h99');
        expect((JSON.parse(readFileSync(paths.runScoped, 'utf8')) as { verificationCmd: string }).verificationCmd).toBe(
            'bun run lint',
        );
    });

    test('a clean default pass derives HIGH with its measured basis on the receipt', async () => {
        const h = harness();
        const result = await runFeatureVerification(h.input);
        expect(result.status).toBe('PASS');
        expect(result.confidence).toBe('HIGH');
        expect(result.confidenceBasis).toContain('verification command exited 0');
        expect(result.confidenceBasis).toContain('proof-input digest unchanged across the pass');
        const paths = featureReceiptPaths(join(h.workdir, '.spur', 'run'), 'H99', 'run-h99');
        const receipt = JSON.parse(readFileSync(paths.runScoped, 'utf8')) as {
            confidence: string;
            confidenceBasis: string[];
        };
        expect(receipt.confidence).toBe('HIGH');
        expect(receipt.confidenceBasis).toEqual(result.confidenceBasis);
    });

    test('a clean pass under a command override derives MEDIUM and names the override', async () => {
        const h = harness({ cmdOverride: 'bun run other' });
        const result = await runFeatureVerification(h.input);
        expect(result.status).toBe('PASS');
        expect(result.confidence).toBe('MEDIUM');
        expect(result.confidenceBasis).toContain('caller command override: bun run other');
        expect(result.confidenceBasis).toContain('the selected definition declares: bun run spur-check-feature');
    });

    test('an operator-declared level is recorded first, over the derived one', async () => {
        const h = harness({ cmdOverride: 'bun run other', confidenceOverride: 'HIGH' });
        const result = await runFeatureVerification(h.input);
        expect(result.confidence).toBe('HIGH');
        expect(result.confidenceBasis[0]).toBe('operator-declared HIGH');
    });

    test('an unknown operator-declared level is refused before any write', async () => {
        const h = harness({ confidenceOverride: 'SURE' });
        await expect(runFeatureVerification(h.input)).rejects.toThrow(/confidence must be HIGH, MEDIUM or LOW/);
    });

    test('a non-zero exit derives LOW', async () => {
        const h = harness({}, 2);
        const result = await runFeatureVerification(h.input);
        expect(result.status).toBe('FAIL');
        expect(result.confidence).toBe('LOW');
        expect(result.confidenceBasis).toContain('verification command did not exit 0');
    });

    test('the operator acknowledgement of a LOW level is recorded on the receipt', async () => {
        const h = harness({ confidenceOverride: 'LOW', ackLowConfidence: true });
        const result = await runFeatureVerification(h.input);
        expect(result.status).toBe('PASS');
        expect(result.confidence).toBe('LOW');
        const paths = featureReceiptPaths(join(h.workdir, '.spur', 'run'), 'H99', 'run-h99');
        const receipt = JSON.parse(readFileSync(paths.runScoped, 'utf8')) as { confidenceAcknowledged?: boolean };
        expect(receipt.confidenceAcknowledged).toBe(true);
    });
});

describe('runFeatureVerification — refusals and lookup (task 1176 R2)', () => {
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
