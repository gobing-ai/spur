/**
 * Gherkin structural validation — keeps the legacy ValidationResult contract.
 *
 * `validateAcceptanceCriteria` validates Gherkin syntax (step order, required
 * elements, duplicate detection, doc string handling). It returns the same
 * {@link ValidationResult} shape the legacy `validateFeature` produced.
 */

import type { ParsedStep } from './parser';

/** A single validation issue (error or warning) with source location. */
export interface ValidationIssue {
    line: number;
    column?: number;
    severity: 'error' | 'warning';
    message: string;
}
/** Result of validating Gherkin acceptance criteria — errors and warnings with line numbers. */
export interface ValidationResult {
    valid: boolean;
    errors: ValidationIssue[];
    warnings: ValidationIssue[];
}

/**
 * Validate Gherkin acceptance criteria content.
 *
 * Alias for the legacy `validateFeature` — kept under a domain-appropriate name
 * so callers like `task check` / `feature check` read naturally.
 */
export function validateAcceptanceCriteria(content: string): ValidationResult {
    return validateGherkin(content);
}

/**
 * Validate a Gherkin feature block.
 */
function validateGherkin(content: string): ValidationResult {
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    const lines = content.split('\n');
    let foundFeature = false;
    let foundScenario = false;
    let inBackground = false;
    let inBlock = false;
    let inDocString = false;
    let previousStepType: string | null = null;
    let allowDescriptionLines = false;
    const scenarioNames: Set<string> = new Set();

    for (let i = 0; i < lines.length; i++) {
        const trimmed = (lines[i] ?? '').trim();
        const lineNumber = i + 1;

        if (trimmed.startsWith('"""')) {
            inDocString = !inDocString;
            continue;
        }

        if (inDocString) {
            continue;
        }

        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }

        if (trimmed.startsWith('Feature:')) {
            if (foundFeature) {
                errors.push({
                    line: lineNumber,
                    severity: 'error',
                    message: 'Multiple Feature declarations found. Each file should have exactly one Feature.',
                });
            }
            foundFeature = true;
            const featureName = trimmed.substring(8).trim();
            if (!featureName) {
                errors.push({
                    line: lineNumber,
                    severity: 'error',
                    message: 'Feature name is empty.',
                });
            }
            allowDescriptionLines = true;
            continue;
        }

        if (trimmed.startsWith('Background:')) {
            if (foundScenario) {
                errors.push({
                    line: lineNumber,
                    severity: 'error',
                    message: 'Background must come before any Scenario.',
                });
            }
            inBackground = true;
            inBlock = true;
            previousStepType = null;
            allowDescriptionLines = true;
            continue;
        }

        if (trimmed.startsWith('Scenario:')) {
            foundScenario = true;
            inBackground = false;
            inBlock = true;
            previousStepType = null;
            allowDescriptionLines = true;

            const scenarioName = trimmed.substring(9).trim();
            if (!scenarioName) {
                errors.push({
                    line: lineNumber,
                    severity: 'error',
                    message: 'Scenario name is empty.',
                });
            } else {
                if (scenarioNames.has(scenarioName)) {
                    errors.push({
                        line: lineNumber,
                        severity: 'error',
                        message: `Duplicate scenario name: "${scenarioName}"`,
                    });
                }
                scenarioNames.add(scenarioName);
            }
            continue;
        }

        if (trimmed.startsWith('Scenario Outline:')) {
            foundScenario = true;
            inBackground = false;
            inBlock = true;
            previousStepType = null;
            allowDescriptionLines = true;

            const scenarioName = trimmed.substring(17).trim();
            if (!scenarioName) {
                errors.push({
                    line: lineNumber,
                    severity: 'error',
                    message: 'Scenario Outline name is empty.',
                });
            } else {
                if (scenarioNames.has(scenarioName)) {
                    errors.push({
                        line: lineNumber,
                        severity: 'error',
                        message: `Duplicate scenario name: "${scenarioName}"`,
                    });
                }
                scenarioNames.add(scenarioName);
            }
            continue;
        }

        if (trimmed.startsWith('Examples:')) {
            allowDescriptionLines = true;
            continue;
        }

        if (trimmed.startsWith('|')) {
            allowDescriptionLines = false;
            if (!inBlock) {
                errors.push({
                    line: lineNumber,
                    severity: 'error',
                    message: 'Data table outside of any Scenario or Background.',
                });
            }
            continue;
        }

        const stepMatch = trimmed.match(/^(Given|When|Then|And|But)\s+(.*)$/);
        if (stepMatch) {
            allowDescriptionLines = false;
            const keyword = (stepMatch[1] ?? '') as ParsedStep['keyword'];

            if (!inBlock) {
                errors.push({
                    line: lineNumber,
                    severity: 'error',
                    message: `Step "${keyword}" found outside of any Scenario or Background.`,
                });
                continue;
            }

            if (!inBackground) {
                if (keyword === 'Given') {
                    previousStepType = 'Given';
                } else if (keyword === 'When') {
                    if (previousStepType === 'Then') {
                        warnings.push({
                            line: lineNumber,
                            severity: 'warning',
                            message: '"When" step after "Then" — consider splitting into separate scenario.',
                        });
                    }
                    previousStepType = 'When';
                } else if (keyword === 'Then') {
                    if (previousStepType !== null && previousStepType !== 'When' && previousStepType !== 'Then') {
                        warnings.push({
                            line: lineNumber,
                            severity: 'warning',
                            message: '"Then" step without a preceding "When" step.',
                        });
                    }
                    previousStepType = 'Then';
                } else if (keyword === 'And' || keyword === 'But') {
                    if (!previousStepType) {
                        errors.push({
                            line: lineNumber,
                            severity: 'error',
                            message: `"${keyword}" cannot be the first step.`,
                        });
                    }
                }
            }

            continue;
        }

        if (trimmed.startsWith('@')) {
            allowDescriptionLines = false;
            continue;
        }

        if (isDescriptionLine(trimmed, allowDescriptionLines)) {
            continue;
        }

        if (trimmed.length > 0) {
            warnings.push({
                line: lineNumber,
                severity: 'warning',
                message: `Unrecognized syntax: "${trimmed}"`,
            });
        }
    }

    if (inDocString) {
        errors.push({
            line: lines.length,
            severity: 'error',
            message: 'Unclosed doc string (missing closing triple quotes).',
        });
    }

    if (!foundFeature) {
        errors.push({
            line: 1,
            severity: 'error',
            message: 'No Feature declaration found.',
        });
    }

    if (!foundScenario) {
        warnings.push({
            line: 1,
            severity: 'warning',
            message: 'No Scenario found in Feature.',
        });
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings,
    };
}

function isDescriptionLine(trimmed: string, allowDescriptionLines: boolean): boolean {
    if (!allowDescriptionLines) {
        return false;
    }

    return !/^(Feature:|Background:|Scenario:|Scenario Outline:|Examples:|@|\||Given(?:\s+|$)|When(?:\s+|$)|Then(?:\s+|$)|And(?:\s+|$)|But(?:\s+|$)|""")/.test(
        trimmed,
    );
}
