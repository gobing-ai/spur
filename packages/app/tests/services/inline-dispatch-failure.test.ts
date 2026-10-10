/**
 * Task 1134 R1–R4 — inline dispatch fail-fast.
 *
 * The classification half is the upstream classifier's (`classifyQuotaErrorRecord`); these
 * cases pin that Spur adds no provider vocabulary of its own (AC3) and that the branch is
 * capacity vs capability (AC1/AC2). The runner half is exercised end to end against a
 * temporary project: the recorded observation must reach `agent_executor_updates` and the
 * project YAML, so the NEXT dispatch skips the rung with no provider call (AC5).
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeEnvVar, setEnvVar } from '@gobing-ai/spur-config';
import { loadSpurConfig } from '@gobing-ai/spur-config/loader';
import { parse as parseYaml } from 'yaml';
import {
    classifyDispatchFailure,
    countUnattributedInlineStages,
    inlineRunAttributionPath,
    inlineRunDispatchFallbackPath,
    recordInlineRunAttribution,
    runInlineRunDispatchFailure,
} from '../../src/services/inline-run-setup';

const INCIDENT =
    '429 {"code":"1310","message":"Weekly/Monthly Limit Exhausted. Your limit will reset at 2026-10-13 01:47:29"}';
const RUN_ID = 'run-1134-test';

let root: string;
// runInlineRunDispatchFailure reports its JSON outcome on stdout; keep it out of the test reporter.
let outSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
    outSpy = spyOn(process.stdout, 'write').mockImplementation(() => true);
    root = mkdtempSync(join(tmpdir(), 'inline-dispatch-failure-'));
    mkdirSync(join(root, '.spur', 'run'), { recursive: true });
    mkdirSync(join(root, '.spur', 'memory', 'runs'), { recursive: true });
    writeFileSync(
        join(root, '.spur', 'config.yaml'),
        ['agent:', '  executors:', '    - name: zai-glm', '      agent: omp', '      model: gpt-5', ''].join('\n'),
    );
    setEnvVar('SPUR_SKIP_GLOBAL_CONFIG', 'true');
});

afterEach(() => {
    outSpy.mockRestore();
    removeEnvVar('SPUR_SKIP_GLOBAL_CONFIG');
    rmSync(root, { recursive: true, force: true });
});

describe('classifyDispatchFailure (1134 R1/R2/AC3)', () => {
    test('the incident record is capacity exhaustion via the upstream classifier', () => {
        expect(classifyDispatchFailure(INCIDENT)).toEqual({
            class: 'capacity',
            reason: 'usage_limit_reached',
            resetAt: '2026-10-13T01:47:29.000Z',
        });
    });

    test('rate limit, overload, auth, timeout and prose stay capability-shaped', () => {
        const negatives: Record<string, string> = {
            'generic 429': '429 Too Many Requests',
            'rate limit': '{"error":{"type":"rate_limit_error","code":"429"}}',
            overload: '{"error":{"type":"overloaded_error","message":"Overloaded"}}',
            auth: '{"error":{"type":"authentication_error","message":"invalid x-api-key"}}',
            timeout: '{"error":{"type":"timeout_error"}}',
            'free text': 'the transcript said quota exhausted but the run succeeded',
            'unverified provider code': '{"code":"1302","message":"rate limit reached"}',
        };
        for (const [name, record] of Object.entries(negatives)) {
            expect({ name, ...classifyDispatchFailure(record) }).toEqual({ name, class: 'capability' });
        }
    });

    test('a prompt echo of the incident record never confirms', () => {
        const record = JSON.stringify({
            error: { type: 'invalid_request_error', message: `your prompt contained ${INCIDENT}` },
        });
        expect(classifyDispatchFailure(record)).toEqual({ class: 'capability' });
    });

    test('a confirmed capacity record without a timestamp reports no resetAt', () => {
        expect(classifyDispatchFailure('{"code":"1310","message":"Weekly limit exhausted"}')).toEqual({
            class: 'capacity',
            reason: 'usage_limit_reached',
        });
    });
});

describe('inline stage attribution (1134 R3/AC4)', () => {
    test('records the executor identity, and an explicit marker when none resolves', () => {
        recordInlineRunAttribution(root, RUN_ID, {
            stage: 'implement',
            executor: 'zai-glm',
            agent: 'omp',
            model: 'gpt-5',
            observedAt: '2026-10-09T20:00:00.000Z',
        });
        recordInlineRunAttribution(root, RUN_ID, {
            stage: 'review',
            executor: null,
            agent: null,
            observedAt: '2026-10-09T20:01:00.000Z',
        });
        const ledger = readFileSync(inlineRunAttributionPath(root, RUN_ID), 'utf8').trim().split('\n');
        expect(ledger).toHaveLength(2);
        expect(JSON.parse(ledger[0] as string)).toMatchObject({ stage: 'implement', executor: 'zai-glm' });
        expect(JSON.parse(ledger[1] as string)).toMatchObject({ stage: 'review', executor: null });
        // R6: the count the doctor surfaces — one stage fail-fast could not have disabled later.
        expect(countUnattributedInlineStages(root)).toBe(1);
    });

    test('a project with no ledger reports zero', () => {
        expect(countUnattributedInlineStages(root)).toBe(0);
    });
});

describe('runInlineRunDispatchFailure (1134 R2/R4/AC5)', () => {
    test('an attributed capacity exhaustion reaches the durable path and disables the rung', async () => {
        const spurConfig = await loadSpurConfig(root);
        const exit = await runInlineRunDispatchFailure({
            runId: RUN_ID,
            stage: 'implement',
            decision: 'stop',
            text: INCIDENT,
            executor: 'zai-glm',
            agent: 'omp',
            model: 'gpt-5',
            workdir: root,
            spurConfig,
        });
        expect(exit).toBe(0);

        const artifactPath = inlineRunDispatchFallbackPath(root, RUN_ID);
        expect(existsSync(artifactPath)).toBe(true);
        const artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as Record<string, unknown>;
        expect(artifact).toMatchObject({
            stage: 'implement',
            class: 'capacity',
            reason: 'usage_limit_reached',
            resetAt: '2026-10-13T01:47:29.000Z',
            decision: 'stop',
            executor: 'zai-glm',
            attribution: 'recorded',
            recorded: 'recorded',
            applied: 1,
        });
        expect(typeof artifact.observationId).toBe('string');

        // AC5: the rung is now recorded disabled with owner quota, so the next automatic
        // selection skips it without contacting any provider.
        const parsed = parseYaml(readFileSync(join(root, '.spur', 'config.yaml'), 'utf8')) as {
            agent: { executors: Array<{ name: string; disabled: unknown }> };
        };
        expect(parsed.agent.executors[0]?.disabled).toMatchObject({ owner: 'quota', reason: expect.any(String) });
    });

    test('an unattributed capacity exhaustion is an observable no-op, never a silent drop', async () => {
        const exit = await runInlineRunDispatchFailure({
            runId: RUN_ID,
            stage: 'implement',
            decision: 'escalate',
            text: INCIDENT,
            executor: null,
            agent: null,
            workdir: root,
            spurConfig: await loadSpurConfig(root),
        });
        expect(exit).toBe(0);
        const artifact = JSON.parse(readFileSync(inlineRunDispatchFallbackPath(root, RUN_ID), 'utf8')) as Record<
            string,
            unknown
        >;
        expect(artifact).toMatchObject({ class: 'capacity', decision: 'escalate', executor: null });
        expect(artifact.attribution).toBe('no-attribution');
        expect(artifact.observationId).toBeUndefined();
    });

    test('a capability-shaped failure is recorded without touching availability', async () => {
        const exit = await runInlineRunDispatchFailure({
            runId: RUN_ID,
            stage: 'implement',
            decision: 'host-inline',
            text: '{"error":{"type":"authentication_error"}}',
            executor: 'zai-glm',
            agent: 'omp',
            workdir: root,
            spurConfig: await loadSpurConfig(root),
        });
        expect(exit).toBe(0);
        const artifact = JSON.parse(readFileSync(inlineRunDispatchFallbackPath(root, RUN_ID), 'utf8')) as Record<
            string,
            unknown
        >;
        expect(artifact).toMatchObject({ class: 'capability', decision: 'host-inline' });
        const parsed = parseYaml(readFileSync(join(root, '.spur', 'config.yaml'), 'utf8')) as {
            agent: { executors: Array<{ disabled?: unknown }> };
        };
        expect(parsed.agent.executors[0]?.disabled).toBeUndefined();
    });

    test('an unknown executor is a classified rejection, not a crash', async () => {
        const exit = await runInlineRunDispatchFailure({
            runId: RUN_ID,
            stage: 'implement',
            decision: 'stop',
            textFile: (() => {
                const path = join(root, 'dispatch-error.txt');
                writeFileSync(path, INCIDENT);
                return path;
            })(),
            executor: 'not-configured',
            agent: 'omp',
            workdir: root,
            spurConfig: await loadSpurConfig(root),
        });
        expect(exit).toBe(0);
        const artifact = JSON.parse(readFileSync(inlineRunDispatchFallbackPath(root, RUN_ID), 'utf8')) as Record<
            string,
            unknown
        >;
        expect(artifact.class).toBe('capacity');
        expect(String(artifact.recorded)).toContain('rejected: unknown executor');
    });
});
