/**
 * AC coverage check (L4) — DD-09: coverage matching by normalized scenario title.
 *
 * A task *covers* a feature scenario when the task's AC contains a scenario
 * whose normalized title matches, or a checklist item that names it. The subset
 * rule: every task scenario must map to a feature scenario; feature scenarios
 * with no covering task are **orphan warnings** (never errors).
 */

import type { ChecklistItem } from './checklist';
import { type ParsedFeature, type ParsedScenario, parseFeature as parseFeatureInternal } from './parser';
import type { ValidationIssue } from './validate';

/** Result of checking whether task AC covers feature AC (DD-09 normalized-title matching). */
export interface CoverageResult {
    /** Whether all task scenarios have a matching feature scenario (subset rule). */
    covered: boolean;
    /** Feature scenarios with no matching task scenario — warnings, never errors. */
    orphans: string[];
    /** Task scenarios that don't match any feature scenario — errors (subset violation). */
    uncovered: string[];
    /** Detailed issues for programmatic consumption. */
    issues: ValidationIssue[];
}

/**
 * Strip leading bracket tags and a `Scenario:` prefix, repeatedly and in any order, so
 * `[doc-only] Scenario: Foo`, `Scenario: [doc-only] Foo`, and `Foo` reduce alike.
 *
 * Bracket tags (`[doc-only]`, `[docs-only]`, `[non-behavior]`, `[advisory]`, `[non-core]`) are
 * evidence-rule metadata carried *in the AC id* — `requiresExecutableEvidence` reads them there to
 * decide whether a MET row needs executable evidence. They are not part of the scenario's identity,
 * so they must not participate in title matching. Before task 0398 R7 they survived normalization,
 * which made the two rules mutually unsatisfiable for a documentation scenario: tag the row and
 * `rowMatchesScenario` no longer links it to its feature scenario (→ `L4.scenario-unverified`,
 * strict advance blocked); leave it untagged and the row is demoted to PARTIAL (→ also unverified).
 */
function stripScenarioPrefixes(title: string): string {
    let out = title.trim();
    let previous: string;
    do {
        previous = out;
        out = out
            .replace(/^\[[^\]]*\]\s*/, '')
            .replace(/\s*\[[^\]]*\]\s*$/, '')
            .replace(/^Scenario:\s*/i, '')
            .replace(/^R\d+\s*[:\-—]?\s*/, '')
            .trim();
    } while (out !== previous);
    return out;
}

/**
 * Normalize a scenario title for matching: lowercase, collapse whitespace,
 * strip bracket tags, a `Scenario:` prefix, R-id prefixes, and common punctuation.
 */
export function normalizeTitle(title: string): string {
    return stripScenarioPrefixes(title)
        .replace(/^(R\d+)\s*[:\-—]?\s*/, '')
        .trim()
        .toLowerCase()
        .replace(/[\u0027\u2018\u2019\u201c\u201d]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Check whether a task's acceptance criteria covers the feature's scenarios.
 *
 * @param featureAc  Feature-level AC (the spec — all expected scenarios)
 * @param taskAc     Task-level AC (the implementation — subset of feature)
 * @param taskChecklist  Optional checklist items from the task (Tier-2 AC)
 * @param acAltitude Declared AC altitude (task 0584 / ADR-062): `task-local`
 *        skips the DD-09 subset rule (the task's criteria sit at a finer
 *        altitude than the feature's ship contract); absent or `graduating`
 *        enforces it. The field is the only input — never inferred from
 *        notation or template (R4).
 */
export function checkAcCoverage(
    featureAc: string,
    taskAc: string,
    taskChecklist?: ChecklistItem[],
    acAltitude?: 'graduating' | 'task-local',
): CoverageResult {
    // task-local: criteria are finer-grained than the feature's ship contract,
    // so the subset rule does not apply (DD-09 skipped, task 0584 R3).
    //
    // CAUTION: `orphans` in this early return is NOT a computed result — it is empty
    // because the subset comparison never ran. Callers on the altitude-aware path read
    // only `uncovered`, so this is inert today, but the feature-side orphan sweep
    // (`feature-check.ts`, which intersects `.orphans` across linked tasks) reads that
    // field from this same function. If a caller ever passes an altitude AND reads
    // `orphans`, it would see "no orphans" for a reason that has nothing to do with
    // coverage. Compute the orphan set before returning if that day comes.
    if (acAltitude === 'task-local') {
        return { covered: true, orphans: [], uncovered: [], issues: [] };
    }
    const featureParsed = parseForCoverage(featureAc);
    const taskParsed = parseForCoverage(taskAc);

    const featureTitles = new Set(featureParsed.map(normalizeTitle));
    const taskTitles = new Set(taskParsed.map(normalizeTitle));

    // Checklist items: treated as task scenarios by their normalized text
    const checklistTitles = new Set<string>();
    if (taskChecklist) {
        for (const item of taskChecklist) {
            checklistTitles.add(normalizeTitle(item.text));
        }
    }

    // Subset rule: every task scenario must map to a feature scenario
    const uncovered: string[] = [];
    const issues: ValidationIssue[] = [];

    for (const title of taskParsed) {
        const normalized = normalizeTitle(title);
        if (!featureTitles.has(normalized)) {
            uncovered.push(title);
            issues.push({
                line: 0,
                severity: 'error',
                message: `Task scenario "${title}" does not match any feature scenario.`,
            });
        }
    }

    // Check checklist items against feature scenarios
    if (taskChecklist) {
        for (const item of taskChecklist) {
            const normalized = normalizeTitle(item.text);
            if (!featureTitles.has(normalized) && !taskTitles.has(normalized)) {
                uncovered.push(item.text);
                issues.push({
                    line: item.line,
                    severity: 'error',
                    message: `Task checklist item "${item.text}" does not match any feature scenario.`,
                });
            }
        }
    }

    // Orphan detection: feature scenarios with no covering task scenario
    const orphans: string[] = [];
    const allTaskTitles = new Set([...taskTitles, ...checklistTitles]);

    for (const title of featureParsed) {
        const normalized = normalizeTitle(title);
        if (!allTaskTitles.has(normalized)) {
            orphans.push(title);
            issues.push({
                line: 0,
                severity: 'warning',
                message: `Feature scenario "${title}" has no covering task scenario.`,
            });
        }
    }

    return {
        covered: uncovered.length === 0,
        orphans,
        uncovered,
        issues,
    };
}

/**
 * Extract scenario names from AC content. Handles both Gherkin (Scenario:)
 * and null-AC (returns empty — coverage not applicable).
 */
function parseForCoverage(content: string): string[] {
    const parsed = tryParseFeature(content);
    if (!parsed) {
        return [];
    }
    return parsed.scenarios.map((s: ParsedScenario) => s.name);
}

/**
 * Lightweight feature parse — uses the full parser if content looks like Gherkin.
 * Returns null for non-Gherkin content.
 *
 * Task ACs often ship bare `Scenario:` blocks without a `Feature:` header (the
 * feature file owns the Feature line). The Gherkin parser requires `Feature:`,
 * so we synthesize a minimal wrapper when only scenarios are present — otherwise
 * DD-09 coverage treats every task as covering nothing and all feature scenarios
 * look like orphans.
 */
function tryParseFeature(content: string): ParsedFeature | null {
    if (!content.includes('Feature:') && !content.includes('Scenario:')) {
        return null;
    }
    const toParse =
        content.includes('Feature:') || !content.includes('Scenario:')
            ? content
            : `Feature: __coverage_wrapper__\n\n${content}`;
    // Delegate to the real parser
    return parseFeatureInternal(toParse);
}
