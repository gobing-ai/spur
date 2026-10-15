/**
 * One-shot capture of the retired scripts' behavior into ../script-absorption-pr5-golden.json.
 * Run from the repo root while plugins/sp/scripts still holds the PR-5 scripts:
 *   bun apps/cli/tests/fixtures/script-absorption-pr5/capture-old.ts
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALL_CASES } from './cases';
import { REPO_ROOT, runCase } from './harness';

const env: Record<string, string | undefined> = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    SPUR_SKIP_GLOBAL_CONFIG: 'true',
    SPUR_SKIP_PROJECT_CONFIG: 'true',
    NO_COLOR: '1',
};
const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).stdout.trim();
const out: Record<string, unknown> = {
    _meta: {
        capturedFrom:
            'plugins/sp/scripts/{wrapup-steps,wrapup-drift-probe,batch-preflight,batch-plan,feature-verification-steps,idea-handoff}.ts',
        commit,
        bun: Bun.version,
        note: 'Old-side outcomes per case (exit code, stdout, stderr, .spur/run + .spur/memory files, nested spur argv). Regenerating requires the retired scripts; see harness.ts.',
    },
};
for (const [group, cases] of Object.entries(ALL_CASES)) {
    const g: Record<string, unknown> = {};
    for (const c of cases) {
        g[c.id] = runCase(c, 'old', env);
        process.stderr.write(`captured ${group}/${c.id}\n`);
    }
    out[group] = g;
}
writeFileSync(join(import.meta.dir, '..', 'script-absorption-pr5-golden.json'), `${JSON.stringify(out, null, 2)}\n`);
