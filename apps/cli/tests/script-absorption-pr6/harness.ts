import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVars } from '@gobing-ai/spur-config';
import { runMain } from '../helpers';
import { FIXTURE_DIR_TOKEN, type Pr6Case } from './cases';

export interface Observation {
    exitCode: number;
    stdout: string;
    stderr: string;
}

function substitute(argv: readonly string[], fixtures: string): string[] {
    return argv.map((a) => a.replaceAll(FIXTURE_DIR_TOKEN, fixtures));
}

/** Normalize the fixtures dir back to the token so a capture and a live run compare. */
function normalize(text: string, dir: string, token = FIXTURE_DIR_TOKEN): string {
    return text.replaceAll(dir, token);
}

/** The per-run scratch cwd (also HOME) is normalized to this token. */
const SCRATCH_TOKEN = '<SCRATCH>';

/** Run one case's CLI side in a scratch, non-git cwd with a minimal env. */
export async function runSide(c: Pr6Case, opts: { fixtures: string }): Promise<Observation> {
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
        const clean = (text: string): string => {
            const t = normalize(normalize(text, opts.fixtures), cwd, SCRATCH_TOKEN);
            return c.scrubClock === true ? t.replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/g, '<NOW>') : t;
        };
        // In process (1475 R2): the case asserts only the CLI's own output and exit code, and each
        // spawn paid a `bun` boot for a few milliseconds of work. The retired-script side this used to
        // drive is gone with the scripts; the golden fixture (`fixtures/script-absorption-pr6-golden.json`)
        // and its `source` note remain the provenance.
        const ran = await runMain([...substitute(c.cli, opts.fixtures), '--no-logo'], cwd, env, { replaceEnv: true });
        const readBack =
            c.readBack !== undefined && existsSync(join(cwd, c.readBack))
                ? `--- ${c.readBack}\n${readFileSync(join(cwd, c.readBack), 'utf8')}`
                : '';
        return {
            exitCode: ran.code ?? -1,
            stdout: clean(ran.stdout + readBack),
            stderr: clean(ran.stderr),
        };
    } finally {
        rmSync(cwd, { recursive: true, force: true });
    }
}
