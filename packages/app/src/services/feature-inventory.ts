/**
 * Requirement-inventory ↔ AC coverage check (task 1004 R1, ported from the deleted
 * the idea-pipeline coverage-checker script).
 *
 * Cross-checks the `## Requirement inventory` section of an idea-evaluation report
 * against the `# covers: I<n>, ...` comment lines of the feature's acceptance
 * criteria: every inventory item that is not explicitly `[deferred: ...]` must be
 * covered by at least one scenario. An `[unclear: ...]` marker does not exempt an
 * item — it still demands coverage or an explicit deferral. A missing or empty
 * inventory section is an error.
 *
 * Pure functions over report/AC text — no filesystem, no subprocesses.
 */

import { FINDING_CODES } from './finding-codes';
import type { CheckFindings } from './planning-check-base';

/** `- **I3** — ask text` / `- I3. ask text` — the R3 inventory item form. */
const INVENTORY_ITEM_RE = /^\s*[-*]\s+\**I(\d+)\**\s*[.:—-]?\s+(.*)$/;

/** `# covers: I1, I3` — the R4 scenario coverage comment. */
const COVERS_RE = /^\s*#\s*covers:\s*(.+)$/i;

/** Scenario header — the anchor a covers-comment attaches to. */
const SCENARIO_RE = /^\s*Scenario(?:\s+Outline)?:/;

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

/**
 * Coverage findings for one feature: an error per uncovered non-deferred inventory
 * item, plus an error when the report lacks a `## Requirement inventory` section
 * (or it carries no items). Empty findings = fully covered.
 */
export function checkInventoryCoverage(reportText: string, acText: string): CheckFindings[] {
    const inventory = parseInventory(reportText);
    if (!inventory.hasSection || inventory.owing.size + inventory.deferred.size === 0) {
        return [
            {
                layer: 'L3',
                code: FINDING_CODES.INVENTORY_COVERAGE,
                severity: 'error',
                section: 'Requirements',
                message: 'inventory report has no `## Requirement inventory` items',
            },
        ];
    }
    const covered = parseCoverage(acText);
    const uncovered = [...inventory.owing].filter((id) => (covered.get(id) ?? 0) === 0).sort();
    return uncovered.map((id) => ({
        layer: 'L3' as const,
        code: FINDING_CODES.INVENTORY_COVERAGE,
        severity: 'error' as const,
        section: 'Requirements',
        message: `Requirement ${id} is not covered by any AC scenario and is not [deferred:]`,
    }));
}
