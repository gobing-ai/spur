import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVars } from '@gobing-ai/spur-config';
import { FIXTURE_DIR_TOKEN, type Pr7Case } from './cases';

export interface Observation {
    exitCode: number;
    stdout: string;
    stderr: string;
}

const CLI = join(import.meta.dir, '..', '..', 'src', 'index.ts');

function substitute(argv: readonly string[], fixtures: string): string[] {
    return argv.map((a) => a.replaceAll(FIXTURE_DIR_TOKEN, fixtures));
}

/** Normalize the fixtures dir back to the token so legacy and CLI runs compare. */
function normalize(text: string, fixtures: string): string {
    return text.replaceAll(fixtures, FIXTURE_DIR_TOKEN);
}

/** Run one side of a case in a scratch, non-git cwd with a minimal env. */
export function runSide(
    c: Pr7Case,
    side: 'legacy' | 'cli',
    opts: { pluginRoot?: string; fixtures: string },
): Observation {
    const cwd = mkdtempSync(join(tmpdir(), 'spur-pr7-golden-'));
    try {
        const env = { PATH: getEnvVars().PATH ?? '', HOME: cwd, GIT_CEILING_DIRECTORIES: tmpdir() };
        const [script, ...rest] = c.legacy;
        const cmd =
            side === 'legacy'
                ? ['bun', join(opts.pluginRoot ?? '', script ?? ''), ...substitute(rest, opts.fixtures)]
                : ['bun', CLI, ...substitute(c.cli, opts.fixtures), '--no-logo'];
        const res = spawnSync(cmd[0] ?? 'bun', cmd.slice(1), { cwd, env, encoding: 'utf8', timeout: 30_000 });
        return {
            exitCode: res.status ?? -1,
            stdout: normalize(res.stdout ?? '', opts.fixtures),
            stderr: normalize(res.stderr ?? '', opts.fixtures),
        };
    } finally {
        rmSync(cwd, { recursive: true, force: true });
    }
}
