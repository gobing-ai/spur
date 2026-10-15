import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVars } from '@gobing-ai/spur-config';
import { FIXTURE_DIR_TOKEN, type Pr6Case } from './cases';

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
function normalize(text: string, dir: string, token = FIXTURE_DIR_TOKEN): string {
    return text.replaceAll(dir, token);
}

/** The per-run scratch cwd (also HOME) is normalized to this token. */
const SCRATCH_TOKEN = '<SCRATCH>';

/** Run one side of a case in a scratch, non-git cwd with a minimal env. */
export function runSide(
    c: Pr6Case,
    side: 'legacy' | 'cli',
    opts: { pluginRoot?: string; fixtures: string },
): Observation {
    const cwd = mkdtempSync(join(tmpdir(), 'spur-pr6-golden-'));
    try {
        const extra = Object.fromEntries(
            Object.entries(c.env ?? {}).map(([k, v]) => [k, v.replaceAll(FIXTURE_DIR_TOKEN, opts.fixtures)]),
        );
        const env = {
            PATH: getEnvVars().PATH ?? '',
            HOME: cwd,
            TZ: 'UTC',
            GIT_CEILING_DIRECTORIES: tmpdir(),
            ...extra,
        };
        const [script, ...rest] = c.legacy;
        const cmd =
            side === 'legacy'
                ? ['bun', join(opts.pluginRoot ?? '', script ?? ''), ...substitute(rest, opts.fixtures)]
                : ['bun', CLI, ...substitute(c.cli, opts.fixtures), '--no-logo'];
        const res = spawnSync(cmd[0] ?? 'bun', cmd.slice(1), { cwd, env, encoding: 'utf8', timeout: 30_000 });
        const back = c.readBack !== undefined && existsSync(join(cwd, c.readBack));
        const written = back ? `--- ${c.readBack}\n${readFileSync(join(cwd, c.readBack ?? ''), 'utf8')}` : '';
        const clean = (text: string): string => {
            const t = normalize(normalize(text, opts.fixtures), cwd, SCRATCH_TOKEN);
            return c.scrubClock === true ? t.replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/g, '<NOW>') : t;
        };
        return {
            exitCode: res.status ?? -1,
            stdout: clean((res.stdout ?? '') + written),
            stderr: clean(res.stderr ?? ''),
        };
    } finally {
        rmSync(cwd, { recursive: true, force: true });
    }
}
