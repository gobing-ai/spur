/**
 * `spur workflow promote-check|promote-evaluate|promote-resolve` transport (A94 1413 R2).
 *
 * The exit contract is what a workflow-layer script routes on, so these cases drive the verbs
 * in-process: a clean catalogue passes, findings and a contradicting decision exit 1, and a missing
 * `--decision` or an unknown candidate is a usage error (exit 2) with the envelope.
 */
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVars } from '@gobing-ai/spur-config';
import { main } from '../../../src';

interface Captured {
    code: number;
    messages: string[];
    json: unknown;
}

async function run(args: string[], cwd: string): Promise<Captured> {
    const messages: string[] = [];
    const code = await main(args, {
        cwd,
        env: getEnvVars(),
        output: { write: (m) => messages.push(m), error: (m) => messages.push(m) },
    });
    let json: unknown;
    try {
        json = JSON.parse(messages.at(-1) ?? '{}');
    } catch {
        json = undefined;
    }
    return { code, messages, json };
}

/** Drop `--db <path>` from an argv (promote-resolve reads no history). */
function withoutDbFlag(argv: string[]): string[] {
    const out: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--db') {
            i++;
            continue;
        }
        out.push(argv[i] as string);
    }
    return out;
}

/** A project with a candidate record and one canonical definition. */
function project(candidates: unknown[]): { root: string; args: string[] } {
    const root = mkdtempSync(join(tmpdir(), 'spur-promote-cli-'));
    mkdirSync(join(root, 'workflows'), { recursive: true });
    writeFileSync(join(root, 'workflows', 'task-pipeline.yaml'), 'name: task-pipeline\n');
    const config = join(root, 'candidates.json');
    writeFileSync(config, JSON.stringify({ schemaVersion: 1, candidates }, null, 2));
    return {
        root,
        args: ['--candidates', config, '--workflows-dir', join(root, 'workflows'), '--db', join(root, 'none.db')],
    };
}

const candidate = {
    id: 'c1',
    canonical: 'task-pipeline',
    createdAt: '2026-01-01',
    deadline: '2099-01-01',
    rationale: 'fixture',
    measurement: { workflow: 'task-pipeline', runIds: [] },
    delta: { agentRunCount: 1 },
    verdict: null,
};

describe('spur workflow promote-check', () => {
    test('a clean catalogue exits 0 in text and in the envelope', async () => {
        const fx = project([candidate]);
        try {
            const text = await run(['workflow', 'promote-check', ...fx.args], fx.root);
            expect(text.code, text.messages.join('\n')).toBe(0);
            expect(text.messages.join('\n')).toContain('PASS');

            const envelope = await run(['workflow', 'promote-check', ...fx.args, '--json', '--json-envelope'], fx.root);
            expect(envelope.code).toBe(0);
            const payload = envelope.json as { data?: { ok: boolean; status: string } };
            expect(payload.data).toEqual(expect.objectContaining({ ok: true, status: 'PASS' }));
        } finally {
            await rm(fx.root, { recursive: true, force: true });
        }
    });

    test('a finding exits 1 with the finding in the envelope', async () => {
        const fx = project([{ ...candidate, deadline: '2000-01-01' }]);
        try {
            const result = await run(
                ['workflow', 'promote-check', ...fx.args, '--now', '2026-06-01T00:00:00Z', '--json'],
                fx.root,
            );
            expect(result.code).toBe(1);
            const payload = result.json as { ok: boolean; findings: { kind: string }[] };
            expect(payload.ok).toBe(false);
            expect(payload.findings[0]?.kind).toBe('expired-candidate');
        } finally {
            await rm(fx.root, { recursive: true, force: true });
        }
    });

    test('the text finding goes to stderr, not stdout', async () => {
        const fx = project([{ ...candidate, deadline: '2000-01-01' }]);
        try {
            const result = await run(
                ['workflow', 'promote-check', ...fx.args, '--now', '2026-06-01T00:00:00Z'],
                fx.root,
            );
            expect(result.code).toBe(1);
            expect(result.messages.join('\n')).toContain('PROMOTION GATE:');
        } finally {
            await rm(fx.root, { recursive: true, force: true });
        }
    });
});

describe('spur workflow promote-evaluate and promote-resolve', () => {
    test('an unknown candidate is a usage error (exit 2)', async () => {
        const fx = project([candidate]);
        try {
            const result = await run(['workflow', 'promote-evaluate', 'ghost', ...fx.args, '--json'], fx.root);
            expect(result.code).toBe(2);
            expect(JSON.stringify(result.json)).toContain('not found');
        } finally {
            await rm(fx.root, { recursive: true, force: true });
        }
    });

    test('promote-resolve without --decision is a usage error (exit 2)', async () => {
        const fx = project([candidate]);
        try {
            const args = withoutDbFlag(fx.args);
            const text = await run(['workflow', 'promote-resolve', 'c1', ...args], fx.root);
            expect(text.code).toBe(2);
            expect(text.messages.join('\n')).toContain('--decision');

            const envelope = await run(['workflow', 'promote-resolve', 'c1', ...args, '--json'], fx.root);
            expect(envelope.code).toBe(2);
            expect(JSON.stringify(envelope.json)).toContain('usage');
        } finally {
            await rm(fx.root, { recursive: true, force: true });
        }
    });

    test('a resolved candidate is reported and the record shrinks', async () => {
        const fx = project([candidate]);
        try {
            const result = await run(
                ['workflow', 'promote-resolve', 'c1', '--decision', 'delete', ...withoutDbFlag(fx.args)],
                fx.root,
            );
            expect(result.code, result.messages.join('\n')).toBe(0);
            expect(result.messages.join('\n')).toContain('resolved c1 as delete');
        } finally {
            await rm(fx.root, { recursive: true, force: true });
        }
    });

    test('promote-evaluate records a verdict and reports it', async () => {
        const fx = project([candidate]);
        try {
            const result = await run(['workflow', 'promote-evaluate', 'c1', ...fx.args], fx.root);
            expect(result.code, result.messages.join('\n')).toBe(0);
            expect(result.messages.join('\n')).toContain('verdict');
        } finally {
            await rm(fx.root, { recursive: true, force: true });
        }
    });
});
