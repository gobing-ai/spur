import type {
    ApiErrorCode,
    apiErrorSchema,
    apiSuccessSchema,
    PaginationMeta,
    paginatedResponseSchema,
} from '@gobing-ai/spur-contracts';
import type { z } from 'zod';

/**
 * ADR-091 envelope helpers (task 0697 relocation).
 *
 * Moved verbatim from `apps/cli/src/output.ts` so service-layer JSON emitters in this
 * package honor `--json-envelope` / `SPUR_JSON_ENVELOPE=1` (see the ADR-091 amendment in
 * `docs/00_ADR.md`). Direction is forced by the workspace graph: `apps/cli` depends on
 * `@gobing-ai/spur-app`, so the reverse import would be circular. The CLI re-exports
 * these names from `apps/cli/src/output.ts`; the adopted call sites are unchanged.
 */

/** Structural output sink satisfied by both the CLI `CommandOutput` and service outputs. */
export interface EnvelopeCapableOutput {
    write(message: string): void;
    error(message: string): void;
}

/** JSON stringify helper that keeps command output stable for automation. */
function toJson(value: unknown): string {
    return JSON.stringify(value, null, 2);
}

/** Contracts success envelope, inferred — never re-spelled (ADR-091). */
type EnvelopeSuccess = z.infer<ReturnType<typeof apiSuccessSchema<z.ZodTypeAny>>>;
/** Contracts paginated-list envelope, inferred — never re-spelled (ADR-091). */
type EnvelopeList = z.infer<ReturnType<typeof paginatedResponseSchema<z.ZodTypeAny>>>;

/** The canonical `{ok, data | error}` union for CLI `--json-envelope` output (ADR-091). */
export type CliEnvelope = EnvelopeSuccess | EnvelopeList | z.infer<typeof apiErrorSchema>;

/** Error payload accepted by {@link toEnvelopeJson} via `opts.error`. */
export interface EnvelopeErrorPayload {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
}

/** Options for {@link toEnvelopeJson}. */
export interface EnvelopeOptions {
    /**
     * Explicit `--json-envelope` flag value. Precedence (ADR-091): explicit flag >
     * `SPUR_JSON_ENVELOPE=1` env > raw default. `undefined` defers to the env.
     */
    enveloped?: boolean;
    /** List payloads emit the paginated `{ok, data[], meta}` form. */
    kind?: 'single' | 'list';
    /** Pagination meta for `kind: 'list'` (defaults to `hasMore: false`, `limit` = item count). */
    meta?: PaginationMeta;
    /** When set, enveloped output is the error envelope; unenveloped output is still the raw payload. */
    error?: EnvelopeErrorPayload;
}

/** True when the CLI should emit the enveloped shape (ADR-091): explicit flag > env > raw. */
export function envelopeEnabled(explicit?: boolean): boolean {
    if (explicit !== undefined) return explicit;
    return process.env.SPUR_JSON_ENVELOPE === '1';
}

/**
 * Envelope-wrapping stringify for `--json` emit sites (ADR-091). Opt-in: without the
 * `--json-envelope` flag or `SPUR_JSON_ENVELOPE=1`, output is byte-identical to `toJson(value)`.
 * Enveloped, a payload becomes `{ok: true, data}` (or the paginated form for `kind: 'list'`,
 * or `{ok: false, error}` when `opts.error` is set — CLI-local codes collapse to
 * `INTERNAL_ERROR` with the local code carried in `error.details.cliCode`).
 */
export function toEnvelopeJson(value: unknown, opts: EnvelopeOptions = {}): string {
    if (!envelopeEnabled(opts.enveloped)) return toJson(value);
    if (opts.error) return toEnvelopeError(opts.error.code, opts.error.message, opts.error.details);
    if (opts.kind === 'list') {
        const data = Array.isArray(value) ? value : [value];
        const meta = opts.meta ?? { hasMore: false, limit: Math.max(data.length, 1) };
        return toJson({ ok: true as const, data, meta });
    }
    return toJson({ ok: true as const, data: value });
}

/** Build the canonical error-envelope string (contracts `apiErrorSchema` shape). */
export function toEnvelopeError(code: ApiErrorCode, message: string, details?: unknown): string {
    return toJson(
        details !== undefined
            ? { ok: false as const, error: { code, message, details } }
            : { ok: false as const, error: { code, message } },
    );
}

/**
 * Failure emit for a `--json` command (ADR-091): enveloped mode writes the canonical error
 * envelope (collapsed `INTERNAL_ERROR`) to stdout; raw mode keeps the pre-existing plain
 * stderr message byte-identical. Exit codes stay the caller's responsibility.
 */
export function writeJsonError(
    output: EnvelopeCapableOutput,
    options: { json?: boolean; jsonEnvelope?: boolean },
    message: string,
): void {
    if (options.json && envelopeEnabled(options.jsonEnvelope)) {
        output.write(toEnvelopeError('INTERNAL_ERROR', message));
        return;
    }
    output.error(message);
}
