/**
 * Client-side DTOs for the feature domain — derived from the oRPC contract
 * (`packages/contracts/src/feature.ts`) but JSON-decoded (dates are strings,
 * enums are narrow string unions).
 */

/** Per the contract `featureSummarySchema`. */
export interface FeatureSummary {
    id: string;
    name: string;
    status: string;
    priority?: string;
    parentId?: string | null;
    wbsCount?: number;
}

/** Per the contract `featureShowResponseSchema`. */
export interface FeatureShowData {
    id: string;
    name: string;
    status: string;
    frontmatter: Record<string, unknown>;
    content: string;
    filePath: string;
}

/** A single finding from a feature check — per the contract output. */
export interface CheckFinding {
    layer: 'L1' | 'L2' | 'L3' | 'L4';
    severity: 'error' | 'warning' | 'info';
    section: string;
    message: string;
}

/** Per the check contract output. */
export interface CheckResult {
    id: string;
    status: string;
    pass: boolean;
    findings: CheckFinding[];
    requiredSections: string[];
    missingSections: string[];
}
