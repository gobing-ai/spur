import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVars } from '@gobing-ai/spur-config';
import { runMain } from '../helpers';
import { FIXTURE_DIR_TOKEN, type Pr7Case } from './cases';

export interface Observation {
    exitCode: number;
    stdout: string;
    stderr: string;
}

function substitute(argv: readonly string[], fixtures: string): string[] {
    return argv.map((a) => a.replaceAll(FIXTURE_DIR_TOKEN, fixtures));
}

/** Normalize the fixtures dir back to the token so a capture and a live run compare. */
function normalize(text: string, fixtures: string): string {
    return text.replaceAll(fixtures, FIXTURE_DIR_TOKEN);
}

/** Run one case's CLI side in a scratch, non-git cwd with a minimal env. */
export async function runSide(c: Pr7Case, opts: { fixtures: string }): Promise<Observation> {
    const cwd = mkdtempSync(join(tmpdir(), 'spur-pr7-golden-'));
    try {
        const env = { PATH: getEnvVars().PATH ?? '', HOME: cwd, GIT_CEILING_DIRECTORIES: tmpdir() };
        // In process (1475 R2): the case asserts only the CLI's own output and exit code, and each
        // spawn paid a `bun` boot for a few milliseconds of work. The retired-script side this used to
        // drive is gone with the scripts; the golden fixture (`fixtures/script-absorption-pr7-golden.json`)
        // and its `source` note remain the provenance.
        const ran = await runMain([...substitute(c.cli, opts.fixtures), '--no-logo'], cwd, env, { replaceEnv: true });
        return {
            exitCode: ran.code ?? -1,
            stdout: normalize(ran.stdout, opts.fixtures),
            stderr: normalize(ran.stderr, opts.fixtures),
        };
    } finally {
        rmSync(cwd, { recursive: true, force: true });
    }
}
