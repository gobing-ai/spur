import type { DesignFileSummary } from '@gobing-ai/spur-contracts';
import { api } from './rpc-client';

/**
 * Design document reads over the shared planning-documents contract (task 1300).
 *
 * Same motivation as `plan-client`: the raw route plus handwritten envelope became a
 * validated procedure, so the module keeps only its exported helper signatures.
 */

/** Metadata summary for a design specification file displayed in the Designs module. */
export type { DesignFileSummary };

/** Detail payload for a single design specification document including its markdown content. */
export interface DesignFileDetail {
    ok: boolean;
    path: string;
    title: string;
    content: string;
}

/** Re-throw a transport refusal with the status the caller can act on. */
function rethrow(action: string, error: unknown): never {
    const status = (error as { status?: number }).status;
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(status === undefined ? `${action}: ${message}` : `${action}: ${status}`);
}

/** Fetch all registered design documents (DESIGN.md, docs/04_DESIGN.md, docs/design/*.md). */
export async function loadDesignFiles(signal?: AbortSignal): Promise<DesignFileSummary[]> {
    try {
        const response = await api.planningDocuments.designList({ signal });
        if (!Array.isArray(response.files)) throw new Error('design files: invalid response shape');
        return response.files;
    } catch (error) {
        rethrow('design files fetch failed', error);
    }
}

/** Fetch the markdown content and title of a specific design document. */
export async function loadDesignContent(path: string, signal?: AbortSignal): Promise<DesignFileDetail> {
    try {
        const response = await api.planningDocuments.designShow({ path }, { signal });
        if (!response.ok || typeof response.content !== 'string')
            throw new Error('design file: invalid response shape');
        return response;
    } catch (error) {
        rethrow('design file fetch failed', error);
    }
}
