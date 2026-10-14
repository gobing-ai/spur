/**
 * 1197 R3/AC3 — the Bun re-entry contract for every inline-bundle consumer.
 *
 * The `feature-verification` workflow (and the inline-run workflow) launches the `.mjs`
 * twins with plain `node` in installed mode, while the generated inline bundle keeps `bun:sqlite`
 * external by design (`scripts/commands/bundle-plugin-lib.ts`). Every plugin script that loads that
 * bundle must therefore re-enter Bun in `main()` when `process.versions.bun` is unset — otherwise it
 * ships a Node-unloadable twin (`ERR_UNSUPPORTED_ESM_URL_SCHEME`). `feature-verification-steps.ts`
 * was the outlier; this static scan pins the pattern so a new consumer cannot repeat the mistake.
 *
 * Detection is by the load markers R3 names (`inline-run.generated` or `loadInlineApp`); a consumer
 * missing the re-entry fails here by name, and the two-sided twin check extends the pin to the
 * generated `.mjs` the workflow actually executes (the converter normalizes quotes, so the re-entry
 * is matched by pattern, not by literal source text).
 */

import { expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SCRIPTS_DIR = join(import.meta.dir, '..', 'scripts');

/** Marks a script that loads the generated inline bundle (R3). */
const BUNDLE_MARKERS = ['inline-run.generated', 'loadInlineApp'] as const;
/** The re-entry must both branch on Bun's absence and re-exec Bun on the twin's own URL. */
const REENTRY_PATTERNS: readonly RegExp[] = [/process\.versions\.bun/, /spawnSync\(\s*["']bun["']/];

function listTsScripts(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) out.push(...listTsScripts(full));
        else if (entry.endsWith('.ts')) out.push(full);
    }
    return out.sort();
}

const CONSUMERS = listTsScripts(SCRIPTS_DIR).filter((file) => {
    const text = readFileSync(file, 'utf8');
    return BUNDLE_MARKERS.some((marker) => text.includes(marker));
});

test('1197 R3/AC3: every inline-bundle consumer re-enters Bun in its Node twin', () => {
    const rel = CONSUMERS.map((file) => file.slice(SCRIPTS_DIR.length + 1));
    // The four known consumers, feature-verification-steps.ts included (the 1176 arrival).
    for (const expected of [
        'feature-verification-steps.ts',
        'inline-run-setup.ts',
        'inline-run-dispatch.ts',
        'daily-summary/daily-summary.ts',
    ]) {
        expect(rel, `${expected} loads the inline bundle and must be scanned`).toContain(expected);
    }
    for (const file of CONSUMERS) {
        const name = file.slice(SCRIPTS_DIR.length + 1);
        const twinName = name.replace(/\.ts$/, '.mjs');
        // Both the source and the generated twin the workflow executes must carry the re-entry.
        for (const [label, text] of [
            [name, readFileSync(file, 'utf8')],
            [twinName, readFileSync(file.replace(/\.ts$/, '.mjs'), 'utf8')],
        ] as const) {
            for (const pattern of REENTRY_PATTERNS) {
                expect(pattern.test(text), `${label} must contain the Bun re-entry (${pattern})`).toBe(true);
            }
        }
    }
});
