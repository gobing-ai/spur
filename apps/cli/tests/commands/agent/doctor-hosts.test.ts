/**
 * `spur agent doctor-hosts` transport (A94 1414 R1): exit contract, envelope and report target.
 *
 * 0/1 for a probed/failed report, 2 for an unknown `--agents` entry. The probe itself never launches
 * a host; its contract lives in `packages/app/tests/agent/host-probe.test.ts`.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVars } from '@gobing-ai/spur-config';
import { main } from '../../../src';

async function run(args: string[], cwd: string): Promise<{ code: number; messages: string[]; json: unknown }> {
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

describe('spur agent doctor-hosts', () => {
    test('an unknown --agents entry exits 2 and names the known set', async () => {
        const cwd = mkdtempSync(join(tmpdir(), 'spur-doctor-hosts-'));
        try {
            const text = await run(['agent', 'doctor-hosts', '--agents', 'wizard'], cwd);
            expect(text.code).toBe(2);
            expect(text.messages.join('\n')).toContain('unknown agents: wizard (known: codex, claude, pi)');

            const json = await run(['agent', 'doctor-hosts', '--agents', 'wizard', '--json'], cwd);
            expect(json.code).toBe(2);
            expect(JSON.stringify(json.json)).toContain('wizard');
        } finally {
            await rm(cwd, { recursive: true, force: true });
        }
    });

    test('a probe writes the report and answers with the rows', async () => {
        const cwd = mkdtempSync(join(tmpdir(), 'spur-doctor-hosts-ok-'));
        try {
            const report = join(cwd, 'capabilities.json');
            const text = await run(['agent', 'doctor-hosts', '--out', report], cwd);
            const output = text.messages.join('\n');
            expect(text.code, output).toBe(0);
            expect(existsSync(report)).toBe(true);
            expect(output).toContain('host-probe:');

            const envelope = await run(['agent', 'doctor-hosts', '--out', report, '--json', '--json-envelope'], cwd);
            expect(envelope.code).toBe(0);
            const payload = envelope.json as { data?: { ok: boolean; hosts: unknown[] } };
            expect(payload.data?.ok).toBe(true);
            expect(payload.data?.hosts).toHaveLength(6);

            const raw = JSON.parse(readFileSync(report, 'utf8')) as { hosts: Array<{ e2e?: unknown }> };
            for (const row of raw.hosts) expect(row.e2e).toBeUndefined();
        } finally {
            await rm(cwd, { recursive: true, force: true });
        }
    }, 30_000);

    test('a probe failure is reported through the JSON error path', async () => {
        const cwd = mkdtempSync(join(tmpdir(), 'spur-doctor-hosts-fail-'));
        try {
            // An unwritable report target (a directory where the file should be) makes the write fail.
            const report = join(cwd, 'blocked.json');
            mkdirSync(report, { recursive: true });
            const json = await run(['agent', 'doctor-hosts', '--out', report, '--json'], cwd);
            expect(json.code).toBe(1);
            expect(JSON.stringify(json.json)).toContain('host-probe');

            const text = await run(['agent', 'doctor-hosts', '--out', report], cwd);
            expect(text.code).toBe(1);
            expect(text.messages.join('\n')).toContain('doctor-hosts:');
        } finally {
            await rm(cwd, { recursive: true, force: true });
        }
    }, 30_000);

    test('the verb advertises the documented flags', async () => {
        const cwd = mkdtempSync(join(tmpdir(), 'spur-doctor-hosts-help-'));
        try {
            const result = await run(['agent', 'doctor-hosts', '--help'], cwd);
            const help = result.messages.join('\n');
            expect(result.code).toBe(0);
            for (const flag of ['--agents', '--out', '--json']) expect(help).toContain(flag);
        } finally {
            await rm(cwd, { recursive: true, force: true });
        }
    });
});
