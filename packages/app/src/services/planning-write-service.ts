/**
 * PlanningWriteService — the single mutation path for every task/feature file.
 *
 * Implements the normative 9-step sequence from design §4.1:
 *   lock → parse → mutate → validate → lifecycle → atomic write →
 *   history append → event emit → unlock
 *
 * Invariants (ADR-021):
 * - `updated_at` is written ONLY at step 6 (single writer of truth).
 * - A failed guard never half-writes (zero partial writes, R3).
 * - The lock module is reachable ONLY through this service (R4, §4.2).
 */

import {
    acquireCreateLock,
    acquireEntityLock,
    atomicWriteAsync,
    FEATURE_CANONICAL_SECTIONS,
    featureFrontmatterSchema,
    MarkdownDocument,
    type MarkdownDomain,
    normalizeFeatureStatus,
    normalizeTaskStatus,
    TASK_CANONICAL_SECTIONS,
    taskFrontmatterSchema,
    UNIVERSAL_SECTIONS,
} from '@gobing-ai/spur-domain';
import type { FileSystem } from '@gobing-ai/ts-runtime';

// ─── Entity reference ───────────────────────────────────────────────────

/** Identifies a task or feature file for the write service. */
export interface EntityRef {
    /** Domain kind — determines heading level and schema. */
    readonly kind: MarkdownDomain;
    /** WBS number (task) or feature ID (feature). */
    readonly id: string;
    /** Absolute path to the markdown file. */
    readonly filePath: string;
    /** Folder containing the file (used for lock placement). */
    readonly folder: string;
}

// ─── Lifecycle port (step 5) ────────────────────────────────────────────

/** Result of a lifecycle transition request. */
export interface TransitionResult {
    allowed: boolean;
    from: string;
    to: string;
    /** Optional report explaining why a transition was denied. */
    report?: string;
}

/**
 * Injected port for lifecycle transitions (step 5).
 *
 * The 0055/0059 engine adapter implements this against the real workflow
 * engine. Until then, {@link SchemaLifecyclePort} validates status values
 * against the canonical vocabulary only — sufficient for W1 verbs to work.
 */
export interface LifecyclePort {
    requestTransition(ref: EntityRef, currentStatus: string, to: string): TransitionResult | Promise<TransitionResult>;
}

/**
 * Schema-only lifecycle stub. Validates that the target status is in the
 * canonical vocabulary and is different from the current status. No
 * state-machine graph enforcement — that arrives with 0055/0059.
 */
export class SchemaLifecyclePort implements LifecyclePort {
    constructor() {}

    requestTransition(_ref: EntityRef, currentStatus: string, to: string): TransitionResult {
        if (currentStatus === to) {
            return { allowed: false, from: currentStatus, to, report: 'already in this status' };
        }
        return { allowed: true, from: currentStatus, to };
    }
}

// ─── Event emission (step 8) ────────────────────────────────────────────

/** The six planning events per design §7. */
export type PlanningEventName =
    | 'task.created'
    | 'task.updated'
    | 'task.transitioned'
    | 'feature.created'
    | 'feature.updated'
    | 'feature.transitioned';

/** Event envelope (design §7 normative core). */
export interface PlanningEvent {
    readonly event: PlanningEventName;
    readonly entity: { readonly kind: MarkdownDomain; readonly id: string };
    readonly at: string;
    readonly from?: string;
    readonly to?: string;
    readonly data?: Readonly<Record<string, unknown>>;
}

/**
 * Event emitter port. 0053 wires this to the typed `PlanningEventMap` on the
 * ts-infra `EventBus` + `PlanningEventDao` persistence. Until then,
 * {@link NoopEventEmitter} discards events silently.
 */
export interface EventEmitter {
    emit(event: PlanningEvent): void | Promise<void>;
}

/** Default no-op emitter for pre-0053 use and tests that don't assert events. */
export class NoopEventEmitter implements EventEmitter {
    constructor() {}

    emit(_event: PlanningEvent): void {
        // discard
    }
}

/** Capturing emitter for tests that need to assert emitted events. */
export class CapturingEmitter implements EventEmitter {
    constructor() {}

    readonly events: PlanningEvent[] = [];
    emit(event: PlanningEvent): void {
        this.events.push(event);
    }
}

// ─── Write result ───────────────────────────────────────────────────────

/** Returned by every write operation. */
export interface WriteResult {
    /** The entity that was mutated. */
    readonly ref: EntityRef;
    /** The event name that was emitted (or would be, with a real emitter). */
    readonly eventName: PlanningEventName;
    /** Previous status (for transitions); `undefined` for non-transition writes. */
    readonly fromStatus?: string;
    /** New status (for transitions); `undefined` for non-transition writes. */
    readonly toStatus?: string;
    /**
     * Non-fatal advisories from the mutation (R2): same-level heading lines that
     * were stripped from a section body. The CLI surfaces these via the output
     * seam; empty/omitted when nothing was stripped.
     */
    readonly warnings?: string[];
}

// ─── Internal mutation descriptor ───────────────────────────────────────

type MutationKind = 'create' | 'updateSection' | 'updateFrontmatter' | 'transition' | 'updateBody';

interface MutationDescriptor {
    kind: MutationKind;
    /** For create: the initial file content. */
    content?: string;
    /** For updateSection: the section name and new body. */
    sectionName?: string;
    sectionBody?: string;
    /** For updateBody: the new preamble body text. */
    body?: string;
    /** For updateFrontmatter/transition: the key and value. */
    fmKey?: string;
    fmValue?: string;
    /** For transition: the actor string for the history line. */
    actor?: string;
}

// ─── PlanningWriteService ───────────────────────────────────────────────

/** Context injected into PlanningWriteService. */
export interface PlanningWriteServiceOptions {
    fs: FileSystem;
    lifecycle?: LifecyclePort;
    emitter?: EventEmitter;
    /** Project name for temp-file composition (defaults to `'spur'`). */
    projectName?: string;
}

/**
 * The one mutation path for task and feature files (ADR-021, design §4.1).
 *
 * Every verb that mutates a file — from CLI, server, or any future transport
 * — passes through this service. It enforces the 9-step sequence, the
 * single-writer `updated_at` invariant, and zero-partial-write guard abort.
 */
export class PlanningWriteService {
    private readonly fs: FileSystem;
    private readonly lifecycle: LifecyclePort;
    private readonly emitter: EventEmitter;
    private readonly projectName: string;

    constructor(opts: PlanningWriteServiceOptions) {
        this.fs = opts.fs;
        this.lifecycle = opts.lifecycle ?? new SchemaLifecyclePort();
        this.emitter = opts.emitter ?? new NoopEventEmitter();
        this.projectName = opts.projectName ?? 'spur';
    }

    // ── Public operations ──

    /**
     * Create a new task/feature file (step 1 uses the create-lock).
     *
     * @param ref     Entity reference — file must not already exist.
     * @param content Full markdown content (frontmatter + body) from a template.
     */
    async create(ref: EntityRef, content: string): Promise<WriteResult> {
        return this.executePipeline(ref, { kind: 'create', content });
    }

    /**
     * Create a new entity with **race-safe ID allocation**.
     *
     * Acquires the folder's create-lock FIRST, then runs `allocate` inside it —
     * so the directory scan that picks the next free WBS / feature ID and the
     * file write are a single atomic critical section. Two concurrent creates
     * therefore cannot allocate the same id and clobber each other (the create
     * lock's documented job, design §4.2). The allocator returns the resolved
     * `ref` and the templated `content`.
     *
     * @param folder   Directory the entity is allocated in (the lock scope).
     * @param allocate Callback run inside the create-lock; returns `{ ref, content }`.
     */
    async createAllocated(
        folder: string,
        allocate: () => Promise<{ ref: EntityRef; content: string }>,
    ): Promise<WriteResult> {
        const lock = acquireCreateLock(folder, this.fs);
        try {
            const { ref, content } = await allocate();
            // Lock already held — run the pipeline steps without re-acquiring it.
            return await this.runSteps(ref, { kind: 'create', content });
        } finally {
            lock.release();
        }
    }

    /**
     * Replace the body of a named section in an existing file.
     *
     * @param ref         Entity reference — file must exist.
     * @param sectionName Canonical section name (validated by MarkdownDocument).
     * @param body        New section body (everything after the heading line).
     */
    async updateSection(ref: EntityRef, sectionName: string, body: string): Promise<WriteResult> {
        return this.executePipeline(ref, { kind: 'updateSection', sectionName, sectionBody: body });
    }

    /**
     * Replace the preamble body region of a file — everything between the
     * frontmatter block and the first section heading. Frontmatter and named
     * sections are untouched. Used by body-write operations (task body PATCH).
     *
     * @param ref  Entity reference — file must exist.
     * @param body New preamble body text.
     */
    async updateBody(ref: EntityRef, body: string): Promise<WriteResult> {
        return this.executePipeline(ref, { kind: 'updateBody', body });
    }

    /**
     * Set or replace a scalar frontmatter field in an existing file.
     *
     * @param ref   Entity reference — file must exist.
     * @param key   Frontmatter key (e.g. `'status'`, `'priority'`).
     * @param value Scalar value to write after `<key>: `.
     */
    async updateFrontmatter(ref: EntityRef, key: string, value: string): Promise<WriteResult> {
        return this.executePipeline(ref, { kind: 'updateFrontmatter', fmKey: key, fmValue: value });
    }

    /**
     * Transition an entity to a new lifecycle status.
     *
     * Acquires the entity lock, applies the status change, validates it, runs
     * the lifecycle guard (step 5 — aborts on denial with zero partial writes),
     * appends a `## History` line, writes atomically, and emits a
     * `*.transitioned` event.
     *
     * @param ref       Entity reference — file must exist.
     * @param toStatus  Target status (canonical lowercase form).
     * @param actor     Actor identifier for the history line (default `'system'`).
     */
    async transition(ref: EntityRef, toStatus: string, actor = 'system'): Promise<WriteResult> {
        return this.executePipeline(ref, { kind: 'transition', fmKey: 'status', fmValue: toStatus, actor });
    }

    // ── Private 9-step pipeline ──

    /**
     * The single mutation pipeline (design §4.1). All four public operations
     * delegate here. The pipeline guarantees:
     * - `updated_at` is set only at the write step (R2).
     * - Guard failure at step 5 produces zero partial writes (R3).
     * - Locks are acquired and released only inside this method (R4).
     */
    private async executePipeline(ref: EntityRef, mutation: MutationDescriptor): Promise<WriteResult> {
        // ── Step 1: acquire lock ──
        const isCreate = mutation.kind === 'create';
        const lock = isCreate ? acquireCreateLock(ref.folder, this.fs) : acquireEntityLock(ref.folder, ref.id, this.fs);

        try {
            return await this.runSteps(ref, mutation);
        } finally {
            // ── Step 9: release lock ──
            lock.release();
        }
    }

    /** Steps 2-8, executed between lock acquire (step 1) and release (step 9). */
    private async runSteps(ref: EntityRef, mutation: MutationDescriptor): Promise<WriteResult> {
        const domain = ref.kind;

        // ── Step 2: read + parse ──
        let doc: MarkdownDocument;
        if (mutation.kind === 'create') {
            const content = mutation.content ?? '';
            doc = MarkdownDocument.parse(content, domain);
        } else {
            const raw = await this.fs.readFile(ref.filePath);
            doc = MarkdownDocument.parse(raw, domain);
        }

        // Track status for lifecycle + history + event. Normalize legacy
        // PascalCase/alias values (old rd3 tasks) to canonical lowercase so
        // the engine — which declares lowercase-only states (task-lifecycle.yaml)
        // — never receives an undeclared status. Unknown values pass through
        // unchanged; step-4 validation emits a clear Zod error for those.
        const currentStatus = normalizeStatusForDomain(
            (doc.frontmatterData?.status as string | undefined) ?? '',
            domain,
        );

        // Snapshot pre-existing non-canonical sections BEFORE mutating, so the
        // R3 guard blocks only phantoms THIS write introduces — never a file that
        // a prior agent already corrupted (those are a corpus-cleanup concern that
        // `spur task check` surfaces, not the write guard's job; aborting on them
        // would make an already-corrupted task un-editable through the CLI).
        const phantomsBefore = new Set(phantomSections(doc, domain));

        // ── Step 3: apply mutation ──
        applyMutation(doc, mutation);

        // ── Step 3.5: phantom-section guard (R3, task 0115) ──
        // Defense-in-depth against structural corruption: a mutation must not
        // INTRODUCE a section name outside the canonical ∪ universal vocabulary.
        // R2 strips same-level headings inside `replaceSection`, so a section
        // write can no longer introduce a phantom — but other paths (`updateBody`/
        // `replacePreamble`) are not covered there, so the guard runs for every
        // mutation. The vocabulary is imported from the domain (single source of
        // truth, shared with `PlanningCheckService.runL2`).
        assertNoNewPhantomSections(doc, domain, phantomsBefore);

        // ── Step 4: validate (L1/L2 — Zod schema) ──
        const fm = doc.frontmatterData ?? {};
        if (domain === 'task') {
            const result = taskFrontmatterSchema.safeParse(fm);
            if (!result.success) {
                throw new Error(
                    `Frontmatter validation failed for task ${ref.id}: ${result.error.issues.map((i) => i.message).join('; ')}`,
                );
            }
        } else {
            const result = featureFrontmatterSchema.safeParse(fm);
            if (!result.success) {
                throw new Error(
                    `Frontmatter validation failed for feature ${ref.id}: ${result.error.issues.map((i) => i.message).join('; ')}`,
                );
            }
        }

        // ── Step 5: lifecycle transition (only if status changed) ──
        const newStatus = normalizeStatusForDomain((doc.frontmatterData?.status as string | undefined) ?? '', domain);
        const statusChanged = mutation.kind === 'transition' && newStatus !== currentStatus;
        let fromStatus: string | undefined;
        let toStatus: string | undefined;

        if (statusChanged) {
            const result = this.lifecycle.requestTransition(ref, currentStatus, newStatus);
            const resolved = result instanceof Promise ? await result : result;
            if (!resolved.allowed) {
                // Guard failure → abort with zero partial writes (R3).
                throw new Error(
                    `Lifecycle transition denied for ${ref.kind} ${ref.id}: ${resolved.report ?? `${currentStatus} → ${newStatus}`}`,
                );
            }
            fromStatus = resolved.from;
            toStatus = resolved.to;
        }

        // ── Step 6: set updated_at + serialize + atomic write ──
        const now = new Date().toISOString();
        doc.setFrontmatterField('updated_at', now);

        // ── Step 7: history append (only for status transitions) ──
        if (statusChanged && fromStatus !== undefined && toStatus !== undefined) {
            appendHistoryLine(doc, now, fromStatus, toStatus, mutation.actor ?? 'system');
        }

        const serialized = doc.serialize();
        await atomicWriteAsync(ref.filePath, serialized, ref.id, this.fs, this.projectName);

        // ── Step 8: emit + persist event ──
        const eventName = resolveEventName(mutation.kind, domain, statusChanged);
        const event: PlanningEvent = {
            event: eventName,
            entity: { kind: domain, id: ref.id },
            at: now,
            ...(fromStatus !== undefined ? { from: fromStatus } : {}),
            ...(toStatus !== undefined ? { to: toStatus } : {}),
        };
        await this.emitter.emit(event);

        const warnings = doc.strippedHeadings.map(
            (line) =>
                `Stripped same-level heading from section body (would become a phantom section): "${line}". ` +
                'Use bullet lists, tables, or **bold** labels for sub-structure instead.',
        );

        for (const dup of doc.duplicateSectionNames) {
            warnings.push(
                `Dropped duplicate "${dup}" section (appeared more than once in the file — ` +
                    'likely a copy-paste or double-write error). The first occurrence was kept.',
            );
        }

        return {
            ref,
            eventName,
            ...(fromStatus !== undefined ? { fromStatus } : {}),
            ...(toStatus !== undefined ? { toStatus } : {}),
            ...(warnings.length > 0 ? { warnings } : {}),
        };
    }
}

// ─── Private helpers ────────────────────────────────────────────────────

/**
 * Section names in the document outside the domain's canonical ∪ universal
 * vocabulary (`History`/`References`/`Notes`). A non-canonical name means a
 * same-level heading leaked into a section body and became a phantom section
 * on re-parse.
 */
export function phantomSections(doc: MarkdownDocument, domain: MarkdownDomain): string[] {
    const canonical = domain === 'task' ? TASK_CANONICAL_SECTIONS : FEATURE_CANONICAL_SECTIONS;
    const allowed = new Set<string>([...canonical, ...UNIVERSAL_SECTIONS]);
    return doc.sectionNames.filter((name) => !allowed.has(name));
}

/**
 * Phantom-section guard (step 3.5, R3 / task 0115).
 *
 * Aborts the write only when THIS mutation introduces a phantom section not in
 * `before` — pre-existing phantoms (a prior agent's corruption) are tolerated so
 * an already-broken task stays editable through the CLI; `spur task check` is the
 * surface that flags them for cleanup. A newly-introduced phantom aborts before
 * the atomic write, so the file is never persisted in a freshly-corrupted state
 * (zero partial writes).
 */
export function assertNoNewPhantomSections(doc: MarkdownDocument, domain: MarkdownDomain, before: Set<string>): void {
    const introduced = phantomSections(doc, domain).filter((name) => !before.has(name));
    if (introduced.length > 0) {
        throw new Error(
            `Write would introduce non-canonical section(s): ${introduced.map((n) => `"${n}"`).join(', ')}. ` +
                'These come from same-level headings in a section body — strip them or use bullet lists instead.',
        );
    }
}

/** Apply a mutation descriptor to a parsed MarkdownDocument (step 3). */
function applyMutation(doc: MarkdownDocument, mutation: MutationDescriptor): void {
    switch (mutation.kind) {
        case 'create':
            break;
        case 'updateSection':
            if (mutation.sectionName !== undefined && mutation.sectionBody !== undefined) {
                doc.replaceSection(mutation.sectionName, mutation.sectionBody);
            }
            break;
        case 'updateBody':
            if (mutation.body !== undefined) {
                doc.replacePreamble(mutation.body);
            }
            break;
        case 'updateFrontmatter':
        case 'transition':
            if (mutation.fmKey !== undefined && mutation.fmValue !== undefined) {
                doc.setFrontmatterField(mutation.fmKey, mutation.fmValue);
            }
            break;
    }
}

/** Append one line to the `## History` section (step 7, design §4.1). */
function appendHistoryLine(doc: MarkdownDocument, timestamp: string, from: string, to: string, actor: string): void {
    const existing = doc.getSection('History') ?? '';
    const line = `- ${timestamp} ${from} → ${to} (${actor})`;
    const updated = existing.length > 0 ? `${existing.trimEnd()}\n${line}\n` : `${line}\n`;
    doc.replaceSection('History', updated);
}

/** Resolve the event name from the mutation kind and whether the status changed. */
function resolveEventName(kind: MutationKind, domain: MarkdownDomain, statusChanged: boolean): PlanningEventName {
    if (kind === 'create') {
        return domain === 'task' ? 'task.created' : 'feature.created';
    }
    if (statusChanged) {
        return domain === 'task' ? 'task.transitioned' : 'feature.transitioned';
    }
    return domain === 'task' ? 'task.updated' : 'feature.updated';
}

/**
 * Normalize a legacy/alias status for a domain, passing UNRECOGNIZED values
 * through unchanged. A known-but-non-canonical value (legacy `Backlog`) maps
 * to canonical `backlog`; an unknown value (`banana`) stays raw so step-4
 * validation — not the lifecycle FSM — surfaces the error, and so a
 * corrupted file remains editable for NON-status mutations (the same
 * corrupted-file-remains-editable invariant the phantom-section guard at
 * step 3.5 upholds).
 */
function normalizeStatusForDomain(status: string, domain: MarkdownDomain): string {
    if (!status) return status;
    const normalize = domain === 'task' ? normalizeTaskStatus : normalizeFeatureStatus;
    try {
        return normalize(status);
    } catch {
        return status;
    }
}
