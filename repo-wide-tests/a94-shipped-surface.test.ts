/**
 * A94 shipped surface (task 1415 R1).
 *
 * Retention has a downstream test: a shipped preset, skill or reference must not send a downstream
 * agent to a repository-only command. The scan covers the shipped tree (`config/**` + `plugins/sp/**`,
 * minus what `bundle-plugins` prunes) and fails on:
 *   (a) an executable `bun [run] [../]*scripts/…` or `bun run <repo alias>` that is not allowlisted —
 *       an allowlisted file must carry its own marker guard, so the reference is inert downstream;
 *   (b) a citation of a path whose inventory disposition is `done` (the file is gone).
 * Citations of `retain` entries pass: those files ship with the repository.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { EXCLUDE } from '../packages/app/src/builder/bundle-plugins';
import { SDLC_PRESET_ACTIONS } from '../packages/config/src/index';

const REPO_ROOT = join(import.meta.dir, '..');
const REPORT = JSON.parse(readFileSync(join(REPO_ROOT, 'docs/reports/A94-script-ownership.json'), 'utf-8')) as {
    entries: Array<{ path: string; disposition: string; downstream: string; downstreamReason?: string }>;
};

/** The sp-plugin contract gates: repository fixtures, whose generic form is Superskill's. */
const PLUGIN_GATES = [
    'scripts/commands/validate-commands.ts',
    'scripts/commands/validate-flag-contracts.ts',
    'scripts/commands/surface-drift-inventory.ts',
    'scripts/commands/skill-eval.ts',
    'scripts/commands/plugin-install-smoke.ts',
    'scripts/commands/script-contract-check.ts',
];

/**
 * Files allowed to name a repository script, each with the marker guard it must carry. A guard makes
 * the reference inert downstream (`[ -f scripts/… ] || … exit 0`).
 */
const ALLOWLIST: Array<{ path: string; marker: string; reason: string }> = [
    {
        path: 'plugins/sp/README.md',
        marker: 'Spur repository only',
        reason: "documents the repository-only validate-commands gate over Spur's own command wrappers",
    },
    {
        path: 'plugins/sp/skills/spur-dev/references/dev-operations.md',
        marker: 'only when `package.json` declares the script (a no-op in other projects)',
        reason: 'the wrapup doc-tripwire default names a repo alias but states it is a no-op downstream',
    },
    {
        path: 'plugins/sp/skills/spur-dev/references/execution-batch-report.md',
        marker: 'only when it is declared (a no-op in other projects)',
        reason: 'same doc-tripwire default, guarded by the same declaration check',
    },
    {
        path: 'config/rules/boundary/sp-script-placement.yaml',
        marker: '[ -f scripts/commands/script-contract-check.ts ]',
        reason: 'SKIPs outside the Spur source repo; the generic plugin-quality checks belong to Superskill',
    },
];

/** Root package scripts are the repository's own aliases; a shipped file must not reach for them. */
function repositoryAliases(): string[] {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf-8')) as {
        scripts: Record<string, string>;
    };
    // Root scripts minus the bun-preset bindings: `bun run test` and friends are generic commands a
    // downstream project owns, so only a Spur-specific alias name is repository-only.
    const preset = new Set<string>(SDLC_PRESET_ACTIONS.bun);
    return (
        Object.entries(pkg.scripts)
            .filter(([name]) => !preset.has(name))
            // A repo-only alias runs repository tooling under `scripts/`; an alias that merely wraps the
            // source CLI documents a shipped verb, which a downstream file may spell with `spur`.
            .filter(([, command]) => /scripts\//.test(command))
            .map(([name]) => name)
            .sort()
    );
}

/** Shipped files, pruned exactly as `bundle-plugins` prunes them. */
function shippedFiles(): string[] {
    const roots = [join(REPO_ROOT, 'config'), join(REPO_ROOT, 'plugins', 'sp')];
    const out: string[] = [];
    const walk = (dir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name);
            if (EXCLUDE.test(full)) continue;
            if (entry.isDirectory()) {
                walk(full);
                continue;
            }
            if (/\.(md|ya?ml|json)$/.test(entry.name)) out.push(relative(REPO_ROOT, full));
        }
    };
    for (const root of roots) if (existsSync(root) && statSync(root).isDirectory()) walk(root);
    return out.sort();
}

const SCRIPT_REF = /\bbun\s+(?:run\s+)?(?:\.\.\/)*scripts\/[\w./-]+/g;

describe('shipped surfaces do not execute repository-only commands', () => {
    const files = shippedFiles();

    test('the scan reaches the shipped tree', () => {
        expect(files.length).toBeGreaterThan(50);
    });

    test('every repository-script reference is allowlisted and marker-guarded', () => {
        const problems: string[] = [];
        for (const file of files) {
            const text = readFileSync(join(REPO_ROOT, file), 'utf-8');
            for (const match of text.matchAll(SCRIPT_REF)) {
                const allowed = ALLOWLIST.find((entry) => entry.path === file);
                if (allowed === undefined) {
                    problems.push(`${file}: executable ${match[0]} outside the allowlist`);
                    continue;
                }
                if (!text.includes(allowed.marker)) {
                    problems.push(`${file}: allowlisted for ${match[0]} but the marker guard is missing`);
                }
            }
        }
        expect(problems).toEqual([]);
    });

    test('no shipped file invokes a repository package alias', () => {
        const aliases = repositoryAliases();
        const problems: string[] = [];
        for (const file of files) {
            const text = readFileSync(join(REPO_ROOT, file), 'utf-8');
            for (const alias of aliases) {
                // `bun run <alias>` (or a bare `<alias>` in a fenced command) is the repository route.
                if (!new RegExp(`\\bbun\\s+(?:run\\s+)?${alias}\\b`).test(text)) continue;
                const allowed = ALLOWLIST.find((entry) => entry.path === file);
                if (allowed === undefined) problems.push(`${file}: invokes the repository alias \`${alias}\``);
                else if (!text.includes(allowed.marker)) {
                    problems.push(`${file}: allowlisted for \`${alias}\` but the marker guard is missing`);
                }
            }
        }
        expect(problems).toEqual([]);
    });

    // Moved modules leave the inventory instead of lingering as `done`, so the check is existence:
    // every repository script path a shipped file cites must still be on disk.
    test('no shipped file cites a repository script that no longer exists', () => {
        const problems: string[] = [];
        for (const file of files) {
            const text = readFileSync(join(REPO_ROOT, file), 'utf-8');
            for (const [path] of text.matchAll(/\bscripts\/commands\/[\w./-]+\.ts\b/g)) {
                if (!existsSync(join(REPO_ROOT, path))) problems.push(`${file}: cites missing ${path}`);
            }
        }
        expect(problems).toEqual([]);
    });
});

describe('the A94 inventory reaches its final state (1415 R6, R2)', () => {
    test('no entry is still pending', () => {
        expect(REPORT.entries.filter((entry) => entry.disposition === 'pending').map((entry) => entry.path)).toEqual(
            [],
        );
    });

    test('every retained sp-plugin gate names Superskill as the generic owner', () => {
        const problems: string[] = [];
        for (const path of PLUGIN_GATES) {
            const entry = REPORT.entries.find((row) => row.path === path);
            if (entry === undefined) {
                problems.push(`${path}: missing from the inventory`);
                continue;
            }
            if (!/Superskill/i.test(entry.downstreamReason ?? '')) {
                problems.push(`${path}: downstreamReason does not name Superskill`);
            }
        }
        expect(problems).toEqual([]);
    });
});
