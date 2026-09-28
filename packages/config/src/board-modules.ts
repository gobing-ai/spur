import { z } from 'zod';

// ─── Explicit downstream Board module declarations (task 0989 R1/R2) ───
//
// The declaration contract a project writes under `bootstrap.modules`. Pure zod + string
// math only: this file is part of the CF-safe CORE entry of `@gobing-ai/spur-config`, so it
// must not touch `node:fs`/`node:path` (ADR-027). Asset resolution lives in the app/server
// layers that already own filesystem access.
//
// The host identity inventory is NOT declared here: it is generated from the Board's own
// module registry into `board-runtime.json` (task 0988 R2) and passed in by the caller, so
// the reserved list has exactly one source and cannot drift.

/** Identifier shape a declared module id must match (R2). */
export const BOARD_MODULE_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

/** Agent-visible path prefix the Board serves and renders a project module under. */
export const BOARD_MODULE_ROUTE_PREFIX = '/modules/';

/**
 * One host identity a declaration may not claim — a built-in Board module, or a route
 * identity retired by G64. Mirrors the `reservedModules` entries of `board-runtime.json`.
 */
export interface BoardModuleReservedIdentity {
    readonly id: string;
    readonly route: string;
    /** Set for the retired identities: no module exists any more. */
    readonly retired?: true;
    /** Route a retired identity resolves to today. */
    readonly redirectTo?: string;
}

/**
 * The Board route a declared module is rendered at.
 *
 * Derived from the id rather than declared, so two declarations cannot disagree about their
 * route and the route-collision rule stays a function of the id alone.
 */
export function boardModuleRoute(id: string): string {
    return `${BOARD_MODULE_ROUTE_PREFIX}${id}`;
}

/**
 * Absolute, credential-free HTTP(S) frame source — the only `type: iframe` source accepted (R2/AC4).
 *
 * Rejects relative URLs, non-HTTP(S) schemes and URLs carrying embedded credentials, because
 * every one of those silently renders something other than the declared frame.
 */
export function isSafeFrameUrl(value: string): boolean {
    let parsed: URL;
    try {
        parsed = new URL(value);
    } catch {
        return false;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    return parsed.username === '' && parsed.password === '';
}

/** Fields every declaration carries regardless of type (R1). */
const sharedDeclarationFields = {
    id: z.string().regex(BOARD_MODULE_ID_PATTERN, 'module id must match ^[a-z][a-z0-9-]*$'),
    name: z.string().min(1, 'module name must not be empty'),
    icon: z.string().min(1, 'module icon must not be empty'),
    sidebarLabel: z.string().optional(),
    description: z.string().optional(),
    order: z
        .number()
        .refine((value) => Number.isFinite(value), { message: 'module order must be a finite number' })
        .optional(),
    enabled: z.boolean().optional().default(true),
};

/**
 * One explicit module declaration, discriminated by the required `type`.
 *
 * Both variants are strict: a react declaration may not carry `url`, an iframe declaration
 * may not carry `directory`/`entry`/`styles`, and no variant accepts an unknown field (R1/R2).
 */
export const boardModuleDeclarationSchema = z.discriminatedUnion('type', [
    z
        .object({
            ...sharedDeclarationFields,
            type: z.literal('react'),
            /** Project-relative directory holding the built contribution tree. */
            directory: z.string().min(1),
            /** Project-relative entry module inside `directory`. */
            entry: z.string().min(1),
            /** Project-relative stylesheets, applied in order. Defaults to none. */
            styles: z
                .array(z.string().min(1))
                .optional()
                .default(() => []),
        })
        .strict(),
    z
        .object({
            ...sharedDeclarationFields,
            type: z.literal('iframe'),
            url: z.string().refine(isSafeFrameUrl, {
                message:
                    'iframe url must be an absolute http(s) URL without embedded credentials (relative URLs and other schemes are rejected)',
            }),
        })
        .strict(),
]);

/** Parsed declaration union — `enabled` and `styles` are resolved by the schema. */
export type BoardModuleDeclaration = z.output<typeof boardModuleDeclarationSchema>;

/** The declared list under `bootstrap.modules`; absent means "no project modules". */
export const boardModuleDeclarationsSchema = z.array(boardModuleDeclarationSchema);

/**
 * A declaration rejected by the cross-declaration rules (R2).
 *
 * Carries the declaration index, its id and the reason so one diagnostic names what to fix
 * (AC1: "reports the declaration/index/reason").
 */
export class BoardModuleConfigError extends Error {
    /** Zero-based index of the offending declaration in `bootstrap.modules`. */
    readonly index: number;
    /** id of the offending declaration, or `''` when it was never readable. */
    readonly moduleId: string;
    /** What is wrong, phrased for an operator. */
    readonly reason: string;

    constructor(index: number, moduleId: string, reason: string) {
        super(`bootstrap.modules[${index}]${moduleId ? ` ("${moduleId}")` : ''}: ${reason}`);
        this.name = 'BoardModuleConfigError';
        this.index = index;
        this.moduleId = moduleId;
        this.reason = reason;
    }
}

/**
 * A config-load failure caused by the module declarations themselves.
 *
 * `loadSpurConfig` fails with the field path in its message (zod path or JSON-Schema
 * violation path), both spelled `bootstrap.modules…`; serve uses this to tell a project that
 * EXPLICITLY declared modules apart from an unrelated config error it may still degrade (R6).
 */
export function isBoardModuleConfigError(error: unknown): boolean {
    return error instanceof BoardModuleConfigError || String(error).includes('bootstrap.modules');
}

/**
 * Apply the cross-declaration rules to an already schema-valid list (R2).
 *
 * Duplicate ids/routes and collisions with ANY host or retired identity are configuration
 * errors — including for `enabled: false` declarations, which stay inert but must never
 * become ambiguous once enabled (AC2).
 *
 * @param declarations schema-valid declarations in declaration order
 * @param reservedIdentities host + retired inventory, e.g. `board-runtime.json.reservedModules`
 * @returns the same declarations, so the call can wrap a parse expression
 */
export function validateBoardModuleDeclarations(
    declarations: readonly BoardModuleDeclaration[],
    reservedIdentities: readonly BoardModuleReservedIdentity[],
): readonly BoardModuleDeclaration[] {
    const claimed = new Map<string, number>();
    for (const [index, declaration] of declarations.entries()) {
        const first = claimed.get(declaration.id);
        if (first !== undefined) {
            throw new BoardModuleConfigError(
                index,
                declaration.id,
                `duplicate module id "${declaration.id}", already declared at bootstrap.modules[${first}]`,
            );
        }
        const collision = reservedIdentities.find(
            (identity) => identity.id === declaration.id || identity.route === boardModuleRoute(declaration.id),
        );
        if (collision) {
            const state = collision.retired
                ? `retired host identity "${collision.id}" (now ${collision.redirectTo ?? 'removed'})`
                : `host module "${collision.id}"`;
            throw new BoardModuleConfigError(index, declaration.id, `id/route collides with ${state}`);
        }
        claimed.set(declaration.id, index);
    }
    return declarations;
}

/**
 * Parse `bootstrap.modules` and apply the cross-declaration rules in one call.
 *
 * Rejects shapes zod alone cannot decide (duplicates, host collisions) with the same
 * actionable diagnostic as the field-level failures (R1/R2).
 */
export function parseBoardModuleDeclarations(
    input: unknown,
    reservedIdentities: readonly BoardModuleReservedIdentity[] = [],
): readonly BoardModuleDeclaration[] {
    const declarations = boardModuleDeclarationsSchema.parse(input ?? []);
    return validateBoardModuleDeclarations(declarations, reservedIdentities);
}
