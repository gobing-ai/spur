import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentRunPreflight, parseRequiresCapabilitiesFlag } from '../../src/services/agent-run-preflight';
import type { AgentServiceContext } from '../../src/services/agent-service';

// The launch checks executeRun runs before anything is spawned or persisted, extracted from the
// AgentService class body. Each refusal is an exit-2 result, never a throw.

let root: string;
let ctx: AgentServiceContext;

beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'spur-agent-preflight-'));
    mkdirSync(join(root, 'work'));
    writeFileSync(join(root, 'a-file.txt'), 'x');
    ctx = { cwd: root, env: {}, output: { write: () => {}, error: () => {} } };
});

afterAll(() => {
    rmSync(root, { recursive: true, force: true });
});

describe('agentRunPreflight', () => {
    test('accepts a plain prompt and returns the validated launch values with defaults', async () => {
        expect(await agentRunPreflight(ctx, 'hello', {})).toEqual({
            ok: true,
            requestMessageIds: [],
            mode: 'text',
            cwd: '',
            timeoutMs: undefined,
            continueFlag: false,
        });
    });

    test('parses request-message ids from either flag spelling, trimming blanks', async () => {
        const camel = await agentRunPreflight(ctx, 'p', { requestMessage: ' m1, ,m2 ' });
        const kebab = await agentRunPreflight(ctx, 'p', { 'request-message': 'm3' });
        expect(camel.ok && camel.requestMessageIds).toEqual(['m1', 'm2']);
        expect(kebab.ok && kebab.requestMessageIds).toEqual(['m3']);
    });

    test('carries --mode json, an existing --cwd directory, a numeric --timeout and --continue', async () => {
        const result = await agentRunPreflight(ctx, undefined, {
            mode: 'json',
            cwd: join(root, 'work'),
            timeout: '1500',
            continue: true,
        });
        expect(result).toEqual({
            ok: true,
            requestMessageIds: [],
            mode: 'json',
            cwd: join(root, 'work'),
            timeoutMs: 1500,
            continueFlag: true,
        });
    });

    test.each([
        [{ mode: 'yaml' }, 'Invalid mode: yaml (must be text or json)'],
        [{ cwd: '/nonexistent/spur-preflight-dir' }, 'Invalid --cwd: /nonexistent/spur-preflight-dir does not exist'],
        [{ timeout: 'soon' }, 'Invalid --timeout=soon: must be a number'],
    ] as const)('refuses %p with exit 2', async (flags, message) => {
        expect(await agentRunPreflight(ctx, 'p', { ...flags })).toEqual({ ok: false, exitCode: 2, message });
    });

    test('refuses a --cwd that names a file, not a directory', async () => {
        const file = join(root, 'a-file.txt');
        expect(await agentRunPreflight(ctx, 'p', { cwd: file })).toEqual({
            ok: false,
            exitCode: 2,
            message: `Invalid --cwd: ${file} is not a directory`,
        });
    });

    test('requires a prompt unless --continue is set', async () => {
        expect(await agentRunPreflight(ctx, undefined, {})).toEqual({
            ok: false,
            exitCode: 2,
            message: 'Prompt is required',
        });
    });

    test('a --spec-id launch without a fleet config skips the fleet guard', async () => {
        const result = await agentRunPreflight(ctx, 'p', { 'spec-id': 'member-1' });
        expect(result.ok).toBe(true);
    });
});

describe('parseRequiresCapabilitiesFlag', () => {
    test('no flag means no requirements', () => {
        expect(parseRequiresCapabilitiesFlag({})).toEqual({ ok: true, requiresCapabilities: undefined });
    });

    test('parses a valid requirement map from either flag spelling', () => {
        const camel = parseRequiresCapabilitiesFlag({ requiresCapabilities: '{"fsWrite":"enforced"}' });
        const kebab = parseRequiresCapabilitiesFlag({ 'requires-capabilities': '{"fsRead":"available"}' });
        expect(camel).toEqual({ ok: true, requiresCapabilities: { fsWrite: 'enforced' } });
        expect(kebab).toEqual({ ok: true, requiresCapabilities: { fsRead: 'available' } });
    });

    test('fails closed on malformed JSON or an invalid shape', () => {
        const badJson = parseRequiresCapabilitiesFlag({ requiresCapabilities: '{not json' });
        expect(badJson.ok).toBe(false);
        expect(!badJson.ok && badJson.exitCode).toBe(2);
        expect(!badJson.ok && badJson.message).toStartWith('agent.run: invalid requiresCapabilities JSON — ');

        const badShape = parseRequiresCapabilitiesFlag({ requiresCapabilities: '{"fsWrite":"sometimes"}' });
        expect(badShape.ok).toBe(false);
        expect(!badShape.ok && badShape.message).toContain('invalid requiresCapabilities');
    });
});
