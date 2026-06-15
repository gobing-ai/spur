import { afterAll, describe, expect, it } from 'bun:test';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempRoot = mkdtempSync(join(tmpdir(), 'anti-hallucination-fixed-wrapper-'));

function createMockAcpxScript(): string {
    const path = join(tempRoot, 'mock-acpx-pass.sh');
    writeFileSync(
        path,
        "#!/bin/sh\nprintf '%s\\n' 'According to the official documentation at https://api.example.com, the method is getUser(id: string): User. **Confidence**: HIGH. Source: https://api.example.com/docs'\n",
        'utf-8',
    );
    chmodSync(path, 0o755);
    return path;
}

function captureStdout<T>(fn: () => T): { result: T; stdout: string } {
    let stdout = '';
    const originalStdoutWrite = process.stdout.write.bind(process.stdout);

    process.stdout.write = ((chunk: string | Uint8Array) => {
        stdout += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
        return true;
    }) as typeof process.stdout.write;

    try {
        return { result: fn(), stdout };
    } finally {
        process.stdout.write = originalStdoutWrite;
    }
}

const mockAcpx = createMockAcpxScript();

describe('fixed agent wrappers', () => {
    it('run_codex_with_validation uses the codex agent', async () => {
        const module = await import('../scripts/run_codex_with_validation');
        expect(module.main).toBeDefined();
        const content = await Bun.file(new URL('../scripts/run_codex_with_validation.ts', import.meta.url)).text();
        expect(content).toContain("agent: 'codex'");

        const { result, stdout } = captureStdout(() => module.main(['--acpx-bin', mockAcpx, 'summarize this repo']));
        expect(result).toBe(0);
        expect(stdout).toContain('According to the official documentation');
    });

    it('run_opencode_with_validation uses the opencode agent', async () => {
        const module = await import('../scripts/run_opencode_with_validation');
        expect(module.main).toBeDefined();
        const content = await Bun.file(new URL('../scripts/run_opencode_with_validation.ts', import.meta.url)).text();
        expect(content).toContain("agent: 'opencode'");

        const { result, stdout } = captureStdout(() => module.main(['--acpx-bin', mockAcpx, 'summarize this repo']));
        expect(result).toBe(0);
        expect(stdout).toContain('According to the official documentation');
    });

    it('run_openclaw_with_validation uses the openclaw agent', async () => {
        const module = await import('../scripts/run_openclaw_with_validation');
        expect(module.main).toBeDefined();
        const content = await Bun.file(new URL('../scripts/run_openclaw_with_validation.ts', import.meta.url)).text();
        expect(content).toContain("agent: 'openclaw'");

        const { result, stdout } = captureStdout(() => module.main(['--acpx-bin', mockAcpx, 'summarize this repo']));
        expect(result).toBe(0);
        expect(stdout).toContain('According to the official documentation');
    });

    it('run_pi_with_validation uses the pi agent', async () => {
        const module = await import('../scripts/run_pi_with_validation');
        expect(module.main).toBeDefined();
        const content = await Bun.file(new URL('../scripts/run_pi_with_validation.ts', import.meta.url)).text();
        expect(content).toContain("agent: 'pi'");

        const { result, stdout } = captureStdout(() => module.main(['--acpx-bin', mockAcpx, 'summarize this repo']));
        expect(result).toBe(0);
        expect(stdout).toContain('According to the official documentation');
    });
});

afterAll(() => {
    rmSync(tempRoot, { recursive: true, force: true });
});
