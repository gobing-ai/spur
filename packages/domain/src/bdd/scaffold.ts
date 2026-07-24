/**
 * BDD test stub generator and scaffold merger — R1–R4 (0320).
 *
 * R1: Emits 1:1 test.todo stubs from ParsedScenario ASTs.
 * R2: Renders Given/When/Then steps as AAA comments + // @ac:<normalizedTitle> tags.
 * R3: Pure stub merger preserving existing/filled stubs and detecting drifted ACs.
 * R4: Expands Scenario Outlines into 1 stub per Example row.
 */

import { normalizeTitle } from './coverage';
import { stripAcFence } from './fence';
import { type ParsedScenario, parseFeature } from './parser';

/** A scaffolded test stub item before file merging. */
export interface ScaffoldedStub {
    /** Scenario display name (or expanded name for outline examples). */
    scenarioName: string;
    /** Normalized AC tag used for idempotency matching. */
    acTag: string;
    /** The complete rendered TypeScript snippet for test.todo. */
    code: string;
    /** Example row index if from a Scenario Outline (1-based). */
    exampleIndex?: number;
    /** Example row key-value map if from a Scenario Outline. */
    exampleData?: Record<string, string>;
}

/** Result of merging new scaffolded stubs into existing file content. */
export interface MergeResult {
    /** Updated complete file content to write. */
    content: string;
    /** Count of new stubs appended. */
    created: number;
    /** Count of existing stubs preserved/skipped. */
    skipped: number;
    /** Count of scenarios previously scaffolded whose AC tag is no longer in current AC. */
    drifted: number;
    /** Normalized tags of drifted scenarios. */
    driftedScenarios: string[];
}

/**
 * Render one ParsedScenario (or Scenario Outline) into one or more ScaffoldedStub items.
 */
export function renderScenarioStub(scenario: ParsedScenario): ScaffoldedStub[] {
    const baseTag = normalizeTitle(scenario.name);

    // Scenario Outline expansion (R4)
    if (scenario.outline?.examples && scenario.outline.examples.length > 0) {
        return scenario.outline.examples.map((row, idx) => {
            const rowStr = Object.entries(row)
                .map(([k, v]) => `${k}=${v}`)
                .join(', ');
            const expandedName = `${scenario.name} (Example ${idx + 1}: ${rowStr})`;

            const stepLines = scenario.steps.map((step) => {
                let text = step.text;
                for (const [k, v] of Object.entries(row)) {
                    text = text.replaceAll(`<${k}>`, v);
                }
                return `    // ${step.keyword} ${text}`;
            });

            const codeLines = [
                `// @ac:${baseTag}`,
                `// Example ${idx + 1}: ${rowStr}`,
                `test.todo('${expandedName}', () => {`,
                ...stepLines,
                `});`,
            ];

            return {
                scenarioName: expandedName,
                acTag: baseTag,
                code: codeLines.join('\n'),
                exampleIndex: idx + 1,
                exampleData: row,
            };
        });
    }

    // Standard Scenario
    const stepLines = scenario.steps.map((step) => `    // ${step.keyword} ${step.text}`);
    const codeLines = [`// @ac:${baseTag}`, `test.todo('${scenario.name}', () => {`, ...stepLines, `});`];

    return [
        {
            scenarioName: scenario.name,
            acTag: baseTag,
            code: codeLines.join('\n'),
        },
    ];
}

/**
 * Parse Gherkin AC content and return scaffolded stubs for all scenarios.
 */
export function scaffoldFeatureScenarios(content: string): ScaffoldedStub[] {
    const unfenced = stripAcFence(content);
    if (!unfenced.trim()) return [];

    const hasScenario = unfenced.includes('Scenario:') || unfenced.includes('Scenario Outline:');
    const toParse =
        unfenced.includes('Feature:') || !hasScenario ? unfenced : `Feature: __scaffold_wrapper__\n\n${unfenced}`;

    const parsed = parseFeature(toParse);
    if (!parsed?.scenarios || parsed.scenarios.length === 0) {
        return [];
    }

    return parsed.scenarios.flatMap(renderScenarioStub);
}

/**
 * Extract all existing `// @ac:<tag>` normalized tags from test file content.
 */
export function parseExistingAcTags(fileContent: string): Set<string> {
    const tags = new Set<string>();
    const matches = fileContent.matchAll(/\/\/\s*@ac:([^\n\r]+)/g);
    for (const match of matches) {
        const tag = match[1]?.trim();
        if (tag) {
            tags.add(tag);
        }
    }
    return tags;
}

/**
 * Merge new scaffolded stubs into existing file content idempotently (R3).
 */
export function mergeStubs(existingContent: string, newStubs: ScaffoldedStub[]): MergeResult {
    const trimmedExisting = existingContent.trim();
    if (!trimmedExisting) {
        const header = `import { test } from 'bun:test';\n\n`;
        const body = newStubs.map((s) => s.code).join('\n\n');
        return {
            content: `${header}${body}\n`,
            created: newStubs.length,
            skipped: 0,
            drifted: 0,
            driftedScenarios: [],
        };
    }

    const existingTags = parseExistingAcTags(existingContent);
    const newAcTagSet = new Set(newStubs.map((s) => s.acTag));

    let created = 0;
    let skipped = 0;
    const stubsToAppend: string[] = [];

    for (const stub of newStubs) {
        if (existingTags.has(stub.acTag) || existingContent.includes(stub.scenarioName)) {
            skipped++;
        } else {
            created++;
            stubsToAppend.push(stub.code);
        }
    }

    const driftedScenarios: string[] = [];
    for (const tag of existingTags) {
        if (!newAcTagSet.has(tag)) {
            driftedScenarios.push(tag);
        }
    }

    let updatedContent = existingContent;
    if (stubsToAppend.length > 0) {
        const separator = existingContent.endsWith('\n\n') ? '' : existingContent.endsWith('\n') ? '\n' : '\n\n';
        updatedContent = `${existingContent}${separator}${stubsToAppend.join('\n\n')}\n`;
    }

    return {
        content: updatedContent,
        created,
        skipped,
        drifted: driftedScenarios.length,
        driftedScenarios,
    };
}
