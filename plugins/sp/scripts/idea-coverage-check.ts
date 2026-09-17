#!/usr/bin/env bun
/**
 * idea-coverage-check — requirement-inventory ↔ AC coverage gate for the idea pipeline
 * (task 0887 R4).
 *
 * Cross-checks the `## Requirement inventory` section of the idea-evaluation report
 * (R3) against the `# covers: I<n>, ...` comment lines of the generated acceptance
 * criteria (R4): every inventory item that is not explicitly `[deferred: ...]` must be
 * covered by at least one scenario. An `[unclear: ...]` marker does not exempt an item —
 * it still demands coverage or an explicit deferral.
 *
 * Writes PASS/FAIL to `.spur/run/<run-id>-idea-coverage.status` and always exits 0
 * (soft action, task 0769 pattern): the ac-generate guards in idea-pipeline.yaml read
 * the status file, so a missing or failing checker fails closed through the guard, not
 * through the exit code.
 *
 * Ships with the plugin to arbitrary projects, so it stays node-builtin-only —
 * no workspace imports.
 *
 * Usage:
 *   bun plugins/sp/scripts/idea-coverage-check.ts --run-id <id> --report <path>
 *     --ac <path> [--out <path>]
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

interface ParsedArgs {
    runId: string;
    reportPath: string;
    acPath: string;
    outPath: string;
}

/** `- **I3** — ask text` / `- I3. ask text` — the R3 inventory item form. */
const INVENTORY_ITEM_RE = /^\s*[-*]\s+\**I(\d+)\**\s*[.:—-]?\s+(.*)$/;

/** `# covers: I1, I3` — the R4 scenario coverage comment. */
const COVERS_RE = /^\s*#\s*covers:\s*(.+)$/i;

/** Scenario header — the anchor a covers-comment attaches to. */
const SCENARIO_RE = /^\s*Scenario(?:\s+Outline)?:/;

function parseArgs(argv: string[]): ParsedArgs {
    let runId = '';
    let reportPath = '';
    let acPath = '';
    let outPath = '';
    for (let i = 0; i < argv.length; i++) {
        const value = argv[i + 1];
        switch (argv[i]) {
            case '--run-id':
                runId = value ?? '';
                i++;
                break;
            case '--report':
                reportPath = value ?? '';
                i++;
                break;
            case '--ac':
                acPath = value ?? '';
                i++;
                break;
            case '--out':
                outPath = value ?? '';
                i++;
                break;
        }
    }
    if (runId === '' || reportPath === '' || acPath === '') {
        process.stderr.write(
            'usage: idea-coverage-check.ts --run-id <id> --report <path> --ac <path> [--out <path>]\n',
        );
        process.exit(2);
    }
    return {
        runId,
        reportPath,
        acPath,
        outPath: outPath !== '' ? outPath : join('.spur', 'run', `${runId}-idea-coverage.status`),
    };
}

/**
 * Inventory ids from the report's `## Requirement inventory` section, split into
 * covered-owing (no `[deferred:` marker) and exempt (deferred) ids. An `[unclear:`
 * marker is informational — the item still owes coverage.
 */
function parseInventory(report: string): { owing: Set<string>; deferred: Set<string>; hasSection: boolean } {
    const lines = report.split('\n');
    const start = lines.findIndex((line) => /^#{1,6}\s*Requirement inventory\s*$/i.test(line));
    if (start === -1) return { owing: new Set(), deferred: new Set(), hasSection: false };
    const owing = new Set<string>();
    const deferred = new Set<string>();
    for (let i = start + 1; i < lines.length; i++) {
        if (/^#{1,6}\s/.test(lines[i] ?? '')) break;
        const match = INVENTORY_ITEM_RE.exec(lines[i] ?? '');
        if (match === null) continue;
        const id = `I${match[1]}`;
        if (/\[\s*deferred\s*:/i.test(match[2] ?? '')) deferred.add(id);
        else owing.add(id);
    }
    return { owing, deferred, hasSection: true };
}

/** Coverage map from the AC content: scenario-count per `I<n>` id. */
function parseCoverage(ac: string): Map<string, number> {
    const covered = new Map<string, number>();
    let inScenario = false;
    for (const line of ac.split('\n')) {
        if (SCENARIO_RE.test(line)) {
            inScenario = true;
            continue;
        }
        if (!inScenario) continue;
        const match = COVERS_RE.exec(line);
        if (match === null) continue;
        for (const raw of (match[1] ?? '').split(',')) {
            const id = raw.trim().toUpperCase();
            if (/^I\d+$/.test(id)) covered.set(id, (covered.get(id) ?? 0) + 1);
        }
    }
    return covered;
}

function writeStatus(outPath: string, verdict: 'PASS' | 'FAIL', runId: string, detail: string): void {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${verdict}\n`);
    // Sibling reason file: the feature-check HITL prompt surfaces WHY next to the bare
    // status letter, without guards having to parse a multi-line status file.
    writeFileSync(`${outPath}.reason`, `${verdict} run=${runId} ${detail}\n`);
}

function main(): void {
    const args = parseArgs(process.argv.slice(2));

    if (!existsSync(args.reportPath) || !existsSync(args.acPath)) {
        const detail = `missing input (report=${existsSync(args.reportPath) ? 'ok' : 'absent'}, ac=${existsSync(args.acPath) ? 'ok' : 'absent'})`;
        writeStatus(args.outPath, 'FAIL', args.runId, detail);
        process.stdout.write(`idea-coverage-check FAIL run=${args.runId} ${detail}\n`);
        return;
    }

    const inventory = parseInventory(readFileSync(args.reportPath, 'utf8'));
    const covered = parseCoverage(readFileSync(args.acPath, 'utf8'));

    if (!inventory.hasSection || inventory.owing.size + inventory.deferred.size === 0) {
        const detail = `no Requirement inventory items in ${args.reportPath}`;
        writeStatus(args.outPath, 'FAIL', args.runId, detail);
        process.stdout.write(`idea-coverage-check FAIL run=${args.runId} ${detail}\n`);
        return;
    }

    const uncovered = [...inventory.owing].filter((id) => (covered.get(id) ?? 0) === 0).sort();
    const shape = `inventory=${inventory.owing.size + inventory.deferred.size} (deferred=${inventory.deferred.size})`;
    if (uncovered.length > 0) {
        const detail = `${shape} covered=${inventory.owing.size - uncovered.length} uncovered=${uncovered.join(',')}`;
        writeStatus(args.outPath, 'FAIL', args.runId, detail);
        process.stdout.write(`idea-coverage-check FAIL run=${args.runId} ${detail}\n`);
        return;
    }

    const detail = `${shape} all covered`;
    writeStatus(args.outPath, 'PASS', args.runId, detail);
    process.stdout.write(`idea-coverage-check PASS run=${args.runId} ${detail}\n`);
}

main();
