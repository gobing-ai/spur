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

/** `[deferred: excluded — <reason>]` — operator-ruled-out item (em dash, en dash or hyphen). */
const DEFERRED_EXCLUDED_RE = /\[\s*deferred\s*:\s*excluded\s*[—–-]\s*([^\]]+)\]/i;

/** `[deferred: follow-up — <title>]` or a bare `[deferred: <x>]` — bare counts as follow-up. */
const DEFERRED_FOLLOWUP_RE = /\[\s*deferred\s*:\s*(?:follow-up\s*[—–-]\s*)?([^\]]+)\]/i;

/** Deferral disposition carried per deferred inventory id (1434 R1). */
export interface InventoryDisposition {
    kind: 'excluded' | 'follow-up';
    /** Trimmed captured reason (excluded) or title/text (follow-up). */
    text: string;
}

/**
 * Inventory ids from the report's `## Requirement inventory` section, split into
 * covered-owing (no `[deferred:` marker) and exempt (deferred) ids. An `[unclear:`
 * marker is informational — the item still owes coverage.
 *
 * 1434 R1: each deferred id also carries its disposition — excluded (with the reason)
 * or follow-up (with the title/text) — so the follow-up ledger check can reuse the
 * same parser instead of a second inventory walk.
 */
function parseInventory(report: string): {
    owing: Set<string>;
    deferred: Set<string>;
    dispositions: Map<string, InventoryDisposition>;
    hasSection: boolean;
} {
    const lines = report.split('\n');
    const start = lines.findIndex((line) => /^#{1,6}\s*Requirement inventory\s*$/i.test(line));
    if (start === -1) {
        return { owing: new Set(), deferred: new Set(), dispositions: new Map(), hasSection: false };
    }
    const owing = new Set<string>();
    const deferred = new Set<string>();
    const dispositions = new Map<string, InventoryDisposition>();
    for (let i = start + 1; i < lines.length; i++) {
        if (/^#{1,6}\s/.test(lines[i] ?? '')) break;
        const match = INVENTORY_ITEM_RE.exec(lines[i] ?? '');
        if (match === null) continue;
        const id = `I${match[1]}`;
        // An item is a markdown paragraph, not one line: a hand-wrapped or formatter-wrapped
        // `[deferred: ...]` sits on a continuation line (observed 2026-10-13 — a deferred I14 was
        // reported "not covered by any AC scenario and is not [deferred:]"). Absorb the following
        // lines until the next item or heading before reading the markers.
        const body = [match[2] ?? ''];
        for (let j = i + 1; j < lines.length; j++) {
            const next = lines[j] ?? '';
            if (/^#{1,6}\s/.test(next) || INVENTORY_ITEM_RE.test(next)) break;
            body.push(next);
        }
        const text = body.join('\n');
        if (/\[\s*deferred\s*:/i.test(text)) {
            deferred.add(id);
            const excluded = DEFERRED_EXCLUDED_RE.exec(text);
            if (excluded !== null) {
                dispositions.set(id, { kind: 'excluded', text: (excluded[1] ?? '').trim() });
            } else {
                const followUp = DEFERRED_FOLLOWUP_RE.exec(text);
                dispositions.set(id, { kind: 'follow-up', text: (followUp?.[1] ?? '').trim() });
            }
        } else {
            owing.add(id);
        }
    }
    return { owing, deferred, dispositions, hasSection: true };
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

/** One row of `<runId>-idea-followups.json`, shaped by the feature-create shell gate (idea-pipeline.yaml). */
export interface FollowupLedgerRow {
    item: string;
    disposition: 'filed' | 'existing';
    featureId: string;
    title: string;
}

/** Outcome of the follow-up ledger completeness check (1434 R2). */
export interface FollowupLedgerResult {
    /** Error findings — any finding fails the handoff closed. */
    findings: CheckFindings[];
    /** Ledger rows that correctly file one follow-up item with a resolvable featureId. */
    filed: Array<{ item: string; featureId: string; title: string; disposition: string }>;
    /** Excluded inventory items with their reason (they must never be filed). */
    excluded: Array<{ item: string; reason: string }>;
}

/**
 * Follow-up ledger completeness (1434 R2): every follow-up inventory item must have
 * exactly one ledger row whose featureId resolves; excluded items must never be filed;
 * a row naming an id outside the inventory is unknown. `ledger` undefined (no ledger
 * file) behaves as an empty ledger — follow-up items then surface as `unfiled` (1434
 * R4 legacy runs). Pure over text/rows — no fs, no subprocesses.
 */
export function checkFollowupLedger(
    reportText: string,
    ledger: readonly FollowupLedgerRow[] | undefined,
    resolvable: ReadonlySet<string>,
): FollowupLedgerResult {
    const inventory = parseInventory(reportText);
    const rows = ledger ?? [];
    const rowsByItem = new Map<string, FollowupLedgerRow[]>();
    for (const row of rows) {
        const list = rowsByItem.get(row.item) ?? [];
        list.push(row);
        rowsByItem.set(row.item, list);
    }
    const finding = (message: string): CheckFindings => ({
        layer: 'L3',
        code: FINDING_CODES.FOLLOWUP_LEDGER,
        severity: 'error',
        section: 'Requirements',
        message: `follow-up ledger: ${message}`,
    });
    const findings: CheckFindings[] = [];
    const filed: FollowupLedgerResult['filed'] = [];
    const excluded: FollowupLedgerResult['excluded'] = [];
    // Only deferred items need ledger rows: owing items are this feature's own
    // requirements (covered by its AC), excluded items must never be filed.
    const ids = [...inventory.deferred].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
    for (const id of ids) {
        const itemRows = rowsByItem.get(id) ?? [];
        const disposition = inventory.dispositions.get(id);
        if (disposition?.kind === 'excluded') {
            excluded.push({ item: id, reason: disposition.text });
            if (itemRows.length > 0) {
                findings.push(finding(`excluded item ${id} must not be filed but has a ledger row`));
            }
            continue;
        }
        if (itemRows.length === 0) {
            findings.push(finding(`follow-up item ${id} has no ledger row`));
        } else if (itemRows.length > 1) {
            findings.push(finding(`follow-up item ${id} has ${itemRows.length} ledger rows (exactly one required)`));
        } else {
            const row = itemRows[0] as FollowupLedgerRow;
            if (!resolvable.has(row.featureId)) {
                findings.push(
                    finding(`ledger row for ${id} names featureId "${row.featureId}" which does not resolve`),
                );
            } else {
                filed.push({ item: id, featureId: row.featureId, title: row.title, disposition: row.disposition });
            }
        }
    }
    for (const id of rowsByItem.keys()) {
        if (!inventory.owing.has(id) && !inventory.deferred.has(id)) {
            findings.push(finding(`ledger row names ${id} which is not in the requirement inventory`));
        }
    }
    return { findings, filed, excluded };
}
