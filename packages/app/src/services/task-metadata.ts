import { normalizeTaskStatus } from '@gobing-ai/spur-domain';

/** Canonical read projection; the document's original frontmatter stays untouched. */
export function taskMetadata(frontmatter: Record<string, unknown>): { status: string; featureId: string | null } {
    const rawStatus = typeof frontmatter.status === 'string' ? frontmatter.status : '';
    let status = rawStatus;
    try {
        status = normalizeTaskStatus(rawStatus);
    } catch {
        // Invalid historical status remains visible; task check owns its diagnostic.
    }
    const feature = frontmatter.feature_id ?? frontmatter['feature-id'];
    return { status, featureId: typeof feature === 'string' ? feature : null };
}
