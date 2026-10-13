/**
 * Unit tests for the consumer-side counterpart of the stale-bundle guard (task 1185, A33).
 *
 * The two callers are failure boundaries (lifecycle denial report, nested-run failure composition),
 * so the classification and the diagnosis text are pinned here first: a failure boundary that
 * silently stops classifying, or starts advising a reinstall, is the defect this guards.
 */

import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import type { WorkflowDef } from '@gobing-ai/ts-dual-workflow-engine';
import {
    consumerBundleSkew,
    definitionConsumerScript,
    MAX_MISSING_EXPORTS,
    nestedWorkflowRunTarget,
    projectConsumerFailure,
    projectConsumerScript,
    staleConsumerDiagnosis,
} from '../../src/workflow/consumer-compat';

const WORKDIR = '/proj';

/** The complaint shape the observed rooted port emits (ts-libs `.spur/scripts/feature-verify.mjs`). */
const PORT_COMPLAINT =
    'feature-verify: Error: module /opt/spur/plugins/sp/lib/inline-run.generated.mjs is missing ' +
    'feature-verification seams (openInlineRunProjectDb, ArtifactDao) — reinstall/upgrade @gobing-ai/spur\n';

const PORT_COMMAND = 'bun .spur/scripts/feature-verify.mjs verify --feature-id "$featureId" --run-id "$__runId"';

describe('consumerBundleSkew', () => {
    test('names the missing exports and the entry the consumer imported', () => {
        const skew = consumerBundleSkew(PORT_COMPLAINT, join(WORKDIR, '.spur/scripts/feature-verify.mjs'));
        expect(skew).not.toBeNull();
        expect(skew?.missing).toEqual(['openInlineRunProjectDb', 'ArtifactDao']);
        expect(skew?.entry).toBe('/opt/spur/plugins/sp/lib/inline-run.generated.mjs');
    });

    test('reads the shipped script wording too (entry/label differ, shape does not)', () => {
        const skew = consumerBundleSkew(
            'feature-verification-steps: application entry /opt/lib/inline-run.generated.mjs is missing ' +
                'feature-verification seams (runFeatureVerification). Fix: run `bun run build:bundle`.',
            '/opt/scripts/steps.mjs',
        );
        expect(skew?.missing).toEqual(['runFeatureVerification']);
    });

    test('a failure without the compat complaint stays unclassified', () => {
        expect(consumerBundleSkew('Command "bun run test" exited with 1', '/proj/.spur/scripts/x.mjs')).toBeNull();
        expect(consumerBundleSkew('module /a/b.mjs is missing seams\n', '/proj/x.mjs')).toBeNull();
    });

    test('bounds how many names one complaint can inject into the report', () => {
        const names = Array.from({ length: MAX_MISSING_EXPORTS + 4 }, (_, i) => `name${String(i)}`).join(', ');
        const skew = consumerBundleSkew(`module /a/b.mjs is missing seams (${names})`, '/proj/.spur/scripts/x.mjs');
        expect(skew?.missing).toHaveLength(MAX_MISSING_EXPORTS);
    });
});

describe('staleConsumerDiagnosis', () => {
    const skew = {
        consumer: '/proj/.spur/scripts/feature-verify.mjs',
        missing: ['openInlineRunProjectDb', 'ArtifactDao'],
        entry: '/opt/spur/plugins/sp/lib/inline-run.generated.mjs',
    };

    test('names the consumer, the exports, the entry and the override, with both remedies', () => {
        const text = staleConsumerDiagnosis(skew, '/proj/.spur/workflows/feature-verification.yaml');
        expect(text).toContain(skew.consumer);
        expect(text).toContain('openInlineRunProjectDb, ArtifactDao');
        expect(text).toContain(skew.entry);
        expect(text).toContain('/proj/.spur/workflows/feature-verification.yaml');
        expect(text).toContain('remove the project-layer override');
        expect(text).toContain('migrate');
    });

    test('never advises reinstalling an already-current entry (R2)', () => {
        for (const text of [staleConsumerDiagnosis(skew), staleConsumerDiagnosis(skew, '/proj/override.yaml')]) {
            // The offered remedies are exactly the two that can work.
            expect(text).toContain('remove the project-layer override');
            expect(text).toContain('migrate');
            // A reinstall is mentioned only to be retired — never as a remedy.
            const reinstallAdvice = text.split('. ').filter((sentence) => /reinstall|upgrade/i.test(sentence));
            expect(reinstallAdvice).toHaveLength(1);
            expect(reinstallAdvice[0]).toContain('does not add these names');
        }
    });
});

describe('projectConsumerScript', () => {
    test('resolves a project-rooted `.spur/` consumer', () => {
        expect(projectConsumerScript(PORT_COMMAND, WORKDIR)).toBe(join(WORKDIR, '.spur/scripts/feature-verify.mjs'));
    });

    test('a plugin-shipped script is not a project consumer (there the 1120 bundle remedy applies)', () => {
        expect(
            projectConsumerScript('bun plugins/sp/scripts/feature-verification-steps.ts verify', WORKDIR),
        ).toBeNull();
        expect(projectConsumerScript(`bun ${join(WORKDIR, 'scripts/verify.mjs')}`, WORKDIR)).toBeNull();
    });

    test('shell variables are never resolved into a path', () => {
        expect(projectConsumerScript('bun $portScript .spur/scripts/x.mjs', WORKDIR)).toBe(
            join(WORKDIR, '.spur/scripts/x.mjs'),
        );
        expect(projectConsumerScript('bun $script', WORKDIR)).toBeNull();
    });
});

describe('nestedWorkflowRunTarget', () => {
    test('reads the nested workflow a lifecycle onEnter invokes', () => {
        expect(
            nestedWorkflowRunTarget(
                'env -u SPUR_WORKFLOW_RUN_ACTIVE $spurBin workflow run feature-verification.yaml --vars "{}"',
            ),
        ).toBe('feature-verification.yaml');
    });

    test('a bare shell command is not a nested workflow run', () => {
        expect(nestedWorkflowRunTarget('$spurBin feature check F1 --as verifying')).toBeNull();
        expect(nestedWorkflowRunTarget('bun run spur-check-feature')).toBeNull();
    });
});

describe('definitionConsumerScript', () => {
    const definition = (command: string): WorkflowDef =>
        ({
            kind: 'state-machine',
            name: 'feature-verification',
            initialState: 'verify',
            states: [{ id: 'verify', onEnter: [{ kind: 'shell', options: { command } }] }],
        }) as unknown as WorkflowDef;

    test('finds the consumer a definition runs, whatever the shell interpolation', () => {
        expect(definitionConsumerScript(definition(PORT_COMMAND), WORKDIR)).toBe(
            join(WORKDIR, '.spur/scripts/feature-verify.mjs'),
        );
    });

    test('a definition with no project-rooted script has no consumer to name', () => {
        expect(
            definitionConsumerScript(definition('bun plugins/sp/scripts/feature-verification-steps.ts'), WORKDIR),
        ).toBeNull();
        expect(definitionConsumerScript({ kind: 'dag', name: 'x' } as unknown as WorkflowDef, WORKDIR)).toBeNull();
    });
});

describe('projectConsumerFailure', () => {
    test('composes the diagnosis for a failed project consumer', () => {
        const text = projectConsumerFailure(PORT_COMMAND, WORKDIR, PORT_COMPLAINT);
        expect(text).toContain(join(WORKDIR, '.spur/scripts/feature-verify.mjs'));
        expect(text).toContain('openInlineRunProjectDb');
        expect(text).toContain('/opt/spur/plugins/sp/lib/inline-run.generated.mjs');
    });

    test('every other failure keeps its previous message', () => {
        expect(projectConsumerFailure(PORT_COMMAND, WORKDIR, 'assertion failed')).toBeNull();
        expect(
            projectConsumerFailure('$spurBin feature check F1 --strict --as done', WORKDIR, PORT_COMPLAINT),
        ).toBeNull();
    });
});
