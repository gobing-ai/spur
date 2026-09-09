/**
 * Workflow inventory projection validation and identity binding (0814 R4).
 *
 * The CLI already resolves a workflow definition and returns `steps`, `version`,
 * and `definitionDigest` (`apps/cli/src/commands/workflow.ts`). This module is the
 * pure validation/normalization layer a driver uses BEFORE it reads the full YAML:
 * it accepts the projection JSON, fails closed on an unresolved/invalid definition,
 * and binds the inventory to a digest so later execution can reject identity drift.
 *
 * Keep these pure (json → result) so the projection contract is unit-testable
 * without spawning a CLI or loading YAML. No workflow action/guard is executed
 * here — projection is observation only (R4: "projection executes no workflow
 * actions or guards").
 */

/** One declared step in the todo projection, with its structural markers. */
export interface InventoryStep {
    id: string;
    initial: boolean;
    terminal: boolean;
    failure: boolean;
    pause: boolean;
    loopBack: boolean;
    conditional: boolean;
    nodeType?: string;
    description?: string;
}

/** Normalized workflow inventory (the CLI todo projection). */
export interface WorkflowInventory {
    name: string;
    kind: string;
    format: string;
    version: string;
    definitionDigest: string;
    steps: InventoryStep[];
}

/** Parse outcome for a workflow todo projection: a validated inventory, or a named failure. */
export type InventoryParseResult = { ok: true; inventory: WorkflowInventory } | { ok: false; error: string };

/**
 * Parse and validate a `workflow show --format todo --json` projection. Fails
 * closed (returns `ok: false` with a named reason) when the definition is
 * unresolved, missing its declared steps/version/digest, or malformed — a driver
 * must never proceed to execution against a misleading or unbound inventory.
 */
export function parseWorkflowInventory(json: unknown): InventoryParseResult {
    if (typeof json !== 'object' || json === null) {
        return { ok: false, error: 'workflow inventory: projection is not an object' };
    }
    const obj = json as Record<string, unknown>;
    const name = typeof obj.name === 'string' ? obj.name : '';
    const kind = typeof obj.kind === 'string' ? obj.kind : '';
    const format = typeof obj.format === 'string' ? obj.format : '';
    // version is optional — a known-unversioned definition (the CLI emits `null`)
    // is a supported, valid projection (0814 R4: preserve the existing JSON schema).
    const version = typeof obj.version === 'string' || typeof obj.version === 'number' ? String(obj.version) : '';
    const definitionDigest = typeof obj.definitionDigest === 'string' ? obj.definitionDigest : '';

    if (name === '') return { ok: false, error: 'workflow inventory: missing name' };
    if (kind === '') return { ok: false, error: 'workflow inventory: missing kind' };
    if (definitionDigest === '') return { ok: false, error: 'workflow inventory: missing definitionDigest' };
    if (!Array.isArray(obj.steps) || obj.steps.length === 0) {
        return { ok: false, error: 'workflow inventory: no declared steps' };
    }

    const steps: InventoryStep[] = [];
    for (const raw of obj.steps) {
        if (typeof raw !== 'object' || raw === null) {
            return { ok: false, error: 'workflow inventory: a step is not an object' };
        }
        const s = raw as Record<string, unknown>;
        if (typeof s.id !== 'string' || s.id === '') {
            return { ok: false, error: 'workflow inventory: a step is missing its id' };
        }
        steps.push({
            id: s.id,
            initial: s.initial === true,
            terminal: s.terminal === true,
            failure: s.failure === true,
            pause: s.pause === true,
            loopBack: s.loopBack === true,
            conditional: s.conditional === true,
            ...(typeof s.nodeType === 'string' ? { nodeType: s.nodeType } : {}),
            ...(typeof s.description === 'string' ? { description: s.description } : {}),
        });
    }

    return {
        ok: true,
        inventory: { name, kind, format, version, definitionDigest, steps },
    };
}

/** Identity-binding outcome: ok when the projected digest matches the execution digest. */
export type IdentityAssertionResult = { ok: true } | { ok: false; error: string };

/**
 * Assert that a parsed inventory is bound to the same resolved definition digest
 * that later execution will use. On drift the driver must refuse to execute with
 * a misleading plan (R4: "definition drift or projection failure prevents
 * execution with a misleading plan"). An empty expected digest is treated as
 * unbound and fails closed.
 */
export function assertInventoryIdentity(inventory: WorkflowInventory, expectedDigest: string): IdentityAssertionResult {
    if (expectedDigest === '') {
        return { ok: false, error: 'workflow inventory: no expected definition digest to bind against' };
    }
    if (inventory.definitionDigest !== expectedDigest) {
        return {
            ok: false,
            error: `workflow inventory: identity drift — projected ${inventory.definitionDigest} ≠ execution ${expectedDigest}`,
        };
    }
    return { ok: true };
}

// ── Event-trace rendering (0814 R8) ─────────────────────────────────────────

/** One captured startup/progress event with an ISO-8601 UTC timestamp. */
export interface TraceEvent {
    /** ISO-8601 UTC timestamp (e.g. 2026-09-08T17:50:00Z). */
    at: string;
    /** Event kind (e.g. 'checklist-visible', 'quick-readiness', 'worktree-created', 'inventory-published'). */
    kind: string;
    /** Optional detail (e.g. a measured elapsed ms, a cwd, an invocation count). */
    detail?: string;
}

/**
 * Render an ordered event trace as a stable markdown list (0814 R8 evidence).
 * Each line is timestamped and names the event kind; detail is appended after a
 * ` — ` separator. A trace is evidence of event ordering and provenance, never a
 * fabricated performance claim — the caller records only what was actually
 * observed, and treats unavailable measurements as "unknown".
 */
export function renderEventTrace(events: TraceEvent[]): string {
    return events
        .map((e) => `${e.at} ${e.kind}${e.detail !== undefined && e.detail !== '' ? ` — ${e.detail}` : ''}`)
        .join('\n');
}
