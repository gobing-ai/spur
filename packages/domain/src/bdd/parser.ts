/**
 * Gherkin-subset parser — Feature/Scenario/Given/When/Then/And/But + tags.
 *
 * AST property names align with @cucumber/gherkin types for future interop.
 * No runtime dependency on @cucumber/gherkin — types are referenced only.
 */

// ============================================================
// Types — aligned with @cucumber/gherkin property names
// ============================================================

/** Parsed Gherkin feature — the top-level AST node returned by {@link parseFeature}. */
export interface ParsedFeature {
    name: string;
    description?: string;
    tags?: string[];
    background?: {
        steps: ParsedStep[];
    };
    scenarios: ParsedScenario[];
}
/** A single scenario (or scenario outline) within a parsed feature. */
export interface ParsedScenario {
    name: string;
    tags?: string[];
    steps: ParsedStep[];
    outline?: {
        examples: Array<Record<string, string>>;
    };
}

/** A single Given/When/Then/And/But step within a parsed scenario or background. */
export interface ParsedStep {
    keyword: 'Given' | 'When' | 'Then' | 'And' | 'But';
    text: string;
    line: number;
    docString?: string;
    dataTable?: string[][];
}

// ============================================================
// Internal helpers
// ============================================================

function isDescriptionLine(trimmed: string): boolean {
    return !/^(Feature:|Background:|Scenario:|Scenario Outline:|Examples:|@|\||Given(?:\s+|$)|When(?:\s+|$)|Then(?:\s+|$)|And(?:\s+|$)|But(?:\s+|$)|""")/.test(
        trimmed,
    );
}

// ============================================================
// Parser
// ============================================================

/**
 * Parse a Gherkin feature file into structured data.
 * Returns null if no Feature declaration is found.
 */
export function parseFeature(content: string): ParsedFeature | null {
    const lines = content.split('\n');
    let feature: ParsedFeature | null = null;
    let currentScenario: ParsedScenario | null = null;
    let inBackground = false;
    let inDocString = false;
    let docStringLines: string[] = [];
    let currentStep: ParsedStep | null = null;
    let currentTags: string[] = [];
    let inExamples = false;
    let exampleHeaders: string[] = [];
    const descriptionLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const trimmed = (raw ?? '').trim();
        const lineNumber = i + 1;

        // Doc string toggle
        if (trimmed.startsWith('"""')) {
            if (inDocString) {
                if (currentStep) {
                    currentStep.docString = docStringLines.join('\n');
                }
                docStringLines = [];
                inDocString = false;
            } else {
                inDocString = true;
                docStringLines = [];
            }
            continue;
        }

        if (inDocString) {
            docStringLines.push(trimmed);
            continue;
        }

        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }

        // Tags
        if (trimmed.startsWith('@')) {
            const tags = trimmed.split(/\s+/).filter((t) => t.startsWith('@'));
            currentTags.push(...tags);
            continue;
        }

        // Feature
        if (trimmed.startsWith('Feature:')) {
            feature = {
                name: trimmed.substring(8).trim(),
                ...(currentTags.length > 0 ? { tags: [...currentTags] } : {}),
                scenarios: [],
            };
            currentTags = [];
            // descriptionLines already initialized; keep collecting until first Scenario/Background
            continue;
        }

        // Background
        if (trimmed.startsWith('Background:')) {
            if (feature) {
                feature.background = { steps: [] };
                inBackground = true;
                currentScenario = null;
                currentStep = null;
                inExamples = false;
            }
            currentTags = [];
            // stop collecting description — no reset needed, flag via currentScenario/background
            continue;
        }

        // Scenario
        if (trimmed.startsWith('Scenario:')) {
            if (feature) {
                inBackground = false;
                inExamples = false;
                currentStep = null;
                const scenario: ParsedScenario = {
                    name: trimmed.substring(9).trim(),
                    ...(currentTags.length > 0 ? { tags: [...currentTags] } : {}),
                    steps: [],
                };
                currentScenario = scenario;
                feature.scenarios.push(scenario);
            }
            currentTags = [];
            // stop collecting description — currentScenario is now set
            continue;
        }

        // Scenario Outline
        if (trimmed.startsWith('Scenario Outline:')) {
            if (feature) {
                inBackground = false;
                inExamples = false;
                currentStep = null;
                const outline: ParsedScenario = {
                    name: trimmed.substring(17).trim(),
                    ...(currentTags.length > 0 ? { tags: [...currentTags] } : {}),
                    steps: [],
                    outline: { examples: [] },
                };
                currentScenario = outline;
                feature.scenarios.push(outline);
            }
            currentTags = [];
            // stop collecting description — currentScenario is now set
            continue;
        }

        // Examples header
        if (trimmed.startsWith('Examples:')) {
            inExamples = true;
            exampleHeaders = [];
            currentStep = null;
            continue;
        }

        // Data table / Examples rows
        if (trimmed.startsWith('|')) {
            const cells = trimmed
                .split('|')
                .slice(1, -1)
                .map((c) => c.trim());

            if (inExamples && currentScenario?.outline) {
                if (exampleHeaders.length === 0) {
                    exampleHeaders = cells;
                } else {
                    const row: Record<string, string> = {};
                    for (let j = 0; j < exampleHeaders.length; j++) {
                        const header = exampleHeaders[j];
                        if (header !== undefined) {
                            row[header] = cells[j] ?? '';
                        }
                    }
                    currentScenario.outline.examples.push(row);
                }
            } else if (currentStep) {
                if (!currentStep.dataTable) {
                    currentStep.dataTable = [];
                }
                currentStep.dataTable.push(cells);
            }
            continue;
        }

        // Steps
        const stepMatch = trimmed.match(/^(Given|When|Then|And|But)\s+(.*)$/);
        if (stepMatch) {
            inExamples = false;
            const step: ParsedStep = {
                keyword: (stepMatch[1] ?? '') as ParsedStep['keyword'],
                text: stepMatch[2] ?? '',
                line: lineNumber,
            };
            currentStep = step;

            if (inBackground && feature?.background) {
                feature.background.steps.push(step);
            } else if (currentScenario) {
                currentScenario.steps.push(step);
            }
            continue;
        }

        // Feature description (free-form prose between Feature: and first Scenario/Background)
        if (feature && !currentScenario && !feature.background && isDescriptionLine(trimmed)) {
            descriptionLines.push(trimmed);
        }
    }

    if (feature && descriptionLines.length > 0) {
        feature.description = descriptionLines.join('\n');
    }

    return feature;
}
