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

/** Input for PATCH /features/{id}/body — write feature body content. */
export interface FeatureBodyUpdateInput {
    id: string;
    body: string;
    actor?: string;
}

/** Response for PATCH /features/{id}/body. */
export interface FeatureBodyUpdateResponse {
    ok: true;
}

/** Input for POST /features/{id}/action — dispatch workflow action. */
export interface FeatureActionInput {
    id: string;
    action: string;
    channel?: string;
    skipDeps?: boolean;
}

/** Response for POST /features/{id}/action. */
export interface FeatureActionResponse {
    ok: true;
}

/** Input for POST /features/{id}/children — create child feature. */
export interface FeatureCreateChildInput {
    id: string;
    name: string;
}

/** Response for POST /features/{id}/children. */
export interface FeatureCreateChildResponse {
    ok: true;
    data: { id: string; filePath: string };
}

/** Input for POST /features/{id}/tasks — create task linked to feature. */
export interface FeatureCreateTaskInput {
    id: string;
    title: string;
}

/** Response for POST /features/{id}/tasks. */
export interface FeatureCreateTaskResponse {
    ok: true;
    data: { wbs: string; filePath: string };
}

/** Input for PATCH /features/{id}/link — link existing task to feature. */
export interface FeatureLinkTaskInput {
    id: string;
    wbs: string;
}

/** Response for PATCH /features/{id}/link. */
export interface FeatureLinkTaskResponse {
    ok: true;
}

/** Sync direction for POST /features/{id}/sync. */
export type SyncDirection = 'pull' | 'push';

/** Input for POST /features/{id}/sync — sync status with linked tasks. */
export interface FeatureSyncInput {
    id: string;
    direction: SyncDirection;
}

/** Response for POST /features/{id}/sync. */
export interface FeatureSyncResponse {
    ok: true;
    data: {
        direction: SyncDirection;
        affectedTasks: number;
        newStatus?: string;
    };
}
